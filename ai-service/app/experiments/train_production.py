"""Train the model that the API actually serves, on the real cohort.

The previous production artefact (``xgboost_spatial_v3_final.joblib``) was
trained on four buildings with hand-authored NDVI/NDBI/elevation values and fed
latitude and longitude straight to the model. It is archived, not served.

This trains one rung of the ladder -- by default ``M3_building``, the rung the
evaluation shows carries the signal -- on the full screened cohort, and saves it
next to the numbers that justify it. The metrics stored in the metadata are the
**held-out** ones from the evaluation harness, never in-sample scores: a served
model should advertise the accuracy it demonstrated on data it had not seen, not
the accuracy it can reach on its own training set.

Usage::

    python -m app.experiments.train_production --spec M3_building
"""

from __future__ import annotations

import argparse
import json
import os

import joblib
import numpy as np
import pandas as pd

from app.data_engineering import cohorts as ch
from app.evaluation import harness as H
from app.experiments import ladder as L
from app.experiments import run_ladder as R
from app.provenance import provenance

MODEL_DIR = os.path.join("app", "models", "saved")
MODEL_NAME = "energy_cold_start"


def _held_out_metrics(run_dir, spec_name):
    """Read the harness result for this spec, so the model ships with evidence."""
    path = os.path.join(run_dir, "fold_results.csv")
    if not os.path.exists(path):
        return None
    res = pd.read_csv(path)
    res = res[res["model"] == spec_name]
    if res.empty:
        return None
    out = {}
    for protocol, g in res.groupby("protocol"):
        per_fold = g.groupby("fold")["cv_rmse_median"].mean()
        out[protocol] = {
            "cv_rmse_median_pct": round(float(per_fold.mean()), 2),
            "fold_sd": round(float(per_fold.std(ddof=1)), 2) if len(per_fold) > 1 else None,
            "n_folds": int(len(per_fold)),
            "nmbe_median_pct": round(float(g["nmbe_median"].mean()), 2),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default="M3_building")
    ap.add_argument("--cohort", default="temporal")
    ap.add_argument("--rows-per-building", type=int, default=2000)
    ap.add_argument("--n-estimators", type=int, default=400)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--eval-run", default=os.path.join("results", "ladder", "cold_start"))
    ap.add_argument("--out", default=MODEL_DIR)
    args = ap.parse_args()

    cohort = ch.build_cohorts()[args.cohort]
    print("cohort {}: {} buildings, {} folds".format(
        cohort.name, cohort.n_buildings, len(cohort.folds)))

    df = R.prepare("cold_start", cohort, rows_per_building=args.rows_per_building, seed=args.seed)
    print("training rows: {:,}  buildings: {}".format(len(df), df["building_id"].nunique()))

    specs = {s.name: s for s in L.build_specs(task="cold_start",
                                              factory=L.xgb_factory(n_estimators=args.n_estimators))}
    spec = specs[args.spec]

    # The guard runs here too: a production model must not be trained on a
    # feature set that identifies buildings.
    X, vocab = H._design_matrix(df, spec)
    y = df[L.TARGET].to_numpy(dtype="float64")

    model = spec.factory(args.seed)
    model.fit(X, y)
    print("fitted {} on {} columns".format(args.spec, X.shape[1]))

    os.makedirs(args.out, exist_ok=True)
    model_path = os.path.join(args.out, "{}.joblib".format(MODEL_NAME))
    joblib.dump(model, model_path)

    meta = {
        "model_name": MODEL_NAME,
        "spec": args.spec,
        "spec_description": spec.description,
        "task": "cold_start",
        "note": (
            "Lag-free by design: predicts for a building with no meter history "
            "from calendar, weather and building attributes. No spatial or "
            "remote-sensing feature is used -- BDG2 publishes city-level "
            "coordinates with a 40 km bound, so none can be computed honestly."
        ),
        "target": "log1p(meter_reading_kWh)",
        "inverse_transform": "expm1",
        "feature_columns": list(X.columns),
        "categorical_vocabulary": vocab,
        "n_train_rows": int(len(df)),
        "n_train_buildings": int(df["building_id"].nunique()),
        "cohort": cohort.summary(),
        "n_estimators": args.n_estimators,
        "seed": args.seed,
        "held_out_metrics": _held_out_metrics(args.eval_run, args.spec),
        "held_out_metrics_note": (
            "CV(RMSE) and NMBE per ASHRAE Guideline 14, computed per building "
            "then averaged over folds, on data the model had not seen. "
            "In-sample scores are deliberately not reported."
        ),
        **provenance(),
    }
    meta_path = os.path.join(args.out, "{}_metadata.json".format(MODEL_NAME))
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, default=str)

    print("wrote {}".format(model_path))
    print("wrote {}".format(meta_path))
    if meta["held_out_metrics"]:
        for proto, m in meta["held_out_metrics"].items():
            print("  {:<22s} CV(RMSE) {:6.2f}%  over {} folds".format(
                proto, m["cv_rmse_median_pct"], m["n_folds"]))


if __name__ == "__main__":
    main()
