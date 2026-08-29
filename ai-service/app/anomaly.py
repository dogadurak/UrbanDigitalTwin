"""When did a building behave abnormally, and how much did it cost?

Screening asks which buildings to look at. This asks *when* a given building
went wrong, which is a different question and needs a different baseline.

Method: the whole-building baseline approach of IPMVP Option C and ASHRAE
Guideline 14. A model is fitted to the building's own **baseline period**
(2016) from calendar and weather alone, then applied to the **reporting
period** (2017). What the building did in 2016 defines normal for that
building; deviations in 2017 are measured against it.

Why the building's own history rather than the portfolio model
--------------------------------------------------------------
The cold-start model predicts an unmetered building from its attributes and
runs at 40-60% CV(RMSE). That is fine for ranking a portfolio and useless for
spotting a fault in one building: almost nothing would exceed such a wide band.
A per-building baseline typically fits far tighter, because it only has to
describe one building's own habits, and the residual band comes from the fit
itself rather than from an assumption.

Isolated hours are not events
-----------------------------
A single hour above the band is noise; a fault is a run of them. Flagged hours
are grouped into events with a minimum duration, and each event is reported with
its excess energy, so an operator sees "three days of elevated overnight load
costing 4 MWh" rather than 74 disconnected alarms.

What this does not do
---------------------
It has no labels to learn from and makes no claim to find every fault. A
deviation is a deviation: a genuine equipment fault, a change of occupancy, a
new tenant, a renovation and a meter problem all look the same here. The output
names when the building stopped resembling its own past, and the excess that
implies.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

ENERGY_ROOT = os.path.join("data", "processed", "energy")

BALANCE_POINT_C = 18.0
BASELINE_YEAR = 2016
REPORT_YEAR = 2017

#: Residual must exceed this multiple of the baseline's own RMSE to count.
SIGMA_THRESHOLD = 3.0

#: ...and persist at least this many hours, so single-hour noise is not an event.
MIN_EVENT_HOURS = 4

#: Hours of gap tolerated inside one event before it is split in two.
MAX_GAP_HOURS = 2

FEATURES = ["hour", "day_of_week", "month", "is_weekend",
            "airTemperature", "dewTemperature", "cdh", "hdh"]


def _prepare(site_id, building_id):
    path = os.path.join(ENERGY_ROOT, "site_id={}".format(site_id), "part.parquet")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    cols = ["building_id", "timestamp", "meter_reading", "hour", "day_of_week",
            "month", "is_weekend", "year", "airTemperature", "dewTemperature", "sqm"]
    df = pd.read_parquet(path, columns=cols)
    df = df[df["building_id"] == building_id].sort_values("timestamp")
    if df.empty:
        return None
    t = df["airTemperature"].astype("float64")
    df = df.assign(cdh=(t - BALANCE_POINT_C).clip(lower=0.0),
                   hdh=(BALANCE_POINT_C - t).clip(lower=0.0))
    return df.dropna(subset=["airTemperature", "dewTemperature", "meter_reading"])


def _fit_baseline(train, seed=0):
    import xgboost as xgb

    model = xgb.XGBRegressor(
        n_estimators=300, max_depth=5, learning_rate=0.05,
        subsample=0.9, colsample_bytree=0.9, tree_method="hist",
        random_state=seed, n_jobs=2, verbosity=0,
    )
    model.fit(train[FEATURES], train["meter_reading"].to_numpy(dtype="float64"))
    return model


def _group_events(flagged_idx, timestamps, max_gap=MAX_GAP_HOURS):
    """Collapse flagged hours into contiguous runs, tolerating small gaps."""
    if len(flagged_idx) == 0:
        return []
    events, start, prev = [], flagged_idx[0], flagged_idx[0]
    for i in flagged_idx[1:]:
        # Positions are row indices into a time-sorted frame.
        if i - prev > max_gap + 1:
            events.append((start, prev))
            start = i
        prev = i
    events.append((start, prev))
    return events


def scan(site_id, building_id, sigma=SIGMA_THRESHOLD, min_hours=MIN_EVENT_HOURS):
    """Fit a baseline on 2016, score 2017, return deviation events."""
    df = _prepare(site_id, building_id)
    if df is None:
        return None

    train = df[df["year"] == BASELINE_YEAR]
    test = df[df["year"] == REPORT_YEAR].reset_index(drop=True)
    if len(train) < 2000 or len(test) < 500:
        return {
            "building_id": building_id,
            "available": False,
            "reason": "needs a full baseline year and a reporting year; have {} and {} hours".format(
                len(train), len(test)),
        }

    model = _fit_baseline(train)

    # Baseline quality, measured on the baseline period itself. This is the
    # noise floor: deviations smaller than the baseline's own error mean nothing.
    train_pred = model.predict(train[FEATURES])
    train_resid = train["meter_reading"].to_numpy(dtype="float64") - train_pred
    rmse = float(np.sqrt(np.mean(train_resid ** 2)))
    mean_actual = float(train["meter_reading"].mean())
    baseline_cv_rmse = 100.0 * rmse / mean_actual if mean_actual > 0 else np.nan

    pred = model.predict(test[FEATURES])
    actual = test["meter_reading"].to_numpy(dtype="float64")
    raw_resid = actual - pred

    # --- separate a level shift from transient events ---------------------
    #
    # A building whose consumption steps up between the baseline and reporting
    # periods produces a residual that is biased all year, and a naive scan
    # returns one "event" thousands of hours long. That is not a fault, it is a
    # changed building: IPMVP calls it a non-routine adjustment, and the
    # baseline is supposed to be corrected for it rather than the whole year
    # being counted as deviation.
    #
    # The median residual estimates that shift robustly. Events are then
    # detected on the de-levelled residual, so a step change is reported once,
    # as itself, instead of drowning everything else.
    level_shift = float(np.median(raw_resid))
    level_shift_pct = 100.0 * level_shift / mean_actual if mean_actual > 0 else np.nan
    level_shift_material = abs(level_shift) > rmse

    resid = raw_resid - level_shift

    # --- does the baseline still describe the building at all? ------------
    #
    # A baseline year only defines "normal" if the building still behaves that
    # way. When it does not -- a refurbishment, a change of use, a new tenant,
    # a re-metering -- the model is wrong everywhere and listing thousands of
    # "event" hours would be an artefact of a broken baseline, not a finding.
    #
    # ASHRAE Guideline 14 already supplies the test: a model whose CV(RMSE) on
    # the reporting period exceeds the 30% hourly criterion is not fit for
    # whole-building M&V. We apply it as a gate and say so rather than
    # reporting events from a baseline that does not hold.
    report_rmse = float(np.sqrt(np.mean(resid ** 2)))
    report_cv_rmse = 100.0 * report_rmse / mean_actual if mean_actual > 0 else np.nan
    baseline_transfers = bool(np.isfinite(report_cv_rmse) and report_cv_rmse <= 30.0)

    threshold = sigma * rmse
    flagged = np.flatnonzero(np.abs(resid) > threshold) if baseline_transfers else np.array([], dtype=int)

    events = []
    for start, end in _group_events(flagged, test["timestamp"]):
        n = end - start + 1
        if n < min_hours:
            continue
        seg = slice(start, end + 1)
        excess = float(resid[seg].sum())
        events.append({
            "start": test["timestamp"].iloc[start].isoformat(),
            "end": test["timestamp"].iloc[end].isoformat(),
            "hours": int(n),
            "direction": "over" if excess > 0 else "under",
            "excess_kwh": round(abs(excess), 1),
            "peak_sigma": round(float(np.max(np.abs(resid[seg])) / rmse), 1),
            "mean_actual_kwh": round(float(actual[seg].mean()), 1),
            "mean_expected_kwh": round(float(pred[seg].mean()), 1),
        })

    events.sort(key=lambda e: e["excess_kwh"], reverse=True)
    over = [e for e in events if e["direction"] == "over"]
    under = [e for e in events if e["direction"] == "under"]

    return {
        "building_id": building_id,
        "site_id": site_id,
        "available": True,
        "baseline": {
            "period": BASELINE_YEAR,
            "n_hours": int(len(train)),
            "cv_rmse_pct": round(baseline_cv_rmse, 1),
            "rmse_kwh": round(rmse, 1),
            "note": "Fitted on this building's own {} data from calendar and "
                    "weather only, per IPMVP Option C / ASHRAE Guideline 14. "
                    "Its error is the noise floor: smaller deviations mean "
                    "nothing.".format(BASELINE_YEAR),
            "meets_g14_hourly": bool(baseline_cv_rmse <= 30.0),
        },
        "reporting": {
            "period": REPORT_YEAR,
            "n_hours": int(len(test)),
            "cv_rmse_pct": round(report_cv_rmse, 1),
            "baseline_transfers": baseline_transfers,
            "note": (
                "The baseline describes the reporting year well enough for "
                "event detection (CV(RMSE) within Guideline 14's 30% hourly "
                "criterion)." if baseline_transfers else
                "The {} baseline does NOT describe {} -- reporting-period "
                "CV(RMSE) of {:.1f}% exceeds Guideline 14's 30% hourly "
                "criterion. The building has changed structurally, so no events "
                "are listed: they would be artefacts of a broken baseline. "
                "Re-baseline on recent data before scanning.".format(
                    BASELINE_YEAR, REPORT_YEAR, report_cv_rmse)
            ),
        },
        "level_shift": {
            "kwh_per_hour": round(level_shift, 1),
            "pct_of_baseline_mean": round(level_shift_pct, 1),
            "material": bool(level_shift_material),
            "note": (
                "Median residual over the reporting year: how far the building's "
                "whole level moved between periods. A material shift is a changed "
                "building, not a fault -- IPMVP treats it as a non-routine "
                "adjustment and corrects the baseline. Events below are detected "
                "after removing it, so a step change is reported once as itself "
                "rather than flagging most of the year."
            ),
        },
        "detection": {
            "sigma": sigma,
            "threshold_kwh": round(threshold, 1),
            "min_event_hours": min_hours,
            "n_flagged_hours": int(len(flagged)),
            "flagged_hour_share": round(float(len(flagged) / len(test)), 4),
        },
        "summary": {
            "level_shift_pct": round(level_shift_pct, 1),
            "n_events": len(events),
            "n_over": len(over),
            "n_under": len(under),
            "total_excess_kwh": round(sum(e["excess_kwh"] for e in over), 1),
            "total_shortfall_kwh": round(sum(e["excess_kwh"] for e in under), 1),
            "longest_event_hours": max((e["hours"] for e in events), default=0),
        },
        "events": events[:25],
        "caveat": (
            "A deviation is a deviation. An equipment fault, a change of "
            "occupancy, a new tenant, a renovation and a meter problem all look "
            "the same here; the scan says when the building stopped resembling "
            "its own past, not why."
        ),
    }
