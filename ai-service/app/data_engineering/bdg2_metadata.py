"""BDG2 metadata loading, coordinate validation and building attributes.

The Building Data Genome Project 2 ships one metadata row per building. Two
properties of that file drive everything downstream:

1. Coordinates are *site* centroids, not building locations. All 305 `Rat`
   buildings share 38.903504 / -77.005349. Across 1636 buildings there are only
   15 distinct coordinate pairs, and 4 of the 19 sites have none at all. Any
   remote-sensing or OSM variable therefore takes at most 15 distinct values:
   the effective sample size for a *spatial* claim is 15, not 1636. This module
   makes that ceiling explicit rather than letting it hide behind a building
   count.

2. `sqm` is complete (100%), `primaryspaceusage` nearly so (98.7%) and
   `yearbuilt` covers half the portfolio. These are the strongest cheap
   predictors of building energy use and were previously unused.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import pandas as pd

# Repository-relative default; overridable for tests.
DEFAULT_METADATA_PATH = os.path.join(
    "data", "building-data-genome-project-2", "data", "metadata", "metadata.csv"
)

# Plausible geographic extent of each IANA zone used by BDG2.
#
# This is a consistency check *within* the dataset -- the timezone column is
# cross-examined against the coordinate columns -- so it introduces no new data
# source. Bands are the geographic extent of the zone itself, kept generous.
TIMEZONE_BANDS = {
    # zone:            (lon_min, lon_max, lat_min, lat_max)
    "US/Pacific":      (-125.0, -114.0, 32.0, 49.5),
    "US/Mountain":     (-117.0, -100.0, 31.0, 49.5),
    "US/Central":      (-106.0,  -82.0, 25.0, 49.5),
    "US/Eastern":      ( -90.0,  -66.0, 24.0, 47.5),
    "Europe/London":   (  -8.5,    2.0, 49.5, 61.0),
    "Europe/Dublin":   ( -11.0,   -5.0, 51.0, 56.0),
}

# Attributes carried into the model. Deliberately excludes lat/lng: with 15
# distinct coordinate pairs they are a building-site identifier, not a spatial
# signal. See archive/legacy_v3/README.md.
BUILDING_ATTRIBUTES = [
    "sqm",
    "primaryspaceusage",
    "sub_primaryspaceusage",
    "yearbuilt",
    "numberoffloors",
    "occupants",
]


@dataclass(frozen=True)
class CoordinateFinding:
    """One coordinate problem found at site level."""

    site_id: str
    status: str
    detail: str

    def __str__(self):  # pragma: no cover - display only
        return "[{}] {}: {}".format(self.status, self.site_id, self.detail)


def load_metadata(path=DEFAULT_METADATA_PATH):
    """Read metadata.csv, failing loudly if it is a git-lfs pointer."""
    if not os.path.exists(path):
        raise FileNotFoundError(
            "BDG2 metadata not found at {}. Run:\n"
            "  git submodule update --init --recursive\n"
            "  cd ai-service/data/building-data-genome-project-2 && git lfs pull".format(path)
        )
    if os.path.getsize(path) < 10_000:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(200)
        if "git-lfs" in head:
            raise RuntimeError(
                "{} is an unresolved git-lfs pointer, not the real file. "
                "Run `git lfs pull` inside the submodule.".format(path)
            )
    return pd.read_csv(path)


def validate_coordinates(meta):
    """Validate site coordinates and return a per-site frame plus findings.

    Checks applied, in order of severity:

    * ``missing``            - site has no coordinates at all.
    * ``out_of_range``       - outside the valid lat/lon domain.
    * ``null_island``        - within ~0.01 deg of (0, 0), the classic sentinel.
    * ``timezone_mismatch``  - coordinates fall outside the geographic extent of
      the site's own declared IANA timezone. This is what catches the ``Wolf``
      site: declared ``Europe/Dublin``, latitude 53.3498 (correct for Dublin),
      longitude **+6.2603** where Dublin is **-6.2603**. The magnitude matches
      exactly and only the sign differs, which is the signature of a sign error
      rather than a genuinely different location.
    * ``inconsistent``       - buildings at one site disagree on coordinates.
    * ``ok``

    A ``timezone_mismatch`` site keeps its energy data -- the meter readings are
    unaffected -- but must not be used for spatial joins, so it is excluded from
    the spatial-ready subset rather than silently "corrected". Editing published
    coordinates in place would be a worse error than recording the doubt.
    """
    findings = []
    rows = []

    for site_id, grp in meta.groupby("site_id", sort=True):
        coords = grp[["lat", "lng"]].dropna().drop_duplicates()
        tz = grp["timezone"].dropna().iloc[0] if grp["timezone"].notna().any() else None
        n_buildings = len(grp)

        if coords.empty:
            status, detail = "missing", "no coordinates in metadata"
            lat = lng = None
        elif len(coords) > 1:
            status = "inconsistent"
            detail = "{} distinct coordinate pairs within one site".format(len(coords))
            lat, lng = float(coords.iloc[0]["lat"]), float(coords.iloc[0]["lng"])
        else:
            lat, lng = float(coords.iloc[0]["lat"]), float(coords.iloc[0]["lng"])
            status, detail = "ok", ""

            if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
                status, detail = "out_of_range", "lat={}, lng={}".format(lat, lng)
            elif abs(lat) < 0.01 and abs(lng) < 0.01:
                status, detail = "null_island", "coordinates at (0, 0)"
            elif tz in TIMEZONE_BANDS:
                lon_min, lon_max, lat_min, lat_max = TIMEZONE_BANDS[tz]
                lon_ok = lon_min <= lng <= lon_max
                lat_ok = lat_min <= lat <= lat_max
                if not (lon_ok and lat_ok):
                    bad = []
                    if not lon_ok:
                        bad.append("lng={} outside [{}, {}]".format(lng, lon_min, lon_max))
                    if not lat_ok:
                        bad.append("lat={} outside [{}, {}]".format(lat, lat_min, lat_max))
                    status = "timezone_mismatch"
                    detail = "timezone {} implies ".format(tz) + "; ".join(bad)

        if status != "ok":
            findings.append(CoordinateFinding(site_id, status, detail))

        rows.append(
            {
                "site_id": site_id,
                "lat": lat,
                "lng": lng,
                "timezone": tz,
                "n_buildings": n_buildings,
                "coord_status": status,
                "coord_detail": detail,
                "spatial_ready": status == "ok",
            }
        )

    sites = pd.DataFrame(rows)
    return sites, findings


def building_attributes(meta):
    """Return the per-building attribute frame used for modelling."""
    cols = ["building_id", "site_id"] + [c for c in BUILDING_ATTRIBUTES if c in meta.columns]
    attrs = meta[cols].copy()

    # sqm is the EUI denominator; a non-positive area makes EUI meaningless.
    attrs["sqm_valid"] = attrs["sqm"].notna() & (attrs["sqm"] > 0)

    # yearbuilt is a building-envelope proxy. Guard against impossible values
    # rather than trusting the column: BDG2 covers 2016-2017.
    if "yearbuilt" in attrs.columns:
        bad_year = attrs["yearbuilt"].notna() & (
            (attrs["yearbuilt"] < 1600) | (attrs["yearbuilt"] > 2017)
        )
        attrs.loc[bad_year, "yearbuilt"] = pd.NA

    return attrs


def spatial_sample_size(sites):
    """Report the true effective sample size for any site-level spatial claim."""
    usable = sites[sites["spatial_ready"]]
    return {
        "n_sites_total": int(len(sites)),
        "n_sites_with_coords": int(sites["lat"].notna().sum()),
        "n_sites_spatial_ready": int(len(usable)),
        "n_buildings_total": int(sites["n_buildings"].sum()),
        "n_buildings_spatial_ready": int(usable["n_buildings"].sum()),
        "n_distinct_coordinates": int(usable[["lat", "lng"]].drop_duplicates().shape[0]),
    }
