"""Uncertainty, paired comparison and honest power reporting.

Three rules this module exists to enforce:

1. **No single number.** Every reported metric carries a bootstrap interval.
2. **Compare paired, on folds.** Two models are compared on the same folds, so
   the paired difference removes fold difficulty as a nuisance.
3. **Report the power you actually had.** With 12 spatial blocks, a paired
   Wilcoxon test detects a large effect and misses a small one. Publishing "no
   significant difference" without saying which effects were detectable is not
   a null result, it is an underpowered test. :func:`post_hoc_power` uses the
   *observed* fold-level spread rather than an assumed one.
"""

from __future__ import annotations

import numpy as np

try:  # scipy is present via scikit-learn, but keep the fallback explicit.
    from scipy.stats import wilcoxon as _scipy_wilcoxon
except Exception:  # pragma: no cover
    _scipy_wilcoxon = None


def bootstrap_ci(values, n_boot=10000, alpha=0.05, seed=0, statistic=np.mean):
    """Percentile bootstrap interval for ``statistic`` over ``values``."""
    v = np.asarray([x for x in values if np.isfinite(x)], dtype="float64")
    if v.size == 0:
        return {"point": np.nan, "lo": np.nan, "hi": np.nan, "n": 0}
    if v.size == 1:
        return {"point": float(v[0]), "lo": float(v[0]), "hi": float(v[0]), "n": 1}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, v.size, size=(n_boot, v.size))
    stats = statistic(v[idx], axis=1)
    lo, hi = np.percentile(stats, [100 * alpha / 2.0, 100 * (1 - alpha / 2.0)])
    return {
        "point": float(statistic(v)),
        "lo": float(lo),
        "hi": float(hi),
        "n": int(v.size),
    }


def _wilcoxon_statistic(d):
    """Signed-rank statistic, used when scipy is unavailable."""
    d = np.asarray(d, dtype="float64")
    d = d[np.isfinite(d) & (d != 0)]
    n = d.size
    if n == 0:
        return np.nan, 0
    order = np.argsort(np.abs(d))
    ranks = np.empty(n, dtype="float64")
    ranks[order] = np.arange(1, n + 1)
    return float(min(ranks[d > 0].sum(), ranks[d < 0].sum())), n


def paired_comparison(a, b, seed=0):
    """Compare two models across the same folds.

    ``a`` and ``b`` are per-fold metric values in matching fold order, lower is
    better (CV(RMSE)). The reported difference is ``a - b``: negative means
    ``a`` is better.
    """
    a = np.asarray(a, dtype="float64")
    b = np.asarray(b, dtype="float64")
    if a.shape != b.shape:
        raise ValueError("paired_comparison needs matching fold counts")
    mask = np.isfinite(a) & np.isfinite(b)
    d = a[mask] - b[mask]
    n = d.size

    out = {
        "n_folds": int(n),
        "mean_diff": float(d.mean()) if n else np.nan,
        "median_diff": float(np.median(d)) if n else np.nan,
        "sd_diff": float(d.std(ddof=1)) if n > 1 else np.nan,
        "n_folds_improved": int((d < 0).sum()),
        "ci": bootstrap_ci(d, seed=seed),
        "p_value": np.nan,
        "test": "none",
    }

    # Relative effect against b's own level, which is how a CV(RMSE)
    # improvement is normally quoted.
    b_level = float(np.mean(b[mask])) if n else np.nan
    out["relative_effect"] = float(-d.mean() / b_level) if n and b_level else np.nan

    if n >= 3:
        if _scipy_wilcoxon is not None:
            try:
                res = _scipy_wilcoxon(d)
                out["p_value"] = float(res.pvalue)
                out["test"] = "wilcoxon_signed_rank"
            except ValueError:
                pass
        else:  # pragma: no cover
            stat, nn = _wilcoxon_statistic(d)
            out["wilcoxon_statistic"] = stat
            out["test"] = "wilcoxon_statistic_only"
    return out


def post_hoc_power(effect_sizes, sd, n_folds, alpha=0.05, n_sim=20000, seed=0):
    """Simulated power of a paired Wilcoxon test at the observed spread.

    ``sd`` should be the **observed** fold-level standard deviation of the
    paired difference, not a guess. Returns power for each candidate effect,
    expressed in the same units as ``sd``.
    """
    rng = np.random.default_rng(seed)
    out = {}
    if not np.isfinite(sd) or sd <= 0 or n_folds < 3:
        return {float(e): np.nan for e in effect_sizes}

    for eff in effect_sizes:
        draws = rng.normal(eff, sd, size=(n_sim, n_folds))
        if _scipy_wilcoxon is not None:
            rejects = 0
            for row in draws:
                try:
                    if _scipy_wilcoxon(row).pvalue < alpha:
                        rejects += 1
                except ValueError:
                    pass
            out[float(eff)] = rejects / n_sim
        else:  # pragma: no cover
            out[float(eff)] = np.nan
    return out


def minimum_detectable_effect(sd, n_folds, target_power=0.8, alpha=0.05,
                              grid=None, n_sim=4000, seed=0):
    """Smallest effect detectable at ``target_power``, given observed spread."""
    if grid is None:
        grid = np.linspace(0.05 * sd, 3.0 * sd, 24) if np.isfinite(sd) and sd > 0 else []
    for eff in grid:
        p = post_hoc_power([eff], sd, n_folds, alpha=alpha, n_sim=n_sim, seed=seed)
        if p.get(float(eff), 0.0) >= target_power:
            return float(eff)
    return np.nan
