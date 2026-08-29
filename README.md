# 🏙️ Urban Digital Twin - AI-Powered Smart Facility

![Version](https://img.shields.io/badge/version-3.0-blue.svg)
![React](https://img.shields.io/badge/React-18-cyan.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-green.svg)
![FIWARE](https://img.shields.io/badge/FIWARE-Orion--LD-orange.svg)
![PostGIS](https://img.shields.io/badge/PostGIS-Database-blue.svg)

**Urban Digital Twin** is an advanced, real-time 3D simulation and facility management dashboard. It bridges the gap between physical infrastructure and digital monitoring by integrating **FIWARE Context Broker**, **PostGIS Spatial Database**, and a powerful **XGBoost AI Engine** to provide proactive, spatial-aware energy management.

---

> **Status — Sprint 1 (data foundation).** The spatial/remote-sensing layer is
> being rebuilt on real data. Earlier versions of this README advertised
> Sentinel-2 NDVI/NDBI, OSM density and Copernicus DEM features; those values
> were hand-authored constants and a `random.uniform()` mock, not ingested
> products, and the results derived from them were invalid. They have been
> removed and documented in [`archive/legacy_v3/`](archive/legacy_v3/README.md).
> `spatial_features` is intentionally **empty** until real ingestion lands in
> Sprint 2 — an empty table is honest, a fabricated one is not.

## ✨ Key Features

### 🤖 Energy Forecasting & Anomaly Detection (XGBoost)
- **Autoregressive forecasting:** XGBoost over calendar and weather features
  plus 1/24/168-hour lags and 24/168-hour rolling means. Lags are computed
  per building (`groupby('building_id')`) and rolling means are `.shift(1)`-ed,
  so no target leaks into its own predictors.
- **Temporal validation:** trained on 2016, tested on 2017 — never a random split.
- **Residual-threshold alerting:** anomalies flagged above the 99th percentile
  of training residuals.
- **Known issue:** the second detection layer (Isolation Forest) was fitted on
  residuals from a *lag-free* model (≈160 kWh scale) but is served residuals
  from the lag-based model (≈25 kWh scale), so in practice it never fires.
  Scheduled for repair in Sprint 3, when the experiments are rebuilt.

### 🔮 What-If Scenario Simulation
- **Interactive panel:** sweep outdoor temperature and inspect the projected
  load delta against the baseline.
- **Note:** the NDVI / building-density sliders are currently **illustrative
  only** — they drive model inputs that are not yet backed by real measurements.

### 🛡️ Enterprise-Grade Resilience & Testing
- **Self-Healing Connections:** Powered by `tenacity`, all interactions between the AI service, PostGIS database, and FIWARE Orion-LD utilize **Exponential Backoff** to survive network blips and microservice restarts without dropping data.
- **Robust Testing Infrastructure:**
  - **Backend:** Covered by `pytest` and `pytest-asyncio` for fully automated API endpoint validation.
  - **Frontend:** Component tests using `vitest` and `@testing-library/react` ensure UI stability.

### 🗺️ GIS & Persistent Time-Series
- **PostGIS schema ready for real ingestion:** `db/06_spatial_context.sql`
  defines `building_footprints` (Polygon/4326 + GIST), `sentinel_observations`
  (product id, acquisition time, cloud cover, CRS, resolution) and a
  multi-scale `spatial_features` table keyed by
  `(building_id, buffer_radius_m, observation_time)` with a `source_version`
  column. The table is empty until Sprint 2 populates it from real products.
- **Data lineage:** `ingestion_runs` records every ingestion attempt with row
  counts and status, so each stored value is traceable to a source and a run.
- **Dynamic Time-Series:** `building_energy_history` maintains rolling histories
  for lag feature calculation without relying on fragile in-memory buffers.

---

## 🏗️ System Architecture (Microservices)

The project leverages a containerized, event-driven microservices architecture via Docker Compose.

```mermaid
graph TD;
    A[IoT Replay Service] -->|MQTT| B(Mosquitto Broker);
    B -->|IoT Agent| C(FIWARE Orion-LD);
    C -->|Context Subscription| D[AI Service FastAPI];
    D <-->|Read Spatial / Write Lags| E[(PostGIS DB)];
    D -->|Publish AIInsight| C;
    C <-->|REST API| F(React / Three.js Frontend);
```

### 🗂️ Core Services
- **`geotwin-frontend`**: React, Vite, TailwindCSS, React Three Fiber. Runs on port `5173`.
- **`geotwin-ai-service`**: Python, FastAPI, XGBoost, Scikit-learn, Tenacity. Runs on port `8000`.
- **`geotwin-orion-ld`**: FIWARE Context Broker for managing NGSI-LD entities. Runs on port `1026`.
- **`geotwin-postgis`**: PostgreSQL + PostGIS extension for spatial and historical data. Runs on port `5432`.
- **`geotwin-mosquitto`**: MQTT broker for IoT telemetry ingestion.

---

## 🚀 Getting Started

### Prerequisites
- [Docker](https://www.docker.com/) and Docker Compose v2+

### 0. Fetch the dataset
The BDG2 dataset is a git submodule and is **not** included in a plain clone:
```bash
git submodule update --init --recursive
cd ai-service/data/building-data-genome-project-2
git lfs pull --include="data/metadata/*,data/weather/*,data/meters/cleaned/electricity_cleaned.csv"
```

### 1. Bootstrapping the Environment
Simply start the entire microservices cluster from the root directory:
```bash
docker-compose up -d --build
```
*Wait ~30 seconds for the databases and FIWARE to fully initialize.*

The PostGIS schema is applied automatically on first start: `./db` is mounted
into `/docker-entrypoint-initdb.d`, and Postgres runs every `*.sql` there in
lexical order (`01_init` → `06_spatial_context`). No manual `psql` step is
needed. To re-apply from scratch, drop the volume: `docker compose down -v`.

### 2. Initialize FIWARE Subscriptions
```bash
# Create FIWARE NGSI-LD Subscriptions for the AI service
docker exec -it geotwin-ai-service python app/setup_subscription.py
```

### 3. Start the Live Simulation (Replay Service)
To simulate live sensor data flowing into the digital twin (with injected synthetic anomalies):
```bash
docker exec -it geotwin-ai-service python app/scripts/replay_service.py
```

### 4. Access the Dashboard
Open your browser and navigate to:
**`http://localhost:5173`**

---

## 🧪 Running Automated Tests

**Backend (Pytest):**
```bash
docker exec -e PYTHONPATH=/app geotwin-ai-service pytest tests/
```

**Frontend (Vitest):**
```bash
docker exec geotwin-frontend npx vitest run
```

---

*Built with passion for the future of Smart Facilities and PropTech.* 🚀
