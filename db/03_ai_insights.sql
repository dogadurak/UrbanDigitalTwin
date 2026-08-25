CREATE TABLE IF NOT EXISTS ai_insights (
    id VARCHAR(100) PRIMARY KEY,
    target_entity VARCHAR(100),
    insight_type VARCHAR(50),
    severity VARCHAR(20),
    anomaly_score FLOAT,
    observed_value FLOAT,
    expected_value FLOAT,
    model_name VARCHAR(50),
    model_version VARCHAR(20),
    detected_at TIMESTAMP,
    geometry GEOMETRY(Point, 4326)
);
