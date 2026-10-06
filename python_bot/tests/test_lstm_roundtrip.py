# -*- coding: utf-8 -*-
"""
LSTM train -> save -> load -> predict round trip on synthetic rows.

Unit tests of each piece passed while the chain itself was broken (trainer
wrote `sequence_length`, loader expected `seq_length`; float32 model fed
float64 data). This test exercises the real functions end to end. No network.
"""
import numpy as np
import pandas as pd
import pytest

torch = pytest.importorskip("torch")

from python_bot.engine.brain import deep_model, train_deep_model  # noqa: E402
from python_bot.engine.brain.local_classifier import FEATURE_COLUMNS  # noqa: E402


def _synthetic_rows(n_days=200, symbols=("AAA", "BBB"), seed=0):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    frames = []
    for s in symbols:
        df = pd.DataFrame(rng.normal(size=(n_days, len(FEATURE_COLUMNS))), index=dates, columns=FEATURE_COLUMNS)
        df["label"] = np.where(rng.random(n_days) < 0.3, "UP", "FLAT")
        df["symbol"] = s
        df["label_end"] = pd.Series(dates, index=dates).shift(-5)
        frames.append(df.dropna(subset=["label_end"]))
    return pd.concat(frames).sort_index()


@pytest.fixture
def isolated_artifacts(tmp_path, monkeypatch):
    weights, meta = tmp_path / "quantum_lstm.pth", tmp_path / "lstm_scaler.joblib"
    for module in (deep_model, train_deep_model):
        monkeypatch.setattr(module, "MODEL_WEIGHTS_PATH", weights)
        monkeypatch.setattr(module, "LSTM_META_PATH", meta)
    monkeypatch.setattr(train_deep_model, "_fetch_benchmark_close", lambda period="3y": pd.Series(dtype=float))
    monkeypatch.setattr(train_deep_model, "build_training_set", lambda symbols, bench: (_synthetic_rows(), {}))
    return weights, meta


def test_trained_lstm_loads_and_predicts(isolated_artifacts):
    results = train_deep_model.train_lstm(["AAA", "BBB"], epochs=1)
    assert results["rows"] > 0

    loaded = deep_model.load_lstm()
    assert loaded is not None, "freshly trained artifacts must load (no schema mismatch)"
    model, meta = loaded
    assert meta["seq_length"] == deep_model.SEQ_LENGTH
    assert meta["symbols"] == ["AAA", "BBB"]
    assert next(model.parameters()).dtype == torch.float64

    feat = _synthetic_rows(n_days=60, symbols=("AAA",), seed=1)[FEATURE_COLUMNS]
    prob = deep_model.lstm_probability_from_features(feat, meta, model)
    assert 0.0 <= prob <= 1.0


def test_incomplete_window_is_rejected_not_padded(isolated_artifacts):
    train_deep_model.train_lstm(["AAA", "BBB"], epochs=1)
    model, meta = deep_model.load_lstm()
    feat = _synthetic_rows(n_days=60, symbols=("AAA",), seed=2)[FEATURE_COLUMNS]
    feat.iloc[-1, 0] = np.nan
    with pytest.raises(ValueError, match="DATA_INSUFFICIENT"):
        deep_model.lstm_probability_from_features(feat, meta, model)
