-- BDG2 building reference data, loaded from the dataset's own metadata.
--
-- The API needs a building's real attributes at serve time (floor area, use,
-- age) because the served model is lag-free: it predicts for a building with no
-- meter history, so attributes and weather are all it has.
--
-- Coordinates are stored but deliberately NOT exposed as model features.
-- Miller et al. (2020) set them to "the central location of either the site or
-- the city", with every building within a 40 km radius, so they identify a site
-- rather than locate a building. See app/data_engineering/leakage.py.

-- PostGIS supplies the geometry type below. Declared here rather than relied on
-- from another file: this schema has to stand on its own.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS bdg2_buildings (
    building_id        VARCHAR(80) PRIMARY KEY,
    site_id            VARCHAR(40) NOT NULL,
    spatial_block      VARCHAR(40),          -- LOSO fold: sites within 40 km merged
    primaryspaceusage  VARCHAR(80),
    sqm                DOUBLE PRECISION,
    yearbuilt          INTEGER,
    numberoffloors     DOUBLE PRECISION,
    timezone           VARCHAR(40),
    site_lat           DOUBLE PRECISION,     -- site/city centroid, +/- 40 km
    site_lng           DOUBLE PRECISION,
    coord_status       VARCHAR(32),          -- ok | missing | timezone_mismatch | ...
    geo_usable         BOOLEAN DEFAULT FALSE,
    meter_usable       BOOLEAN DEFAULT FALSE,
    geom               geometry(Point, 4326) -- site centroid, for map display only
);

CREATE INDEX IF NOT EXISTS idx_bdg2_buildings_site ON bdg2_buildings (site_id);
CREATE INDEX IF NOT EXISTS idx_bdg2_buildings_geom ON bdg2_buildings USING GIST (geom);
