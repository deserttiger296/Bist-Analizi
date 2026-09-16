import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import numpy as np
import pandas as pd
from pathlib import Path
from engine.brain.deep_model import QuantumLSTM, StockDataset, DEVICE
from engine.brain.local_classifier import _fetch_history, _engineer_base_features, _regime_features_for_symbol, FEATURE_COLUMNS, FORWARD_HORIZON_DAYS, UP_THRESHOLD, DOWN_THRESHOLD
from sklearn.preprocessing import StandardScaler
import joblib

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
MODEL_WEIGHTS_PATH = MODELS_DIR / "quantum_lstm.pth"
SCALER_PATH = MODELS_DIR / "lstm_scaler.joblib"

SEQ_LENGTH = 30 # Son 30 günün hafızasını tutacağız

def build_sequences(symbol):
    df = _fetch_history(symbol, period="5y")
    if df.empty or len(df) < SEQ_LENGTH + FORWARD_HORIZON_DAYS:
        return None, None
        
    feat = _engineer_base_features(df)
    regime = _regime_features_for_symbol(df["Close"])
    feat["regime_code"] = regime["regime_code"]
    feat["regime_confidence"] = regime["regime_confidence"]
    
    # Calculate Forward Return
    fwd_return = feat["Close"].shift(-FORWARD_HORIZON_DAYS) / feat["Close"] - 1.0
    
    # Derin öğrenme için Binary Classification: YÜKSELECEK Mİ? (1: EVET, 0: HAYIR)
    feat["target"] = np.where(fwd_return >= UP_THRESHOLD, 1, 0)
    
    feat = feat.dropna(subset=FEATURE_COLUMNS + ["target"])
    
    data = feat[FEATURE_COLUMNS].values
    targets = feat["target"].values
    
    sequences = []
    seq_targets = []
    
    for i in range(len(data) - SEQ_LENGTH):
        sequences.append(data[i : i + SEQ_LENGTH])
        seq_targets.append(targets[i + SEQ_LENGTH - 1])
        
    if len(sequences) == 0:
        return None, None
        
    return np.array(sequences), np.array(seq_targets)

def train_lstm(symbols):
    print(f"[{DEVICE}] Cihazında Quantum LSTM Eğitimi Başlıyor...")
    
    all_sequences = []
    all_targets = []
    
    for sym in symbols:
        print(f"{sym} verileri hazırlanıyor...")
        seqs, targets = build_sequences(sym)
        if seqs is not None:
            all_sequences.append(seqs)
            all_targets.append(targets)
            
    X = np.concatenate(all_sequences, axis=0)
    y = np.concatenate(all_targets, axis=0)
    
    # Verileri Ölçeklendirme (Neural Networks Normalize Veri Sever)
    num_samples, seq_len, num_features = X.shape
    X_flat = X.reshape(-1, num_features)
    scaler = StandardScaler()
    X_flat_scaled = scaler.fit_transform(X_flat)
    X_scaled = X_flat_scaled.reshape(num_samples, seq_len, num_features)
    
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, SCALER_PATH)
    
    # Zaman Serisi Doğruluğu (Dürüst Sistem) için Kronolojik Bölme
    # İlk %80'i Eğitim (Geçmiş), Son %20'si Test (Gelecek)
    split_idx = int(num_samples * 0.8)
    
    X_train, y_train = X_scaled[:split_idx], y[:split_idx]
    X_test, y_test = X_scaled[split_idx:], y[split_idx:]
    
    train_dataset = StockDataset(X_train, y_train)
    test_dataset = StockDataset(X_test, y_test)
    
    # Sadece eğitim verisi karıştırılabilir, test verisi asla karıştırılmaz
    train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=64, shuffle=False)
    
    model = QuantumLSTM(input_size=num_features, hidden_size=64, num_layers=2).to(DEVICE)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    
    EPOCHS = 15
    print(f"Eğitim Verisi: {len(y_train)} sekans | Test (Gelecek) Verisi: {len(y_test)} sekans")
    
    for epoch in range(EPOCHS):
        model.train()
        train_loss = 0
        for batch_x, batch_y in train_loader:
            optimizer.zero_grad()
            outputs = model(batch_x).squeeze()
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
            
        # Dürüst Doğrulama (Geleceği tahmin etme)
        model.eval()
        correct = 0
        total = 0
        test_loss = 0
        with torch.no_grad():
            for batch_x, batch_y in test_loader:
                outputs = model(batch_x).squeeze()
                loss = criterion(outputs, batch_y)
                test_loss += loss.item()
                predicted = (outputs >= 0.5).float()
                correct += (predicted == batch_y).sum().item()
                total += batch_y.size(0)
                
        accuracy = correct / total
        print(f"Epoch [{epoch+1}/{EPOCHS}] - Train Loss: {train_loss/len(train_loader):.4f} | Test Loss: {test_loss/len(test_loader):.4f} | GERÇEK DOĞRULUK: %{accuracy*100:.2f}")

            
    torch.save(model.state_dict(), MODEL_WEIGHTS_PATH)
    print(f"Eğitim Tamamlandı! Model ağırlıkları kaydedildi: {MODEL_WEIGHTS_PATH}")

if __name__ == "__main__":
    bist_symbols = ["THYAO", "GARAN", "TUPRS", "AKBNK", "ASELS", "KCHOL", "ISCTR", "SAHOL", "BIMAS", "EREGL"]
    train_lstm(bist_symbols)
