"""The encoding contract: an absent value reaches the client as null.

Two endpoints in this service shipped the same mistake, and it took the same
form both times. Something the dataset does not record -- half the portfolio has
no ``yearbuilt``, five folds detect no effect -- came out of pandas as NaN,
NaN is not JSON, and Starlette answered 500 with no explanation. One endpoint
had been broken for every task it served and the other for nine of eighteen
sites; nobody noticed, because the dashboard happens not to call either.

So the tests here are about the encoder, not about pandas. `allow_nan=False`
is the setting Starlette uses, and a test that omits it passes while the
endpoint still fails in production.
"""

import json

import numpy as np
import pandas as pd
import pytest

from app import jsonsafe as J


def test_nan_becomes_null_not_a_missing_key():
    out = J.scrub({"yearbuilt": float("nan"), "sqm": 1200.0})
    assert out == {"yearbuilt": None, "sqm": 1200.0}
    assert "yearbuilt" in out, "absent is not the same as never asked"


def test_the_result_survives_the_encoder_the_server_uses():
    payload = J.scrub({"rows": [{"a": np.float64("nan")}, {"a": 1.0}]})
    assert json.dumps(payload, allow_nan=False) == '{"rows": [{"a": null}, {"a": 1.0}]}'


def test_infinity_is_also_refused_by_json():
    # Unlike NaN this never means "not recorded"; it means a division that
    # should not have happened. It still cannot go out as-is.
    assert J.scrub(float("inf")) is None
    json.dumps(J.scrub({"eui": float("-inf")}), allow_nan=False)


def test_nested_structures_are_reached():
    payload = {"by_use": [{"n": 3, "median_eui": float("nan")}],
               "site": {"oldest": float("nan"), "id": "Bobcat"}}
    assert J.scrub(payload) == {
        "by_use": [{"n": 3, "median_eui": None}],
        "site": {"oldest": None, "id": "Bobcat"},
    }


def test_real_values_are_left_alone():
    payload = {"s": "Bear", "i": 12, "f": 1.5, "b": True, "n": None, "l": [1, 2]}
    assert J.scrub(payload) == payload


def test_records_nulls_the_column_pandas_cannot():
    df = pd.DataFrame({
        "building_id": ["a", "b"],
        "yearbuilt": [1974.0, np.nan],
    })

    # The guard both endpoints used to carry, demonstrated not to work. If a
    # future pandas makes this pass, `records` is still correct and this
    # assertion is what tells us the workaround is no longer needed.
    naive = df.where(pd.notna(df), None).to_dict(orient="records")
    with pytest.raises(ValueError):
        json.dumps(naive, allow_nan=False)

    out = J.records(df)
    assert out == [{"building_id": "a", "yearbuilt": 1974.0},
                   {"building_id": "b", "yearbuilt": None}]
    json.dumps(out, allow_nan=False)


def test_pandas_na_is_handled_too():
    df = pd.DataFrame({"yearbuilt": pd.array([1974, None], dtype="Int64")})
    out = J.records(df)
    assert out[1]["yearbuilt"] is None
    json.dumps(out, allow_nan=False)
