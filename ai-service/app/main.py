from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import joblib
import os
import pandas as pd
import numpy as np
from app.fiware_client import publish_ai_insight
from tenacity import retry, wait_exponential, stop_after_attempt

app = FastAPI(title="GeoTwin AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load models at startup
iso_forest = None
xgboost_models = None

from app.spatial_api import router as spatial_router
app.include_router(spatial_router, prefix="/api")

@app.on_event("startup")
async def load_models():
    global iso_forest, xgboost_models, xgb_metadata, energy_buffer, residual_threshold
    iso_model_path = "app/models/saved/isolation_forest_spatial_v3.joblib"
    xgb_model_path = "app/models/saved/xgboost_spatial_v3_final.joblib"
    xgb_meta_path = "app/models/saved/model_metrics_v3.json"
    
    energy_buffer = {} # store historical energy readings per building
    residual_threshold = 100.0 # fallback
    
    if os.path.exists(iso_model_path):
        iso_forest = joblib.load(iso_model_path)
        print("Isolation Forest loaded.")
    else:
        print("Warning: Isolation Forest model not found.")
        
    if os.path.exists(xgb_model_path):
        xgboost_models = joblib.load(xgb_model_path)
        import json
        with open(xgb_meta_path, "r") as f:
            xgb_metadata = json.load(f)
            residual_threshold = xgb_metadata.get("threshold", {}).get("value", 121.64)
        print(f"XGBoost Spatial V3 model loaded. Threshold: {residual_threshold}")
    else:
        print("Warning: XGBoost V3 model not found.")
        xgb_metadata = None

import datetime
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
import logging

logger = logging.getLogger("ai_service")
logger.setLevel(logging.DEBUG)

@app.post("/notify")
async def fiware_notification(request: Request):
    payload = await request.json()
    logger.debug(f"DEBUG PAYLOAD: {payload}")
    data = payload.get("data", [])
    
    for entity in data:
        if entity.get("type") == "IoTDevice":
            await process_iot_device(entity)
            
    return {"status": "ok"}

async def process_iot_device(entity):
    global xgboost_models, iso_forest, xgb_metadata
    if xgboost_models is None or iso_forest is None:
        logger.warning("Models not loaded. Skipping IoTDevice processing.")
        return

    entity_id = entity.get("id", "")
    try:
        energy_val = float(entity.get("energy", {}).get("value", 0.0))
        if energy_val <= 0:
            return
            
        outdoor_temp = float(entity.get("airTemperature", {}).get("value", 20.0))
        dew_temp = float(entity.get("dewTemperature", {}).get("value", 10.0))
        wind_speed = float(entity.get("windSpeed", {}).get("value", 5.0))
        cloud_coverage = float(entity.get("cloudCoverage", {}).get("value", 0.0))
        
        date_observed = entity.get("dateObserved", {}).get("value")
        timestamp = date_observed if date_observed else datetime.datetime.utcnow().isoformat()
        
        ref_room = entity.get("refRoom", {}).get("object", "")
        # Assuming format 'urn:ngsi-ld:Building:Rat_office_Adele' or just the id
        building_id = ref_room.split(":")[-1] if ":" in ref_room else ref_room
        if not building_id.startswith("Rat_office"):
            building_id = "Rat_office_Adele" # Default to a known pilot building if missing
        
        req = AnomalyRequest(
            building_id=building_id,
            timestamp=timestamp,
            energy=energy_val,
            outdoor_temperature=outdoor_temp,
            dewTemperature=dew_temp,
            windSpeed=wind_speed,
            cloudCoverage=cloud_coverage
        )
        
        await check_anomaly_and_publish(req)
    except Exception as e:
        logger.error(f"Error parsing IoTDevice entity: {e}")

class AnomalyRequest(BaseModel):
    building_id: str
    timestamp: str
    energy: float
    outdoor_temperature: float
    dewTemperature: float
    windSpeed: float
    cloudCoverage: float = 0.0

class WhatIfRequest(BaseModel):
    building_id: str
    target_temperature: float
    target_ndvi: float
    target_building_density: float
    target_cloud_coverage: float = 0.0
    target_wind_speed: float = 5.0
    target_green_ratio: float = 0.2

DB_PARAMS = {
    'dbname': os.environ.get('DB_NAME', 'geotwin_db'),
    'user': os.environ.get('DB_USER', 'geotwin_user'),
    'password': os.environ.get('DB_PASS', 'geotwin_password'),
    'host': os.environ.get('POSTGRES_HOST', 'postgis'),
    'port': os.environ.get('POSTGRES_PORT', '5432')
}

@app.post("/api/detect-anomalies")
async def detect_anomalies(req: AnomalyRequest):
    return await check_anomaly_and_publish(req)

@app.post("/api/simulate-what-if")
async def simulate_what_if(req: WhatIfRequest):
    global xgboost_models, xgb_metadata
    if xgboost_models is None:
        return {"error": "Models not loaded"}
        
    try:
        spatial = get_spatial_features(req.building_id)
        
        # Get latest lags using a new retry function if needed, or just inline since simulate doesn't write
        conn = psycopg2.connect(**DB_PARAMS)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT energy_value FROM building_energy_history WHERE building_id = %s ORDER BY timestamp DESC LIMIT 169", (req.building_id,))
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        logger.error(f"DB Error in What-If: {e}")
        return {"error": "Database connection failed"}
        
    if not spatial:
        return {"error": f"Building spatial context not found for {req.building_id}"}
        
    hist = [r['energy_value'] for r in rows] if rows else [50.0]
    lag_1 = hist[0]
    lag_24 = hist[23] if len(hist) > 23 else lag_1
    lag_168 = hist[167] if len(hist) > 167 else lag_24
    roll_24 = sum(hist[:24]) / len(hist[:24]) if len(hist) > 0 else lag_1
    roll_168 = sum(hist[:168]) / len(hist[:168]) if len(hist) > 0 else roll_24
    
    dt = datetime.datetime.utcnow()
    
    feature_dict = {
        'outdoor_temperature': req.target_temperature,
        'cloudCoverage': req.target_cloud_coverage,
        'dewTemperature': req.target_temperature - 5.0, # Approximate dew
        'hour': dt.hour,
        'day_of_week': dt.weekday(),
        'month': dt.month,
        'is_weekend': int(dt.weekday() in [5, 6]),
        'windSpeed': req.target_wind_speed,
        'energy_lag_1': lag_1,
        'energy_lag_24': lag_24,
        'energy_lag_168': lag_168,
        'energy_rolling_mean_24': roll_24,
        'energy_rolling_mean_168': roll_168,
        'lat': float(spatial['lat']),
        'lon': float(spatial['lon']),
        'building_density': req.target_building_density,
        'ndvi_current': req.target_ndvi,
        'ndmi_current': float(spatial['ndmi_current']),
        'ndbi_current': float(spatial['ndbi_current']),
        'road_density': float(spatial['road_density']),
        'green_ratio': req.target_green_ratio,
        'elevation': float(spatial['elevation']),
        'slope': float(spatial['slope'])
    }
    
    cols = xgb_metadata['xgboost_v3']['features']
    df_features = pd.DataFrame([feature_dict])[cols]
    expected_energy = float(xgboost_models.predict(df_features)[0])
    
    return {
        "building_id": req.building_id,
        "simulated_energy": expected_energy,
        "applied_parameters": {
            "temperature": req.target_temperature,
            "ndvi": req.target_ndvi,
            "building_density": req.target_building_density,
            "green_ratio": req.target_green_ratio
        }
    }

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
def get_spatial_features(building_id):
    conn = psycopg2.connect(**DB_PARAMS)
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM spatial_features WHERE building_id = %s", (building_id,))
        return cur.fetchone()
    finally:
        conn.close()

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
def update_and_get_lags(building_id, energy, timestamp):
    conn = psycopg2.connect(**DB_PARAMS)
    try:
        conn.autocommit = True
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Insert current energy reading
        cur.execute(
            "INSERT INTO building_energy_history (building_id, timestamp, energy_value) VALUES (%s, %s, %s)",
            (building_id, timestamp, energy)
        )
        
        # Fetch recent history (up to 169 points to get lag 168 since index 0 is current)
        cur.execute(
            "SELECT energy_value FROM building_energy_history WHERE building_id = %s ORDER BY timestamp DESC LIMIT 169",
            (building_id,)
        )
        rows = cur.fetchall()
        
        # Rows are sorted DESC, so index 0 is the newest (the one we just inserted)
        hist = [r['energy_value'] for r in rows]
        
        lag_1 = hist[1] if len(hist) > 1 else energy
        lag_24 = hist[24] if len(hist) > 24 else lag_1
        lag_168 = hist[168] if len(hist) > 168 else lag_24
        
        # Calculate rolling means (excluding current reading to prevent data leakage in predictions, though here we just use what's available)
        hist_for_rolling = hist[1:25] if len(hist) > 1 else [energy]
        roll_24 = sum(hist_for_rolling) / len(hist_for_rolling)
        
        hist_for_rolling_168 = hist[1:169] if len(hist) > 1 else [energy]
        roll_168 = sum(hist_for_rolling_168) / len(hist_for_rolling_168)
        
        return lag_1, lag_24, lag_168, roll_24, roll_168
        
    except Exception as e:
        logger.error(f"Lag fetching DB error: {e}")
        raise
    finally:
        conn.close()

async def check_anomaly_and_publish(req: AnomalyRequest):
    global xgboost_models, iso_forest, xgb_metadata, residual_threshold
    if xgboost_models is None or iso_forest is None:
        return {"error": "Models not loaded"}
        
    try:
        spatial = get_spatial_features(req.building_id)
    except Exception as e:
        logger.error(f"DB Error: {e}")
        return {"error": "Database connection failed"}
    
    if not spatial:
        return {"error": f"Building spatial context not found for {req.building_id}"}
        
    dt = pd.to_datetime(req.timestamp)
    
    # Calculate dynamic lag features
    lag_1, lag_24, lag_168, roll_24, roll_168 = update_and_get_lags(req.building_id, req.energy, req.timestamp)
    
    # Build 17-feature vector
    feature_dict = {
        'outdoor_temperature': req.outdoor_temperature,
        'cloudCoverage': req.cloudCoverage,
        'dewTemperature': req.dewTemperature,
        'hour': dt.hour,
        'day_of_week': dt.dayofweek,
        'month': dt.month,
        'is_weekend': int(dt.dayofweek in [5, 6]),
        'windSpeed': req.windSpeed,
        'energy_lag_1': lag_1,
        'energy_lag_24': lag_24,
        'energy_lag_168': lag_168,
        'energy_rolling_mean_24': roll_24,
        'energy_rolling_mean_168': roll_168,
        'lat': float(spatial['lat']),
        'lon': float(spatial['lon']),
        'building_density': float(spatial['building_density']),
        'ndvi_current': float(spatial['ndvi_current']),
        'ndmi_current': float(spatial['ndmi_current']),
        'ndbi_current': float(spatial['ndbi_current']),
        'road_density': float(spatial['road_density']),
        'green_ratio': float(spatial['green_ratio']),
        'elevation': float(spatial['elevation']),
        'slope': float(spatial['slope'])
    }
    
    cols = xgb_metadata['xgboost_v3']['features']
    df_features = pd.DataFrame([feature_dict])[cols]
    
    expected_energy = float(xgboost_models.predict(df_features)[0])
    residual = abs(req.energy - expected_energy)
    
    # Anomaly Detection (Dual-method)
    X_if = np.column_stack([
        [residual],
        [req.outdoor_temperature],
        [dt.hour],
        [spatial['ndvi_current']],
        [spatial['ndbi_current']],
        [spatial['building_density']],
        [spatial['elevation']]
    ])
    
    iso_anomaly = int(iso_forest.predict(X_if)[0] == -1)
    threshold_anomaly = residual > residual_threshold
    
    is_anomaly = iso_anomaly or threshold_anomaly
    
    if is_anomaly:
        logger.warning(f"Anomaly detected for {req.building_id} | Expected: {expected_energy:.1f}, Actual: {req.energy:.1f}")
        
        diff = req.energy - expected_energy
        if diff > 0:
            possible_cause = f"Overconsumption ({req.energy:.1f} kWh > Expected {expected_energy:.1f} kWh). "
            if req.outdoor_temperature > 25 and spatial['green_ratio'] < 0.2:
                possible_cause += f"Urban heat island effect exacerbated by low greenery (Ratio: {spatial['green_ratio']:.2f})."
            elif req.outdoor_temperature < 15 and spatial['elevation'] > 100:
                possible_cause += f"High elevation ({spatial['elevation']}m) causing excessive heating loads."
            else:
                possible_cause += "Energy spike unaccounted for by spatial context."
        else:
            possible_cause = f"Underconsumption ({req.energy:.1f} kWh < Expected {expected_energy:.1f} kWh). "
            possible_cause += "System outage or irregular operational schedule detected."
        
        publish_ai_insight(
            target_room_id=f"urn:ngsi-ld:Building:{req.building_id}",
            insight_type="SpatialEnergyAnomaly",
            severity="HIGH" if residual > (residual_threshold * 1.5) else "WARNING",
            anomaly_score=residual,
            observed_value=req.energy,
            expected_value=expected_energy,
            possible_cause=possible_cause,
            model_name="XGBoost-Spatial-v3",
            model_version="3.0.0"
        )
        
    return {
        "building_id": req.building_id,
        "expected_energy": expected_energy,
        "actual_energy": req.energy,
        "residual": residual,
        "is_anomaly": bool(is_anomaly)
    }

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
