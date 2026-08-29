"""Unit tests for the Sprint 1 data foundation.

These run without a database, a container or the BDG2 download: every case is
built from a small synthetic frame so the assertions describe behaviour rather
than a particular dataset snapshot.
"""

import numpy as np
import pandas as pd
import pytest

from app.data_engineering import bdg2_metadata as md
from app.data_engineering import data_quality as dq
from app.data_engineering import leakage


# --------------------------------------------------------------------------
# Coordinate validation
# --------------------------------------------------------------------------

def _meta(rows):
    return pd.DataFrame(rows)


def test_valid_site_passes():
    meta = _meta([
        {"building_id": "A", "site_id": "Rat", "lat": 38.9035, "lng": -77.0053,
         "timezone": "US/Eastern"},
    ])
    sites, findings = md.validate_coordinates(meta)
    assert findings == []
    assert bool(sites.loc[0, "spatial_ready"]) is True


def test_missing_coordinates_flagged_not_dropped():
    meta = _meta([
        {"building_id": "A", "site_id": "Eagle", "lat": np.nan, "lng": np.nan,
         "timezone": "US/Eastern"},
    ])
    sites, findings = md.validate_coordinates(meta)
    assert [f.status for f in findings] == ["missing"]
    assert bool(sites.loc[0, "spatial_ready"]) is False
    # The site still appears -- its energy data remains usable.
    assert len(sites) == 1


def test_longitude_sign_error_is_caught():
    """The Wolf case: right latitude, right magnitude, wrong hemisphere.

    Dublin is at -6.2603. BDG2 records +6.2603 for a site whose own timezone
    column says Europe/Dublin, which places it in the North Sea.
    """
    meta = _meta([
        {"building_id": "A", "site_id": "Wolf", "lat": 53.3498, "lng": 6.2603,
         "timezone": "Europe/Dublin"},
    ])
    sites, findings = md.validate_coordinates(meta)
    assert len(findings) == 1
    assert findings[0].status == "timezone_mismatch"
    assert "lng=6.2603" in findings[0].detail
    # Latitude is correct for Dublin and must not be blamed.
    assert "lat=" not in findings[0].detail
    assert bool(sites.loc[0, "spatial_ready"]) is False


def test_correct_dublin_sign_passes():
    """The same site with the sign corrected must pass, or the check is useless."""
    meta = _meta([
        {"building_id": "A", "site_id": "Wolf", "lat": 53.3498, "lng": -6.2603,
         "timezone": "Europe/Dublin"},
    ])
    _, findings = md.validate_coordinates(meta)
    assert findings == []


def test_null_island_is_caught():
    meta = _meta([
        {"building_id": "A", "site_id": "X", "lat": 0.0, "lng": 0.0,
         "timezone": "US/Eastern"},
    ])
    _, findings = md.validate_coordinates(meta)
    assert findings[0].status == "null_island"


def test_spatial_sample_size_reports_the_real_ceiling():
    meta = _meta([
        {"building_id": "a1", "site_id": "Rat", "lat": 38.9, "lng": -77.0, "timezone": "US/Eastern"},
        {"building_id": "a2", "site_id": "Rat", "lat": 38.9, "lng": -77.0, "timezone": "US/Eastern"},
        {"building_id": "b1", "site_id": "Eagle", "lat": np.nan, "lng": np.nan, "timezone": "US/Eastern"},
    ])
    sites, _ = md.validate_coordinates(meta)
    stats = md.spatial_sample_size(sites)
    assert stats["n_buildings_total"] == 3
    # Two buildings share one coordinate: the spatial sample size is 1, not 2.
    assert stats["n_distinct_coordinates"] == 1
    assert stats["n_buildings_spatial_ready"] == 2


# --------------------------------------------------------------------------
# Meter quality screening
# --------------------------------------------------------------------------

def _series(values):
    idx = pd.date_range("2016-01-01", periods=len(values), freq="h")
    return pd.Series(values, index=idx)


def test_clean_series_is_usable():
    rng = np.random.default_rng(0)
    s = _series(100 + rng.normal(0, 5, dq.MIN_VALID_HOURS + 100))
    flags = dq.screen_series(s, "clean")
    assert flags["usable"] is True
    assert flags["exclusion_reason"] == ""


def test_short_series_excluded():
    s = _series(np.full(100, 50.0))
    flags = dq.screen_series(s, "short")
    assert flags["usable"] is False
    assert "valid hours" in flags["exclusion_reason"]


def test_constant_series_excluded():
    s = _series(np.full(dq.MIN_VALID_HOURS + 100, 42.0))
    flags = dq.screen_series(s, "constant")
    assert flags["usable"] is False
    assert flags["is_constant"] is True


def test_negative_readings_excluded():
    rng = np.random.default_rng(1)
    v = 100 + rng.normal(0, 5, dq.MIN_VALID_HOURS + 100)
    v[10] = -3.0
    flags = dq.screen_series(_series(v), "negative")
    assert flags["usable"] is False
    assert flags["n_negative"] == 1


def test_stuck_meter_excluded():
    """Half the record repeating one value is an instrument fault."""
    rng = np.random.default_rng(2)
    n = dq.MIN_VALID_HOURS + 100
    v = 100 + rng.normal(0, 5, n)
    v[: n // 2] = 77.0  # long identical run
    flags = dq.screen_series(_series(v), "stuck")
    assert flags["longest_flatline_run"] >= dq.FLATLINE_RUN_HOURS
    assert flags["usable"] is False
    assert "stuck/zero" in flags["exclusion_reason"]


def test_isolated_zeros_do_not_exclude():
    """A scattered zero hour is plausible; only sustained runs are outages."""
    rng = np.random.default_rng(3)
    n = dq.MIN_VALID_HOURS + 100
    v = 100 + rng.normal(0, 5, n)
    v[::500] = 0.0
    flags = dq.screen_series(_series(v), "sparse-zeros")
    assert flags["longest_zero_run"] < dq.ZERO_RUN_HOURS
    assert flags["usable"] is True


def test_long_outage_excluded():
    rng = np.random.default_rng(4)
    n = dq.MIN_VALID_HOURS + 100
    v = 100 + rng.normal(0, 5, n)
    v[: n // 2] = 0.0
    flags = dq.screen_series(_series(v), "outage")
    assert flags["longest_zero_run"] >= dq.ZERO_RUN_HOURS
    assert flags["usable"] is False


def test_empty_series_excluded():
    s = _series(np.full(1000, np.nan))
    flags = dq.screen_series(s, "empty")
    assert flags["usable"] is False
    assert flags["exclusion_reason"] == "no valid readings"


# --------------------------------------------------------------------------
# Building-identity leakage guard
# --------------------------------------------------------------------------

def _panel(n_buildings=4, n_hours=50, seed=0):
    """A small panel with per-building constants and time-varying columns."""
    rng = np.random.default_rng(seed)
    frames = []
    for i in range(n_buildings):
        frames.append(pd.DataFrame({
            "building_id": "b{}".format(i),
            "hour": np.arange(n_hours) % 24,
            "airTemperature": rng.normal(15, 5, n_hours),
            # Fabricated "spatial" constants, one value per building.
            "ndvi_current": 0.1 * (i + 1),
            "elevation": 10.0 * (i + 1),
            # A genuine building attribute, also constant per building.
            "sqm": 1000.0 * (i + 1),
            "meter_reading": rng.normal(100 * (i + 1), 5, n_hours),
        }))
    return pd.concat(frames, ignore_index=True)


def test_forbidden_columns_rejected():
    df = _panel()
    with pytest.raises(leakage.IdentityLeakageError) as exc:
        leakage.check_feature_set(df, ["hour", "lat"])
    assert "lat" in str(exc.value)


def test_fabricated_spatial_features_are_caught():
    """The exact V3 failure: per-building constants sold as spatial context."""
    df = _panel()
    report = leakage.identifiability(df, ["ndvi_current", "elevation"])
    assert report["frac_uniquely_identified"] == 1.0
    assert set(report["constant_columns"]) == {"ndvi_current", "elevation"}
    with pytest.raises(leakage.IdentityLeakageError) as exc:
        leakage.check_feature_set(df, ["hour", "ndvi_current", "elevation"])
    assert "building identity" in str(exc.value)


def test_time_varying_features_are_not_flagged():
    df = _panel()
    report = leakage.identifiability(df, ["hour", "airTemperature"])
    assert report["constant_columns"] == []
    assert report["frac_uniquely_identified"] == 0.0
    leakage.check_feature_set(df, ["hour", "airTemperature"])  # must not raise


def test_building_mean_r2_detects_scale_dominance():
    """With four buildings at 100/200/300/400 kWh, identity explains almost all."""
    df = _panel()
    r2 = leakage.building_mean_r2(df, "meter_reading")
    assert r2 > 0.9


# --------------------------------------------------------------------------
# Forecast horizon: which lags a model may legally see
# --------------------------------------------------------------------------

def test_horizon_restricts_available_lags():
    """A week-ahead forecast cannot use last hour's meter reading.

    Quoting a 1-hour-ahead accuracy as a general forecast figure overstates the
    system; using lag_1 to predict a week ahead would be outright leakage.
    """
    from app.experiments.ladder import lag_features_for_horizon

    assert "energy_lag_1" in lag_features_for_horizon(1)
    assert "energy_lag_1" not in lag_features_for_horizon(24)
    assert "energy_lag_24" in lag_features_for_horizon(24)
    assert "energy_lag_24" not in lag_features_for_horizon(168)
    assert "energy_lag_168" in lag_features_for_horizon(168)


def test_longer_horizon_never_gains_features():
    from app.experiments.ladder import lag_features_for_horizon

    for shorter, longer in ((1, 24), (24, 168)):
        assert set(lag_features_for_horizon(longer)) <= set(lag_features_for_horizon(shorter))


def test_rolling_mean_is_shifted_by_the_horizon():
    """The rolling window must not overlap information unavailable at forecast time."""
    import numpy as np
    import pandas as pd

    from app.experiments import ladder as L

    n = 400
    df = pd.DataFrame({
        "building_id": "b0",
        "timestamp": pd.date_range("2016-01-01", periods=n, freq="h"),
        L.TARGET_RAW: np.arange(n, dtype="float64"),
    })
    out = L.add_lags(df, horizon=24)
    # With a strictly increasing series, a window shifted by 24 must sit at
    # least 24 steps behind the current value.
    valid = out.dropna(subset=["energy_roll_24"])
    assert (valid[L.TARGET_RAW] - valid["energy_roll_24"] >= 24).all()
