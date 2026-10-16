# -*- coding: utf-8 -*-
"""
engine/brain/local_classifier.validate_artifact testleri.

Amaç: Uyumsuz/eksik bir model dosyası sessizce yanlış tahmin üretmemeli --
predict() şema/sürüm/etiket tanımı uyuşmazlığında MODEL_INCOMPATIBLE
ValueError fırlatmalı (section 5: "Uyumsuz modelle tahmin üretme").
Tamamen deterministik, ağ ve dosya sistemi gerektirmez.
"""
import pytest

from python_bot.engine.brain.local_classifier import (
    FEATURE_COLUMNS,
    FEATURE_SCHEMA_VERSION,
    FORWARD_HORIZON_DAYS,
    validate_artifact,
)

LABEL_DEFINITION = "UP/DOWN/FLAT: +/-0.5*ATR/close*sqrt(5), 5 trading bars"


def _valid_payload():
    return {
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "training_start": "2020-01-01",
        "training_end": "2024-01-01",
        "selection_end": "2024-06-01",
        "label_definition": LABEL_DEFINITION,
        "forward_horizon_days": FORWARD_HORIZON_DAYS,
        "preprocessing_version": FEATURE_SCHEMA_VERSION,
        "validation_method": "shared-date-purged-holdout",
        "validation_results": {"selection_accuracy": 0.4},
        "model_version": "local_rf_v2",
    }


def test_valid_payload_passes():
    validate_artifact(_valid_payload())  # raise etmemeli


def test_rejects_feature_schema_version_mismatch():
    payload = _valid_payload()
    payload["feature_schema_version"] = "stale-v1"
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_feature_columns_mismatch():
    payload = _valid_payload()
    payload["feature_columns"] = FEATURE_COLUMNS[:-1]  # eksik bir özellik
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_feature_column_order_mismatch():
    payload = _valid_payload()
    payload["feature_columns"] = list(reversed(FEATURE_COLUMNS))
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


@pytest.mark.parametrize("missing_key", [
    "training_start", "training_end", "selection_end", "label_definition",
    "forward_horizon_days", "preprocessing_version", "validation_method",
    "validation_results", "model_version",
])
def test_rejects_missing_metadata_key(missing_key):
    payload = _valid_payload()
    del payload[missing_key]
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_forward_horizon_mismatch():
    payload = _valid_payload()
    payload["forward_horizon_days"] = FORWARD_HORIZON_DAYS + 1
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_label_definition_mismatch():
    payload = _valid_payload()
    payload["label_definition"] = "some other label definition"
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_fetch_history_drops_unfinalised_nan_row(monkeypatch):
    """yfinance can return the latest day with NaN OHLC (volume filled). Keeping it made
    every rolling feature of the last row NaN, so all predictions failed (6 Oct 2026)."""
    import numpy as np
    import pandas as pd
    from python_bot.engine.brain import local_classifier as lc

    idx = pd.to_datetime(["2026-10-02", "2026-10-05", "2026-10-06"])
    raw = pd.DataFrame({"Open": [286.5, 292.25, np.nan], "High": [294.0, 295.25, np.nan],
                        "Low": [285.0, 291.75, np.nan], "Close": [292.0, 292.25, np.nan],
                        "Volume": [30905024, 27225485, 27302874]}, index=idx)
    monkeypatch.setattr(lc.yf, "download", lambda *a, **k: raw.copy())
    hist = lc._fetch_history("THYAO", period="1y")
    assert hist.index[-1] == pd.Timestamp("2026-10-05")
    assert not hist[["Open", "High", "Low", "Close"]].isna().any().any()
    bench = lc._fetch_benchmark_close(period="1y")
    assert bench.index[-1] == pd.Timestamp("2026-10-05") and not bench.isna().any()


def test_rolling_regime_tail_rows_matches_full_and_reduces_hmm_fits(monkeypatch):
    """tail_rows=1 (RF) and tail_rows=30 (LSTM) must produce bit-identical tail values
    to the full rolling pass while fitting the HMM only for the tail refit blocks."""
    import numpy as np
    import pandas as pd
    from python_bot.engine.brain import local_classifier as lc

    calls = []
    def fake_hmm(window, n_states=3):
        calls.append(len(window))
        return {"regime": "TREND" if len(window) % 40 == 0 else "YATAY", "confidence": float(len(window)) / 1000.0}

    monkeypatch.setattr(lc, "classify_regime_hmm", fake_hmm)
    close = pd.Series(np.linspace(100.0, 200.0, 250), index=pd.bdate_range("2025-01-01", periods=250))

    full = lc._rolling_regime_features(close)
    full_calls = len(calls)
    assert full_calls == 5  # rows 150, 170, 190, 210, 230

    calls.clear()
    tail1 = lc._rolling_regime_features(close, tail_rows=1)
    assert len(calls) == 1
    pd.testing.assert_series_equal(tail1.iloc[-1], full.iloc[-1])

    calls.clear()
    tail30 = lc._rolling_regime_features(close, tail_rows=30)
    assert len(calls) == 2  # blocks at 210 and 230 cover rows 220..249
    pd.testing.assert_frame_equal(tail30.iloc[-30:], full.iloc[-30:])


def test_provider_shares_cached_1h_download_between_4h_and_1h(monkeypatch):
    """Fetching 4h and then 1h for the same symbol must reuse the cached 1h download."""
    import numpy as np
    import pandas as pd
    from python_bot.engine.data import provider as prov

    calls = []
    dates = pd.date_range("2026-09-01 09:30", periods=500, freq="h", tz="Europe/Istanbul")
    raw = pd.DataFrame({
        "Open": np.full(500, 100.0),
        "High": np.full(500, 102.0),
        "Low": np.full(500, 99.0),
        "Close": np.full(500, 101.0),
        "Volume": np.full(500, 1000.0),
    }, index=dates)

    def fake_download(*args, **kwargs):
        calls.append((args, kwargs))
        return raw.copy()

    monkeypatch.setattr(prov.yf, "download", fake_download)
    p = prov.YFinanceDataProvider()
    res_4h = p.fetch_ohlcv("THYAO", interval="4h")
    res_1h = p.fetch_ohlcv("THYAO", interval="1h")
    assert res_4h.df is not None and res_1h.df is not None
    assert len(calls) == 1


def test_provider_prefetch_ohlcv_batch_populates_cache_in_one_call(monkeypatch):
    """prefetch_ohlcv_batch should download multiple symbols in one chunk and serve subsequent fetch_ohlcv from cache."""
    import numpy as np
    import pandas as pd
    from python_bot.engine.data import provider as prov

    calls = []
    dates = pd.date_range("2026-09-01 09:30", periods=400, freq="h", tz="Europe/Istanbul")
    cols = pd.MultiIndex.from_product([["THYAO.IS", "GARAN.IS"], ["Open", "High", "Low", "Close", "Volume"]])
    data = np.tile([100.0, 102.0, 99.0, 101.0, 1000.0, 50.0, 51.0, 49.0, 50.5, 2000.0], (400, 1))
    batch_df = pd.DataFrame(data, index=dates, columns=cols)

    def fake_download(*args, **kwargs):
        calls.append((args, kwargs))
        return batch_df.copy()

    monkeypatch.setattr(prov.yf, "download", fake_download)
    p = prov.YFinanceDataProvider()
    stored = p.prefetch_ohlcv_batch(["THYAO", "GARAN"], interval="4h", chunk_size=25)
    assert stored == 2
    assert len(calls) == 1

    res1 = p.fetch_ohlcv("THYAO", interval="4h")
    res2 = p.fetch_ohlcv("GARAN", interval="1h")
    assert res1.df is not None and res2.df is not None
    assert len(calls) == 1  # No extra yf.download calls!

