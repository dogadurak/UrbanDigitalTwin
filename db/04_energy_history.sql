-- Energy history buffer for AI service lag features
CREATE TABLE IF NOT EXISTS building_energy_history (
    id SERIAL PRIMARY KEY,
    building_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    energy_value FLOAT NOT NULL
);

-- Index for quick retrieval of recent history per building
CREATE INDEX IF NOT EXISTS idx_building_energy_history_lookup 
ON building_energy_history (building_id, timestamp DESC);
