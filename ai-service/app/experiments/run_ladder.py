"""Run the model ladder across all four evaluation protocols.

Usage::

    python -m app.experiments.run_ladder --task cold_start --seeds 3
    python -m app.experiments.run_ladder --task forecast --rows-per-building 1500

Row sampling is explicit and always recorded in ``run.json``: hourly rows within
a building are highly redundant for the lag-free task, so a per-building random
sample keeps hour and season coverage while making 4 protocols x 5 models x
many folds tractable. A result is only comparable to another result with the
same sampling, which is why the number travels with the output.
"""

from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

from app.data_engineering import cohorts as ch
from app.data_engineering.build_dataset import load_dataset
from app.evaluation import harness as H
from app.evaluation import protocols as P
from app.experiments import ladder as L

DEFAULT_OUT = os.path.join("results", "ladder")

BASE_COLUMNS = [
    "timestamp", "building_id", "meter_reading", "sqm", "primaryspaceusage",
    "yearbuilt", "numberoffloors", "airTemperature", "dewTemperature",
    "windSpeed", "cloudCoverage", "hour", "day_of_week", "month",
    "is_weekend", "year", "split",
]


def _sample_per_building(df, rows_per_building, rng):
    """Uniform random rows within each building, vectorised.

    A per-building random sample rather than a fixed time stride: a stride would
    lock the sample to particular hours of the day and destroy the diurnal
    coverage the calendar features depend on.
    """
    if not rows_per_building or df.empty:
        return df
    order = rng.permutation(len(df))
    shuffled = df.iloc[order]
    rank = shuffled.groupby("building_id", sort=False).cumcount()
    return shuffled[rank < rows_per_building]


def prepare(task, cohort, rows_per_building=None, seed=0, verbose=True, horizon=1):
    """Load, restrict to the cohort, derive features and sample rows.

    Loads one site partition at a time. The full dataset is 22.9 M rows and does
    not fit in the service container's memory alongside the model; partitioning
    by site was chosen in Sprint 1 partly for this reason. Lags, when needed, are
    computed inside a partition -- safe because every row of a building lives in
    exactly one site partition -- and always *before* row sampling, since a lag
    over sampled rows would not be a lag.
    """
    keep = set(cohort.building_ids)
    rng = np.random.default_rng(seed)
    parts = []

    root = os.path.join("data", "processed", "energy")
    for entry in sorted(os.listdir(root)):
        if not entry.startswith("site_id="):
            continue
        site_id = entry.split("=", 1)[1]
        if site_id not in set(cohort.site_of_building.values()):
            continue

        df = pd.read_parquet(os.path.join(root, entry, "part.parquet"), columns=BASE_COLUMNS)
        df = df[df["building_id"].isin(keep)]
        if df.empty:
            continue
        df["site_id"] = site_id

        df = L.add_derived(df)
        if task == "forecast":
            df = L.add_lags(df, horizon=horizon)
            df = df.dropna(subset=L.lag_features_for_horizon(horizon))

        # Rows without weather cannot serve M2 upward; drop once so every rung
        # of the ladder sees identical rows and the comparison stays paired.
        df = df.dropna(subset=["airTemperature", "dewTemperature", "log_sqm"])
        df = _sample_per_building(df, rows_per_building, rng)

        parts.append(df)
        if verbose:
            print("  {:<10s} {:>7,} rows  {:>4} buildings".format(
                site_id, len(df), df["building_id"].nunique()))

    if not parts:
        raise RuntimeError("no partitions matched cohort {}".format(cohort.name))
    return pd.concat(parts, ignore_index=True)


def build_protocols(n_building_folds=5):
    return [
        P.RandomSplit(test_size=0.25),
        P.TemporalSplit(),
        P.LeaveBuildingsOut(n_folds=n_building_folds),
        P.LeaveBlockOut(),
    ]


def main():
    ap = argparse.ArgumentParser(description="Run the M0-M3' ladder.")
    ap.add_argument("--task", choices=["cold_start", "forecast"], default="cold_start")
    ap.add_argument("--cohort", default="spatial_loso", choices=["temporal", "spatial_loso"])
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--rows-per-building", type=int, default=1200)
    ap.add_argument("--building-folds", type=int, default=5)
    ap.add_argument("--n-estimators", type=int, default=250)
    ap.add_argument("--horizon", type=int, default=1,
                    help="Forecast horizon in hours. Only lags at least this old may be used.")
    ap.add_argument("--out", default=None)
    ap.add_argument("--protocols", nargs="*", default=None)
    args = ap.parse_args()

    cohorts = ch.build_cohorts()
    cohort = cohorts[args.cohort]
    print("cohort {}: {} buildings, {} sites, {} folds".format(
        cohort.name, cohort.n_buildings, len(cohort.sites), len(cohort.folds)))

    df = prepare(args.task, cohort, rows_per_building=args.rows_per_building,
                 horizon=args.horizon)
    print("prepared {:,} rows x {} buildings for task={}".format(
        len(df), df["building_id"].nunique(), args.task))

    protocols = build_protocols(args.building_folds)
    if args.protocols:
        protocols = [p for p in protocols if p.name in args.protocols]

    specs = L.build_specs(task=args.task, horizon=args.horizon,
                          factory=L.xgb_factory(n_estimators=args.n_estimators))
    seeds = tuple(range(args.seeds))

    results = H.run_matrix(
        df, specs, protocols, cohort=cohort, target=L.TARGET, seeds=seeds,
        check_leakage=True, inverse_transform=L.inverse_target,
    )

    suffix = "" if args.task != "forecast" else "_h{}".format(args.horizon)
    out_dir = args.out or os.path.join(DEFAULT_OUT, args.task + suffix)
    H.save_results(results, out_dir, {
        "task": args.task,
        "horizon_hours": args.horizon,
        "lags_available": L.lag_features_for_horizon(args.horizon) if args.task == "forecast" else [],
        "cohort": cohort.summary(),
        "seeds": list(seeds),
        "rows_per_building": args.rows_per_building,
        "n_rows_used": int(len(df)),
        "n_buildings_used": int(df["building_id"].nunique()),
        "target": L.TARGET,
        "target_note": "log1p(meter_reading); metrics computed after back-transform",
        "n_estimators": args.n_estimators,
        "protocols": [p.describe() for p in protocols],
        "models": [{"name": s.name, "description": s.description,
                    "n_declared_features": len(s.all_features)} for s in specs],
    })
    print("\nwrote {}".format(out_dir))


if __name__ == "__main__":
    main()
