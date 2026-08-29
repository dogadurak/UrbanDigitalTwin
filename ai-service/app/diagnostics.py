"""From "this building uses too much" to "here is what to check".

Screening produces a ranked list. That is still only half an answer: a facility
manager handed "9.8x the median for Education" does not know whether to look at
the boiler, the chiller, the BMS schedule or a server cupboard.

This module reads the *shape* of a building's measured load and compares each
shape metric against the same peer group used for screening. Shape carries
diagnostic information that annual totals do not:

``base_peak``
    5th percentile over 95th percentile of hourly demand. How much of the peak
    is simply always on. A building that genuinely powers down overnight sits
    low; one that never stops sits high.
``night_day``
    Mean demand 22:00-06:00 over mean demand 08:00-18:00 on weekdays. A high
    value means the building is not being switched off out of hours.
``weekend_weekday``
    Weekend mean over weekday mean. A high value on a school or office means no
    weekend setback is in effect.
``summer_shoulder`` / ``winter_shoulder``
    Summer (Jun-Aug) and winter (Dec-Feb) means against the shoulder months
    (Apr, May, Sep, Oct), which approximate a low-conditioning baseline. These
    separate a cooling problem from an electric-heating one.

Every metric is reported **against its peer group**, because the absolute value
means little on its own: 0.41 base-to-peak is unremarkable for a hospital and
poor for a primary school.

These are hypotheses to check, not conclusions
----------------------------------------------
A high overnight load is consistent with a scheduling fault; it is equally
consistent with a data centre, a 24-hour clinic or a research facility with
freezers. The output names what to inspect and why, and says what would rule
each hypothesis out. Nothing here should be presented to a building owner as a
finding without a site visit.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

ENERGY_ROOT = os.path.join("data", "processed", "energy")

SHOULDER_MONTHS = (4, 5, 9, 10)
SUMMER_MONTHS = (6, 7, 8)
WINTER_MONTHS = (12, 1, 2)

#: A metric must exceed this quantile of its peer group to raise a finding.
PEER_QUANTILE = 0.75

#: ...and exceed the peer median by at least this relative margin, so a
#: building that is barely above a tight distribution is not flagged.
MIN_RELATIVE_MARGIN = 0.15


def _safe_ratio(numer, denom):
    if denom is None or not np.isfinite(denom) or denom <= 0:
        return np.nan
    return float(numer / denom)


def load_shape(df):
    """Shape metrics for one building's hourly series."""
    v = df["meter_reading"]
    if len(v) < 500:
        return {}

    peak = float(v.quantile(0.95))
    base = float(v.quantile(0.05))
    night = df.loc[(df["hour"] < 6) | (df["hour"] >= 22), "meter_reading"].mean()
    day = df.loc[(df["hour"] >= 8) & (df["hour"] < 18) & (df["day_of_week"] < 5),
                 "meter_reading"].mean()
    weekend = df.loc[df["day_of_week"] >= 5, "meter_reading"].mean()
    weekday = df.loc[df["day_of_week"] < 5, "meter_reading"].mean()
    shoulder = df.loc[df["month"].isin(SHOULDER_MONTHS), "meter_reading"].mean()
    summer = df.loc[df["month"].isin(SUMMER_MONTHS), "meter_reading"].mean()
    winter = df.loc[df["month"].isin(WINTER_MONTHS), "meter_reading"].mean()

    return {
        "base_peak": _safe_ratio(base, peak),
        "night_day": _safe_ratio(night, day),
        "weekend_weekday": _safe_ratio(weekend, weekday),
        "summer_shoulder": _safe_ratio(summer, shoulder),
        "winter_shoulder": _safe_ratio(winter, shoulder),
    }


def shapes_for_site(site_id, year=2017):
    """Shape metrics for every building at a site, plus its use type."""
    path = os.path.join(ENERGY_ROOT, "site_id={}".format(site_id), "part.parquet")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    df = pd.read_parquet(path, columns=["building_id", "meter_reading", "hour",
                                        "day_of_week", "month", "year",
                                        "sqm", "primaryspaceusage"])
    df = df[df["year"] == year]
    rows = []
    for bid, g in df.groupby("building_id"):
        shape = load_shape(g)
        if not shape:
            continue
        shape.update({
            "building_id": bid,
            "use": g["primaryspaceusage"].iloc[0],
            "sqm": float(g["sqm"].iloc[0]),
        })
        rows.append(shape)
    return pd.DataFrame(rows)


#: metric -> (direction, what it suggests, what would rule it out)
FINDINGS = {
    "night_day": (
        "high",
        "Runs nearly as hard overnight as during occupied hours",
        "Check time schedules in the building management system, and whether "
        "AHUs and lighting circuits are set to switch off out of hours.",
        "Expected for a data centre, 24-hour clinic or a building with freezers "
        "or continuous process load.",
    ),
    "weekend_weekday": (
        "high",
        "Little or no weekend setback",
        "Check that the weekend schedule differs from the weekday one, and that "
        "holiday calendars are configured.",
        "Expected where the building genuinely operates seven days a week.",
    ),
    "base_peak": (
        "high",
        "A large share of peak demand is always on",
        "Audit continuous loads: server rooms, lab equipment, pumps and fans "
        "left in hand, and external lighting on permanent circuits.",
        "Expected where a small conditioned area sits on top of a large "
        "continuous process load.",
    ),
    "summer_shoulder": (
        "high",
        "Strongly cooling-driven consumption",
        "Check chiller sequencing, cooling setpoints and simultaneous "
        "heating/cooling; look at solar gain on the affected facades.",
        "Expected in a hot climate; compare against peers at the same site "
        "before drawing a conclusion.",
    ),
    "winter_shoulder": (
        "high",
        "Strongly heating-driven electrical consumption",
        "Likely direct electric heating. Check for a heat-pump retrofit case, "
        "and inspect envelope and infiltration.",
        "Expected where electricity is the only heating fuel.",
    ),
}


def diagnose(site_id, building_id, year=2017, peer_scope="use"):
    """Compare one building's load shape to its peers and name what to check."""
    shapes = shapes_for_site(site_id, year)
    if shapes.empty or building_id not in set(shapes["building_id"]):
        return None

    row = shapes.set_index("building_id").loc[building_id]
    peers = shapes[shapes["use"] == row["use"]] if peer_scope == "use" else shapes
    n_peers = len(peers)

    metrics, findings = [], []
    for metric, (_direction, headline, action, caveat) in FINDINGS.items():
        value = row.get(metric)
        if value is None or not np.isfinite(value):
            continue
        series = peers[metric].replace([np.inf, -np.inf], np.nan).dropna()
        if len(series) < 5:
            continue

        median = float(series.median())
        cutoff = float(series.quantile(PEER_QUANTILE))
        exceeds = value > cutoff and median > 0 and (value - median) / median >= MIN_RELATIVE_MARGIN

        metrics.append({
            "metric": metric,
            "value": round(float(value), 3),
            "peer_median": round(median, 3),
            "peer_p75": round(cutoff, 3),
            "percentile": round(float((series < value).mean()), 3),
            "flagged": bool(exceeds),
        })
        if exceeds:
            findings.append({
                "metric": metric,
                "headline": headline,
                "value": round(float(value), 3),
                "peer_median": round(median, 3),
                "action": action,
                "would_rule_out": caveat,
            })

    findings.sort(key=lambda f: f["value"] / max(f["peer_median"], 1e-9), reverse=True)

    return {
        "building_id": building_id,
        "site_id": site_id,
        "use": row["use"],
        "peer_group": {"scope": peer_scope, "n": int(n_peers)},
        "metrics": metrics,
        "findings": findings,
        "summary": (
            findings[0]["headline"] if findings
            else "Load shape is unremarkable for its peer group. The excess is in "
                 "overall level rather than in when the energy is used, which "
                 "points at capacity or equipment efficiency rather than controls."
        ),
        "caveat": (
            "Hypotheses to check on site, not conclusions. Each finding lists "
            "what would explain it legitimately."
        ),
    }
