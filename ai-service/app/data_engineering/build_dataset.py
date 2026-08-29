"""Build the modelling dataset from real BDG2 data.

Replaces ``prepare_pilot_data.py``, which used 4 of 1636 buildings (0.24% of the
dataset, 4 of one site's 305) and predicted absolute kWh across buildings whose
mean consumption spans 33 -> 2048 kWh, a 61.4x range. On that setup, predicting
each building's constant mean already scores R2 = 0.9188, so aggregate metrics
were dominated by between-building scale rather than by any modelling skill.

What this builder does differently:

* **All sites, all buildings** that pass quality screening, not a hand-picked
  four.
* **EUI target.** ``eui_wh_m2 = meter_reading * 1000 / sqm`` puts every building
  on a comparable intensity scale, so a cross-building metric measures forecast
  quality instead of floor area. Absolute ``meter_reading`` is retained so the
  two can be compared honestly.
* **Real building attributes** (``sqm``, ``primaryspaceusage``, ``yearbuilt``,
  ``numberoffloors``) which were present and unused.
* **Site-partitioned Parquet**, which bounds memory and gives the natural fold
  structure for the leave-one-site-out cross-validation planned in Sprint 3.
* **No spatial features.** ``spatial_features`` is empty until real ingestion
  lands in Sprint 2. Nothing here fabricates one.

Usage::

    python -m app.data_engineering.build_dataset
    python -m app.data_engineering.build_dataset --sites Rat Bear --out data/processed
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.data_engineering import bdg2_metadata as md
from app.data_engineering import data_quality as dq
from app.data_engineering import leakage

BDG2_ROOT = os.path.join("data", "building-data-genome-project-2", "data")
DEFAULT_OUT = os.path.join("data", "processed")

WEATHER_COLUMNS = [
    "airTemperature",
    "dewTemperature",
    "windSpeed",
    "cloudCoverage",
    "seaLvlPressure",
    "precipDepth1HR",
]

# Train on 2016, test on 2017. Never a random split: with hourly autoregressive
# features a random split leaks future into past.
TRAIN_YEAR = 2016
TEST_YEAR = 2017


def _git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:
        return "unknown"


def load_meter(meter="electricity"):
    path = os.path.join(BDG2_ROOT, "meters", "cleaned", "{}_cleaned.csv".format(meter))
    if not os.path.exists(path):
        raise FileNotFoundError("Meter file not found: {}".format(path))
    if os.path.getsize(path) < 10_000:
        raise RuntimeError(
            "{} is an unresolved git-lfs pointer ({} bytes). Run `git lfs pull` "
            "inside the BDG2 submodule.".format(path, os.path.getsize(path))
        )
    df = pd.read_csv(path, parse_dates=["timestamp"], index_col="timestamp")
    return df.astype("float32")


def load_weather():
    path = os.path.join(BDG2_ROOT, "weather", "weather.csv")
    wx = pd.read_csv(path, parse_dates=["timestamp"])
    keep = ["timestamp", "site_id"] + [c for c in WEATHER_COLUMNS if c in wx.columns]
    return wx[keep]


def add_calendar(df):
    ts = df["timestamp"]
    df["hour"] = ts.dt.hour.astype("int8")
    df["day_of_week"] = ts.dt.dayofweek.astype("int8")
    df["month"] = ts.dt.month.astype("int8")
    df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype("int8")
    return df


def build(meter="electricity", sites=None, out_dir=DEFAULT_OUT, min_buildings_per_site=1):
    os.makedirs(out_dir, exist_ok=True)

    print("Loading BDG2 metadata ...")
    meta = md.load_metadata()
    site_frame, coord_findings = md.validate_coordinates(meta)
    attrs = md.building_attributes(meta)

    print("Loading {} meter data ...".format(meter))
    wide = load_meter(meter)
    print("  wide frame: {} hours x {} buildings".format(*wide.shape))

    print("Screening meter quality ...")
    quality = dq.screen_meter_frame(wide)
    quality_summary = dq.summarise(quality)
    print(
        "  usable {} / {} screened ({} excluded)".format(
            quality_summary["n_usable"],
            quality_summary["n_screened"],
            quality_summary["n_excluded"],
        )
    )

    usable_ids = set(quality.loc[quality["usable"], "building_id"])

    # A building also needs a valid area, or its EUI is undefined.
    valid_area = set(attrs.loc[attrs["sqm_valid"], "building_id"])
    n_dropped_area = len(usable_ids - valid_area)
    usable_ids &= valid_area

    keep = attrs[attrs["building_id"].isin(usable_ids)].copy()
    if sites:
        keep = keep[keep["site_id"].isin(sites)]

    site_counts = keep.groupby("site_id").size()
    kept_sites = sorted(site_counts[site_counts >= min_buildings_per_site].index)
    keep = keep[keep["site_id"].isin(kept_sites)]

    print(
        "  {} buildings across {} sites after screening "
        "({} dropped for missing/zero floor area)".format(
            len(keep), len(kept_sites), n_dropped_area
        )
    )

    weather = load_weather()
    attrs_indexed = keep.set_index("building_id")

    manifest_partitions = []
    total_rows = 0

    for site_id in kept_sites:
        cols = [b for b in keep.loc[keep["site_id"] == site_id, "building_id"] if b in wide.columns]
        if not cols:
            continue

        block = wide[cols].copy()
        block.index.name = "timestamp"
        long = block.reset_index().melt(
            id_vars="timestamp", var_name="building_id", value_name="meter_reading"
        )
        long = long.dropna(subset=["meter_reading"])
        if long.empty:
            continue

        long["site_id"] = site_id
        long = long.merge(
            weather[weather["site_id"] == site_id].drop(columns=["site_id"]),
            on="timestamp",
            how="left",
        )

        # Building attributes
        for col in ["sqm", "primaryspaceusage", "yearbuilt", "numberoffloors"]:
            if col in attrs_indexed.columns:
                long[col] = long["building_id"].map(attrs_indexed[col])

        # EUI: watt-hours per square metre per hour. This is the cross-building
        # comparable target; meter_reading is kept for absolute-scale reporting.
        long["eui_wh_m2"] = (
            long["meter_reading"].astype("float64") * 1000.0 / long["sqm"].astype("float64")
        )

        long = add_calendar(long)
        long["year"] = long["timestamp"].dt.year.astype("int16")
        long = long[long["year"].isin([TRAIN_YEAR, TEST_YEAR])]
        if long.empty:
            continue

        long["split"] = np.where(long["year"] == TRAIN_YEAR, "train", "test")

        part_dir = os.path.join(out_dir, "energy", "site_id={}".format(site_id))
        os.makedirs(part_dir, exist_ok=True)
        part_path = os.path.join(part_dir, "part.parquet")
        long.drop(columns=["site_id"]).to_parquet(part_path, index=False)

        total_rows += len(long)
        manifest_partitions.append(
            {
                "site_id": site_id,
                "path": part_path.replace(os.sep, "/"),
                "n_rows": int(len(long)),
                "n_buildings": int(long["building_id"].nunique()),
                "n_train": int((long["split"] == "train").sum()),
                "n_test": int((long["split"] == "test").sum()),
            }
        )
        print(
            "  {:<10} {:>7} buildings  {:>10,} rows".format(
                site_id, long["building_id"].nunique(), len(long)
            )
        )

    # --- Side outputs -----------------------------------------------------
    quality.to_csv(os.path.join(out_dir, "meter_quality_report.csv"), index=False)
    site_frame.to_csv(os.path.join(out_dir, "sites.csv"), index=False)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _git_sha(),
        "meter": meter,
        "source": "Building Data Genome Project 2",
        "train_year": TRAIN_YEAR,
        "test_year": TEST_YEAR,
        "target_primary": "eui_wh_m2",
        "target_absolute": "meter_reading",
        "n_rows": int(total_rows),
        "n_buildings": int(sum(p["n_buildings"] for p in manifest_partitions)),
        "n_sites": len(manifest_partitions),
        "quality_summary": quality_summary,
        "n_dropped_missing_area": int(n_dropped_area),
        "spatial_sample_size": md.spatial_sample_size(site_frame),
        "coordinate_findings": [
            {"site_id": f.site_id, "status": f.status, "detail": f.detail}
            for f in coord_findings
        ],
        "feature_roles": {
            "calendar": ["hour", "day_of_week", "month", "is_weekend"],
            "weather": [c for c in WEATHER_COLUMNS],
            "building_attribute": ["sqm", "primaryspaceusage", "yearbuilt", "numberoffloors"],
            "spatial": [],
            "excluded_as_features": sorted(leakage.FORBIDDEN_AS_FEATURES),
        },
        "partitions": manifest_partitions,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    print("\nWrote {:,} rows across {} sites to {}".format(total_rows, len(manifest_partitions), out_dir))
    return manifest


def load_dataset(out_dir=DEFAULT_OUT, sites=None, columns=None):
    """Read the partitioned dataset back into one frame."""
    root = os.path.join(out_dir, "energy")
    if not os.path.isdir(root):
        raise FileNotFoundError("No dataset at {}. Run build_dataset first.".format(root))
    frames = []
    for entry in sorted(os.listdir(root)):
        if not entry.startswith("site_id="):
            continue
        site_id = entry.split("=", 1)[1]
        if sites and site_id not in sites:
            continue
        part = os.path.join(root, entry, "part.parquet")
        df = pd.read_parquet(part, columns=columns)
        df["site_id"] = site_id
        frames.append(df)
    if not frames:
        raise FileNotFoundError("No partitions matched sites={}".format(sites))
    return pd.concat(frames, ignore_index=True)


def main():
    ap = argparse.ArgumentParser(description="Build the BDG2 modelling dataset.")
    ap.add_argument("--meter", default="electricity")
    ap.add_argument("--sites", nargs="*", default=None, help="Limit to these site_ids.")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--min-buildings-per-site", type=int, default=1)
    args = ap.parse_args()
    build(
        meter=args.meter,
        sites=args.sites,
        out_dir=args.out,
        min_buildings_per_site=args.min_buildings_per_site,
    )


if __name__ == "__main__":
    main()
