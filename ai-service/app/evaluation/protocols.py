"""Evaluation protocols: four ways to split, deliberately kept side by side.

The point is not to pick one "correct" protocol and defend it. Wadoux et al.
(2021) are right that spatial cross-validation is not automatically the honest
choice; the defensible rule is to make the validation match the prediction
domain you actually claim. So all four are reported, and the *gap between them*
is itself a result:

``random``
    Rows shuffled. Optimistic by construction: with hourly data the same
    building's neighbouring hours land on both sides of the split. Included
    precisely so the inflation it produces can be measured rather than assumed.

``temporal``
    Train 2016, test 2017. Same buildings, later time. This answers "how well
    do we forecast for a building we already meter?"

``leave_buildings_out``
    Grouped k-fold with buildings as groups: the test building is never seen in
    training. This is the cold-start question -- a building with no meter
    history -- within known sites.

``leave_block_out``
    One spatial block held out entirely. Blocks, not sites: BDG2 sites closer
    than the dataset's own 40 km positional uncertainty are merged, so training
    on two London sites while testing on a third does not count as transfer to
    an unseen city. This is the strictest protocol and the one that matches a
    claim about generalising to a new city.

For the two grouped protocols, ``temporal_holdout=True`` (the default) also
restricts training to the train year and testing to the test year. Without it a
"cold-start" fold would train on the future of other buildings, which is not
the operational situation being claimed.

One-hot site identity is worth a note: under ``leave_block_out`` it is
structurally useless, because the held-out block has no column that was ever
non-zero in training. That is not a flaw to fix -- it is the asymmetry the whole
design rests on. Identity wins in-sample and is worthless out-of-sample;
transferable context is the only thing that can win out-of-sample.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Fold:
    """One train/test division."""

    label: str
    train_idx: np.ndarray
    test_idx: np.ndarray

    def __len__(self):
        return len(self.test_idx)


class Protocol:
    """Base class. Subclasses yield :class:`Fold` objects."""

    name = "base"
    #: Whether identity features (e.g. one-hot site) can carry information to
    #: the test set under this protocol. Recorded in results so an M3' control
    #: is never misread.
    identity_transfers = True

    def split(self, df, cohort=None, seed=0):  # pragma: no cover - interface
        raise NotImplementedError

    def describe(self):
        return {"name": self.name, "identity_transfers": self.identity_transfers}


class RandomSplit(Protocol):
    """Shuffled row split. Optimistic; reported as the upper bound."""

    name = "random"
    identity_transfers = True

    def __init__(self, test_size=0.25, n_repeats=1):
        self.test_size = test_size
        self.n_repeats = n_repeats

    def split(self, df, cohort=None, seed=0):
        n = len(df)
        for rep in range(self.n_repeats):
            rng = np.random.default_rng(seed + rep)
            perm = rng.permutation(n)
            cut = int(n * (1.0 - self.test_size))
            yield Fold(
                label="random_rep{}".format(rep),
                train_idx=perm[:cut],
                test_idx=perm[cut:],
            )


class TemporalSplit(Protocol):
    """Train on one year, test on the next. Same buildings."""

    name = "temporal"
    identity_transfers = True

    def __init__(self, train_year=2016, test_year=2017, year_col="year"):
        self.train_year = train_year
        self.test_year = test_year
        self.year_col = year_col

    def split(self, df, cohort=None, seed=0):
        years = df[self.year_col].to_numpy()
        train_idx = np.flatnonzero(years == self.train_year)
        test_idx = np.flatnonzero(years == self.test_year)
        yield Fold(label="2016->2017", train_idx=train_idx, test_idx=test_idx)


class _GroupedProtocol(Protocol):
    """Shared machinery for protocols that hold out whole groups."""

    def __init__(self, temporal_holdout=True, train_year=2016, test_year=2017, year_col="year"):
        self.temporal_holdout = temporal_holdout
        self.train_year = train_year
        self.test_year = test_year
        self.year_col = year_col

    def _apply_temporal(self, df, train_mask, test_mask):
        if not self.temporal_holdout or self.year_col not in df.columns:
            return train_mask, test_mask
        years = df[self.year_col].to_numpy()
        return train_mask & (years == self.train_year), test_mask & (years == self.test_year)

    def describe(self):
        d = super().describe()
        d["temporal_holdout"] = self.temporal_holdout
        return d


class LeaveBuildingsOut(_GroupedProtocol):
    """Grouped k-fold with buildings as groups -- cold start within known sites.

    True leave-one-building-out would need one fit per building (1381 fits per
    model). Grouped k-fold gives the same guarantee -- no test building appears
    in training -- at a tractable cost. ``n_folds`` is recorded in results so
    the approximation is never implicit.
    """

    name = "leave_buildings_out"
    identity_transfers = True  # site identity still transfers; building identity does not

    def __init__(self, n_folds=5, building_col="building_id", **kw):
        super().__init__(**kw)
        self.n_folds = n_folds
        self.building_col = building_col

    def split(self, df, cohort=None, seed=0):
        buildings = df[self.building_col].to_numpy()
        unique = np.array(sorted(pd.unique(buildings)))
        rng = np.random.default_rng(seed)
        assignment = rng.permutation(len(unique)) % self.n_folds
        fold_of_building = dict(zip(unique, assignment))
        codes = np.array([fold_of_building[b] for b in buildings])

        for k in range(self.n_folds):
            test_mask = codes == k
            train_mask = ~test_mask
            train_mask, test_mask = self._apply_temporal(df, train_mask, test_mask)
            if not test_mask.any() or not train_mask.any():
                continue
            yield Fold(
                label="buildings_fold{}".format(k),
                train_idx=np.flatnonzero(train_mask),
                test_idx=np.flatnonzero(test_mask),
            )


class LeaveBlockOut(_GroupedProtocol):
    """Hold out one spatial block -- transfer to an unseen city.

    Folds come from ``cohort.block_of_site``, which merges sites that are closer
    together than the dataset's documented positional uncertainty. Under this
    protocol identity features cannot transfer, which is the point.
    """

    name = "leave_block_out"
    identity_transfers = False

    def __init__(self, site_col="site_id", min_test_buildings=3, **kw):
        super().__init__(**kw)
        self.site_col = site_col
        self.min_test_buildings = min_test_buildings

    def split(self, df, cohort=None, seed=0):
        if cohort is None:
            raise ValueError("LeaveBlockOut needs a cohort for block_of_site")
        sites = df[self.site_col].to_numpy()
        blocks = np.array([cohort.block_of_site.get(s, s) for s in sites])

        for block in sorted(pd.unique(blocks)):
            test_mask = blocks == block
            train_mask = ~test_mask
            train_mask, test_mask = self._apply_temporal(df, train_mask, test_mask)
            if not test_mask.any() or not train_mask.any():
                continue
            n_test_buildings = df.loc[test_mask, "building_id"].nunique()
            if n_test_buildings < self.min_test_buildings:
                continue
            yield Fold(
                label=str(block),
                train_idx=np.flatnonzero(train_mask),
                test_idx=np.flatnonzero(test_mask),
            )


DEFAULT_PROTOCOLS = {
    "random": RandomSplit,
    "temporal": TemporalSplit,
    "leave_buildings_out": LeaveBuildingsOut,
    "leave_block_out": LeaveBlockOut,
}
