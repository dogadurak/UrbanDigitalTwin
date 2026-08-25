const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'geotwin_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'geotwin_db',
  password: process.env.POSTGRES_PASSWORD || 'geotwin_password',
  port: process.env.POSTGRES_PORT || 5433,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
