import requests
import os

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:8000/notify")

def create_subscription():
    payload = {
        "description": "Notify AI Service of IoTDevice changes",
        "type": "Subscription",
        "entities": [{"type": "IoTDevice"}],
        "watchedAttributes": ["temperature", "humidity", "hvac_status"],
        "notification": {
            "attributes": ["temperature", "humidity", "hvac_status", "refRoom"],
            "format": "normalized",
            "endpoint": {
                "uri": AI_SERVICE_URL,
                "accept": "application/json"
            }
        },
        "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"]
    }
    
    try:
        res = requests.post(f"{ORION_LD_URL}/subscriptions/", json=payload, headers={"Content-Type": "application/ld+json"})
        if res.status_code == 201:
            print("Successfully created subscription in Orion-LD.")
        elif res.status_code == 409:
            print("Subscription already exists.")
        else:
            print(f"Failed to create subscription: {res.status_code} - {res.text}")
    except Exception as e:
        print(f"Error connecting to Orion-LD: {e}")

if __name__ == "__main__":
    create_subscription()
