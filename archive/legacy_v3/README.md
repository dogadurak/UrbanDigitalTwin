# Legacy V3 artefacts — retained for provenance, **not valid results**

Everything in this directory was produced before Sprint 1. It is kept so the
project's history stays auditable, and so nobody re-runs it by accident.

**Do not cite, publish, or re-run any of these numbers.**

## Why the results are invalid

### 1. The spatial features were fabricated

`multi_spatial_init.py` did not read any satellite, OSM or terrain product. It
wrote a hand-authored Python literal into PostGIS — NDVI, NDMI, NDBI,
`building_density`, `road_density`, `green_ratio`, `elevation` and `slope` for
four buildings, with comments such as `# High vegetation (pine forest)`.

`dem_ingestion.py` printed
`"Mocking DEM extraction (via OpenTopography/Copernicus API simulation)"`
and returned `45.2 + random.uniform(-1, 1)`.

The coordinates were also wrong. These are BDG2 `Rat` site buildings, which sit
at **38.9035, -77.0053 (Washington, DC)**. The script assigned them invented
İzmir coordinates (IYTE, Alsancak, Bornova, Bostanlı) — the wrong continent.

### 2. Any "spatial" gain was building identity leaking in

With four buildings, every one of those eight variables is a bijective
re-encoding of `building_id`. `lat`/`lon` were fed to the model directly, which
is building identity in the plainest possible form.

Measured on the same test split, with no model at all:

| Predictor | R² |
|---|---|
| Each building's constant mean (one number per building) | **0.9188** |
| `V3_Sentinel` / `V3_OSM` / `V3_DEM` / `V3_Location` / `V3_Full_Spatial` | 0.8899 – 0.8910 |
| `V2_Baseline` (no building-identifying feature at all) | **-0.0004** |

The jump from -0.0004 to ~0.89 is exactly the recovery of building identity.
The spatial variants land *below* the constant-per-building predictor, so their
net contribution is negative. Mean consumption across the four buildings spans
33 → 2048 kWh, a 61.4× range, and the model predicted absolute kWh.

### 3. The two ablation files disagree by 20×

`ablation_results.root.json` uses a key schema (`"V3-Sentinel"`) that the script
stopped emitting; `ablation_results.ai-service.json` is the current schema
(`"V3_Sentinel"`). The root file reports MAE ≈ 1.4, the ai-service file
MAE ≈ 162, because one pipeline used autoregressive lags and the other did not,
while both labelled their baseline "V2". The stale root file is what made an
earlier review conclude the numbers were "identical to 16 decimal places" — a
claim that does not hold against the current output.

### 4. The anomaly experiment leaked ground truth, twice

`spatial_anomaly_experiment.py` set
`contamination = n_anomalies / len(test_df_anom)`, telling IsolationForest how
many anomalies to find. It also fit the detector on the test set, and injected
anomalies only where `outdoor_temperature < 15` while giving the detector
`outdoor_temperature` as an input feature — so part of the label was inferable
from a feature.

### 5. `generate_dataset.py` synthesised data that already existed

It produced synthetic energy/weather series while 1636 real buildings sat
unused on disk.

## What replaces them

Sprint 1 rebuilt the data foundation: real BDG2 metadata, EUI normalisation,
1636 buildings across 15 real site coordinates, and a data-quality layer.
Sprint 2 will add real remote-sensing and OSM ingestion. Sprint 3 rebuilds the
ablation and anomaly experiments with a building-ID control arm and spatial
cross-validation.

Until real spatial features exist, `spatial_features` is intentionally empty.
An empty table is honest; a fabricated one is not.
