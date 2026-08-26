import pandas as pd
import numpy as np
import xgboost as xgb
import joblib
import os
import json
import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from sklearn.metrics import mean_absolute_error, mean_squared_error, mean_absolute_percentage_error, r2_score

DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': os.getenv('POSTGRES_HOST', 'postgis'),
    'port': os.getenv('POSTGRES_PORT', '5432')
}

def root_mean_squared_error(y_true, y_pred):
    return np.sqrt(mean_squared_error(y_true, y_pred))

def fetch_spatial_features():
    """Fetch enriched spatial features from PostGIS."""
    print("Fetching spatial features from PostGIS...")
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT building_id, lat, lon, building_density, ndvi_current,
               ndmi_current, ndbi_current, road_density, green_ratio,
               elevation, slope
        FROM spatial_features;
    """)
    rows = cur.fetchall()
    conn.close()
    return pd.DataFrame(rows)

def engineer_features(df_train_raw, df_test_raw):
    print("Engineering autoregressive features...")
    df_full = pd.concat([df_train_raw, df_test_raw])
    df_full['timestamp'] = pd.to_datetime(df_full['timestamp'])
    df_full = df_full.sort_values(['building_id', 'timestamp'])
    
    target = 'meter_reading'
    
    # Lag features (per building to avoid cross-building leakage)
    df_full['energy_lag_1'] = df_full.groupby('building_id')[target].shift(1)
    df_full['energy_lag_24'] = df_full.groupby('building_id')[target].shift(24)
    df_full['energy_lag_168'] = df_full.groupby('building_id')[target].shift(168)
    
    # Rolling features (shifted by 1 to prevent target leakage)
    df_full['energy_rolling_mean_24'] = df_full.groupby('building_id')[target].transform(
        lambda x: x.shift(1).rolling(window=24).mean()
    )
    df_full['energy_rolling_mean_168'] = df_full.groupby('building_id')[target].transform(
        lambda x: x.shift(1).rolling(window=168).mean()
    )
    
    df_full = df_full.dropna()
    
    # Split back by year
    df_train = df_full[df_full['timestamp'].dt.year == 2016].copy()
    df_test = df_full[df_full['timestamp'].dt.year >= 2017].copy()
    
    return df_train, df_test

def train_and_evaluate(df_train, df_test, spatial_df, model_dir="app/models/saved"):
    target = 'meter_reading'
    
    # ---- V2 Features (Temporal + Weather + Autoregressive) ----
    features_v2 = [
        'outdoor_temperature', 'cloudCoverage', 'dewTemperature',
        'hour', 'day_of_week', 'month', 'is_weekend',
        'windSpeed',
        'energy_lag_1', 'energy_lag_24', 'energy_lag_168',
        'energy_rolling_mean_24', 'energy_rolling_mean_168'
    ]
    
    # ---- V3 Features (V2 + Spatial from PostGIS) ----
    spatial_feature_names = [
        'lat', 'lon', 'building_density', 'ndvi_current',
        'ndmi_current', 'ndbi_current', 'road_density', 'green_ratio',
        'elevation', 'slope'
    ]
    features_v3 = features_v2 + spatial_feature_names
    
    # Merge spatial features for V3
    df_train_v3 = pd.merge(df_train, spatial_df, on='building_id', how='left').dropna()
    df_test_v3 = pd.merge(df_test, spatial_df, on='building_id', how='left').dropna()
    
    y_test = df_test[target]
    y_test_v3 = df_test_v3[target]
    
    # ================================================================
    # BASELINE: Seasonal Naive
    # ================================================================
    print("Evaluating Seasonal Naive Baseline...")
    baseline_group = df_train.groupby(['building_id', 'day_of_week', 'hour'])[target].mean().reset_index()
    baseline_group.rename(columns={target: 'baseline_pred'}, inplace=True)
    
    df_test_baseline = df_test.merge(baseline_group, on=['building_id', 'day_of_week', 'hour'], how='left')
    df_test_baseline['baseline_pred'] = df_test_baseline['baseline_pred'].fillna(df_train[target].mean())
    y_test_baseline = df_test_baseline['baseline_pred']
    
    base_mae = mean_absolute_error(y_test, y_test_baseline)
    base_rmse = root_mean_squared_error(y_test, y_test_baseline)
    base_r2 = r2_score(y_test, y_test_baseline)
    
    # ================================================================
    # V2: XGBoost (Temporal + Weather + Autoregressive)
    # ================================================================
    print("Training XGBoost V2 (Temporal + Weather + Autoregressive)...")
    # Fill NaN in cloudCoverage (common in BDG2)
    for col in ['cloudCoverage']:
        df_train[col] = df_train[col].fillna(df_train[col].median())
        df_test[col] = df_test[col].fillna(df_test[col].median())
    
    xgb_v2 = xgb.XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=6, random_state=42)
    xgb_v2.fit(df_train[features_v2], df_train[target])
    y_pred_v2 = xgb_v2.predict(df_test[features_v2])
    
    v2_mae = mean_absolute_error(y_test, y_pred_v2)
    v2_rmse = root_mean_squared_error(y_test, y_pred_v2)
    v2_r2 = r2_score(y_test, y_pred_v2)
    
    # ================================================================
    # V3: XGBoost (V2 + Spatial Features from PostGIS)
    # ================================================================
    print("Training XGBoost V3 (V2 + Spatial)...")
    # Fill NaN in cloudCoverage for V3 datasets too
    for col in ['cloudCoverage']:
        df_train_v3[col] = df_train_v3[col].fillna(df_train_v3[col].median())
        df_test_v3[col] = df_test_v3[col].fillna(df_test_v3[col].median())
    
    xgb_v3 = xgb.XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=6, random_state=42)
    xgb_v3.fit(df_train_v3[features_v3], df_train_v3[target])
    y_pred_v3 = xgb_v3.predict(df_test_v3[features_v3])
    
    v3_mae = mean_absolute_error(y_test_v3, y_pred_v3)
    v3_rmse = root_mean_squared_error(y_test_v3, y_pred_v3)
    v3_r2 = r2_score(y_test_v3, y_pred_v3)
    
    # ================================================================
    # Threshold & Alerts (V3)
    # ================================================================
    y_pred_train_v3 = xgb_v3.predict(df_train_v3[features_v3])
    train_residuals = np.abs(df_train_v3[target] - y_pred_train_v3)
    residual_threshold = float(np.percentile(train_residuals, 99))
    
    test_residuals = np.abs(y_test_v3 - y_pred_v3)
    anomalies_detected = int(np.sum(test_residuals > residual_threshold))
    test_alert_rate = float(anomalies_detected / len(test_residuals))
    
    # ================================================================
    # Feature Importance (V3)
    # ================================================================
    importance_v3 = xgb_v3.feature_importances_
    feature_importance_dict = {
        features_v3[i]: float(importance_v3[i]) for i in range(len(features_v3))
    }
    feature_importance_dict = dict(sorted(feature_importance_dict.items(), key=lambda item: item[1], reverse=True))
    
    os.makedirs(model_dir, exist_ok=True)
    with open(os.path.join(model_dir, "feature_importance_v3.json"), "w") as f:
        json.dump(feature_importance_dict, f, indent=2)
    
    # ================================================================
    # Metrics Output
    # ================================================================
    metrics_data = {
        "dataset": "BDG2 Pilot Data (4 Rat Office Buildings)",
        "train_period": "2016",
        "test_period": "2017+",
        "train_samples": len(df_train_v3),
        "test_samples": len(df_test_v3),
        "baseline": {
            "model": "Seasonal Naive (Building/Day/Hour)",
            "MAE": float(base_mae),
            "RMSE": float(base_rmse),
            "R2": float(base_r2)
        },
        "xgboost_v2": {
            "model": "XGBoost-V2 (Autoregressive, No Spatial)",
            "MAE": float(v2_mae),
            "RMSE": float(v2_rmse),
            "R2": float(v2_r2),
            "features": features_v2
        },
        "xgboost_v3": {
            "model": "XGBoost-V3 (Autoregressive + Spatial)",
            "MAE": float(v3_mae),
            "RMSE": float(v3_rmse),
            "R2": float(v3_r2),
            "features": features_v3,
            "spatial_features": spatial_feature_names
        },
        "improvement_v3_vs_baseline": float(base_mae - v3_mae),
        "improvement_v3_vs_v2": float(v2_mae - v3_mae),
        "threshold": {
            "calculated_on": "V3 Train Set (99th percentile)",
            "value": residual_threshold
        },
        "test_alert_stats": {
            "total_test_samples": len(test_residuals),
            "alerts_triggered": anomalies_detected,
            "test_alert_rate": test_alert_rate,
            "mean_test_residual": float(np.mean(test_residuals)),
            "max_test_residual": float(np.max(test_residuals))
        }
    }
    
    # Save models
    joblib.dump(xgb_v2, os.path.join(model_dir, "xgboost_residual_v2.joblib"))
    joblib.dump(xgb_v3, os.path.join(model_dir, "xgboost_spatial_v3_final.joblib"))
    
    with open(os.path.join(model_dir, "model_metrics_v3.json"), "w") as f:
        json.dump(metrics_data, f, indent=2)
        
    print("\n" + "=" * 60)
    print("MODEL TRAINING RESULTS")
    print("=" * 60)
    print(f"{'Model':<35} {'MAE':>8} {'RMSE':>8} {'R²':>8}")
    print("-" * 60)
    print(f"{'Seasonal Naive Baseline':<35} {base_mae:>8.2f} {base_rmse:>8.2f} {base_r2:>8.4f}")
    print(f"{'XGBoost V2 (No Spatial)':<35} {v2_mae:>8.2f} {v2_rmse:>8.2f} {v2_r2:>8.4f}")
    print(f"{'XGBoost V3 (+ Spatial)':<35} {v3_mae:>8.2f} {v3_rmse:>8.2f} {v3_r2:>8.4f}")
    print(f"\nV3 vs V2 MAE improvement: {v2_mae - v3_mae:+.2f}")
    print(f"V3 vs Baseline MAE improvement: {base_mae - v3_mae:+.2f}")
    print(f"V3 Anomaly Threshold (99th pctl): {residual_threshold:.2f}")
    print(f"V3 Test Alert Rate: {test_alert_rate:.2%}")
    
    return xgb_v3

if __name__ == "__main__":
    train_path = "data/pilot/train.csv"
    test_path = "data/pilot/test.csv"
    if not os.path.exists(train_path) or not os.path.exists(test_path):
        print("Error: Train/Test data not found. Run prepare_pilot_data.py first.")
        exit(1)
        
    df_train_raw = pd.read_csv(train_path)
    df_test_raw = pd.read_csv(test_path)
    
    spatial_df = fetch_spatial_features()
    
    df_train, df_test = engineer_features(df_train_raw, df_test_raw)
    train_and_evaluate(df_train, df_test, spatial_df)
