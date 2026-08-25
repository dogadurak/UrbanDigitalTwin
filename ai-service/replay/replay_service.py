import pandas as pd
import requests
import time
import os
import json

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")

def upsert_iot_device(device_id, room_id, temperature, humidity, hvac_status):
    payload = {
        "id": device_id,
        "type": "IoTDevice",
        "category": { "type": "Property", "value": ["ENVIRONMENTAL_SENSOR"] },
        "refRoom": { "type": "Relationship", "object": room_id },
        "temperature": { "type": "Property", "value": float(temperature) },
        "humidity": { "type": "Property", "value": float(humidity) },
        "hvac_status": { "type": "Property", "value": "ONLINE" if hvac_status == 1 else "OFFLINE" },
        "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"]
    }
    
    try:
        # Try POST first
        res = requests.post(f"{ORION_LD_URL}/entities", json=payload, headers={"Content-Type": "application/ld+json"})
        if res.status_code == 409:
            # Already exists, PATCH
            patch_payload = { k: v for k, v in payload.items() if k not in ["id", "type", "@context"] }
            requests.patch(f"{ORION_LD_URL}/entities/{device_id}/attrs", json=patch_payload, headers={
                "Content-Type": "application/json",
                "Link": '<https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
            })
    except Exception as e:
        print(f"Failed to update device {device_id}: {e}")

REPLAY_SPEED = int(os.getenv("REPLAY_SPEED", "1"))

def run_replay():
    data_path = os.path.join(os.path.dirname(__file__), "../data/synthetic/replay_data.csv")
    if not os.path.exists(data_path):
        print(f"Replay data not found at {data_path}", flush=True)
        return
        
    df = pd.read_csv(data_path)
    print(f"Starting replay of {len(df)} records at {REPLAY_SPEED}x speed...", flush=True)
    
    for _, row in df.iterrows():
        # Update a mock room (Room 203) which we assume exists in the UI
        upsert_iot_device(
            device_id="urn:ngsi-ld:IoTDevice:Env-203",
            room_id="urn:ngsi-ld:Room:203",
            temperature=row['indoor_temperature'],
            humidity=row['humidity'],
            hvac_status=row['hvac_status']
        )
        print(f"Replayed: T={row['indoor_temperature']:.1f}, HVAC={row['hvac_status']}", flush=True)
        # Sleep inversely proportional to REPLAY_SPEED
        time.sleep(2.0 / REPLAY_SPEED) 

if __name__ == "__main__":
    run_replay()
