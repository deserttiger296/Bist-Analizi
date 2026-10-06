# -*- coding: utf-8 -*-
"""
Saatlik güven kıran dip / güven tazeleyen tepe (Semih Hoca'nın ASELS 1s grafiği):
zirve 450 -> zirveyi geçemeyen tepe 439,50 -> aradaki dip 423,25; 423 altında
saatlik kapanış = sat. PU30 için ayna kural. Network-free.
"""
import numpy as np
import pandas as pd

from python_bot.engine.signals.rsi_pu30 import apply_hourly_trust_level, hourly_trust_level

#               ... rise ...                         zirve  decline to 423.25          lower high 439.5      break
NU_HIGHS = [400, 405, 410, 415, 420, 425, 430, 434, 437, 440, 450, 445, 440, 435, 430, 428, 430, 434, 437, 439.5, 436, 432, 428, 425]
NU_LOWS  = [h - 5 for h in NU_HIGHS]
NU_LOWS[10] = 440.0
NU_LOWS[15] = 423.25
ZIRVE = 10


def _frame(highs, lows, closes=None):
    n = len(highs)
    highs, lows = np.array(highs, dtype=float), np.array(lows, dtype=float)
    closes = (highs + lows) / 2 if closes is None else np.array(closes, dtype=float)
    return pd.DataFrame({
        "date": pd.date_range("2026-09-01 10:00", periods=n, freq="h", tz="Europe/Istanbul"),
        "open": closes, "high": highs, "low": lows, "close": closes,
        "volume": 1000.0, "is_closed": True,
    })


def _nu(n=None, **override):
    highs, lows = list(NU_HIGHS), list(NU_LOWS)
    for i, v in override.items():
        highs[int(i[1:])] = v
    return _frame(highs[:n], lows[:n])


def test_asels_example_level_and_break():
    df = _nu()
    lvl = hourly_trust_level(df, df["date"].iloc[ZIRVE], "1h", bull=False)
    assert lvl["zirve"]["price"] == 450.0
    assert lvl["yapi_pivotu"]["price"] == 439.5  # zirveyi geçemeyen tepe
    assert lvl["price"] == 423.25                # güven kıran dip
    assert lvl["durum"] == "kirildi" and lvl["kirildi"] is True
    assert lvl["kirilim_date"] == df["date"].iloc[23].isoformat()  # first close below 423.25


def test_level_formed_but_not_broken_yet():
    df = _nu(n=23)  # lower high confirmed, no close below 423.25 yet
    lvl = hourly_trust_level(df, df["date"].iloc[ZIRVE], "1h", bull=False)
    assert lvl["price"] == 423.25 and lvl["durum"] == "bekleniyor_kirilim" and lvl["kirildi"] is False


def test_waiting_for_lower_high():
    df = _nu(n=19)  # still rising towards the would-be lower high
    lvl = hourly_trust_level(df, df["date"].iloc[ZIRVE], "1h", bull=False)
    assert lvl["price"] is None and lvl["durum"] == "bekleniyor_yapi"


def test_zirve_exceeded_invalidates_structure():
    df = _nu(h19=455.0)  # the next hourly peak exceeds the 450 zirve
    lvl = hourly_trust_level(df, df["date"].iloc[ZIRVE], "1h", bull=False)
    assert lvl["price"] is None and lvl["durum"] == "gecersiz"


def test_pu_mirror_rule():
    highs = [1000 - l for l in NU_LOWS]
    lows = [1000 - h for h in NU_HIGHS]
    df = _frame(highs, lows)
    lvl = hourly_trust_level(df, df["date"].iloc[ZIRVE], "1h", bull=True)
    assert lvl["dip"]["price"] == 550.0
    assert lvl["yapi_pivotu"]["price"] == 560.5   # dibi kıramayan dip
    assert lvl["price"] == 576.75                 # güven tazeleyen tepe
    assert lvl["durum"] == "kirildi"


def test_apply_replaces_trigger_level_and_keeps_between_extreme():
    df = _nu(n=19)
    sig = {"type": "NU70", "tepe2": {"index": ZIRVE}, "guven_kiran_dip": {"price": 390.0}, "tetiklendi": True}
    apply_hourly_trust_level(sig, df, df, "1h")
    assert sig["ara_bolge_dip"] == {"price": 390.0}
    assert sig["guven_kiran_dip"] is None, "no hourly structure yet: never fall back to the between-peak low"
    assert sig["tetiklendi"] is False
    assert sig["saatlik_seviye"]["durum"] == "bekleniyor_yapi"
