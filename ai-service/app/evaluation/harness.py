"""Run a model specification across protocols and collect honest results.

The harness is deliberately model- and dataset-agnostic. BDG2 cannot answer the
spatial question (site coordinates are city-level with a 40 km bound), so this
code is expected to outlive the dataset it was written against: when
per-building coordinates arrive, only the feature groups and the cohort change.

What it guarantees on every run:

* features are checked for building-identity leakage before any fit;
* metrics are computed per building, then aggregated per fold;
* several seeds are run and the seed is recorded;
* each result carries the protocol, cohort, fold structure, row sampling and
  git SHA that produced it.

Nothing here selects a winner. It produces per-fold numbers; comparison and
power live in ``stats.py`` and the decision stays with the reader.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.data_engineering import leakage
from app.evaluation import metrics as M


def _git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:
        return "unknown"


@dataclass
class ModelSpec:
    """A named model: which columns it sees and how it is built.

    ``factory`` takes a seed and returns an unfitted estimator exposing
    ``fit(X, y)`` and ``predict(X)``.

    ``categorical`` columns are one-hot encoded. ``identity_features`` names any
    column included *deliberately* as an identity control (the M3' arm), so the
    leakage guard permits it and results can flag it.
    """

    name: str
    features: list
    factory: object
    categorical: list = field(default_factory=list)
    identity_features: list = field(default_factory=list)
    description: str = ""

    @property
    def all_features(self):
        return list(self.features) + list(self.categorical) + list(self.identity_features)


def _design_matrix(df, spec, categories=None):
    """Build X for a spec, one-hot encoding categoricals with a fixed vocabulary.

    The vocabulary is learned on training data and reused on test data, so a
    category unseen in training becomes an all-zero row rather than a new
    column. That is exactly what must happen to one-hot site identity under
    leave-one-block-out: the held-out block has no column, which is why identity
    cannot transfer.
    """
    parts = [df[spec.features].astype("float32")] if spec.features else []
    learned = {}
    for col in list(spec.categorical) + list(spec.identity_features):
        vocab = categories[col] if categories and col in categories else sorted(
            pd.Series(df[col].dropna().unique()).astype(str).tolist()
        )
        learned[col] = vocab
        codes = df[col].astype(str)
        block = pd.DataFrame(
            {"{}={}".format(col, v): (codes == v).astype("float32") for v in vocab},
            index=df.index,
        )
        parts.append(block)
    if not parts:
        raise ValueError("ModelSpec {} has no features".format(spec.name))
    X = pd.concat(parts, axis=1)
    return X, learned


def run_spec(df, spec, protocol, cohort=None, target="target", seeds=(0,),
             check_leakage=True, max_identifiability=0.99, verbose=True,
             inverse_transform=None):
    """Run one model spec under one protocol. Returns per-fold rows.

    ``df`` must contain ``building_id``, ``site_id``, the target and every
    feature the spec names.

    ``inverse_transform`` maps model space back to the reporting scale before
    metrics are computed. With a log target this matters: CV(RMSE) and NMBE are
    only interpretable in physical units, and computing them in log space would
    quietly report a different, flattering quantity. Applying it to actuals and
    predictions alike also means retransformation bias lands in NMBE, where it
    belongs, instead of disappearing.
    """
    if check_leakage:
        # identity_features are exempt: they are the control arm, declared.
        leakage.check_feature_set(
            df,
            list(spec.features) + list(spec.categorical),
            max_identifiability=max_identifiability,
        )

    rows = []
    for seed in seeds:
        for fold in protocol.split(df, cohort=cohort, seed=seed):
            tr, te = df.iloc[fold.train_idx], df.iloc[fold.test_idx]
            if tr.empty or te.empty:
                continue

            X_tr, vocab = _design_matrix(tr, spec)
            X_te, _ = _design_matrix(te, spec, categories=vocab)
            X_te = X_te.reindex(columns=X_tr.columns, fill_value=0.0)

            y_tr = tr[target].to_numpy(dtype="float64")
            y_te = te[target].to_numpy(dtype="float64")

            t0 = time.time()
            model = spec.factory(seed)
            model.fit(X_tr, y_tr)
            pred = np.asarray(model.predict(X_te), dtype="float64")
            fit_seconds = time.time() - t0

            if inverse_transform is not None:
                y_report = np.asarray(inverse_transform(y_te), dtype="float64")
                pred_report = np.asarray(inverse_transform(pred), dtype="float64")
            else:
                y_report, pred_report = y_te, pred

            pb = M.per_building(y_report, pred_report, te["building_id"].to_numpy())
            agg = M.aggregate(pb)

            row = {
                "model": spec.name,
                "protocol": protocol.name,
                "fold": fold.label,
                "seed": int(seed),
                "n_train": int(len(tr)),
                "n_test": int(len(te)),
                "n_features": int(X_tr.shape[1]),
                "identity_transfers": protocol.identity_transfers,
                "has_identity_arm": bool(spec.identity_features),
                "fit_seconds": round(fit_seconds, 2),
            }
            row.update(agg)
            rows.append(row)

            if verbose:
                print(
                    "  {:<22s} {:<20s} {:<14s} seed={} "
                    "CV(RMSE) med={:7.2f}%  NMBE med={:+7.2f}%  ({}s)".format(
                        spec.name, protocol.name, fold.label, seed,
                        agg["cv_rmse_median"], agg["nmbe_median"], int(fit_seconds),
                    )
                )
    return pd.DataFrame(rows)


def run_matrix(df, specs, protocols, cohort=None, target="target", seeds=(0,),
               verbose=True, **kw):
    """Run every spec under every protocol."""
    frames = []
    for protocol in protocols:
        if verbose:
            print("\n=== protocol: {} ===".format(protocol.name))
        for spec in specs:
            frames.append(
                run_spec(df, spec, protocol, cohort=cohort, target=target,
                         seeds=seeds, verbose=verbose, **kw)
            )
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def save_results(results, out_dir, run_meta):
    """Write results plus the provenance needed to reproduce them."""
    os.makedirs(out_dir, exist_ok=True)
    results.to_csv(os.path.join(out_dir, "fold_results.csv"), index=False)
    meta = dict(run_meta)
    meta["git_sha"] = _git_sha()
    meta["written_at"] = pd.Timestamp.utcnow().isoformat()
    with open(os.path.join(out_dir, "run.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, default=str)
    return out_dir
