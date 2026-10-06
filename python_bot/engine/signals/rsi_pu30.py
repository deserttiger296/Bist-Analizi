# -*- coding: utf-8 -*-
"""
RSI Uyumsuzluk ve Çoklu Zaman Dilimi (Multi-Timeframe) Analiz Motoru:
  1. PU30 (Pozitif Uyumsuzluk -- Bullish Divergence / Yükseliş Sinyali)
  2. NU70 (Negatif Uyumsuzluk -- Bearish Divergence / Düşüş Sinyali)

Semih Murat Ersoy Formülü & Metodolojisi:
- PU30: Fiyat düşerken 1. dipte RSI 30 altında kalır. Fiyat ara tepki sonrası düşmeye devam
  edip yeni bir düşük dip yaparken, 2. RSI dibi 30 üzerinde ve 1. dipten yüksek kalır. -> Yükseliş Sinyali.
- NU70: Fiyat yükselirken 1. tepede RSI 70 üzerinde oluşur. Fiyat ara düzeltme sonrası yükselmeye devam
  edip yeni bir zirve yaparken, 2. RSI tepesi 70 altında ve 1. tepeden alçak kalır. -> Düşüş Sinyali.

Zaman Dilimleri (BIST Seans Uyumlu):
- "1d": Günlük mumlar
- "4h": 4 Saatlik mumlar (BIST seansına göre 10:00 [kapanış 14:30] ve 14:30 [kapanış 18:10] seans dilimleri)
- "1h": 1 Saatlik mumlar (TradingView 1s)

Look-Ahead Bias & Repainting Koruması:
- Bir pivot noktası p, sağdaki `pivot_right_bars` mum KAPANDIKTAN sonra kesinleşir.
- Sinyal kesinleşme anı (`confirm_time` / `knowable_at`) ile pivot oluşum anı (`pivot_time`)
  ayrı alanlarda saklanır ve geriye dönük testlerde işlem girişi kesinlikle teyitten sonraki mumda yapılır.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from python_bot.engine.data.provider import (
    bar_close_time,
    is_bar_closed,
    DataProvider,
    DataResult,
    DataStatus,
    clean_symbol_display,
    get_default_provider,
    normalize_bist_symbol,
)


@dataclass(frozen=True)
class PU30Config:
    rsi_length: int = 14
    rsi_threshold: float = 30.0
    rsi2_above_threshold: bool = False # strict_threshold=True zaten ikinci dip > 30 koşulunu zorunlu tutar
    require_higher_rsi: bool = True    # 2. dip RSI > 1. dip RSI
    require_lower_price: bool = True   # 2. dip Fiyat < 1. dip Fiyat
    strict_threshold: bool = True      # PU30: ilk dip < 30, ikinci dip > 30 (6 Ekim 2026 düzeltmesi)
    max_rsi_dip: float = 55.0          # 1. dip RSI bu tavanın altında olmalı (referans: rsi_uyumsuzluk.py/.pine)
    pivot_left_bars: int = 5
    pivot_right_bars: int = 2
    min_gap_bars: int = 8
    max_gap_bars: int = 60
    min_bounce_pct: float = 3.0
    signal_lifetime_bars: int = 5


@dataclass(frozen=True)
class NU70Config:
    rsi_length: int = 14
    rsi_threshold: float = 70.0
    rsi2_below_threshold: bool = False # Semih Ersoy: 70 altı/üstü şartı şart değil, tepelerden trend esastır
    require_lower_rsi: bool = True    # 2. tepe RSI < 1. tepe RSI
    require_higher_price: bool = True  # 2. tepe Fiyat > 1. tepe Fiyat
    strict_threshold: bool = True      # NU70: ilk tepe > 70, ikinci tepe < 70 (PU30 ayna kuralı, 6 Ekim 2026)
    min_rsi_peak: float = 45.0         # 1. tepe RSI bu tabanın üstünde olmalı (referans: rsi_uyumsuzluk.py/.pine)
    pivot_left_bars: int = 5
    pivot_right_bars: int = 2
    min_gap_bars: int = 8
    max_gap_bars: int = 60
    min_pullback_pct: float = 3.0
    signal_lifetime_bars: int = 5


DEFAULT_PU30_CONFIG = PU30Config()
DEFAULT_NU70_CONFIG = NU70Config()

INTERVALS = {
    "1d": ("1y", "%Y-%m-%d", 24 * 60),
    "4h": ("730d", "%Y-%m-%d %H:%M", 4 * 60),
    "1h": ("730d", "%Y-%m-%d %H:%M", 60),
}

_EPOCH = pd.Timestamp("1970-01-01")
MIN_BARS_REQUIRED = 25
_TF_LABEL = {"1h": "1s", "4h": "4s", "1d": "Günlük"}


def _epoch_seconds(ts: Any) -> int:
    """Lightweight-Charts için epoch saniyesi üretir."""
    t = pd.Timestamp(ts)
    if t.tzinfo is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    return int((t - _EPOCH) / pd.Timedelta(seconds=1))


def wilder_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """
    J. Welles Wilder Jr. (1978) RMA tabanlı RSI formülü.
    Sıfıra bölme ve flat fiyat (değişimsiz bar) durumları için matematiksel koruma içerir.
    """
    n = len(closes)
    rsi = np.full(n, np.nan, dtype=np.float64)
    if n < period + 1:
        return rsi

    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())

    if avg_gain + avg_loss == 0.0:
        rsi[period] = 50.0
    elif avg_loss == 0.0:
        rsi[period] = 100.0
    elif avg_gain == 0.0:
        rsi[period] = 0.0
    else:
        rs = avg_gain / avg_loss
        rsi[period] = 100.0 - 100.0 / (1.0 + rs)

    for i in range(period + 1, n):
        g = gains[i - 1]
        l = losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period

        if avg_gain + avg_loss == 0.0:
            rsi[i] = 50.0
        elif avg_loss == 0.0:
            rsi[i] = 100.0
        elif avg_gain == 0.0:
            rsi[i] = 0.0
        else:
            rs = avg_gain / avg_loss
            rsi[i] = 100.0 - 100.0 / (1.0 + rs)

    return rsi


def find_confirmed_pivot_lows(
    lows: np.ndarray, lb: int, rb: int, is_closed: Optional[np.ndarray] = None
) -> List[int]:
    """
    Sol ve sağ mumlarla kesinleşmiş dip (local minima) pivotlarını bulur.
    Look-ahead bias önlemi: Sağdaki rb adet mum kesinleşmeden pivot üretilmez.
    """
    n = len(lows)
    pivots: List[int] = []
    max_p = n - rb
    for p in range(lb, max_p):
        if is_closed is not None:
            # Sağ teyit barlarından herhangi biri kapanmamışsa bu pivot kesinleşmiş sayılamaz
            if not np.all(is_closed[p - lb:p + rb + 1]):
                continue
        left = lows[p - lb:p]
        right = lows[p + 1:p + rb + 1]
        if np.all(lows[p] < left) and np.all(lows[p] <= right):
            pivots.append(p)
    return pivots


def find_confirmed_pivot_highs(
    highs: np.ndarray, lb: int, rb: int, is_closed: Optional[np.ndarray] = None
) -> List[int]:
    """
    Sol ve sağ mumlarla kesinleşmiş tepe (local maxima) pivotlarını bulur.
    Look-ahead bias önlemi: Sağdaki rb adet mum kesinleşmeden pivot üretilmez.
    """
    n = len(highs)
    pivots: List[int] = []
    max_p = n - rb
    for p in range(lb, max_p):
        if is_closed is not None:
            if not np.all(is_closed[p - lb:p + rb + 1]):
                continue
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


def detect_rsi_pu30(
    df: pd.DataFrame,
    cfg: PU30Config = DEFAULT_PU30_CONFIG,
    ignore_lifetime: bool = False,
    interval: str = "4h",
) -> Optional[Dict[str, Any]]:
    """
    PU30: Pozitif Uyumsuzluk (Boğa / Dip Dönüşü) Sinyal Tespiti.
    Look-ahead bias ve repainting içermez; pivot oluşumu ile teyit zamanı ayrıştırılmıştır.
    """
    n = len(df)
    if n < MIN_BARS_REQUIRED:
        return None

    closes = df["close"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    dates = df["date"].to_numpy()
    is_closed_arr = df["is_closed"].to_numpy(dtype=bool) if "is_closed" in df.columns else np.array([is_bar_closed(t, interval) for t in dates])

    rsi = wilder_rsi(closes, cfg.rsi_length)
    pivot_indices = find_confirmed_pivot_lows(lows, cfg.pivot_left_bars, cfg.pivot_right_bars, is_closed_arr)

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

                # 1. Dip kontrolü
                if np.isnan(d1["rsi"]):
                    continue
                # strict_threshold=True: ilk dip kesinlikle 30 altında; eşitlik kabul edilmez.
                # strict_threshold=False ise Semih Ersoy trend uyumsuzluğu: dipler max_rsi_dip (örn 55) altında olmalı
                if cfg.strict_threshold and d1["rsi"] >= cfg.rsi_threshold:
                    continue
                # Referans (rsi_uyumsuzluk.py/.pine) tavanı yalnızca 1. dibe uygular;
                # 2. dip RSI'ı zaten require_higher_rsi ile 1. dipten yüksek olmak zorunda,
                # üst sınırı yoktur -- burada da ikisini birden sınırlamıyoruz.
                if not cfg.strict_threshold and d1["rsi"] > cfg.max_rsi_dip:
                    continue

                # 2. Dip: Fiyat kuralı (cfg.require_lower_price ise daha düşük dip yapmalı)
                if cfg.require_lower_price and d2["price"] >= d1["price"]:
                    continue

                # 2. Dip RSI kuralı: 1. Dipten yüksek olmalı (Tepelerden / diplerden trend kuralı)
                if cfg.require_higher_rsi and d2["rsi"] <= d1["rsi"]:
                    continue

                # 2. Dip RSI 30 üzerinde: klasik PU30 (strict) modda zorunlu, esnek modda opsiyonel
                if (cfg.rsi2_above_threshold or cfg.strict_threshold) and d2["rsi"] <= cfg.rsi_threshold:
                    continue

                between_lo = lows[d1["index"] + 1:d2["index"]]
                between_hi = highs[d1["index"] + 1:d2["index"]]
                if len(between_lo) == 0:
                    continue

                min_between = float(between_lo.min())
                max_between = float(between_hi.max())
                bounce_pct = (max_between / d1["price"] - 1.0) * 100.0

                # Fiyat Dip 1'den Dip 2'ye inerken Dip 1'in altından geçmek ZORUNDA (2. dip daha düşük);
                # bu yüzden doğru kural "aradaki hiçbir mum Dip 2'nin altına inmemeli" (Dip 2 = bölgenin dibi).
                if min_between >= d2["price"] and bounce_pct >= cfg.min_bounce_pct:
                    confirm_index = d2["index"] + cfg.pivot_right_bars
                    if confirm_index >= n:
                        continue

                    bars_since = (n - 1) - confirm_index
                    date_fmt = INTERVALS.get(interval, ("1y", "%Y-%m-%d %H:%M", 60))[1]

                    d1_ts = pd.Timestamp(dates[d1["index"]])
                    d2_ts = pd.Timestamp(dates[d2["index"]])
                    confirm_ts = pd.Timestamp(dates[confirm_index])

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

                    explanation = (
                        f"PU30 Pozitif Uyumsuzluk: 1. Dip {d1['price']:.2f} ₺ (RSI: {d1['rsi']:.1f}), "
                        f"2. Dip {d2['price']:.2f} ₺ (RSI: {d2['rsi']:.1f}). "
                        f"Sinyal {confirm_ts.strftime(date_fmt)} mum kapanışında teyit edildi."
                    )

                    signal = {
                        "type": "PU30",
                        "trend": "BULL",
                        "label": "PU30 (Dip / Alis)",
                        "dip1": {**d1, "date": d1_ts.strftime(date_fmt), "time": _epoch_seconds(d1_ts)},
                        "dip2": {**d2, "date": d2_ts.strftime(date_fmt), "time": _epoch_seconds(d2_ts)},
                        "pivot_time": _epoch_seconds(d2_ts),
                        "pivot_date": d2_ts.strftime(date_fmt),
                        "confirm_index": confirm_index,
                        "confirm_time": _epoch_seconds(confirm_ts),
                        "confirm_date": confirm_ts.strftime(date_fmt),
                        "confirm_bar_open": confirm_ts.isoformat(),
                        "knowable_at": bar_close_time(confirm_ts, interval).isoformat(),
                        "strategy_version": "pu30-strict-v3" if cfg.strict_threshold else "rsi-divergence-v2",
                        "guven_tazeleyen_tepe": {
                            "price": round(max_between, 2),
                            "date": max_between_ts.strftime(date_fmt),
                            "time": _epoch_seconds(max_between_ts),
                            "kirildi": bool(closes[-1] > max_between),
                        },
                        "tetiklendi": bool(closes[-1] > max_between),
                        "fibonacci_levels": fibonacci_levels,
                        "bounce_pct": round(bounce_pct, 2),
                        "bars_since_confirm": bars_since,
                        "gap_bars": gap,
                        "explanation": explanation,
                    }
                    break

        dips.append(d2)

    if signal and (ignore_lifetime or signal["bars_since_confirm"] <= cfg.signal_lifetime_bars):
        return signal
    return None


def detect_rsi_nu70(
    df: pd.DataFrame,
    cfg: NU70Config = DEFAULT_NU70_CONFIG,
    ignore_lifetime: bool = False,
    interval: str = "4h",
) -> Optional[Dict[str, Any]]:
    """
    NU70: Negatif Uyumsuzluk (Ayı / Zirve Satış) Sinyal Tespiti.
    Look-ahead bias ve repainting içermez; pivot oluşumu ile teyit zamanı ayrıştırılmıştır.
    """
    n = len(df)
    if n < MIN_BARS_REQUIRED:
        return None

    closes = df["close"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    dates = df["date"].to_numpy()
    is_closed_arr = df["is_closed"].to_numpy(dtype=bool) if "is_closed" in df.columns else np.array([is_bar_closed(t, interval) for t in dates])

    rsi = wilder_rsi(closes, cfg.rsi_length)
    pivot_indices = find_confirmed_pivot_highs(highs, cfg.pivot_left_bars, cfg.pivot_right_bars, is_closed_arr)

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

                # 1. Tepe kontrolü
                if np.isnan(t1["rsi"]):
                    continue
                # strict_threshold=True: ilk tepe kesinlikle 70 üstünde; eşitlik kabul edilmez.
                # strict_threshold=False ise Semih Ersoy trend uyumsuzluğu: tepeler min_rsi_peak (örn 45) üstünde olmalı
                if cfg.strict_threshold and t1["rsi"] <= cfg.rsi_threshold:
                    continue
                # Referans tabanı yalnızca 1. tepeye uygular (bkz. yukarıdaki PU30 notu, ayna kural).
                if not cfg.strict_threshold and t1["rsi"] < cfg.min_rsi_peak:
                    continue

                # 2. Tepe: Fiyat daha yüksek zirve yapmalı (Fiyat tepeleri yükseliyor)
                if cfg.require_higher_price and t2["price"] <= t1["price"]:
                    continue

                # 2. Tepe: RSI daha düşük tepe yapmalı (RSI tepeleri düşüyor - Semih Ersoy kuralı)
                if cfg.require_lower_rsi and t2["rsi"] >= t1["rsi"]:
                    continue

                # 2. Tepe RSI 70 altında: klasik NU70 (strict) modda zorunlu, esnek modda opsiyonel
                if (cfg.rsi2_below_threshold or cfg.strict_threshold) and t2["rsi"] >= cfg.rsi_threshold:
                    continue

                between_lo = lows[t1["index"] + 1:t2["index"]]
                if len(between_lo) == 0:
                    continue

                min_between = float(between_lo.min())
                pullback_pct = (1.0 - min_between / t1["price"]) * 100.0
                # Ayna kural: Tepe 2 aradaki en yüksek nokta olmalı
                max_between_nu = float(highs[t1["index"] + 1:t2["index"]].max())

                if max_between_nu <= t2["price"] and pullback_pct >= cfg.min_pullback_pct:
                    confirm_index = t2["index"] + cfg.pivot_right_bars
                    if confirm_index >= n:
                        continue

                    bars_since = (n - 1) - confirm_index
                    date_fmt = INTERVALS.get(interval, ("1y", "%Y-%m-%d %H:%M", 60))[1]

                    t1_ts = pd.Timestamp(dates[t1["index"]])
                    t2_ts = pd.Timestamp(dates[t2["index"]])
                    confirm_ts = pd.Timestamp(dates[confirm_index])

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

                    explanation = (
                        f"NU70 Negatif Uyumsuzluk: 1. Tepe {t1['price']:.2f} ₺ (RSI: {t1['rsi']:.1f}), "
                        f"2. Tepe {t2['price']:.2f} ₺ (RSI: {t2['rsi']:.1f}). "
                        f"Sinyal {confirm_ts.strftime(date_fmt)} mum kapanışında teyit edildi."
                    )

                    signal = {
                        "type": "NU70",
                        "trend": "BEAR",
                        "label": "NU70 (Tepe / Satis)",
                        "tepe1": {**t1, "date": t1_ts.strftime(date_fmt), "time": _epoch_seconds(t1_ts)},
                        "tepe2": {**t2, "date": t2_ts.strftime(date_fmt), "time": _epoch_seconds(t2_ts)},
                        "dip1": {**t1, "date": t1_ts.strftime(date_fmt), "time": _epoch_seconds(t1_ts)},
                        "dip2": {**t2, "date": t2_ts.strftime(date_fmt), "time": _epoch_seconds(t2_ts)},
                        "pivot_time": _epoch_seconds(t2_ts),
                        "pivot_date": t2_ts.strftime(date_fmt),
                        "confirm_index": confirm_index,
                        "confirm_time": _epoch_seconds(confirm_ts),
                        "confirm_date": confirm_ts.strftime(date_fmt),
                        "confirm_bar_open": confirm_ts.isoformat(),
                        "knowable_at": bar_close_time(confirm_ts, interval).isoformat(),
                        "strategy_version": "nu70-strict-v3" if cfg.strict_threshold else "rsi-divergence-v2",
                        "guven_kiran_dip": {
                            "price": round(min_between, 2),
                            "date": min_between_ts.strftime(date_fmt),
                            "time": _epoch_seconds(min_between_ts),
                            "kirildi": bool(closes[-1] < min_between),
                        },
                        "tetiklendi": bool(closes[-1] < min_between),
                        "fibonacci_levels": fibonacci_levels,
                        "pullback_pct": round(pullback_pct, 2),
                        "bounce_pct": round(pullback_pct, 2),
                        "bars_since_confirm": bars_since,
                        "gap_bars": gap,
                        "explanation": explanation,
                    }
                    break

        peaks.append(t2)

    if signal and (ignore_lifetime or signal["bars_since_confirm"] <= cfg.signal_lifetime_bars):
        return signal
    return None


def _normalize_symbol(symbol: str) -> str:
    return normalize_bist_symbol(symbol)


def _fetch_adjusted_bars(
    symbol: str, interval: str = "4h", period: Optional[str] = None
) -> Tuple[Optional[pd.DataFrame], Optional[DataResult]]:
    """DataProvider arayüzü üzerinden temizlenmiş ve BIST seansına hizalanmış veriyi getirir."""
    provider = get_default_provider()
    result = provider.fetch_ohlcv(symbol, interval=interval, period=period, include_forming_bar=False)
    if result.status in (DataStatus.ERROR, DataStatus.DELISTED) or result.df is None:
        return None, result
    return result.df, result


def hourly_trust_level(
    h1: pd.DataFrame, pivot_open: Any, interval: str, bull: bool,
    lb: int = 5, rb: int = 2,
) -> Dict[str, Any]:
    """
    Semih Hoca'nın saatlik güven seviyesi (ASELS 4s NU70 örneği: zirve 450 -> zirveyi
    geçemeyen tepe 439,50 -> aradaki dip 423,25; "ASELSAN 423'te sat vermiş").

    NU (bull=False): sinyalin 2. tepesinin saatlik zirvesinden sonra zirveyi geçemeyen ilk
    kesinleşmiş saatlik tepe aranır; ikisi arasındaki en düşük saatlik fiyat = güven kıran dip.
    PU (bull=True): ayna kural -- 2. dibin saatlik en düşük noktasından sonra dibi kıramayan ilk
    kesinleşmiş saatlik dip; aradaki en yüksek saatlik fiyat = güven tazeleyen tepe.
    Kırılım saatlik KAPANIŞLA sayılır (iğne mi kapanış mı sorusu Hoca'da açık).

    durum: "kirildi" | "bekleniyor_kirilim" | "bekleniyor_yapi" (alt tepe / üst dip henüz yok)
           | "gecersiz" (zirve aşıldı / dip kırıldı) | "veri_yok"
    """
    out: Dict[str, Any] = {"price": None, "durum": "veri_yok", "kirildi": False, "kaynak": "saatlik_yapi"}
    if h1 is None or len(h1) == 0:
        return out
    h1 = h1.reset_index(drop=True)
    if "is_closed" in h1.columns:
        h1 = h1[h1["is_closed"]].reset_index(drop=True)
    dates = pd.to_datetime(h1["date"])
    start = pd.Timestamp(pivot_open)
    if start.tzinfo is None:
        start = start.tz_localize("Europe/Istanbul")
    end = bar_close_time(start, interval)
    in_bar = ((dates + pd.Timedelta(hours=1)) > start) & (dates < end)
    if not in_bar.any():
        return out
    highs = h1["high"].to_numpy(dtype=np.float64)
    lows = h1["low"].to_numpy(dtype=np.float64)
    closes = h1["close"].to_numpy(dtype=np.float64)
    window = np.flatnonzero(in_bar.to_numpy())
    z = int(window[np.argmin(lows[window])] if bull else window[np.argmax(highs[window])])
    extreme = lows[z] if bull else highs[z]
    out["zirve" if not bull else "dip"] = {"price": round(float(extreme), 2), "date": dates.iloc[z].isoformat()}

    # Structure pivots after the extreme: the left window only looks at bars AFTER the
    # extreme. Otherwise a lower high formed a few hours after the zirve is never a pivot
    # (the zirve itself sits in its left window) and the first "zirveyi geçemeyen tepe"
    # is skipped (ASELS: 439,50 would be missed in favour of a later 434,50).
    series = lows if bull else highs
    pivots = []
    for p in range(z + 2, len(series) - rb):
        left = series[max(z + 1, p - lb):p]
        right = series[p + 1:p + rb + 1]
        if (np.all(series[p] < left) and np.all(series[p] <= right)) if bull else \
           (np.all(series[p] > left) and np.all(series[p] >= right)):
            pivots.append(p)
    for p in pivots:
        if bull and lows[z + 1:p + 1].min() < extreme:
            out["durum"] = "gecersiz"  # 2. dibin altına inildi: yapı bozuldu
            return out
        if not bull and highs[z + 1:p + 1].max() > extreme:
            out["durum"] = "gecersiz"  # zirve aşıldı
            return out
        between = slice(z + 1, p)
        if between.stop - between.start < 1:
            continue
        level = float(highs[between].max()) if bull else float(lows[between].min())
        lvl_idx = z + 1 + int(np.argmax(highs[between]) if bull else np.argmin(lows[between]))
        out["price"] = round(level, 2)
        out["date"] = dates.iloc[lvl_idx].isoformat()
        out["yapi_pivotu"] = {"price": round(float(lows[p] if bull else highs[p]), 2), "date": dates.iloc[p].isoformat()}
        after = closes[p + rb + 1:]  # kırılım ancak yapı pivotu kesinleştikten sonra sayılır
        hit = np.flatnonzero(after > level) if bull else np.flatnonzero(after < level)
        if len(hit):
            k = p + rb + 1 + int(hit[0])
            out.update(durum="kirildi", kirildi=True, kirilim_date=dates.iloc[k].isoformat())
        else:
            out["durum"] = "bekleniyor_kirilim"
        return out
    out["durum"] = "bekleniyor_yapi"
    return out


def apply_hourly_trust_level(sig: Dict[str, Any], df: pd.DataFrame, h1: Optional[pd.DataFrame], interval: str) -> None:
    """Replaces the signal's trigger level with Semih Hoca's hourly definition. The old
    between-pivot extreme is kept as `ara_bolge_*`; if the hourly structure has not formed
    yet the trigger level is None (shown as 'bekleniyor'), never the between-pivot value."""
    bull = sig["type"] == "PU30"
    key = "guven_tazeleyen_tepe" if bull else "guven_kiran_dip"
    p2 = sig["dip2"] if bull else sig["tepe2"]
    sig["ara_bolge_tepe" if bull else "ara_bolge_dip"] = sig.get(key)
    level = hourly_trust_level(h1, df["date"].iloc[p2["index"]], interval, bull)
    sig["saatlik_seviye"] = level
    if level["price"] is not None:
        sig[key] = {"price": level["price"], "date": level.get("date"), "kirildi": level["kirildi"], "kaynak": "saatlik_yapi"}
    else:
        sig[key] = None
    sig["tetiklendi"] = bool(level["kirildi"])


def _trigger_text(level: Dict[str, Any], bull: bool) -> str:
    name = "güven tazeleyen tepe" if bull else "güven kıran dip"
    act = "aşıldı: alış teyidi" if bull else "kırıldı: satış / stop"
    todo = "üzerinde saatlik kapanışta alış" if bull else "altında saatlik kapanışta satış"
    structure = "dibi kıramayan saatlik dip" if bull else "zirveyi geçemeyen saatlik tepe"
    durum = level.get("durum")
    if durum == "kirildi":
        return f"Saatlik {name} {level['price']} {act} ({level.get('kirilim_date', '')[:16]})."
    if durum == "bekleniyor_kirilim":
        return f"Saatlik {name} {level['price']}: {todo}."
    if durum == "bekleniyor_yapi":
        return f"Saatlik {name} henüz oluşmadı: önce {structure} bekleniyor."
    if durum == "gecersiz":
        return "Saatlik yapı bozuldu (" + ("2. dibin altına inildi" if bull else "zirve aşıldı") + "); sinyal zayıfladı."
    return "Saatlik veri alınamadı; tetik seviyesi hesaplanamadı."


def scan_universe_rsi_pu30(
    symbols: List[str],
    max_workers: int = 4,
    interval: str = "4h",
    signal_type: str = "all",  # "all", "pu30", "nu70"
) -> Dict[str, Any]:
    """
    Belirtilen sembol evrenini PU30 ve NU70 uyumsuzlukları için tarar.
    Çoklu zaman dilimi (1s ve 4s) çapraz kontrolünü uygular.
    """
    from concurrent.futures import ThreadPoolExecutor

    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []

    def _scan_one(symbol: str):
        try:
            df, data_res = _fetch_adjusted_bars(symbol, interval=interval)
            if df is None or len(df) < MIN_BARS_REQUIRED:
                err_msg = (data_res.error_message or "insufficient history") if data_res else "insufficient history"
                return symbol, [], err_msg

            if data_res.status != DataStatus.FRESH:
                return symbol, [], data_res.status.value
            found = []
            last_close = float(df["close"].iloc[-1])
            data_updated_at = data_res.last_bar_time if data_res else None
            data_status = data_res.status.value if data_res else "UNKNOWN"

            # Semih Hoca kural 3-4: 4s + günlük ana yön, 1s erken tetik / güven kıran dip.
            #   1s taramada üst teyit = 4s VEYA günlük; 4s taramada alt teyit = 1s.
            #   Karşı zaman dilimleri yalnızca sinyal bulunduğunda (lazy) çekilir.
            cross_intervals = {"1h": ["4h", "1d"], "4h": ["1h"], "1d": ["1h"]}.get(interval, [])
            _cross_cache: Dict[str, Optional[pd.DataFrame]] = {}

            def _cross_df(ci: str) -> Optional[pd.DataFrame]:
                if ci not in _cross_cache:
                    try:
                        cdf, cres = _fetch_adjusted_bars(symbol, interval=ci)
                        ok = cdf is not None and cres is not None and cres.status == DataStatus.FRESH
                        _cross_cache[ci] = cdf if ok else None
                    except Exception:
                        _cross_cache[ci] = None
                return _cross_cache[ci]

            def _cross_hits(detector, cfg_) -> List[str]:
                hits = []
                for ci in cross_intervals:
                    cdf = _cross_df(ci)
                    if cdf is not None and detector(cdf, cfg_, interval=ci):
                        hits.append(ci)
                return hits

            if signal_type in ("all", "pu30"):
                sig_pu = detect_rsi_pu30(df, DEFAULT_PU30_CONFIG, interval=interval)
                if sig_pu:
                    sig_pu["symbol"] = clean_symbol_display(symbol)
                    sig_pu["last_close"] = last_close
                    sig_pu["data_status"] = data_status
                    sig_pu["data_updated_at"] = data_updated_at

                    # Çoklu zaman dilimi (Multi-Timeframe) Çapraz Kontrolü
                    cross_pu = _cross_hits(detect_rsi_pu30, DEFAULT_PU30_CONFIG)
                    has_cross_pu = bool(cross_pu)
                    sig_pu["confirmed_timeframes"] = [interval] + cross_pu

                    apply_hourly_trust_level(sig_pu, df, df if interval == "1h" else _cross_df("1h"), interval)
                    if has_cross_pu:
                        sig_pu["confluence"] = "DOUBLE_BULL"
                        sig_pu["confluence_badge"] = f"💎 {' + '.join(sig_pu['confirmed_timeframes'])} ÇİFTE ONAY (ANA RALLİ)"
                        head = f"{' + '.join(_TF_LABEL.get(t, t) for t in sig_pu['confirmed_timeframes'])} teyitli ana dip dönüşü (Semih Hoca: 1s + 4s/G = ana dönüş)."
                    elif interval == "1h":
                        sig_pu["confluence"] = "SCALP_1H"
                        sig_pu["confluence_badge"] = "⚡ 1s TEPKİ YÜKSELİŞİ (KISA VADE)"
                        head = "Düşüş trendi içinde ara tepkidir (4s/G teyidi henüz yok). Kısa vadeli gir-çık."
                    else:
                        sig_pu["confluence"] = "MACRO_4H"
                        sig_pu["confluence_badge"] = f"🏛️ {_TF_LABEL.get(interval, interval)} ANA DÖNÜŞ (" + ("Saatlik Tetik Geldi" if sig_pu["tetiklendi"] else "Saatlik Tetik Bekleniyor") + ")"
                        head = f"{_TF_LABEL.get(interval, interval)} grafikte PU30 oluştu."
                    sig_pu["strategy_action"] = f"{head} {_trigger_text(sig_pu['saatlik_seviye'], bull=True)}"

                    found.append(sig_pu)

            if signal_type in ("all", "nu70"):
                sig_nu = detect_rsi_nu70(df, DEFAULT_NU70_CONFIG, interval=interval)
                if sig_nu:
                    sig_nu["symbol"] = clean_symbol_display(symbol)
                    sig_nu["last_close"] = last_close
                    sig_nu["data_status"] = data_status
                    sig_nu["data_updated_at"] = data_updated_at

                    cross_nu = _cross_hits(detect_rsi_nu70, DEFAULT_NU70_CONFIG)
                    has_cross_nu = bool(cross_nu)
                    sig_nu["confirmed_timeframes"] = [interval] + cross_nu

                    apply_hourly_trust_level(sig_nu, df, df if interval == "1h" else _cross_df("1h"), interval)
                    if has_cross_nu:
                        sig_nu["confluence"] = "DOUBLE_BEAR"
                        sig_nu["confluence_badge"] = f"🚨 {' + '.join(sig_nu['confirmed_timeframes'])} ÇİFTE DÜŞÜŞ (ZİRVE ÇÖKÜŞ)"
                        head = "Çoklu zaman diliminde tepe uyumsuzluğu (ana zirve)."
                    elif interval == "1h":
                        sig_nu["confluence"] = "SCALP_BEAR"
                        sig_nu["confluence_badge"] = "⚠️ 1s GÜVEN KIRAN DİP UYARISI"
                        head = "Saatlikte tepe uyumsuzluğu (4s/G teyidi yok): kısa düzeltme."
                    else:
                        sig_nu["confluence"] = "MACRO_BEAR"
                        sig_nu["confluence_badge"] = f"🔴 {_TF_LABEL.get(interval, interval)} TEPE YORULMASI"
                        head = f"{_TF_LABEL.get(interval, interval)} grafikte NU70 oluştu (spot hissede çıkış uyarısı)."
                    sig_nu["strategy_action"] = f"{head} {_trigger_text(sig_nu['saatlik_seviye'], bull=False)}"

                    found.append(sig_nu)

            return symbol, found, None
        except Exception as e:
            return symbol, [], str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for symbol, sigs, err in pool.map(_scan_one, symbols):
            if sigs:
                results.extend(sigs)
            elif err is not None:
                errors.append({"symbol": clean_symbol_display(symbol), "error": err})

    # En yeni teyit edilen sinyalleri başa yerleştir
    _rank = {"DOUBLE_BULL": 0, "DOUBLE_BEAR": 0}
    results.sort(key=lambda s: (_rank.get(s.get("confluence"), 1), s.get("bars_since_confirm", 999)))

    return {
        "signals": results,
        "errors": errors,
        "attempted": len(symbols),
        "scanned": len(symbols) - len(errors),
        "status": "error" if len(errors) == len(symbols) and errors else ("partial" if errors else "success"),
        "source": "yfinance_auto_adjust",
        "model_version": None,
        "calculated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "checks": {"closed_bars": True, "calendar": "REGULAR_SESSION_ONLY"},
        "matched": len(results),
        "interval": interval,
        "signal_type": signal_type,
    }


def get_symbol_chart_data(
    symbol: str, interval: str = "4h", period: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Sembol bazında mum, RSI serisi ve tespit edilen uyumsuzluk detaylarını getirir."""
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
    date_fmt = INTERVALS[interval][1]

    df, data_res = _fetch_adjusted_bars(symbol, interval=interval, period=period)
    if df is None:
        return None

    closes = df["close"].to_numpy(dtype=float)
    rsi = wilder_rsi(closes, 14)
    rsi_series = pd.Series(rsi)
    rsi_sma = rsi_series.rolling(14, min_periods=1).mean().to_numpy()

    sig_pu = detect_rsi_pu30(df, DEFAULT_PU30_CONFIG, ignore_lifetime=True, interval=interval)
    sig_nu = detect_rsi_nu70(df, DEFAULT_NU70_CONFIG, ignore_lifetime=True, interval=interval)
    if sig_pu or sig_nu:
        h1 = df if interval == "1h" else _fetch_adjusted_bars(symbol, interval="1h")[0]
        for sig in (sig_pu, sig_nu):
            if sig:
                apply_hourly_trust_level(sig, df, h1, interval)

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
            "volume": float(df["volume"].iloc[i]) if "volume" in df.columns else 0.0,
            "rsi": None if np.isnan(rsi[i]) else round(float(rsi[i]), 2),
            "rsi_sma": None if np.isnan(rsi_sma[i]) else round(float(rsi_sma[i]), 2),
            "is_closed": bool(df["is_closed"].iloc[i]) if "is_closed" in df.columns else True,
        })

    # En güncel teyit edilen sinyali birincil olarak seç
    if sig_pu and sig_nu:
        active_signal = sig_pu if sig_pu.get("bars_since_confirm", 999) <= sig_nu.get("bars_since_confirm", 999) else sig_nu
    else:
        active_signal = sig_pu or sig_nu

    clean_sym = clean_symbol_display(symbol)
    return {
        "symbol": clean_sym,
        "interval": interval,
        "data_status": data_res.status.value if data_res else "UNKNOWN",
        "data_updated_at": data_res.updated_at if data_res else None,
        "history_limit_note": data_res.history_limit_note if data_res else "",
        "bars": bars,
        "signal": active_signal,
        "pu30_signal": sig_pu,
        "nu70_signal": sig_nu,
    }
