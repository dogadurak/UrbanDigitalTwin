"""Per-building forecast accuracy metrics (ASHRAE Guideline 14).

Why per-building rather than pooled
-----------------------------------
A pooled RMSE over a portfolio is dominated by the largest consumers. In this
dataset mean consumption spans roughly 33 to 2048 kWh across buildings, so a
pooled metric mostly measures floor area. Sprint 1 quantified the consequence:
predicting each building's constant mean -- no model at all -- scores R2 =
0.8128 pooled on absolute kWh.

Computing the metric **within** each building and then aggregating across
buildings removes that scale dominance at the metric level, which is a cleaner
fix than reshaping the target. It also means the target can be chosen on
modelling grounds (log energy aligns with relative error) instead of being
forced to carry the normalisation job.

Definitions
-----------
For one building with actuals ``y`` and predictions ``yhat``:

    CV(RMSE) = 100 * sqrt(mean((y - yhat)^2)) / mean(y)
    NMBE     = 100 * mean(y - yhat) / mean(y)

CV(RMSE) is the dispersion of the error relative to the building's own mean;
NMBE is the signed bias. Guideline 14 pairs them deliberately: a model can have
excellent CV(RMSE) and still be systematically high or low, and a model with
near-zero NMBE can still be useless if its errors are large and cancelling.

Both are undefined when a building's mean is zero or negative, so those
buildings are reported as excluded rather than silently contributing NaN.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# A building whose mean is at or below this contributes no usable ratio metric.
MIN_MEAN_FOR_RATIO = 1e-9


def cv_rmse(y, yhat):
    """Coefficient of variation of the RMSE, in percent."""
    y = np.asarray(y, dtype="float64")
    yhat = np.asarray(yhat, dtype="float64")
    if y.size == 0:
        return np.nan
    mean_y = y.mean()
    if not np.isfinite(mean_y) or mean_y <= MIN_MEAN_FOR_RATIO:
        return np.nan
    rmse = np.sqrt(np.mean((y - yhat) ** 2))
    return 100.0 * rmse / mean_y


def nmbe(y, yhat):
    """Normalised mean bias error, in percent. Positive = under-prediction."""
    y = np.asarray(y, dtype="float64")
    yhat = np.asarray(yhat, dtype="float64")
    if y.size == 0:
        return np.nan
    mean_y = y.mean()
    if not np.isfinite(mean_y) or mean_y <= MIN_MEAN_FOR_RATIO:
        return np.nan
    return 100.0 * np.mean(y - yhat) / mean_y


def mae(y, yhat):
    y = np.asarray(y, dtype="float64")
    yhat = np.asarray(yhat, dtype="float64")
    return float(np.mean(np.abs(y - yhat))) if y.size else np.nan


def r2(y, yhat):
    y = np.asarray(y, dtype="float64")
    yhat = np.asarray(yhat, dtype="float64")
    if y.size == 0:
        return np.nan
    ss_tot = float(((y - y.mean()) ** 2).sum())
    if ss_tot == 0.0:
        return np.nan
    return float(1.0 - ((y - yhat) ** 2).sum() / ss_tot)


def per_building(y, yhat, building_ids, min_points=24):
    """Metrics computed inside each building.

    Returns one row per building. Buildings with fewer than ``min_points``
    predictions, or a non-positive mean, yield NaN ratio metrics and are
    flagged so aggregation can report how many were dropped.
    """
    df = pd.DataFrame(
        {
            "building_id": np.asarray(building_ids),
            "y": np.asarray(y, dtype="float64"),
            "yhat": np.asarray(yhat, dtype="float64"),
        }
    )
    rows = []
    for bid, g in df.groupby("building_id", sort=True):
        enough = len(g) >= min_points
        rows.append(
            {
                "building_id": bid,
                "n": int(len(g)),
                "mean_actual": float(g["y"].mean()),
                "cv_rmse": cv_rmse(g["y"], g["yhat"]) if enough else np.nan,
                "nmbe": nmbe(g["y"], g["yhat"]) if enough else np.nan,
                "mae": mae(g["y"], g["yhat"]) if enough else np.nan,
                "r2": r2(g["y"], g["yhat"]) if enough else np.nan,
            }
        )
    out = pd.DataFrame(rows)
    out["usable"] = out["cv_rmse"].notna()
    return out


def aggregate(per_building_df):
    """Aggregate per-building metrics into a fold-level summary.

    The median is reported alongside the mean because CV(RMSE) is right-skewed:
    a handful of near-zero-mean buildings can move the mean substantially while
    saying little about typical performance.
    """
    usable = per_building_df[per_building_df["usable"]]
    if usable.empty:
        return {
            "n_buildings": int(len(per_building_df)),
            "n_usable": 0,
            "n_excluded": int(len(per_building_df)),
            "cv_rmse_mean": np.nan,
            "cv_rmse_median": np.nan,
            "cv_rmse_std": np.nan,
            "nmbe_mean": np.nan,
            "nmbe_median": np.nan,
            "mae_mean": np.nan,
        }
    return {
        "n_buildings": int(len(per_building_df)),
        "n_usable": int(len(usable)),
        "n_excluded": int(len(per_building_df) - len(usable)),
        "cv_rmse_mean": float(usable["cv_rmse"].mean()),
        "cv_rmse_median": float(usable["cv_rmse"].median()),
        "cv_rmse_std": float(usable["cv_rmse"].std(ddof=1)) if len(usable) > 1 else np.nan,
        "nmbe_mean": float(usable["nmbe"].mean()),
        "nmbe_median": float(usable["nmbe"].median()),
        "mae_mean": float(usable["mae"].mean()),
    }
