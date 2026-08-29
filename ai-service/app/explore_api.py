"""Endpoints that expose the measured data behind the results.

Everything here reads the BDG2 parquet partitions or the model. Nothing is
generated for display: if a building has no readings for a period, the response
says so instead of interpolating something plausible.

The point of these endpoints is that a claim on the dashboard can always be
opened up. "The model reaches 9.3% CV(RMSE)" is a number; a building's measured
2017 load curve with the prediction drawn over it is the evidence for it.
"""

from __future__ import annotations

import os

import joblib
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

router = APIRouter()

PROCESSED = os.path.join("data", "processed")
ENERGY_ROOT = os.path.join(PROCESSED, "energy")

_CACHE = {}


def _partition_path(site_id):
    return os.path.join(ENERGY_ROOT, "site_id={}".format(site_id), "part.parquet")


def _load_site(site_id, columns=None):
    key = (site_id, tuple(columns) if columns else None)
    if key in _CACHE:
        return _CACHE[key]
    path = _partition_path(site_id)
    if not os.path.exists(path):
        raise HTTPException(
            status_code=404,
            detail="No data partition for site '{}'. Run build_dataset.".format(site_id),
        )
    df = pd.read_parquet(path, columns=columns)
    # Keep only a few sites hot; the full dataset does not fit in the container.
    if len(_CACHE) > 3:
        _CACHE.clear()
    _CACHE[key] = df
    return df


def _site_of(building_id):
    from app.main import get_building

    b = get_building(building_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Unknown building '{}'".format(building_id))
    return b


@router.get("/explore/building/{building_id}/profile")
def building_profile(building_id: str, year: int = 2017):
    """A building's measured load: average day, average week, monthly totals.

    Averages are over the real hourly series for the requested year, which is
    the held-out year -- so the model's prediction over the same hours is a
    genuine out-of-sample comparison rather than a fit being replayed.
    """
    b = _site_of(building_id)
    cols = ["building_id", "timestamp", "meter_reading", "hour", "day_of_week",
            "month", "year", "airTemperature", "dewTemperature", "windSpeed",
            "cloudCoverage", "sqm", "primaryspaceusage", "yearbuilt", "numberoffloors"]
    df = _load_site(b["site_id"], cols)
    df = df[(df["building_id"] == building_id) & (df["year"] == year)]
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail="No {} readings for '{}'.".format(year, building_id),
        )

    # --- model prediction over the same hours -----------------------------
    predicted = None
    try:
        from app import main as M
        from app.experiments import ladder as L

        if M.MODEL is not None and M.META is not None:
            feat = L.add_derived(df.assign(sqm=df["sqm"]))
            rows = []
            for col in M.META["feature_columns"]:
                if col in feat.columns:
                    rows.append(feat[col].astype("float32").rename(col))
                elif "=" in col:
                    field, value = col.split("=", 1)
                    rows.append((feat[field].astype(str) == value).astype("float32").rename(col))
                else:
                    rows.append(pd.Series(np.nan, index=feat.index, name=col, dtype="float32"))
            X = pd.concat(rows, axis=1)
            predicted = np.expm1(M.MODEL.predict(X))
    except Exception:
        predicted = None

    df = df.copy()
    if predicted is not None:
        df["predicted"] = predicted

    def agg(by):
        g = df.groupby(by).agg(
            measured=("meter_reading", "mean"),
            n=("meter_reading", "size"),
        )
        if "predicted" in df.columns:
            g["predicted"] = df.groupby(by)["predicted"].mean()
        return g.reset_index()

    daily = agg("hour")
    weekly = agg("day_of_week")
    monthly = agg("month")

    measured_total = float(df["meter_reading"].sum())
    out = {
        "building_id": building_id,
        "year": year,
        "site_id": b["site_id"],
        "attributes": {
            "use": b["primaryspaceusage"],
            "sqm": b["sqm"],
            "yearbuilt": b["yearbuilt"],
            "numberoffloors": b["numberoffloors"],
        },
        "n_hours": int(len(df)),
        "measured": {
            "mean_kwh": round(float(df["meter_reading"].mean()), 2),
            "total_kwh": round(measured_total, 1),
            "eui_wh_m2_h": round(float(df["meter_reading"].mean()) * 1000.0 / b["sqm"], 2)
            if b["sqm"] else None,
        },
        "by_hour": daily.round(2).to_dict(orient="records"),
        "by_weekday": weekly.round(2).to_dict(orient="records"),
        "by_month": monthly.round(2).to_dict(orient="records"),
        "has_prediction": "predicted" in df.columns,
    }

    if "predicted" in df.columns:
        resid = df["meter_reading"] - df["predicted"]
        mean_actual = float(df["meter_reading"].mean())
        out["model"] = {
            "predicted_total_kwh": round(float(df["predicted"].sum()), 1),
            "cv_rmse_pct": round(100.0 * float(np.sqrt((resid ** 2).mean())) / mean_actual, 1)
            if mean_actual > 0 else None,
            "nmbe_pct": round(100.0 * float(resid.mean()) / mean_actual, 1)
            if mean_actual > 0 else None,
            "note": "Prediction is lag-free (cold start): the model is given no "
                    "past reading for this building.",
        }
    return out


@router.get("/explore/site/{site_id}/summary")
def site_summary(site_id: str, year: int = 2017):
    """What a site's portfolio actually contains: use mix, sizes, measured EUI."""
    cols = ["building_id", "meter_reading", "sqm", "primaryspaceusage", "yearbuilt", "year"]
    df = _load_site(site_id, cols)
    df = df[df["year"] == year]
    if df.empty:
        raise HTTPException(status_code=404, detail="No {} data for site '{}'".format(year, site_id))

    per_b = df.groupby("building_id").agg(
        mean_kwh=("meter_reading", "mean"),
        sqm=("sqm", "first"),
        use=("primaryspaceusage", "first"),
        yearbuilt=("yearbuilt", "first"),
    )
    per_b["eui"] = per_b["mean_kwh"] * 1000.0 / per_b["sqm"]

    by_use = (
        per_b.groupby("use")
        .agg(n=("eui", "size"), median_eui=("eui", "median"), median_sqm=("sqm", "median"))
        .sort_values("n", ascending=False)
        .round(2)
        .reset_index()
    )

    return {
        "site_id": site_id,
        "year": year,
        "n_buildings": int(len(per_b)),
        "total_floor_area_m2": round(float(per_b["sqm"].sum())),
        "median_sqm": round(float(per_b["sqm"].median())),
        "median_eui_wh_m2_h": round(float(per_b["eui"].median()), 2),
        "oldest_building": int(per_b["yearbuilt"].min()) if per_b["yearbuilt"].notna().any() else None,
        "by_use": by_use.to_dict(orient="records"),
        "top_consumers": per_b.nlargest(5, "mean_kwh").round(1).reset_index()
            .rename(columns={"mean_kwh": "mean_kwh"}).to_dict(orient="records"),
    }


@router.get("/explore/eui-by-use")
def eui_by_use(year: int = 2017, min_buildings: int = 10):
    """Measured energy intensity by building use, across every site.

    This is the gradient that makes building attributes work: a 12x spread from
    parking structures to healthcare, ordered the way building physics predicts.
    """
    path = os.path.join(PROCESSED, "eui_by_use.parquet")
    if os.path.exists(path):
        table = pd.read_parquet(path)
    else:
        frames = []
        for entry in sorted(os.listdir(ENERGY_ROOT)):
            if not entry.startswith("site_id="):
                continue
            df = pd.read_parquet(
                os.path.join(ENERGY_ROOT, entry, "part.parquet"),
                columns=["building_id", "meter_reading", "sqm", "primaryspaceusage", "year"],
            )
            df = df[df["year"] == year]
            if df.empty:
                continue
            g = df.groupby("building_id").agg(
                mean_kwh=("meter_reading", "mean"),
                sqm=("sqm", "first"),
                use=("primaryspaceusage", "first"),
            )
            frames.append(g)
        if not frames:
            raise HTTPException(status_code=404, detail="No dataset partitions found.")
        per_b = pd.concat(frames)
        per_b["eui"] = per_b["mean_kwh"] * 1000.0 / per_b["sqm"]
        table = (
            per_b.groupby("use")
            .agg(n=("eui", "size"), median_eui=("eui", "median"),
                 p25=("eui", lambda s: s.quantile(0.25)), p75=("eui", lambda s: s.quantile(0.75)))
            .reset_index()
        )
        table.to_parquet(path, index=False)

    table = table[table["n"] >= min_buildings].sort_values("median_eui")
    return {
        "year": year,
        "unit": "Wh/m2/h",
        "uses": table.round(2).to_dict(orient="records"),
        "note": "Measured, not modelled. This spread is why building attributes "
                "outperform location by 7.7x in the cold-start task.",
    }
