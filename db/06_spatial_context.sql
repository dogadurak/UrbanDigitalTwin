CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Pilot Building Footprints
CREATE TABLE IF NOT EXISTS building_footprints (
    building_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    geom geometry(Polygon, 4326),
    building_area_sqm FLOAT,
    height FLOAT
);

-- 2. Sentinel Observations (Raw Data Lineage)
CREATE TABLE IF NOT EXISTS sentinel_observations (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    collection VARCHAR(50) DEFAULT 'SENTINEL-2-L2A',
    acquisition_time TIMESTAMP NOT NULL,
    cloud_cover FLOAT,
    processing_level VARCHAR(50),
    crs VARCHAR(20),
    resolution_m INT,
    ndvi_mean FLOAT,
    ndmi_mean FLOAT,
    ndbi_mean FLOAT,
    geom_buffer geometry(Polygon, 4326), -- The extent of the raster processed
    UNIQUE (product_id)
);

-- 3. Spatial Features (Derived Context)
CREATE TABLE IF NOT EXISTS spatial_features (
    id SERIAL PRIMARY KEY,
    building_id VARCHAR(50) REFERENCES building_footprints(building_id),
    buffer_radius_m INT NOT NULL,
    observation_time TIMESTAMP NOT NULL,
    
    -- Dynamic (Sentinel-2)
    ndvi_current FLOAT,
    ndvi_change_30d FLOAT,
    ndvi_change_90d FLOAT,
    ndmi_current FLOAT,
    ndmi_change_30d FLOAT,
    ndbi_current FLOAT,
    
    -- Static Context (OSM)
    building_density FLOAT,
    road_density FLOAT,
    green_ratio FLOAT,
    
    -- Terrain (DEM)
    elevation FLOAT,
    slope FLOAT,
    
    source_version VARCHAR(50),
    UNIQUE(building_id, buffer_radius_m, observation_time)
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_spatial_features_building_time ON spatial_features (building_id, observation_time);
CREATE INDEX IF NOT EXISTS idx_sentinel_time ON sentinel_observations (acquisition_time);
CREATE INDEX IF NOT EXISTS idx_building_geom ON building_footprints USING GIST (geom);
