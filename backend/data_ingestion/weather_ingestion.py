import os
import requests
import json
from datetime import datetime
from sqlalchemy import create_engine, text
from data_lineage import logger
from config import PILOT_LAT, PILOT_LON, DATABASE_URL

# RAW veri klasörü
RAW_DIR = "raw_data"
os.makedirs(RAW_DIR, exist_ok=True)

def fetch_weather_data():
    """
    Open-Meteo API'den İzmir pilot alanı için güncel hava durumu verilerini çeker (RAW).
    Hatalı/eksik değerleri temizler (NORMALIZED).
    Sonuçları PostGIS'e aktarır.
    """
    source_name = "Open-Meteo API"
    run_id = logger.start_run(source=source_name)
    
    url = f"https://api.open-meteo.com/v1/forecast?latitude={PILOT_LAT}&longitude={PILOT_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,wind_speed_10m,surface_pressure&timezone=Europe%2FMoscow"
    
    try:
        # 1. RAW DATA (Veri Çekimi ve Saklanması)
        print("Fetching weather data from Open-Meteo...")
        response = requests.get(url)
        response.raise_for_status()
        raw_data = response.json()
        
        # Save RAW data
        raw_filename = os.path.join(RAW_DIR, f"weather_raw_{run_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.json")
        with open(raw_filename, "w", encoding="utf-8") as f:
            json.dump(raw_data, f, indent=4)
            
        current_data = raw_data.get("current", {})
        
        # 2. VALIDATION & NORMALIZATION
        records_read = 1
        missing = 0
        expected_keys = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m"]
        for key in expected_keys:
            if current_data.get(key) is None:
                missing += 1
                
        # Mantık kontrolü (Improbable temperatures)
        temp = current_data.get("temperature_2m")
        if temp is not None and (temp < -50 or temp > 60):
            raise ValueError(f"Impossible temperature detected: {temp}")
            
        # 3. POSTGIS INSERTION
        engine = create_engine(DATABASE_URL)
        query = text("""
            INSERT INTO weather_observations (
                ingestion_run_id, observed_at, temperature, humidity, wind_speed, 
                precipitation, pressure, source, source_url
            ) VALUES (
                :run_id, :observed_at, :temp, :humidity, :wind, 
                :precip, :pressure, :source, :source_url
            )
        """)
        
        with engine.begin() as conn:
            conn.execute(query, {
                "run_id": run_id,
                "observed_at": current_data.get("time"),
                "temp": temp,
                "humidity": current_data.get("relative_humidity_2m"),
                "wind": current_data.get("wind_speed_10m"),
                "precip": current_data.get("precipitation"),
                "pressure": current_data.get("surface_pressure"),
                "source": source_name,
                "source_url": url
            })
            
        # 4. FINISH RUN
        logger.finish_run(
            run_id=run_id, 
            status="SUCCESS", 
            records_read=records_read, 
            records_inserted=1, 
            records_rejected=0
        )
        
    except Exception as e:
        print(f"Ingestion Error: {str(e)}")
        logger.finish_run(
            run_id=run_id, 
            status="FAILED", 
            error_message=str(e)
        )

if __name__ == "__main__":
    fetch_weather_data()
