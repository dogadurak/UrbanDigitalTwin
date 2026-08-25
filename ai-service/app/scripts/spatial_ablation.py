import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import json
import warnings
warnings.filterwarnings('ignore')

DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': 'localhost',
    'port': '5433'
}

def load_data():
    print("Loading temporal data...")
    df = pd.read_csv("ai-service/data/training/historical_data.csv", parse_dates=['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # 80/20 train/test split
    split_idx = int(len(df) * 0.8)
    train = df.iloc[:split_idx].copy()
    test = df.iloc[split_idx:].copy()
    return train, test

def fetch_spatial_features(building_id="IYTE_ARCH_001"):
    print("Fetching spatial features from PostGIS...")
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    query = """
        SELECT observation_time as timestamp, 
               ndvi_current, ndmi_current, ndbi_current,
               building_density, road_density, green_ratio,
               elevation, slope
        FROM spatial_features
        WHERE building_id = %s AND buffer_radius_m = 50
        ORDER BY observation_time ASC;
    """
    cur.execute(query, (building_id,))
    rows = cur.fetchall()
    conn.close()
    
    if not rows:
        raise ValueError("No spatial features found!")
        
    spatial_df = pd.DataFrame(rows)
    spatial_df['timestamp'] = pd.to_datetime(spatial_df['timestamp']).dt.tz_localize(None)
    spatial_df = spatial_df.sort_values('timestamp')
    return spatial_df

def temporal_join(energy_df, spatial_df):
    merged = pd.merge_asof(
        energy_df, 
        spatial_df, 
        on='timestamp', 
        direction='backward'
    )
    merged = merged.bfill()
    return merged

def evaluate_model(X_train, y_train, X_test, y_test, features, name):
    dtrain = xgb.DMatrix(X_train[features], label=y_train)
    dtest = xgb.DMatrix(X_test[features], label=y_test)
    
    params = {
        'objective': 'reg:squarederror',
        'learning_rate': 0.05,
        'max_depth': 6,
        'min_child_weight': 3,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'seed': 42
    }
    
    model = xgb.train(params, dtrain, num_boost_round=100)
    preds = model.predict(dtest)
    
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    r2 = r2_score(y_test, preds)
    
    print(f"--- {name} ---")
    print(f"Features: {len(features)}")
    print(f"MAE: {mae:.2f} | RMSE: {rmse:.2f} | R2: {r2:.3f}")
    return {"MAE": float(mae), "RMSE": float(rmse), "R2": float(r2)}

def run_ablation():
    train, test = load_data()
    spatial_df = fetch_spatial_features()
    
    train_joined = temporal_join(train, spatial_df)
    test_joined = temporal_join(test, spatial_df)
    
    actual_base_features = [
        'hour', 'day_of_week', 'outdoor_temperature', 'humidity',
        'rolling_mean', 'rolling_std', 'historical_energy'
    ]
    
    y_train = train_joined['energy']
    y_test = test_joined['energy']
    
    spatial_sentinel = ['ndvi_current', 'ndmi_current', 'ndbi_current']
    spatial_osm = ['building_density', 'road_density', 'green_ratio']
    spatial_dem = ['elevation', 'slope']
    
    results = {}
    
    results['XGBoost V2 (Baseline)'] = evaluate_model(train_joined, y_train, test_joined, y_test, actual_base_features, 'XGBoost V2 (Baseline)')
    results['V3-Sentinel'] = evaluate_model(train_joined, y_train, test_joined, y_test, actual_base_features + spatial_sentinel, 'V3-Sentinel')
    results['V3-OSM'] = evaluate_model(train_joined, y_train, test_joined, y_test, actual_base_features + spatial_osm, 'V3-OSM')
    results['V3-DEM'] = evaluate_model(train_joined, y_train, test_joined, y_test, actual_base_features + spatial_dem, 'V3-DEM')
    results['V3-Sentinel+OSM'] = evaluate_model(train_joined, y_train, test_joined, y_test, actual_base_features + spatial_sentinel + spatial_osm, 'V3-Sentinel+OSM')
    results['V3-Full Spatial'] = evaluate_model(train_joined, y_train, test_joined, y_test, actual_base_features + spatial_sentinel + spatial_osm + spatial_dem, 'V3-Full Spatial')
    
    with open("ablation_results.json", "w") as f:
        json.dump(results, f, indent=2)
        
    print("\nStudy complete. Results saved to ablation_results.json")

if __name__ == "__main__":
    run_ablation()
