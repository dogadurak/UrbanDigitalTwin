"""Tests for ladder analysis: summaries, contrasts, protocol gap."""

import numpy as np
import pandas as pd
import pytest

from app.experiments import analyse_ladder as A


def _folds(protocol, model, values, seeds=(0, 1)):
    rows = []
    for i, v in enumerate(values):
        for s in seeds:
            rows.append({
                "protocol": protocol,
                "model": model,
                "fold": "f{}".format(i),
                "seed": s,
                "cv_rmse_median": v,
            })
    return rows


def test_summary_averages_seeds_within_fold_then_across_folds():
    rows = []
    rows += _folds("temporal", "M2_weather", [10.0, 20.0])
    summary, per_fold = A.summary_table(pd.DataFrame(rows))
    assert len(per_fold) == 2          # two folds, seeds collapsed
    assert summary.loc[0, "n_folds"] == 2
    assert summary.loc[0, "cv_rmse"] == pytest.approx(15.0)


def test_summary_reports_fold_spread():
    rows = _folds("leave_block_out", "M3_building", [10.0, 12.0, 14.0])
    summary, _ = A.summary_table(pd.DataFrame(rows))
    assert summary.loc[0, "fold_sd"] == pytest.approx(2.0)
    assert summary.loc[0, "ci_lo"] <= summary.loc[0, "cv_rmse"] <= summary.loc[0, "ci_hi"]


def test_contrast_sign_negative_means_first_model_better():
    rows = []
    rows += _folds("temporal", "M3_building", [40.0, 42.0, 41.0])
    rows += _folds("temporal", "M2_weather", [80.0, 82.0, 81.0])
    _, per_fold = A.summary_table(pd.DataFrame(rows))
    con = A.contrasts(per_fold)
    row = con[con["contrast"] == "M3_building vs M2_weather"].iloc[0]
    assert row["delta_cv_rmse"] < 0
    assert row["folds_improved"] == 3
    assert row["relative_effect"] > 0.4


def test_contrast_reports_minimum_detectable_effect():
    rng = np.random.default_rng(0)
    a = list(50 + rng.normal(0, 5, 8))
    b = list(50 + rng.normal(0, 5, 8))
    rows = _folds("leave_block_out", "M3_building", a) + \
        _folds("leave_block_out", "M2_weather", b)
    _, per_fold = A.summary_table(pd.DataFrame(rows))
    con = A.contrasts(per_fold)
    row = con[con["contrast"] == "M3_building vs M2_weather"].iloc[0]
    assert np.isfinite(row["fold_sd"])
    assert np.isfinite(row["min_detectable_effect"])
    assert row["min_detectable_effect"] > 0


def test_protocol_gap_measures_optimism_against_block_out():
    rows = []
    rows += _folds("random", "M2_weather", [30.0])
    rows += _folds("leave_block_out", "M2_weather", [50.0, 50.0])
    summary, _ = A.summary_table(pd.DataFrame(rows))
    gap = A.protocol_gap(summary)
    assert gap.loc[0, "random_minus_lbo"] == pytest.approx(-20.0)
    assert gap.loc[0, "leave_block_out"] == pytest.approx(50.0)


def test_protocol_gap_empty_without_block_out():
    rows = _folds("random", "M2_weather", [30.0])
    summary, _ = A.summary_table(pd.DataFrame(rows))
    assert A.protocol_gap(summary).empty


def test_contrasts_skip_missing_models():
    rows = _folds("temporal", "M2_weather", [10.0, 11.0])
    _, per_fold = A.summary_table(pd.DataFrame(rows))
    con = A.contrasts(per_fold)
    # No M3 present, so no contrast involving it.
    assert con.empty or "M3_building" not in " ".join(con["contrast"])
