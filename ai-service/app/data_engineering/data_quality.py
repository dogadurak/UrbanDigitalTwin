"""Quality screening for BDG2 hourly meter series.

The `*_cleaned.csv` files in BDG2 have already had gross errors removed by the
dataset authors, but "cleaned" does not mean "modellable". Three failure modes
survive and each one quietly corrupts a supervised model:

* **Stuck meters.** A long run of an identical non-zero value is an instrument
  fault, not consumption. An autoregressive model scores near-perfectly on
  those hours (``lag_1`` equals the target) which inflates aggregate metrics
  without any predictive skill.
* **Extended outages.** Long zero runs look like real demand of zero. They
  train the model to predict zero after zero.
* **Thin coverage.** A building with a few hundred valid hours cannot support
  168-hour lags, yet contributes rows that dominate nothing and add noise.

Screening happens *before* the train/test split and uses no target statistics
from the test period, so it cannot leak. Every threshold is an explicit,
named constant: the point is that a reader can disagree with a number and
re-run, not that the numbers are optimal.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# --- Screening thresholds (documented, not tuned against any result) ---------

# A building needs enough history for a 168-hour lag plus a usable remainder.
# One year of hourly data is 8760 points; require at least a quarter of the
# two-year record.
MIN_VALID_HOURS = 4380

# Fraction of the record that may be missing before the series is unusable.
MAX_MISSING_FRACTION = 0.5

# A constant non-zero value repeated this many hours is treated as a stuck
# sensor. 24 h of a *identical* float reading is not plausible real demand.
FLATLINE_RUN_HOURS = 24

# A zero run this long is an outage, not demand.
ZERO_RUN_HOURS = 24

# Share of the series that may sit in flatline/zero runs before exclusion.
MAX_BAD_RUN_FRACTION = 0.25

# Robust outlier bound, in median absolute deviations from the median.
# Flagged, never dropped: extreme hours may be genuine peaks.
OUTLIER_MAD_MULTIPLIER = 10.0


def _longest_run(mask):
    """Length of the longest run of True in a boolean array."""
    arr = np.asarray(mask, dtype=bool)
    if arr.size == 0 or not arr.any():
        return 0
    # Run-length encode via change points.
    changes = np.flatnonzero(np.diff(arr.astype(np.int8)))
    starts = np.concatenate(([0], changes + 1))
    ends = np.concatenate((changes + 1, [arr.size]))
    runs = ends - starts
    return int(runs[arr[starts]].max()) if arr[starts].any() else 0


def _run_coverage(mask, min_len):
    """Total hours sitting inside runs of True of length >= ``min_len``.

    Isolated True values are excluded: a single zero hour is plausible demand,
    a day of them is an outage.
    """
    arr = np.asarray(mask, dtype=bool)
    if arr.size == 0 or not arr.any():
        return 0
    changes = np.flatnonzero(np.diff(arr.astype(np.int8)))
    starts = np.concatenate(([0], changes + 1))
    ends = np.concatenate((changes + 1, [arr.size]))
    runs = ends - starts
    keep = arr[starts] & (runs >= min_len)
    return int(runs[keep].sum())


def screen_series(series, building_id):
    """Screen one building's hourly series and return a flags dict.

    ``series`` is indexed by timestamp and may contain NaN for missing hours.
    """
    values = series.to_numpy(dtype="float64")
    n_total = values.size
    valid_mask = ~np.isnan(values)
    n_valid = int(valid_mask.sum())

    flags = {
        "building_id": building_id,
        "n_total_hours": int(n_total),
        "n_valid_hours": n_valid,
        "missing_fraction": float(1.0 - n_valid / n_total) if n_total else 1.0,
        "n_negative": 0,
        "zero_fraction": 0.0,
        "longest_zero_run": 0,
        "longest_flatline_run": 0,
        "bad_run_fraction": 0.0,
        "n_outliers": 0,
        "is_constant": False,
        "usable": False,
        "exclusion_reason": "",
    }

    if n_valid == 0:
        flags["exclusion_reason"] = "no valid readings"
        return flags

    valid = values[valid_mask]

    flags["n_negative"] = int((valid < 0).sum())
    flags["is_constant"] = bool(np.nanstd(valid) == 0.0)

    zero_mask = valid == 0
    flags["zero_fraction"] = float(zero_mask.mean())
    flags["longest_zero_run"] = _longest_run(zero_mask)

    # Flatline: identical consecutive non-zero readings.
    same_as_prev = np.concatenate(([False], np.diff(valid) == 0)) & (~zero_mask)
    flags["longest_flatline_run"] = _longest_run(same_as_prev)

    bad_hours = _run_coverage(zero_mask, ZERO_RUN_HOURS) + _run_coverage(
        same_as_prev, FLATLINE_RUN_HOURS
    )
    flags["bad_run_fraction"] = float(bad_hours / n_valid)

    # Robust outlier count (MAD). Flag only -- genuine peaks matter.
    median = float(np.median(valid))
    mad = float(np.median(np.abs(valid - median)))
    if mad > 0:
        flags["n_outliers"] = int((np.abs(valid - median) > OUTLIER_MAD_MULTIPLIER * mad).sum())

    # --- Verdict --------------------------------------------------------
    if n_valid < MIN_VALID_HOURS:
        flags["exclusion_reason"] = "only {} valid hours (< {})".format(n_valid, MIN_VALID_HOURS)
    elif flags["missing_fraction"] > MAX_MISSING_FRACTION:
        flags["exclusion_reason"] = "missing {:.0%} of the record".format(flags["missing_fraction"])
    elif flags["is_constant"]:
        flags["exclusion_reason"] = "series is constant"
    elif flags["n_negative"] > 0:
        flags["exclusion_reason"] = "{} negative readings".format(flags["n_negative"])
    elif flags["bad_run_fraction"] > MAX_BAD_RUN_FRACTION:
        flags["exclusion_reason"] = "{:.0%} of hours in stuck/zero runs".format(
            flags["bad_run_fraction"]
        )
    else:
        flags["usable"] = True

    return flags


def screen_meter_frame(meter_df, building_ids=None):
    """Screen every building column in a wide meter frame.

    ``meter_df`` is the BDG2 wide format: a ``timestamp`` index and one column
    per building. Returns one row of flags per building.
    """
    cols = list(building_ids) if building_ids is not None else list(meter_df.columns)
    rows = [screen_series(meter_df[c], c) for c in cols if c in meter_df.columns]
    report = pd.DataFrame(rows)
    if not report.empty:
        report = report.sort_values(["usable", "building_id"], ascending=[False, True])
    return report.reset_index(drop=True)


def summarise(report):
    """Aggregate a screening report into headline counts."""
    if report.empty:
        return {"n_screened": 0, "n_usable": 0, "n_excluded": 0, "reasons": {}}
    excluded = report[~report["usable"]]
    reasons = (
        excluded["exclusion_reason"]
        .str.replace(r"\d+", "N", regex=True)
        .str.replace(r"N%", "N%", regex=True)
        .value_counts()
        .to_dict()
    )
    return {
        "n_screened": int(len(report)),
        "n_usable": int(report["usable"].sum()),
        "n_excluded": int(len(excluded)),
        "reasons": reasons,
    }
