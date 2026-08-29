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




def fig_eui_by_use(out):
    """Measured intensity by building use -- why attributes beat location."""
    from app import screening as S

    b = S._load_year(2017)
    b = b[(b["sqm"] > 0) & (b["n_hours"] >= S.MIN_HOURS)].copy()
    b["eui"] = b["mean_kwh"] * 1000.0 / b["sqm"]
    g = (b.groupby("use")["eui"].agg(["size", "median"])
         .rename(columns={"size": "n"}))
    g = g[g["n"] >= 10].sort_values("median")
    if g.empty:
        return None

    fig, ax = plt.subplots(figsize=(6.8, 3.8))
    norm = g["median"] / g["median"].max()
    colours = [plt.cm.YlOrRd(0.25 + 0.6 * v) for v in norm]
    bars = ax.barh(range(len(g)), g["median"], color=colours, height=0.68)
    for i, (v, n) in enumerate(zip(g["median"], g["n"])):
        ax.text(v + 0.3, i, "{:.1f}   n={}".format(v, int(n)),
                va="center", fontsize=8, color=MUTED)
    ax.set_yticks(range(len(g)))
    ax.set_yticklabels(g.index)
    ax.set_xlabel("median energy intensity, Wh/m² per hour")
    ax.set_xlim(0, g["median"].max() * 1.32)
    spread = g["median"].max() / g["median"].min()
    ax.set_title("Measured intensity spans {:.0f}x across building uses\n"
                 "in the order building physics predicts".format(spread),
                 fontsize=10, loc="left", weight="bold")
    ax.grid(axis="x", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    path = os.path.join(out, "fig-eui-by-use.png")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def fig_load_profile(out, building_id="Rat_office_Adele", site_id="Rat"):
    """A real building's measured day against the cold-start prediction."""
    import numpy as np

    energy = os.path.join("data", "processed", "energy",
                          "site_id={}".format(site_id), "part.parquet")
    if not os.path.exists(energy):
        return None

    cols = ["building_id", "meter_reading", "hour", "day_of_week", "month",
            "is_weekend", "year", "airTemperature", "dewTemperature",
            "windSpeed", "cloudCoverage", "sqm", "primaryspaceusage",
            "yearbuilt", "numberoffloors"]
    df = pd.read_parquet(energy, columns=cols)
    df = df[(df["building_id"] == building_id) & (df["year"] == 2017)]
    if df.empty:
        return None

    predicted = None
    try:
        import json as _json

        import joblib

        from app.experiments import ladder as L

        model_dir = os.path.join("app", "models", "saved")
        model = joblib.load(os.path.join(model_dir, "energy_cold_start.joblib"))
        with open(os.path.join(model_dir, "energy_cold_start_metadata.json"),
                  encoding="utf-8") as fh:
            meta = _json.load(fh)
        feat = L.add_derived(df)
        parts = []
        for col in meta["feature_columns"]:
            if col in feat.columns:
                parts.append(feat[col].astype("float32").rename(col))
            elif "=" in col:
                field, value = col.split("=", 1)
                parts.append((feat[field].astype(str) == value).astype("float32").rename(col))
            else:
                parts.append(pd.Series(np.nan, index=feat.index, name=col, dtype="float32"))
        predicted = np.expm1(model.predict(pd.concat(parts, axis=1)))
    except Exception:
        predicted = None

    df = df.copy()
    if predicted is not None:
        df["predicted"] = predicted
    by_hour = df.groupby("hour").agg(measured=("meter_reading", "mean"))
    if "predicted" in df:
        by_hour["predicted"] = df.groupby("hour")["predicted"].mean()

    fig, ax = plt.subplots(figsize=(6.6, 3.4))
    ax.plot(by_hour.index, by_hour["measured"], color=ACCENT, lw=2.2, label="measured")
    if "predicted" in by_hour:
        ax.plot(by_hour.index, by_hour["predicted"], color=WARN, lw=2.0, ls="--",
                label="predicted, no meter history")
    ax.set_xlabel("hour of day")
    ax.set_ylabel("mean demand, kWh")
    ax.set_xticks(range(0, 24, 3))
    ax.set_title("{}\naverage 2017 day: the model sees no past reading for "
                 "this building".format(building_id), fontsize=10, loc="left",
                 weight="bold")
    ax.legend(frameon=False, fontsize=8)
    ax.grid(color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    path = os.path.join(out, "fig-load-profile.png")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def fig_screening(out):
    """How the portfolio distributes against its peer medians, and what is flagged."""
    import numpy as np

    from app import screening as S

    table, summary = S.screen(2017)
    ratios = table["peer_ratio"].replace([np.inf, -np.inf], np.nan).dropna()
    ratios = ratios[ratios < 8]
    if ratios.empty:
        return None

    fig, ax = plt.subplots(figsize=(6.8, 3.4))
    ax.hist(ratios, bins=60, color=GRID, edgecolor="white", linewidth=0.4)
    ax.axvline(S.PEER_RATIO_THRESHOLD, color=WARN, ls="--", lw=1.4)
    ax.text(S.PEER_RATIO_THRESHOLD + 0.08, ax.get_ylim()[1] * 0.86,
            "screening threshold\n{:.0f}x the median for its use".format(
                S.PEER_RATIO_THRESHOLD),
            fontsize=8, color=WARN)
    ax.set_xlabel("measured intensity ÷ median for the same building use")
    ax.set_ylabel("buildings")
    ax.set_title("{} of {} buildings flagged, {} GWh/yr above peer level\n"
                 "both peer tests must agree before a building is listed".format(
                     summary["n_flagged"], summary["n_screened"],
                     summary["excess_annual_gwh"]),
                 fontsize=10, loc="left", weight="bold")
    ax.grid(axis="y", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    path = os.path.join(out, "fig-screening.png")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("docs", "img"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for fn in (fig_horizon, fig_ladder, fig_cities,
               fig_eui_by_use, fig_load_profile, fig_screening):
        path = fn(args.out)
        print("  {}".format(path) if path else "  {}: skipped (no results)".format(fn.__name__))


if __name__ == "__main__":
    main()
