"""Turn per-fold ladder results into comparisons, intervals and honest power.

Three things this reports that a bare metric table does not:

* **The protocol gap.** The same model evaluated under ``random`` and under
  ``leave_block_out`` is the optimism that random shuffling of hourly rows
  buys. Reporting it makes the choice of protocol an argument instead of an
  assumption.
* **Paired contrasts on matched folds**, with bootstrap intervals, rather than
  two independent point estimates eyeballed against each other.
* **What was detectable.** A contrast that fails to reach significance is only
  a null result if the design could have found the effect. The minimum
  detectable effect is computed from the *observed* fold spread.

Usage::

    python -m app.experiments.analyse_ladder --run results/ladder/cold_start
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

from app.evaluation import stats as S

METRIC = "cv_rmse_median"

# Contrasts that answer the design's questions. Each is (a, b): "does a beat b?"
CONTRASTS = [
    ("M1_calendar", "M0_seasonal_naive"),
    ("M2_weather", "M1_calendar"),
    ("M3_building", "M2_weather"),
    ("M3prime_site_identity", "M2_weather"),
    ("M3_building", "M3prime_site_identity"),
]


def load_run(run_dir):
    results = pd.read_csv(os.path.join(run_dir, "fold_results.csv"))
    with open(os.path.join(run_dir, "run.json"), "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    return results, meta


def summary_table(results, metric=METRIC):
    """Mean over seeds within a fold, then aggregate across folds."""
    per_fold = (
        results.groupby(["protocol", "model", "fold"], as_index=False)[metric].mean()
    )
    rows = []
    for (protocol, model), g in per_fold.groupby(["protocol", "model"]):
        ci = S.bootstrap_ci(g[metric].to_numpy(), seed=0)
        rows.append({
            "protocol": protocol,
            "model": model,
            "n_folds": int(len(g)),
            "cv_rmse": ci["point"],
            "ci_lo": ci["lo"],
            "ci_hi": ci["hi"],
            "fold_sd": float(g[metric].std(ddof=1)) if len(g) > 1 else np.nan,
        })
    return pd.DataFrame(rows), per_fold


def contrasts(per_fold, metric=METRIC, pairs=CONTRASTS):
    """Paired comparisons within each protocol, on matched folds."""
    rows = []
    for protocol, g in per_fold.groupby("protocol"):
        wide = g.pivot_table(index="fold", columns="model", values=metric)
        for a, b in pairs:
            if a not in wide.columns or b not in wide.columns:
                continue
            sub = wide[[a, b]].dropna()
            if len(sub) < 2:
                continue
            cmp = S.paired_comparison(sub[a].to_numpy(), sub[b].to_numpy())
            sd = cmp["sd_diff"]
            mde = S.minimum_detectable_effect(sd, cmp["n_folds"], n_sim=800, seed=0) \
                if np.isfinite(sd) and sd > 0 else np.nan
            rows.append({
                "protocol": protocol,
                "contrast": "{} vs {}".format(a, b),
                "n_folds": cmp["n_folds"],
                "delta_cv_rmse": cmp["mean_diff"],
                "ci_lo": cmp["ci"]["lo"],
                "ci_hi": cmp["ci"]["hi"],
                "folds_improved": cmp["n_folds_improved"],
                "relative_effect": cmp["relative_effect"],
                "p_value": cmp["p_value"],
                "fold_sd": sd,
                "min_detectable_effect": mde,
            })
    return pd.DataFrame(rows)


def protocol_gap(summary, metric_col="cv_rmse"):
    """Optimism of each protocol relative to leave_block_out, per model."""
    piv = summary.pivot_table(index="model", columns="protocol", values=metric_col)
    if "leave_block_out" not in piv.columns:
        return pd.DataFrame()
    out = pd.DataFrame(index=piv.index)
    for col in piv.columns:
        if col == "leave_block_out":
            continue
        out["{}_minus_lbo".format(col)] = piv[col] - piv["leave_block_out"]
    out["leave_block_out"] = piv["leave_block_out"]
    return out.reset_index()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=os.path.join("results", "ladder", "cold_start"))
    ap.add_argument("--metric", default=METRIC)
    args = ap.parse_args()

    results, meta = load_run(args.run)
    summary, per_fold = summary_table(results, args.metric)
    con = contrasts(per_fold, args.metric)
    gap = protocol_gap(summary)

    pd.set_option("display.width", 200)
    print("=" * 88)
    print("RUN: task={}  cohort={}  rows/building={}  seeds={}".format(
        meta.get("task"), meta["cohort"]["name"],
        meta.get("rows_per_building"), meta.get("seeds")))
    print("     {:,} rows, {} buildings, {} folds".format(
        meta.get("n_rows_used", 0), meta.get("n_buildings_used", 0),
        meta["cohort"]["n_folds"]))
    print("     metric: {} (CV(RMSE) %, lower is better), git {}".format(
        args.metric, meta.get("git_sha", "?")[:8]))
    print("=" * 88)

    print("\n--- CV(RMSE) by protocol and model, mean over folds [95% bootstrap CI] ---")
    piv = summary.pivot_table(index="model", columns="protocol", values="cv_rmse")
    order = [c for c in ["random", "temporal", "leave_buildings_out", "leave_block_out"]
             if c in piv.columns]
    print(piv[order].round(2).to_string())

    print("\n--- per-cell detail ---")
    print(summary.sort_values(["protocol", "model"])[
        ["protocol", "model", "n_folds", "cv_rmse", "ci_lo", "ci_hi", "fold_sd"]
    ].round(2).to_string(index=False))

    if not gap.empty:
        print("\n--- optimism: protocol minus leave_block_out (negative = flattering) ---")
        print(gap.round(2).to_string(index=False))

    print("\n--- paired contrasts (negative delta = first model better) ---")
    if con.empty:
        print("  (none computable)")
    else:
        print(con.sort_values(["protocol", "contrast"]).round(3).to_string(index=False))
        print("\n  min_detectable_effect is in CV(RMSE) points at the observed fold spread.")
        print("  A contrast whose |delta| is below it is not evidence of no effect.")

    out = os.path.join(args.run, "analysis")
    os.makedirs(out, exist_ok=True)
    summary.to_csv(os.path.join(out, "summary.csv"), index=False)
    con.to_csv(os.path.join(out, "contrasts.csv"), index=False)
    if not gap.empty:
        gap.to_csv(os.path.join(out, "protocol_gap.csv"), index=False)
    print("\nwrote {}".format(out))


if __name__ == "__main__":
    main()
