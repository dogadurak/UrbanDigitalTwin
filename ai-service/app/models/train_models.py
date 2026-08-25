import pandas as pd
import numpy as np
import xgboost as xgb
import joblib
import os
import json
import datetime
from sklearn.metrics import mean_absolute_error, root_mean_squared_error, mean_absolute_percentage_error, r2_score

def engineer_features(df_train_raw, df_test_raw):
    print("Engineering autoregressive features...")
    df_full = pd.concat([df_train_raw, df_test_raw])
    df_full['timestamp'] = pd.to_datetime(df_full['timestamp'])
    df_full = df_full.sort_values('timestamp')
    
    # Target
    target = 'meter_reading'
    
    # Lag features
    df_full['energy_lag_1'] = df_full[target].shift(1)
    df_full['energy_lag_24'] = df_full[target].shift(24)
    df_full['energy_lag_168'] = df_full[target].shift(168)
    
    # Rolling features (shifted by 1 to prevent target leakage!)
    df_full['energy_rolling_mean_24'] = df_full[target].shift(1).rolling(window=24).mean()
    df_full['energy_rolling_mean_168'] = df_full[target].shift(1).rolling(window=168).mean()
    
    df_full = df_full.dropna()
    
    # Split back
    df_train = df_full[df_full['timestamp'].dt.year == 2016].copy()
    df_test = df_full[df_full['timestamp'].dt.year >= 2017].copy()
    
    return df_train, df_test

def train_and_evaluate(df_train, df_test, model_dir="app/models/saved"):
    target = 'meter_reading'
    
    # V1 Features
    features_v1 = [
        'airTemperature', 'cloudCoverage', 'dewTemperature', 
        'hour', 'day_of_week', 'month', 'is_weekend', 
        'building_sqm', 'ndvi'
    ]
    
    # V2 Features
    features_v2 = features_v1 + [
        'energy_lag_1', 'energy_lag_24', 'energy_lag_168',
        'energy_rolling_mean_24', 'energy_rolling_mean_168'
    ]
    
    print("Evaluating Seasonal Naive Baseline...")
    # Baseline Model: Seasonal Naive (mean of train set by hour and day)
    baseline_group = df_train.groupby(['day_of_week', 'hour'])[target].mean().reset_index()
    baseline_group.rename(columns={target: 'baseline_pred'}, inplace=True)
    
    df_test_baseline = df_test.merge(baseline_group, on=['day_of_week', 'hour'], how='left')
    df_test_baseline['baseline_pred'] = df_test_baseline['baseline_pred'].fillna(df_train[target].mean())
    y_test_baseline = df_test_baseline['baseline_pred']
    
    y_test = df_test[target]
    
    base_mae = mean_absolute_error(y_test, y_test_baseline)
    base_rmse = root_mean_squared_error(y_test, y_test_baseline)
    base_mape = mean_absolute_percentage_error(y_test, y_test_baseline)
    base_r2 = r2_score(y_test, y_test_baseline)
    
    print("Training XGBoost V1 (Temporal + Weather + Static)...")
    xgb_v1 = xgb.XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=6, random_state=42)
    xgb_v1.fit(df_train[features_v1], df_train[target])
    y_pred_v1 = xgb_v1.predict(df_test[features_v1])
    
    v1_mae = mean_absolute_error(y_test, y_pred_v1)
    v1_rmse = root_mean_squared_error(y_test, y_pred_v1)
    v1_mape = mean_absolute_percentage_error(y_test, y_pred_v1)
    v1_r2 = r2_score(y_test, y_pred_v1)
    
    print("Training XGBoost V2 (V1 + Autoregressive)...")
    xgb_v2 = xgb.XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=6, random_state=42)
    xgb_v2.fit(df_train[features_v2], df_train[target])
    y_pred_v2 = xgb_v2.predict(df_test[features_v2])
    
    v2_mae = mean_absolute_error(y_test, y_pred_v2)
    v2_rmse = root_mean_squared_error(y_test, y_pred_v2)
    v2_mape = mean_absolute_percentage_error(y_test, y_pred_v2)
    v2_r2 = r2_score(y_test, y_pred_v2)
    
    # -----------------------------------------------------------------
    # Threshold & Alerts (V2)
    # -----------------------------------------------------------------
    y_pred_train_v2 = xgb_v2.predict(df_train[features_v2])
    train_residuals = np.abs(df_train[target] - y_pred_train_v2)
    residual_threshold = float(np.percentile(train_residuals, 99))
    
    test_residuals = np.abs(y_test - y_pred_v2)
    anomalies_detected = int(np.sum(test_residuals > residual_threshold))
    test_alert_rate = float(anomalies_detected / len(test_residuals))
    
    # -----------------------------------------------------------------
    # Feature Importance (V2)
    # -----------------------------------------------------------------
    importance = xgb_v2.feature_importances_
    feature_importance_dict = {
        features_v2[i]: float(importance[i]) for i in range(len(features_v2))
    }
    feature_importance_dict = dict(sorted(feature_importance_dict.items(), key=lambda item: item[1], reverse=True))
    
    os.makedirs(model_dir, exist_ok=True)
    with open(os.path.join(model_dir, "feature_importance_v2.json"), "w") as f:
        json.dump(feature_importance_dict, f, indent=2)
        
    # -----------------------------------------------------------------
    # Metrics Output
    # -----------------------------------------------------------------
    metrics_data = {
        "dataset": "BDG2 Pilot Data (Rat_office_Adele)",
        "train_period": "2016",
        "test_period": "2017+",
        "baseline": {
            "model": "Seasonal Naive (Day/Hour)",
            "MAE": float(base_mae),
            "RMSE": float(base_rmse),
            "MAPE": float(base_mape),
            "R2": float(base_r2)
        },
        "xgboost_v1": {
            "model": "XGBoost-V1 (No Lags)",
            "MAE": float(v1_mae),
            "RMSE": float(v1_rmse),
            "MAPE": float(v1_mape),
            "R2": float(v1_r2)
        },
        "xgboost_v2": {
            "model": "XGBoost-V2 (Autoregressive)",
            "MAE": float(v2_mae),
            "RMSE": float(v2_rmse),
            "MAPE": float(v2_mape),
            "R2": float(v2_r2)
        },
        "improvement_v2_vs_baseline": float(base_mae - v2_mae),
        "improvement_v2_vs_v1": float(v1_mae - v2_mae),
        "threshold": {
            "calculated_on": "Train Set (99th percentile)",
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
    
    joblib.dump(xgb_v2, os.path.join(model_dir, "xgboost_residual_v2.joblib"))
    
    with open(os.path.join(model_dir, "model_metrics_v2.json"), "w") as f:
        json.dump(metrics_data, f, indent=2)
        
    print("\n--- RESULTS ---")
    print(f"Baseline MAE:   {base_mae:.2f}")
    print(f"XGBoost V1 MAE: {v1_mae:.2f}")
    print(f"XGBoost V2 MAE: {v2_mae:.2f}")
    print(f"V2 vs Baseline: {'+' if base_mae > v2_mae else '-'}{abs(base_mae - v2_mae):.2f} MAE")
    print(f"Test Alert Rate (V2): {test_alert_rate:.2%}")
    
    return xgb_v2

if __name__ == "__main__":
    train_path = "data/pilot/train.csv"
    test_path = "data/pilot/test.csv"
    if not os.path.exists(train_path) or not os.path.exists(test_path):
        print("Error: Train/Test data not found.")
        exit(1)
        
    df_train_raw = pd.read_csv(train_path)
    df_test_raw = pd.read_csv(test_path)
    
    df_train, df_test = engineer_features(df_train_raw, df_test_raw)
    train_and_evaluate(df_train, df_test)
