"""Load BDG2 building reference data into PostGIS for the serving layer.

Everything written here comes from the dataset: metadata.csv for attributes,
Sprint 1's coordinate validation for `coord_status`, Sprint 1's meter screening
for `meter_usable`, and Sprint 2's 40 km blocking for `spatial_block`.

Nothing is invented. Where BDG2 has no value -- 4 sites without coordinates,
half the portfolio without `yearbuilt` -- the column stays NULL rather than
being filled with a plausible-looking number.

The table is assembled by :func:`building_rows`, which is deliberately separate
from the database write: the static export (`scripts/export_web_data.py`) needs
the same rows without a database, and two independent assemblies of the same
table is exactly how a showcase drifts from the API it claims to mirror.

Usage::

    python -m app.data_engineering.load_buildings_to_db
"""

from __future__ import annotations

import os

import pandas as pd
from psycopg2.extras import execute_batch

from app import db as DB
from app.data_engineering import bdg2_metadata as md
from app.data_engineering import cohorts as ch

# Column order of `bdg2_buildings`, minus the derived `geom`. The INSERT below
# and the static export both read this, so the two cannot fall out of step.
COLUMNS = [
    "building_id", "site_id", "spatial_block", "primaryspaceusage", "sqm",
    "yearbuilt", "numberoffloors", "timezone", "site_lat", "site_lng",
    "coord_status", "geo_usable", "meter_usable",
]

INSERT = """
INSERT INTO bdg2_buildings (
    building_id, site_id, spatial_block, primaryspaceusage, sqm, yearbuilt,
    numberoffloors, timezone, site_lat, site_lng, coord_status, geo_usable,
    meter_usable, geom
) VALUES (
    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
    CASE WHEN %s IS NULL OR %s IS NULL THEN NULL
         ELSE ST_SetSRID(ST_MakePoint(%s, %s), 4326) END
)
ON CONFLICT (building_id) DO UPDATE SET
    site_id = EXCLUDED.site_id,
    spatial_block = EXCLUDED.spatial_block,
    primaryspaceusage = EXCLUDED.primaryspaceusage,
    sqm = EXCLUDED.sqm,
    yearbuilt = EXCLUDED.yearbuilt,
    numberoffloors = EXCLUDED.numberoffloors,
    timezone = EXCLUDED.timezone,
    site_lat = EXCLUDED.site_lat,
    site_lng = EXCLUDED.site_lng,
    coord_status = EXCLUDED.coord_status,
    geo_usable = EXCLUDED.geo_usable,
    meter_usable = EXCLUDED.meter_usable,
    geom = EXCLUDED.geom;
"""


def _none(v):
    """NULL rather than NaN, so absent data stays visibly absent."""
    if v is None or (isinstance(v, float) and pd.isna(v)) or pd.isna(v):
        return None
    return v


def building_rows(processed_dir=os.path.join("data", "processed")):
    """The `bdg2_buildings` table, as a list of dicts keyed by :data:`COLUMNS`.

    Absent values are ``None``, never NaN, because the difference between "this
    building has no recorded year" and "this building was built in year NaN"
    is the whole point of the column.
    """
    meta = md.load_metadata()
    sites, _ = md.validate_coordinates(meta)
    attrs = md.building_attributes(meta)

    block_of_site = ch.spatial_blocks(sites)
    site_row = sites.set_index("site_id")

    quality_path = os.path.join(processed_dir, "meter_quality_report.csv")
    usable = set()
    if os.path.exists(quality_path):
        q = pd.read_csv(quality_path)
        usable = set(q.loc[q["usable"], "building_id"])

    rows = []
    for _, r in attrs.iterrows():
        site = r["site_id"]
        s = site_row.loc[site] if site in site_row.index else None
        rows.append({
            "building_id": r["building_id"],
            "site_id": site,
            "spatial_block": block_of_site.get(site, site),
            "primaryspaceusage": _none(r.get("primaryspaceusage")),
            "sqm": _none(r.get("sqm")),
            "yearbuilt": int(r["yearbuilt"]) if not pd.isna(r.get("yearbuilt")) else None,
            "numberoffloors": _none(r.get("numberoffloors")),
            "timezone": _none(s["timezone"]) if s is not None else None,
            "site_lat": _none(s["lat"]) if s is not None else None,
            "site_lng": _none(s["lng"]) if s is not None else None,
            "coord_status": _none(s["coord_status"]) if s is not None else None,
            "geo_usable": bool(s["spatial_ready"]) if s is not None else False,
            "meter_usable": r["building_id"] in usable,
        })
    return rows


def load(processed_dir=os.path.join("data", "processed")):
    records = building_rows(processed_dir)

    params = []
    for rec in records:
        lat, lng = rec["site_lat"], rec["site_lng"]
        params.append(tuple(rec[c] for c in COLUMNS) + (lng, lat, lng, lat))

    conn = DB.connect()
    try:
        with conn.cursor() as cur:
            execute_batch(cur, INSERT, params, page_size=500)
        conn.commit()
    finally:
        conn.close()

    print("loaded {} buildings".format(len(params)))
    return len(params)


if __name__ == "__main__":
    load()
