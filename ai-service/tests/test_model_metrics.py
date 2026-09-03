"""The error figure the product quotes, and whether it is named correctly.

The dashboard showed 59.5% in the results table and 75.7% in the prediction
band, one screen apart, for the same model under the same protocol. Neither
number was wrong. The results table reports the median across the 12
leave-one-city-out folds; the band reports the mean. They differ by 16 points
because Lamb scores 244% while the other eleven cities sit between 54% and 68%.

Nothing said so, because the field the band read was called
``cv_rmse_median_pct`` and held ``per_fold.mean()``.

These tests hold two things: that the resolver keeps quoting the same value it
always did -- the published screening results were produced with it, and a
silent change there would move a finding -- and that it now says which
aggregation that value is.
"""

import json
import os

import pytest

from app import model_metrics as MM


LEGACY = {
    "held_out_metrics": {
        "leave_block_out": {"cv_rmse_median_pct": 75.65, "fold_sd": 53.3, "n_folds": 12},
        "temporal": {"cv_rmse_median_pct": 43.68, "n_folds": 1},
    }
}

CORRECTED = {
    "held_out_metrics": {
        "leave_block_out": {"cv_rmse_mean_pct": 75.65, "cv_rmse_median_pct": 59.5,
                            "fold_sd": 53.3, "n_folds": 12},
        "temporal": {"cv_rmse_mean_pct": 43.68, "cv_rmse_median_pct": 43.68, "n_folds": 1},
    }
}


def test_the_quoted_value_does_not_change_when_the_naming_is_fixed():
    # The whole point: correcting the name must not move the number, because
    # the number gates which buildings get flagged for audit.
    assert MM.validated_band(LEGACY)[0] == MM.validated_band(CORRECTED)[0] == 75.65


def test_the_aggregation_is_named():
    value, protocol, aggregation, n_folds = MM.validated_band(CORRECTED)
    assert (value, protocol, aggregation, n_folds) == (75.65, "leave_block_out",
                                                       "mean_over_folds", 12)


def test_legacy_metadata_is_reported_as_the_mean_it_actually_holds():
    # A model file written before the fix has only the mis-named key. Reporting
    # it as a median would be repeating the original mistake with more
    # confidence.
    assert MM.validated_band(LEGACY)[2] == "mean_over_folds"


def test_the_strictest_protocol_wins():
    both = {"held_out_metrics": {
        "random": {"cv_rmse_mean_pct": 42.7, "n_folds": 1},
        "leave_block_out": {"cv_rmse_mean_pct": 75.65, "n_folds": 12},
    }}
    assert MM.validated_band(both)[1] == "leave_block_out"

    # Quoting `random` when a harder protocol was measured would understate the
    # error on exactly the case the model is sold for.
    only_random = {"held_out_metrics": {"random": {"cv_rmse_mean_pct": 42.7, "n_folds": 1}}}
    assert MM.validated_band(only_random)[1] == "random"


@pytest.mark.parametrize("meta", [None, {}, {"held_out_metrics": None},
                                  {"held_out_metrics": {}},
                                  {"held_out_metrics": {"temporal": {}}}])
def test_no_metrics_is_a_refusal_not_a_zero(meta):
    # A band of +/-0% would read as a model that is never wrong.
    assert MM.validated_band(meta) == (None, None, None, None)


def test_the_description_lets_a_reader_reconcile_the_two_numbers():
    text = MM.describe_band(*MM.validated_band(CORRECTED))
    assert "75.7%" in text
    assert "mean" in text and "12" in text and "leave_block_out" in text


def test_no_description_without_a_value():
    assert MM.describe_band(*MM.validated_band({})) is None


def test_the_shipped_model_metadata_resolves():
    """The model actually in this repository, not a fixture."""
    path = os.path.join("app", "models", "saved", "energy_cold_start_metadata.json")
    if not os.path.exists(path):
        pytest.skip("no production model in this checkout")
    with open(path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    value, protocol, aggregation, n_folds = MM.validated_band(meta)
    assert value and protocol and aggregation
    assert 0 < value < 500, "a CV(RMSE) outside this range is a unit error"
