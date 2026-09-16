import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import pandas as pd
import numpy as np

# Cihaz Seçimi (CUDA varsa Ekran Kartı, yoksa İşlemci)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

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

def predict_lstm(symbol):
    from engine.brain.local_classifier import _fetch_history, _engineer_base_features, _regime_features_for_symbol, FEATURE_COLUMNS
    import joblib
    from pathlib import Path
    
    MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
    MODEL_WEIGHTS_PATH = MODELS_DIR / "quantum_lstm.pth"
    SCALER_PATH = MODELS_DIR / "lstm_scaler.joblib"
    SEQ_LENGTH = 30
    
    if not MODEL_WEIGHTS_PATH.exists() or not SCALER_PATH.exists():
        return None
        
    df = _fetch_history(symbol, period="1y")
    if df.empty or len(df) < SEQ_LENGTH:
        return None
        
    feat = _engineer_base_features(df)
    regime = _regime_features_for_symbol(df["Close"])
    feat["regime_code"] = regime["regime_code"]
    feat["regime_confidence"] = regime["regime_confidence"]
    
    feat = feat.dropna(subset=FEATURE_COLUMNS)
    if len(feat) < SEQ_LENGTH:
        return None
        
    # Sadece son SEQ_LENGTH kadarını al
    last_sequence = feat[FEATURE_COLUMNS].values[-SEQ_LENGTH:]
    
    # Scale
    scaler = joblib.load(SCALER_PATH)
    last_seq_scaled = scaler.transform(last_sequence)
    
    # Tensore çevir (batch=1, seq=30, features=12)
    x_tensor = torch.tensor(last_seq_scaled, dtype=torch.float32).unsqueeze(0).to(DEVICE)
    
    model = QuantumLSTM(input_size=len(FEATURE_COLUMNS)).to(DEVICE)
    model.load_state_dict(torch.load(MODEL_WEIGHTS_PATH, map_location=DEVICE))
    model.eval()
    
    with torch.no_grad():
        prob = model(x_tensor).item()
        
    return float(prob)
