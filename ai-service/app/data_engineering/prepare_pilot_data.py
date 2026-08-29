"""SUPERSEDED by app/data_engineering/build_dataset.py (Sprint 1).

This builds the original 4-building pilot: 0.24% of BDG2, all from one site,
targeting absolute kWh across buildings whose mean consumption spans 61x. On
that setup, predicting each building's constant mean already scores R2 = 0.9188,
so aggregate metrics measured scale rather than skill.

Kept only so the archived V3 results remain reproducible. For new work use:

    python -m app.data_engineering.build_dataset

See docs/DATA_QUALITY.md and archive/legacy_v3/README.md.
"""

import pandas as pd
import numpy as np
import os

def prepare_pilot_data():
    building_ids = ['Rat_office_Adele', 'Rat_office_Annis', 'Rat_office_Jessica', 'Rat_office_Colby']
    site_id = 'Rat'
    
    electricity_path = 'data/building-data-genome-project-2/data/meters/cleaned/electricity_cleaned.csv'
    weather_path = 'data/building-data-genome-project-2/data/weather/weather.csv'
    
    print("Loading data...")
    if not os.path.exists(electricity_path):
        print(f"Error: {electricity_path} not found. Please pull via git lfs.")
        return
        
    df_elec = pd.read_csv(electricity_path, usecols=['timestamp'] + building_ids)
    df_elec['timestamp'] = pd.to_datetime(df_elec['timestamp'])
    
    # Melt the dataframe so building_id is a column
    df_elec = df_elec.melt(id_vars=['timestamp'], value_vars=building_ids, var_name='building_id', value_name='meter_reading')
    
    df_weather = pd.read_csv(weather_path)
    df_weather = df_weather[df_weather['site_id'] == site_id]
    df_weather['timestamp'] = pd.to_datetime(df_weather['timestamp'])
    
    print("Merging data...")
    df = pd.merge(df_elec, df_weather, on='timestamp', how='inner')
    
    df = df.dropna(subset=['meter_reading', 'airTemperature'])
    
    # Feature Engineering
    df['hour'] = df['timestamp'].dt.hour
    df['day_of_week'] = df['timestamp'].dt.dayofweek
    df['month'] = df['timestamp'].dt.month
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    
    # Rename weather column to match expected XGBoost feature
    df = df.rename(columns={'airTemperature': 'outdoor_temperature'})
    
    df = df.ffill()
    
    # Target variable 'energy' instead of 'meter_reading' to match experiments
    df['energy'] = df['meter_reading']
    
    # Temporal Split (2016 for Train, 2017 for Test)
    print("Performing temporal split...")
    df_train = df[df['timestamp'].dt.year == 2016]
    df_test = df[df['timestamp'].dt.year >= 2017]
    
    # Save datasets
    os.makedirs('data/pilot', exist_ok=True)
    df_train.to_csv('data/pilot/train.csv', index=False)
    df_test.to_csv('data/pilot/test.csv', index=False)
    
    print(f"Data prepared successfully!")
    print(f"Train samples: {len(df_train)}")
    print(f"Test samples: {len(df_test)}")

if __name__ == "__main__":
    prepare_pilot_data()
