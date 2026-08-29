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

-- Seed Mock BIM Data for "urn:ngsi-ld:Building:Izmir-1"

INSERT INTO floors (id, building_id, floor_number, level_name) VALUES
('urn:ngsi-ld:Floor:1', 'urn:ngsi-ld:Building:Izmir-1', 1, 'Ground Floor'),
('urn:ngsi-ld:Floor:2', 'urn:ngsi-ld:Building:Izmir-1', 2, 'First Floor');

INSERT INTO rooms (id, floor_id, room_name) VALUES
('urn:ngsi-ld:Room:101', 'urn:ngsi-ld:Floor:1', 'Lobby'),
('urn:ngsi-ld:Room:102', 'urn:ngsi-ld:Floor:1', 'Server Room'),
('urn:ngsi-ld:Room:103', 'urn:ngsi-ld:Floor:1', 'Office 1'),
('urn:ngsi-ld:Room:104', 'urn:ngsi-ld:Floor:1', 'Cafeteria'),
('urn:ngsi-ld:Room:201', 'urn:ngsi-ld:Floor:2', 'Conference Room A'),
('urn:ngsi-ld:Room:202', 'urn:ngsi-ld:Floor:2', 'Office 2'),
('urn:ngsi-ld:Room:203', 'urn:ngsi-ld:Floor:2', 'Office 3'),
('urn:ngsi-ld:Room:204', 'urn:ngsi-ld:Floor:2', 'HVAC Utility Room');

INSERT INTO iot_devices (id, room_id, device_type) VALUES
('urn:ngsi-ld:IoTDevice:Env-101', 'urn:ngsi-ld:Room:101', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-102', 'urn:ngsi-ld:Room:102', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-103', 'urn:ngsi-ld:Room:103', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-104', 'urn:ngsi-ld:Room:104', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-201', 'urn:ngsi-ld:Room:201', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-202', 'urn:ngsi-ld:Room:202', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-203', 'urn:ngsi-ld:Room:203', 'ENVIRONMENTAL_SENSOR'),
('urn:ngsi-ld:IoTDevice:Env-204', 'urn:ngsi-ld:Room:204', 'ENVIRONMENTAL_SENSOR');

-- Initial readings
INSERT INTO sensor_readings (device_id, temperature, humidity, co2, status_flag) VALUES
('urn:ngsi-ld:IoTDevice:Env-101', 24.5, 45, 400, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-102', 22.0, 40, 410, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-103', 24.0, 44, 420, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-104', 25.0, 50, 450, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-201', 23.5, 43, 405, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-202', 24.1, 44, 415, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-203', 24.2, 45, 410, 'NORMAL'),
('urn:ngsi-ld:IoTDevice:Env-204', 28.0, 55, 500, 'WARNING');
