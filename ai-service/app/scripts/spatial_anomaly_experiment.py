import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, precision_score, recall_score, f1_score, confusion_matrix
from sklearn.ensemble import IsolationForest
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os

# Database connection parameters
DB_PARAMS = {
    'dbname': 'geotwin_db',
    'user': 'geotwin_user',
    'password': 'geotwin_password',
    'host': 'localhost',
    'port': '5433'
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
        SELECT building_id, lat, lon, building_density, ndvi_current
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
    Conditions: Low outdoor temperature AND High NDVI.
    Normally, energy should be very low and predictable. We artificially INCREASE it by 2.5 kWh.
    The Baseline model (with higher MAE) will think this is normal noise.
    The Spatial model (with lower MAE) will flag it as an anomaly.
    Since we are using real data across multiple buildings, we'll inject
    this pattern into a random 5% of the points where outdoor temperature is low.
    """
    print("Injecting Contextual Anomalies...")
    df['is_anomaly'] = 0
    np.random.seed(42)
    
    # Condition: Temperature < 15C
    condition = (df['outdoor_temperature'] < 15)
    potential_anomalies = df[condition].index
    
    if len(potential_anomalies) == 0:
        potential_anomalies = df.nsmallest(50, 'outdoor_temperature').index
        
    selected_anomalies = np.random.choice(potential_anomalies, size=max(1, int(len(potential_anomalies)*0.05)), replace=False)
    
    df_injected = df.copy()
    
    # Increase energy consumption slightly to simulate anomaly
    df_injected.loc[selected_anomalies, 'energy'] = df_injected.loc[selected_anomalies, 'energy'] + 10.0
    df_injected.loc[selected_anomalies, 'is_anomaly'] = 1
    
    print(f"Injected {len(selected_anomalies)} contextual anomalies.")
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
    spatial_features = ['lat', 'lon', 'building_density', 'ndvi_current']
    full_features = base_features + spatial_features
    
    # --- MODEL 1: BASELINE (V2) ---
    print("\n--- Training Baseline Model (V2) ---")
    dtrain_base = xgb.DMatrix(train_df[base_features], label=train_df['energy'])
    dtest_base = xgb.DMatrix(test_df_anom[base_features])
    
    model_base = xgb.train({'objective': 'reg:squarederror', 'seed': 42}, dtrain_base, num_boost_round=100)
    preds_base = model_base.predict(dtest_base)
    # Calculate residuals (Absolute Error)
    residuals_base = np.abs(test_df_anom['energy'] - preds_base).values.reshape(-1, 1)
    
    # --- MODEL 2: SPATIAL (V3) ---
    print("\n--- Training Spatial Model (V3) ---")
    dtrain_spatial = xgb.DMatrix(train_df[full_features], label=train_df['energy'])
    dtest_spatial = xgb.DMatrix(test_df_anom[full_features])
    
    model_spatial = xgb.train({'objective': 'reg:squarederror', 'seed': 42}, dtrain_spatial, num_boost_round=100)
    preds_spatial = model_spatial.predict(dtest_spatial)
    
    # Calculate residuals (Absolute Error)
    residuals_spatial = np.abs(test_df_anom['energy'] - preds_spatial).values.reshape(-1, 1)
    
    # --- ANOMALY DETECTION WITH ISOLATION FOREST ---
    print("\n--- Detecting Anomalies on Residuals + Context ---")
    
    # Handle contamination edge case if 0 anomalies are injected
    n_anomalies = len(test_df_anom[test_df_anom['is_anomaly'] == 1])
    contamination = max(n_anomalies / len(test_df_anom), 0.001)
    
    # Baseline IF: Sees only residual and basic temporal/weather context
    X_if_base = np.column_stack([
        residuals_base, 
        test_df_anom['outdoor_temperature'].values,
        test_df_anom['hour'].values
    ])
    iso_base = IsolationForest(contamination=contamination, random_state=42)
    preds_anom_base = iso_base.fit_predict(X_if_base)
    preds_anom_base = np.where(preds_anom_base == -1, 1, 0)
    
    # Spatial IF: Sees residual + rich spatial context
    X_if_spatial = np.column_stack([
        residuals_spatial, 
        test_df_anom['outdoor_temperature'].values,
        test_df_anom['hour'].values,
        test_df_anom['ndvi_current'].values,
        test_df_anom['building_density'].values
    ])
    iso_spatial = IsolationForest(contamination=contamination, random_state=42)
    preds_anom_spatial = iso_spatial.fit_predict(X_if_spatial)
    preds_anom_spatial = np.where(preds_anom_spatial == -1, 1, 0)
    
    y_true = test_df_anom['is_anomaly'].values
    
    # --- EVALUATE ---
    def evaluate(y_true, y_pred, name):
        prec = precision_score(y_true, y_pred, zero_division=0)
        rec = recall_score(y_true, y_pred, zero_division=0)
        f1 = f1_score(y_true, y_pred, zero_division=0)
        print(f"[{name}] Precision: {prec:.3f} | Recall: {rec:.3f} | F1: {f1:.3f}")
        return {"Precision": prec, "Recall": rec, "F1": f1}
    
    print("\n--- Results ---")
    
    anom_indices = test_df_anom['is_anomaly'] == 1
    norm_indices = test_df_anom['is_anomaly'] == 0
    
    if len(test_df_anom[norm_indices]) > 0:
        print(f"[Baseline (No Spatial)] Mean Residual (Normal): {np.mean(residuals_base[norm_indices]):.3f}")
        print(f"[Spatial (Sentinel+OSM)] Mean Residual (Normal): {np.mean(residuals_spatial[norm_indices]):.3f}")
        
    if len(test_df_anom[anom_indices]) > 0:
        print(f"[Baseline (No Spatial)] Mean Residual (Anomaly): {np.mean(residuals_base[anom_indices]):.3f}")
        print(f"[Spatial (Sentinel+OSM)] Mean Residual (Anomaly): {np.mean(residuals_spatial[anom_indices]):.3f}")

    res_base = evaluate(y_true, preds_anom_base, "Baseline (No Spatial) Residuals")
    res_spatial = evaluate(y_true, preds_anom_spatial, "Spatial (Sentinel+OSM) Residuals")
    
    results_output = {
        "Baseline": res_base,
        "Spatial": res_spatial
    }
    
    os.makedirs("app/models/saved", exist_ok=True)
    with open("experiment_b_results.json", "w") as f:
        json.dump(results_output, f, indent=2)
        
    model_spatial.save_model("app/models/saved/xgboost_spatial_v3.json")
    import joblib
    joblib.dump(iso_spatial, "app/models/saved/isolation_forest_spatial_v3.joblib")
    
    # Save a metadata file for inference mapping
    meta = {
        "features": full_features,
        "spatial_features": spatial_features,
        "base_features": base_features
    }
    with open("app/models/saved/metadata_spatial_v3.json", "w") as f:
        json.dump(meta, f, indent=2)
        
    print("\nExperiment B complete.")

if __name__ == "__main__":
    run_experiment_b()
