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

import sys
import time
import warnings
from typing import Any, Dict, List, Optional, Tuple

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
                df = t.history(period=period, interval=interval, auto_adjust=True)
                if df is not None and not df.empty and len(df) >= 30:
                    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(how="any").copy()
                    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
                    df = df[~df.index.duplicated(keep="last")].sort_index()
                    return df
            except Exception:
                pass
            time.sleep(0.6 * attempt)
    return pd.DataFrame()


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
    elif last_val > sma50:
        regime = "Nötr-Pozitif / Kısa Vadeli Dinlenme (SMA50 Üzerinde, SMA20 Altında)"
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


def analyze_symbol(raw_symbol: str, macro: Dict[str, Any]) -> Dict[str, Any]:
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

    # Ana TRY destek ve ATR bazlı dinamik Stop-Loss
    candidate_supports = [x for x in (ema21, sma50, sma200, bb_lower, pivot_s1) if x < last_price]
    nearest_support_tl = max(candidate_supports) if candidate_supports else min(bb_lower, pivot_s1, last_price - 1.5 * atr14)
    major_support_tl = min(sma50, bb_lower, pivot_s1)
    atr_stop_tl = max(0.01, min(nearest_support_tl - 0.5 * atr14, last_price - 2.0 * atr14))

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

    # --- OTONOM MUHAKEME (ReAct & Öz-Denetim Karar Etiketi) ---
    near_resistance = last_price >= min(bb_upper, pivot_r1) * 0.985
    if rr_ratio < 1.5 or near_resistance:
        decision = "[DESTEĞE ÇEKİLMESİNİ BEKLE]"
    elif not macro["is_risk_on"] and score < 70:
        decision = "[UZAK DUR / RİSKLİ]"
    elif score >= 75 and rr_ratio >= 2.0 and macro["is_risk_on"]:
        decision = "[GÜÇLÜ ALIM BÖLGESİ]"
    elif score >= 55 and rr_ratio >= 1.5:
        decision = "[KADEMELİ BİRİKTİR]"
    else:
        decision = "[DESTEĞE ÇEKİLMESİNİ BEKLE]"

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

    return {
        "symbol": sym,
        "status": "ok",
        "last_price_tl": round(last_price, 2),
        "last_price_usd": round(current_usd, 3),
        "conviction_score": score,
        "decision": decision,
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
            "Kademe 1 (Mevcut / İlk Alım)": f"{last_price:.2f} TL" if decision in ("[GÜÇLÜ ALIM BÖLGESİ]", "[KADEMELİ BİRİKTİR]") else "Pas (Desteği Bekle)",
            "Kademe 2 (Destek Pususu)": f"{nearest_support_tl:.2f} TL",
            "Kademe 3 (Ana Savunma Hattı)": f"{major_support_tl:.2f} TL",
            "Kesin Stop-Loss (ATR Bazlı)": f"{atr_stop_tl:.2f} TL",
            "TP1 Kar-Al (USD Bazlı)": f"{tp1_tl:.2f} TL (${tp1_usd:.2f})",
            "TP2 Ana Kar-Al (USD Bazlı)": f"{tp2_tl:.2f} TL (${tp2_usd:.2f})",
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
        print()


def main() -> int:
    symbols = sys.argv[1:] if len(sys.argv) > 1 else ["THYAO"]
    macro = analyze_macro_regime()
    results = [analyze_symbol(s, macro) for s in symbols]
    if len(results) > 1:
        results.sort(key=lambda x: (x.get("conviction_score", -1), x.get("rr_ratio", -1)), reverse=True)
    print_agentic_report(macro, results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
