"""/api/chart indicators, computed without pandas_ta (which cannot be installed
next to the locked numba/numpy). Reference values were checked against
pandas_ta 0.4.71b0: sma, ema (SMA-seeded) and bbands(5, 2, ddof=1)."""
import numpy as np
import pandas as pd

import python_bot.main_api as main_api
from python_bot.main_api import _sma_seeded_ema


def _closes(n=130, seed=1):
    rng = np.random.default_rng(seed)
    return pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.02, n))), dtype=np.float64)


def test_ema_is_seeded_with_sma_of_first_window():
    c = _closes()
    ema = _sma_seeded_ema(c, 9)
    assert ema.iloc[:8].isna().all()
    assert np.isclose(ema.iloc[8], c.iloc[:9].mean())
    alpha = 2 / (9 + 1)
    assert np.isclose(ema.iloc[9], alpha * c.iloc[9] + (1 - alpha) * ema.iloc[8])


def test_ema_shorter_than_window_is_all_nan():
    assert _sma_seeded_ema(_closes(5), 9).isna().all()


def test_chart_endpoint_returns_indicators_without_pandas_ta(monkeypatch):
    c = _closes()
    idx = pd.date_range("2026-01-01", periods=len(c), freq="B")
    df = pd.DataFrame({"Open": c, "High": c * 1.01, "Low": c * 0.99, "Close": c, "Volume": 1.0}, index=idx)
    monkeypatch.setattr(main_api.yf, "download", lambda *a, **k: df.copy())

    res = main_api.get_chart_data("THYAO")
    assert res["status"] == "success"
    rows = pd.DataFrame(res["data"])
    assert len(rows) == len(c) - 49  # rows before SMA50 exists are dropped
    assert np.allclose(rows["sma50"], c.rolling(50).mean().iloc[49:])
    assert np.allclose(rows["ema9"], _sma_seeded_ema(c, 9).iloc[49:])
    std = c.rolling(5).std(ddof=1).iloc[49:].to_numpy()
    assert np.allclose(rows["bb_upper"] - rows["bb_lower"], 4 * std)
