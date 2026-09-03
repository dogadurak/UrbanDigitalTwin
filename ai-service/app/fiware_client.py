"""Publish a detected deviation back to the NGSI-LD context broker.

When the service scores a reading and finds it outside the model's validated
band, it writes an ``AIInsight`` entity linked to the building. That is the
output side of the live loop: a broker subscriber -- a dashboard, a work-order
system -- sees the insight without polling this service.

The insight carries what was observed, what was expected, how far apart they
are in units of the model's *demonstrated* error, and which model version said
so. An alert without those is not actionable: someone has to decide whether to
send an engineer, and "high" is not a reason.

Publishing is best-effort by design. The caller catches whatever comes out of
here, because a broker being down must not turn a successful anomaly detection
into a failed HTTP request for the client that asked for it.
"""

from __future__ import annotations

import datetime
import logging
import os
import uuid

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

logger = logging.getLogger("fiware_client")

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")
NGSI_LD_CONTEXT = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"


class BrokerUnavailable(Exception):
    """The broker could not be reached, or answered 5xx. Worth retrying."""


class BrokerRejected(Exception):
    """The broker understood the request and refused it. Retrying cannot help."""


def _insight(target_room_id, insight_type, severity, anomaly_score, observed_value,
             expected_value, possible_cause, model_name, model_version):
    return {
        "id": "urn:ngsi-ld:AIInsight:INSIGHT_{}".format(uuid.uuid4().hex[:8].upper()),
        "type": "AIInsight",
        "refRoom": {"type": "Relationship", "object": target_room_id},
        "insightType": {"type": "Property", "value": insight_type},
        "severity": {"type": "Property", "value": severity},
        "anomalyScore": {"type": "Property", "value": anomaly_score},
        "observedValue": {"type": "Property", "value": observed_value},
        "expectedValue": {"type": "Property", "value": expected_value},
        "possibleCause": {"type": "Property", "value": possible_cause},
        "model": {"type": "Property", "value": model_name},
        "modelVersion": {"type": "Property", "value": model_version},
        "detectedAt": {
            "type": "Property",
            # `utcnow()` is deprecated and returns a naive datetime, which reads
            # as local time to anything that parses it.
            "value": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
        "@context": [NGSI_LD_CONTEXT],
    }


# Retry only what a retry can fix. The previous version called
# `raise_for_status()` and then tested for 5xx underneath it -- unreachable --
# and retried 4xx three times over ten seconds, which cannot succeed and delays
# the caller for nothing.
@retry(
    retry=retry_if_exception_type(BrokerUnavailable),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    stop=stop_after_attempt(3),
    reraise=True,
)
def publish_ai_insight(target_room_id: str, insight_type: str, severity: str,
                       anomaly_score: float, observed_value: float,
                       expected_value: float, possible_cause: str,
                       model_name: str, model_version: str, timeout: float = 10.0):
    payload = _insight(target_room_id, insight_type, severity, anomaly_score,
                       observed_value, expected_value, possible_cause,
                       model_name, model_version)
    try:
        response = requests.post(
            "{}/entities".format(ORION_LD_URL),
            json=payload,
            headers={"Content-Type": "application/ld+json"},
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise BrokerUnavailable("cannot reach {}: {}".format(ORION_LD_URL, exc)) from exc

    if response.status_code == 201:
        logger.info("published %s for %s (%s)", payload["id"], target_room_id, severity)
        return payload["id"]

    detail = "{} {}".format(response.status_code, response.text[:300])
    if response.status_code >= 500:
        raise BrokerUnavailable("broker error: {}".format(detail))
    raise BrokerRejected("broker refused the insight: {}".format(detail))
