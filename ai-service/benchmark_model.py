import pandas as pd
import numpy as np
import joblib
import os
import json
from sklearn.metrics import confusion_matrix, precision_score, recall_score, f1_score

def analyze_scores():
    # Paths
    model_path = "app/models/saved/isolation_forest_v1.joblib"
    train_data_path = "data/training/historical_data.csv"
    replay_data_path = "data/synthetic/replay_data.csv"

    if not os.path.exists(model_path) or not os.path.exists(train_data_path) or not os.path.exists(replay_data_path):
        print("Missing files!")
        return

    model = joblib.load(model_path)
    train_df = pd.read_csv(train_data_path)
    replay_df = pd.read_csv(replay_data_path)

    features = [
        'temperature_delta', 'humidity_delta', 'power_ratio', 
        'rolling_mean', 'hour', 'day_of_week', 
        'outside_inside_temp_diff', 'hvac_runtime',
        'floor_level', 'room_area', 'occupancy', 'outdoor_temperature',
        'NDVI', 'solar_context', 'building_orientation'
    ]

    X_train = train_df[features]
    train_scores_raw = model.decision_function(X_train)
    
    print("--- Isolation Forest Analysis ---")
    print(f"Model Offset (threshold based on contamination): {model.offset_:.4f}")
    print(f"Train Raw Scores - Min: {train_scores_raw.min():.4f}, Max: {train_scores_raw.max():.4f}, Mean: {train_scores_raw.mean():.4f}")
    
    # Analyze Replay data (which has injected anomalies)
    # The anomaly was injected from index 96 to 107
    y_true = np.zeros(len(replay_df))
    y_true[96:108] = 1 # 1 is anomaly
    
    X_replay = replay_df[features]
    replay_scores_raw = model.decision_function(X_replay)
    
    print("\n--- Raw Score Distribution in Replay Data ---")
    normal_scores = replay_scores_raw[y_true == 0]
    anom_scores = replay_scores_raw[y_true == 1]
    print(f"Normal Data Raw Scores   - Mean: {normal_scores.mean():.4f}, Min: {normal_scores.min():.4f}, Max: {normal_scores.max():.4f}")
    print(f"Anomalous Data Raw Scores- Mean: {anom_scores.mean():.4f}, Min: {anom_scores.min():.4f}, Max: {anom_scores.max():.4f}")
    
    print("\n--- Investigating the 0.47-0.48 normalized score issue ---")
    print("Current normalization formula: normalized = 0.5 - (raw_score / 2.0)")
    print("If raw score is positive (e.g. 0.05), normalized = 0.5 - 0.025 = 0.475")
    print("This is why normal data gets ~0.47-0.48! The formula maps 0 to 0.5, but Isolation Forest centers normal data around 0.0 to 0.1.")
    
    print("\n--- Benchmark with Model's Built-in Offset ---")
    # If raw_score < offset_, it is an anomaly
    y_pred_builtin = (replay_scores_raw < model.offset_).astype(int)
    
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred_builtin).ravel()
    prec = precision_score(y_true, y_pred_builtin, zero_division=0)
    rec = recall_score(y_true, y_pred_builtin, zero_division=0)
    f1 = f1_score(y_true, y_pred_builtin, zero_division=0)
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
    
    print(f"Built-in Threshold ({model.offset_:.4f}):")
    print(f"TN: {tn}, FP: {fp}, FN: {fn}, TP: {tp}")
    print(f"Precision: {prec:.4f}, Recall: {rec:.4f}, F1: {f1:.4f}, FPR: {fpr:.4f}")

    print("\n--- Benchmark with Custom Percentile Threshold ---")
    # Let's set a threshold such that only the bottom 1% of the training data is anomalous
    # (or we can just use the 1st percentile of training scores)
    p01_thresh = np.percentile(train_scores_raw, 1)
    print(f"1st Percentile of Train Scores: {p01_thresh:.4f}")
    
    y_pred_p01 = (replay_scores_raw < p01_thresh).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred_p01).ravel()
    prec = precision_score(y_true, y_pred_p01, zero_division=0)
    rec = recall_score(y_true, y_pred_p01, zero_division=0)
    f1 = f1_score(y_true, y_pred_p01, zero_division=0)
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
    
    print(f"Custom Threshold ({p01_thresh:.4f}):")
    print(f"TN: {tn}, FP: {fp}, FN: {fn}, TP: {tp}")
    print(f"Precision: {prec:.4f}, Recall: {rec:.4f}, F1: {f1:.4f}, FPR: {fpr:.4f}")
    
if __name__ == "__main__":
    analyze_scores()
