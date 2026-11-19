#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
BIST Agentic AI Karar Motoru (%100 İzole - ReAct & Öz-Denetim Döngüsü)
======================================================================
Çalıştırma:
  bist_agent_core\.venv\Scripts\python bist_agent_core/agentic_engine.py THYAO
  bist_agent_core\.venv\Scripts\python bist_agent_core/agentic_engine.py THYAO EREGL
"""
from __future__ import annotations

import os
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_REPO_ROOT = str(Path(__file__).resolve().parents[1])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from python_bot.engine.shield.expected_value import ExpectedValueFilter
from python_bot.engine.shield.kelly_sizing import KellySizingEngine
from python_bot.engine.shield.risk_var import ValueAtRiskModel

import numpy as np
import pandas as pd
import yfinance as yf
from tabulate import tabulate
import ta

warnings.filterwarnings("ignore")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def fetch_with_retry(
    ticker: str,
    periods: Tuple[str, ...] = ("2y", "1y", "6mo"),
    interval: str = "1d",
    retries: int = 3,
) -> pd.DataFrame:
    """
    Otonom hata toleransı: yfinance bağlantı veya veri hatası verirse
    3 kez yeniden dener, gerekirse alternatif periyotlara (2y -> 1y -> 6mo) geçer.
    """
    for period in periods:
        for attempt in range(1, retries + 1):
            try:
                t = yf.Ticker(ticker)
                df = t.history(period=period, interval=interval, auto_adjust=True, timeout=15)
                if df is not None and not df.empty:
                    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(how="any").copy()
                    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
                    df = df[~df.index.duplicated(keep="last")].sort_index()
                    if len(df) >= 30:
                        return df
            except Exception:
                pass
            time.sleep(0.6 * attempt)
    return pd.DataFrame()


_SEMIH_BEAR = {"DOUBLE_BEAR", "SCALP_BEAR", "MACRO_BEAR", "TRAP_15M_BEAR"}


def fetch_semih_signals(symbols: List[str], intervals: Tuple[str, ...] = ("1h", "1d")) -> Dict[str, Any]:
    """
    Semih Hoca yöntemi (PU30/NU70 RSI uyumsuzluğu + alt periyot GVT/GKD) canlı sinyalleri.
    Dönüş: {"ok": bool, "error": str|None, "by_symbol": {SYM: {"pu": [...], "nu": [...]}}}
    Sessiz hata yok: tarama alınamazsa ok=False ve hata metni döner.
    """
    out: Dict[str, Any] = {"ok": True, "error": None, "by_symbol": {}}
    try:
        from python_bot.engine.signals.rsi_pu30 import scan_universe_rsi_pu30
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "error": f"rsi_pu30 içe aktarılamadı: {exc}", "by_symbol": {}}

    clean = [s.upper().replace(".IS", "").strip() for s in symbols]
    for itv in intervals:
        try:
            res = scan_universe_rsi_pu30(clean, max_workers=4, interval=itv, signal_type="all")
        except Exception as exc:
            out["ok"] = False
            out["error"] = f"{itv} taraması başarısız: {exc}"
            continue
        for sig in res.get("signals", []):
            sym = str(sig.get("symbol", "")).upper()
            bucket = out["by_symbol"].setdefault(sym, {"pu": [], "nu": []})
            item = dict(sig)
            item["_itv"] = itv
            bucket["pu" if sig.get("type") == "PU30" else "nu"].append(item)
    return out


def _semih_assess(sym: str, semih: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Semih sinyallerini karar kapısı için özetler."""
    if semih is None:
        return {"state": "N/A", "text": "Semih sinyali alınmadı (kapı devre dışı)", "bear": False, "bull_confirmed": False}
    if not semih.get("ok") and not semih.get("by_symbol", {}).get(sym):
        return {"state": "ERR", "text": f"Semih taraması alınamadı: {semih.get('error')}", "bear": False, "bull_confirmed": False}
    b = semih.get("by_symbol", {}).get(sym, {"pu": [], "nu": []})
    bear = [s for s in b["nu"] if s.get("confluence") in _SEMIH_BEAR]
    bull_main = [s for s in b["pu"] if s.get("confluence") in ("DOUBLE_BULL", "MACRO_4H")]
    parts: List[str] = []
    for s in bear:
        candle_info = s.get("peak_candle") or {}
        c_tag = f" [{candle_info['label_tr']}]" if candle_info.get("is_reversal_top") else ""
        fractal_tag = (
            " [4S NU Yok -> Önce 1R ara salınım, sonra 4S NU için en az 1 zirve daha, ardından sert satış]"
            if s.get("_itv") == "1h" and s.get("confluence") == "SCALP_BEAR"
            else ""
        )
        parts.append(f"{s['_itv']} NU70 {s.get('confluence')}{c_tag}" + (" (GKD tetiklendi)" if s.get("tetiklendi") else "") + fractal_tag)
    for s in bull_main:
        parts.append(f"{s['_itv']} PU30 {s.get('confluence')}" + (" (GVT tetiklendi)" if s.get("tetiklendi") else " (tetik bekleniyor)"))
    for s in b["pu"]:
        if s not in bull_main:
            parts.append(f"{s['_itv']} PU30 {s.get('confluence')}")
    text = "; ".join(parts) if parts else "Aktif PU30/NU70 sinyali yok"
    bull_confirmed = any(s.get("tetiklendi") or s.get("confluence") == "DOUBLE_BULL" for s in bull_main)
    return {"state": "OK", "text": text, "bear": bool(bear), "bull_confirmed": bull_confirmed}


def analyze_macro_regime() -> Dict[str, Any]:
    """
    1. Makro & Piyasa Rejimi Kontrolü (Ön Koşul):
       XU100.IS (BIST 100 Endeksi) ve USDTRY=X verisini çeker,
       20 ve 50 günlük ortalamalara göre rejimi belirler.
    """
    xu100 = fetch_with_retry("XU100.IS")
    usdtry = fetch_with_retry("USDTRY=X")

    if usdtry.empty:
        current_usdtry = 34.50
    else:
        current_usdtry = float(usdtry["Close"].iloc[-1])

    if xu100.empty or len(xu100) < 50:
        return {
            "xu100_last": None,
            "xu100_sma20": None,
            "xu100_sma50": None,
            "xu100_rsi": None,
            "usdtry_last": round(current_usdtry, 4),
            "regime": "BİLİNMİYOR / TEMKİNLİ",
            "is_risk_on": False,
            "usdtry_series": usdtry["Close"] if not usdtry.empty else pd.Series(dtype=float),
        }

    close = xu100["Close"].astype(np.float64)
    last_val = float(close.iloc[-1])
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1])
    rsi14 = float(ta.momentum.RSIIndicator(close, window=14).rsi().iloc[-1])

    if last_val > sma20 and last_val > sma50:
        regime = "Risk-On / Boğa (Endeks SMA20 ve SMA50 Üzerinde)"
        is_risk_on = True
    elif last_val > sma20 and last_val <= sma50:
        regime = "Nötr / Geçiş (Endeks SMA20 Üzerinde, SMA50 Altında - Seçici Mod)"
        is_risk_on = False
    elif last_val <= sma20 and last_val > sma50:
        regime = "Sarı Alarm / Kısa Vadeli Düzeltme (Endeks SMA20 Altında, SMA50 Üzerinde)"
        is_risk_on = True
    else:
        regime = "Risk-Off / Düzeltme (Endeks SMA20 ve SMA50 Altında - Defansif Mod)"
        is_risk_on = False

    return {
        "xu100_last": round(last_val, 2),
        "xu100_sma20": round(sma20, 2),
        "xu100_sma50": round(sma50, 2),
        "xu100_rsi": round(rsi14, 1),
        "usdtry_last": round(current_usdtry, 4),
        "regime": regime,
        "is_risk_on": is_risk_on,
        "usdtry_series": usdtry["Close"] if not usdtry.empty else pd.Series(dtype=float),
    }


def analyze_symbol(raw_symbol: str, macro: Dict[str, Any], semih: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    2. Çift Katmanlı Fiyatlama (TRY Destek / USD Hedef) ve
    3. Otonom Karar & Puanlama Algoritması (0-100 Agentic Conviction Score)
    """
    sym = raw_symbol.upper().replace(".IS", "").strip()
    yf_sym = f"{sym}.IS"
    df = fetch_with_retry(yf_sym)
    if df.empty or len(df) < 55:
        return {"symbol": sym, "status": "error", "message": f"{yf_sym} için yeterli veri çekilemedi."}

    close = df["Close"].astype(np.float64)
    high = df["High"].astype(np.float64)
    low = df["Low"].astype(np.float64)
    vol = df["Volume"].astype(np.float64)

    last_price = float(close.iloc[-1])

    # --- KATMAN A: TRY SAVUNMA HATTI ---
    ema21 = float(ta.trend.EMAIndicator(close, window=21).ema_indicator().iloc[-1])
    sma50 = float(ta.trend.SMAIndicator(close, window=50).sma_indicator().iloc[-1])
    sma200_series = ta.trend.SMAIndicator(close, window=200).sma_indicator()
    sma200 = float(sma200_series.iloc[-1]) if len(close) >= 200 and not np.isnan(sma200_series.iloc[-1]) else float(close.mean())

    bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
    bb_lower = float(bb.bollinger_lband().iloc[-1])
    bb_upper = float(bb.bollinger_hband().iloc[-1])

    atr14 = float(ta.volatility.AverageTrueRange(high, low, close, window=14).average_true_range().iloc[-1])
    rsi14 = float(ta.momentum.RSIIndicator(close, window=14).rsi().iloc[-1])

    macd_ind = ta.trend.MACD(close, window_slow=26, window_fast=12, window_sign=9)
    macd_val = float(macd_ind.macd().iloc[-1])
    macd_sig = float(macd_ind.macd_signal().iloc[-1])
    macd_hist = float(macd_ind.macd_diff().iloc[-1])
    macd_hist_prev = float(macd_ind.macd_diff().iloc[-2]) if len(close) >= 35 else macd_hist

    # Son 20 günlük (veya son ay) klasik Pivot S1 / S2 / R1
    recent_20 = df.iloc[-21:-1] if len(df) > 21 else df
    p_high = float(recent_20["High"].max())
    p_low = float(recent_20["Low"].min())
    p_close = float(recent_20["Close"].iloc[-1])
    pivot_p = (p_high + p_low + p_close) / 3.0
    pivot_s1 = 2.0 * pivot_p - p_high
    pivot_s2 = pivot_p - (p_high - p_low)
    pivot_r1 = 2.0 * pivot_p - p_low

    # Ana TRY destek ve ATR bazlı dinamik Stop-Loss (Hiyerarşi: Kademe 1 > Kademe 2 > Kademe 3 > Stop-Loss)
    candidate_supports = sorted(
        {round(x, 4) for x in (ema21, sma50, sma200, bb_lower, pivot_s1, pivot_s2) if 0.0 < x < last_price * 0.998},
        reverse=True,
    )
    nearest_support_tl = candidate_supports[0] if candidate_supports else max(0.01, last_price - 1.0 * atr14)
    lower_supports = [
        x for x in candidate_supports
        if x < nearest_support_tl - 0.15 * atr14 and x >= last_price - 2.8 * atr14
    ]
    major_support_tl = lower_supports[0] if lower_supports else max(0.01, nearest_support_tl - 0.8 * atr14)
    atr_stop_tl = max(0.01, min(major_support_tl - 0.5 * atr14, last_price - 2.0 * atr14))

    # Göreceli Hacim (RVOL)
    vol_ma20 = float(vol.iloc[-21:-1].mean()) if len(vol) > 21 else float(vol.mean())
    rvol = float(vol.iloc[-1] / max(vol_ma20, 1.0))

    # --- KATMAN B: USD/TRY TAARRUZ HATTI ---
    usdtry_s: pd.Series = macro["usdtry_series"]
    current_fx = float(macro["usdtry_last"])
    if not usdtry_s.empty:
        aligned_fx = usdtry_s.reindex(df.index).ffill().bfill()
        aligned_fx = aligned_fx.fillna(current_fx)
    else:
        aligned_fx = pd.Series(current_fx, index=df.index)

    usd_close = close / aligned_fx
    usd_high = high / aligned_fx
    usd_low = low / aligned_fx

    current_usd = float(last_price / current_fx)
    usd_ath = float(usd_high.max())
    usd_2y_low = float(usd_low.min())
    usd_sma200 = float(usd_close.rolling(200).mean().iloc[-1]) if len(usd_close) >= 200 else float(usd_close.mean())
    usd_discount_pct = (1.0 - current_usd / max(usd_ath, 1e-6)) * 100.0

    # USD Fibonacci Düzeltme / Taarruz Hedefleri (2Y Dip -> 2Y USD ATH aralığı)
    usd_span = max(usd_ath - usd_2y_low, 0.01)
    fib_usd_levels = {
        "Fib 0.382": usd_2y_low + 0.382 * usd_span,
        "Fib 0.500": usd_2y_low + 0.500 * usd_span,
        "Fib 0.618": usd_2y_low + 0.618 * usd_span,
        "Fib 1.000 (USD ATH)": usd_ath,
    }

    # Güncel fiyatın üzerindeki ilk anlamlı USD Fibo hedefini TP1 olarak seç (en az +%8 uzaktaki)
    upside_targets_usd = [v for v in fib_usd_levels.values() if v > current_usd * 1.06]
    tp1_usd = min(upside_targets_usd) if upside_targets_usd else usd_ath * 1.10
    tp2_usd = max(upside_targets_usd) if upside_targets_usd else usd_ath * 1.25
    tp1_tl = tp1_usd * current_fx
    tp2_tl = tp2_usd * current_fx

    risk_tl = max(last_price - atr_stop_tl, 0.01 * last_price)
    reward_tl = max(tp1_tl - last_price, 0.0)
    rr_ratio = reward_tl / risk_tl

    # --- 3. OTONOM KARAR & PUANLAMA ALGORİTMASI (0-100 SKOR) ---
    score = 0
    score_breakdown: List[str] = []

    # Kriter 1: USD zirvesine uzaklık (İskonto > %25 ise +25p)
    if usd_discount_pct >= 25.0:
        score += 25
        score_breakdown.append(f"+25p: USD Zirvesine göre yüksek iskonto (%{usd_discount_pct:.1f} > %25)")
    elif usd_discount_pct >= 15.0:
        score += 15
        score_breakdown.append(f"+15p: USD Zirvesine göre orta iskonto (%{usd_discount_pct:.1f})")
    else:
        score += 5
        score_breakdown.append(f"+5p: USD Zirvesine yakın fiyatlama (İskonto %{usd_discount_pct:.1f})")

    # Kriter 2: TL ana desteğine yakınlık ve RSI/MACD dönüş sinyali (+25p)
    dist_to_support_pct = abs(last_price - nearest_support_tl) / last_price * 100.0
    macd_turning_up = (macd_val > macd_sig) or (macd_hist > macd_hist_prev)
    rsi_favorable = 28.0 <= rsi14 <= 58.0
    support_pts = 0
    if dist_to_support_pct <= 4.0:
        support_pts += 13
    elif dist_to_support_pct <= 7.5:
        support_pts += 8
    if rsi_favorable and macd_turning_up:
        support_pts += 12
    elif rsi_favorable or macd_turning_up:
        support_pts += 7
    score += support_pts
    score_breakdown.append(
        f"+{support_pts}p: TL destek mesafesi %{dist_to_support_pct:.1f}, RSI={rsi14:.1f}, MACD İvme={'Pozitif' if macd_turning_up else 'Zayıf'}"
    )

    # Kriter 3: Hacim onayı (RVOL > 1.2 ise +20p)
    if rvol >= 1.2:
        score += 20
        score_breakdown.append(f"+20p: Güçlü Göreceli Hacim Onayı (RVOL={rvol:.2f}x > 1.2x)")
    elif rvol >= 0.9:
        score += 10
        score_breakdown.append(f"+10p: Normal Hacim Akışı (RVOL={rvol:.2f}x)")
    else:
        score += 0
        score_breakdown.append(f"+0p: Zayıf Hacim Katılımı (RVOL={rvol:.2f}x < 0.9x)")

    # Kriter 4: Risk/Ödül Oranı (R:R >= 2.0 ise +30p)
    if rr_ratio >= 2.0:
        score += 30
        score_breakdown.append(f"+30p: Üstün Risk/Ödül Oranı (R:R = {rr_ratio:.2f} >= 2.0)")
    elif rr_ratio >= 1.5:
        score += 18
        score_breakdown.append(f"+18p: Kabul Edilebilir Risk/Ödül Oranı (R:R = {rr_ratio:.2f} >= 1.5)")
    else:
        score += 0
        score_breakdown.append(f"+0p: Yetersiz Risk/Ödül Oranı (R:R = {rr_ratio:.2f} < 1.5)")

    # --- KURUMSAL RİSK KALKANI (SHIELD: NET EV, HALF-KELLY & %99 CVaR) ---
    target_profit_pct = (reward_tl / last_price) * 100.0 if last_price > 0 else 0.0
    stop_loss_pct = (risk_tl / last_price) * 100.0 if last_price > 0 else 0.0
    est_win_prob = min(0.75, max(0.30, 0.35 + (score / 100.0) * 0.35))

    ev_engine = ExpectedValueFilter(min_ev_threshold=0.0, default_roundtrip_cost_pct=0.20)
    ev_res = ev_engine.evaluate_trade(
        win_probability=est_win_prob,
        target_profit_pct=target_profit_pct,
        stop_loss_pct=stop_loss_pct,
        roundtrip_cost_pct=0.20,
    )

    kelly_engine = KellySizingEngine(default_fraction=0.5, max_position_pct=0.15)
    kelly_res = kelly_engine.calculate_allocation(
        win_probability=est_win_prob,
        reward_to_risk=ev_res["net_reward_to_risk"],
        total_capital=100_000.0,
        current_cash=100_000.0,
        sentiment_score=0.2 if macro["is_risk_on"] else -0.4,
        trade_direction="LONG",
    )

    daily_returns = df["Close"].pct_change().dropna().to_numpy(dtype=np.float64)
    var_engine = ValueAtRiskModel(confidence_level=0.99)
    hist_var_res = var_engine.calculate_historical_var(
        portfolio_value=100_000.0,
        historical_returns=daily_returns,
        holding_period_days=1,
    )

    # --- OTONOM MUHAKEME (ReAct & Öz-Denetim Karar Etiketi) ---
    near_resistance = last_price >= min(bb_upper, pivot_r1) * 0.985
    if rr_ratio < 1.5 or near_resistance or not ev_res["is_authorized"]:
        decision = "[DESTEĞE ÇEKİLMESİNİ BEKLE]"
    elif not macro["is_risk_on"] and score < 70:
        decision = "[UZAK DUR / RİSKLİ]"
    elif score >= 75 and rr_ratio >= 2.0 and macro["is_risk_on"]:
        decision = "[GÜÇLÜ ALIM BÖLGESİ]"
    elif score >= 55 and rr_ratio >= 1.5:
        decision = "[KADEMELİ BİRİKTİR]"
    else:
        decision = "[DESTEĞE ÇEKİLMESİNİ BEKLE]"

    # --- SEMİH HOCA KAPISI (PU30/NU70 + GVT/GKD referans yöntemdir; konsey ona tabidir) ---
    sm = _semih_assess(sym, semih)
    semih_note = sm["text"]
    base_decision = decision
    if sm["bear"] and decision in ("[GÜÇLÜ ALIM BÖLGESİ]", "[KADEMELİ BİRİKTİR]"):
        decision = "[DESTEĞE ÇEKİLMESİNİ BEKLE]"
        semih_note += " -> NU70 VETOSU: alım kararı iptal"
        score_breakdown.append("-: Semih NU70 vetosu (aktif zirve uyumsuzluğu, birikim engellendi)")
    elif (
        sm["bull_confirmed"]
        and not sm["bear"]
        and decision in ("[UZAK DUR / RİSKLİ]", "[DESTEĞE ÇEKİLMESİNİ BEKLE]")
        and ev_res["is_authorized"]
        and not near_resistance
    ):
        decision = "[KADEMELİ BİRİKTİR]"
        semih_note += " -> PU30 ONAYI: makro/skor filtresi aşıldı (kademeli, küçük pozisyon)"
        score_breakdown.append("+: Semih PU30 ana dönüş onayı (karar yukarı çekildi)")
    if sm["bull_confirmed"] and not sm["bear"]:
        score = min(100, score + 15)
        score_breakdown.append("+15p: Semih PU30 ana dönüş (çoklu TF / GVT teyidi)")

    # Boğa ve Ayı Tezleri (Self-Reflection)
    bull_thesis = [
        f"USD bazında zirvesinden (${usd_ath:.2f}) %{usd_discount_pct:.1f} iskontolu (${current_usd:.2f}) işlem görüyor.",
        f"İlk USD Fibo hedefi ${tp1_usd:.2f} ({tp1_tl:.2f} TL) ve ana hedef ${tp2_usd:.2f} ({tp2_tl:.2f} TL) ile R:R oranı {rr_ratio:.2f}.",
        f"En yakın TRY savunma hattı {nearest_support_tl:.2f} TL; RSI(14)={rsi14:.1f} {'aşırı alımda değil' if rsi14 < 65 else 'güçlü momentumda'}.",
    ]
    bear_thesis = [
        f"SENARYO İPTAL (STOP) SEVİYESİ: {atr_stop_tl:.2f} TL altında günlük kapanışta pozisyon kapatılmalı (Ana destek: {major_support_tl:.2f} TL).",
        f"Hacim denetimi: RVOL={rvol:.2f}x ({'kurumsal hacim teyitli' if rvol >= 1.2 else 'hacim henüz patlama yapmadı, sahte kırılım riski var'}).",
        f"TL direnç/bant kontrolü: Üst Bollinger ({bb_upper:.2f} TL) ve Pivot R1 ({pivot_r1:.2f} TL) {'çok yakın, geri çekilme beklenmeli' if near_resistance else 'henüz yukarıda alan bırakıyor'}.",
    ]

    if decision == "[UZAK DUR / RİSKLİ]":
        kademe_1_str = "Pas (Uzak Dur - Alım Yok)"
        kademe_2_str = f"İzleme: {nearest_support_tl:.2f} TL (Onay Bekle)"
        kademe_3_str = f"İzleme: {major_support_tl:.2f} TL (Onay Bekle)"
        kelly_display = "%0.00 (REJECTED - Uzak Dur / Makro-Skor Filtresi)"
    elif decision == "[DESTEĞE ÇEKİLMESİNİ BEKLE]":
        kademe_1_str = "Pas (Desteği Bekle)"
        kademe_2_str = f"{nearest_support_tl:.2f} TL"
        kademe_3_str = f"{major_support_tl:.2f} TL"
        kelly_display = f"%0.00 Aktif / Pusuda %{kelly_res['recommended_pct']:.2f} (PENDING - Desteği Bekle)"
    else:
        kademe_1_str = f"{last_price:.2f} TL"
        kademe_2_str = f"{nearest_support_tl:.2f} TL"
        kademe_3_str = f"{major_support_tl:.2f} TL"
        kelly_display = f"%{kelly_res['recommended_pct']:.2f} ({kelly_res['status']})"

    return {
        "symbol": sym,
        "status": "ok",
        "last_price_tl": round(last_price, 2),
        "last_price_usd": round(current_usd, 3),
        "conviction_score": score,
        "decision": decision,
        "base_decision": base_decision,
        "semih_signal": semih_note,
        "rr_ratio": round(rr_ratio, 2),
        "try_defense": {
            "EMA21 (TL)": round(ema21, 2),
            "SMA50 (TL)": round(sma50, 2),
            "SMA200 (TL)": round(sma200, 2),
            "Bollinger Alt (TL)": round(bb_lower, 2),
            "Bollinger Üst (TL)": round(bb_upper, 2),
            "Pivot S1 / S2 (TL)": f"{pivot_s1:.2f} / {pivot_s2:.2f}",
            "Pivot R1 (TL)": round(pivot_r1, 2),
            "En Yakın Destek (TL)": round(nearest_support_tl, 2),
            "ATR(14) Dinamik Stop (TL)": round(atr_stop_tl, 2),
            "RSI(14) / RVOL": f"{rsi14:.1f} / {rvol:.2f}x",
        },
        "usd_offense": {
            "Güncel Fiyat ($ / TL)": f"${current_usd:.2f} ({last_price:.2f} TL)",
            "2Y USD ATH ($ / TL)": f"${usd_ath:.2f} ({usd_ath * current_fx:.2f} TL)",
            "USD ATH İskontosu": f"%{usd_discount_pct:.1f}",
            "USD SMA200 ($ / TL)": f"${usd_sma200:.2f} ({usd_sma200 * current_fx:.2f} TL)",
            "Fib 0.382 ($ / TL)": f"${fib_usd_levels['Fib 0.382']:.2f} ({fib_usd_levels['Fib 0.382'] * current_fx:.2f} TL)",
            "Fib 0.500 ($ / TL)": f"${fib_usd_levels['Fib 0.500']:.2f} ({fib_usd_levels['Fib 0.500'] * current_fx:.2f} TL)",
            "Fib 0.618 ($ / TL)": f"${fib_usd_levels['Fib 0.618']:.2f} ({fib_usd_levels['Fib 0.618'] * current_fx:.2f} TL)",
            "TP1 Hedefi ($ / TL)": f"${tp1_usd:.2f} ({tp1_tl:.2f} TL)",
            "TP2 Ana Hedef ($ / TL)": f"${tp2_usd:.2f} ({tp2_tl:.2f} TL)",
        },
        "score_breakdown": score_breakdown,
        "bull_thesis": bull_thesis,
        "bear_thesis": bear_thesis,
        "execution_plan": {
            "Kademe 1 (Mevcut / İlk Alım)": kademe_1_str,
            "Kademe 2 (Destek Pususu)": kademe_2_str,
            "Kademe 3 (Ana Savunma Hattı)": kademe_3_str,
            "Kesin Stop-Loss (ATR Bazlı)": f"{atr_stop_tl:.2f} TL",
            "TP1 Kar-Al (USD Bazlı)": f"{tp1_tl:.2f} TL (${tp1_usd:.2f})",
            "TP2 Ana Kar-Al (USD Bazlı)": f"{tp2_tl:.2f} TL (${tp2_usd:.2f})",
        },
        "shield_risk": {
            "Brüt / Net Beklenen Değer (EV)": f"%{ev_res['gross_expected_value_pct']:.2f} / %{ev_res['expected_value_pct']:.2f} (Maliyet: %{ev_res['roundtrip_cost_pct']:.2f})",
            "Brüt / Net R:R Oranı": f"{ev_res['reward_to_risk']:.2f} / {ev_res['net_reward_to_risk']:.2f}",
            "Half-Kelly Önerilen Pozisyon": kelly_display,
            "1G %99 Tarihsel VaR / CVaR (ES)": f"%{hist_var_res['var_pct']:.2f} / %{hist_var_res['cvar_pct']:.2f}",
        },
    }


def print_agentic_report(macro: Dict[str, Any], results: List[Dict[str, Any]]) -> None:
    print("=" * 84)
    print("🤖 BIST AGENTIC AI KARAR MOTORU (ReAct & Öz-Denetim Döngüsü)")
    print("=" * 84)
    macro_rows = [
        ["BIST 100 (XU100)", f"{macro['xu100_last']} (SMA20: {macro['xu100_sma20']} | SMA50: {macro['xu100_sma50']} | RSI: {macro['xu100_rsi']})"],
        ["Güncel USD/TRY Kuru", f"{macro['usdtry_last']} TL"],
        ["Makro Piyasa Rejimi", macro["regime"]],
    ]
    print(tabulate(macro_rows, headers=["Makro Gösterge", "Değer / Durum"], tablefmt="github"))
    print()

    for res in results:
        if res.get("status") != "ok":
            print(f"[!] {res['symbol']}: {res.get('message')}")
            continue

        print("-" * 84)
        print(
            f"📌 HİSSE: {res['symbol']} | GÜNCEL: {res['last_price_tl']:.2f} TL (${res['last_price_usd']:.2f}) | "
            f"GÜVEN PUANI: {res['conviction_score']}/100 | R:R: {res['rr_ratio']} | KARAR: {res['decision']}"
        )
        print("-" * 84)

        def_rows = [[k, v] for k, v in res["try_defense"].items()]
        off_rows = [[k, v] for k, v in res["usd_offense"].items()]

        print("\n[1] ÇİFT KATMANLI FİYATLAMA (TRY SAVUNMA & USD TAARRUZ HATLARI)")
        combined = []
        max_len = max(len(def_rows), len(off_rows))
        for i in range(max_len):
            d_k, d_v = def_rows[i] if i < len(def_rows) else ("", "")
            o_k, o_v = off_rows[i] if i < len(off_rows) else ("", "")
            combined.append([d_k, d_v, o_k, o_v])
        print(
            tabulate(
                combined,
                headers=["TRY Savunma Hattı", "Seviye (TL)", "USD/TRY Taarruz Hattı", "Hedef ($ / TL)"],
                tablefmt="github",
            )
        )

        print("\n[2] OTONOM PUANLAMA KIRILIMI (Agentic Conviction Score)")
        for line in res["score_breakdown"]:
            print(f"  * {line}")
        print(f"  🎯 SEMİH SİNYALİ: {res.get('semih_signal', '-')}")
        if res.get("base_decision") != res["decision"]:
            print(f"  ↪ Konsey ham kararı {res.get('base_decision')} idi, Semih kapısı {res['decision']} yaptı.")

        print("\n[3] TEZ & ANTİTEZ ÇARPIŞMASI (Self-Reflection)")
        print("  🟢 BOĞA TEZİ (Neden Alınmalı / USD Potansiyeli):")
        for b in res["bull_thesis"]:
            print(f"     + {b}")
        print("  🔴 AYI / RİSK DENETÇİSİ TEZİ (Hangi Seviye Kırılırsa Senaryo Çöp Olur?):")
        for r in res["bear_thesis"]:
            print(f"     - {r}")

        print(f"\n[4] NİHAİ OTONOM KARAR: {res['decision']} — UYGULAMA PLANI")
        plan_rows = [[k, v] for k, v in res["execution_plan"].items()]
        print(tabulate(plan_rows, headers=["Aksiyon Adımı", "Fiyat / Seviye"], tablefmt="github"))

        if "shield_risk" in res:
            print("\n[5] KURUMSAL RİSK KALKANI (SHIELD: NET EV, HALF-KELLY & %99 CVaR)")
            shield_rows = [[k, v] for k, v in res["shield_risk"].items()]
            print(tabulate(shield_rows, headers=["Kurumsal Kalkan Metriği", "Değer / Durum"], tablefmt="github"))
        print()


def log_council_decisions(macro: Dict[str, Any], results: List[Dict[str, Any]]) -> Optional[str]:
    """Her konsey kararını journal/council_log.jsonl'a ekler (öğrenme/isabet raporu için)."""
    import json
    from datetime import datetime, timezone

    try:
        path = Path(__file__).resolve().parent / "journal" / "council_log.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc).isoformat()
        with path.open("a", encoding="utf-8") as fh:
            for r in results:
                if r.get("status") != "ok":
                    continue
                fh.write(json.dumps({
                    "ts": now,
                    "symbol": r["symbol"],
                    "price": r["last_price_tl"],
                    "score": r["conviction_score"],
                    "rr": r["rr_ratio"],
                    "decision": r["decision"],
                    "base_decision": r.get("base_decision"),
                    "semih": r.get("semih_signal"),
                    "regime": macro.get("regime"),
                }, ensure_ascii=False) + "\n")
        return str(path)
    except Exception as exc:
        print(f"[!] UYARI: konsey kararı kaydedilemedi: {exc}")
        return None


def main() -> int:
    symbols = sys.argv[1:] if len(sys.argv) > 1 else ["THYAO"]
    macro = analyze_macro_regime()
    semih = fetch_semih_signals(symbols)
    if not semih["ok"]:
        print(f"[!] UYARI: Semih kapısı eksik çalıştı -> {semih['error']}")
    results = [analyze_symbol(s, macro, semih) for s in symbols]
    log_council_decisions(macro, results)
    if len(results) > 1:
        results.sort(key=lambda x: (x.get("conviction_score", -1), x.get("rr_ratio", -1)), reverse=True)
    print_agentic_report(macro, results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
