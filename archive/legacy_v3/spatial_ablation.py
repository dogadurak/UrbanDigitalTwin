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
    'host': os.getenv('POSTGRES_HOST', 'postgis'),
    'port': os.getenv('POSTGRES_PORT', '5432')
}

def load_data():
    """Load the multi-building pilot dataset (BDG2 Rat site, 4 buildings)."""
    print("Loading pilot data...")
    train = pd.read_csv("data/pilot/train.csv", parse_dates=['timestamp'])
    test = pd.read_csv("data/pilot/test.csv", parse_dates=['timestamp'])
    return train, test

def fetch_spatial_features():
    """Fetch the enriched spatial features from PostGIS (11 columns)."""
    print("Fetching spatial features from PostGIS...")
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    query = """
        SELECT building_id, lat, lon,
               ndvi_current, ndmi_current, ndbi_current,
               building_density, road_density, green_ratio,
               elevation, slope
        FROM spatial_features;
    """
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    
    if not rows:
        raise ValueError("No spatial features found in PostGIS!")
        
    spatial_df = pd.DataFrame(rows)
    print(f"  Found {len(spatial_df)} buildings with {len(spatial_df.columns)} spatial columns.")
    return spatial_df

def merge_spatial(temporal_df, spatial_df):
    """Join temporal energy data with static spatial features via building_id."""
    merged = pd.merge(temporal_df, spatial_df, on='building_id', how='left')
    merged = merged.dropna()
    return merged

def evaluate_model(X_train, y_train, X_test, y_test, features, name):
    """Train XGBoost and evaluate on test set."""
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
    
    print(f"  {name}")
    print(f"    Features: {len(features)} | MAE: {mae:.2f} | RMSE: {rmse:.2f} | R²: {r2:.4f}")
    return {"MAE": float(mae), "RMSE": float(rmse), "R2": float(r2), "n_features": len(features)}

def run_ablation():
    train, test = load_data()
    spatial_df = fetch_spatial_features()
    
    train_joined = merge_spatial(train, spatial_df)
    test_joined = merge_spatial(test, spatial_df)
    
    print(f"\nTrain samples: {len(train_joined)} | Test samples: {len(test_joined)}")
    
    # Base temporal + weather features (available in pilot data)
    base_features = [
        'hour', 'day_of_week', 'month', 'is_weekend',
        'outdoor_temperature', 'dewTemperature', 'windSpeed'
    ]
    
    # Spatial feature groups
    spatial_sentinel = ['ndvi_current', 'ndmi_current', 'ndbi_current']
    spatial_osm = ['building_density', 'road_density', 'green_ratio']
    spatial_dem = ['elevation', 'slope']
    spatial_location = ['lat', 'lon']
    
    y_train = train_joined['energy']
    y_test = test_joined['energy']
    
    results = {}
    
    print("\n" + "=" * 60)
    print("SPATIAL ABLATION STUDY")
    print("=" * 60)
    
    # 1. Baseline (no spatial)
    print("\n--- Group 1: Baseline ---")
    results['V2_Baseline'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features, 'V2 Baseline (Temporal + Weather)')
    
    # 2. + Sentinel indices only
    print("\n--- Group 2: + Sentinel (NDVI, NDMI, NDBI) ---")
    results['V3_Sentinel'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features + spatial_sentinel, '+Sentinel')
    
    # 3. + OSM features only
    print("\n--- Group 3: + OSM (Density, Roads, Green) ---")
    results['V3_OSM'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features + spatial_osm, '+OSM')
    
    # 4. + DEM features only
    print("\n--- Group 4: + DEM (Elevation, Slope) ---")
    results['V3_DEM'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features + spatial_dem, '+DEM')
    
    # 5. + Location (lat/lon)
    print("\n--- Group 5: + Location (Lat, Lon) ---")
    results['V3_Location'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features + spatial_location, '+Location')
    
    # 6. Sentinel + OSM
    print("\n--- Group 6: + Sentinel + OSM ---")
    results['V3_Sentinel_OSM'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features + spatial_sentinel + spatial_osm, '+Sentinel+OSM')
    
    # 7. Full Spatial (all)
    print("\n--- Group 7: Full Spatial (All Features) ---")
    all_spatial = spatial_sentinel + spatial_osm + spatial_dem + spatial_location
    results['V3_Full_Spatial'] = evaluate_model(
        train_joined, y_train, test_joined, y_test,
        base_features + all_spatial, 'V3 Full Spatial')
    
    # --- Summary Table ---
    print("\n" + "=" * 60)
    print("ABLATION SUMMARY")
    print("=" * 60)
    print(f"{'Model':<25} {'MAE':>8} {'RMSE':>8} {'R²':>8} {'Δ MAE':>8}")
    print("-" * 60)
    baseline_mae = results['V2_Baseline']['MAE']
    for name, metrics in results.items():
        delta = baseline_mae - metrics['MAE']
        delta_str = f"{delta:+.2f}" if name != 'V2_Baseline' else "—"
        print(f"{name:<25} {metrics['MAE']:>8.2f} {metrics['RMSE']:>8.2f} {metrics['R2']:>8.4f} {delta_str:>8}")
    
    # Save
    with open("ablation_results.json", "w") as f:
        json.dump(results, f, indent=2)
        
    print("\nAblation study complete. Results saved to ablation_results.json")

if __name__ == "__main__":
    run_ablation()
