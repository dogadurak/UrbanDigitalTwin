"""Tests for the evaluation harness: metrics, protocols, stats, wiring."""

import numpy as np
import pandas as pd
import pytest

from app.data_engineering import cohorts as ch
from app.data_engineering import leakage
from app.evaluation import harness as H
from app.evaluation import metrics as M
from app.evaluation import protocols as P
from app.evaluation import stats as S


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------

def test_perfect_prediction_is_zero_error():
    y = np.array([10.0, 20.0, 30.0])
    assert M.cv_rmse(y, y) == pytest.approx(0.0)
    assert M.nmbe(y, y) == pytest.approx(0.0)


def test_cv_rmse_is_scale_free():
    """A building 100x larger with proportionally larger errors scores the same."""
    y = np.array([10.0, 20.0, 30.0])
    yhat = np.array([11.0, 19.0, 32.0])
    assert M.cv_rmse(y, yhat) == pytest.approx(M.cv_rmse(y * 100, yhat * 100))


def test_nmbe_sign_means_under_prediction():
    y = np.array([10.0, 10.0])
    assert M.nmbe(y, np.array([8.0, 8.0])) > 0      # predicted low
    assert M.nmbe(y, np.array([12.0, 12.0])) < 0    # predicted high


def test_cancelling_errors_show_in_cv_rmse_not_nmbe():
    y = np.array([10.0, 10.0])
    yhat = np.array([5.0, 15.0])
    assert M.nmbe(y, yhat) == pytest.approx(0.0)
    assert M.cv_rmse(y, yhat) > 40.0


def test_zero_mean_building_is_excluded_not_nan_propagated():
    y = np.zeros(30)
    ids = np.array(["b0"] * 30)
    pb = M.per_building(y, y, ids)
    assert bool(pb.loc[0, "usable"]) is False
    agg = M.aggregate(pb)
    assert agg["n_usable"] == 0 and agg["n_excluded"] == 1


def test_aggregate_reports_median_and_spread():
    y = np.concatenate([np.full(30, 10.0), np.full(30, 10.0)])
    yhat = np.concatenate([np.full(30, 10.0), np.full(30, 5.0)])
    ids = np.array(["good"] * 30 + ["bad"] * 30)
    agg = M.aggregate(M.per_building(y, yhat, ids))
    assert agg["n_usable"] == 2
    assert agg["cv_rmse_median"] > 0
    assert agg["cv_rmse_std"] > 0


# --------------------------------------------------------------------------
# Protocols
# --------------------------------------------------------------------------

def _panel(n_buildings=12, n_hours=48, sites=("A", "B", "C")):
    rng = np.random.default_rng(0)
    rows = []
    for i in range(n_buildings):
        site = sites[i % len(sites)]
        for year in (2016, 2017):
            rows.append(pd.DataFrame({
                "building_id": "b{}".format(i),
                "site_id": site,
                "year": year,
                "hour": np.arange(n_hours) % 24,
                "airTemperature": rng.normal(15, 5, n_hours),
                "target": rng.normal(100, 10, n_hours),
            }))
    return pd.concat(rows, ignore_index=True)


def test_temporal_split_separates_years():
    df = _panel()
    fold = next(P.TemporalSplit().split(df))
    assert set(df.iloc[fold.train_idx]["year"]) == {2016}
    assert set(df.iloc[fold.test_idx]["year"]) == {2017}


def test_leave_buildings_out_never_shares_a_building():
    df = _panel()
    proto = P.LeaveBuildingsOut(n_folds=4)
    seen = 0
    for fold in proto.split(df, seed=0):
        tr_b = set(df.iloc[fold.train_idx]["building_id"])
        te_b = set(df.iloc[fold.test_idx]["building_id"])
        assert tr_b.isdisjoint(te_b)
        seen += 1
    assert seen == 4


def test_leave_buildings_out_respects_temporal_holdout():
    df = _panel()
    for fold in P.LeaveBuildingsOut(n_folds=3, temporal_holdout=True).split(df):
        assert set(df.iloc[fold.train_idx]["year"]) == {2016}
        assert set(df.iloc[fold.test_idx]["year"]) == {2017}


def test_leave_block_out_holds_out_whole_blocks():
    df = _panel()
    cohort = ch.Cohort(name="t", description="",
                       block_of_site={"A": "A", "B": "B", "C": "C"})
    proto = P.LeaveBlockOut(min_test_buildings=1)
    labels = []
    for fold in proto.split(df, cohort=cohort):
        tr_s = set(df.iloc[fold.train_idx]["site_id"])
        te_s = set(df.iloc[fold.test_idx]["site_id"])
        assert tr_s.isdisjoint(te_s)
        labels.append(fold.label)
    assert sorted(labels) == ["A", "B", "C"]


def test_merged_block_yields_one_fold_not_two():
    """Two sites in one block must be held out together."""
    df = _panel(sites=("Mouse", "Robin", "Far"))
    cohort = ch.Cohort(name="t", description="",
                       block_of_site={"Mouse": "Mouse", "Robin": "Mouse", "Far": "Far"})
    labels = [f.label for f in P.LeaveBlockOut(min_test_buildings=1).split(df, cohort=cohort)]
    assert sorted(labels) == ["Far", "Mouse"]
    # And when the London block is the test fold, no London site is in training.
    for fold in P.LeaveBlockOut(min_test_buildings=1).split(df, cohort=cohort):
        if fold.label == "Mouse":
            assert set(df.iloc[fold.train_idx]["site_id"]) == {"Far"}


def test_protocols_declare_whether_identity_transfers():
    assert P.RandomSplit().identity_transfers is True
    assert P.TemporalSplit().identity_transfers is True
    assert P.LeaveBlockOut().identity_transfers is False


# --------------------------------------------------------------------------
# Identity control behaviour -- the design's central asymmetry
# --------------------------------------------------------------------------

class _MeanModel:
    """Ridge-free stand-in: predicts from the design matrix by least squares."""

    def __init__(self, seed=0):
        self.coef_ = None

    def fit(self, X, y):
        A = np.column_stack([np.ones(len(X)), np.asarray(X, dtype="float64")])
        self.coef_, *_ = np.linalg.lstsq(A, y, rcond=None)
        return self

    def predict(self, X):
        A = np.column_stack([np.ones(len(X)), np.asarray(X, dtype="float64")])
        return A @ self.coef_


def test_one_hot_site_is_all_zero_for_an_unseen_block():
    """Under leave_block_out the identity arm has no usable column.

    This is the asymmetry the whole experiment rests on: identity wins
    in-sample and is structurally worthless out-of-sample.
    """
    df = _panel(sites=("A", "B", "C"))
    spec = H.ModelSpec(name="M3prime", features=["hour"], factory=_MeanModel,
                       identity_features=["site_id"])
    cohort = ch.Cohort(name="t", description="",
                       block_of_site={"A": "A", "B": "B", "C": "C"})
    fold = next(P.LeaveBlockOut(min_test_buildings=1).split(df, cohort=cohort))
    tr, te = df.iloc[fold.train_idx], df.iloc[fold.test_idx]

    X_tr, vocab = H._design_matrix(tr, spec)
    X_te, _ = H._design_matrix(te, spec, categories=vocab)
    X_te = X_te.reindex(columns=X_tr.columns, fill_value=0.0)

    site_cols = [c for c in X_tr.columns if c.startswith("site_id=")]
    assert site_cols, "identity arm should produce one-hot columns"
    assert (X_te[site_cols].to_numpy() == 0).all()


def test_leakage_guard_runs_before_fitting():
    df = _panel()
    df["lat"] = 1.0
    spec = H.ModelSpec(name="bad", features=["hour", "lat"], factory=_MeanModel)
    with pytest.raises(leakage.IdentityLeakageError):
        H.run_spec(df, spec, P.TemporalSplit(), target="target", verbose=False)


def test_declared_identity_arm_is_exempt_from_the_guard():
    df = _panel()
    spec = H.ModelSpec(name="M3prime", features=["hour"], factory=_MeanModel,
                       identity_features=["site_id"])
    res = H.run_spec(df, spec, P.TemporalSplit(), target="target", verbose=False)
    assert len(res) == 1
    assert bool(res.loc[0, "has_identity_arm"]) is True


def test_run_spec_records_provenance_fields():
    df = _panel()
    spec = H.ModelSpec(name="M1", features=["hour"], factory=_MeanModel)
    res = H.run_spec(df, spec, P.LeaveBuildingsOut(n_folds=3), target="target", verbose=False)
    for col in ["model", "protocol", "fold", "seed", "n_train", "n_test",
                "identity_transfers", "cv_rmse_median", "nmbe_median"]:
        assert col in res.columns
    assert res["seed"].nunique() == 1


# --------------------------------------------------------------------------
# Statistics
# --------------------------------------------------------------------------

def test_bootstrap_ci_brackets_the_point_estimate():
    rng = np.random.default_rng(0)
    ci = S.bootstrap_ci(rng.normal(10, 2, 200), n_boot=2000, seed=1)
    assert ci["lo"] < ci["point"] < ci["hi"]


def test_paired_comparison_sign_convention():
    """Negative mean_diff means the first model is better (lower CV(RMSE))."""
    a = [10.0, 11.0, 9.0, 10.5]
    b = [12.0, 13.0, 11.0, 12.5]
    out = S.paired_comparison(a, b)
    assert out["mean_diff"] < 0
    assert out["n_folds_improved"] == 4
    assert out["relative_effect"] > 0


def test_paired_comparison_detects_no_difference():
    vals = [10.0, 11.0, 9.0, 10.5, 10.2]
    out = S.paired_comparison(vals, vals)
    assert out["mean_diff"] == pytest.approx(0.0)


def test_power_rises_with_effect_size():
    power = S.post_hoc_power([0.2, 1.0, 2.0], sd=1.0, n_folds=12, n_sim=400, seed=0)
    assert power[0.2] < power[1.0] <= power[2.0]


def test_small_effects_are_not_detectable_with_twelve_folds():
    """The honest constraint: 12 blocks cannot resolve a tiny effect."""
    power = S.post_hoc_power([0.15], sd=1.0, n_folds=12, n_sim=400, seed=0)
    assert power[0.15] < 0.5


def test_minimum_detectable_effect_is_finite_and_positive():
    mde = S.minimum_detectable_effect(sd=1.0, n_folds=12, n_sim=300, seed=0)
    assert np.isfinite(mde) and mde > 0
