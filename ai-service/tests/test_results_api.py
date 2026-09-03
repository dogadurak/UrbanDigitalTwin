"""What the results endpoints promise to the client, and in what encoding.

The bug these were written for: `/api/results/{task}/contrasts` answered 500 for
every task in the repository. The endpoint tried to null out its NaNs, pandas
put them back, and NaN is not JSON. Nothing caught it because the dashboard
defines the call and never makes it -- so the endpoint was broken for as long
as it had existed, in every deployment, silently.

A response is not correct because a DataFrame is correct. It is correct when it
survives the serialiser the server actually uses, which is why these tests end
at `json.dumps(..., allow_nan=False)`: the same setting Starlette applies.
"""

import json

import numpy as np
import pandas as pd
import pytest

from app import results_api as R


def _fold_results(protocol, models, n_folds=5, seeds=(0, 1), seed=0):
    """A fold_results table shaped like the harness writes one."""
    rng = np.random.default_rng(seed)
    rows = []
    for model, centre in models.items():
        for f in range(n_folds):
            value = centre + float(rng.normal(0, 5))
            for s in seeds:
                rows.append({
                    "protocol": protocol,
                    "model": model,
                    "fold": "f{}".format(f),
                    "seed": s,
                    "cv_rmse_median": value,
                })
    return pd.DataFrame(rows)


@pytest.fixture
def underpowered(monkeypatch):
    """Five folds of noise: no contrast in the searched range is detectable.

    This is the real shape of the `leave_buildings_out` protocol in this
    project, and it is the case that produced NaN.

    Only the two models of one contrast are present. Each contrast costs a
    power simulation over a grid, and five of them turn this file into a
    two-minute test for no extra coverage.
    """
    df = _fold_results(
        "leave_buildings_out",
        {"M3_building": 50.0, "M2_weather": 50.0},
    )
    monkeypatch.setattr(R, "_load", lambda task: (df, {}))
    return df


def test_contrasts_are_json_with_no_nan(underpowered):
    body = R.contrasts("leave_buildings_out")
    # allow_nan=False is what Starlette uses. Without it this passes while the
    # endpoint still returns 500 in production.
    json.dumps(body, allow_nan=False)


def test_an_undetectable_effect_is_reported_as_null_not_dropped(underpowered):
    body = R.contrasts("leave_buildings_out")
    assert body["contrasts"], "the fixture should produce contrasts to report"

    mdes = [row["min_detectable_effect"] for row in body["contrasts"]]
    assert any(v is None for v in mdes), (
        "with five noise folds no effect reaches 80% power, and the endpoint "
        "must say so as null rather than omitting the key or inventing a number"
    )
    for row in body["contrasts"]:
        assert "min_detectable_effect" in row


def test_a_detectable_effect_still_carries_its_number():
    # The null above must come from the statistics, not from a blanket rule
    # that empties the column.
    df = _fold_results(
        "leave_block_out",
        {"M3_building": 40.0, "M2_weather": 80.0},
        n_folds=12,
    )
    import unittest.mock as mock
    with mock.patch.object(R, "_load", lambda task: (df, {})):
        body = R.contrasts("leave_block_out")

    row = next(r for r in body["contrasts"] if r["contrast"] == "M3_building vs M2_weather")
    assert row["min_detectable_effect"] is not None
    assert row["min_detectable_effect"] > 0
    assert row["delta_cv_rmse"] < 0  # negative delta means the first model wins
    json.dumps(body, allow_nan=False)


def test_no_results_for_a_task_is_a_404_not_an_empty_answer(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "RESULTS_ROOT", str(tmp_path))
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        R.contrasts("never_run")
    assert exc.value.status_code == 404
