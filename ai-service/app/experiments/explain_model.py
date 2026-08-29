"""What the served model actually relies on, and where it works.

Two outputs:

* **Permutation importance**, not XGBoost's ``gain``. Gain is biased towards
  continuous and high-cardinality columns -- it is what ranked a constant
  ``elevation`` column as the second most important feature in the archived V3
  model, when that column held one value per building. Permutation importance
  measures the loss in held-out accuracy when a column is shuffled, so a column
  that carries no usable signal scores zero no matter how often the trees split
  on it.

* **Accuracy by building type and size**, because a single portfolio-wide
  CV(RMSE) hides where a model is usable and where it is not. A facility manager
  needs to know that the model is reliable for offices and unreliable for
  parking structures, not that it averages 43%.

Usage::

    python -m app.experiments.explain_model
"""

from __future__ import annotations

import argparse
import json
import os

import joblib
import numpy as np
import pandas as pd

from app.data_engineering import cohorts as ch
from app.evaluation import metrics as M
from app.experiments import ladder as L
from app.experiments import run_ladder as R

MODEL_DIR = os.path.join("app", "models", "saved")


def permutation_importance(model, X, y_true_kwh, building_ids, columns, seed=0, n_repeats=3):
    """Loss in CV(RMSE) when each column is shuffled. Higher = more relied upon."""
    rng = np.random.default_rng(seed)
    base_pred = np.expm1(model.predict(X))
    base = M.aggregate(M.per_building(y_true_kwh, base_pred, building_ids))["cv_rmse_median"]

    rows = []
    for col in columns:
        deltas = []
        original = X[col].copy()
        for _ in range(n_repeats):
            X[col] = rng.permutation(original.to_numpy())
            pred = np.expm1(model.predict(X))
            shuffled = M.aggregate(M.per_building(y_true_kwh, pred, building_ids))["cv_rmse_median"]
            deltas.append(shuffled - base)
        X[col] = original
        rows.append({
            "feature": col,
            "cv_rmse_increase": float(np.mean(deltas)),
            "sd": float(np.std(deltas)),
        })
    out = pd.DataFrame(rows).sort_values("cv_rmse_increase", ascending=False)
    out["baseline_cv_rmse"] = base
    return out.reset_index(drop=True)


def accuracy_by_segment(df, y_true, y_pred, meta_col, label):
    """Per-building CV(RMSE), grouped by a building characteristic."""
    pb = M.per_building(y_true, y_pred, df["building_id"].to_numpy())
    seg = df.groupby("building_id")[meta_col].first()
    pb = pb.merge(seg.rename(label), left_on="building_id", right_index=True, how="left")
    usable = pb[pb["usable"]]
    g = usable.groupby(label)["cv_rmse"].agg(["count", "median"])
    return g[g["count"] >= 10].sort_values("median").round(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-per-building", type=int, default=300)
    ap.add_argument("--out", default=os.path.join("results", "explain"))
    args = ap.parse_args()

    model = joblib.load(os.path.join(MODEL_DIR, "energy_cold_start.joblib"))
    with open(os.path.join(MODEL_DIR, "energy_cold_start_metadata.json"), encoding="utf-8") as fh:
        meta = json.load(fh)

    cohort = ch.build_cohorts()["temporal"]
    df = R.prepare("cold_start", cohort, rows_per_building=args.rows_per_building, seed=99)
    # Held-out year only: importance measured on data the model did not train on
    # would be meaningless otherwise.
    df = df[df["year"] == 2017].reset_index(drop=True)

    from app.evaluation.harness import ModelSpec, _design_matrix
    spec = [s for s in L.build_specs("cold_start") if s.name == meta["spec"]][0]
    X, _ = _design_matrix(df, spec)
    X = X.reindex(columns=meta["feature_columns"], fill_value=0.0)
    y_kwh = df[L.TARGET_RAW].to_numpy(dtype="float64")

    # Group the one-hot use columns back together so the table reads sensibly.
    base_cols = [c for c in X.columns if "=" not in c]

    print("computing permutation importance on {:,} held-out rows ...".format(len(df)))
    imp = permutation_importance(model, X, y_kwh, df["building_id"].to_numpy(), base_cols)
    print("\n=== permutation importance (CV(RMSE) points lost when shuffled) ===")
    print("baseline CV(RMSE): {:.2f}%".format(imp["baseline_cv_rmse"].iloc[0]))
    print(imp[["feature", "cv_rmse_increase", "sd"]].round(2).to_string(index=False))

    pred = np.expm1(model.predict(X))
    print("\n=== accuracy by primary use (median per-building CV(RMSE) %) ===")
    print(accuracy_by_segment(df, y_kwh, pred, "primaryspaceusage", "use").to_string())

    df["size_band"] = pd.cut(
        df["sqm"], [0, 1000, 5000, 20000, 1e9],
        labels=["<1k m2", "1k-5k", "5k-20k", ">20k m2"],
    )
    print("\n=== accuracy by floor area ===")
    print(accuracy_by_segment(df, y_kwh, pred, "size_band", "size").to_string())

    os.makedirs(args.out, exist_ok=True)
    imp.to_csv(os.path.join(args.out, "permutation_importance.csv"), index=False)
    print("\nwrote {}".format(args.out))


if __name__ == "__main__":
    main()
