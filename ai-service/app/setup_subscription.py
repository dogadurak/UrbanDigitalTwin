"""Register the subscription that drives live anomaly detection.

The service detects anomalies on demand over HTTP, and it can also do it as
readings arrive: a meter updates an ``IoTDevice`` entity in the context broker,
the broker notifies ``POST /notify``, and the service scores the reading against
the model's validated band and publishes an ``AIInsight`` back.

That loop was wired to the wrong contract and therefore never ran. The
subscription watched ``temperature``, ``humidity`` and ``hvac_status`` -- three
attributes nothing in this repository publishes -- and asked the broker to send
those three. The handler reads ``energy`` and the weather columns. So no
notification could fire, and one that somehow did would have arrived without a
single field the handler needs.

Two things follow, and both are why this file looks the way it does:

* The watched and notified attributes are derived from one list,
  :data:`READING_ATTRIBUTES`, which names what ``/notify`` actually consumes.
  Two hand-maintained lists in different files is how they came apart.
* A subscription already registered under this id is **replaced**, not left
  alone. The old code treated HTTP 409 as success and printed "Subscription
  already exists" -- so a broker carrying the broken subscription would keep
  carrying it, and every run would report that everything was fine.

Usage::

    python -m app.setup_subscription
"""

from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger("fiware_setup")

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:8000/notify")

NGSI_LD_CONTEXT = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"

#: Deterministic, so a re-run updates this subscription instead of accumulating
#: near-duplicates that all fire on the same event.
SUBSCRIPTION_ID = "urn:ngsi-ld:Subscription:building-energy-anomaly"

#: Exactly what `main.fiware_notification` reads off the entity. The broker
#: sends only the attributes named here, so anything missing from this list
#: silently becomes its default in the handler -- which is how a real reading
#: turns into a prediction against 20 degrees and no wind.
READING_ATTRIBUTES = [
    "energy",
    "refRoom",
    "dateObserved",
    "airTemperature",
    "dewTemperature",
    "windSpeed",
    "cloudCoverage",
]

#: The reading itself is the trigger. Weather accompanies it; it is not an event.
WATCHED_ATTRIBUTES = ["energy"]


def subscription_payload(notify_url=None):
    return {
        "id": SUBSCRIPTION_ID,
        "type": "Subscription",
        "description": "Score each new meter reading against the cold-start model",
        "entities": [{"type": "IoTDevice"}],
        "watchedAttributes": WATCHED_ATTRIBUTES,
        "notification": {
            "attributes": READING_ATTRIBUTES,
            # `normalized` keeps the {"type": "Property", "value": ...} shape the
            # handler unwraps. `keyValues` would flatten it and every read would
            # return the default.
            "format": "normalized",
            "endpoint": {
                "uri": notify_url or AI_SERVICE_URL,
                "accept": "application/json",
            },
        },
        "@context": [NGSI_LD_CONTEXT],
    }


def create_subscription(orion_url=None, notify_url=None, timeout=10):
    """Register the subscription, replacing any earlier one under the same id.

    Returns True when the broker is left holding a subscription matching this
    file, False otherwise.
    """
    base = (orion_url or ORION_LD_URL).rstrip("/")
    payload = subscription_payload(notify_url)
    headers = {"Content-Type": "application/ld+json"}

    try:
        res = requests.post("{}/subscriptions/".format(base), json=payload,
                            headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        logger.error("cannot reach the context broker at %s: %s", base, exc)
        return False

    if res.status_code == 201:
        logger.info("registered %s watching %s", SUBSCRIPTION_ID, WATCHED_ATTRIBUTES)
        return True

    if res.status_code == 409:
        # Already there -- and possibly the version that watched the wrong
        # attributes. Overwrite it rather than trusting what is registered.
        logger.info("%s exists; replacing it", SUBSCRIPTION_ID)
        try:
            requests.delete("{}/subscriptions/{}".format(base, SUBSCRIPTION_ID),
                            timeout=timeout)
            res = requests.post("{}/subscriptions/".format(base), json=payload,
                                headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            logger.error("could not replace the subscription: %s", exc)
            return False
        if res.status_code == 201:
            logger.info("replaced %s", SUBSCRIPTION_ID)
            return True

    logger.error("broker refused the subscription: %s %s", res.status_code, res.text[:300])
    return False


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return 0 if create_subscription() else 1


if __name__ == "__main__":
    raise SystemExit(main())
