import pandas as pd
import requests
import time
import os
import json

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")
REPLAY_SPEED = float(os.getenv("REPLAY_SPEED", "2.0")) # Default 2 updates per second

def upsert_iot_device(building_id, timestamp, energy, outdoor_temp, dew_temp, wind_speed, cloud_coverage):
    device_id = f"urn:ngsi-ld:IoTDevice:Meter-{building_id}"
    # Map the building_id back to a valid room reference for the frontend to recognize (or directly as building)
    ref_room = f"urn:ngsi-ld:Building:{building_id}"
    
    payload = {
        "id": device_id,
        "type": "IoTDevice",
        "category": { "type": "Property", "value": ["ENERGY_METER"] },
        "refRoom": { "type": "Relationship", "object": ref_room },
        "energy": { "type": "Property", "value": float(energy) },
        "airTemperature": { "type": "Property", "value": float(outdoor_temp) },
        "dewTemperature": { "type": "Property", "value": float(dew_temp) },
        "windSpeed": { "type": "Property", "value": float(wind_speed) },
        "cloudCoverage": { "type": "Property", "value": float(cloud_coverage) },
        "dateObserved": { "type": "Property", "value": timestamp },
        "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"]
    }
    
    try:
        res = requests.post(f"{ORION_LD_URL}/entities", json=payload, headers={"Content-Type": "application/ld+json"})
        if res.status_code == 409:
            patch_payload = { k: v for k, v in payload.items() if k not in ["id", "type", "@context"] }
            requests.patch(f"{ORION_LD_URL}/entities/{device_id}/attrs", json=patch_payload, headers={
                "Content-Type": "application/json",
                "Link": '<https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
            })
    except Exception as e:
        print(f"Failed to update device {device_id}: {e}")

def run_replay():
    # Use the real test dataset!
    data_path = os.path.join(os.path.dirname(__file__), "../data/pilot/test.csv")
    if not os.path.exists(data_path):
        print(f"Test data not found at {data_path}. Run prepare_pilot_data.py first.", flush=True)
        return
        
    df = pd.read_csv(data_path)
    # Sort by timestamp to stream chronologically
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp')
    
    # We might have ~34k rows, let's just loop over them
    print(f"Starting V3 spatial replay of {len(df)} records at {REPLAY_SPEED} updates/sec...", flush=True)
    
    # Introduce anomalies dynamically if we want to force them, but test data might already have some
    # Let's force an anomaly every 50 records for demonstration
    for i, (_, row) in enumerate(df.iterrows()):
        energy = row['meter_reading']
        
        # Inject artificial anomaly for demo purposes every 50 ticks
        if i > 0 and i % 50 == 0:
            energy = energy * 2.5 # 2.5x spike!
            
        upsert_iot_device(
            building_id=row['building_id'],
            timestamp=row['timestamp'].isoformat(),
            energy=energy,
            outdoor_temp=row['outdoor_temperature'],
            dew_temp=row['dewTemperature'],
            wind_speed=row['windSpeed'],
            cloud_coverage=row['cloudCoverage'] if not pd.isna(row['cloudCoverage']) else 0.0
        )
        
        print(f"[{row['timestamp']}] Replayed {row['building_id']} | Energy: {energy:.1f}", flush=True)
        time.sleep(1.0 / REPLAY_SPEED) 

if __name__ == "__main__":
    run_replay()
