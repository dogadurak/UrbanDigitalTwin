"""Tests for task cohorts and spatial fold blocking."""

import numpy as np
import pandas as pd
import pytest

from app.data_engineering import cohorts as ch


def _sites(rows):
    return pd.DataFrame(rows)


def test_haversine_known_distance():
    # Ottawa sites Crow and Moose, from BDG2 metadata.
    d = ch.haversine_km(45.3876, -75.6960, 45.4215, -75.6972)
    assert 3.0 < d < 4.5


def test_distant_sites_stay_separate():
    sites = _sites([
        {"site_id": "Rat", "lat": 38.9035, "lng": -77.0053},
        {"site_id": "Bear", "lat": 37.8719, "lng": -122.2607},
    ])
    blocks = ch.spatial_blocks(sites)
    assert blocks["Rat"] != blocks["Bear"]


def test_ottawa_sites_merge():
    """Crow and Moose are 3.8 km apart -- inside the 40 km uncertainty."""
    sites = _sites([
        {"site_id": "Crow", "lat": 45.3876, "lng": -75.6960},
        {"site_id": "Moose", "lat": 45.4215, "lng": -75.6972},
    ])
    blocks = ch.spatial_blocks(sites)
    assert blocks["Crow"] == blocks["Moose"]


def test_london_sites_merge_transitively():
    """Mouse, Robin and Shrew are all within ~2.5 km of each other."""
    sites = _sites([
        {"site_id": "Mouse", "lat": 51.5219, "lng": -0.1201},
        {"site_id": "Robin", "lat": 51.5188, "lng": -0.1346},
        {"site_id": "Shrew", "lat": 51.4998, "lng": -0.1247},
    ])
    blocks = ch.spatial_blocks(sites)
    assert len(set(blocks.values())) == 1


def test_block_id_is_deterministic():
    sites = _sites([
        {"site_id": "Mouse", "lat": 51.5219, "lng": -0.1201},
        {"site_id": "Robin", "lat": 51.5188, "lng": -0.1346},
    ])
    first = ch.spatial_blocks(sites)
    shuffled = ch.spatial_blocks(sites.iloc[::-1].reset_index(drop=True))
    assert first == shuffled


def test_missing_coordinates_get_their_own_block():
    """Unknown location is not the same as known-shared location."""
    sites = _sites([
        {"site_id": "Eagle", "lat": np.nan, "lng": np.nan},
        {"site_id": "Gator", "lat": np.nan, "lng": np.nan},
    ])
    blocks = ch.spatial_blocks(sites)
    assert blocks["Eagle"] != blocks["Gator"]


def test_radius_is_the_papers_bound():
    """The merge rule must come from the dataset's documented uncertainty."""
    assert ch.POSITIONAL_UNCERTAINTY_KM == 40.0


def test_sites_just_outside_radius_do_not_merge():
    sites = _sites([
        {"site_id": "A", "lat": 40.0, "lng": 0.0},
        {"site_id": "B", "lat": 40.5, "lng": 0.0},  # ~55.6 km
    ])
    blocks = ch.spatial_blocks(sites)
    assert blocks["A"] != blocks["B"]


def test_block_distance_report_lists_offending_pairs():
    sites = _sites([
        {"site_id": "Crow", "lat": 45.3876, "lng": -75.6960},
        {"site_id": "Moose", "lat": 45.4215, "lng": -75.6972},
        {"site_id": "Rat", "lat": 38.9035, "lng": -77.0053},
    ])
    rep = ch.block_distance_report(sites)
    assert len(rep) == 1
    assert set(rep.iloc[0][["site_a", "site_b"]]) == {"Crow", "Moose"}


def test_cohort_folds_use_blocks_not_sites():
    c = ch.Cohort(
        name="t",
        description="",
        building_ids=["b1", "b2"],
        site_of_building={"b1": "Crow", "b2": "Moose"},
        block_of_site={"Crow": "Crow", "Moose": "Crow"},
    )
    assert c.sites == ["Crow", "Moose"]
    # Two sites, one fold -- this is the whole point.
    assert c.folds == ["Crow"]
    assert c.fold_of_building("b2") == "Crow"


def test_anomaly_cohort_is_declared_unavailable():
    c = ch.Cohort(name="anomaly", description="", available=False,
                  unavailable_reason="raw meters not pulled")
    assert c.available is False
    assert c.n_buildings == 0
