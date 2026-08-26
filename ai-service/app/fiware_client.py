import os
import requests
import datetime
import uuid
from tenacity import retry, wait_exponential, stop_after_attempt

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
def publish_ai_insight(target_room_id: str, insight_type: str, severity: str,
                       anomaly_score: float, observed_value: float,
                       expected_value: float, possible_cause: str,
                       model_name: str, model_version: str):
                       
    insight_id = f"urn:ngsi-ld:AIInsight:INSIGHT_{uuid.uuid4().hex[:8].upper()}"
    
    payload = {
        "id": insight_id,
        "type": "AIInsight",
        "refRoom": {
            "type": "Relationship",
            "object": target_room_id
        },
        "insightType": { "type": "Property", "value": insight_type },
        "severity": { "type": "Property", "value": severity },
        "anomalyScore": { "type": "Property", "value": anomaly_score },
        "observedValue": { "type": "Property", "value": observed_value },
        "expectedValue": { "type": "Property", "value": expected_value },
        "possibleCause": { "type": "Property", "value": possible_cause },
        "model": { "type": "Property", "value": model_name },
        "modelVersion": { "type": "Property", "value": model_version },
        "detectedAt": { "type": "Property", "value": datetime.datetime.utcnow().isoformat() + "Z" },
        "@context": [
            "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"
        ]
    }
    
    try:
        response = requests.post(
            f"{ORION_LD_URL}/entities",
            json=payload,
            headers={"Content-Type": "application/ld+json"}
        )
        if response.status_code == 201:
            print(f"Successfully published AIInsight {insight_id} to FIWARE", flush=True)
        else:
            print(f"Failed to publish AIInsight. FIWARE responded with {response.status_code}: {response.text}", flush=True)
            response.raise_for_status() # Trigger retry if not 201, wait, actually raise_for_status is for 4xx/5xx. If it returns 400 we might not want to retry, but for resilience on timeouts/503 it makes sense. Let's raise an exception to trigger tenacity.
            if response.status_code >= 500:
                raise Exception(f"FIWARE Server Error: {response.status_code}")
    except Exception as e:
        print(f"Error communicating with FIWARE: {e}", flush=True)
        raise # Rethrow to trigger tenacity retry
