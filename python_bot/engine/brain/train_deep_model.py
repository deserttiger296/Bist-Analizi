"""
QuantumLSTM training on the SAME causal feature pipeline and label as the RF
(local_classifier.build_features / _label_forward_return), so the two models
answer the same question: "will the RF 'UP' label be hit within 5 bars?".

Leakage controls:
- Shared calendar split across all symbols (validation.split_by_date): train /
  selection / untouched final, with the train and selection partitions purged
  so no label window crosses into the next partition.
- Scaler is fit on TRAIN rows only.
- Sequences are built per symbol inside a single partition, never across a
  boundary; rows whose forward label isn't known yet are already excluded.
- Regime features come from the rolling (past-only) HMM in build_features.

Run from the repo root:  .venv/Scripts/python.exe -m python_bot.engine.brain.train_deep_model
"""
import numpy as np
import pandas as pd
import joblib
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader

from python_bot.engine.brain.deep_model import (
    QuantumLSTM, StockDataset, DEVICE, MODEL_WEIGHTS_PATH, LSTM_META_PATH, SEQ_LENGTH,
    LSTM_MODEL_VERSION, LSTM_LABEL_DEFINITION,
)
from python_bot.engine.brain.local_classifier import (
    build_training_set, _fetch_benchmark_close, FEATURE_COLUMNS, FEATURE_SCHEMA_VERSION,
    FORWARD_HORIZON_DAYS,
)
from python_bot.engine.brain.validation import split_by_date, sequences
from sklearn.preprocessing import StandardScaler

EPOCHS = 15


def _scaled(part: pd.DataFrame, scaler: StandardScaler) -> pd.DataFrame:
    out = part.copy()
    out[FEATURE_COLUMNS] = scaler.transform(out[FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    return out


def _evaluate(model, X, y):
    model.eval()
    with torch.no_grad():
        prob = model(torch.tensor(X, dtype=torch.float64).to(DEVICE)).squeeze(-1).cpu().numpy()
    result = {
        "rows": int(len(y)),
        "up_base_rate": float(y.mean()),
        "accuracy_at_0_5": float(((prob >= 0.5) == (y == 1.0)).mean()),
    }
    for thr in (0.5, 0.6, 0.7):
        mask = prob >= thr
        result[f"up_precision_at_{thr}"] = float(y[mask].mean()) if mask.any() else None
        result[f"support_at_{thr}"] = int(mask.sum())
    return result


def train_lstm(symbols, epochs: int = EPOCHS, seed: int = 42):
    torch.manual_seed(seed)
    np.random.seed(seed)
    print(f"[{DEVICE}] QuantumLSTM eğitimi: {len(symbols)} hisse")

    benchmark = _fetch_benchmark_close(period="3y")
    rows, skipped = build_training_set(symbols, benchmark)
    train, selection, final = split_by_date(rows)

    scaler = StandardScaler().fit(train[FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    X_train, y_train = sequences(_scaled(train, scaler), FEATURE_COLUMNS, SEQ_LENGTH)
    X_sel, y_sel = sequences(_scaled(selection, scaler), FEATURE_COLUMNS, SEQ_LENGTH)
    print(f"Eğitim sekansı: {len(y_train)} | Seçim (out-of-sample) sekansı: {len(y_sel)}")

    loader = DataLoader(StockDataset(X_train, y_train), batch_size=64, shuffle=True)
    model = QuantumLSTM(input_size=len(FEATURE_COLUMNS), hidden_size=64, num_layers=2).double().to(DEVICE)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    for epoch in range(epochs):
        model.train()
        total = 0.0
        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            loss = criterion(model(batch_x).squeeze(-1), batch_y)
            loss.backward()
            optimizer.step()
            total += loss.item()
        print(f"Epoch {epoch + 1}/{epochs} train_loss={total / len(loader):.4f}")

    # Selection-period metrics only; the final partition stays untouched for
    # the variant comparison (scripts/compare_variants.py).
    results = _evaluate(model, X_sel, y_sel)
    print(f"Seçim dönemi: {results}")

    MODEL_WEIGHTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), MODEL_WEIGHTS_PATH)
    joblib.dump({
        "scaler": scaler,
        "model_version": LSTM_MODEL_VERSION,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "seq_length": SEQ_LENGTH,
        "dtype": "float64",
        "forward_horizon_days": FORWARD_HORIZON_DAYS,
        "label_definition": LSTM_LABEL_DEFINITION,
        "training_start": str(train.index.min()),
        "training_end": str(train.index.max()),
        "selection_end": str(selection.index.max()),
        "final_start": str(final.index.min()),
        "validation_method": "shared-date-purged-holdout",
        "validation_results": results,
        "symbols": sorted(rows["symbol"].unique().tolist()),
        "skipped_symbols": skipped,
    }, LSTM_META_PATH)
    print(f"Kaydedildi: {MODEL_WEIGHTS_PATH} + {LSTM_META_PATH}")
    return results


if __name__ == "__main__":
    train_lstm(["THYAO", "GARAN", "TUPRS", "AKBNK", "ASELS", "KCHOL", "ISCTR", "SAHOL", "BIMAS", "EREGL"])
