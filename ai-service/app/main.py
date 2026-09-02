"""Building Energy Intelligence — model serving API.

Serves the cold-start energy model: given a building's real attributes, the
calendar and the weather, predict its hourly electricity demand. The model is
deliberately **lag-free**, because the case worth serving is a building with no
meter history -- once you have last hour's reading, persistence alone explains a
median 88% of the variance and a model adds little.

What this service does *not* do, and why:

* No spatial or remote-sensing feature. BDG2 publishes coordinates "to city
  level" with every building inside a 40 km radius of a site centroid
  (Miller et al. 2020), so an NDVI or LST value sampled there would describe an
  arbitrary point, not the building. An earlier version of this service fed the
  model hand-authored NDVI/NDBI/elevation constants and raw latitude/longitude;
  those are archived in ``archive/legacy_v3/`` and are not served.
* No claim of accuracy beyond what was measured out of sample. The metrics this
  service reports come from held-out folds of the evaluation harness, not from
  the training set.
"""

from __future__ import annotations

import datetime
import json
import logging
import os

import joblib
import numpy as np
import pandas as pd
import psycopg2
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from tenacity import retry, stop_after_attempt, wait_exponential

from app.fiware_client import publish_ai_insight
from app.spatial_api import router as spatial_router
from app.results_api import router as results_router
from app.explore_api import router as explore_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_service")

app = FastAPI(
    title="Building Energy Intelligence — API",
    description="Cold-start building energy prediction on Building Data Genome 2.",
    version="4.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(spatial_router, prefix="/api")
app.include_router(results_router, prefix="/api")
app.include_router(explore_router, prefix="/api")

MODEL_DIR = "app/models/saved"
MODEL_PATH = os.path.join(MODEL_DIR, "energy_cold_start.joblib")
META_PATH = os.path.join(MODEL_DIR, "energy_cold_start_metadata.json")

BALANCE_POINT_C = 18.0

DB_PARAMS = {
    "dbname": os.environ.get("DB_NAME", "geotwin_db"),
    "user": os.environ.get("DB_USER", "geotwin_user"),
    "password": os.environ.get("DB_PASS", "geotwin_password"),
    "host": os.environ.get("POSTGRES_HOST", "postgis"),
    "port": os.environ.get("POSTGRES_PORT", "5432"),
}

MODEL = None
META = None


@app.on_event("startup")
async def load_model():
    global MODEL, META
    if os.path.exists(MODEL_PATH) and os.path.exists(META_PATH):
        MODEL = joblib.load(MODEL_PATH)
        with open(META_PATH, "r", encoding="utf-8") as fh:
            META = json.load(fh)
        logger.info(
            "loaded %s (%s), trained on %s buildings",
            META.get("model_name"), META.get("spec"), META.get("n_train_buildings"),
        )
    else:
        logger.warning(
            "no production model at %s -- run "
            "`python -m app.experiments.train_production`", MODEL_PATH,
        )


# --------------------------------------------------------------------------
# Requests
# --------------------------------------------------------------------------

class PredictRequest(BaseModel):
    building_id: str
    timestamp: str
    airTemperature: float
    dewTemperature: float = None
    windSpeed: float = 3.0
    cloudCoverage: float = 0.0


class AnomalyRequest(PredictRequest):
    energy: float


class WhatIfRequest(BaseModel):
    building_id: str
    timestamp: str = None
    airTemperature: float
    baseline_airTemperature: float = None
    windSpeed: float = 3.0
    cloudCoverage: float = 0.0


# --------------------------------------------------------------------------
# Data access
# --------------------------------------------------------------------------

@retry(wait=wait_exponential(multiplier=1, min=1, max=8), stop=stop_after_attempt(3))
def get_building(building_id):
    db_url = os.environ.get("DATABASE_URL")
    conn = psycopg2.connect(db_url) if db_url else psycopg2.connect(**DB_PARAMS)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT building_id, site_id, spatial_block, primaryspaceusage, sqm, "
                "yearbuilt, numberoffloors, site_lat, site_lng, coord_status, "
                "geo_usable, meter_usable FROM bdg2_buildings WHERE building_id = %s",
                (building_id,),
            )
            return cur.fetchone()
    finally:
        conn.close()


def _require_model():
    if MODEL is None or META is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "No production model is loaded. Build the dataset, then run "
                "`python -m app.experiments.train_production`."
            ),
        )


def _require_building(building_id):
    b = get_building(building_id)
    if b is None:
        raise HTTPException(
            status_code=404,
            detail="Unknown building '{}'. See GET /api/buildings.".format(building_id),
        )
    if b["sqm"] is None or b["sqm"] <= 0:
        raise HTTPException(
            status_code=422,
            detail="Building '{}' has no usable floor area in BDG2 metadata, so "
                   "the model cannot be applied.".format(building_id),
        )
    return b


def build_features(building, when, weather):
    """Assemble one design row in exactly the trained column order."""
    dew = weather.get("dewTemperature")
    if dew is None:
        dew = weather["airTemperature"] - 5.0
    t = float(weather["airTemperature"])

    row = {
        "hour": when.hour,
        "day_of_week": when.weekday(),
        "month": when.month,
        "is_weekend": int(when.weekday() >= 5),
        "airTemperature": t,
        "dewTemperature": float(dew),
        "windSpeed": float(weather.get("windSpeed", 3.0)),
        "cloudCoverage": float(weather.get("cloudCoverage", 0.0)),
        "cdh": max(t - BALANCE_POINT_C, 0.0),
        "hdh": max(BALANCE_POINT_C - t, 0.0),
        "log_sqm": float(np.log(building["sqm"])),
        "building_age": (2017.0 - building["yearbuilt"]) if building["yearbuilt"] else np.nan,
        "numberoffloors": float(building["numberoffloors"]) if building["numberoffloors"] else np.nan,
    }

    columns = META["feature_columns"]
    data = {}
    for col in columns:
        if col in row:
            data[col] = row[col]
        elif "=" in col:
            field, value = col.split("=", 1)
            data[col] = 1.0 if str(building.get(field)) == value else 0.0
        else:
            data[col] = np.nan
    return pd.DataFrame([data], columns=columns).astype("float32")


def predict_kwh(building, when, weather):
    X = build_features(building, when, weather)
    return float(np.expm1(MODEL.predict(X)[0]))


def _validated_cv_rmse():
    """Held-out CV(RMSE) for the strictest protocol available."""
    metrics = (META or {}).get("held_out_metrics") or {}
    for protocol in ("leave_block_out", "leave_buildings_out", "temporal", "random"):
        if protocol in metrics and metrics[protocol].get("cv_rmse_median_pct"):
            return metrics[protocol]["cv_rmse_median_pct"], protocol
    return None, None


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------

@app.get("/api/health")
def health():
    cv, protocol = _validated_cv_rmse()
    return {
        "status": "ok",
        "model_loaded": MODEL is not None,
        "model": (META or {}).get("model_name"),
        "spec": (META or {}).get("spec"),
        "trained_on_buildings": (META or {}).get("n_train_buildings"),
        "validated_cv_rmse_pct": cv,
        "validated_under": protocol,
        "uses_spatial_features": False,
        "spatial_note": (
            "BDG2 coordinates are city-level with a 40 km bound, so no remote "
            "sensing feature can be attributed to a building."
        ),
    }


@app.get("/api/buildings")
def list_buildings(site_id: str = None, limit: int = 100, usable_only: bool = True):
    db_url = os.environ.get("DATABASE_URL")
    conn = psycopg2.connect(db_url) if db_url else psycopg2.connect(**DB_PARAMS)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            sql = ("SELECT building_id, site_id, spatial_block, primaryspaceusage, "
                   "sqm, yearbuilt, site_lat, site_lng, coord_status, meter_usable "
                   "FROM bdg2_buildings WHERE TRUE")
            params = []
            if usable_only:
                sql += " AND meter_usable"
            if site_id:
                sql += " AND site_id = %s"
                params.append(site_id)
            sql += " ORDER BY building_id LIMIT %s"
            params.append(limit)
            cur.execute(sql, tuple(params))
            return {"buildings": cur.fetchall()}
    finally:
        conn.close()


@app.post("/api/predict")
def predict(req: PredictRequest):
    _require_model()
    building = _require_building(req.building_id)
    when = pd.to_datetime(req.timestamp)
    expected = predict_kwh(building, when, req.model_dump())
    cv, protocol = _validated_cv_rmse()

    band = None
    if cv:
        margin = expected * cv / 100.0
        band = {"lo": round(max(expected - margin, 0.0), 2), "hi": round(expected + margin, 2)}

    return {
        "building_id": req.building_id,
        "timestamp": req.timestamp,
        "expected_energy_kwh": round(expected, 2),
        "expected_band_1cvrmse": band,
        "band_basis": {"cv_rmse_pct": cv, "protocol": protocol},
        "building": {
            "site_id": building["site_id"],
            "use": building["primaryspaceusage"],
            "sqm": building["sqm"],
            "yearbuilt": building["yearbuilt"],
        },
    }


@app.post("/api/detect-anomalies")
def detect_anomaly(req: AnomalyRequest):
    _require_model()
    building = _require_building(req.building_id)
    when = pd.to_datetime(req.timestamp)
    expected = predict_kwh(building, when, req.model_dump())

    residual = req.energy - expected
    cv, protocol = _validated_cv_rmse()
    if not cv or expected <= 0:
        raise HTTPException(
            status_code=503,
            detail="No validated error band available; cannot judge an anomaly "
                   "without one. Run the evaluation harness first.",
        )

    # The band is the model's own demonstrated out-of-sample error. Anything
    # inside it is indistinguishable from ordinary model error.
    z = abs(residual) / (expected * cv / 100.0)
    severity = "HIGH" if z >= 3.0 else "WARNING" if z >= 2.0 else None
    is_anomaly = severity is not None

    direction = "over" if residual > 0 else "under"
    explanation = (
        "Observed {:.1f} kWh against an expected {:.1f} kWh: {:.1f}x the model's "
        "validated {:.1f}% CV(RMSE) band ({}). This is a deviation from a "
        "calendar/weather/attribute baseline, not a diagnosis of cause."
    ).format(req.energy, expected, z, cv, protocol) if is_anomaly else None

    if is_anomaly:
        try:
            publish_ai_insight(
                target_room_id="urn:ngsi-ld:Building:{}".format(req.building_id),
                insight_type="EnergyDeviation",
                severity=severity,
                anomaly_score=float(z),
                observed_value=float(req.energy),
                expected_value=float(expected),
                possible_cause="{}-consumption. {}".format(direction.title(), explanation),
                model_name=META.get("model_name", "energy_cold_start"),
                model_version=str(META.get("git_sha", ""))[:8],
            )
        except Exception as exc:  # publishing must not break detection
            logger.warning("FIWARE publish failed: %s", exc)

    return {
        "building_id": req.building_id,
        "timestamp": req.timestamp,
        "observed_energy_kwh": req.energy,
        "expected_energy_kwh": round(expected, 2),
        "residual_kwh": round(residual, 2),
        "z_vs_validated_band": round(z, 2),
        "is_anomaly": is_anomaly,
        "severity": severity,
        "explanation": explanation,
    }


@app.post("/api/simulate-what-if")
def simulate_what_if(req: WhatIfRequest):
    """Weather sensitivity: how the predicted load moves with temperature.

    Only variables the model actually uses are exposed. Earlier versions offered
    NDVI and building-density sliders driving fabricated inputs; those are gone.
    """
    _require_model()
    building = _require_building(req.building_id)
    when = pd.to_datetime(req.timestamp) if req.timestamp else datetime.datetime.utcnow()

    baseline_t = req.baseline_airTemperature
    if baseline_t is None:
        baseline_t = req.airTemperature - 5.0

    common = {"windSpeed": req.windSpeed, "cloudCoverage": req.cloudCoverage}
    baseline = predict_kwh(building, when, dict(common, airTemperature=baseline_t))
    scenario = predict_kwh(building, when, dict(common, airTemperature=req.airTemperature))

    return {
        "building_id": req.building_id,
        "timestamp": when.isoformat(),
        "baseline": {"airTemperature": baseline_t, "expected_energy_kwh": round(baseline, 2)},
        "scenario": {"airTemperature": req.airTemperature, "expected_energy_kwh": round(scenario, 2)},
        "delta_kwh": round(scenario - baseline, 2),
        "delta_pct": round(100.0 * (scenario - baseline) / baseline, 2) if baseline > 0 else None,
        "note": "Weather sensitivity only. The model uses no spatial or "
                "remote-sensing input; see GET /api/health.",
    }


@app.post("/notify")
async def fiware_notification(request: Request):
    """FIWARE NGSI-LD subscription sink."""
    payload = await request.json()
    handled = 0
    for entity in payload.get("data", []):
        if entity.get("type") != "IoTDevice":
            continue
        try:
            energy = float(entity.get("energy", {}).get("value", 0.0))
            if energy <= 0:
                continue
            ref = entity.get("refRoom", {}).get("object", "")
            building_id = ref.split(":")[-1] if ":" in ref else ref
            if not building_id or get_building(building_id) is None:
                logger.info("notify: skipping unknown building '%s'", building_id)
                continue
            detect_anomaly(AnomalyRequest(
                building_id=building_id,
                timestamp=entity.get("dateObserved", {}).get("value")
                or datetime.datetime.utcnow().isoformat(),
                energy=energy,
                airTemperature=float(entity.get("airTemperature", {}).get("value", 20.0)),
                dewTemperature=float(entity.get("dewTemperature", {}).get("value", 10.0)),
                windSpeed=float(entity.get("windSpeed", {}).get("value", 3.0)),
                cloudCoverage=float(entity.get("cloudCoverage", {}).get("value", 0.0)),
            ))
            handled += 1
        except Exception as exc:
            logger.error("notify: %s", exc)
    return {"status": "ok", "handled": handled}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
