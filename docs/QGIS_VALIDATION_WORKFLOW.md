# QGIS Validation Workflow for GeoTwin V3

> **Status: PLANNED, not yet executable.**
>
> This workflow describes the validation procedure for the *real* spatial
> ingestion pipeline, which lands in Sprint 2. The scripts it names
> (`osm_ingestion.py`, `sentinel_ingestion.py`) do not exist yet, and the
> layers `sentinel_observations` / `spatial_features` are created but empty.
>
> A previous revision of this document implied the pipeline was already
> running and validated. It was not: the values in `spatial_features` were
> hand-authored constants, and `dem_ingestion.py` returned
> `45.2 + random.uniform(-1, 1)`. Both have been removed — see
> [`archive/legacy_v3/`](../archive/legacy_v3/README.md).
>
> Keep this document as the acceptance checklist for Sprint 2.

This document outlines the steps to visually validate the automated Geomatics pipeline (Experiment A) using QGIS. Since the Spatial Context Engine dynamically computes multi-scale features (50m, 100m, 250m) and stores them in PostGIS, QGIS is the perfect tool to ensure geometric accuracy and temporal alignment.

## 1. Connect QGIS to PostGIS

1. Open QGIS and go to **Layer > Add Layer > Add PostGIS Layers...**
2. Click **New** to create a new connection:
   - **Name**: `GeoTwin DB`
   - **Host**: `localhost` (or `172.18.0.x` depending on your Docker network)
   - **Port**: `5433` (mapped from 5432 in `docker-compose.yml`)
   - **Database**: `geotwin_db`
   - **Username**: `geotwin_user`
   - **Password**: `geotwin_password`
3. Click **Test Connection** to ensure connectivity.

## 2. Load Spatial Layers

1. In the Data Source Manager, connect to `GeoTwin DB` and expand the `public` schema.
2. Select and add the following layers:
   - `building_footprints` (Multipolygon)
   - `sentinel_observations` (Raster / Geometry depending on storage)
   - `spatial_features` (Point / Polygon proxy, joined by `building_id`)

## 3. Visual Validation Steps

### A. Pilot Building Footprint
- Zoom to the pilot building (`IYTE_ARCH_001`).
- Verify that the polygon perfectly aligns with the real-world building using the **QuickMapServices** plugin (e.g., Google Satellite or OSM Standard).

### B. Multi-Scale Buffers
- Use the **Vector > Geoprocessing Tools > Buffer** tool in QGIS to create temporary 50m, 100m, and 250m buffers around the `IYTE_ARCH_001` footprint.
- Verify that the features (roads, buildings, green areas) inside these buffers visually match the static features ingested into the `spatial_features` table:
  - `building_density`
  - `road_density`
  - `green_ratio`

### C. Sentinel-2 Alignment (Temporal & Spatial)
- If you downloaded Sentinel-2 raw TIFFs (e.g., NDVI band), drag and drop them into QGIS.
- Adjust the Symbology to **Singleband pseudocolor** (e.g., RdYlGn) to visualize vegetation.
- Use the **Identify Features** tool to click inside the buffers and compare the raw pixel values to the `ndvi_current` and `ndmi_current` stored in `spatial_features`.
- Ensure the `observation_time` matches the acquisition date of the TIFF.

### D. Terrain (deferred)
- Terrain (`elevation`, `slope`) is **not** part of the Sprint 2 feature set.
  For the flat urban campuses in BDG2 it has no causal link to energy demand,
  and in the archived V3 run it acted purely as a building-ID proxy — it was
  the second-highest ranked feature precisely because it took one constant
  value per building.
- Revisit only if a DSM-derived variable with a physical mechanism is needed
  (e.g. sky view factor for the urban canyon effect).

## 4. Conclusion

Completing this workflow is the **acceptance criterion for Sprint 2**: it confirms that the ingestion scripts (`osm_ingestion.py`, `sentinel_ingestion.py` — to be written) map real-world physical properties into PostGIS with correct geometry, CRS and temporal alignment, before any model is allowed to consume them.
