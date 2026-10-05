import pandas as pd
import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader
    TORCH_AVAILABLE = True
    # Cihaz Seçimi (CUDA varsa Ekran Kartı, yoksa İşlemci)
    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
except ImportError:
    TORCH_AVAILABLE = False
    DEVICE = None
    nn = None
    Dataset = object  # allows the class body below to still be defined


if TORCH_AVAILABLE:
    class StockDataset(Dataset):
        def __init__(self, sequences, targets):
            """
            sequences: numpy array of shape (num_samples, seq_length, num_features)
            targets: numpy array of shape (num_samples,) -> 1 (UP) or 0 (DOWN)
            """
            self.sequences = torch.tensor(sequences, dtype=torch.float32).to(DEVICE)
            self.targets = torch.tensor(targets, dtype=torch.float32).to(DEVICE)

        def __len__(self):
            return len(self.targets)

        def __getitem__(self, idx):
            return self.sequences[idx], self.targets[idx]

    class QuantumLSTM(nn.Module):
        def __init__(self, input_size, hidden_size=64, num_layers=2, dropout=0.2):
            super(QuantumLSTM, self).__init__()

            self.hidden_size = hidden_size
            self.num_layers = num_layers

            # LSTM Layer (Zaman Hafızası)
            self.lstm = nn.LSTM(
                input_size=input_size,
                hidden_size=hidden_size,
                num_layers=num_layers,
                batch_first=True,
                dropout=dropout
            )

            # Fully Connected Layer (Karar Aşaması)
            self.fc1 = nn.Linear(hidden_size, 32)
            self.relu = nn.ReLU()
            self.dropout = nn.Dropout(dropout)
            self.fc2 = nn.Linear(32, 1)
            self.sigmoid = nn.Sigmoid() # 0 ile 1 arası Olasılık (Güven Skoru) döner

        def forward(self, x):
            # x shape: (batch, seq_length, features)
            h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(DEVICE)
            c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(DEVICE)

            # LSTM'den geçiş
            out, _ = self.lstm(x, (h0, c0))

            # Sadece en son günün (Zaman Serisinin sonunun) çıktısını alıyoruz
            out = out[:, -1, :]

            out = self.fc1(out)
            out = self.relu(out)
            out = self.dropout(out)
            out = self.fc2(out)
            out = self.sigmoid(out) # UP olma ihtimali (Örn: 0.85 = %85 Yükseliş İhtimali)

            return out
else:
    StockDataset = None
    QuantumLSTM = None


from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
MODEL_WEIGHTS_PATH = MODELS_DIR / "quantum_lstm.pth"
LSTM_META_PATH = MODELS_DIR / "lstm_scaler.joblib"  # scaler + metadata dict
SEQ_LENGTH = 30
LSTM_MODEL_VERSION = "quantum_lstm_v2"
LSTM_LABEL_DEFINITION = "P(RF label == UP): +0.5*ATR/close*sqrt(5) within 5 trading bars"


def validate_lstm_metadata(meta):
    """Refuse to predict with an LSTM trained on a different feature schema,
    sequence length or label (raises MODEL_INCOMPATIBLE, never silently runs)."""
    from python_bot.engine.brain.local_classifier import FEATURE_COLUMNS, FEATURE_SCHEMA_VERSION
    if not isinstance(meta, dict):
        raise ValueError("MODEL_INCOMPATIBLE: legacy LSTM scaler without metadata; retrain")
    expected = {
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "seq_length": SEQ_LENGTH,
        "label_definition": LSTM_LABEL_DEFINITION,
    }
    for key, value in expected.items():
        if meta.get(key) != value:
            raise ValueError(f"MODEL_INCOMPATIBLE: LSTM {key} mismatch; retrain")
    if "scaler" not in meta:
        raise ValueError("MODEL_INCOMPATIBLE: LSTM scaler missing")


def lstm_probability_from_features(feat, meta, model):
    """P(UP) for the sequence ending at the last row of `feat` (already built
    by local_classifier.build_features -- the same pipeline as training)."""
    from python_bot.engine.brain.local_classifier import FEATURE_COLUMNS
    window = feat[FEATURE_COLUMNS].iloc[-SEQ_LENGTH:]
    if len(window) < SEQ_LENGTH or window.isna().any().any():
        raise ValueError("DATA_INSUFFICIENT: incomplete LSTM feature window")
    x = meta["scaler"].transform(window.to_numpy(dtype=np.float64))
    with torch.no_grad():
        return float(model(torch.tensor(x, dtype=torch.float32).unsqueeze(0).to(DEVICE)).item())


def load_lstm():
    """Returns (model, meta) or None when torch or the trained artifacts are absent."""
    import joblib
    if not TORCH_AVAILABLE or not MODEL_WEIGHTS_PATH.exists() or not LSTM_META_PATH.exists():
        return None
    from python_bot.engine.brain.local_classifier import FEATURE_COLUMNS
    meta = joblib.load(LSTM_META_PATH)
    validate_lstm_metadata(meta)
    model = QuantumLSTM(input_size=len(FEATURE_COLUMNS)).to(DEVICE)
    model.load_state_dict(torch.load(MODEL_WEIGHTS_PATH, map_location=DEVICE))
    model.eval()
    return model, meta


def predict_lstm(symbol):
    """None = LSTM not available (torch missing / not trained). Raises on an
    incompatible model or insufficient data so callers can report it."""
    loaded = load_lstm()
    if loaded is None:
        return None
    model, meta = loaded
    from python_bot.engine.brain.local_classifier import _fetch_history, _fetch_benchmark_close, build_features
    df = _fetch_history(symbol, period="2y")
    feat = build_features(df, _fetch_benchmark_close(period="2y"))
    return lstm_probability_from_features(feat, meta, model)
