"""Serve the experiment results, so the dashboard shows findings rather than a simulation.

Every number here comes from ``results/ladder/*/fold_results.csv``, written by
the evaluation harness. Nothing is generated for display. If an experiment has
not been run, the endpoint says so instead of inventing a plausible value --
which is precisely the failure mode this project was rebuilt to remove.
"""

from __future__ import annotations

import json
import os

import pandas as pd
from fastapi import APIRouter, HTTPException

router = APIRouter()

RESULTS_ROOT = "results/ladder"
PROCESSED = "data/processed"

PROTOCOL_ORDER = ["random", "temporal", "leave_buildings_out", "leave_block_out"]

PROTOCOL_LABELS = {
    "random": "Random split",
    "temporal": "Temporal (2016 to 2017)",
    "leave_buildings_out": "Unseen building",
    "leave_block_out": "Unseen city",
}

MODEL_LABELS = {
    "M0_seasonal_naive": "M0 seasonal naive",
    "M1_calendar": "M1 + calendar",
    "M2_weather": "M2 + weather",
    "M3_building": "M3 + building attributes",
    "M3prime_site_identity": "M3' + site identity (control)",
}


def _load(task):
    path = os.path.join(RESULTS_ROOT, task, "fold_results.csv")
    if not os.path.exists(path):
        raise HTTPException(
            status_code=404,
            detail=(
                "No results for task '{}'. Run: python -m app.experiments.run_ladder "
                "--task {}".format(task, task)
            ),
        )
    meta_path = os.path.join(RESULTS_ROOT, task, "run.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as fh:
            meta = json.load(fh)
    return pd.read_csv(path), meta


@router.get("/results/tasks")
def available_tasks():
    """Which experiments have actually been run."""
    if not os.path.isdir(RESULTS_ROOT):
        return {"tasks": []}
    tasks = []
    for entry in sorted(os.listdir(RESULTS_ROOT)):
        if os.path.exists(os.path.join(RESULTS_ROOT, entry, "fold_results.csv")):
            tasks.append(entry)
    return {"tasks": tasks}


@router.get("/results/{task}/summary")
def summary(task: str):
    """CV(RMSE) by protocol and model. Median across folds, robust to outliers."""
    df, meta = _load(task)
    per_fold = df.groupby(["protocol", "model", "fold"], as_index=False)["cv_rmse_median"].mean()

    matrix = []
    for model, g in per_fold.groupby("model"):
        row = {"model": model, "label": MODEL_LABELS.get(model, model)}
        for protocol in PROTOCOL_ORDER:
            sub = g[g["protocol"] == protocol]["cv_rmse_median"]
            if sub.empty:
                row[protocol] = None
            else:
                row[protocol] = {
                    "median": round(float(sub.median()), 1),
                    "mean": round(float(sub.mean()), 1),
                    "n_folds": int(len(sub)),
                }
        matrix.append(row)

    order = list(MODEL_LABELS)
    matrix.sort(key=lambda r: order.index(r["model"]) if r["model"] in order else 99)

    return {
        "task": task,
        "protocols": [{"key": p, "label": PROTOCOL_LABELS[p]} for p in PROTOCOL_ORDER
                      if p in set(per_fold["protocol"])],
        "matrix": matrix,
        "run": {
            "n_rows": meta.get("n_rows_used"),
            "n_buildings": meta.get("n_buildings_used"),
            "seeds": meta.get("seeds"),
            "rows_per_building": meta.get("rows_per_building"),
            "cohort": (meta.get("cohort") or {}).get("name"),
            "n_folds": (meta.get("cohort") or {}).get("n_folds"),
        },
        "metric": "CV(RMSE) %, ASHRAE Guideline 14, per building then aggregated. Lower is better.",
    }


@router.get("/results/{task}/by-city")
def by_city(task: str, model: str = "M3_building", baseline: str = "M2_weather"):
    """Per-held-out-city transfer accuracy, joined to real site coordinates.

    This is the map layer: 12 spatial blocks, each a real city, coloured by how
    well the model transfers to it. The coordinates are BDG2 site centroids and
    are accurate only to city level (40 km), which the payload states.
    """
    df, meta = _load(task)
    lbo = df[df["protocol"] == "leave_block_out"]
    if lbo.empty:
        raise HTTPException(
            status_code=404,
            detail="Task '{}' has no leave_block_out folds; there is no city map "
                   "to draw.".format(task),
        )

    piv = lbo.pivot_table(index="fold", columns="model", values="cv_rmse_median")
    sites_path = os.path.join(PROCESSED, "sites.csv")
    sites = pd.read_csv(sites_path) if os.path.exists(sites_path) else pd.DataFrame()

    # A block is named after its alphabetically first member site.
    coords = {}
    members = {}
    if not sites.empty:
        from app.data_engineering import cohorts as ch

        block_of = ch.spatial_blocks(sites)
        for _, s in sites.iterrows():
            block = block_of.get(s["site_id"], s["site_id"])
            members.setdefault(block, []).append(s["site_id"])
            if block == s["site_id"] and pd.notna(s["lat"]):
                coords[block] = (float(s["lat"]), float(s["lng"]), s.get("coord_status"))

    out = []
    for block, row in piv.iterrows():
        lat, lng, status = coords.get(block, (None, None, None))
        value = row.get(model)
        base = row.get(baseline)
        out.append({
            "block": block,
            "sites": sorted(members.get(block, [block])),
            "lat": lat,
            "lng": lng,
            "coord_status": status,
            "cv_rmse": round(float(value), 1) if pd.notna(value) else None,
            "baseline_cv_rmse": round(float(base), 1) if pd.notna(base) else None,
            "improvement": round(float(base - value), 1)
            if pd.notna(value) and pd.notna(base) else None,
        })
    out.sort(key=lambda r: (r["cv_rmse"] is None, r["cv_rmse"]))

    return {
        "task": task,
        "model": model,
        "baseline": baseline,
        "blocks": out,
        "n_blocks": len(out),
        "coordinate_note": (
            "BDG2 publishes site or city centroids, with every building within a "
            "40 km radius (Miller et al. 2020). Markers locate a city, not a building."
        ),
        "block_note": (
            "Sites closer together than that 40 km bound are merged into one "
            "block: Ottawa is two BDG2 sites, London is three."
        ),
    }


@router.get("/results/{task}/contrasts")
def contrasts(task: str):
    """The headline comparison: what each rung of the ladder is worth."""
    df, _ = _load(task)
    from app.experiments.analyse_ladder import contrasts as compute
    from app.experiments.analyse_ladder import summary_table

    _, per_fold = summary_table(df)
    con = compute(per_fold)
    if con.empty:
        return {"task": task, "contrasts": []}
    con = con.where(pd.notna(con), None)
    return {"task": task, "contrasts": con.to_dict(orient="records")}
