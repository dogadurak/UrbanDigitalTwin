"""Load BDG2 building reference data into PostGIS for the serving layer.

Everything written here comes from the dataset: metadata.csv for attributes,
Sprint 1's coordinate validation for `coord_status`, Sprint 1's meter screening
for `meter_usable`, and Sprint 2's 40 km blocking for `spatial_block`.

Nothing is invented. Where BDG2 has no value -- 4 sites without coordinates,
half the portfolio without `yearbuilt` -- the column stays NULL rather than
being filled with a plausible-looking number.

Usage::

    python -m app.data_engineering.load_buildings_to_db
"""

from __future__ import annotations

import os

import pandas as pd
import psycopg2
from psycopg2.extras import execute_batch

from app.data_engineering import bdg2_metadata as md
from app.data_engineering import cohorts as ch

DB_PARAMS = {
    "dbname": os.environ.get("DB_NAME", "geotwin_db"),
    "user": os.environ.get("DB_USER", "geotwin_user"),
    "password": os.environ.get("DB_PASS", "geotwin_password"),
    "host": os.environ.get("POSTGRES_HOST", "postgis"),
    "port": os.environ.get("POSTGRES_PORT", "5432"),
}

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


def load(processed_dir=os.path.join("data", "processed")):
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
        lat = _none(s["lat"]) if s is not None else None
        lng = _none(s["lng"]) if s is not None else None
        rows.append((
            r["building_id"], site, block_of_site.get(site, site),
            _none(r.get("primaryspaceusage")), _none(r.get("sqm")),
            int(r["yearbuilt"]) if not pd.isna(r.get("yearbuilt")) else None,
            _none(r.get("numberoffloors")),
            _none(s["timezone"]) if s is not None else None,
            lat, lng,
            _none(s["coord_status"]) if s is not None else None,
            bool(s["spatial_ready"]) if s is not None else False,
            r["building_id"] in usable,
            lng, lat, lng, lat,
        ))

    conn = psycopg2.connect(**DB_PARAMS)
    try:
        with conn.cursor() as cur:
            execute_batch(cur, INSERT, rows, page_size=500)
        conn.commit()
    finally:
        conn.close()

    print("loaded {} buildings".format(len(rows)))
    return len(rows)


if __name__ == "__main__":
    load()
