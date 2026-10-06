# -*- coding: utf-8 -*-
"""rsi_divergence_screener.py: strict pairs are PU30, flexible pairs are listed
separately and never carry the PU30 label. Network-free (fetch is patched)."""
import numpy as np
import pandas as pd
import pytest

import rsi_divergence_screener as screener
from python_bot.engine.data.provider import DataResult, DataStatus
from python_bot.engine.signals import rsi_pu30 as engine


@pytest.fixture
def patched_fetch(monkeypatch):
    bars = pd.DataFrame({
        "date": pd.date_range("2025-01-06 10:00", periods=45, freq="h", tz="Europe/Istanbul"),
        "open": np.full(45, 100.0), "close": np.full(45, 100.0),
        "high": np.full(45, 110.0), "low": np.full(45, 99.0),
        "volume": np.full(45, 1000.0), "is_closed": True,
    })
    bars.loc[20, "low"] = 90.0
    bars.loc[40, "low"] = 89.0

    def fetch(symbol, interval="4h", **kwargs):
        return bars, DataResult(symbol=symbol, interval=interval, df=bars,
                               status=DataStatus.FRESH, last_bar_time=str(bars.date.iloc[-1]))

    monkeypatch.setattr(engine, "_fetch_adjusted_bars", fetch)
    monkeypatch.setattr(screener, "_fetch_adjusted_bars", fetch)
    return monkeypatch


def _rsi(monkeypatch, first, second):
    monkeypatch.setattr(engine, "_dip_rsi", lambda rsi, p, lb, rb: {20: first, 40: second}[p])


def test_strict_pair_reported_once_as_pu30(patched_fetch):
    _rsi(patched_fetch, 24.8, 33.4)
    report = screener.main(["FIX", "--interval", "1h", "--type", "pu30", "--esnek", "--json"])
    kinds = [r["tur"] for r in report["signals"]]
    assert kinds == ["PU30"], "strict pair must not be duplicated as PU_ESNEK"


def test_flexible_pair_never_labelled_pu30(patched_fetch):
    _rsi(patched_fetch, 32.9, 33.4)  # TOASO 4h case from 6 Oct
    report = screener.main(["FIX", "--interval", "1h", "--type", "pu30", "--esnek", "--json"])
    assert [r["tur"] for r in report["signals"]] == ["PU_ESNEK"]
    assert "PU30/NU70 değildir" in report["signals"][0]["sinif"]
    without_flag = screener.main(["FIX", "--interval", "1h", "--type", "pu30", "--json"])
    assert without_flag["signals"] == []
