from fastapi import FastAPI, Request
import uvicorn
import joblib
import os
import pandas as pd
import numpy as np
from app.fiware_client import publish_ai_insight

app = FastAPI(title="GeoTwin AI Service")

# Load models at startup
iso_forest = None
xgboost_models = None

from app.spatial_api import router as spatial_router
app.include_router(spatial_router, prefix="/api")

@app.on_event("startup")
async def load_models():
    global iso_forest, xgboost_models, xgb_metadata
    iso_model_path = "app/models/saved/isolation_forest_spatial_v3.joblib"
    xgb_model_path = "app/models/saved/xgboost_spatial_v3.json"
    xgb_meta_path = "app/models/saved/metadata_spatial_v3.json"
    
    if os.path.exists(iso_model_path):
        iso_forest = joblib.load(iso_model_path)
        print("Isolation Forest loaded.")
    else:
        print("Warning: Isolation Forest model not found.")
        
    if os.path.exists(xgb_model_path):
        import xgboost as xgb
        xgboost_models = xgb.Booster()
        xgboost_models.load_model(xgb_model_path)
        import json
        with open(xgb_meta_path, "r") as f:
            xgb_metadata = json.load(f)
        print("XGBoost Spatial V3 model loaded.")
    else:
        print("Warning: XGBoost models not found.")
        xgb_metadata = None

import datetime

@app.post("/notify")
async def fiware_notification(request: Request):
    payload = await request.json()
    logger.warning(f"DEBUG PAYLOAD: {payload}")
    data = payload.get("data", [])
    
    for entity in data:
        if entity.get("type") == "IoTDevice":
            await process_iot_device(entity)
            
    return {"status": "ok"}

import logging
logger = logging.getLogger("ai_service")
logger.setLevel(logging.INFO)

async def process_iot_device(entity):
    global xgboost_models, iso_forest, xgb_metadata
    if xgboost_models is None or iso_forest is None:
        logger.warning("Models not loaded. Skipping IoTDevice processing.")
        return

    entity_id = entity.get("id", "")
    try:
        energy_val = float(entity.get("energy", {}).get("value", 0.0))
        if energy_val <= 0:
            return # Process only actual readings
            
        outdoor_temp = float(entity.get("airTemperature", {}).get("value", 20.0))
        dew_temp = float(entity.get("dewTemperature", {}).get("value", 10.0))
        wind_speed = float(entity.get("windSpeed", {}).get("value", 5.0))
        
        date_observed = entity.get("dateObserved", {}).get("value")
        timestamp = date_observed if date_observed else datetime.datetime.utcnow().isoformat()
        
        ref_room = entity.get("refRoom", {}).get("object", "")
        building_id = ref_room if ref_room else "Rat_office_Adele"
        
        req = AnomalyRequest(
            building_id=building_id,
            timestamp=timestamp,
            energy=energy_val,
            outdoor_temperature=outdoor_temp,
            dewTemperature=dew_temp,
            windSpeed=wind_speed
        )
        
        await check_anomaly_and_publish(req)
    except Exception as e:
        logger.error(f"Error parsing IoTDevice entity: {e}")

from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor

class AnomalyRequest(BaseModel):
    building_id: str
    timestamp: str
    energy: float
    outdoor_temperature: float
    dewTemperature: float
    windSpeed: float

DB_PARAMS = {
    'dbname': os.environ.get('DB_NAME', 'geotwin_db'),
    'user': os.environ.get('DB_USER', 'geotwin_user'),
    'password': os.environ.get('DB_PASS', 'geotwin_password'),
    'host': os.environ.get('DB_HOST', 'localhost'),
    'port': os.environ.get('DB_PORT', '5433')
}

@app.post("/api/detect-anomalies")
async def detect_anomalies(req: AnomalyRequest):
    return await check_anomaly_and_publish(req)

async def check_anomaly_and_publish(req: AnomalyRequest):
    global xgboost_models, iso_forest, xgb_metadata
    if xgboost_models is None or iso_forest is None:
        return {"error": "Models not loaded"}
        
    # Fetch spatial features for the building
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT lat, lon, building_density, ndvi_current FROM spatial_features WHERE building_id = %s", (req.building_id,))
    spatial = cur.fetchone()
    conn.close()
    
    if not spatial:
        return {"error": "Building spatial context not found"}
        
    # Parse timestamp
    dt = pd.to_datetime(req.timestamp)
    
    # Build feature vector for XGBoost
    import xgboost as xgb
    
    feature_dict = {
        'hour': dt.hour,
        'day_of_week': dt.dayofweek,
        'month': dt.month,
        'is_weekend': int(dt.dayofweek in [5, 6]),
        'outdoor_temperature': req.outdoor_temperature,
        'dewTemperature': req.dewTemperature,
        'windSpeed': req.windSpeed,
        'lat': spatial['lat'],
        'lon': spatial['lon'],
        'building_density': spatial['building_density'],
        'ndvi_current': spatial['ndvi_current']
    }
    
    # Ensure columns match metadata order
    cols = xgb_metadata['features']
    df_features = pd.DataFrame([feature_dict])[cols]
    
    dmatrix = xgb.DMatrix(df_features)
    expected_energy = float(xgboost_models.predict(dmatrix)[0])
    
    # Calculate residual
    residual = abs(req.energy - expected_energy)
    
    # Run Isolation Forest for Anomaly Detection
    X_if = np.column_stack([
        [residual],
        [req.outdoor_temperature],
        [dt.hour],
        [spatial['ndvi_current']],
        [spatial['building_density']]
    ])
    
    is_anomaly = int(iso_forest.predict(X_if)[0] == -1)
    
    if is_anomaly:
        logger.warning(f"Anomaly detected for {req.building_id} | Expected: {expected_energy:.1f}, Actual: {req.energy:.1f}")
        
        # --- XAI (Explainable AI) Dynamic Heuristics ---
        diff = req.energy - expected_energy
        if diff > 0:
            possible_cause = f"Overconsumption ({req.energy:.1f} kWh > Expected {expected_energy:.1f} kWh). "
            if req.outdoor_temperature < 15:
                possible_cause += f"Unusual heating usage or HVAC fault given low outdoor temperature ({req.outdoor_temperature}°C)."
            elif req.outdoor_temperature > 25:
                possible_cause += f"Cooling load exceeded spatial expectations despite high NDVI ({spatial['ndvi_current']:.2f})."
            else:
                possible_cause += "Energy spike is unaccounted for by environmental or spatial context."
        else:
            possible_cause = f"Underconsumption ({req.energy:.1f} kWh < Expected {expected_energy:.1f} kWh). "
            if spatial['ndvi_current'] > 0.35 and req.outdoor_temperature > 25:
                possible_cause += f"Building's high greenery (NDVI: {spatial['ndvi_current']:.2f}) may be providing unexpected cooling, or HVAC system failed."
            else:
                possible_cause += "System outage or irregular operational schedule detected."
        
        publish_ai_insight(
            target_room_id=req.building_id,
            insight_type="SpatialEnergyAnomaly",
            severity="HIGH" if abs(diff) > (expected_energy * 0.5) else "WARNING",
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
