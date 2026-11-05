"""Production PU30 threshold regressions from the 6 October screenshot.

Only RSI values are injected to isolate exact boundaries; pivot detection,
price divergence, confirmation, scanner and endpoint logic remain real.
"""
import numpy as np
import pandas as pd
import pytest
from python_bot.engine.signals import rsi_pu30 as engine
from python_bot.engine.data.provider import DataResult, DataStatus


@pytest.fixture
def bars():
    df = pd.DataFrame({
        "date": pd.date_range("2025-01-06 10:00", periods=45, freq="h", tz="Europe/Istanbul"),
        "open": np.full(45, 100.0), "close": np.full(45, 100.0),
        "high": np.full(45, 110.0), "low": np.full(45, 99.0),
        "volume": np.full(45, 1000.0), "is_closed": True,
    })
    df.loc[20, "low"] = 90.0
    df.loc[40, "low"] = 89.0
    return df


def inject_rsi(monkeypatch, first, second):
    monkeypatch.setattr(engine, "_dip_rsi", lambda rsi, p, lb, rb: {20: first, 40: second}[p])


@pytest.mark.parametrize("first,second,accepted", [
    (24.8, 27.7, False),  # KCAER: second below 30
    (32.9, 33.4, False),  # TOASO: first above 30
    (30.0, 33.4, False), (24.8, 30.0, False), (30.0, 30.0, False),
    (24.8, 33.4, True), (29.999, 30.001, True),
])
@pytest.mark.parametrize("interval", ["1h", "4h", "1d"])
def test_default_pu30_thresholds(monkeypatch, bars, first, second, accepted, interval):
    inject_rsi(monkeypatch, first, second)
    assert engine.PU30Config().strict_threshold is True
    signal = engine.detect_rsi_pu30(bars, interval=interval)
    assert (signal is not None) == accepted
    if accepted:
        assert signal["dip1"]["rsi"] < 30 < signal["dip2"]["rsi"]
        assert signal["strategy_version"] == "pu30-strict-v3"


def test_valid_thresholds_still_require_closed_confirmation(monkeypatch, bars):
    inject_rsi(monkeypatch, 24.8, 33.4)
    assert engine.detect_rsi_pu30(bars, interval="1h") is not None
    bars.loc[42, "is_closed"] = False
    assert engine.detect_rsi_pu30(bars, interval="1h") is None


@pytest.mark.parametrize("first,second,expected", [(24.8,27.7,0), (32.9,33.4,0), (24.8,33.4,1)])
def test_shared_api_scanner_uses_strict_defaults(monkeypatch, bars, first, second, expected):
    from python_bot import signal_api
    inject_rsi(monkeypatch, first, second)
    def fetch(symbol, interval="4h", **kwargs):
        return bars, DataResult(symbol=symbol, interval=interval, df=bars,
                               status=DataStatus.FRESH, last_bar_time=str(bars.date.iloc[-1]))
    monkeypatch.setattr(engine, "_fetch_adjusted_bars", fetch)
    monkeypatch.setattr(signal_api, "BIST100_SYMBOLS", ["FIXTURE"])
    from fastapi import Response
    result = signal_api.scan_rsi_pu30(Response(), interval="1h", signal_type="pu30")
    assert result["status"] == "success"
    assert result["data"]["scanned"] == 1
    assert result["data"]["matched"] == expected


# --- NU70 mirror rule: first peak RSI > 70, second peak RSI < 70 (equality rejected) ---

@pytest.fixture
def peak_bars():
    df = pd.DataFrame({
        "date": pd.date_range("2025-01-06 10:00", periods=45, freq="h", tz="Europe/Istanbul"),
        "open": np.full(45, 98.0), "close": np.full(45, 98.0),
        "high": np.full(45, 100.0), "low": np.full(45, 95.0),
        "volume": np.full(45, 1000.0), "is_closed": True,
    })
    df.loc[20, "high"] = 110.0
    df.loc[40, "high"] = 111.0
    return df


@pytest.mark.parametrize("first,second,accepted", [
    (72.0, 65.0, True), (70.001, 69.999, True),
    (70.0, 65.0, False),   # first exactly 70
    (72.0, 70.0, False),   # second exactly 70
    (68.5, 60.0, False),   # accepted by the old +-2 tolerance
    (75.0, 71.0, False),   # accepted by the old flexible mode
])
def test_default_nu70_thresholds(monkeypatch, peak_bars, first, second, accepted):
    monkeypatch.setattr(engine, "_peak_rsi", lambda rsi, p, lb, rb: {20: first, 40: second}[p])
    assert engine.NU70Config().strict_threshold is True
    signal = engine.detect_rsi_nu70(peak_bars, interval="1h")
    assert (signal is not None) == accepted
    if accepted:
        assert signal["tepe1"]["rsi"] > 70 > signal["tepe2"]["rsi"]
        assert signal["strategy_version"] == "nu70-strict-v3"


def test_semih_vakbn_hammer_dip2_pivot_rsi_above_30(monkeypatch, bars):
    """VAKBN 1sa (5 Kasım 2026 ekran görüntüsü): 2. dip mumunda (p=40) çekiç mumu ile
    RSI=32.11 (>30), ancak 1 mum önce (p-1=39) RSI=25.87 (<30). Dip 2'nin kendi mumundaki
    RSI > 30 olduğu için PU30 kabul edilmelidir."""
    fake_rsi = np.full(len(bars), 45.0)
    fake_rsi[20] = 14.80
    fake_rsi[39] = 25.87  # left-window bar briefly dipped < 30
    fake_rsi[40] = 32.11  # actual hammer pivot bar closed with RSI > 30
    monkeypatch.setattr(engine, "wilder_rsi", lambda closes, length: fake_rsi)
    sig = engine.detect_rsi_pu30(bars, interval="1h")
    assert sig is not None
    assert sig["dip1"]["rsi"] == pytest.approx(14.80)
    assert sig["dip2"]["rsi"] == pytest.approx(32.11)


def test_semih_isctr_kurus_tolerance_double_bottom(monkeypatch, bars):
    """ISCTR 1sa (5 Kasım 2026 ekran görüntüsü): 1. dip 11.64 TL (RSI 18.68),
    2. dip 11.66 TL (+%0.17 / 2 kuruş fark, yatay mavi çizgi) ve teyit mumunda (p+1)
    11.68 TL ile RSI 36.82 (>30). %0.25 kuruş toleransı içinde kabul edilmeli,
    ancak belirgin yüksek dip (+%1.0) reddedilmelidir."""
    bars.loc[:, "low"] = 12.20
    bars.loc[:, "high"] = 12.50
    bars.loc[20, "low"] = 11.64
    bars.loc[40, "low"] = 11.66  # +0.172% within 0.25% tolerance
    bars.loc[41, "low"] = 11.68
    fake_rsi = np.full(len(bars), 45.0)
    fake_rsi[20] = 18.68
    fake_rsi[40] = 27.62
    fake_rsi[41] = 36.82
    monkeypatch.setattr(engine, "wilder_rsi", lambda closes, length: fake_rsi)
    sig = engine.detect_rsi_pu30(bars, interval="1h")
    assert sig is not None
    assert sig["dip1"]["price"] == pytest.approx(11.64)
    assert sig["dip2"]["price"] == pytest.approx(11.66)
    assert sig["dip2"]["rsi"] == pytest.approx(36.82)

    # Belirgin yüksek dip (+%1.0 > %0.25) reddedilmeli
    bars.loc[40, "low"] = 11.76
    assert engine.detect_rsi_pu30(bars, interval="1h") is None

