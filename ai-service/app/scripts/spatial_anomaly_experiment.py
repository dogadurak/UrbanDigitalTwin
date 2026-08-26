import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, precision_score, recall_score, f1_score, confusion_matrix
from sklearn.ensemble import IsolationForest
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os

# Database connection parameters (Docker internal network)
DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': os.getenv('POSTGRES_HOST', 'postgis'),
    'port': os.getenv('POSTGRES_PORT', '5432')
}

def load_data():
    print("Loading temporal data...")
    train_df = pd.read_csv("data/pilot/train.csv", parse_dates=['timestamp'])
    test_df = pd.read_csv("data/pilot/test.csv", parse_dates=['timestamp'])
    return train_df, test_df

def fetch_spatial_features():
    print("Fetching spatial features from PostGIS...")
    conn = psycopg2.connect(**DB_PARAMS)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    query = """
        SELECT building_id, lat, lon, building_density, ndvi_current,
               ndmi_current, ndbi_current, road_density, green_ratio,
               elevation, slope
        FROM spatial_features;
    """
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    return pd.DataFrame(rows)

def merge_spatial(temporal_df, spatial_df):
    return pd.merge(temporal_df, spatial_df, on='building_id', how='left')

def inject_contextual_anomalies(df):
    """
    Anomaly Scenario: Subtle overconsumption during cool/green periods.
    
    Key improvement: anomaly magnitude is scaled to each building's
    natural energy variance (2.5 * std_dev) instead of a fixed +10 kWh.
    This ensures anomalies are detectable but not trivially obvious.
    """
    print("Injecting Contextual Anomalies (dynamic magnitude)...")
    df['is_anomaly'] = 0
    np.random.seed(42)
    
    # Condition: Temperature < 15C (cool periods where energy should be predictable)
    condition = (df['outdoor_temperature'] < 15)
    potential_anomalies = df[condition].index
    
    if len(potential_anomalies) == 0:
        potential_anomalies = df.nsmallest(50, 'outdoor_temperature').index
        
    # Select 5% of cool-period data points
    n_selected = max(1, int(len(potential_anomalies) * 0.05))
    selected_anomalies = np.random.choice(potential_anomalies, size=n_selected, replace=False)
    
    df_injected = df.copy()
    
    # Dynamic magnitude: 2.5 * per-building standard deviation
    for building_id in df_injected['building_id'].unique():
        building_mask = df_injected.index.isin(selected_anomalies) & (df_injected['building_id'] == building_id)
        if building_mask.sum() > 0:
            building_std = df_injected.loc[df_injected['building_id'] == building_id, 'energy'].std()
            injection_magnitude = 2.5 * building_std
            df_injected.loc[building_mask, 'energy'] += injection_magnitude
            print(f"  {building_id}: injected {building_mask.sum()} anomalies (+{injection_magnitude:.1f} kWh, std={building_std:.1f})")
    
    df_injected.loc[selected_anomalies, 'is_anomaly'] = 1
    
    print(f"Total injected: {len(selected_anomalies)} contextual anomalies.")
    return df_injected

def run_experiment_b():
    # 1. Load and Join Data
    train_df, test_df = load_data()
    spatial_df = fetch_spatial_features()
    
    train_df = merge_spatial(train_df, spatial_df)
    test_df = merge_spatial(test_df, spatial_df)
    
    # 2. Drop NaNs
    train_df = train_df.dropna()
    test_df = test_df.dropna()
    
    # 3. Inject Anomalies strictly in the test set
    test_df_anom = inject_contextual_anomalies(test_df)
    
    # 4. Define Features
    base_features = [
        'hour', 'day_of_week', 'month', 'is_weekend',
        'outdoor_temperature', 'dewTemperature', 'windSpeed'
    ]
    spatial_features = [
        'lat', 'lon', 'building_density', 'ndvi_current',
        'ndmi_current', 'ndbi_current', 'road_density', 'green_ratio',
        'elevation', 'slope'
    ]
    full_features = base_features + spatial_features
    
    # --- MODEL 1: BASELINE (V2) ---
    print("\n--- Training Baseline Model (V2) ---")
    dtrain_base = xgb.DMatrix(train_df[base_features], label=train_df['energy'])
    dtest_base = xgb.DMatrix(test_df_anom[base_features])
    
    model_base = xgb.train({'objective': 'reg:squarederror', 'seed': 42}, dtrain_base, num_boost_round=100)
    preds_base = model_base.predict(dtest_base)
    residuals_base = np.abs(test_df_anom['energy'].values - preds_base)
    
    # --- MODEL 2: SPATIAL (V3) ---
    print("\n--- Training Spatial Model (V3) ---")
    dtrain_spatial = xgb.DMatrix(train_df[full_features], label=train_df['energy'])
    dtest_spatial = xgb.DMatrix(test_df_anom[full_features])
    
    model_spatial = xgb.train({'objective': 'reg:squarederror', 'seed': 42}, dtrain_spatial, num_boost_round=100)
    preds_spatial = model_spatial.predict(dtest_spatial)
    residuals_spatial = np.abs(test_df_anom['energy'].values - preds_spatial)
    
    y_true = test_df_anom['is_anomaly'].values
    
    # =====================================================================
    # METHOD 1: Residual Threshold (99th percentile from training set)
    # =====================================================================
    print("\n--- Method 1: Residual Threshold (99th Percentile) ---")
    
    # Baseline threshold
    train_preds_base = model_base.predict(xgb.DMatrix(train_df[base_features]))
    train_residuals_base = np.abs(train_df['energy'].values - train_preds_base)
    threshold_base = np.percentile(train_residuals_base, 99)
    preds_thresh_base = (residuals_base > threshold_base).astype(int)
    
    # Spatial threshold
    train_preds_spatial = model_spatial.predict(xgb.DMatrix(train_df[full_features]))
    train_residuals_spatial = np.abs(train_df['energy'].values - train_preds_spatial)
    threshold_spatial = np.percentile(train_residuals_spatial, 99)
    preds_thresh_spatial = (residuals_spatial > threshold_spatial).astype(int)
    
    # =====================================================================
    # METHOD 2: Isolation Forest on Residuals + Context
    # =====================================================================
    print("\n--- Method 2: Isolation Forest on Residuals + Context ---")
    
    n_anomalies = int(y_true.sum())
    contamination = max(n_anomalies / len(test_df_anom), 0.005)
    
    # Baseline IF
    X_if_base = np.column_stack([
        residuals_base, 
        test_df_anom['outdoor_temperature'].values,
        test_df_anom['hour'].values
    ])
    iso_base = IsolationForest(contamination=contamination, random_state=42, n_estimators=200)
    preds_anom_base = iso_base.fit_predict(X_if_base)
    preds_anom_base = np.where(preds_anom_base == -1, 1, 0)
    
    # Spatial IF: residual + full spatial context
    X_if_spatial = np.column_stack([
        residuals_spatial, 
        test_df_anom['outdoor_temperature'].values,
        test_df_anom['hour'].values,
        test_df_anom['ndvi_current'].values,
        test_df_anom['ndbi_current'].values,
        test_df_anom['building_density'].values,
        test_df_anom['elevation'].values
    ])
    iso_spatial = IsolationForest(contamination=contamination, random_state=42, n_estimators=200)
    preds_anom_spatial = iso_spatial.fit_predict(X_if_spatial)
    preds_anom_spatial = np.where(preds_anom_spatial == -1, 1, 0)
    
    # --- EVALUATE ALL METHODS ---
    def evaluate(y_true, y_pred, name):
        prec = precision_score(y_true, y_pred, zero_division=0)
        rec = recall_score(y_true, y_pred, zero_division=0)
        f1 = f1_score(y_true, y_pred, zero_division=0)
        cm = confusion_matrix(y_true, y_pred)
        tn, fp, fn, tp = cm.ravel() if cm.shape == (2, 2) else (0, 0, 0, 0)
        print(f"[{name}]")
        print(f"  Precision: {prec:.3f} | Recall: {rec:.3f} | F1: {f1:.3f}")
        print(f"  TP: {tp} | FP: {fp} | FN: {fn} | TN: {tn}")
        return {"Precision": float(prec), "Recall": float(rec), "F1": float(f1), "TP": int(tp), "FP": int(fp)}
    
    print("\n" + "=" * 60)
    print("EXPERIMENT B — FULL RESULTS")
    print("=" * 60)
    
    # Prediction quality
    anom_mask = y_true == 1
    norm_mask = y_true == 0
    
    print(f"\nPrediction Quality (Mean Absolute Residual):")
    print(f"  Baseline — Normal: {np.mean(residuals_base[norm_mask]):.1f} | Anomaly: {np.mean(residuals_base[anom_mask]):.1f}")
    print(f"  Spatial  — Normal: {np.mean(residuals_spatial[norm_mask]):.1f} | Anomaly: {np.mean(residuals_spatial[anom_mask]):.1f}")
    print(f"  Baseline Threshold (99th pctl): {threshold_base:.1f}")
    print(f"  Spatial  Threshold (99th pctl): {threshold_spatial:.1f}")
    
    print(f"\n--- Threshold Method ---")
    res_thresh_base = evaluate(y_true, preds_thresh_base, "Baseline + Threshold")
    res_thresh_spatial = evaluate(y_true, preds_thresh_spatial, "Spatial + Threshold")
    
    print(f"\n--- Isolation Forest Method ---")
    res_if_base = evaluate(y_true, preds_anom_base, "Baseline + IsolationForest")
    res_if_spatial = evaluate(y_true, preds_anom_spatial, "Spatial + IsolationForest")

    # --- SAVE RESULTS ---
    results_output = {
        "anomaly_injection": {
            "method": "dynamic (2.5 * per-building std_dev)",
            "total_injected": int(n_anomalies),
            "total_test_samples": len(test_df_anom)
        },
        "threshold_method": {
            "baseline": res_thresh_base,
            "spatial": res_thresh_spatial,
            "baseline_threshold": float(threshold_base),
            "spatial_threshold": float(threshold_spatial)
        },
        "isolation_forest_method": {
            "baseline": res_if_base,
            "spatial": res_if_spatial
        }
    }
    
    os.makedirs("app/models/saved", exist_ok=True)
    with open("experiment_b_results.json", "w") as f:
        json.dump(results_output, f, indent=2)
        
    model_spatial.save_model("app/models/saved/xgboost_spatial_v3.json")
    import joblib
    joblib.dump(iso_spatial, "app/models/saved/isolation_forest_spatial_v3.joblib")
    
    meta = {
        "features": full_features,
        "spatial_features": spatial_features,
        "base_features": base_features
    }
    with open("app/models/saved/metadata_spatial_v3.json", "w") as f:
        json.dump(meta, f, indent=2)
        
    print("\nExperiment B complete. Results saved.")

if __name__ == "__main__":
    run_experiment_b()
