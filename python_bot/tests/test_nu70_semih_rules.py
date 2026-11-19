# -*- coding: utf-8 -*-
"""Regresyon testleri: Semih Hoca NU70 yüksek-fiyat/RSI<70, Asılan Adam, invalidation ve güncel BIST30/100 evreni."""
import numpy as np
import pandas as pd
import pytest

from python_bot.engine.data.provider import DataResult, DataStatus
from python_bot.engine.signals import long_short_matrix as matrix_mod
from python_bot.engine.signals import rsi_pu30 as engine
from python_bot.engine.signals.nu70_confirmation import (
    classify_peak_candle,
    detect_early_highest_nu70_candidate,
    evaluate_peak_candles,
)
from python_bot.engine.universe import BIST30_SYMBOLS, BIST50_SYMBOLS, BIST100_SYMBOLS


def _peak_df(n: int = 55) -> pd.DataFrame:
    return pd.DataFrame({
        "date": pd.date_range("2026-10-01 10:00", periods=n, freq="h", tz="Europe/Istanbul"),
        "open": np.full(n, 99.0),
        "high": np.full(n, 100.0),
        "low": np.full(n, 95.0),
        "close": np.full(n, 99.0),
        "volume": np.full(n, 1000.0),
        "is_closed": np.ones(n, dtype=bool),
    })


def test_classify_peak_candle_hanging_man_and_shooting_star():
    # Asılan Adam: yüksekte küçük gövde, uzun alt fitil (>= 2x gövde, >= %50 aralık), küçük üst fitil
    hm = classify_peak_candle(open_p=109.5, high_p=110.0, low_p=100.0, close_p=109.0)
    assert hm["pattern"] == "ASILAN_ADAM"
    assert hm["is_hanging_man"] is True
    assert hm["is_shooting_star"] is False
    assert hm["is_reversal_top"] is True

    # Kayan Yıldız: düşükte küçük gövde, uzun üst fitil
    ss = classify_peak_candle(open_p=100.5, high_p=110.0, low_p=100.0, close_p=101.0)
    assert ss["pattern"] == "KAYAN_YILDIZ"
    assert ss["is_shooting_star"] is True
    assert ss["is_hanging_man"] is False

    # Sınır ve geçersiz OHLC koruması
    assert classify_peak_candle(100.0, 100.0, 100.0, 100.0)["pattern"] == "NONE"
    assert classify_peak_candle(float("nan"), 102.0, 99.0, 100.0)["pattern"] == "NONE"
    assert classify_peak_candle(100.0, 99.0, 95.0, 101.0)["pattern"] == "NONE"


def test_evaluate_peak_candles_zero_lookahead():
    n = 10
    opens = np.full(n, 100.0)
    highs = np.full(n, 101.0)
    lows = np.full(n, 99.0)
    closes = np.full(n, 100.0)
    rsi = np.full(n, 65.0)
    # p=5 normal, p+1=6 Asılan Adam
    opens[6], highs[6], lows[6], closes[6] = 109.5, 110.0, 100.0, 109.0

    # confirm_index=5 iken p+1 görülmemeli
    at_peak = evaluate_peak_candles(opens, highs, lows, closes, rsi, peak_index=5, confirm_index=5)
    assert at_peak["is_hanging_man"] is False

    # confirm_index=7 iken p+1 kapalı kabul edilip Asılan Adam seçilmeli
    confirmed = evaluate_peak_candles(opens, highs, lows, closes, rsi, peak_index=5, confirm_index=7)
    assert confirmed["is_hanging_man"] is True
    assert confirmed["bar_index"] == 6
    assert confirmed["bar_role"] == "confirm_next"


def test_nu70_rejects_isctr_style_prior_same_high_over_70(monkeypatch):
    """
    ISCTR 1h senaryosu: Tepe 2 fiyatı (115.0) ara bölgede daha önce RSI >= 70 ile
    görülmüşse, sonradan aynı fiyata düşük RSI ile vurmak 'görülen en yüksek fiyatta RSI<70'
    sayılmaz.
    """
    df = _peak_df(60)
    df.loc[15, "high"] = 110.0
    # Ara bölgede 115.0 seviyesi RSI=74.1 ile görülmüş (pivot değil: sağında aynı yüksekliğe yakın bar)
    df.loc[30, "high"] = 115.0
    df.loc[31, "high"] = 115.05  # p=30 sağdan pivot olmaktan çıkar ama ara bölgede RSI>=70 taşır
    # Sonra p=45 aynı 115.0'a RSI=64.1 ile tekrar vuruyor
    df.loc[45, "high"] = 115.0

    fake_rsi = np.full(len(df), 55.0)
    fake_rsi[15] = 80.0
    fake_rsi[30] = 74.1
    fake_rsi[31] = 73.5
    fake_rsi[45] = 64.1
    monkeypatch.setattr(engine, "wilder_rsi", lambda closes, length: fake_rsi)

    assert engine.detect_rsi_nu70(df, interval="1h") is None


def test_nu70_invalidates_after_higher_high_break_and_prefix_replay(monkeypatch):
    """
    BIMAS 1h senaryosu: Teyit anında geçerli olan NU70 (tepe2=112), sonradan kapalı bir
    bar tepe2'nin üzerine (116) çıktığında pasifleşmelidir (prefix sızıntısız).
    """
    df = _peak_df(55)
    df.loc[15, "high"] = 110.0
    df.loc[35, "high"] = 112.0
    # Asılan adam mumu tepe2 üzerinde
    df.loc[35, "open"] = 111.7
    df.loc[35, "low"] = 105.0
    df.loc[35, "close"] = 111.5

    fake_rsi = np.full(len(df), 55.0)
    fake_rsi[15] = 78.0
    fake_rsi[35] = 63.0
    monkeypatch.setattr(engine, "wilder_rsi", lambda closes, length: fake_rsi)

    # Prefix teyit sonrası (bar 39'a kadar): geçerli + Asılan Adam etiketli
    sig_prefix = engine.detect_rsi_nu70(df.iloc[:40].copy(), interval="1h")
    assert sig_prefix is not None
    assert sig_prefix["tepe2"]["price"] == pytest.approx(112.0)
    assert sig_prefix["tepe2"]["rsi_source"] == "peak_bar"
    assert sig_prefix["is_hanging_man"] is True

    # Sonradan bar 45 RSI>=70 ile tepe2'yi aşarsa (BIMAS 404@78.5 senaryosu) aktif sinyal düşer
    df_broken = df.copy()
    df_broken.loc[45, "high"] = 116.0
    fake_rsi_broken = fake_rsi.copy()
    fake_rsi_broken[45] = 75.0
    monkeypatch.setattr(engine, "wilder_rsi", lambda closes, length: fake_rsi_broken)
    assert engine.detect_rsi_nu70(df_broken, interval="1h", ignore_lifetime=True) is None
    sig_kept = engine.detect_rsi_nu70(df_broken, interval="1h", ignore_lifetime=True, include_invalidated=True)
    assert sig_kept is not None and sig_kept["invalidated"] is True
    assert sig_kept["invalidation_reason"] == "HIGHER_HIGH_BROKEN"

    # Eğer bar 45 tepe2'yi RSI<70 ile aşarsa (THYAO 329.75@69.6 senaryosu) eski tepe düşüp yeni tepe2 seçilir
    df.loc[45, "high"] = 116.0
    monkeypatch.setattr(engine, "wilder_rsi", lambda closes, length: fake_rsi)
    sig_shifted = engine.detect_rsi_nu70(df, interval="1h", ignore_lifetime=True)
    assert sig_shifted is not None and sig_shifted["tepe2"]["price"] == pytest.approx(116.0)


def test_early_highest_nu70_candidate_catches_hanging_man_small_pullback():
    """
    CCOLA / EGEEN / YEOTK benzeri: %3 altı geri çekilme veya kısa aralık nedeniyle strict
    NU70'in atladığı, görülen en yüksek fiyatta RSI<70 ve Asılan Adam adayını yakalar.
    """
    df = _peak_df(40)
    df.loc[20, "high"] = 110.0
    df.loc[23, "low"] = 98.0  # %2.0 civarı değil, 110->107.8 %2.0 geri çekilme simülasyonu
    df.loc[21:25, "high"] = 108.5
    df.loc[22, "low"] = 107.8
    df.loc[26, "high"] = 111.5
    df.loc[26, "open"] = 111.2
    df.loc[26, "low"] = 106.0
    df.loc[26, "close"] = 111.0  # Asılan Adam

    rsi = np.full(len(df), 55.0)
    rsi[20] = 79.0
    rsi[26] = 64.5

    cand = detect_early_highest_nu70_candidate(df, rsi, interval="4h")
    assert cand is not None
    assert cand["type"] == "NU70_ADAY"
    assert cand["is_strict"] is False
    assert cand["candidate_kind"] == "ASILAN_ADAM_TEPE"
    assert cand["tepe2"]["rsi"] == pytest.approx(64.5)
    assert cand["peak_candle"]["is_hanging_man"] is True


def test_long_short_matrix_gkd_reclaim_not_triggered_and_rounded(monkeypatch):
    """THYAO 321.5 > GKD 316.75 örneği: fiyat GKD üzerine döndüyse triggered=False olmalı."""
    fake_sig = {
        "symbol": "THYAO",
        "type": "NU70",
        "confluence": "SCALP_BEAR",
        "last_close": 321.50000123,
        "tepe1": {"price": 304.75, "rsi": 90.9},
        "tepe2": {"price": 325.75, "rsi": 59.1, "rsi_at_peak": 59.1},
        "peak_candle": {"pattern": "ASILAN_ADAM", "label_tr": "Asılan Adam", "is_hanging_man": True, "is_shooting_star": False},
        "saatlik_seviye": {
            "price": 316.75,
            "durum": "kirildi",
            "kirildi": True,
            "alt_periyot": "15dk",
            "fiyat_seviyenin": "ustunde",
        },
        "knowable_at": "2026-11-12T18:30:00+03:00",
    }
    monkeypatch.setattr(
        matrix_mod,
        "scan_universe_rsi_pu30",
        lambda *a, **k: {"signals": [fake_sig], "errors": []},
    )
    monkeypatch.setattr(
        matrix_mod,
        "_fetch_adjusted_bars",
        lambda *a, **k: (None, DataResult(symbol="THYAO", interval="1h", df=None, status=DataStatus.ERROR)),
    )

    res = matrix_mod.build_long_short_matrix(symbols=["THYAO"], intervals=("1h",), max_workers=1)
    assert len(res["shorts"]) == 1
    card = res["shorts"][0]
    assert card["triggered"] is False
    assert card["action"] == "SHORT_PUSD"
    assert "Üzerine Döndü" in card["status_text"]
    assert card["last_close"] == 321.5
    assert card["is_hanging_man"] is True
    assert res["short_active_count"] == 0


def test_updated_kap_bist30_bist100_and_no_delisted_tickers():
    assert len(BIST30_SYMBOLS) == 30
    assert len(BIST50_SYMBOLS) == 50
    assert len(BIST100_SYMBOLS) == 100
    assert len(set(BIST100_SYMBOLS)) == 100
    assert set(BIST30_SYMBOLS) <= set(BIST50_SYMBOLS) <= set(BIST100_SYMBOLS)

    for old_sym in ("KOZAL", "KOZAA", "IPEKE", "CWCME"):
        assert old_sym not in BIST100_SYMBOLS
        assert old_sym not in matrix_mod.VIOP_SYMBOLS

    for new_sym in ("TRALT", "TRMET", "TRENJ", "CWENE"):
        assert new_sym in BIST100_SYMBOLS
    assert "TRALT" in BIST30_SYMBOLS
    assert "TRMET" in BIST30_SYMBOLS
    assert "TRALT" in matrix_mod.VIOP_SYMBOLS
    assert "TRMET" in matrix_mod.VIOP_SYMBOLS


def test_early_nu70_rejects_nan_in_intermediate_bars_and_matrix_reports_errors(monkeypatch):
    """Ara dipte/tepede NaN varsa sahte aday üretilmez; tarama hatası scan_errors'a yazılır."""
    df = _peak_df(40)
    df.loc[20, "high"] = 110.0
    df.loc[22, "low"] = float("nan")
    df.loc[26, "high"] = 111.5
    df.loc[26, "open"] = 111.2
    df.loc[26, "low"] = 106.0
    df.loc[26, "close"] = 111.0

    rsi = np.full(len(df), 55.0)
    rsi[20] = 79.0
    rsi[26] = 64.5
    assert detect_early_highest_nu70_candidate(df, rsi, interval="4h") is None

    monkeypatch.setattr(
        matrix_mod,
        "scan_universe_rsi_pu30",
        lambda *a, **k: {"signals": [], "errors": []},
    )

    def _raising_fetch(sym_name: str, interval: str = "1h"):
        raise RuntimeError(f"boom-{sym_name}")

    monkeypatch.setattr(matrix_mod, "_fetch_adjusted_bars", _raising_fetch)
    res = matrix_mod.build_long_short_matrix(symbols=["THYAO"], intervals=("1h",), max_workers=1)
    assert res["scan_error_count"] == 1
    assert res["scan_errors"][0]["symbol"] == "THYAO"
    assert res["scan_errors"][0]["interval"] == "1h"
    assert "RuntimeError: boom-THYAO" in res["scan_errors"][0]["error"]


def test_nu70lab_endpoint_separates_strict_early_and_invalidated(monkeypatch):
    """mode=nu70lab sıkı NU70, erken NU70_ADAY ve HIGHER_HIGH_BROKEN listelerini ayrı döndürür."""
    from python_bot import signal_api

    df_thyao = _peak_df(40)
    df_thyao["close"] = 320.0
    df_ccola = _peak_df(40)
    df_ccola["close"] = 80.0
    df_bimas = _peak_df(40)
    df_bimas["close"] = 402.0

    frames = {"THYAO": df_thyao, "CCOLA": df_ccola, "BIMAS": df_bimas}

    monkeypatch.setattr(matrix_mod, "get_default_provider", lambda: object())
    monkeypatch.setattr(
        matrix_mod,
        "_fetch_adjusted_bars",
        lambda sym, interval="1h": (
            frames[sym].copy(),
            DataResult(symbol=sym, interval=interval, df=frames[sym].copy(), status=DataStatus.FRESH),
        ),
    )

    def _fake_nu70(df, cfg=None, ignore_lifetime=False, interval="1h", include_invalidated=False):
        if interval == "4h":
            return None
        px = round(float(df["close"].iloc[-1]), 1)
        if px == 320.0:
            return {
                "type": "NU70",
                "tepe1": {"price": 310.0, "rsi": 78.0, "date": "2026-11-10 10:00"},
                "tepe2": {"price": 325.0, "rsi": 64.0, "rsi_at_peak": 64.0, "rsi_source": "peak_bar", "date": "2026-11-12 14:00"},
                "peak_candle": {"pattern": "ASILAN_ADAM", "label_tr": "Asılan Adam", "is_hanging_man": True, "is_shooting_star": False, "has_any_top_candle": True},
                "invalidated": False,
                "invalidation_reason": None,
                "confirm_date": "2026-11-12 16:00",
                "pullback_pct": 4.2,
                "gap_bars": 12,
                "bars_since_confirm": 2,
            }
        if px == 402.0 and include_invalidated:
            return {
                "type": "NU70",
                "tepe1": {"price": 380.0, "rsi": 75.0, "date": "2026-11-08 10:00"},
                "tepe2": {"price": 393.0, "rsi": 65.0, "date": "2026-11-11 14:00"},
                "peak_candle": {"pattern": "NONE", "label_tr": "Yok", "is_hanging_man": False, "is_shooting_star": False},
                "invalidated": True,
                "invalidation_reason": "HIGHER_HIGH_BROKEN",
                "confirm_date": "2026-11-11 16:00",
            }
        return None

    def _fake_trust(sig, df, sub_df, interval):
        sig["saatlik_seviye"] = {
            "price": 322.5,
            "durum": "kirildi",
            "kirildi": True,
            "alt_periyot": "15dk",
            "fiyat_seviyenin": "altinda",
        }

    def _fake_early(df, rsi_arr, interval="1h"):
        px = round(float(df["close"].iloc[-1]), 1)
        if px == 80.0:
            return {
                "type": "NU70_ADAY",
                "candidate_kind": "ASILAN_ADAM_TEPE",
                "last_close": 80.0,
                "tepe1": {"price": 78.5, "rsi": 74.0},
                "tepe2": {"price": 81.0, "rsi": 62.5, "rsi_at_peak": 62.5},
                "peak_candle": {"pattern": "ASILAN_ADAM", "label_tr": "Asılan Adam", "is_hanging_man": True, "is_shooting_star": False},
                "guven_kiran_dip": {"price": 79.2, "kirildi": False},
                "pullback_pct": 2.1,
                "gap_bars": 5,
                "confirm_date": "2026-11-18 11:00",
            }
        return None

    monkeypatch.setattr(matrix_mod, "detect_rsi_nu70", _fake_nu70)
    monkeypatch.setattr(matrix_mod, "apply_hourly_trust_level", _fake_trust)
    monkeypatch.setattr(matrix_mod, "detect_early_highest_nu70_candidate", _fake_early)

    res = signal_api.run_lab_suite(mode="nu70lab", symbols="THYAO,CCOLA,BIMAS", interval="1h")
    assert res["status"] == "success"
    assert res["mode"] == "nu70lab"
    assert res["total_scanned"] == 3
    assert [x["symbol"] for x in res["strict_signals"]] == ["THYAO"]
    strict_thyao = res["strict_signals"][0]
    assert strict_thyao["is_hanging_man"] is True
    assert strict_thyao["triggered"] is True
    assert strict_thyao["target_1r"] < strict_thyao["last_close"]
    assert strict_thyao["fractal_phase_code"] == "SALINIM_SONRA_YENI_ZIRVE"
    assert "1 ZİRVE DAHA" in strict_thyao["fractal_profit_plan"]
    assert [x["symbol"] for x in res["early_candidates"]] == ["CCOLA"]
    assert [x["symbol"] for x in res["invalidated_signals"]] == ["BIMAS"]
    assert res["invalidated_signals"][0]["invalidation_reason"] == "HIGHER_HIGH_BROKEN"
    assert res["strict_count"] == 1
    assert res["early_count"] == 1
    assert res["invalidated_count"] == 1
    assert res["hanging_man_count"] == 2
    assert res["triggered_count"] == 1


def test_nu70lab_15m_fractal_cascade_and_oversold_dip_watch(monkeypatch):
    """15dk NU70'te 1s kaskad ayrımı (Tuzak vs Gerçek Basış) ve RSI<30 '1 dip daha' izleme listesi."""
    from python_bot import signal_api

    df_thyao = _peak_df(45)
    df_thyao["close"] = 320.0
    df_tuprs = _peak_df(45)
    df_tuprs["close"] = 180.0

    # ASELS 15dk: dalgalı yatay sonrası sert düşüş (RSI < 30) ve tepki (2. dip PU30 henüz yok)
    closes_asels = np.concatenate([
        355.0 + np.array([0.5, -0.4, 0.6, -0.3, 0.7, -0.5, 0.8, -0.4, 0.6, -0.2, 0.9, -0.3, 0.5, -0.4, 0.8, -0.3, 0.6, -0.4, 0.7, -0.2, 0.5, -0.3, 0.4, -0.2, 0.6]),
        np.linspace(354.0, 336.0, 12),
        np.array([337.5, 339.2, 341.0, 342.8, 344.5, 345.2, 344.8, 345.5]),
    ])
    n_asels = len(closes_asels)
    df_asels = pd.DataFrame({
        "date": pd.date_range("2026-11-18 10:00", periods=n_asels, freq="15min", tz="Europe/Istanbul"),
        "open": closes_asels,
        "high": closes_asels + 0.8,
        "low": closes_asels - 0.6,
        "close": closes_asels,
        "volume": np.full(n_asels, 5000.0),
        "is_closed": np.ones(n_asels, dtype=bool),
    })

    frames = {"THYAO": df_thyao, "TUPRS": df_tuprs, "ASELS": df_asels}
    monkeypatch.setattr(matrix_mod, "get_default_provider", lambda: object())
    monkeypatch.setattr(
        matrix_mod,
        "_fetch_adjusted_bars",
        lambda sym, interval="1h": (
            frames[sym].copy(),
            DataResult(symbol=sym, interval=interval, df=frames[sym].copy(), status=DataStatus.FRESH),
        ),
    )

    def _fake_nu70(df, cfg=None, ignore_lifetime=False, interval="1h", include_invalidated=False):
        px = round(float(df["close"].iloc[-1]), 1)
        if px == 320.0 and interval == "15m":
            return {
                "type": "NU70",
                "tepe1": {"price": 318.0, "rsi": 74.0, "date": "2026-11-19 10:00"},
                "tepe2": {"price": 322.0, "rsi": 65.0, "rsi_at_peak": 65.0, "date": "2026-11-19 14:00"},
                "peak_candle": {"pattern": "NONE", "label_tr": "Yok", "is_hanging_man": False, "is_shooting_star": False},
                "invalidated": False,
                "confirm_date": "2026-11-19 14:15",
                "pullback_pct": 3.5,
                "gap_bars": 8,
                "bars_since_confirm": 2,
            }
        if px == 180.0 and interval in ("15m", "1h"):
            return {
                "type": "NU70",
                "tepe1": {"price": 178.0, "rsi": 76.0, "date": "2026-11-19 10:00"},
                "tepe2": {"price": 182.0, "rsi": 63.0, "rsi_at_peak": 63.0, "date": "2026-11-19 15:00"},
                "peak_candle": {"pattern": "ASILAN_ADAM", "label_tr": "Asılan Adam", "is_hanging_man": True, "is_shooting_star": False},
                "invalidated": False,
                "confirm_date": "2026-11-19 15:15",
                "pullback_pct": 3.8,
                "gap_bars": 9,
                "bars_since_confirm": 1,
            }
        return None

    monkeypatch.setattr(matrix_mod, "detect_rsi_nu70", _fake_nu70)
    monkeypatch.setattr(
        matrix_mod,
        "apply_hourly_trust_level",
        lambda sig, df, sub_df, interval: sig.__setitem__(
            "saatlik_seviye", {"price": float(df["close"].iloc[-1]) - 1.0, "durum": "bekleniyor", "alt_periyot": "15dk", "fiyat_seviyenin": "ustunde"}
        ),
    )
    monkeypatch.setattr(matrix_mod, "detect_early_highest_nu70_candidate", lambda *a, **k: None)

    res = signal_api.run_lab_suite(mode="nu70lab", symbols="THYAO,TUPRS,ASELS", interval="15m")
    assert res["status"] == "success"
    assert res["interval"] == "15m"
    strict_map = {x["symbol"]: x for x in res["strict_signals"]}
    assert strict_map["THYAO"]["fractal_phase_code"] == "TUZAK_15DK_YENI_ZIRVE_BEKLENIR"
    assert strict_map["THYAO"]["recommended_tp_price"] == strict_map["THYAO"]["target_1r"]
    assert strict_map["TUPRS"]["fractal_phase_code"] == "KASKAD_15DK_1S_ONAYLI"
    assert strict_map["TUPRS"]["recommended_tp_price"] == strict_map["TUPRS"]["target_tp1"]
    assert res["oversold_watch_count"] >= 1
    ov_asels = next(x for x in res["oversold_dip_watch"] if x["symbol"] == "ASELS")
    assert ov_asels["oversold_rsi"] < 30.0
    assert ov_asels["has_reaction"] is True


def test_symbol_chart_data_enriches_early_nu70_fractal_and_pre_pu30(monkeypatch):
    """get_symbol_chart_data NU70 erken adayını, fraktal planı, pre_pu30'u ve 4-TF özetini döner."""
    closes = np.concatenate([
        355.0 + np.array([0.5, -0.4, 0.6, -0.3, 0.7, -0.5, 0.8, -0.4, 0.6, -0.2, 0.9, -0.3, 0.5, -0.4, 0.8, -0.3, 0.6, -0.4, 0.7, -0.2, 0.5, -0.3, 0.4, -0.2, 0.6]),
        np.linspace(354.0, 336.0, 12),
        np.array([337.5, 339.2, 341.0, 342.8, 344.5, 345.2]),
    ])
    n = len(closes)
    df = pd.DataFrame({
        "date": pd.date_range("2026-11-18 10:00", periods=n, freq="15min", tz="Europe/Istanbul"),
        "open": closes,
        "high": closes + 0.8,
        "low": closes - 0.6,
        "close": closes,
        "volume": np.full(n, 4000.0),
        "is_closed": np.ones(n, dtype=bool),
    })

    monkeypatch.setattr(
        engine,
        "_fetch_adjusted_bars",
        lambda sym, interval="4h", period=None: (
            df.copy(),
            DataResult(symbol=sym, interval=interval, df=df.copy(), status=DataStatus.FRESH),
        ),
    )
    monkeypatch.setattr(engine, "detect_rsi_pu30", lambda *a, **k: None)
    monkeypatch.setattr(engine, "detect_rsi_nu70", lambda *a, **k: None)

    from python_bot.engine.signals import nu70_confirmation as nu_conf

    monkeypatch.setattr(
        nu_conf,
        "detect_early_highest_nu70_candidate",
        lambda df_in, rsi_in, interval="4h": {
            "type": "NU70_ADAY",
            "candidate_kind": "ASILAN_ADAM_TEPE",
            "tepe1": {"index": 5, "price": 355.8, "rsi": 74.2, "date": "2026-11-18 11:15"},
            "tepe2": {"index": 12, "price": 356.0, "rsi": 66.5, "rsi_at_peak": 66.5, "date": "2026-11-18 13:00"},
            "peak_candle": {"pattern": "ASILAN_ADAM", "label_tr": "Asılan Adam", "is_hanging_man": True, "is_shooting_star": False},
            "guven_kiran_dip": {"price": 352.0, "kirildi": True},
            "pullback_pct": 1.8,
            "gap_bars": 7,
            "bars_since_confirm": 4,
            "confirm_date": "2026-11-18 13:15",
            "last_close": 341.0,
        },
    )

    detail = engine.get_symbol_chart_data("ASELS", interval="15m", enrich=True)
    assert detail is not None
    assert detail["nu70_signal"] is not None
    assert detail["nu70_signal"]["is_early_candidate"] is True
    assert detail["nu70_signal"]["is_hanging_man"] is True
    assert detail["nu70_signal"]["target_1r"] is not None
    assert detail["nu70_signal"]["fractal_phase_code"] == "TUZAK_15DK_YENI_ZIRVE_BEKLENIR"
    assert detail["pre_pu30"] is not None
    assert detail["pre_pu30"]["has_oversold_dip1"] is True
    assert sorted(detail["mtf_nu_pu_summary"].keys()) == ["15m", "1d", "1h", "4h"]
