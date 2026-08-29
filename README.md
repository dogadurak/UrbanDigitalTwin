# Urban Digital Twin — Building Energy Prediction & Spatial Benchmarking

![Python](https://img.shields.io/badge/Python-3.11-green.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688.svg)
![PostGIS](https://img.shields.io/badge/PostGIS-15--3.4-blue.svg)
![FIWARE](https://img.shields.io/badge/FIWARE-Orion--LD-orange.svg)
![Tests](https://img.shields.io/badge/tests-63%20passing-brightgreen.svg)

A cold-start energy model for buildings with no meter history, and a measured
answer to a question the urban-energy literature usually assumes: **does urban
context actually help?**

On the Building Data Genome 2 dataset, the answer is **no, by a measured
margin** — and the interesting part is *how* that was established.

> **The model works, and its horizon is stated.** On a held-out year it forecasts
> at **9.3% CV(RMSE) one hour ahead, 16.0% day-ahead and 21.4% a week ahead** —
> all three inside ASHRAE Guideline 14's hourly criteria (CV(RMSE) ≤ 30% *and*
> NMBE within ±10%). For a building with no meter history at all, predicting
> from attributes and weather alone reaches 43.7%.
>
> **And the context question has an answer.** Location encoded perfectly — one-hot site identity, the
> upper bound on any satellite or OSM variable computable here — is worth
> **2.8 CV(RMSE) points**. Real building attributes are worth **21.5**. A 7.7×
> difference, consistent across 12 of 12 held-out city blocks.
>
> Full write-up: **[docs/RESULTS.md](docs/RESULTS.md)** · Method and its
> grounding: **[docs/METHOD.md](docs/METHOD.md)**

---

## Why there is no satellite layer in this repository

BDG2 publishes coordinates *to city level*. From Miller et al. (2020), *Sci Data* 7:368:

> "In all cases, all buildings are within a 25-mile (40-kilometer) radius of the
> central location of the site or city."

That is 5,027 km² of positional uncertainty — 3.2× Greater London. A 250 m
buffer, the scale at which NDVI or land-surface temperature is normally sampled,
is **1/25,600** of it. A value extracted there describes an arbitrary point in a
metropolitan region, not a building.

So no NDVI, LST, LCZ or GHSL feature is computed anywhere here. An earlier
version of this project did present such features — they were hand-authored
Python constants and a `random.uniform()` mock, with the buildings (in
Washington DC) assigned invented İzmir coordinates. All of it, and every result
derived from it, is documented and quarantined in
**[archive/legacy_v3/](archive/legacy_v3/README.md)**.

Instead, the question was reframed into one the data *can* answer: measure the
ceiling. Since every site-level spatial variable is a lossy compression of site
identity, measuring site identity bounds all of them at once.

---

## What is real, and what is not

| Component | Status |
|---|---|
| BDG2 electricity, weather, metadata | **Real measurements**, 1636 buildings, 2016–17 hourly |
| Dataset pipeline (22.9 M rows, quality screening, coordinate validation) | **Real**, reproducible, tested |
| Evaluation harness (4 protocols, ASHRAE G14, bootstrap, power) | **Real**, 63 tests |
| Served model `energy_cold_start` | **Real**, trained on 1381 buildings, ships with held-out metrics |
| OSM layer (`/api/gis/*`) | **Real** Overpass data — 2465 buildings, 308 roads, İzmir pilot area |
| Dashboard | **Real** — reads `results/ladder/*` and the served model; no value is generated for display |
| `spatial_features`, `sentinel_observations` | **Empty by design** until an honest source exists |

Every number on the screen traces to a file in `results/` or to a live model
call. The dashboard previously animated drones, CCTV feeds and lift positions
over `Math.random()` telemetry for a fictional building; that layer was removed
rather than relabelled.

---

## Quick start

```bash
# 0. Fetch the dataset (a plain clone does not include it)
git submodule update --init --recursive
cd ai-service/data/building-data-genome-project-2
git lfs pull --include="data/metadata/*,data/weather/*,data/meters/cleaned/electricity_cleaned.csv"
cd ../../..

# 1. Start the stack. The PostGIS schema applies itself: ./db is mounted into
#    /docker-entrypoint-initdb.d and every *.sql runs in order 01..07.
docker compose up -d --build

# 2. Build the dataset  (~23 M rows, partitioned by site)
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service \
  python -m app.data_engineering.build_dataset

# 3. Load building reference data into PostGIS
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service \
  python -m app.data_engineering.load_buildings_to_db

# 4. Run the experiment  (~1 h: 5 models x 4 protocols x 19 folds x 3 seeds)
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service \
  python -m app.experiments.run_ladder --task cold_start --rows-per-building 800 --seeds 3
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service \
  python -m app.experiments.analyse_ladder --run results/ladder/cold_start

# 5. Train the served model
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service \
  python -m app.experiments.train_production --spec M3_building
```

Dashboard: `http://localhost:5173` · API: `http://localhost:8000/docs`

---

## The API

```bash
curl localhost:8000/api/health
```
Reports which model is loaded, how many buildings it was trained on, its
**held-out** CV(RMSE) and the protocol that produced it.

```bash
curl -X POST localhost:8000/api/predict -H 'Content-Type: application/json' -d '{
  "building_id":"Rat_office_Adele","timestamp":"2017-07-15T15:00:00",
  "airTemperature":31.0,"dewTemperature":21.0}'
```
```json
{"expected_energy_kwh": 490.17,
 "expected_band_1cvrmse": {"lo": 119.36, "hi": 860.98},
 "band_basis": {"cv_rmse_pct": 75.65, "protocol": "leave_block_out"}}
```

The band is the model's demonstrated out-of-sample error, not a percentile of
its own training residuals. `/api/detect-anomalies` flags deviations as
multiples of that band, so "anomaly" means "outside the error this model
actually showed on cities it had never seen". Unknown building → `404`, no
model → `503`; failures are failures, not `200` with an error string.

---

## Method notes

**Two tasks.** Persistence alone explains a median 88% of hourly variance
(measured over 1381 buildings), so in a lag-based model everything else competes
for a tenth of the variance. Contextual claims are therefore tested only in the
lag-free **cold-start** task, where a building has no history.

**Four protocols, reported side by side.** Random shuffling of hourly rows makes
models look roughly twice as good as they are on an unseen city (M2: 81.4% →
157.8%). The gap is a result, not a nuisance.

**Blocks, not sites.** Sites closer than the dataset's own 40 km uncertainty are
not independent: Ottawa is two "sites", London is three. Merging gives **12**
blocks from 15 coordinates. Training on two London sites while testing on a
third does not test transfer to an unseen city.

**A leakage guard, from a real failure.** `app/data_engineering/leakage.py`
refuses feature sets that identify buildings, and reports what fraction a set
pins down uniquely. Run against the archived V3 feature set it returns **1.0** —
a perfect building index wearing geoscience labels.

**Honest power.** With 12 blocks the minimum detectable effect is ~24 CV(RMSE)
points. Where a contrast falls below that, the report says so instead of
claiming a null result.

---

## Layout

```
ai-service/app/
  data_engineering/   dataset build, quality screening, coordinate validation,
                      cohorts + 40 km spatial blocking, leakage guard
  evaluation/         metrics (ASHRAE G14), protocols, bootstrap/power, harness
  experiments/        the M0–M3' ladder, analysis, production training
  main.py             serving API
db/                   01..07, applied in order on first start
docs/                 RESULTS.md (findings), METHOD.md (what each choice
                      rests on), DATA_QUALITY.md, QGIS_VALIDATION_WORKFLOW.md
archive/legacy_v3/    quarantined pre-Sprint-1 work, with the defects documented
frontend/src/         results dashboard: Cesium globe of the 12 held-out
                      city blocks, ladder table, live prediction panel
backend/              Node service for the OSM/PostGIS layer
```

## Tests

```bash
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service pytest tests/ -q   # 63 passed
```
No database or dataset download required — every case is built from synthetic
frames, including the coordinate sign-error and identity-leakage cases.

---

## Known limitations

- **n = 12** for every site-level conclusion. BDG2 publishes 15 coordinates for 1636 buildings.
- **Electricity only.** Chilled water and steam are unpulled LFS pointers, so cooling load — where a thermal-context hypothesis is most plausible — is untested.
- **CV(RMSE) is unstable for very small consumers** (see the `Lamb` fold, [docs/RESULTS.md](docs/RESULTS.md) §3).
- **No anomaly benchmark.** The cleaned meter files already had anomalies removed by the dataset authors, so a detector trained on them is self-defeating.

## Next

Per-building coordinates are the precondition for any real spatial claim. NYC
Local Law 84 joins to PLUTO on BBL, giving true geometry, floors, year, use and
measured EUI for tens of thousands of buildings — where a 250 m buffer means
something. The harness was built to move there unchanged.

---

**Data:** [Building Data Genome Project 2](https://github.com/buds-lab/building-data-genome-project-2) (Miller et al. 2020, CC BY 4.0) · OpenStreetMap contributors (ODbL) · Open-Meteo
