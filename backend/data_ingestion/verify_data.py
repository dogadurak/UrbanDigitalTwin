import logging
from sqlalchemy import create_engine, text
from config import DATABASE_URL
import pandas as pd

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

def verify_data():
    engine = create_engine(DATABASE_URL)
    
    queries = {
        "Ingestion Runs": "SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 5;",
        "Weather Observations Count": "SELECT count(*) FROM weather_observations;",
        "OSM Buildings Count": "SELECT count(*) FROM osm_buildings;",
        "OSM Roads Count": "SELECT count(*) FROM osm_roads;",
    }
    
    try:
        with engine.connect() as conn:
            for name, query in queries.items():
                logger.info(f"--- {name} ---")
                df = pd.read_sql(text(query), conn)
                print(df.to_string(index=False))
                print("\n")
                
            # Lineage check
            logger.info("--- Data Lineage Check ---")
            lineage_query = text("""
                SELECT source, status, records_inserted, error_message, started_at, finished_at
                FROM ingestion_runs
                ORDER BY started_at DESC
                LIMIT 5;
            """)
            df_lineage = pd.read_sql(lineage_query, conn)
            print(df_lineage.to_string(index=False))
            print("\n")
            
    except Exception as e:
        logger.error(f"Verification failed: {e}")

if __name__ == "__main__":
    verify_data()
