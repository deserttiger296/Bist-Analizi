"""Classical response compatibility and laboratory-only lower-TF calculations."""
import json
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from python_bot.engine.signals import rsi_pu30 as classic
from python_bot.engine.signals import pu30_mtf as lab
from python_bot.engine.data.provider import DataResult, DataStatus


def bars(n=61, interval="15min"):
    return pd.DataFrame({"date": pd.date_range("2026-09-01 10:00", periods=n, freq=interval, tz="Europe/Istanbul"),
                         "open": 100., "high": 101., "low": 99., "close": 100.,
                         "volume": 1000., "is_closed": True})


def test_most_price_ema9_and_11_percent_hand_calculation():
    result = lab.calc_most([100.] * 9 + [110., 90.])
    assert result["ema"][8:] == pytest.approx([100., 102., 99.6])
    assert result["most"][8:] == pytest.approx([98.9, 100.878, 100.6956])
    assert result["above_ema"] is False and result["above_most"] is False
    json.dumps(result, allow_nan=False)
    rising = lab.calc_most([100.] * 9 + [110.])
    assert rising["above_ema"] is True and rising["above_most"] is True


def test_most_insufficient_data_is_unknown_not_fabricated_green():
    result = lab.calc_most([100., 101.])
    assert result["status"] == "INSUFFICIENT_HISTORY"
    assert result["above_most"] is None
    with pytest.raises(ValueError): lab.calc_most([100., float("nan")])


def lower_bars(monkeypatch, current=50., opened=False):
    df = bars(62 if opened else 61)
    df.loc[20, "high"], df.loc[40, "high"] = 110., 120.
    if opened: df.loc[61, "is_closed"] = False
    def rsi(values, period=14):
        out = np.full(len(values), 50.)
        out[20], out[40], out[60] = 80., 70., current
        return out
    monkeypatch.setattr(lab, "wilder_rsi", rsi)
    return df


def test_lower_nu_without_70_threshold_and_regression_line(monkeypatch):
    df = lower_bars(monkeypatch)
    result = lab.detect_lower_tf_nu_and_rsi_trend(df, df)
    assert result["nu_pressure"] and result["rsi_trend_broken"] is False
    for state in result["timeframes"].values():
        assert state["nu_pair"]["price2"] > state["nu_pair"]["price1"]
        assert state["rsi_trend"]["slope"] == pytest.approx(-.5)
        assert state["rsi_trend"]["value_now"] == pytest.approx(60.)
        assert "ema" not in state["most"] and "most" not in state["most"], "scan payload must contain summaries, not indicator history"


def test_closed_rsi_break_releases_pressure(monkeypatch):
    df = lower_bars(monkeypatch, current=65.)
    result = lab.detect_lower_tf_nu_and_rsi_trend(df, df)
    assert result["nu_pressure"] and result["rsi_trend_broken"]


def test_open_bar_cannot_confirm_rsi_trend_break(monkeypatch):
    df = lower_bars(monkeypatch, current=50., opened=True)
    result = lab.detect_lower_tf_nu_and_rsi_trend(df, df)
    assert result["rsi_trend_broken"] is False
    assert result["timeframes"]["15m"]["latest_bar_closed"] is False


def test_one_unbroken_timeframe_keeps_pressure_even_if_other_breaks(monkeypatch):
    df = lower_bars(monkeypatch)
    hourly = df.copy()
    hourly.loc[60, "close"] = 105.
    def rsi(values, period=14):
        out = np.full(len(values), 50.)
        out[20], out[40] = 80., 70.
        out[-1] = 65. if values[-1] == 105. else 50.
        return out
    monkeypatch.setattr(lab, "wilder_rsi", rsi)
    result = lab.detect_lower_tf_nu_and_rsi_trend(df, hourly)
    assert result["timeframes"]["1h"]["rsi_trend_broken"] is True
    assert result["rsi_trend_broken"] is False


@pytest.fixture
def classic_fixture(monkeypatch):
    df = bars(45, "h")
    df.loc[20, "low"], df.loc[40, "low"] = 90., 89.
    df["high"] = 110.
    monkeypatch.setattr(classic, "_dip_rsi", lambda rsi, p, lb, rb: {20: 24.8, 40: 33.4}[p])
    def fetch(symbol, interval="4h", **kwargs):
        return df.copy(), DataResult(symbol=symbol, interval=interval, df=df.copy(), status=DataStatus.FRESH)
    monkeypatch.setattr(classic, "_fetch_adjusted_bars", fetch)
    def forbidden(*args, **kwargs):
        raise AssertionError("Classic path must not call MTF lab")
    monkeypatch.setattr(lab, "_load_pu30_frames", forbidden)
    monkeypatch.setattr(lab, "build_mtf_decision", forbidden)
    monkeypatch.setattr(lab, "_fetch_lab_15m", forbidden)
    return df


def test_classic_scan_keeps_original_keys_and_local_fibonacci(classic_fixture):
    result = classic.scan_universe_rsi_pu30(["ISCTR"], interval="4h", signal_type="pu30")
    assert result["status"] == "success" and result["matched"] == 1
    signal = result["signals"][0]
    assert "mtf_decision" not in signal
    assert signal["fibonacci_levels"][0]["level"] == 1.618
    assert signal["fibonacci_levels"][0]["price"] == round(89. + (110. - 89.) * 1.618, 2)
    assert "confluence_badge" in signal and "confirmed_timeframes" in signal


def test_classic_detail_keeps_original_format(classic_fixture):
    result = classic.get_symbol_chart_data("ISCTR", interval="4h")
    assert set(result) == {"symbol", "interval", "data_status", "data_updated_at", "history_limit_note",
                           "bars", "signal", "pu30_signal", "nu70_signal"}
    assert result["pu30_signal"]["fibonacci_levels"]
    assert "mtf_decision" not in result


def test_lab_routes_are_separate_and_validate_symbols(monkeypatch):
    from api.index import app
    from python_bot import mtf_lab_api
    calls = []
    monkeypatch.setattr(mtf_lab_api, "scan_universe_mtf_lab", lambda symbols: calls.append(symbols) or {"status": "success", "rows": []})
    client = TestClient(app)
    response = client.get("/api/py/api/mtf-lab?symbols=ISCTR")
    assert response.status_code == 200 and calls == [["ISCTR"]]
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/py/api/mtf-lab?symbols=ISCTR;DROP").status_code == 400
    assert client.get("/api/py/api/scan/rsi-pu30?interval=15m").status_code == 400


def test_classic_api_starts_when_lab_calculation_module_cannot_import():
    code = '''
import builtins
original = builtins.__import__
def guarded(name, *args, **kwargs):
    if name.endswith("pu30_mtf"):
        raise ImportError("lab intentionally unavailable")
    return original(name, *args, **kwargs)
builtins.__import__ = guarded
from api.index import app
from fastapi.testclient import TestClient
assert TestClient(app).get("/api/py/api/health").status_code == 200
'''
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
