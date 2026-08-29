"""Tests for baseline-deviation scanning.

The failure these guard against is concrete: an early version returned a single
"event" 1343 hours long for an ordinary building, because its consumption level
had simply moved between the baseline and reporting years. A year-long event is
not an event.
"""

import numpy as np
import pandas as pd
import pytest

from app import anomaly as A


def _series(n_hours, base=100.0, noise=2.0, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2016-01-01", periods=n_hours, freq="h")
    return pd.DataFrame({
        "timestamp": idx,
        "meter_reading": base + 20 * np.sin(idx.hour / 24 * 2 * np.pi) + rng.normal(0, noise, n_hours),
        "hour": idx.hour, "day_of_week": idx.dayofweek, "month": idx.month,
        "is_weekend": (idx.dayofweek >= 5).astype(int),
        "airTemperature": 15 + 10 * np.sin(idx.dayofyear / 365 * 2 * np.pi),
        "dewTemperature": 8.0,
    })


def test_isolated_spikes_are_not_events():
    """A single hour above the band is noise; an event is a run of them."""
    idx = np.array([10, 50, 200, 900])
    events = A._group_events(idx, None)
    # Each is its own run of length 1, and scan() filters runs below min_hours.
    assert all(start == end for start, end in events)


def test_contiguous_hours_group_into_one_event():
    idx = np.arange(100, 112)
    events = A._group_events(idx, None)
    assert events == [(100, 111)]


def test_small_gaps_do_not_split_an_event():
    """A fault that dips under the threshold for an hour is still one fault."""
    idx = np.array([100, 101, 102, 104, 105, 106])
    events = A._group_events(idx, None, max_gap=2)
    assert events == [(100, 106)]


def test_large_gaps_split_events():
    idx = np.array([100, 101, 102, 500, 501, 502])
    events = A._group_events(idx, None, max_gap=2)
    assert len(events) == 2


def test_empty_input_yields_no_events():
    assert A._group_events(np.array([], dtype=int), None) == []


def test_thresholds_are_documented_constants():
    """These are choices, not standards -- they must stay visible and named."""
    assert A.SIGMA_THRESHOLD == 3.0
    assert A.MIN_EVENT_HOURS >= 2
    assert A.BASELINE_YEAR < A.REPORT_YEAR


def test_baseline_features_exclude_the_target_and_identity():
    """The baseline predicts from calendar and weather only, per IPMVP Option C."""
    assert "meter_reading" not in A.FEATURES
    assert "building_id" not in A.FEATURES
    assert "sqm" not in A.FEATURES  # constant per building; adds nothing within one
    assert set(A.FEATURES) >= {"hour", "day_of_week", "airTemperature"}
