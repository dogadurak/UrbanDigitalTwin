"""Freeze the read-only API into static JSON for the GitHub Pages showcase.

GitHub Pages serves files, not processes. The dashboard, however, reads
everything it shows from a live FastAPI service backed by 276 MB of BDG2
parquet partitions and a PostGIS table -- none of which is in this repository.
This script closes that gap the only honest way: it runs the real endpoints
in-process and writes their **exact response bytes** to
``frontend/public/data/``. The showcase then reads those files.

Two consequences worth being explicit about:

* Nothing here re-implements an endpoint. Responses come from
  ``fastapi.testclient.TestClient`` against ``app.main:app``, so a value on the
  published page is the value the API returns, not a second computation of it
  that could quietly disagree.
* The database is not needed. ``bdg2_buildings`` is assembled in memory by
  :func:`app.data_engineering.load_buildings_to_db.building_rows` -- the same
  function that fills the real table -- and ``app.main.get_building`` is pointed
  at it for the duration of the run.

What is *not* exported, because it cannot be: ``POST /api/predict``,
``POST /api/simulate-what-if`` and ``POST /api/detect-anomalies`` take arbitrary
input. The showcase serves prediction by running the model itself in the
browser; see ``scripts/export_model_json.py``.

The parquet partitions and ``results/`` are not in git, so CI cannot run this.
It is a developer step: run it when the analysis changes, then commit the JSON
it writes.

Usage (from ``ai-service/``)::

    python -m scripts.export_web_data
    python -m scripts.export_web_data --buildings 300 --out ../frontend/public/data
"""

from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import sys

DEFAULT_OUT = os.path.join("..", "frontend", "public", "data")

# The slider in ScreeningPanel.jsx: min 1.5, max 4, step 0.5. Every stop it can
# land on needs a file, or the panel breaks halfway along its own control.
SCREENING_THRESHOLDS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
SCREENING_LIMIT = 40

# Columns GET /api/buildings selects, in its order. Mirrored from the SQL in
# app/main.py: the static file must not carry a field the API withholds.
BUILDING_COLUMNS = [
    "building_id", "site_id", "spatial_block", "primaryspaceusage", "sqm",
    "yearbuilt", "site_lat", "site_lng", "coord_status", "meter_usable",
]

# What the browser-side model needs to build a design row. numberoffloors is in
# this list and not in BUILDING_COLUMNS because the model uses it and the
# buildings endpoint does not return it.
MODEL_ATTRIBUTES = [
    "site_id", "primaryspaceusage", "sqm", "yearbuilt", "numberoffloors",
]


class Exporter:
    """Writes response bytes to disk and records what it wrote."""

    def __init__(self, client, out_dir):
        self.client = client
        self.out_dir = out_dir
        self.manifest = {}
        self.skipped = []

    def _write(self, stem, payload):
        path = os.path.join(self.out_dir, *stem.split("/")) + ".json"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(payload)
        self.manifest[stem] = len(payload)
        return len(payload)

    def endpoint(self, stem, url, required=True):
        """Export one GET endpoint verbatim. Returns the decoded body, or None.

        A missing optional endpoint is recorded rather than written: the
        showcase then says so plainly instead of showing a spinner that never
        resolves.
        """
        resp = self.client.get(url)
        if resp.status_code != 200:
            detail = resp.text[:200]
            if required:
                raise RuntimeError("{} -> {} {}".format(url, resp.status_code, detail))
            self.skipped.append((stem, resp.status_code, detail))
            return None
        self._write(stem, resp.content)
        return resp.json()

    def literal(self, stem, obj):
        """Export a value this script assembled rather than an endpoint.

        allow_nan=False on purpose: NaN is not JSON, and a browser that receives
        it fails with a parse error far from the cause.
        """
        payload = json.dumps(obj, ensure_ascii=False, allow_nan=False,
                             separators=(",", ":")).encode("utf-8")
        return self._write(stem, payload)


def _install_in_memory_buildings():
    """Point app.main.get_building at the metadata instead of PostGIS.

    Returns the table as a dict keyed by building_id. Every endpoint that needs
    a building attribute goes through get_building, including the ones in
    explore_api that import it lazily, so this single substitution is enough.
    """
    from app import main as M
    from app.data_engineering.load_buildings_to_db import building_rows

    table = {r["building_id"]: r for r in building_rows()}
    M.get_building = lambda building_id: table.get(building_id)
    return table


def _buildings_response(table, limit, usable_only=True):
    """Reproduce GET /api/buildings from the in-memory table.

    This is the one response not taken from the running app: its route reads
    PostGIS directly, and standing up a database to export a few hundred rows
    that already sit in memory would be theatre. The filter, ordering and
    projection below are the SQL in app/main.py:list_buildings, and
    tests/test_export_web_data.py holds them to it.
    """
    rows = [r for r in table.values() if r["meter_usable"] or not usable_only]
    rows.sort(key=lambda r: r["building_id"])
    rows = rows[:limit]
    return {"buildings": [{c: r[c] for c in BUILDING_COLUMNS} for r in rows]}


def export(out_dir=DEFAULT_OUT, n_buildings=300):
    from fastapi.testclient import TestClient

    table = _install_in_memory_buildings()

    from app.main import app  # imported after the substitution above

    os.makedirs(out_dir, exist_ok=True)

    # raise_server_exceptions=False so a 500 arrives as a status code. The
    # default re-raises it, which would abandon a run of several hundred
    # buildings because one of them upset an endpoint -- and hide from the
    # summary at the end that anything was wrong.
    with TestClient(app, raise_server_exceptions=False) as client:
        ex = Exporter(client, out_dir)

        ex.endpoint("health", "/api/health")

        tasks = ex.endpoint("results/tasks", "/api/results/tasks") or {"tasks": []}
        for task in [t["key"] for t in tasks.get("tasks", [])]:
            ex.endpoint("results/{}/summary".format(task),
                        "/api/results/{}/summary".format(task))
            ex.endpoint("results/{}/by-city".format(task),
                        "/api/results/{}/by-city".format(task), required=False)
            ex.endpoint("results/{}/contrasts".format(task),
                        "/api/results/{}/contrasts".format(task), required=False)

        ex.endpoint("explore/eui-by-use", "/api/explore/eui-by-use")

        # --- screening, once per stop of the panel slider --------------------
        flagged = set()
        for threshold in SCREENING_THRESHOLDS:
            body = ex.endpoint(
                "screening/{:.1f}".format(threshold),
                "/api/screening?threshold={}&limit={}".format(threshold, SCREENING_LIMIT),
                required=False,
            )
            for b in (body or {}).get("buildings", []):
                if b.get("building_id"):
                    flagged.add(b["building_id"])

        # --- the buildings the showcase can actually reach -------------------
        # PredictPanel lists the first N usable buildings; the screening panel
        # can hand any flagged building to the same detail views. Exporting the
        # union is what makes every click in the published page resolve.
        listed = _buildings_response(table, n_buildings)
        ex.literal("buildings", listed)
        listed_ids = [b["building_id"] for b in listed["buildings"]]

        detail_ids = sorted(set(listed_ids) | flagged)

        ex.literal("model/attributes", {
            bid: {c: table[bid][c] for c in MODEL_ATTRIBUTES}
            for bid in detail_ids if bid in table
        })

        # Grouped by site so each 20-60 MB parquet partition is read once
        # instead of once per building: explore_api keeps only a few hot.
        by_site = collections.defaultdict(list)
        for bid in detail_ids:
            row = table.get(bid)
            if row:
                by_site[row["site_id"]].append(bid)

        sites = sorted(by_site)
        for i, site in enumerate(sites, 1):
            print("[{}/{}] site {} ({} buildings)".format(
                i, len(sites), site, len(by_site[site])), flush=True)

            ex.endpoint("explore/site/{}/summary".format(site),
                        "/api/explore/site/{}/summary".format(site), required=False)

            for bid in by_site[site]:
                q = "/api/explore/building/{}/profile?year=2017".format(bid)
                ex.endpoint("explore/building/{}/profile".format(bid), q, required=False)
                ex.endpoint("diagnose/{}".format(bid),
                            "/api/diagnose/{}?year=2017".format(bid), required=False)
                ex.endpoint("anomaly/{}".format(bid),
                            "/api/anomaly/{}?sigma=3.0".format(bid), required=False)

        total = sum(ex.manifest.values())
        ex.literal("manifest", {
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "note": "Frozen responses of the read-only API. Regenerate with "
                    "`python -m scripts.export_web_data` from ai-service/.",
            "n_files": len(ex.manifest) + 1,
            "total_bytes": total,
            "files": sorted(ex.manifest),
        })

    print("\nwrote {} files, {:.1f} MB to {}".format(
        len(ex.manifest), total / 1e6, os.path.abspath(out_dir)))
    if ex.skipped:
        print("\n{} endpoint(s) had nothing to serve and were left out:".format(len(ex.skipped)))
        for stem, code, detail in ex.skipped[:20]:
            print("  {} [{}] {}".format(stem, code, detail.strip()[:120]))
        if len(ex.skipped) > 20:
            print("  ... and {} more".format(len(ex.skipped) - 20))
    return ex


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", default=DEFAULT_OUT, help="output directory")
    p.add_argument("--buildings", type=int, default=300,
                   help="how many buildings PredictPanel lists (must be at "
                        "least the limit the frontend requests)")
    args = p.parse_args(argv)
    export(out_dir=args.out, n_buildings=args.buildings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
