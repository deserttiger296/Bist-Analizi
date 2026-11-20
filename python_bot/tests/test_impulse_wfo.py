# -*- coding: utf-8 -*-
"""Birim testleri: İzole Çift Yönlü İtki (1-2-3 & %361.8), Fib Zaman ve Sıfır Sızıntılı WFO."""
import math
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from python_bot.engine.signals.impulse_wfo import (
    _aggregate_wfo_trades,
    _project_future_bist_timestamp,
    _simulate_single_entry,
    analyze_bidirectional_impulse,
)


def _make_ohlcv(closes: np.ndarray, highs=None, lows=None, interval: str = "1h") -> pd.DataFrame:
    n = len(closes)
    freq = "D" if interval == "1d" else ("15min" if interval == "15m" else "h")
    hi = np.asarray(highs if highs is not None else closes + 0.5, dtype=np.float64)
    lo = np.asarray(lows if lows is not None else closes - 0.5, dtype=np.float64)
    op = np.roll(closes, 1)
    op[0] = closes[0]
    return pd.DataFrame({
        "date": pd.date_range("2026-10-01 10:00", periods=n, freq=freq, tz="Europe/Istanbul"),
        "open": op,
        "high": np.maximum(hi, np.maximum(op, closes)),
        "low": np.minimum(lo, np.minimum(op, closes)),
        "close": closes.astype(np.float64),
        "volume": np.concatenate([np.full(max(1, n // 2), 1000.0), np.full(n - max(1, n // 2), 2000.0)]),
        "is_closed": np.ones(n, dtype=bool),
    })


def test_bull_impulse_skips_shallow_noise_and_computes_linear_log_361():
    """<0.236 sığ duraklamayı atlar, %50 geri çekilmeli ideal 1-2'yi A+ seçer ve %361.8 lineer+log hesaplar."""
    # 0..19: hazırlık; t0=20 (p0=100.0); 21..27: dalga 1 (24'te sığ %10 duraklama, 27'de tepe 120.0);
    # 28..33: dalga 2 (31'de dip 110.0 = %50 geri çekilme); 34..49: dalga 3 ralli (185'e kadar, %361.8 üstü)
    closes = np.array([
        118, 117, 116, 115, 114, 113, 112, 111, 110, 109,
        108, 107, 106, 105, 104, 103, 102, 101.5, 101, 100.8,
        100.5,  # idx 20 -> t0 (low=100.0)
        104, 108, 111, 110.2, 113, 116, 119.5,  # idx 27 -> t1 (high=120.0)
        117, 115, 113, 110.5, 112, 114,  # idx 31 -> t2 (low=110.0, retrace=0.50)
        118, 123, 130, 138, 148, 158, 168, 178, 185, 182,
        180, 179, 181, 183, 184, 185,
    ], dtype=np.float64)
    highs = closes + 0.5
    lows = closes - 0.5
    lows[20] = 100.0
    highs[27] = 120.0
    lows[31] = 110.0
    highs[42] = 186.0

    df = _make_ohlcv(closes, highs=highs, lows=lows, interval="1h")
    sig = {"dip2": {"index": 20}, "saatlik_seviye": {"price": 120.0}}

    imp = analyze_bidirectional_impulse(df, sig, direction="BULL", interval="1h")
    assert imp["durum"] == "1_2_yapisi_hazir"
    assert imp["direction"] == "BULL"
    assert imp["dalga1"]["p1_price"] == 120.0
    assert imp["dalga2"]["p2_price"] == 110.0
    assert imp["dalga2"]["price_retracement_fib"] == 0.5
    assert imp["ideal_retrace"] is True
    assert imp["gvt_gkd_aligned"] is True
    assert imp["quality_grade"] == "A+"

    t361 = imp["fib_fiyat_hedefleri"]["3.618"]
    assert t361["target_from_w2"] == round(110.0 + 3.618 * 20.0, 2)  # 182.36
    assert t361["target_from_w0"] == round(100.0 + 3.618 * 20.0, 2)  # 172.36
    assert t361["target_log"] == round(110.0 * ((120.0 / 100.0) ** 3.618), 2)
    assert t361["reached"] is True
    assert imp["dalga3_takip"]["hedef_361_goruldu"] is True
    assert set(imp["points"].keys()) == {"p0", "p1", "p2"}
    assert "3.618" in imp["fib_zaman_w1_referans"]
    assert "3.618" in imp["fib_zaman_02_sundurme"]


def test_bear_impulse_and_p0_break_invalidation():
    """NU70 sonrası aşağı 1-2-3 düşüş itkisini doğru hesaplar; P0 aşılırsa geçersiz kılar."""
    closes = np.array([
        82, 83, 84, 85, 86, 87, 88, 89, 90, 91,
        92, 93, 94, 95, 96, 97, 98, 98.5, 99, 99.2,
        99.5,  # idx 20 -> t0 (high=100.0)
        96, 93, 90, 88, 85, 83, 80.5,  # idx 27 -> t1 (low=80.0)
        83, 85, 88, 89.5, 87, 84,  # idx 31 -> t2 (high=90.0, retrace=0.50)
        79, 75, 70, 65, 58, 50, 42, 35, 25, 16,
        17, 18, 19, 20, 21, 22,
    ], dtype=np.float64)
    highs = closes + 0.5
    lows = closes - 0.5
    highs[20] = 100.0
    lows[27] = 80.0
    highs[31] = 90.0
    lows[43] = 15.0

    df = _make_ohlcv(closes, highs=highs, lows=lows, interval="4h")
    sig = {"tepe2": {"index": 20}, "saatlik_seviye": {"price": 80.2}}
    imp = analyze_bidirectional_impulse(df, sig, direction="BEAR", interval="4h")
    assert imp["durum"] == "1_2_yapisi_hazir"
    assert imp["direction"] == "BEAR"
    assert imp["dalga1"]["p1_price"] == 80.0
    assert imp["dalga2"]["p2_price"] == 90.0
    assert imp["fib_fiyat_hedefleri"]["3.618"]["target_from_w2"] == round(90.0 - 3.618 * 20.0, 2)  # 17.64
    assert imp["fib_fiyat_hedefleri"]["3.618"]["reached"] is True

    # P0 kırılım testi: idx 29'da high=102.0 > 100.0
    highs_broken = highs.copy()
    highs_broken[29] = 102.0
    df_broken = _make_ohlcv(closes, highs=highs_broken, lows=lows, interval="4h")
    imp_broken = analyze_bidirectional_impulse(df_broken, sig, direction="BEAR", interval="4h")
    assert imp_broken["durum"] == "tepe_kirildi_gecersiz"


def test_future_bist_timestamp_skips_weekends():
    """Gelecek Fib Zaman projeksiyonu hafta sonunu atlayıp geçerli BIST iş gününe düşer."""
    friday_close = pd.Timestamp("2026-11-20 17:00:00")
    epoch_1d, date_1d = _project_future_bist_timestamp(friday_close, 1, "1d")
    assert date_1d == "2026-11-23"  # Pazartesi
    assert epoch_1d > 0

    epoch_4h, date_4h = _project_future_bist_timestamp(pd.Timestamp("2026-11-20 14:30:00"), 1, "4h")
    assert date_4h == "2026-11-23 10:00"
    assert epoch_4h > 0


def test_wfo_simulation_is_conservative_and_deducts_bist_cost():
    """Aynı barda hem stop hem hedef temas ederse stop önceliklidir ve Net EV %0.25 maliyeti düşer."""
    highs = np.array([100, 102, 104, 130, 135], dtype=np.float64)
    lows = np.array([98, 99, 100, 95, 120], dtype=np.float64)  # idx 3: low=95 <= stop=96 AND high=130 >= tp161=120
    closes = np.array([99, 101, 103, 125, 132], dtype=np.float64)
    targets = {"1.000": 112.0, "1.618": 120.0, "2.618": 135.0, "3.618": 150.0}

    sim_stop = _simulate_single_entry(
        highs, lows, closes, entry_idx=2, stop_price=96.0, targets=targets,
        direction="BULL", t2_idx=0, mod_a_indices=[3], mod_b_indices=[4], max_horizon=10,
    )
    assert sim_stop is not None
    assert sim_stop["outcome"] == "STOP_P0"
    assert sim_stop["hit_161"] is False

    # Temiz kazanç senaryosu
    lows_win = np.array([98, 99, 100, 101, 118], dtype=np.float64)
    sim_win = _simulate_single_entry(
        highs, lows_win, closes, entry_idx=2, stop_price=96.0, targets=targets,
        direction="BULL", t2_idx=0, mod_a_indices=[4], mod_b_indices=[5], max_horizon=10,
    )
    assert sim_win is not None
    assert sim_win["outcome"] == "WIN_161"
    assert sim_win["hit_161"] is True
    assert sim_win["fib_time_hit_a"] is True

    agg = _aggregate_wfo_trades([sim_stop, sim_win], roundtrip_cost_pct=0.25)
    assert agg["count"] == 2
    assert agg["hit_161_pct"] == 50.0
    assert math.isclose(agg["net_ev_pct"], round(agg["gross_ev_pct"] - 0.25, 2), abs_tol=0.02)


def test_impulse_lab_api_routes_validate_and_stay_isolated(monkeypatch):
    """/api/py/api/impulse-lab uçları geçersiz parametreleri 400 ile reddeder ve no-store döner."""
    from api.index import app
    from python_bot.engine.signals import impulse_wfo as mod

    monkeypatch.setattr(
        mod,
        "get_symbol_impulse_overlay",
        lambda symbol, interval="1h", direction="auto", scale="linear": {
            "status": "success",
            "symbol": symbol,
            "interval": interval,
            "scale": scale,
            "impulse": None,
            "bull_impulse": None,
            "bear_impulse": None,
        },
    )

    client = TestClient(app)
    ok = client.get("/api/py/api/impulse-lab/chart/ASELS?interval=15m&scale=log")
    assert ok.status_code == 200
    assert ok.headers["cache-control"] == "no-store"
    assert ok.json()["symbol"] == "ASELS"
    assert client.get("/api/py/api/impulse-lab/chart/ASELS;DROP").status_code == 400
    assert client.get("/api/py/api/impulse-lab/scan?interval=5m").status_code == 400
