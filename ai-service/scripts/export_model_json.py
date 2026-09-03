"""Export the served XGBoost model so a browser can evaluate it.

A gradient-boosted tree ensemble is a pure function of a feature vector: walk
each tree, sum the leaves, invert the target transform. There is nothing about
that which needs a server, and on GitHub Pages there is no server to have. So
the showcase carries the model itself and runs it in the page.

Two things make this safe rather than a re-implementation people have to take
on faith:

* The trees are not retyped. They are read out of XGBoost's own
  ``save_model`` JSON -- the arrays the library writes -- and copied across
  unchanged. This script chooses what to keep, never what a split means.
* Every export writes a parity fixture next to the model. It has two halves,
  because the browser reproduces two things and they fail differently. The
  ``cases`` are end-to-end: a real building, a timestamp, a temperature, and
  the kWh this Python process predicted -- which is what PredictPanel asks for,
  so it catches a mistranslated feature as well as a mistranslated tree. The
  ``rows`` are bare design rows, sampled to hit the missing-value branches that
  real buildings only reach occasionally. The frontend test
  ``src/model/predictor.test.js`` replays both and fails on any disagreement
  beyond float noise, so a translation bug cannot ship quietly.

Float32 matters here. ``app.main.build_features`` casts the design row to
float32 and XGBoost compares in float32, while JavaScript numbers are float64.
A feature sitting exactly on a split threshold would otherwise take a different
branch in the two languages, so the fixture is generated from float32 inputs and
the JavaScript evaluator rounds with ``Math.fround``.

Usage (from ``ai-service/``)::

    python -m scripts.export_model_json
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import tempfile

import numpy as np

DEFAULT_MODEL_OUT = os.path.join("..", "frontend", "public", "model",
                                 "energy_cold_start.json")
DEFAULT_FIXTURE_OUT = os.path.join("..", "frontend", "src", "model",
                                   "parity-fixture.json")

# `build_features` measures a building's age against the end of the BDG2
# record. The balance point comes from app.main so the two cannot drift.
AGE_REFERENCE_YEAR = 2017.0

N_PARITY_ROWS = 200
N_PARITY_CASES = 150
PARITY_SEED = 20260903

# Days safely clear of every daylight-saving transition in the zones BDG2
# covers. The fixture crosses language boundaries, and `new Date("...T02:30")`
# on a spring-forward morning is a wrong answer nobody would think to look for.
SAFE_DAYS = [15, 20]


def _load_model(model_dir):
    import joblib

    model_path = os.path.join(model_dir, "energy_cold_start.joblib")
    meta_path = os.path.join(model_dir, "energy_cold_start_metadata.json")
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            "No production model at {}. Run "
            "`python -m app.experiments.train_production`.".format(model_path)
        )
    with open(meta_path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    return joblib.load(model_path), meta


def _validated_cv_rmse(meta):
    """The band PredictPanel shows, resolved exactly as the service resolves it.

    Shared with app.main rather than reimplemented: duplicating the choice here
    would be one more place for the published page to disagree with the API.
    """
    from app import model_metrics as MM

    return MM.validated_band(meta)


def _dump_trees(model):
    """The ensemble as five parallel arrays per tree, straight from XGBoost.

    Node ``i`` is a leaf when ``left[i] == -1``; then ``thresh[i]`` is its
    output value. Otherwise the node tests ``feature[i]`` against ``thresh[i]``
    and goes left when the value is smaller, or to ``default_left[i]`` when the
    value is missing.
    """
    booster = model.get_booster()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "model.json")
        booster.save_model(path)
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)

    learner = raw["learner"]
    objective = learner["objective"]["name"]
    if objective != "reg:squarederror":
        raise RuntimeError(
            "This exporter only handles reg:squarederror, which is what the "
            "production model trains with; got {!r}. The browser evaluator sums "
            "leaves and adds base_score, which is the identity link -- another "
            "objective would need its own inverse.".format(objective)
        )

    gbm = learner["gradient_booster"]["model"]
    if any(t != 0 for t in gbm.get("tree_info", [])):
        raise RuntimeError("Multi-output ensembles are not supported by this exporter.")

    trees = []
    for t in gbm["trees"]:
        if any(st != 0 for st in t.get("split_type", [])):
            raise RuntimeError(
                "Tree {} has a categorical split. The browser evaluator only "
                "implements numeric splits; the production model one-hot "
                "encodes primaryspaceusage, so this should not happen."
                .format(t.get("id"))
            )
        trees.append({
            "left": [int(v) for v in t["left_children"]],
            "right": [int(v) for v in t["right_children"]],
            "feature": [int(v) for v in t["split_indices"]],
            # Threshold on an internal node, leaf value on a leaf. XGBoost
            # stores both in this one array; keeping its layout means keeping
            # its meaning.
            "thresh": [float(np.float32(v)) for v in t["split_conditions"]],
            "default_left": [int(v) for v in t["default_left"]],
        })

    base_score = float(learner["learner_model_param"]["base_score"])
    n_features = int(learner["learner_model_param"]["num_feature"])

    # An early-stopped model predicts with a prefix of its trees. This one is
    # trained without an eval set, so the attribute is absent -- but a future
    # retrain that adds early stopping must not silently ship extra trees.
    best_iteration = (learner.get("attributes") or {}).get("best_iteration")
    if best_iteration is not None:
        keep = int(best_iteration) + 1
        if keep < len(trees):
            trees = trees[:keep]

    return trees, base_score, n_features


def _parity_cases(model, feature_columns, n, seed):
    """End-to-end cases: a real building, a timestamp, weather, and the answer.

    These go through ``app.main.build_features`` -- the function the browser
    mirrors -- rather than a second copy of it here, so the fixture is evidence
    about the real serving path and not about this script.

    Buildings are drawn to include the ones BDG2 leaves incomplete. Half the
    portfolio has no ``yearbuilt`` and a handful no recorded use; those rows
    exercise the branches a tidy sample would never reach.
    """
    import pandas as pd

    from app import main as M
    from app.data_engineering.load_buildings_to_db import building_rows

    usable = [r for r in building_rows() if r["meter_usable"] and (r["sqm"] or 0) > 0]
    if not usable:
        raise RuntimeError("No usable buildings in the metadata; cannot build a fixture.")

    rng = np.random.default_rng(seed)
    # Stratify on what is missing, so a sample of 150 cannot happen to contain
    # only fully-populated buildings.
    strata = [
        [b for b in usable if b["yearbuilt"] is None],
        [b for b in usable if b["numberoffloors"] is None],
        [b for b in usable if b["primaryspaceusage"] is None],
        usable,
    ]
    strata = [s for s in strata if s]

    cases = []
    for i in range(n):
        pool = strata[i % len(strata)]
        b = pool[int(rng.integers(0, len(pool)))]

        month = int(rng.integers(1, 13))
        day = SAFE_DAYS[int(rng.integers(0, len(SAFE_DAYS)))]
        hour = int(rng.integers(0, 24))
        timestamp = "{:04d}-{:02d}-{:02d}T{:02d}:00:00".format(2017, month, day, hour)

        t = round(float(rng.uniform(-20, 45)), 1)
        weather = {
            "airTemperature": t,
            # PredictPanel sends air minus 8; the endpoint's own default is
            # air minus 5 when the field is absent. Both paths are covered.
            "dewTemperature": None if rng.random() < 0.25 else round(t - 8.0, 1),
            "windSpeed": round(float(rng.uniform(0, 15)), 1),
            "cloudCoverage": round(float(rng.uniform(0, 8)), 1),
        }

        when = pd.to_datetime(timestamp)
        X = M.build_features(b, when, weather)
        raw = float(model.predict(X)[0])

        cases.append({
            "building": {k: b[k] for k in
                         ("site_id", "primaryspaceusage", "sqm", "yearbuilt", "numberoffloors")},
            "timestamp": timestamp,
            "weather": weather,
            # Written out so a timezone surprise in the browser fails as a
            # calendar mismatch rather than as an inexplicable number.
            "calendar": {"hour": when.hour, "day_of_week": when.weekday(), "month": when.month},
            "features": [None if np.isnan(v) else float(v) for v in X.iloc[0].to_numpy()],
            "raw": raw,
            "expected_energy_kwh": float(np.expm1(raw)),
        })
    return cases


def _random_rows(feature_columns, n, seed):
    """Feature rows spanning the ranges the panel can actually produce.

    The temperature slider runs -20..45 and the hour slider 0..23, so the
    fixture covers those rather than an abstract unit cube -- a parity test is
    only worth having over inputs the page can reach. Missing values appear too:
    half the portfolio has no ``yearbuilt``, and NaN takes the branch that
    ``default_left`` names.
    """
    from app import main as M

    rng = np.random.default_rng(seed)
    idx = {c: i for i, c in enumerate(feature_columns)}
    uses = [c.split("=", 1)[1] for c in feature_columns
            if c.startswith("primaryspaceusage=")]

    rows = np.full((n, len(feature_columns)), np.nan, dtype="float32")
    for r in range(n):
        t = float(rng.uniform(-20, 45))
        dew = t - float(rng.uniform(0, 12))
        when_hour = int(rng.integers(0, 24))
        dow = int(rng.integers(0, 7))
        values = {
            "hour": when_hour,
            "day_of_week": dow,
            "month": int(rng.integers(1, 13)),
            "is_weekend": int(dow >= 5),
            "airTemperature": t,
            "dewTemperature": dew,
            "windSpeed": float(rng.uniform(0, 15)),
            "cloudCoverage": float(rng.uniform(0, 8)),
            "cdh": max(t - M.BALANCE_POINT_C, 0.0),
            "hdh": max(M.BALANCE_POINT_C - t, 0.0),
            "log_sqm": float(np.log(rng.uniform(200, 200_000))),
        }
        # Absent attributes are the interesting case, so they are frequent here
        # by design rather than by accident of sampling.
        values["building_age"] = (np.nan if rng.random() < 0.4
                                  else AGE_REFERENCE_YEAR - float(rng.integers(1850, 2018)))
        values["numberoffloors"] = (np.nan if rng.random() < 0.4
                                    else float(rng.integers(1, 40)))
        for col, v in values.items():
            rows[r, idx[col]] = v
        if uses and rng.random() > 0.05:  # a few rows carry no known use
            rows[r, idx["primaryspaceusage=" + str(rng.choice(uses))]] = 1.0
        for u in uses:
            col = "primaryspaceusage=" + u
            if np.isnan(rows[r, idx[col]]):
                rows[r, idx[col]] = 0.0
    return rows


def export(model_dir=os.path.join("app", "models", "saved"),
           model_out=DEFAULT_MODEL_OUT, fixture_out=DEFAULT_FIXTURE_OUT):
    import pandas as pd

    from app import main as M

    model, meta = _load_model(model_dir)
    feature_columns = meta["feature_columns"]

    # `build_features` reads the module globals the service sets at startup.
    # Nothing here starts the service, so set them.
    M.MODEL, M.META = model, meta

    trees, base_score, n_features = _dump_trees(model)
    if n_features != len(feature_columns):
        raise RuntimeError(
            "Model expects {} features but the metadata lists {}. The two were "
            "written by the same training run, so this means one of them has "
            "been edited by hand.".format(n_features, len(feature_columns))
        )

    cv, protocol, aggregation, n_folds = _validated_cv_rmse(meta)

    bundle = {
        "format": "bei-xgb-trees/1",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "model_name": meta.get("model_name"),
        "spec": meta.get("spec"),
        "note": meta.get("note"),
        "trained_on_buildings": meta.get("n_train_buildings"),
        "feature_columns": feature_columns,
        "categorical_vocabulary": meta.get("categorical_vocabulary", {}),
        "balance_point_c": M.BALANCE_POINT_C,
        "age_reference_year": AGE_REFERENCE_YEAR,
        "inverse_transform": "expm1",
        "base_score": base_score,
        "band_basis": {"cv_rmse_pct": cv, "protocol": protocol,
                       "aggregation": aggregation, "n_folds": n_folds},
        "n_trees": len(trees),
        "trees": trees,
    }

    os.makedirs(os.path.dirname(os.path.abspath(model_out)), exist_ok=True)
    with open(model_out, "w", encoding="utf-8") as fh:
        json.dump(bundle, fh, separators=(",", ":"), allow_nan=False)

    # --- parity fixture ---------------------------------------------------
    cases = _parity_cases(model, feature_columns, N_PARITY_CASES, PARITY_SEED)

    rows = _random_rows(feature_columns, N_PARITY_ROWS, PARITY_SEED + 1)
    X = pd.DataFrame(rows, columns=feature_columns).astype("float32")
    raw = model.predict(X)

    os.makedirs(os.path.dirname(os.path.abspath(fixture_out)), exist_ok=True)
    with open(fixture_out, "w", encoding="utf-8") as fh:
        json.dump({
            "note": "Generated by ai-service/scripts/export_model_json.py; "
                    "replayed by src/model/predictor.test.js. `cases` are "
                    "end-to-end (building, timestamp and weather in, kWh out) "
                    "and check the whole browser path. `rows` are bare design "
                    "rows chosen to hit the missing-value branches.",
            "generated_at": bundle["generated_at"],
            "seed": PARITY_SEED,
            "feature_columns": feature_columns,
            "cases": cases,
            "rows": {
                "features": [[None if np.isnan(v) else float(v) for v in row] for row in rows],
                "raw": [float(v) for v in raw],
                "expected_energy_kwh": [float(v) for v in np.expm1(raw)],
            },
        }, fh, separators=(",", ":"), allow_nan=False)

    size = os.path.getsize(model_out)
    print("wrote {} ({} trees, {:.1f} MB)".format(
        os.path.abspath(model_out), len(trees), size / 1e6))
    print("wrote {} ({} cases, {} rows)".format(
        os.path.abspath(fixture_out), len(cases), N_PARITY_ROWS))
    return bundle


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--model-dir", default=os.path.join("app", "models", "saved"))
    p.add_argument("--out", default=DEFAULT_MODEL_OUT)
    p.add_argument("--fixture", default=DEFAULT_FIXTURE_OUT)
    args = p.parse_args(argv)
    export(model_dir=args.model_dir, model_out=args.out, fixture_out=args.fixture)
    return 0


if __name__ == "__main__":
    sys.exit(main())
