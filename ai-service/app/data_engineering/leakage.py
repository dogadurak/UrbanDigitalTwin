"""Guards against building-identity leaking into a "spatial" feature set.

This module exists because of a concrete failure in this repository's own
history, documented in ``archive/legacy_v3/README.md``.

Eight variables were presented as satellite/OSM/terrain context for four
buildings: NDVI, NDMI, NDBI, building density, road density, green ratio,
elevation and slope, plus latitude and longitude fed to the model directly.
Every one of them took a single constant value per building. With four
buildings, any of those variables is a bijective re-encoding of
``building_id`` -- a lookup key wearing a geoscience label. The reported
"spatial improvement" was the model learning which building it was looking at.

The measurement that settles it needs no model. On the same test split,
predicting each building's constant mean gives R2 = 0.9188, while every
spatial ablation variant scored 0.8899-0.8910 and the variant with no
building-identifying feature at all scored -0.0004.

The trap is not that constant-per-building features are forbidden -- floor area
is constant per building and is a legitimate, strong predictor. The trap is
*cardinality*: when a feature set has as many distinct combinations as there
are buildings, it identifies the building uniquely, and a tree model will use
it as an index no matter what the column is named.

So the guard measures identifiability directly, and callers decide whether the
level found is acceptable for the claim they intend to make.
"""

from __future__ import annotations

import pandas as pd

# Column roles. Only FEATURE_ROLES may be handed to a model.
ROLE_IDENTIFIER = "identifier"
ROLE_TARGET = "target"
ROLE_CALENDAR = "calendar"
ROLE_WEATHER = "weather"
ROLE_BUILDING_ATTRIBUTE = "building_attribute"
ROLE_SPATIAL = "spatial"
ROLE_QUALITY = "quality"

FEATURE_ROLES = {ROLE_CALENDAR, ROLE_WEATHER, ROLE_BUILDING_ATTRIBUTE, ROLE_SPATIAL}

# Columns that must never reach a model as features. `lat`/`lng` are listed
# because in BDG2 they are site centroids: 14 usable distinct pairs across the
# whole portfolio, i.e. a site label expressed in degrees.
FORBIDDEN_AS_FEATURES = {
    "building_id",
    "site_id",
    "timestamp",
    "lat",
    "lng",
    "lon",
    "meter_reading",
    "eui_wh_m2",
}


class IdentityLeakageError(AssertionError):
    """Raised when a feature set uniquely identifies buildings."""


def constant_per_building(df, columns, building_col="building_id"):
    """Return the subset of ``columns`` that never vary within a building."""
    present = [c for c in columns if c in df.columns]
    if not present:
        return []
    nunique = df.groupby(building_col)[present].nunique(dropna=False)
    return [c for c in present if (nunique[c] <= 1).all()]


def identifiability(df, columns, building_col="building_id"):
    """Measure how completely ``columns`` pin down building identity.

    Returns a dict with:

    ``n_buildings``
        Buildings present in ``df``.
    ``n_distinct_profiles``
        Distinct value-combinations of ``columns`` across buildings, using only
        the columns that are constant within a building (a time-varying column
        cannot serve as a stable key).
    ``frac_uniquely_identified``
        Share of buildings whose profile is unique to them. **1.0 means the
        feature set is a building ID.**
    ``constant_columns``
        Which of ``columns`` are constant per building.
    """
    present = [c for c in columns if c in df.columns]
    n_buildings = int(df[building_col].nunique())
    const_cols = constant_per_building(df, present, building_col)

    if not const_cols or n_buildings == 0:
        return {
            "n_buildings": n_buildings,
            "n_distinct_profiles": 0,
            "frac_uniquely_identified": 0.0,
            "constant_columns": [],
        }

    profiles = (
        df.groupby(building_col)[const_cols]
        .first()
        .astype(str)
        .agg("|".join, axis=1)
    )
    counts = profiles.value_counts()
    n_unique_buildings = int((profiles.map(counts) == 1).sum())

    return {
        "n_buildings": n_buildings,
        "n_distinct_profiles": int(counts.size),
        "frac_uniquely_identified": float(n_unique_buildings / n_buildings),
        "constant_columns": const_cols,
    }


def check_feature_set(df, features, building_col="building_id", max_identifiability=0.99):
    """Validate a feature set before training. Raises on hard violations.

    Two rules:

    1. No column in :data:`FORBIDDEN_AS_FEATURES` may appear. These are keys and
       targets, not predictors.
    2. The constant-per-building part of the feature set must not uniquely
       identify (nearly) every building.

    ``max_identifiability`` is deliberately not 0: building attributes such as
    floor area legitimately differ between buildings, and on a large portfolio
    they will identify some buildings uniquely. The threshold catches the case
    that matters -- a feature set that resolves *essentially every* building,
    which is what makes a "spatial" result meaningless.

    Returns the identifiability report so callers can record it alongside
    results.
    """
    forbidden = sorted(set(features) & FORBIDDEN_AS_FEATURES)
    if forbidden:
        raise IdentityLeakageError(
            "These columns are identifiers or targets and must not be used as "
            "features: {}. In BDG2, lat/lng are site centroids shared by every "
            "building at a site.".format(", ".join(forbidden))
        )

    report = identifiability(df, features, building_col)
    if report["frac_uniquely_identified"] > max_identifiability and report["n_buildings"] > 1:
        raise IdentityLeakageError(
            "Feature set uniquely identifies {:.1%} of {} buildings via the "
            "constant-per-building columns {}. Any performance gain from these "
            "features is building identity, not context. See "
            "archive/legacy_v3/README.md.".format(
                report["frac_uniquely_identified"],
                report["n_buildings"],
                report["constant_columns"],
            )
        )
    return report


def building_mean_r2(df, target_col, building_col="building_id"):
    """R2 obtainable by predicting each building's mean -- the leakage yardstick.

    This is the number any model using building-identifying features must be
    compared against. A "spatial" model that does not clearly beat it has
    demonstrated nothing beyond knowing which building it is looking at.
    """
    y = df[target_col].astype("float64")
    grand = y.mean()
    per_building = df.groupby(building_col)[target_col].transform("mean")
    ss_tot = float(((y - grand) ** 2).sum())
    if ss_tot == 0:
        return 0.0
    ss_res = float(((y - per_building) ** 2).sum())
    return float(1.0 - ss_res / ss_tot)
