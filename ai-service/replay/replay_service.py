"""Stream real BDG2 readings into the context broker, one hour at a time.

This is the demonstration feeder for the live path: it replays measured 2017
hours as ``IoTDevice`` updates, the broker notifies ``POST /notify``, and the
service scores each reading against the model's validated band. Nothing here
decides what an anomaly is -- that is the service's job, and the point of the
exercise is to watch it decide.

Two things were wrong with the earlier version, and they are related.

It read ``data/pilot/test.csv``, a file from a superseded sprint that the
current pipeline does not produce, so the script exited immediately with "Test
data not found". Nobody noticed, because nothing downstream of it was working
either -- the subscription watched attributes this feeder never publishes.

And it manufactured its own findings::

    # Inject artificial anomaly for demo purposes every 50 ticks
    if i > 0 and i % 50 == 0:
        energy = energy * 2.5   # 2.5x spike!

A detector shown only spikes that were put there for it to find has been told
the answer. This repository documents having removed exactly that practice from
its anomaly experiments; leaving it in the demo path would make the claim
false. The replay now sends the measured value and nothing else. Real deviations
are what the screening work found 79 buildings of; they do not need help.

Usage (from ``ai-service/``)::

    python -m replay.replay_service --site Bear --speed 4
    python -m replay.replay_service --building Bear_office_Alfredo --hours 500
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

import pandas as pd
import requests

logger = logging.getLogger("replay")

ORION_LD_URL = os.getenv("ORION_LD_URL", "http://localhost:1026/ngsi-ld/v1")
NGSI_LD_CONTEXT = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"

ENERGY_ROOT = os.path.join("data", "processed", "energy")

# What `main.fiware_notification` reads. Kept beside the payload that carries
# them so the two cannot drift the way the subscription did.
COLUMNS = [
    "building_id", "timestamp", "meter_reading", "year",
    "airTemperature", "dewTemperature", "windSpeed", "cloudCoverage",
]


def _entity(building_id, timestamp, reading, weather):
    """One NGSI-LD IoTDevice update, in the normalised form the sink expects."""
    device_id = "urn:ngsi-ld:IoTDevice:Meter-{}".format(building_id)
    body = {
        "id": device_id,
        "type": "IoTDevice",
        "category": {"type": "Property", "value": ["ENERGY_METER"]},
        # The handler takes the building id from the last segment of this.
        "refRoom": {"type": "Relationship",
                    "object": "urn:ngsi-ld:Building:{}".format(building_id)},
        "energy": {"type": "Property", "value": float(reading)},
        "dateObserved": {"type": "Property", "value": timestamp},
        "@context": [NGSI_LD_CONTEXT],
    }
    for name, value in weather.items():
        if value is not None:
            body[name] = {"type": "Property", "value": float(value)}
    return device_id, body


def upsert(device_id, body, timeout=10):
    """Create the entity, or patch its attributes if the broker already has it."""
    try:
        res = requests.post("{}/entities".format(ORION_LD_URL), json=body,
                            headers={"Content-Type": "application/ld+json"},
                            timeout=timeout)
        if res.status_code == 409:
            attrs = {k: v for k, v in body.items() if k not in ("id", "type", "@context")}
            res = requests.patch(
                "{}/entities/{}/attrs".format(ORION_LD_URL, device_id),
                json=attrs,
                headers={
                    "Content-Type": "application/json",
                    "Link": '<{}>; rel="http://www.w3.org/ns/json-ld#context"; '
                            'type="application/ld+json"'.format(NGSI_LD_CONTEXT),
                },
                timeout=timeout,
            )
        if res.status_code >= 400:
            logger.warning("broker refused %s: %s %s", device_id, res.status_code,
                           res.text[:200])
            return False
        return True
    except requests.RequestException as exc:
        logger.warning("cannot reach the broker for %s: %s", device_id, exc)
        return False


def load_readings(site=None, building=None, year=2017, energy_root=ENERGY_ROOT):
    """Measured hours for one site or building, in chronological order."""
    if not os.path.isdir(energy_root):
        raise SystemExit(
            "No dataset at {}. Run `python -m app.data_engineering.build_dataset` "
            "first.".format(os.path.abspath(energy_root))
        )

    if site is None and building is None:
        raise SystemExit("Give --site or --building; replaying the whole "
                         "portfolio one hour at a time is 23 million updates.")

    if site is None:
        # A building id is prefixed with its site, which is also the partition.
        site = building.split("_", 1)[0]

    path = os.path.join(energy_root, "site_id={}".format(site), "part.parquet")
    if not os.path.exists(path):
        raise SystemExit("No partition for site '{}' at {}".format(site, path))

    df = pd.read_parquet(path, columns=COLUMNS)
    df = df[df["year"] == year]
    if building:
        df = df[df["building_id"] == building]
    if df.empty:
        raise SystemExit("No {} readings for {}".format(year, building or site))
    return df.sort_values("timestamp")


def run(site=None, building=None, year=2017, speed=2.0, hours=None):
    df = load_readings(site=site, building=building, year=year)
    if hours:
        df = df.head(hours)

    logger.info("replaying %d measured hours at %.1f/s -- no values are altered",
                len(df), speed)

    sent = failed = 0
    delay = 1.0 / speed if speed > 0 else 0.0
    for _, row in df.iterrows():
        weather = {c: (None if pd.isna(row[c]) else row[c])
                   for c in ("airTemperature", "dewTemperature", "windSpeed", "cloudCoverage")}
        device_id, body = _entity(
            row["building_id"], pd.Timestamp(row["timestamp"]).isoformat(),
            row["meter_reading"], weather,
        )
        if upsert(device_id, body):
            sent += 1
        else:
            failed += 1
        if delay:
            time.sleep(delay)

    logger.info("sent %d updates, %d refused", sent, failed)
    return sent, failed


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--site", help="BDG2 site id, e.g. Bear")
    p.add_argument("--building", help="a single building id")
    p.add_argument("--year", type=int, default=2017)
    p.add_argument("--speed", type=float, default=2.0, help="updates per second")
    p.add_argument("--hours", type=int, help="stop after this many readings")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    sent, failed = run(site=args.site, building=args.building, year=args.year,
                       speed=args.speed, hours=args.hours)
    return 1 if sent == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
