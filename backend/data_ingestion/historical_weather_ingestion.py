import requests
import logging
from sqlalchemy import create_engine, text
from datetime import datetime, timedelta

from config import PILOT_LAT, PILOT_LON, DATABASE_URL
from data_lineage import logger as lineage_logger

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

def fetch_historical_weather():
    source_name = "Open-Meteo Historical API"
    run_id = lineage_logger.start_run(source=source_name)
    
    engine = create_engine(DATABASE_URL)
    
    try:
        # Fetch last 7 days
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=7)
        
        url = "https://archive-api.open-meteo.com/v1/archive"
        params = {
            "latitude": PILOT_LAT,
            "longitude": PILOT_LON,
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,surface_pressure",
            "timezone": "UTC"
        }
        
        logger.info(f"Fetching historical weather data from {start_date} to {end_date}")
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        temps = hourly.get("temperature_2m", [])
        humids = hourly.get("relative_humidity_2m", [])
        winds = hourly.get("wind_speed_10m", [])
        precips = hourly.get("precipitation", [])
        pressures = hourly.get("surface_pressure", [])
        
        insert_query = text("""
            INSERT INTO weather_observations 
            (ingestion_run_id, observed_at, temperature, humidity, wind_speed, precipitation, pressure, source, source_url)
            VALUES 
            (:run_id, :obs_time, :temp, :hum, :wind, :precip, :press, :source, :url)
        """)
        
        inserted_count = 0
        with engine.begin() as conn:
            for i in range(len(times)):
                if temps[i] is None:
                    continue # Skip missing data
                    
                conn.execute(insert_query, {
                    "run_id": run_id,
                    "obs_time": times[i],
                    "temp": temps[i],
                    "hum": humids[i],
                    "wind": winds[i],
                    "precip": precips[i],
                    "press": pressures[i],
                    "source": source_name,
                    "url": url
                })
                inserted_count += 1
                
        logger.info(f"Inserted {inserted_count} historical weather observations.")
        lineage_logger.finish_run(run_id, status="SUCCESS", records_inserted=inserted_count)
        
    except Exception as e:
        logger.error(f"Error fetching historical weather: {e}", exc_info=True)
        lineage_logger.finish_run(run_id, status="FAILED", records_inserted=0, error_message=str(e))

if __name__ == "__main__":
    fetch_historical_weather()
