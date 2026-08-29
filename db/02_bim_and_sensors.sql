-- BIM & IoT Sensors Schema (Phase 3)

DROP TABLE IF EXISTS sensor_readings CASCADE;
DROP TABLE IF EXISTS iot_devices CASCADE;
DROP TABLE IF EXISTS sensors CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS floors CASCADE;

-- 1. Floors
CREATE TABLE floors (
    id VARCHAR(50) PRIMARY KEY,
    building_id VARCHAR(50) NOT NULL,
    floor_number INT NOT NULL,
    level_name VARCHAR(50)
);

-- 2. Rooms
CREATE TABLE rooms (
    id VARCHAR(50) PRIMARY KEY,
    floor_id VARCHAR(50) REFERENCES floors(id) ON DELETE CASCADE,
    room_name VARCHAR(50) NOT NULL,
    geom geometry(Polygon, 4326)
);

-- 3. IoT Devices
CREATE TABLE iot_devices (
    id VARCHAR(50) PRIMARY KEY, -- e.g., 'urn:ngsi-ld:IoTDevice:HVAC-101'
    room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE SET NULL,
    device_type VARCHAR(50) NOT NULL, -- 'HVAC_SENSOR', 'FIRE_DETECTOR', 'PRESENCE_SENSOR'
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- 4. Sensor Readings
CREATE TABLE sensor_readings (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) REFERENCES iot_devices(id) ON DELETE CASCADE,
    measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    temperature NUMERIC,
    humidity NUMERIC,
    co2 NUMERIC,
    status_flag VARCHAR(20) -- e.g., 'ALARM', 'NORMAL'
);

-- No seed data.
--
-- This file previously seeded a fictional building: 2 floors, 8 rooms, 8 IoT
-- devices and 8 sensor readings (22.0 C, 45% humidity, 400 ppm CO2). Those rows
-- were displayed as if they were telemetry. The tables remain so the schema is
-- complete, and stay empty until a real source fills them.
