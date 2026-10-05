# -*- coding: utf-8 -*-
"""
Eğitim/seçim/son-test sınırlarında veri sızıntısı testleri (validation.py) ve
uyumsuz LSTM modelinin reddedilmesi (deep_model.validate_lstm_metadata).
Deterministik, ağ gerektirmez.
"""
import numpy as np
import pandas as pd
import pytest

from python_bot.engine.brain.validation import split_by_date, sequences
from python_bot.engine.brain.deep_model import (
    validate_lstm_metadata, SEQ_LENGTH, LSTM_LABEL_DEFINITION,
)
from python_bot.engine.brain.local_classifier import FEATURE_COLUMNS, FEATURE_SCHEMA_VERSION

HORIZON = 5


def _rows(n_days=100, symbols=("AAA", "BBB")):
    dates = pd.bdate_range("2024-01-01", periods=n_days)
    frames = []
    for s in symbols:
        df = pd.DataFrame({
            "f1": np.arange(n_days, dtype=np.float64),
            "label": np.where(np.arange(n_days) % 3 == 0, "UP", "FLAT"),
            "symbol": s,
        }, index=dates)
        # label window ends HORIZON business days after the row date
        df["label_end"] = pd.Series(dates, index=dates).shift(-HORIZON)
        frames.append(df.dropna(subset=["label_end"]))
    return pd.concat(frames).sort_index()


def test_split_partitions_are_disjoint_and_ordered():
    train, selection, final = split_by_date(_rows())
    assert train.index.max() < selection.index.min()
    assert selection.index.max() < final.index.min()


def test_split_purges_labels_that_cross_the_boundary():
    """Hiçbir eğitim etiketi seçim dönemine, hiçbir seçim etiketi son döneme taşmamalı."""
    train, selection, final = split_by_date(_rows())
    assert (train["label_end"] < selection.index.min()).all()
    assert (selection["label_end"] < final.index.min()).all()


def test_split_uses_shared_calendar_across_symbols():
    """Bölme hisse sırasına değil ortak tarihlere göre: her bölümde her hisse var."""
    train, selection, final = split_by_date(_rows())
    for part in (train, selection, final):
        assert set(part["symbol"]) == {"AAA", "BBB"}


def test_split_rejects_too_few_dates():
    with pytest.raises(ValueError):
        split_by_date(_rows(n_days=20))


def test_sequences_never_span_symbols_or_partitions():
    train, selection, _ = split_by_date(_rows())
    X_train, y_train = sequences(train, ["f1"], length=10)
    X_sel, _ = sequences(selection, ["f1"], length=10)
    # f1 = day number: a window inside one symbol and one partition is strictly consecutive
    assert np.all(np.diff(X_train[:, :, 0], axis=1) == 1.0)
    assert np.all(np.diff(X_sel[:, :, 0], axis=1) == 1.0)
    # no training window may contain a day that belongs to the selection period
    assert X_train[:, :, 0].max() < X_sel[:, :, 0].min()
    assert set(np.unique(y_train)) <= {0.0, 1.0}


def _lstm_meta(**overrides):
    meta = {
        "scaler": object(),
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "seq_length": SEQ_LENGTH,
        "label_definition": LSTM_LABEL_DEFINITION,
    }
    meta.update(overrides)
    return meta


def test_lstm_valid_metadata_passes():
    validate_lstm_metadata(_lstm_meta())


@pytest.mark.parametrize("overrides", [
    {"feature_schema_version": "old"},
    {"feature_columns": FEATURE_COLUMNS[:-2]},  # e.g. trained without rel_return_5d/20d
    {"seq_length": SEQ_LENGTH + 1},
    {"label_definition": "fwd_return >= 2%"},
])
def test_lstm_incompatible_metadata_rejected(overrides):
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_lstm_metadata(_lstm_meta(**overrides))


def test_legacy_bare_scaler_rejected():
    """Eski eğitim yalnızca StandardScaler kaydediyordu (metadata yok) -- reddedilmeli."""
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_lstm_metadata(object())
