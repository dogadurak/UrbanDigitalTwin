"""The model ladder, and the two tasks it is run under.

Two tasks, not one
------------------
Hourly building load is dominated by its own recent past. Measured across the
full 1381-building cohort (not the four-building pilot, where the effect looked
larger still):

    persistence R2 (predict last hour)   median 0.880
    variance left after lag_1            median 12.0%,  p75 19.9%

So in a model that already has ``energy_lag_1``, weather, building attributes
and any urban context together compete for roughly a tenth of the variance.
Reporting "context adds nothing" from such a model would describe the design,
not the world. The ladder is therefore run under two separate tasks:

``forecast``
    Lags available. Realistic for a metered building; context is expected to be
    irrelevant here and that expectation is cheap to confirm.

``cold_start``
    No lags at all. A building with no meter history, which is the operational
    case where location is the only thing known -- and the only setting where a
    contextual claim can be tested. This matches the GEPIII framing.

The ladder
----------
========  ==========================================================
M0        Seasonal-naive: hour x weekday mean. For ``cold_start`` this
          is pooled across training buildings, since an unseen building
          has no history of its own.
M1        + calendar
M2        + weather (and degree-hours derived from it)
M3        + building attributes: log floor area, use, age, floors
M3'       M2 + one-hot site identity  <- the control arm
========  ==========================================================

Why M3' decides things
----------------------
Site identity is a perfect, low-cardinality encoding of location: 12 blocks.
Every site-level contextual variable is a lossy compression of it, so in-sample
no such variable can beat it. That makes M3' the ceiling under ``random`` and
``temporal``.

Under ``leave_block_out`` the held-out block has no identity column that was
ever non-zero in training, so M3' collapses to M2 by construction. The
comparison there is against M3, not M3'. This asymmetry is the whole point:
identity wins in-sample and is worthless out-of-sample, so anything that wins
out-of-sample must be carrying transferable information rather than a label.

Target
------
``log1p(meter_reading)``, with metrics computed after back-transforming to kWh.
Log aligns the loss with the relative-error metric (CV(RMSE)); floor area enters
as a feature rather than as a divisor, because energy scales sublinearly with
area in this dataset (fitted exponent 0.895, not the 1.0 that dividing by area
would impose). Retransformation bias is not hidden -- it shows up in NMBE, which
is reported beside CV(RMSE) for exactly this reason.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

BALANCE_POINT_C = 18.0

CALENDAR = ["hour", "day_of_week", "month", "is_weekend"]
WEATHER = ["airTemperature", "dewTemperature", "windSpeed", "cloudCoverage", "cdh", "hdh"]
BUILDING = ["log_sqm", "building_age", "numberoffloors"]
BUILDING_CAT = ["primaryspaceusage"]
LAGS = ["energy_lag_1", "energy_lag_24", "energy_lag_168", "energy_roll_24"]

TARGET = "target_log"
TARGET_RAW = "meter_reading"


def inverse_target(v):
    """Back-transform model space to kWh. Metrics are only meaningful here."""
    return np.expm1(np.asarray(v, dtype="float64"))


def add_derived(df):
    """Add target, degree-hours and building-attribute transforms."""
    out = df.copy()
    out[TARGET] = np.log1p(out[TARGET_RAW].clip(lower=0.0))

    t = out["airTemperature"].astype("float64")
    out["cdh"] = (t - BALANCE_POINT_C).clip(lower=0.0)
    out["hdh"] = (BALANCE_POINT_C - t).clip(lower=0.0)

    sqm = out["sqm"].astype("float64")
    out["log_sqm"] = np.log(sqm.where(sqm > 0))
    out["building_age"] = 2017.0 - out["yearbuilt"].astype("float64")
    out["numberoffloors"] = out["numberoffloors"].astype("float64")
    return out


def lag_features_for_horizon(horizon):
    """Which lags a forecast at ``horizon`` hours ahead may legally use.

    Forecasting the value at t+h from information available at t, the most
    recent reading is h hours before the target. A model predicting a week
    ahead cannot use last hour's meter reading, and quoting a 1-hour-ahead
    accuracy as though it were a general forecast figure overstates what the
    system can do.
    """
    return [name for name, lag in (("energy_lag_1", 1), ("energy_lag_24", 24),
                                   ("energy_lag_168", 168)) if lag >= horizon] +            ["energy_roll_24"]


def add_lags(df, horizon=1):
    """Autoregressive features valid for a forecast ``horizon`` hours ahead.

    Rolling means are shifted by the horizon as well, so no window overlaps
    information that would not yet exist when the forecast is made.
    """
    out = df.sort_values(["building_id", "timestamp"]).copy()
    g = out.groupby("building_id")[TARGET_RAW]
    out["energy_lag_1"] = g.shift(1)
    out["energy_lag_24"] = g.shift(24)
    out["energy_lag_168"] = g.shift(168)
    out["energy_roll_24"] = g.transform(
        lambda s: s.shift(horizon).rolling(24, min_periods=6).mean()
    )
    return out


class SeasonalNaive:
    """M0: mean of the target by (hour, weekday), learned on training rows.

    Pooled across buildings rather than per building, because in ``cold_start``
    the test building contributes no training rows. Falls back to the global
    training mean for unseen combinations.
    """

    def __init__(self, seed=0):
        self.table_ = None
        self.fallback_ = 0.0

    def fit(self, X, y):
        X = pd.DataFrame(X)
        key = self._key(X)
        s = pd.Series(np.asarray(y, dtype="float64"))
        self.table_ = s.groupby(key.to_numpy()).mean()
        self.fallback_ = float(s.mean())
        return self

    def predict(self, X):
        X = pd.DataFrame(X)
        key = self._key(X)
        return key.map(self.table_).fillna(self.fallback_).to_numpy(dtype="float64")

    @staticmethod
    def _key(X):
        hour = X["hour"] if "hour" in X.columns else X.iloc[:, 0]
        dow = X["day_of_week"] if "day_of_week" in X.columns else X.iloc[:, 1]
        return (hour.astype(int) * 10 + dow.astype(int)).rename("key")


def xgb_factory(n_estimators=250, max_depth=6, learning_rate=0.08, subsample=0.8,
                colsample_bytree=0.8, n_jobs=4):
    """Gradient boosting, per the GEPIII post-mortem: boosting, not deep nets."""

    def build(seed):
        import xgboost as xgb

        return xgb.XGBRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            subsample=subsample,
            colsample_bytree=colsample_bytree,
            tree_method="hist",
            random_state=int(seed),
            n_jobs=n_jobs,
            verbosity=0,
        )

    return build


def build_specs(task="cold_start", factory=None, horizon=1):
    """Return the ladder for a task, as ModelSpec objects."""
    from app.evaluation.harness import ModelSpec

    factory = factory or xgb_factory()
    lag_features = lag_features_for_horizon(horizon) if task == "forecast" else []
    suffix = "" if task == "cold_start" else " (+lags, h={}h)".format(horizon)

    specs = [
        ModelSpec(
            name="M0_seasonal_naive",
            features=["hour", "day_of_week"],
            factory=SeasonalNaive,
            description="hour x weekday mean, pooled over training buildings",
        ),
        ModelSpec(
            name="M1_calendar",
            features=CALENDAR + lag_features,
            factory=factory,
            description="calendar" + suffix,
        ),
        ModelSpec(
            name="M2_weather",
            features=CALENDAR + WEATHER + lag_features,
            factory=factory,
            description="calendar + weather + degree-hours" + suffix,
        ),
        ModelSpec(
            name="M3_building",
            features=CALENDAR + WEATHER + BUILDING + lag_features,
            categorical=BUILDING_CAT,
            factory=factory,
            description="+ floor area, use, age, floors" + suffix,
        ),
        ModelSpec(
            name="M3prime_site_identity",
            features=CALENDAR + WEATHER + lag_features,
            identity_features=["site_id"],
            factory=factory,
            description=(
                "M2 + one-hot site identity. Ceiling under random/temporal; "
                "structurally collapses to M2 under leave_block_out."
            ),
        ),
    ]
    return specs
