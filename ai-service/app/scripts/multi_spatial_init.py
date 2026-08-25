import psycopg2
import time

DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': 'localhost',
    'port': '5433'
}

# Proxy mappings for 4 BDG2 buildings to Izmir coordinates
# Building 1: IYTE (Low Density, High NDVI)
# Building 2: Alsancak (High Density, Low NDVI)
# Building 3: Bornova (Medium Density, Medium NDVI)
# Building 4: Bostanli (Medium Density, High NDVI)
SPATIAL_DATA = [
    {
        'building_id': 'Rat_office_Adele',
        'lat': 38.3228,
        'lon': 26.6325,
        'building_density': 15.2, # Very low density
        'ndvi_current': 0.65 # High vegetation
    },
    {
        'building_id': 'Rat_office_Annis',
        'lat': 38.4333,
        'lon': 27.1428,
        'building_density': 85.5, # High density
        'ndvi_current': 0.12 # Low vegetation
    },
    {
        'building_id': 'Rat_office_Jessica',
        'lat': 38.4612,
        'lon': 27.2185,
        'building_density': 45.0, # Medium density
        'ndvi_current': 0.35 # Medium vegetation
    },
    {
        'building_id': 'Rat_office_Colby',
        'lat': 38.4551,
        'lon': 27.0945,
        'building_density': 40.0, # Medium density
        'ndvi_current': 0.55 # Medium-high vegetation
    }
]

def init_spatial_features():
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor()
    
    # Ensure table exists with correct schema
    cur.execute("DROP TABLE IF EXISTS spatial_features")
    cur.execute("""
        CREATE TABLE spatial_features (
            building_id VARCHAR(50) PRIMARY KEY,
            lat FLOAT,
            lon FLOAT,
            building_density FLOAT,
            ndvi_current FLOAT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Insert or update data
    for data in SPATIAL_DATA:
        cur.execute("""
            INSERT INTO spatial_features (building_id, lat, lon, building_density, ndvi_current)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (building_id) 
            DO UPDATE SET 
                lat = EXCLUDED.lat,
                lon = EXCLUDED.lon,
                building_density = EXCLUDED.building_density,
                ndvi_current = EXCLUDED.ndvi_current,
                last_updated = CURRENT_TIMESTAMP
        """, (data['building_id'], data['lat'], data['lon'], data['building_density'], data['ndvi_current']))
        print(f"Inserted/Updated spatial features for {data['building_id']}")
        
    conn.commit()
    cur.close()
    conn.close()
    print("Multi-building spatial initialization complete.")

if __name__ == "__main__":
    init_spatial_features()
