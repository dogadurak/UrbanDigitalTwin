"""Task-specific cohorts and spatially independent fold blocks.

There is no single "correct" BDG2 cohort. Each question admits a different set
of buildings, and pretending otherwise silently couples unrelated constraints:

* the **temporal** question (how well can we forecast, and what do building
  attributes contribute?) needs no coordinates at all, so excluding the four
  coordinate-less sites would throw away 237 buildings for nothing;
* the **spatial / cold-start** question needs coordinates *and* an honest fold
  structure;
* the **anomaly** question needs the raw (uncleaned) meter files and an
  external label source, neither of which is resolved yet.

So cohorts are declared separately and named in results.

Positional uncertainty
----------------------
BDG2 does not publish building locations. Miller et al. (2020), Sci Data 7:368:

    "Latitude and longitude data were set to the central location of either
     the site or the city in which the site is located."
    "In all cases, all buildings are within a 25-mile (40-kilometer) radius
     of the central location of the site or city."
    "lat: Latitude of building location to city level."

Two consequences, both structural rather than fixable:

1. Building-level remote sensing is not possible. A 250 m buffer is 1/25,600
   of the area a building may actually occupy, so a value sampled there
   describes an arbitrary point. This is why no LST/LCZ/NDVI extraction is
   attempted on BDG2.

2. **Two sites whose centroids are closer together than the uncertainty radius
   cannot be treated as independent locations.** This is the rule implemented
   below, and it is derived from the dataset's own documented bound rather than
   guessed. It matters because leave-one-site-out is meant to answer "does this
   transfer to an unseen city?" -- and training on two London sites while
   testing on a third London site does not ask that question.

Applied to BDG2 it merges two groups:

    Crow  <-> Moose            3.8 km   (Ottawa)
    Mouse <-> Robin <-> Shrew  1.1-2.5 km (London)

reducing 15 coordinate-bearing sites to 12 independent blocks. Corroborated
independently by the weather data: Crow and Moose resolve to identical NOAA-ISD
series (CDD18 782.7, HDD18 7949.6 for both).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# Miller et al. 2020: every building lies within this radius of its published
# site/city centroid. Sites closer than this are not resolvable from each other.
POSITIONAL_UNCERTAINTY_KM = 40.0

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in kilometres."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlam = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlam / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def spatial_blocks(sites, radius_km=POSITIONAL_UNCERTAINTY_KM):
    """Group sites that are not spatially resolvable from one another.

    ``sites`` needs ``site_id``, ``lat``, ``lng``. Sites without coordinates get
    their own block: their location is unknown, not known-to-be-shared.

    Returns ``{site_id: block_id}``. Block ids are the alphabetically first
    member, so they are stable across runs and readable in fold reports.
    """
    located = sites[sites["lat"].notna() & sites["lng"].notna()].reset_index(drop=True)
    parent = {s: s for s in sites["site_id"]}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            # Keep the alphabetically smaller root for deterministic naming.
            lo, hi = sorted([ra, rb])
            parent[hi] = lo

    for i in range(len(located)):
        for j in range(i + 1, len(located)):
            a, b = located.iloc[i], located.iloc[j]
            if haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) < radius_km:
                union(a["site_id"], b["site_id"])

    return {s: find(s) for s in sites["site_id"]}


def block_distance_report(sites, radius_km=POSITIONAL_UNCERTAINTY_KM):
    """Every site pair closer than ``radius_km``, for the provenance record."""
    located = sites[sites["lat"].notna() & sites["lng"].notna()].reset_index(drop=True)
    rows = []
    for i in range(len(located)):
        for j in range(i + 1, len(located)):
            a, b = located.iloc[i], located.iloc[j]
            d = float(haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]))
            if d < radius_km:
                rows.append({"site_a": a["site_id"], "site_b": b["site_id"], "distance_km": round(d, 2)})
    return pd.DataFrame(rows)


@dataclass
class Cohort:
    """A named set of buildings plus the fold structure it supports."""

    name: str
    description: str
    building_ids: list = field(default_factory=list)
    site_of_building: dict = field(default_factory=dict)
    block_of_site: dict = field(default_factory=dict)
    geo_usable_sites: set = field(default_factory=set)
    available: bool = True
    unavailable_reason: str = ""

    @property
    def n_buildings(self):
        return len(self.building_ids)

    @property
    def sites(self):
        return sorted(set(self.site_of_building.values()))

    @property
    def folds(self):
        """LOSO fold labels: spatial blocks, not raw site ids."""
        return sorted({self.block_of_site[s] for s in self.sites if s in self.block_of_site})

    def fold_of_building(self, building_id):
        return self.block_of_site[self.site_of_building[building_id]]

    def summary(self):
        return {
            "name": self.name,
            "description": self.description,
            "available": self.available,
            "unavailable_reason": self.unavailable_reason,
            "n_buildings": self.n_buildings,
            "n_sites": len(self.sites),
            "n_folds": len(self.folds),
            "folds": self.folds,
            "n_geo_usable_sites": len(self.geo_usable_sites),
        }


def _load_inputs(processed_dir):
    sites = pd.read_csv(os.path.join(processed_dir, "sites.csv"))
    with open(os.path.join(processed_dir, "manifest.json"), "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    quality = pd.read_csv(os.path.join(processed_dir, "meter_quality_report.csv"))
    return sites, manifest, quality


def build_cohorts(processed_dir=os.path.join("data", "processed")):
    """Construct the three task cohorts from the Sprint 1 dataset outputs."""
    sites, manifest, quality = _load_inputs(processed_dir)
    block_of_site = spatial_blocks(sites)

    # Buildings actually written to the dataset, with their site.
    site_of_building = {}
    for part in manifest["partitions"]:
        part_path = part["path"]
        df = pd.read_parquet(part_path, columns=["building_id"])
        for b in df["building_id"].unique():
            site_of_building[b] = part["site_id"]

    usable = set(quality.loc[quality["usable"], "building_id"])
    geo_usable = set(sites.loc[sites["spatial_ready"], "site_id"])

    # 1. Temporal / attribute cohort -- coordinates are irrelevant here.
    temporal_ids = sorted(b for b in site_of_building if b in usable)
    temporal = Cohort(
        name="temporal",
        description=(
            "All quality-screened buildings. Coordinates are not required: this "
            "cohort supports forecasting, building-attribute and identity-control "
            "experiments."
        ),
        building_ids=temporal_ids,
        site_of_building={b: site_of_building[b] for b in temporal_ids},
        block_of_site=block_of_site,
        geo_usable_sites=geo_usable,
    )

    # 2. Cold-start / leave-one-block-out cohort -- needs a resolvable location.
    #    Sites whose coordinates failed validation (Wolf's longitude sign error)
    #    stay in as folds, because a fold only needs to be a *distinct* place;
    #    they are excluded from geo_usable_sites so no geographic variable is
    #    ever computed for them.
    located_sites = set(sites.loc[sites["lat"].notna(), "site_id"])
    spatial_ids = sorted(b for b in temporal_ids if site_of_building[b] in located_sites)
    spatial = Cohort(
        name="spatial_loso",
        description=(
            "Buildings at sites with a published coordinate. Folds are spatial "
            "blocks, not sites: sites within the dataset's own 40 km positional "
            "uncertainty are merged, because leave-one-site-out across two "
            "London sites does not test transfer to an unseen city."
        ),
        building_ids=spatial_ids,
        site_of_building={b: site_of_building[b] for b in spatial_ids},
        block_of_site=block_of_site,
        geo_usable_sites=geo_usable,
    )

    # 3. Anomaly cohort -- declared, deliberately not populated.
    anomaly = Cohort(
        name="anomaly",
        description=(
            "Reserved for supervised anomaly work. Requires the raw (uncleaned) "
            "meter files and an external expert-label source."
        ),
        available=False,
        unavailable_reason=(
            "meters/raw/*.csv are unresolved git-lfs pointers (134 bytes), and "
            "electricity_cleaned.csv has already had anomalies removed by the "
            "dataset authors -- training a detector on it is self-defeating. "
            "External label availability and licence are unverified."
        ),
        block_of_site=block_of_site,
        geo_usable_sites=geo_usable,
    )

    return {"temporal": temporal, "spatial_loso": spatial, "anomaly": anomaly}
