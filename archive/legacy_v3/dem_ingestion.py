import os
import psycopg2
import random

# Fixed coordinates for the IYTE Architecture Faculty Pilot Building
BUILDING_ID = "IYTE_ARCH_001"
LAT, LON = 38.3228, 26.6325

DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': os.getenv('POSTGIS_HOST', 'localhost'),
    'port': os.getenv('POSTGIS_PORT', '5433')
}

def fetch_dem_data():
    print(f"Fetching Copernicus DEM (30m) data for coordinates: {LAT}, {LON}")
    print("Mocking DEM extraction (via OpenTopography/Copernicus API simulation)...")
    # IYTE campus is slightly hilly. Elevation is around 45m.
    elevation = 45.2 + random.uniform(-1, 1)
    # Slope in degrees
    slope = 5.8 + random.uniform(-0.5, 0.5)
    
    return elevation, slope

def update_spatial_features(elevation, slope):
    try:
        conn = psycopg2.connect(**DB_PARAMS)
        cur = conn.cursor()
        
        # We update the existing spatial_features with static terrain context.
        # Since elevation and slope are static for the building, we update all records for this building.
        update_query = """
            UPDATE spatial_features
            SET elevation = %s,
                slope = %s
            WHERE building_id = %s;
        """
        cur.execute(update_query, (elevation, slope, BUILDING_ID))
        conn.commit()
        
        updated_rows = cur.rowcount
        print(f"Successfully updated {updated_rows} spatial feature records with DEM data (Elevation: {elevation:.2f}m, Slope: {slope:.2f}°)")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error updating database: {e}")

if __name__ == "__main__":
    print("Starting DEM ingestion process...")
    elevation, slope = fetch_dem_data()
    update_spatial_features(elevation, slope)
    print("DEM ingestion completed.")
