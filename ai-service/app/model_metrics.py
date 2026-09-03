"""Which error figure the product quotes, and what it is an average of.

The served model ships with the held-out metrics it was validated on, and two
places quote them: the prediction band in the dashboard, and the gate that
decides whether a building is flagged for audit. Both used to read the field
``cv_rmse_median_pct`` and call the result "the validated CV(RMSE)".

That field holds a **mean over folds**, not a median. ``train_production``
computes ``per_fold.mean()`` and stores it under a key whose name says median.
The two are far apart here and for a reason worth keeping in view: of the 12
held-out cities, eleven score between 54% and 68%, and Lamb scores 244%. The
median is 59.5; the mean is 75.7.

So the dashboard showed 59.5% in the results table and 75.7% in the prediction
band, one screen apart, both labelled CV(RMSE) for the same model under the
same protocol, with nothing to say they were different aggregations.

This module fixes the naming, not the choice. The product still quotes the
fold mean -- the more conservative number, and the one the published screening
results were produced with -- but now says so. Whether a band and an audit gate
are better served by the mean or the median is a question about the analysis,
and it is left where it belongs.

Metadata written before this was corrected carries only the mis-named key.
:func:`validated_band` reads both shapes and reports the same value for each,
so an existing model file keeps working and keeps meaning what it meant.
"""

from __future__ import annotations

# Strictest first. A band quoted from `random` when `leave_block_out` exists
# would understate the error on exactly the case the model is sold for.
PROTOCOL_PRIORITY = ("leave_block_out", "leave_buildings_out", "temporal", "random")

MEAN_KEY = "cv_rmse_mean_pct"
LEGACY_KEY = "cv_rmse_median_pct"


def validated_band(meta):
    """The error band to quote, as ``(value, protocol, aggregation, n_folds)``.

    ``aggregation`` is the word for what ``value`` averages over, so a caller
    can label it honestly instead of guessing. All four are ``None`` when the
    model carries no held-out metrics -- which is a refusal to answer, not a
    zero.
    """
    metrics = (meta or {}).get("held_out_metrics") or {}
    for protocol in PROTOCOL_PRIORITY:
        entry = metrics.get(protocol)
        if not entry:
            continue
        # Present only in metadata written after the naming was corrected.
        value = entry.get(MEAN_KEY)
        if value:
            return value, protocol, "mean_over_folds", entry.get("n_folds")
        # Older metadata: the median-named field holds the fold mean.
        value = entry.get(LEGACY_KEY)
        if value:
            return value, protocol, "mean_over_folds", entry.get("n_folds")
    return None, None, None, None


def describe_band(value, protocol, aggregation, n_folds):
    """A phrase a reader can reconcile with the results table."""
    if value is None:
        return None
    over = "over {} folds".format(n_folds) if n_folds else "over folds"
    word = "mean" if aggregation == "mean_over_folds" else "median"
    return "{:.1f}% CV(RMSE), the {} {} of the {} protocol".format(
        value, word, over, protocol)
