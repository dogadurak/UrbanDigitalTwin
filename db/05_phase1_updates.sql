-- Phase 1: Real Data Veritabanı Güncellemeleri

-- 1. Ingestion Runs (Data Lineage) Tablosu
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(100) NOT NULL, -- Örn: Open-Meteo, OSMnx
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL, -- SUCCESS, FAILED, RUNNING
    records_read INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_rejected INTEGER DEFAULT 0,
    error_message TEXT
);

-- 2. Hava Durumu (Weather) Tablosu
CREATE TABLE IF NOT EXISTS weather_observations (
    id SERIAL PRIMARY KEY,
    ingestion_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    temperature FLOAT,
    humidity FLOAT,
    wind_speed FLOAT,
    precipitation FLOAT,
    pressure FLOAT,
    source VARCHAR(100),
    source_url TEXT,
    retrieved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. OSM Binalar Tablosu (External Context)
CREATE TABLE IF NOT EXISTS osm_buildings (
    id SERIAL PRIMARY KEY,
    osm_id BIGINT UNIQUE, -- OpenStreetMap'teki orijinal ID
    ingestion_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    name VARCHAR(255),
    building_type VARCHAR(100),
    levels INTEGER,
    geom geometry(Polygon, 4326),
    source_url TEXT,
    retrieved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. OSM Yollar Tablosu (External Context)
CREATE TABLE IF NOT EXISTS osm_roads (
    id SERIAL PRIMARY KEY,
    osm_id BIGINT UNIQUE,
    ingestion_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    name VARCHAR(255),
    highway_type VARCHAR(100), -- Örn: residential, primary, footway
    lanes INTEGER,
    maxspeed VARCHAR(20),
    geom geometry(LineString, 4326),
    source_url TEXT,
    retrieved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indeksler (Analiz performansını artırmak için)
CREATE INDEX IF NOT EXISTS idx_weather_observed_at ON weather_observations(observed_at);
CREATE INDEX IF NOT EXISTS idx_osm_buildings_geom ON osm_buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_osm_roads_geom ON osm_roads USING GIST (geom);
