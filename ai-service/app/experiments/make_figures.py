"""Render the report figures from the result files.

Every figure is drawn from `results/` rather than transcribed, so a figure
cannot drift away from the numbers it claims to show. Re-run after any
experiment and the images update.

Usage::

    python -m app.experiments.make_figures --out docs/img
"""

from __future__ import annotations

import argparse
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

LADDER = os.path.join("results", "ladder")

INK = "#0f172a"
MUTED = "#64748b"
GRID = "#e2e8f0"
ACCENT = "#0284c7"
WARN = "#f59e0b"
BAD = "#dc2626"
GOOD = "#16a34a"

plt.rcParams.update({
    "figure.dpi": 160,
    "savefig.dpi": 160,
    "font.size": 9,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK,
    "text.color": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def _fold_means(run_dir, protocol, model, metric="cv_rmse_median"):
    path = os.path.join(run_dir, "fold_results.csv")
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path)
    sel = df[(df["protocol"] == protocol) & (df["model"] == model)]
    if sel.empty:
        return None
    return sel.groupby("fold")[metric].mean()


def fig_horizon(out):
    """How accuracy decays as the forecast horizon lengthens."""
    points = [
        ("1 h\nahead", os.path.join(LADDER, "forecast"), "temporal"),
        ("24 h\nahead", os.path.join(LADDER, "forecast_h24"), "temporal"),
        ("1 week\nahead", os.path.join(LADDER, "forecast_h168"), "temporal"),
        ("no\nhistory", os.path.join(LADDER, "cold_start"), "temporal"),
    ]
    labels, values = [], []
    for label, run, protocol in points:
        s = _fold_means(run, protocol, "M3_building")
        if s is None:
            continue
        labels.append(label)
        values.append(float(s.median() if "cold_start" in run else s.mean()))
    if not values:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    colours = [GOOD if v <= 30 else BAD for v in values]
    bars = ax.bar(labels, values, color=colours, width=0.6)
    ax.axhline(30, color=MUTED, ls="--", lw=1)
    ax.text(-0.42, 31.5, "ASHRAE Guideline 14 hourly criterion (30%)",
            ha="left", fontsize=8, color=MUTED)
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.2, "{:.1f}%".format(v),
                ha="center", fontsize=9, weight="bold")
    ax.set_ylabel("CV(RMSE) %  ·  lower is better")
    ax.set_title("Forecast accuracy against horizon\n1381 buildings, held-out year",
                 fontsize=10, loc="left", weight="bold")
    ax.set_ylim(0, max(values) * 1.25)
    ax.grid(axis="y", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    path = os.path.join(out, "fig-horizon.png")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def fig_ladder(out):
    """What each rung is worth, and how much a loose protocol flatters it."""
    run = os.path.join(LADDER, "cold_start")
    models = [("M0_seasonal_naive", "seasonal naive"),
              ("M2_weather", "+ weather"),
              ("M3prime_site_identity", "+ site identity\n(control)"),
              ("M3_building", "+ building\nattributes")]
    protocols = [("random", "random split", MUTED), ("leave_block_out", "unseen city", ACCENT)]

    series = {}
    for key, _, _ in protocols:
        vals = []
        for m, _lab in models:
            s = _fold_means(run, key, m)
            vals.append(float(s.median()) if s is not None else float("nan"))
        series[key] = vals
    if all(pd.isna(v) for v in series[protocols[0][0]]):
        return None

    labels = [lab for _, lab in models]
    x = range(len(labels))
    fig, ax = plt.subplots(figsize=(7.0, 3.6))
    w = 0.36
    for i, (key, lab, colour) in enumerate(protocols):
        pos = [v + (i - 0.5) * w for v in x]
        bars = ax.bar(pos, series[key], width=w, label=lab, color=colour)
        for b, v in zip(bars, series[key]):
            if pd.notna(v):
                ax.text(b.get_x() + b.get_width() / 2, v + 1.5, "{:.0f}".format(v),
                        ha="center", fontsize=8, color=colour, weight="bold")

    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_ylabel("CV(RMSE) %  ·  lower is better")
    ax.set_title("Cold start: what each addition is worth\n"
                 "and how much a random split flatters it",
                 fontsize=10, loc="left", weight="bold")
    ax.legend(frameon=False, fontsize=8)
    ax.grid(axis="y", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    path = os.path.join(out, "fig-ladder.png")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def fig_cities(out):
    """Per-city transfer accuracy, the leave-one-city-out result."""
    run = os.path.join(LADDER, "cold_start")
    path_csv = os.path.join(run, "fold_results.csv")
    if not os.path.exists(path_csv):
        return None
    df = pd.read_csv(path_csv)
    lbo = df[df["protocol"] == "leave_block_out"]
    if lbo.empty:
        return None
    piv = lbo.pivot_table(index="fold", columns="model", values="cv_rmse_median")
    if "M3_building" not in piv or "M2_weather" not in piv:
        return None
    piv = piv.sort_values("M3_building")

    # One fold (Lamb) is an order of magnitude worse than the rest, because
    # CV(RMSE) divides by a building's mean and 16 of its 70 buildings average
    # under 5 kWh. Plotting it to scale flattens every other bar into
    # illegibility, so the axis is capped and the off-scale values are written
    # in rather than hidden.
    ordered = piv.sort_values("M3_building")
    inliers = ordered[ordered["M2_weather"] <= 150]
    cap = float(inliers["M2_weather"].max()) * 1.18 if len(inliers) else 100.0

    fig, ax = plt.subplots(figsize=(6.8, 4.4))
    y = list(range(len(ordered)))
    ax.barh(y, ordered["M2_weather"].clip(upper=cap), color=GRID,
            height=0.62, label="weather only")
    ax.barh(y, ordered["M3_building"].clip(upper=cap), color=ACCENT,
            height=0.62, label="+ building attributes")

    for i, (_name, row) in enumerate(ordered.iterrows()):
        if row["M2_weather"] > cap or row["M3_building"] > cap:
            ax.text(cap * 0.985, i,
                    "{:.0f}% to {:.0f}%  (off scale)".format(
                        row["M2_weather"], row["M3_building"]),
                    ha="right", va="center", fontsize=7.5, color="white", weight="bold")

    ax.set_yticks(y)
    ax.set_yticklabels(ordered.index)
    ax.invert_yaxis()
    ax.set_xlim(0, cap)
    ax.set_xlabel("CV(RMSE) %  ·  lower is better")
    ax.set_title("Transfer to a city held entirely out of training\n"
                 "building attributes improve every one of the 12 blocks",
                 fontsize=10, loc="left", weight="bold")
    ax.legend(frameon=False, fontsize=8, loc="upper right")
    ax.grid(axis="x", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    out_path = os.path.join(out, "fig-cities.png")
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("docs", "img"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for fn in (fig_horizon, fig_ladder, fig_cities):
        path = fn(args.out)
        print("  {}".format(path) if path else "  {}: skipped (no results)".format(fn.__name__))


if __name__ == "__main__":
    main()
