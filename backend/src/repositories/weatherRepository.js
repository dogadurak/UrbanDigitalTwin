const db = require('./db');

class WeatherRepository {
  async getLatestWeather() {
    const query = `
      SELECT observed_at, temperature, humidity, wind_speed, precipitation, pressure
      FROM weather_observations
      ORDER BY observed_at DESC
      LIMIT 1;
    `;
    const result = await db.query(query);
    return result.rows[0];
  }
}

module.exports = new WeatherRepository();
