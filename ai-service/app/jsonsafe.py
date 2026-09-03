"""Getting pandas output past the JSON encoder the server actually uses.

Starlette serialises responses with ``json.dumps(..., allow_nan=False)``. A NaN
anywhere in a response body is therefore not a cosmetic problem: the request
fails with a 500 and the client is told nothing about why.

NaN is common here and usually *means* something. BDG2 records no ``yearbuilt``
for about half the portfolio, and a paired contrast over five folds has no
detectable effect to report. Both are findings. Both must reach the client as
``null`` -- not as NaN, which breaks the response, and not by dropping the key,
which would make "we do not know" indistinguishable from "we did not look".

The obvious guard does not work, and both endpoints in this service had written
it::

    df = df.where(pd.notna(df), None)   # no-op on a float column

pandas stores that ``None`` straight back as NaN. The conversion has to happen
after leaving pandas, which is what this module is for.
"""

from __future__ import annotations

import math

import pandas as pd


def scrub(value):
    """Return ``value`` with every NaN replaced by ``None``, recursively."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v) for v in value]
    if isinstance(value, float):
        # Infinity is not JSON either. Unlike NaN it never means "not
        # recorded" -- it means a division by zero upstream -- but null is
        # still the only honest thing to send, and far better than a 500 that
        # says nothing.
        return value if math.isfinite(value) else None
    if value is None or isinstance(value, (str, bool, int)):
        return value
    # numpy scalars, pandas NA, datetimes: ask pandas, which knows about all of
    # them, then let the encoder handle whatever is left.
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):  # arrays and other non-scalars
        pass
    return value


def records(df):
    """``df.to_dict(orient="records")``, JSON-safe."""
    return [scrub(record) for record in df.to_dict(orient="records")]
