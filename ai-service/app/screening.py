"""Energy screening: which buildings should be looked at first.

The rest of this project measures. This module decides -- or rather, produces
the ranked shortlist a decision is made from, which is the output an energy
agency or estate manager actually needs.

The method is a peer comparison, run two independent ways, and a building is
only flagged when **both** agree:

1. **Category peer test.** The building's measured energy intensity against the
   median for its own primary use. This needs no model at all.
2. **Model peer test.** Measured consumption against what the cold-start model
   predicts for a building of that type, size, age and weather. The model
   encodes the peer group more finely than a category median does -- a 2,000 m²
   1950s school and a 40,000 m² 2010 school are not peers just because both are
   "Education".

Requiring both keeps the list conservative: (1) alone flags anything unusual for
its category, (2) alone flags anything the model happens to fit badly.

What this is not
----------------
**High consumption is not proof of waste.** A laboratory, a data centre, a
24-hour clinic and a building with a server room in it will all sit far above
their category median while operating exactly as intended. The output is a
*triage list* -- where to send an auditor first -- not a verdict, and the
excess figures are an upper bound on opportunity, not a savings forecast.

The model's own error is respected: a deviation smaller than the CV(RMSE) the
model demonstrated out of sample is not evidence of anything, so it cannot
raise a flag.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

PROCESSED = os.path.join("data", "processed")
ENERGY_ROOT = os.path.join(PROCESSED, "energy")

#: Multiple of the category median above which a building is a candidate.
PEER_RATIO_THRESHOLD = 2.0

#: Minimum hours of data before a building can be screened at all.
MIN_HOURS = 4000

#: Hours in a year, for annualising a mean hourly reading.
HOURS_PER_YEAR = 8760


def _load_year(year=2017, columns=None):
    cols = columns or ["building_id", "meter_reading", "sqm", "primaryspaceusage",
                       "yearbuilt", "numberoffloors", "year"]
    frames = []
    for entry in sorted(os.listdir(ENERGY_ROOT)):
        if not entry.startswith("site_id="):
            continue
        df = pd.read_parquet(os.path.join(ENERGY_ROOT, entry, "part.parquet"), columns=cols)
        df = df[df["year"] == year]
        if df.empty:
            continue
        g = df.groupby("building_id").agg(
            mean_kwh=("meter_reading", "mean"),
            n_hours=("meter_reading", "size"),
            sqm=("sqm", "first"),
            use=("primaryspaceusage", "first"),
            yearbuilt=("yearbuilt", "first"),
        )
        g["site_id"] = entry.split("=", 1)[1]
        frames.append(g)
    if not frames:
        raise FileNotFoundError("No dataset partitions in {}".format(ENERGY_ROOT))
    return pd.concat(frames)


def _model_predictions(year=2017, rows_per_building=200):
    """Annualised prediction per building from the served cold-start model.

    Returns ``None`` when no model is loaded, in which case screening falls back
    to the category peer test alone and says so.
    """
    try:
        import json

        import joblib

        from app import main as M
        from app.experiments import ladder as L
        from app.experiments import run_ladder as R
        from app.data_engineering import cohorts as ch

        # Load from disk rather than relying on M.MODEL: the FastAPI startup
        # hook has not run in a CLI process, so depending on it silently
        # disabled the model peer test and left only half the design running.
        model, meta = M.MODEL, M.META
        if model is None or meta is None:
            if not (os.path.exists(M.MODEL_PATH) and os.path.exists(M.META_PATH)):
                return None, None
            model = joblib.load(M.MODEL_PATH)
            with open(M.META_PATH, "r", encoding="utf-8") as fh:
                meta = json.load(fh)

        cohort = ch.build_cohorts()["temporal"]
        df = R.prepare("cold_start", cohort, rows_per_building=rows_per_building, seed=7,
                       verbose=False)
        df = df[df["year"] == year]
        if df.empty:
            return None, None

        parts = []
        for col in meta["feature_columns"]:
            if col in df.columns:
                parts.append(df[col].astype("float32").rename(col))
            elif "=" in col:
                field, value = col.split("=", 1)
                parts.append((df[field].astype(str) == value).astype("float32").rename(col))
            else:
                parts.append(pd.Series(np.nan, index=df.index, name=col, dtype="float32"))
        X = pd.concat(parts, axis=1)
        df = df.assign(predicted=np.expm1(model.predict(X)))

        pred = df.groupby("building_id")["predicted"].mean()

        # Strictest validated protocol available, read from the model's own
        # metadata so the gate reflects demonstrated error, not a guess.
        metrics = meta.get("held_out_metrics") or {}
        cv = protocol = None
        for name in ("leave_block_out", "leave_buildings_out", "temporal", "random"):
            if name in metrics and metrics[name].get("cv_rmse_median_pct"):
                cv, protocol = metrics[name]["cv_rmse_median_pct"], name
                break
        return pred, (cv, protocol)
    except Exception:
        return None, None


def screen(year=2017, peer_threshold=PEER_RATIO_THRESHOLD, use_model=True):
    """Rank buildings by how far they exceed their peers. Returns (table, summary)."""
    b = _load_year(year)
    b = b[(b["sqm"] > 0) & (b["n_hours"] >= MIN_HOURS)].copy()
    b["eui"] = b["mean_kwh"] * 1000.0 / b["sqm"]
    b["annual_kwh"] = b["mean_kwh"] * HOURS_PER_YEAR

    # --- test 1: category peer -------------------------------------------
    b["peer_median_eui"] = b.groupby("use")["eui"].transform("median")
    b["peer_ratio"] = b["eui"] / b["peer_median_eui"]
    b["excess_kwh"] = ((b["eui"] - b["peer_median_eui"]).clip(lower=0) / 1000.0) \
        * b["sqm"] * HOURS_PER_YEAR

    # --- test 2: model peer ----------------------------------------------
    model_note = None
    b["model_ratio"] = np.nan
    if use_model:
        pred, band = _model_predictions(year)
        if pred is not None:
            b["predicted_mean_kwh"] = b.index.map(pred)
            b["model_ratio"] = b["mean_kwh"] / b["predicted_mean_kwh"]
            cv, protocol = band
            # A deviation inside the model's demonstrated error proves nothing.
            model_gate = 1.0 + (cv or 0) / 100.0
            model_agrees = b["model_ratio"] > model_gate
            model_note = (
                "Model peer test applied: a building must also exceed its "
                "predicted consumption by more than the model's validated "
                "{:.1f}% CV(RMSE) (measured under {}).".format(cv or 0, protocol)
            )
        else:
            model_agrees = pd.Series(True, index=b.index)
            model_note = ("No model loaded, so only the category peer test was "
                          "applied. The list is correspondingly less selective.")
    else:
        model_agrees = pd.Series(True, index=b.index)
        model_note = "Model peer test disabled by request."

    b["flagged"] = (b["peer_ratio"] >= peer_threshold) & model_agrees.reindex(b.index).fillna(False)

    b["reason"] = np.where(
        b["flagged"],
        b["peer_ratio"].round(1).astype(str) + "x the median for " + b["use"].astype(str),
        "",
    )

    # Non-finite ratios (near-zero denominators) must not reach the summary.
    b["peer_ratio"] = b["peer_ratio"].replace([np.inf, -np.inf], np.nan)
    b["model_ratio"] = b["model_ratio"].replace([np.inf, -np.inf], np.nan)

    flagged = b[b["flagged"]].sort_values("excess_kwh", ascending=False)
    summary = {
        "year": year,
        "n_screened": int(len(b)),
        "n_flagged": int(len(flagged)),
        "share_flagged": round(float(len(flagged) / len(b)), 4) if len(b) else 0.0,
        "peer_threshold": peer_threshold,
        "portfolio_annual_gwh": round(float(b["annual_kwh"].sum()) / 1e6, 1),
        "excess_annual_gwh": round(float(flagged["excess_kwh"].sum()) / 1e6, 1),
        "excess_share_of_portfolio": round(
            float(flagged["excess_kwh"].sum() / b["annual_kwh"].sum()), 4
        ) if len(b) else 0.0,
        "model_note": model_note,
        "caveat": (
            "A triage list, not a verdict. Laboratories, data centres and "
            "24-hour facilities legitimately exceed their category median; the "
            "excess figures are an upper bound on opportunity, not a savings "
            "forecast."
        ),
    }
    return b, summary


def to_records(table, limit=50):
    """JSON-safe records for the API.

    Ratios divide by a predicted or median value, so a near-zero denominator
    yields inf. JSON has no representation for inf or NaN, and FastAPI raises
    rather than emitting invalid JSON -- so both are converted to null here
    instead of failing the whole response.
    """
    cols = ["site_id", "use", "sqm", "yearbuilt", "eui", "peer_median_eui",
            "peer_ratio", "model_ratio", "annual_kwh", "excess_kwh", "reason"]
    out = table[table["flagged"]].sort_values("excess_kwh", ascending=False).head(limit)
    out = out[[c for c in cols if c in out.columns]].round(2).reset_index()
    out = out.replace([np.inf, -np.inf], np.nan)
    return out.astype(object).where(pd.notna(out), None).to_dict(orient="records")


def main():  # pragma: no cover - CLI
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Rank buildings for energy investigation.")
    ap.add_argument("--year", type=int, default=2017)
    ap.add_argument("--threshold", type=float, default=PEER_RATIO_THRESHOLD)
    ap.add_argument("--no-model", action="store_true")
    ap.add_argument("--out", default=os.path.join("results", "screening"))
    args = ap.parse_args()

    table, summary = screen(args.year, args.threshold, use_model=not args.no_model)
    os.makedirs(args.out, exist_ok=True)
    table.reset_index().to_csv(os.path.join(args.out, "screening_{}.csv".format(args.year)),
                               index=False)
    with open(os.path.join(args.out, "summary_{}.json".format(args.year)), "w",
              encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print("screened {n_screened} buildings, flagged {n_flagged} "
          "({share:.1%})".format(share=summary["share_flagged"], **summary))
    print("portfolio {portfolio_annual_gwh} GWh/yr | excess above peer median "
          "{excess_annual_gwh} GWh/yr ({share:.1%})".format(
              share=summary["excess_share_of_portfolio"], **summary))
    print()
    for r in to_records(table, 10):
        print("  {:<30s} {:<22s} {:>5.1f}x  {:>8,.0f} MWh/yr".format(
            r["building_id"][:29], str(r["use"])[:21], r["peer_ratio"],
            r["excess_kwh"] / 1000))
    print("\nwrote {}".format(args.out))


if __name__ == "__main__":
    main()


def validate_stability(years=(2016, 2017), peer_threshold=PEER_RATIO_THRESHOLD):
    """Does the flag survive being computed on a different year's data?

    A screening rule that fires on year-to-year noise sends auditors to
    buildings that were merely having an unusual twelve months. The test is
    simple and hard to argue with: compute the peer ratio independently in each
    year, using only that year's data and that year's peer medians, and see
    whether the same buildings come out.

    What a high persistence does and does not prove: it shows the signal is
    real and structural rather than noise, which is what a triage list needs.
    It does not show the building is wasteful -- a data centre is persistently
    above its category median because of what it is.
    """
    frames = []
    for year in years:
        b = _load_year(year)
        b = b[(b["sqm"] > 0) & (b["n_hours"] >= MIN_HOURS)].copy()
        b["eui"] = b["mean_kwh"] * 1000.0 / b["sqm"]
        b["ratio"] = b["eui"] / b.groupby("use")["eui"].transform("median")
        frames.append(b["ratio"].rename(year))

    wide = pd.concat(frames, axis=1).replace([np.inf, -np.inf], np.nan).dropna()
    if wide.empty or len(years) != 2:
        return {"n_buildings": int(len(wide)), "note": "needs exactly two comparable years"}

    a, b_ = years
    flag_a, flag_b = wide[a] >= peer_threshold, wide[b_] >= peer_threshold
    both = int((flag_a & flag_b).sum())

    return {
        "years": list(years),
        "peer_threshold": peer_threshold,
        "n_buildings": int(len(wide)),
        "n_flagged_{}".format(a): int(flag_a.sum()),
        "n_flagged_{}".format(b_): int(flag_b.sum()),
        "n_flagged_both": both,
        "persistence": round(float(both / max(int(flag_a.sum()), 1)), 4),
        "pearson_r": round(float(wide[a].corr(wide[b_])), 4),
        "spearman_r": round(float(wide[a].corr(wide[b_], method="spearman")), 4),
        "interpretation": (
            "High persistence means the flag is structural, not year-to-year "
            "noise -- which is what a triage list needs. It does not mean the "
            "building is wasteful: a data centre is persistently above its "
            "category median because of what it is."
        ),
    }
