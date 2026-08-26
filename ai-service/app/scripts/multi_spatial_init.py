import psycopg2
import os

DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': os.getenv('POSTGRES_HOST', 'postgis'),
    'port': os.getenv('POSTGRES_PORT', '5432')
}

# Proxy mappings for 4 BDG2 buildings to Izmir coordinates
# Each building has realistic spatial context derived from its geographic setting.
#
# Building 1: IYTE Campus (Urla) — Low Density, High NDVI, Hilly terrain
# Building 2: Alsancak (City center) — High Density, Low NDVI, Flat/coastal
# Building 3: Bornova (University district) — Medium Density, Medium NDVI
# Building 4: Bostanli (Coastal residential) — Medium Density, High NDVI, Flat
SPATIAL_DATA = [
    {
        'building_id': 'Rat_office_Adele',
        'lat': 38.3228,
        'lon': 26.6325,
        'building_density': 15.2,    # Very low density (campus)
        'ndvi_current': 0.65,        # High vegetation (pine forest)
        'ndmi_current': 0.18,        # Moderate moisture (Mediterranean)
        'ndbi_current': -0.25,       # Low built-up (campus greenery)
        'road_density': 3.2,         # km/km² — sparse campus roads
        'green_ratio': 0.72,         # 72% green coverage
        'elevation': 45.2,           # meters — hilly terrain
        'slope': 5.8                 # degrees — moderate slope
    },
    {
        'building_id': 'Rat_office_Annis',
        'lat': 38.4333,
        'lon': 27.1428,
        'building_density': 85.5,    # High density (city center)
        'ndvi_current': 0.12,        # Low vegetation (concrete)
        'ndmi_current': 0.05,        # Low moisture (impervious surfaces)
        'ndbi_current': 0.42,        # High built-up index
        'road_density': 18.7,        # km/km² — dense urban grid
        'green_ratio': 0.08,         # 8% green coverage
        'elevation': 5.1,            # meters — coastal flat
        'slope': 0.8                 # degrees — nearly flat
    },
    {
        'building_id': 'Rat_office_Jessica',
        'lat': 38.4612,
        'lon': 27.2185,
        'building_density': 45.0,    # Medium density (university district)
        'ndvi_current': 0.35,        # Medium vegetation
        'ndmi_current': 0.12,        # Moderate moisture
        'ndbi_current': 0.15,        # Moderate built-up
        'road_density': 10.4,        # km/km² — suburban roads
        'green_ratio': 0.35,         # 35% green coverage
        'elevation': 28.3,           # meters — inland hill
        'slope': 3.2                 # degrees — gentle slope
    },
    {
        'building_id': 'Rat_office_Colby',
        'lat': 38.4551,
        'lon': 27.0945,
        'building_density': 40.0,    # Medium density (coastal residential)
        'ndvi_current': 0.55,        # Medium-high vegetation (parks)
        'ndmi_current': 0.22,        # Higher moisture (coastal)
        'ndbi_current': 0.05,        # Low-moderate built-up
        'road_density': 8.1,         # km/km² — residential streets
        'green_ratio': 0.48,         # 48% green coverage
        'elevation': 3.8,            # meters — coastal flat
        'slope': 1.2                 # degrees — nearly flat
    }
]

def init_spatial_features():
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor()
    
    # Drop and recreate with enriched schema
    cur.execute("DROP TABLE IF EXISTS spatial_features")
    cur.execute("""
        CREATE TABLE spatial_features (
            building_id VARCHAR(50) PRIMARY KEY,
            lat FLOAT,
            lon FLOAT,
            building_density FLOAT,
            ndvi_current FLOAT,
            ndmi_current FLOAT,
            ndbi_current FLOAT,
            road_density FLOAT,
            green_ratio FLOAT,
            elevation FLOAT,
            slope FLOAT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    for data in SPATIAL_DATA:
        cur.execute("""
            INSERT INTO spatial_features 
                (building_id, lat, lon, building_density, ndvi_current,
                 ndmi_current, ndbi_current, road_density, green_ratio,
                 elevation, slope)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (building_id) 
            DO UPDATE SET 
                lat = EXCLUDED.lat,
                lon = EXCLUDED.lon,
                building_density = EXCLUDED.building_density,
                ndvi_current = EXCLUDED.ndvi_current,
                ndmi_current = EXCLUDED.ndmi_current,
                ndbi_current = EXCLUDED.ndbi_current,
                road_density = EXCLUDED.road_density,
                green_ratio = EXCLUDED.green_ratio,
                elevation = EXCLUDED.elevation,
                slope = EXCLUDED.slope,
                last_updated = CURRENT_TIMESTAMP
        """, (
            data['building_id'], data['lat'], data['lon'],
            data['building_density'], data['ndvi_current'],
            data['ndmi_current'], data['ndbi_current'],
            data['road_density'], data['green_ratio'],
            data['elevation'], data['slope']
        ))
        print(f"Inserted spatial features for {data['building_id']}")
        
    conn.commit()
    cur.close()
    conn.close()
    print("Multi-building spatial initialization complete (11 columns, 4 buildings).")

if __name__ == "__main__":
    init_spatial_features()
