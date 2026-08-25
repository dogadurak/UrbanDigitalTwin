# QGIS Validation Workflow for GeoTwin V3

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

### D. Copernicus DEM Validation
- Load the Copernicus DEM 30m raster (or SRTM) for the Izmir region.
- Compare the elevation under the building footprint with the `elevation` and `slope` columns in the `spatial_features` table. (Currently tested as ~44m elevation, ~5.4° slope).

## 4. Conclusion

By completing this workflow, you confirm that the automated Python ingestion scripts (`osm_ingestion.py`, `sentinel_ingestion.py`, `dem_ingestion.py`) are correctly mapping real-world physical properties into the PostgreSQL database, which the AI models will now consume.
