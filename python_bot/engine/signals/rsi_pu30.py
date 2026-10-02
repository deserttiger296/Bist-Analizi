# -*- coding: utf-8 -*-
"""
RSI Uyumsuzluk Motoru:
  1. PU30 (Pozitif Uyumsuzluk -- Bullish Divergence / Yükseliş Sinyali)
  2. NU70 (Negatif Uyumsuzluk -- Bearish Divergence / Düşüş Sinyali)

Semih Murat Ersoy Formülü:
- PU30: Fiyat düşerken ilk RSI dibi 30 altında olur. Fiyat ara tepki sonrası düşmeye devam
  edip yeni bir düşük dip yaparken, 2. RSI dibi 30 üzerinde ve 1. dipten yüksek kalır. -> Yükseliş Sinyali.
- NU70: Fiyat yükselirken ilk RSI tepesi 70 üzerinde olur. Fiyat ara düzeltme sonrası yükselmeye devam
  edip yeni bir yüksek tepe yaparken, 2. RSI tepesi 70 altında ve 1. tepeden alçak kalır. -> Düşüş Sinyali.

Zaman Dilimleri:
- "1d": Günlük mumlar
- "4h": 4 Saatlik mumlar (TradingView 4s)
- "1h": 1 Saatlik mumlar (TradingView 1s)
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf


@dataclass(frozen=True)
class PU30Config:
    rsi_length: int = 14
    rsi_threshold: float = 30.0
    pivot_left_bars: int = 5
    pivot_right_bars: int = 2
    min_gap_bars: int = 4
    max_gap_bars: int = 60
    min_bounce_pct: float = 1.0
    signal_lifetime_bars: int = 10


@dataclass(frozen=True)
class NU70Config:
    rsi_length: int = 14
    rsi_threshold: float = 70.0
    pivot_left_bars: int = 5
    pivot_right_bars: int = 2
    min_gap_bars: int = 4
    max_gap_bars: int = 60
    min_pullback_pct: float = 1.0
    signal_lifetime_bars: int = 10


DEFAULT_PU30_CONFIG = PU30Config()
DEFAULT_NU70_CONFIG = NU70Config()

INTERVALS = {
    "1d": ("1y", "%Y-%m-%d", 24 * 60),
    "4h": ("730d", "%Y-%m-%d %H:%M", 4 * 60),
    "1h": ("730d", "%Y-%m-%d %H:%M", 60),
}

_EPOCH = pd.Timestamp("1970-01-01")


def _epoch_seconds(ts: Any) -> int:
    """UTCTimestamp for lightweight-charts."""
    ts = pd.Timestamp(ts)
    if ts.tzinfo is not None:
        ts = ts.tz_localize(None)
    return int((ts - _EPOCH) / pd.Timedelta(seconds=1))


MIN_BARS_REQUIRED = 25


def wilder_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """TradingView Wilder RSI (RMA)."""
    n = len(closes)
    rsi = np.full(n, np.nan)
    if n < period + 1:
        return rsi

    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()
    rsi[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)

    for i in range(period + 1, n):
        g = gains[i - 1]
        l = losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        rsi[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)

    return rsi


def find_confirmed_pivot_lows(lows: np.ndarray, lb: int, rb: int) -> List[int]:
    n = len(lows)
    pivots = []
    for p in range(lb, n - rb):
        left = lows[p - lb:p]
        right = lows[p + 1:p + rb + 1]
        if np.all(lows[p] < left) and np.all(lows[p] <= right):
            pivots.append(p)
    return pivots


def find_confirmed_pivot_highs(highs: np.ndarray, lb: int, rb: int) -> List[int]:
    n = len(highs)
    pivots = []
    for p in range(lb, n - rb):
        left = highs[p - lb:p]
        right = highs[p + 1:p + rb + 1]
        if np.all(highs[p] > left) and np.all(highs[p] >= right):
            pivots.append(p)
    return pivots


def _dip_rsi(rsi: np.ndarray, p: int, lb: int, rb: int) -> float:
    window = rsi[max(0, p - lb):p + rb + 1]
    window = window[~np.isnan(window)]
    return float(window.min()) if len(window) else float("nan")


def _peak_rsi(rsi: np.ndarray, p: int, lb: int, rb: int) -> float:
    window = rsi[max(0, p - lb):p + rb + 1]
    window = window[~np.isnan(window)]
    return float(window.max()) if len(window) else float("nan")


def detect_rsi_pu30(df: pd.DataFrame, cfg: PU30Config = DEFAULT_PU30_CONFIG, ignore_lifetime: bool = False, interval: str = "4h") -> Optional[Dict[str, Any]]:
    """PU30: Bullish Divergence."""
    n = len(df)
    if n < MIN_BARS_REQUIRED:
        return None

    closes = df["close"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    dates = df["date"].to_numpy()

    rsi = wilder_rsi(closes, cfg.rsi_length)
    pivot_indices = find_confirmed_pivot_lows(lows, cfg.pivot_left_bars, cfg.pivot_right_bars)

    dips: List[Dict[str, Any]] = []
    signal: Optional[Dict[str, Any]] = None

    for p in pivot_indices:
        d2_rsi = _dip_rsi(rsi, p, cfg.pivot_left_bars, cfg.pivot_right_bars)
        d2 = {"index": p, "price": float(lows[p]), "rsi": d2_rsi}

        if not np.isnan(d2_rsi):
            for d1 in reversed(dips):
                gap = d2["index"] - d1["index"]
                if gap > cfg.max_gap_bars:
                    break
                if gap < cfg.min_gap_bars:
                    continue
                # 1. Dip: RSI 30 altında olmalı
                if np.isnan(d1["rsi"]) or d1["rsi"] >= (cfg.rsi_threshold + 2.0):
                    continue
                # 2. Dip: Fiyat daha düşük olmalı
                if d2["price"] >= d1["price"]:
                    continue
                # 2. Dip RSI: 1. Dipten yüksek olmalı
                if d2["rsi"] <= d1["rsi"]:
                    continue

                between_lo = lows[d1["index"] + 1:d2["index"]]
                between_hi = highs[d1["index"] + 1:d2["index"]]
                if len(between_lo) == 0:
                    continue
                min_between = float(between_lo.min())
                max_between = float(between_hi.max())
                bounce_pct = (max_between / d1["price"] - 1.0) * 100.0

                if min_between >= (d1["price"] * 0.99) and bounce_pct >= cfg.min_bounce_pct:
                    confirm_index = d2["index"] + cfg.pivot_right_bars
                    bars_since = (n - 1) - confirm_index
                    date_fmt = INTERVALS.get(interval, ("1y", "%Y-%m-%d %H:%M", 60))[1]
                    d1_ts = pd.Timestamp(dates[d1["index"]])
                    d2_ts = pd.Timestamp(dates[d2["index"]])
                    max_between_rel = int(np.argmax(between_hi))
                    max_between_idx = d1["index"] + 1 + max_between_rel
                    max_between_ts = pd.Timestamp(dates[max_between_idx])

                    lowest_dip = float(min(d1["price"], d2["price"]))
                    pu_diff = max_between - lowest_dip
                    fibonacci_levels = [
                        {"label": "Fibo 1.618 (Ana Hedef)", "level": 1.618, "price": round(lowest_dip + 1.618 * pu_diff, 2), "color": "#10b981"},
                        {"label": "Fibo 1.382 (Ara Hedef)", "level": 1.382, "price": round(lowest_dip + 1.382 * pu_diff, 2), "color": "#34d399"},
                        {"label": "Fibo 1.000 (Direnç Kırılım)", "level": 1.000, "price": round(max_between, 2), "color": "#10b981"},
                        {"label": "Fibo 0.618 (Altın Oran)", "level": 0.618, "price": round(lowest_dip + 0.618 * pu_diff, 2), "color": "#6ee7b7"},
                    ]

                    signal = {
                        "type": "PU30",
                        "trend": "BULL",
                        "label": "PU30 (Dip / Alis)",
                        "dip1": {**d1, "date": d1_ts.strftime(date_fmt), "time": _epoch_seconds(d1_ts)},
                        "dip2": {**d2, "date": d2_ts.strftime(date_fmt), "time": _epoch_seconds(d2_ts)},
                        "guven_tazeleyen_tepe": {
                            "price": round(max_between, 2),
                            "date": max_between_ts.strftime(date_fmt),
                            "time": _epoch_seconds(max_between_ts),
                        },
                        "fibonacci_levels": fibonacci_levels,
                        "bounce_pct": round(bounce_pct, 2),
                        "bars_since_confirm": bars_since,
                        "gap_bars": gap,
                    }
                    break

        dips.append(d2)

    if signal and (ignore_lifetime or signal["bars_since_confirm"] <= cfg.signal_lifetime_bars):
        return signal
    return None


def detect_rsi_nu70(df: pd.DataFrame, cfg: NU70Config = DEFAULT_NU70_CONFIG, ignore_lifetime: bool = False, interval: str = "4h") -> Optional[Dict[str, Any]]:
    """NU70: Bearish Divergence (Semih Murat Ersoy kuralı)."""
    n = len(df)
    if n < MIN_BARS_REQUIRED:
        return None

    closes = df["close"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    dates = df["date"].to_numpy()

    rsi = wilder_rsi(closes, cfg.rsi_length)
    pivot_indices = find_confirmed_pivot_highs(highs, cfg.pivot_left_bars, cfg.pivot_right_bars)

    peaks: List[Dict[str, Any]] = []
    signal: Optional[Dict[str, Any]] = None

    for p in pivot_indices:
        t2_rsi = _peak_rsi(rsi, p, cfg.pivot_left_bars, cfg.pivot_right_bars)
        t2 = {"index": p, "price": float(highs[p]), "rsi": t2_rsi}

        if not np.isnan(t2_rsi):
            for t1 in reversed(peaks):
                gap = t2["index"] - t1["index"]
                if gap > cfg.max_gap_bars:
                    break
                if gap < cfg.min_gap_bars:
                    continue
                # 1. Tepe: RSI 70 üzerinde olmalı
                if np.isnan(t1["rsi"]) or t1["rsi"] < (cfg.rsi_threshold - 2.0):
                    continue
                # 2. Tepe: Fiyat daha yüksek zirve yapmalı
                if t2["price"] <= t1["price"]:
                    continue
                # 2. Tepe: RSI daha düşük tepe yapmalı
                if t2["rsi"] >= t1["rsi"]:
                    continue
                # Semih Bey: "ve bir diğer tepe 70 altında oluyor"
                if t2["rsi"] > (cfg.rsi_threshold + 2.0):
                    continue

                between_lo = lows[t1["index"] + 1:t2["index"]]
                if len(between_lo) == 0:
                    continue
                min_between = float(between_lo.min())
                pullback_pct = (1.0 - min_between / t1["price"]) * 100.0

                if pullback_pct >= cfg.min_pullback_pct:
                    confirm_index = t2["index"] + cfg.pivot_right_bars
                    bars_since = (n - 1) - confirm_index
                    date_fmt = INTERVALS.get(interval, ("1y", "%Y-%m-%d %H:%M", 60))[1]
                    t1_ts = pd.Timestamp(dates[t1["index"]])
                    t2_ts = pd.Timestamp(dates[t2["index"]])
                    min_between_rel = int(np.argmin(between_lo))
                    min_between_idx = t1["index"] + 1 + min_between_rel
                    min_between_ts = pd.Timestamp(dates[min_between_idx])

                    highest_peak = float(max(t1["price"], t2["price"]))
                    nu_diff = highest_peak - min_between
                    fibonacci_levels = [
                        {"label": "Fibo 1.618 (Düşüş Hedefi)", "level": 1.618, "price": round(highest_peak - 1.618 * nu_diff, 2), "color": "#f43f5e"},
                        {"label": "Fibo 1.382 (Düşüş Seviyesi)", "level": 1.382, "price": round(highest_peak - 1.382 * nu_diff, 2), "color": "#fb7185"},
                        {"label": "Fibo 1.000 (Güven Kıran Dip)", "level": 1.000, "price": round(min_between, 2), "color": "#ef4444"},
                        {"label": "Fibo 0.786 (Kritik Destek)", "level": 0.786, "price": round(highest_peak - 0.786 * nu_diff, 2), "color": "#cbd5e1"},
                        {"label": "Fibo 0.618 (Altın Düzeltme)", "level": 0.618, "price": round(highest_peak - 0.618 * nu_diff, 2), "color": "#e2e8f0"},
                    ]

                    signal = {
                        "type": "NU70",
                        "trend": "BEAR",
                        "label": "NU70 (Tepe / Satis)",
                        "tepe1": {**t1, "date": t1_ts.strftime(date_fmt), "time": _epoch_seconds(t1_ts)},
                        "tepe2": {**t2, "date": t2_ts.strftime(date_fmt), "time": _epoch_seconds(t2_ts)},
                        # Aliases for card rendering
                        "dip1": {**t1, "date": t1_ts.strftime(date_fmt), "time": _epoch_seconds(t1_ts)},
                        "dip2": {**t2, "date": t2_ts.strftime(date_fmt), "time": _epoch_seconds(t2_ts)},
                        "guven_kiran_dip": {
                            "price": round(min_between, 2),
                            "date": min_between_ts.strftime(date_fmt),
                            "time": _epoch_seconds(min_between_ts),
                        },
                        "fibonacci_levels": fibonacci_levels,
                        "pullback_pct": round(pullback_pct, 2),
                        "bounce_pct": round(pullback_pct, 2),
                        "bars_since_confirm": bars_since,
                        "gap_bars": gap,
                    }
                    break

        peaks.append(t2)

    if signal and (ignore_lifetime or signal["bars_since_confirm"] <= cfg.signal_lifetime_bars):
        return signal
    return None


def _normalize_symbol(symbol: str) -> str:
    return symbol if symbol.endswith(".IS") else f"{symbol}.IS"


def _fetch_adjusted_bars(symbol: str, interval: str = "4h", period: Optional[str] = None) -> Optional[pd.DataFrame]:
    """Adjusted bars for 1d, 4h, or 1h."""
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
    default_period, _, bar_minutes = INTERVALS[interval]
    period = period or default_period

    if interval == "4h":
        # yfinance doesn't provide 4h natively -- resample 1h to 4h
        raw = yf.download(_normalize_symbol(symbol), period="730d", interval="1h", auto_adjust=True, progress=False)
        if raw.empty:
            return None
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.droplevel(1)
        resampled = raw.resample("4h").agg({
            "Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"
        }).dropna()
        df = resampled.reset_index()
    else:
        raw = yf.download(_normalize_symbol(symbol), period=period, interval=interval, auto_adjust=True, progress=False)
        if raw.empty:
            return None
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.droplevel(1)
        df = raw.reset_index()

    date_col = "Datetime" if "Datetime" in df.columns else "Date"
    df = df[[date_col, "Open", "High", "Low", "Close"]].copy()
    df.columns = ["date", "open", "high", "low", "close"]
    df = df.dropna(subset=["low", "high", "close"])
    df = df[df["low"] > 0]

    if len(df) > 0:
        last_ts = pd.Timestamp(df["date"].iloc[-1])
        last_ist = last_ts.tz_convert("Europe/Istanbul") if last_ts.tzinfo is not None else last_ts.tz_localize("Europe/Istanbul")
        now_ist = datetime.now(ZoneInfo("Europe/Istanbul"))

        if interval == "1d":
            session_open = now_ist.weekday() < 5 and 10 <= now_ist.hour < 18
            if session_open and last_ist.date() == now_ist.date():
                df = df.iloc[:-1]
        else:
            bar_end = last_ist + timedelta(minutes=bar_minutes)
            if now_ist < bar_end.to_pydatetime():
                df = df.iloc[:-1]

    min_bars = MIN_BARS_REQUIRED
    return df.reset_index(drop=True) if len(df) >= min_bars else None


def scan_universe_rsi_pu30(
    symbols: List[str],
    max_workers: int = 4,
    interval: str = "4h",
    signal_type: str = "all"  # "all", "pu30", "nu70"
) -> Dict[str, Any]:
    """Scans symbols for PU30 (Alış) and NU70 (Satış/Tepe) uyumsuzlukları."""
    from concurrent.futures import ThreadPoolExecutor

    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []

    def _scan_one(symbol: str):
        try:
            df = _fetch_adjusted_bars(symbol, interval=interval)
            if df is None:
                return symbol, [], "insufficient history"

            found = []
            last_close = float(df["close"].iloc[-1])

            # Prepare cross-check dataframe for confluence
            df_cross = None
            cross_interval = "4h" if interval == "1h" else ("1h" if interval == "4h" else None)
            if cross_interval:
                try:
                    df_cross = _fetch_adjusted_bars(symbol, interval=cross_interval)
                except Exception:
                    df_cross = None

            if signal_type in ("all", "pu30"):
                sig_pu = detect_rsi_pu30(df, DEFAULT_PU30_CONFIG, interval=interval)
                if sig_pu:
                    sig_pu["symbol"] = symbol
                    sig_pu["last_close"] = last_close
                    # Multi-timeframe confluence check per Semih Murat Ersoy
                    has_cross_pu = False
                    if df_cross is not None:
                        has_cross_pu = bool(detect_rsi_pu30(df_cross, DEFAULT_PU30_CONFIG, interval=cross_interval))

                    if has_cross_pu:
                        sig_pu["confluence"] = "DOUBLE_BULL"
                        sig_pu["confluence_badge"] = "💎 1s + 4s ÇİFTE ONAY (ANA RALLİ)"
                        sig_pu["strategy_action"] = "Hem 1s hem 4s teyitli ana dip dönüşü. Büyük trend potansiyeli!"
                    elif interval == "1h":
                        sig_pu["confluence"] = "SCALP_1H"
                        sig_pu["confluence_badge"] = "⚡ 1s TEPKİ YÜKSELİŞİ (KISA VADE)"
                        sig_pu["strategy_action"] = "Düşüş trendi içinde ara tepkidir (4s teyidi henüz yok). Kısa vadeli gir-çık yapılmalı."
                    else:
                        sig_pu["confluence"] = "MACRO_4H"
                        sig_pu["confluence_badge"] = "🏛️ 4s ANA DÖNÜŞ (Saatlik Tetik Bekleniyor)"
                        sig_pu["strategy_action"] = "4 saatlikte güçlü dip oluştu. Saatlik bazda güven kıran dip aşılınca giriş yapılabilir."

                    found.append(sig_pu)

            if signal_type in ("all", "nu70"):
                sig_nu = detect_rsi_nu70(df, DEFAULT_NU70_CONFIG, interval=interval)
                if sig_nu:
                    sig_nu["symbol"] = symbol
                    sig_nu["last_close"] = last_close
                    has_cross_nu = False
                    if df_cross is not None:
                        has_cross_nu = bool(detect_rsi_nu70(df_cross, DEFAULT_NU70_CONFIG, interval=cross_interval))

                    if has_cross_nu:
                        sig_nu["confluence"] = "DOUBLE_BEAR"
                        sig_nu["confluence_badge"] = "🚨 1s + 4s ÇİFTE DÜŞÜŞ (ZİRVE ÇÖKÜŞ)"
                        sig_nu["strategy_action"] = "Güven kıran dip kırıldı, tepeden sert kâr satışı riski. Kâr al / Stop tavsiye edilir."
                    elif interval == "1h":
                        sig_nu["confluence"] = "SCALP_BEAR"
                        sig_nu["confluence_badge"] = "⚠️ 1s GÜVEN KIRAN DİP UYARISI"
                        sig_nu["strategy_action"] = "Saatlik bazda zirve geçilemedi ve ara dip altına indi. Erken çıkış fırsatı."
                    else:
                        sig_nu["confluence"] = "MACRO_BEAR"
                        sig_nu["confluence_badge"] = "🔴 4s TEPE YORULMASI"
                        sig_nu["strategy_action"] = "4 saatlikte tepe uyumsuzluğu. 1 saatlikte güven kıran dip aranmalı."

                    found.append(sig_nu)

            return symbol, found, None
        except Exception as e:
            return symbol, [], str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for symbol, sigs, err in pool.map(_scan_one, symbols):
            if sigs:
                results.extend(sigs)
            elif err is not None:
                errors.append({"symbol": symbol, "error": err})

    # Sort newest confirmation first
    results.sort(key=lambda s: s.get("bars_since_confirm", 999))

    return {
        "signals": results,
        "errors": errors,
        "scanned": len(symbols),
        "matched": len(results),
        "interval": interval,
        "signal_type": signal_type,
    }


def get_symbol_chart_data(symbol: str, interval: str = "4h", period: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Full price + RSI bars and detected PU30/NU70 signals."""
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
    date_fmt = INTERVALS[interval][1]

    df = _fetch_adjusted_bars(symbol, interval=interval, period=period)
    if df is None:
        return None

    closes = df["close"].to_numpy(dtype=float)
    rsi = wilder_rsi(closes, 14)
    rsi_series = pd.Series(rsi)
    rsi_sma = rsi_series.rolling(14, min_periods=1).mean().to_numpy()
    sig_pu = detect_rsi_pu30(df, DEFAULT_PU30_CONFIG, ignore_lifetime=True, interval=interval)
    sig_nu = detect_rsi_nu70(df, DEFAULT_NU70_CONFIG, ignore_lifetime=True, interval=interval)

    bars = []
    for i in range(len(df)):
        ts = pd.Timestamp(df["date"].iloc[i])
        bars.append({
            "time": _epoch_seconds(ts),
            "date": ts.strftime(date_fmt),
            "open": float(df["open"].iloc[i]),
            "high": float(df["high"].iloc[i]),
            "low": float(df["low"].iloc[i]),
            "close": float(df["close"].iloc[i]),
            "rsi": None if np.isnan(rsi[i]) else round(float(rsi[i]), 2),
            "rsi_sma": None if np.isnan(rsi_sma[i]) else round(float(rsi_sma[i]), 2),
        })

    # Pick the most recent signal for primary display, but provide both
    if sig_pu and sig_nu:
        active_signal = sig_pu if sig_pu.get("bars_since_confirm", 999) <= sig_nu.get("bars_since_confirm", 999) else sig_nu
    else:
        active_signal = sig_pu or sig_nu

    return {
        "symbol": symbol,
        "interval": interval,
        "bars": bars,
        "signal": active_signal,
        "pu30_signal": sig_pu,
        "nu70_signal": sig_nu,
    }
