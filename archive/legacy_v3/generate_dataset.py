import pandas as pd
import numpy as np
import datetime
import os

def generate_historical_dataset(start_date="2025-01-01", days=90, output_path="data/training/historical_data.csv"):
    print("Generating synthetic historical dataset for training...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    start = datetime.datetime.strptime(start_date, "%Y-%m-%d")
    date_rng = pd.date_range(start=start, periods=days * 24, freq='h')
    
    df = pd.DataFrame(date_rng, columns=['timestamp'])
    df['hour'] = df['timestamp'].dt.hour
    df['day_of_week'] = df['timestamp'].dt.dayofweek
    df['day'] = df['timestamp'].dt.day
    
    # Simulate environmental context (Weather)
    # Seasonal variation + daily variation
    base_outdoor = 20.0 + np.sin(df['timestamp'].dt.dayofyear / 365.0 * 2 * np.pi) * 10
    daily_variation = np.sin((df['hour'] - 6) / 24.0 * 2 * np.pi) * 5
    df['outdoor_temperature'] = base_outdoor + daily_variation + np.random.normal(0, 1.5, len(df))
    
    df['humidity'] = 50 + np.sin((df['hour']) / 24.0 * 2 * np.pi) * 20 + np.random.normal(0, 5, len(df))
    df['humidity'] = df['humidity'].clip(20, 90)
    
    # Solar Context (1=Sun, 0=Night/Cloudy)
    df['solar_context'] = df['hour'].apply(lambda x: 1.0 if 8 <= x <= 18 else 0.0)
    # Adding some cloudy days randomly
    cloudy_days = np.random.choice(df['timestamp'].dt.date.unique(), size=int(days*0.3), replace=False)
    df.loc[df['timestamp'].dt.date.isin(cloudy_days), 'solar_context'] *= 0.3

    # Building & Room Context
    df['floor_level'] = 2
    df['room_area'] = 45.0
    df['building_orientation'] = 180 # South facing
    df['distance_to_external_wall'] = 2.0
    df['NDVI'] = 0.45 # Moderate green area nearby
    
    # Occupancy: Higher during day (8-18), very low at night/weekends
    is_weekend = df['day_of_week'] >= 5
    is_work_hour = (df['hour'] >= 8) & (df['hour'] <= 18)
    df['occupancy'] = np.where(~is_weekend & is_work_hour, np.random.randint(1, 6, len(df)), 0)
    
    # HVAC Runtime and Status
    # HVAC turns on if outdoor > 24 or < 18, and occupied
    needs_hvac = ((df['outdoor_temperature'] > 24) | (df['outdoor_temperature'] < 18)) & (df['occupancy'] > 0)
    df['hvac_status'] = needs_hvac.astype(int)
    
    # Simulate HVAC Runtime over a rolling window (last 4 hours)
    df['hvac_runtime'] = df['hvac_status'].rolling(window=4, min_periods=1).sum()
    
    # Indoor Temperature Simulation
    # Baseline 22C
    # Influenced by outdoor temp, solar gain, occupancy heat, and HVAC
    df['indoor_temperature'] = 22.0
    temp_diff = df['outdoor_temperature'] - df['indoor_temperature']
    solar_gain = df['solar_context'] * 0.5
    occ_heat = df['occupancy'] * 0.2
    
    # If HVAC is ON, it pulls towards 22
    # If OFF, it drifts towards outdoor
    for i in range(1, len(df)):
        prev_temp = df.loc[i-1, 'indoor_temperature']
        drift = (df.loc[i, 'outdoor_temperature'] - prev_temp) * 0.05
        heat = (df.loc[i, 'solar_context'] * 0.5) + (df.loc[i, 'occupancy'] * 0.2)
        
        if df.loc[i, 'hvac_status'] == 1:
            cooling_effort = (22.0 - prev_temp) * 0.4
        else:
            cooling_effort = 0
            
        new_temp = prev_temp + drift + heat + cooling_effort + np.random.normal(0, 0.2)
        df.loc[i, 'indoor_temperature'] = new_temp
        
    df['temperature_delta'] = df['indoor_temperature'].diff().fillna(0)
    df['humidity_delta'] = df['humidity'].diff().fillna(0)
    df['outside_inside_temp_diff'] = df['outdoor_temperature'] - df['indoor_temperature']
    df['rolling_mean'] = df['indoor_temperature'].rolling(window=3, min_periods=1).mean()
    df['rolling_std'] = df['indoor_temperature'].rolling(window=3, min_periods=1).std().fillna(0)

    # Energy Simulation (Historical Energy)
    # Base load + HVAC load (proportional to difference from target temp)
    base_load = 5.0 + (df['occupancy'] * 1.5)
    hvac_load = df['hvac_status'] * 10.0 + df['hvac_status'] * abs(df['outdoor_temperature'] - 22.0) * 1.2
    df['energy'] = base_load + hvac_load + np.random.normal(0, 1.0, len(df))
    df['historical_energy'] = df['energy'].shift(24).fillna(df['energy'].mean()) # naive yesterday value

    # Power ratio
    df['power_ratio'] = df['energy'] / df['energy'].mean()

    # Drop any NaNs
    df = df.dropna()

    df.to_csv(output_path, index=False)
    print(f"Dataset generated at {output_path} with {len(df)} records.")
    return df

def generate_anomalous_dataset(df, output_path="data/synthetic/replay_data.csv"):
    print("Generating anomalous replay dataset...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    replay_df = df.tail(24 * 7).copy().reset_index(drop=True) # Last 7 days
    
    # Inject Thermal Anomaly: HVAC degrades, so cooling effort reduces, temp rises despite HVAC=1
    anomaly_start = 24 * 4 # Day 4
    for i in range(anomaly_start, anomaly_start + 12):
        replay_df.loc[i, 'hvac_status'] = 1
        replay_df.loc[i, 'indoor_temperature'] += (i - anomaly_start) * 0.5 # Steady rise
        replay_df.loc[i, 'energy'] += (i - anomaly_start) * 2.0 # Working harder but failing

    replay_df['temperature_delta'] = replay_df['indoor_temperature'].diff().fillna(0)
    replay_df['outside_inside_temp_diff'] = replay_df['outdoor_temperature'] - replay_df['indoor_temperature']
    replay_df['rolling_mean'] = replay_df['indoor_temperature'].rolling(window=3, min_periods=1).mean()
    replay_df['rolling_std'] = replay_df['indoor_temperature'].rolling(window=3, min_periods=1).std().fillna(0)
    replay_df['power_ratio'] = replay_df['energy'] / df['energy'].mean() # use mean from original df
    
    replay_df.to_csv(output_path, index=False)
    print(f"Replay dataset generated at {output_path} with {len(replay_df)} records.")

if __name__ == "__main__":
    df = generate_historical_dataset()
    generate_anomalous_dataset(df)
