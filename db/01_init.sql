-- GeoTwin Veritabanı Başlatma Betiği (Phase 0)

-- Mekansal Eklentiyi Etkinleştir
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Binalar Tablosu (Bina geometrisi ve metadata)
CREATE TABLE IF NOT EXISTS buildings (
    id VARCHAR(50) PRIMARY KEY, -- Örn: BLDG_001
    name VARCHAR(255) NOT NULL,
    description TEXT,
    geom geometry(Polygon, 4326), -- EPSG:4326 (WGS 84) ile mekansal veri
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Katlar Tablosu (Bina -> Kat ilişkisi)
CREATE TABLE IF NOT EXISTS floors (
    id VARCHAR(50) PRIMARY KEY, -- Örn: FLR_02
    building_id VARCHAR(50) REFERENCES buildings(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    level INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Odalar Tablosu (Kat -> Oda ilişkisi)
CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(50) PRIMARY KEY, -- Örn: ROOM_204
    floor_id VARCHAR(50) REFERENCES floors(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50), -- Örn: OFFICE, SERVER_ROOM
    geom geometry(Polygon, 4326), -- Odanın tahmini mekansal izi
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Sensörler Tablosu (Oda -> Sensör ilişkisi)
CREATE TABLE IF NOT EXISTS sensors (
    id VARCHAR(50) PRIMARY KEY, -- Örn: SENSOR_204_TEMP
    room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- Örn: TEMPERATURE, HUMIDITY, CO2
    unit VARCHAR(20),
    geom geometry(Point, 4326), -- Sensörün tam koordinatı
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Uydu/Bağlam (Spatial Context) Veri Tablosu
CREATE TABLE IF NOT EXISTS satellite_observations (
    id SERIAL PRIMARY KEY,
    location geometry(Point, 4326),
    acquisition_date TIMESTAMP WITH TIME ZONE NOT NULL,
    ndvi FLOAT,
    ndmi FLOAT,
    land_cover_class VARCHAR(50),
    cloud_cover FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Mekansal indeksleme performans artışı için
CREATE INDEX IF NOT EXISTS idx_buildings_geom ON buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_rooms_geom ON rooms USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_sensors_geom ON sensors USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_satellite_obs_loc ON satellite_observations USING GIST (location);

-- No seed data.
--
-- This file previously inserted an invented building ("Izmir Pilot Bina") with a
-- hand-written polygon, plus a floor, a room and a sensor, so the dashboard had
-- something to draw. None of it was measurement. Real building reference data
-- comes from BDG2 via db/07_bdg2_buildings.sql and
-- app/data_engineering/load_buildings_to_db.py.
