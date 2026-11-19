# -*- coding: utf-8 -*-
"""
NU70 Mum Formasyonu (Asılan Adam / Kayan Yıldız) ve Erken Yüksek Tepe Aday Tespiti.
=================================================================================
- Tüm sayısal hesaplamalar `numpy.float64` ve `math.isfinite` / `np.isfinite` ile doğrulanır.
- Sıfır geleceğe bakış (zero look-ahead): yalnızca kapalı mumlar ve teyit sınırına kadar
  olan barlar incelenir.
- Bu modül katı NU70 sinyalini değiştirmez; mum formasyonu bağlamı ve ayrı "NU70_ADAY"
  erken izleme adayları üretir.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class TopCandleConfig:
    """Zirve mum formasyonu sınıflandırma eşikleri."""

    max_body_ratio: float = 0.35
    min_dominant_wick_body_mult: float = 2.0
    min_dominant_wick_range_ratio: float = 0.50
    max_opposite_wick_ratio: float = 0.25
    doji_body_ratio: float = 0.12
    equal_price_tolerance_pct: float = 0.25
    early_min_pullback_pct: float = 1.2
    early_min_gap_bars: int = 3
    early_max_gap_bars: int = 60


DEFAULT_TOP_CANDLE_CONFIG = TopCandleConfig()

_EARLY_LIFETIME_BARS = {"15m": 20, "1h": 36, "4h": 15, "1d": 15}


def _validate_ohlc(open_p: float, high_p: float, low_p: float, close_p: float) -> bool:
    if not all(math.isfinite(v) for v in (open_p, high_p, low_p, close_p)):
        return False
    if high_p < max(open_p, close_p) or min(open_p, close_p) < low_p:
        return False
    return (high_p - low_p) > 0.0


def classify_peak_candle(
    open_p: float,
    high_p: float,
    low_p: float,
    close_p: float,
    cfg: TopCandleConfig = DEFAULT_TOP_CANDLE_CONFIG,
) -> Dict[str, Any]:
    """Tek bir zirve mumunu Asılan Adam / Kayan Yıldız / Doji / Satış Mumu olarak sınıflar."""
    o = float(np.float64(open_p))
    h = float(np.float64(high_p))
    l = float(np.float64(low_p))
    c = float(np.float64(close_p))

    if not _validate_ohlc(o, h, l, c):
        return {
            "pattern": "NONE",
            "label_tr": "Yok",
            "is_hanging_man": False,
            "is_shooting_star": False,
            "is_reversal_top": False,
            "body_ratio": 0.0,
            "upper_wick_ratio": 0.0,
            "lower_wick_ratio": 0.0,
        }

    rng = h - l
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l

    body_ratio = body / rng
    upper_ratio = upper / rng
    lower_ratio = lower / rng

    pattern = "NONE"
    label_tr = "Yok"

    if (
        body_ratio <= cfg.max_body_ratio
        and lower >= max(cfg.min_dominant_wick_body_mult * body, cfg.min_dominant_wick_range_ratio * rng)
        and upper_ratio <= cfg.max_opposite_wick_ratio
    ):
        pattern = "ASILAN_ADAM"
        label_tr = "Asılan Adam"
    elif (
        body_ratio <= cfg.max_body_ratio
        and upper >= max(cfg.min_dominant_wick_body_mult * body, cfg.min_dominant_wick_range_ratio * rng)
        and lower_ratio <= cfg.max_opposite_wick_ratio
    ):
        pattern = "KAYAN_YILDIZ"
        label_tr = "Kayan Yıldız"
    elif body_ratio <= cfg.doji_body_ratio:
        pattern = "DOJI_TEPE"
        label_tr = "Doji Tepe"
    elif c < o and body_ratio >= 0.50:
        pattern = "BEARISH_BAR"
        label_tr = "Satış Mumu"

    return {
        "pattern": pattern,
        "label_tr": label_tr,
        "is_hanging_man": pattern == "ASILAN_ADAM",
        "is_shooting_star": pattern == "KAYAN_YILDIZ",
        "is_reversal_top": pattern in ("ASILAN_ADAM", "KAYAN_YILDIZ"),
        "body_ratio": round(float(body_ratio), 4),
        "upper_wick_ratio": round(float(upper_ratio), 4),
        "lower_wick_ratio": round(float(lower_ratio), 4),
    }


def evaluate_peak_candles(
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    rsi: np.ndarray,
    peak_index: int,
    confirm_index: int,
    cfg: TopCandleConfig = DEFAULT_TOP_CANDLE_CONFIG,
) -> Dict[str, Any]:
    """
    Zirve mumunu (`peak_index`) ve teyit penceresi içindeyse sonraki mumu (`peak_index + 1`)
    değerlendirir; Asılan Adam ve Kayan Yıldız önceliklidir.
    """
    n = len(highs)
    if not (0 <= peak_index < n):
        raise IndexError(f"peak_index out of bounds: {peak_index}")
    max_allowed = min(confirm_index, n - 1)

    def _inspect(idx: int, role: str) -> Dict[str, Any]:
        info = classify_peak_candle(opens[idx], highs[idx], lows[idx], closes[idx], cfg)
        r_val = float(rsi[idx]) if idx < len(rsi) and np.isfinite(rsi[idx]) else None
        info["bar_index"] = int(idx)
        info["bar_role"] = role
        info["rsi_at_pattern"] = round(r_val, 2) if r_val is not None else None
        return info

    peak_info = _inspect(peak_index, "peak")
    next_info = _inspect(peak_index + 1, "confirm_next") if (peak_index + 1) <= max_allowed else None

    # Öncelik: Asılan Adam > Kayan Yıldız > Doji Tepe > Zirve mumu
    priority = ("ASILAN_ADAM", "KAYAN_YILDIZ", "DOJI_TEPE", "BEARISH_BAR", "NONE")
    candidates = [peak_info] + ([next_info] if next_info is not None else [])
    chosen = peak_info
    for pat in priority:
        match = next((c for c in candidates if c["pattern"] == pat), None)
        if match is not None:
            chosen = match
            break

    r_peak = float(rsi[peak_index]) if peak_index < len(rsi) and np.isfinite(rsi[peak_index]) else None
    has_any_top = any(c["pattern"] in ("ASILAN_ADAM", "KAYAN_YILDIZ", "DOJI_TEPE") for c in candidates)

    return {
        **chosen,
        "rsi_at_peak": round(r_peak, 2) if r_peak is not None else None,
        "has_any_top_candle": bool(has_any_top),
        "peak_bar_pattern": peak_info["pattern"],
        "next_bar_pattern": next_info["pattern"] if next_info is not None else None,
    }


def _local_pivot_highs_3(highs: np.ndarray, is_closed: np.ndarray, lb: int = 3, rb: int = 1) -> List[int]:
    n = len(highs)
    w = lb + rb + 1
    if n < w:
        return []
    windows = np.lib.stride_tricks.sliding_window_view(highs, w)
    center = windows[:, lb : lb + 1]
    mask = np.all(center > windows[:, :lb], axis=1) & np.all(center >= windows[:, lb + 1 :], axis=1)
    closed_win = np.lib.stride_tricks.sliding_window_view(is_closed, w)
    mask &= np.all(closed_win, axis=1)
    return (np.flatnonzero(mask) + lb).tolist()


def detect_early_highest_nu70_candidate(
    df: pd.DataFrame,
    rsi: np.ndarray,
    interval: str = "4h",
    cfg: TopCandleConfig = DEFAULT_TOP_CANDLE_CONFIG,
) -> Optional[Dict[str, Any]]:
    """
    Katı `detect_rsi_nu70` tarafından yakalanmayan ancak görülen en yüksek fiyatta RSI < 70
    (veya Asılan Adam / Kayan Yıldız dönüş mumu) oluşturan erken/aday NU70 yapılarını bulur.

    Katı eşik ilkeleri korunur:
    - 1. tepe RSI kesinlikle > 70.0
    - 2. tepe fiyatı >= 1. tepe * (1 - 0.0025) ve son kapanmış bara kadar geçilmemiş olmalı
    - Ara bölgede 2. tepe seviyesinde daha önce RSI >= 70.0 görülmemiş olmalı
    - Dönüş çıktısı `type="NU70_ADAY"`, `is_strict=False` olarak etiketlenir.
    """
    if df is None or len(df) < 25:
        return None
    for col in ("open", "high", "low", "close", "date"):
        if col not in df.columns:
            return None

    opens = df["open"].to_numpy(dtype=np.float64)
    highs = df["high"].to_numpy(dtype=np.float64)
    lows = df["low"].to_numpy(dtype=np.float64)
    closes = df["close"].to_numpy(dtype=np.float64)
    dates = df["date"].to_numpy()
    is_closed = df["is_closed"].to_numpy(dtype=bool) if "is_closed" in df.columns else np.ones(len(df), dtype=bool)

    closed_indices = np.flatnonzero(is_closed)
    if len(closed_indices) < 20:
        return None
    last_closed = int(closed_indices[-1])
    if not np.isfinite(closes[last_closed]):
        return None

    eq_tol = 1.0 - cfg.equal_price_tolerance_pct / 100.0
    pivots = _local_pivot_highs_3(highs, is_closed, lb=3, rb=1)
    if not pivots:
        return None

    lifetime = _EARLY_LIFETIME_BARS.get(interval, 15)
    date_fmt = "%Y-%m-%d" if interval == "1d" else "%Y-%m-%d %H:%M"

    peaks: List[Dict[str, Any]] = []
    best_candidate: Optional[Dict[str, Any]] = None

    for p in pivots:
        if not (
            np.isfinite(opens[p])
            and np.isfinite(highs[p])
            and np.isfinite(lows[p])
            and np.isfinite(closes[p])
            and highs[p] > 0
        ):
            continue
        w_rsi = rsi[max(0, p - 3) : min(len(rsi), p + 2)]
        w_rsi = w_rsi[np.isfinite(w_rsi)]
        win_rsi = float(w_rsi.max()) if len(w_rsi) else float("nan")
        bar_rsi = float(rsi[p]) if np.isfinite(rsi[p]) else float("nan")
        t_as_t1 = {"index": p, "price": float(highs[p]), "rsi": win_rsi}

        # Sonraki mum bilgisi (yalnızca kapalı ise)
        has_next = (p + 1 <= last_closed) and bool(is_closed[p + 1]) and np.isfinite(rsi[p + 1])
        next_rsi = float(rsi[p + 1]) if has_next else float("nan")

        candle_p = classify_peak_candle(opens[p], highs[p], lows[p], closes[p], cfg)
        candle_next = (
            classify_peak_candle(opens[p + 1], highs[p + 1], lows[p + 1], closes[p + 1], cfg)
            if has_next
            else None
        )

        t2_rsi: Optional[float] = None
        cand_kind: Optional[str] = None
        confirm_idx = p + 1

        if np.isfinite(bar_rsi) and bar_rsi < 70.0:
            t2_rsi = bar_rsi
            cand_kind = "ASILAN_ADAM_TEPE" if (candle_p["is_hanging_man"] or (candle_next and candle_next["is_hanging_man"])) else "ERKEN_YUKSEK_TEPE_RSI70"
        elif (
            np.isfinite(bar_rsi)
            and bar_rsi <= 70.6
            and has_next
            and next_rsi < 70.0
            and (candle_p["is_reversal_top"] or (candle_next is not None and candle_next["is_reversal_top"]))
        ):
            t2_rsi = next_rsi
            cand_kind = "ASILAN_ADAM_TEPE" if (candle_p["is_hanging_man"] or (candle_next and candle_next["is_hanging_man"])) else "KAYAN_YILDIZ_TEPE"

        if t2_rsi is not None and cand_kind is not None and confirm_idx <= last_closed:
            # Görülen en yüksek fiyat kontrolü: p'den son kapalı bara kadar p aşılmamış olmalı
            if last_closed > p:
                post_hi = highs[p + 1 : last_closed + 1]
                if not np.all(np.isfinite(post_hi)) or float(post_hi.max()) > float(highs[p]) / eq_tol:
                    peaks.append(t_as_t1)
                    continue

            best_t1 = None
            for t1 in reversed(peaks):
                gap = p - t1["index"]
                if gap > cfg.early_max_gap_bars:
                    break
                if gap < cfg.early_min_gap_bars:
                    continue
                if not np.isfinite(t1["rsi"]) or t1["rsi"] <= 70.0:
                    continue
                if not np.isfinite(t1["price"]) or t1["price"] <= 0:
                    continue
                if highs[p] < t1["price"] * eq_tol:
                    continue
                if t2_rsi >= t1["rsi"]:
                    continue
                b_lo = lows[t1["index"] + 1 : p]
                b_hi = highs[t1["index"] + 1 : p]
                b_rsi = rsi[t1["index"] + 1 : p]
                if len(b_lo) == 0:
                    continue
                if not (np.all(np.isfinite(b_lo)) and np.all(np.isfinite(b_hi))):
                    continue
                min_btw = float(b_lo.min())
                pb_pct = (1.0 - min_btw / t1["price"]) * 100.0
                if not (np.isfinite(min_btw) and np.isfinite(pb_pct)) or pb_pct < cfg.early_min_pullback_pct:
                    continue
                if float(b_hi.max()) > float(highs[p]) / eq_tol:
                    continue
                if np.any((b_hi >= float(highs[p]) * eq_tol) & np.isfinite(b_rsi) & (b_rsi >= 70.0)):
                    continue
                if best_t1 is None or t1["price"] > best_t1["price"]:
                    best_t1 = t1

            if best_t1 is not None:
                bars_since = last_closed - confirm_idx
                if bars_since <= lifetime:
                    peak_candle = evaluate_peak_candles(opens, highs, lows, closes, rsi, p, confirm_idx, cfg)
                    b_lo = lows[best_t1["index"] + 1 : p]
                    min_btw = float(b_lo.min())
                    pb_pct = (1.0 - min_btw / best_t1["price"]) * 100.0
                    t1_ts = pd.Timestamp(dates[best_t1["index"]])
                    t2_ts = pd.Timestamp(dates[p])
                    c_ts = pd.Timestamp(dates[confirm_idx])
                    best_candidate = {
                        "type": "NU70_ADAY",
                        "trend": "BEAR",
                        "is_strict": False,
                        "candidate_kind": cand_kind,
                        "tepe1": {
                            "index": int(best_t1["index"]),
                            "price": round(float(best_t1["price"]), 4),
                            "rsi": round(float(best_t1["rsi"]), 2),
                            "date": t1_ts.strftime(date_fmt),
                        },
                        "tepe2": {
                            "index": int(p),
                            "price": round(float(highs[p]), 4),
                            "rsi": round(float(t2_rsi), 2),
                            "rsi_at_peak": round(float(bar_rsi), 2) if np.isfinite(bar_rsi) else None,
                            "date": t2_ts.strftime(date_fmt),
                        },
                        "peak_candle": peak_candle,
                        "guven_kiran_dip": {"price": round(min_btw, 2), "kirildi": bool(closes[last_closed] < min_btw)},
                        "pullback_pct": round(float(pb_pct), 2),
                        "gap_bars": int(p - best_t1["index"]),
                        "bars_since_confirm": int(bars_since),
                        "confirm_date": c_ts.strftime(date_fmt),
                        "last_close": round(float(closes[last_closed]), 2),
                        "explanation": (
                            f"Erken NU70 Adayı ({cand_kind}): 1. Tepe {best_t1['price']:.2f} (RSI {best_t1['rsi']:.1f}) -> "
                            f"2. Tepe {highs[p]:.2f} (RSI {t2_rsi:.1f}, Mum: {peak_candle['label_tr']})."
                        ),
                    }

        peaks.append(t_as_t1)

    return best_candidate
