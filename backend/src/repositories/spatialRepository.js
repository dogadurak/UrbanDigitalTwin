const db = require('./db');

class SpatialRepository {
  async getBuildings() {
    const query = `
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(ST_AsGeoJSON(t.*)::json)
      ) AS geojson
      FROM (
        SELECT osm_id, name, building, ST_Transform(geom, 4326) AS geom
        FROM osm_buildings
      ) AS t;
    `;
    const result = await db.query(query);
    return result.rows[0].geojson || { type: 'FeatureCollection', features: [] };
  }

  async getRoads() {
    const query = `
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(ST_AsGeoJSON(t.*)::json)
      ) AS geojson
      FROM (
        SELECT osm_id, name, highway, ST_Transform(geom, 4326) AS geom
        FROM osm_roads
      ) AS t;
    `;
    const result = await db.query(query);
    return result.rows[0].geojson || { type: 'FeatureCollection', features: [] };
  }
  async insertAIInsight(insight) {
    const query = `
      INSERT INTO ai_insights (id, target_entity, insight_type, severity, anomaly_score, observed_value, expected_value, model_name, model_version, detected_at, geometry)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ST_SetSRID(ST_MakePoint($11, $12), 4326))
      ON CONFLICT (id) DO NOTHING;
    `;
    // For now we mock a central geometry for the building in Izmir
    // Longitude, Latitude
    const lon = 27.1428;
    const lat = 38.4237;

    const values = [
      insight.id,
      insight.refRoom?.object || 'unknown',
      insight.insightType?.value || 'Unknown',
      insight.severity?.value || 'MEDIUM',
      insight.anomalyScore?.value || 0.0,
      insight.observedValue?.value || 0.0,
      insight.expectedValue?.value || 0.0,
      insight.model?.value || 'unknown',
      insight.modelVersion?.value || '1.0',
      insight.detectedAt?.value || new Date().toISOString(),
      lon,
      lat
    ];
    
    await db.query(query, values);
  }
}

module.exports = new SpatialRepository();
