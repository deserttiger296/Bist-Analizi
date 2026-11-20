# -*- coding: utf-8 -*-
"""
İzole Çift Yönlü İtki (1-2-3 Dalga & %361.8), Fibonacci Zaman ve
Sıfır Sızıntılı Walk-Forward (WFO) İstatistik Motoru.
==================================================================
- Üretim PU30/NU70 tarayıcılarından ve klasik /api/scan/rsi-pu30 sözleşmesinden %100 izoledir.
- Çift yönlüdür:
  * BULL (Yükseliş İtkisi): PU30 2. dibi (0) -> Dalga 1 tepesi (1) -> Dalga 2 yüksek dibi (2) -> Dalga 3 (+%100..+%361.8)
  * BEAR (Düşüş İtkisi):    NU70 2. tepesi (0) -> Dalga 1 dibi (1) -> Dalga 2 alçak tepesi (2) -> Dalga 3 (-%100..-%361.8)
- Tüm sayısal hesaplamalar `numpy.float64` ve `math.isfinite`/`np.isfinite` korumalıdır.
- Sıfır geleceğe bakış (zero look-ahead): Girişler kesinlikle t2 pivot teyidi (`t2 + rb` kapanışı)
  veya W1/GVT-GKD kapanış kırılımı sonrasında simüle edilir; stop her zaman P0 seviyesidir.
"""
from __future__ import annotations

import dataclasses
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from python_bot.engine.data.provider import DataStatus, clean_symbol_display, get_default_provider
from python_bot.engine.shield.expected_value import ExpectedValueFilter
from python_bot.engine.signals.rsi_pu30 import (
    DEFAULT_NU70_CONFIG,
    DEFAULT_PU30_CONFIG,
    INTERVALS,
    MIN_BARS_REQUIRED,
    SCAN_LIFETIME_BARS,
    SCAN_MIN_GAP_BARS,
    _EPOCH,
    _fetch_adjusted_bars,
    apply_hourly_trust_level,
    detect_rsi_nu70,
    detect_rsi_pu30,
    wilder_rsi,
)
from python_bot.engine.universe import BIST100_SYMBOLS

FIB_TIME_RATIOS: Tuple[float, ...] = (0.382, 0.618, 1.000, 1.382, 1.618, 2.618, 3.618)
FIB_PRICE_RATIOS: Tuple[float, ...] = (1.000, 1.618, 2.618, 3.618)
FIB_TIME_ALIGN_RATIOS: Tuple[str, ...] = ("0.618", "1.000", "1.618", "2.618", "3.618")
DEFAULT_ROUNDTRIP_COST_PCT: float = 0.25  # BIST komisyon + BSMV + slippage (%0.25)


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        f = float(np.float64(val))
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _df_timestamps(df: pd.DataFrame, interval: str) -> Tuple[pd.Series, np.ndarray, List[str]]:
    date_fmt = INTERVALS.get(interval, ("1y", "%Y-%m-%d %H:%M", 60))[1]
    dt_ser = pd.to_datetime(df["date"])
    date_strs = dt_ser.dt.strftime(date_fmt).tolist()
    dt_utc = dt_ser.dt.tz_convert("UTC").dt.tz_localize(None) if dt_ser.dt.tz is not None else dt_ser
    epochs = ((dt_utc - _EPOCH) // pd.Timedelta(seconds=1)).to_numpy(dtype=np.int64)
    return dt_utc, epochs, date_strs


def _next_weekday(ts: pd.Timestamp) -> pd.Timestamp:
    nxt = ts + pd.Timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += pd.Timedelta(days=1)
    return nxt


def _project_future_bist_timestamp(last_dt_naive: pd.Timestamp, steps: int, interval: str) -> Tuple[int, str]:
    """Son kapanmış BIST mumundan ileriye `steps` işlem mumu projekte eder."""
    date_fmt = INTERVALS.get(interval, ("1y", "%Y-%m-%d %H:%M", 60))[1]
    cur = pd.Timestamp(last_dt_naive)
    steps = max(1, int(steps))

    if interval == "1d":
        for _ in range(steps):
            cur = _next_weekday(cur)
    elif interval == "4h":
        for _ in range(steps):
            if cur.hour < 14:
                cur = cur.replace(hour=14, minute=30, second=0, microsecond=0)
            else:
                cur = _next_weekday(cur).replace(hour=10, minute=0, second=0, microsecond=0)
    elif interval == "1h":
        minute = cur.minute if cur.minute in (0, 30) else 0
        for _ in range(steps):
            cand = cur + pd.Timedelta(hours=1)
            if cand.hour > 17 or (cand.hour == 17 and cand.minute > 30):
                cur = _next_weekday(cur).replace(hour=10, minute=minute, second=0, microsecond=0)
            else:
                cur = cand
    else:  # 15m
        for _ in range(steps):
            cand = cur + pd.Timedelta(minutes=15)
            if cand.hour > 17 or (cand.hour == 17 and cand.minute > 45):
                cur = _next_weekday(cur).replace(hour=10, minute=0, second=0, microsecond=0)
            else:
                cur = cand

    epoch_sec = int((cur - _EPOCH) // pd.Timedelta(seconds=1))
    return epoch_sec, cur.strftime(date_fmt)


def _bar_target_info(
    closes: np.ndarray,
    dt_naive: pd.Series,
    epochs: np.ndarray,
    date_strs: List[str],
    t2: int,
    offset_bars: int,
    interval: str,
) -> Dict[str, Any]:
    target_idx = t2 + offset_bars
    if 0 <= target_idx < len(closes):
        close_val = _safe_float(closes[target_idx])
        return {
            "offset_bars": int(offset_bars),
            "target_index": int(target_idx),
            "target_date": date_strs[target_idx],
            "target_time": int(epochs[target_idx]),
            "is_future": False,
            "close_at_target": round(close_val, 2),
        }
    future_steps = max(1, target_idx - (len(closes) - 1))
    fut_epoch, fut_date = _project_future_bist_timestamp(dt_naive.iloc[-1], future_steps, interval)
    return {
        "offset_bars": int(offset_bars),
        "target_index": int(target_idx),
        "target_date": fut_date,
        "target_time": int(fut_epoch),
        "is_future": True,
        "close_at_target": None,
    }


def _compute_wave1_metrics(
    t0: int,
    t1: int,
    p0: float,
    p1: float,
    direction: str,
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    vols: np.ndarray,
    rsi: np.ndarray,
    date_strs: List[str],
) -> Dict[str, Any]:
    dt1 = max(int(t1 - t0), 1)
    is_bull = direction == "BULL"
    move_pct = ((p1 / max(p0, 1e-9)) - 1.0) * 100.0 if is_bull else (1.0 - (p1 / max(p0, 1e-9))) * 100.0
    rsi_start = _safe_float(rsi[t0], 50.0)
    rsi_seg = rsi[t0 : t1 + 1]
    fin_rsi = rsi_seg[np.isfinite(rsi_seg)]
    if len(fin_rsi) > 0:
        rsi_ext = float(np.max(fin_rsi)) if is_bull else float(np.min(fin_rsi))
    else:
        rsi_ext = rsi_start
    rsi_delta = (rsi_ext - rsi_start) if is_bull else (rsi_start - rsi_ext)

    w_o = opens[t0 : t1 + 1]
    w_c = closes[t0 : t1 + 1]
    w_h = highs[t0 : t1 + 1]
    w_l = lows[t0 : t1 + 1]
    ranges = np.maximum(w_h - w_l, 1e-9)
    body_ratios = np.abs(w_c - w_o) / ranges
    dir_bars = (w_c >= w_o) if is_bull else (w_c <= w_o)
    dir_bar_ratio = float(np.mean(dir_bars)) if len(dir_bars) > 0 else 0.0
    avg_body = float(np.mean(body_ratios[np.isfinite(body_ratios)])) if np.any(np.isfinite(body_ratios)) else 0.0

    pre_start = max(0, t0 - 20)
    pre_vols = vols[pre_start:t0]
    w_vols = vols[t0 : t1 + 1]
    pre_v = float(np.mean(pre_vols[np.isfinite(pre_vols)])) if len(pre_vols) > 0 and np.any(np.isfinite(pre_vols)) else 0.0
    w_v = float(np.mean(w_vols[np.isfinite(w_vols)])) if len(w_vols) > 0 and np.any(np.isfinite(w_vols)) else 0.0
    vol_ratio = (w_v / pre_v) if pre_v > 0.0 else 1.0

    return {
        "t1_index": int(t1),
        "t1_date": date_strs[t1],
        "p1_price": round(float(p1), 2),
        "duration_bars": dt1,
        "move_pct": round(float(move_pct), 2),
        "rsi_start": round(float(rsi_start), 1),
        "rsi_extreme": round(float(rsi_ext), 1),
        "rsi_delta": round(float(rsi_delta), 1),
        "directional_bar_ratio": round(float(dir_bar_ratio), 2),
        "avg_body_ratio": round(float(avg_body), 2),
        "vol_ratio": round(float(vol_ratio), 2),
    }


def analyze_bidirectional_impulse(
    df: pd.DataFrame,
    sig: Dict[str, Any],
    direction: str = "BULL",
    interval: str = "1h",
    lb: int = 5,
    rb: int = 2,
    min_retrace: float = 0.236,
    max_retrace: float = 0.886,
) -> Dict[str, Any]:
    """
    PU30 (BULL) veya NU70 (BEAR) sonrası 0 -> 1 -> 2 itki yapısını, kalite skorunu,
    %100/%161.8/%261.8/%361.8 lineer + log hedeflerini ve Mod A / Mod B Fib Zaman
    projeksiyonlarını hesaplar.
    """
    direction = direction.upper()
    if direction not in ("BULL", "BEAR"):
        raise ValueError(f"Unsupported direction: {direction}")
    is_bull = direction == "BULL"

    df_clean = df.reset_index(drop=True)
    if "is_closed" in df_clean.columns:
        df_clean = df_clean[df_clean["is_closed"]].reset_index(drop=True)

    if len(df_clean) < MIN_BARS_REQUIRED:
        return {"direction": direction, "durum": "yetersiz_veri"}

    opens = df_clean["open"].to_numpy(dtype=np.float64)
    highs = df_clean["high"].to_numpy(dtype=np.float64)
    lows = df_clean["low"].to_numpy(dtype=np.float64)
    closes = df_clean["close"].to_numpy(dtype=np.float64)
    vols = df_clean["volume"].to_numpy(dtype=np.float64) if "volume" in df_clean.columns else np.ones(len(df_clean), dtype=np.float64)
    rsi = wilder_rsi(closes, 14)
    dt_naive, epochs, date_strs = _df_timestamps(df_clean, interval)

    anchor = sig.get("dip2") if is_bull else (sig.get("tepe2") or sig.get("dip2"))
    if not anchor or "index" not in anchor:
        return {"direction": direction, "durum": "gecersiz_sinyal"}

    t0 = int(anchor["index"])
    if t0 < 0 or t0 >= len(df_clean):
        return {"direction": direction, "durum": "gecersiz_sinyal"}

    p0 = float(lows[t0]) if is_bull else float(highs[t0])
    if not (math.isfinite(p0) and p0 > 0.0):
        return {"direction": direction, "durum": "gecersiz_sinyal"}
    rsi0 = _safe_float(rsi[t0], 50.0)

    out: Dict[str, Any] = {
        "direction": direction,
        "interval": interval,
        "t0_index": t0,
        "t0_date": date_strs[t0],
        "t0_time": int(epochs[t0]),
        "p0_price": round(p0, 2),
        "rsi0": round(rsi0, 1),
        "durum": "itki_devam_ediyor",
    }

    # t0 sonrası Dalga 2 pivot adaylarını bul
    wave2_candidates: List[int] = []
    for p in range(t0 + 2, len(df_clean) - rb):
        if is_bull:
            left = lows[max(t0 + 1, p - lb) : p]
            right = lows[p + 1 : p + rb + 1]
            if len(left) > 0 and np.all(lows[p] < left) and np.all(lows[p] <= right):
                wave2_candidates.append(p)
        else:
            left = highs[max(t0 + 1, p - lb) : p]
            right = highs[p + 1 : p + rb + 1]
            if len(left) > 0 and np.all(highs[p] > left) and np.all(highs[p] >= right):
                wave2_candidates.append(p)

    selected_t1: Optional[int] = None
    selected_t2: Optional[int] = None
    selected_p1: float = 0.0
    selected_p2: float = 0.0
    selected_retrace: float = 0.0
    broken_p0 = False

    for cand_t2 in wave2_candidates:
        if is_bull:
            if float(np.nanmin(lows[t0 + 1 : cand_t2 + 1])) < p0:
                broken_p0 = True
                break
            between = highs[t0 + 1 : cand_t2]
            if len(between) == 0 or not np.any(np.isfinite(between)):
                continue
            cand_t1 = t0 + 1 + int(np.nanargmax(between))
            cand_p1 = float(highs[cand_t1])
            cand_p2 = float(lows[cand_t2])
            w1_h = cand_p1 - p0
            if w1_h <= 1e-9:
                continue
            retrace = (cand_p1 - cand_p2) / w1_h
        else:
            if float(np.nanmax(highs[t0 + 1 : cand_t2 + 1])) > p0:
                broken_p0 = True
                break
            between = lows[t0 + 1 : cand_t2]
            if len(between) == 0 or not np.any(np.isfinite(between)):
                continue
            cand_t1 = t0 + 1 + int(np.nanargmin(between))
            cand_p1 = float(lows[cand_t1])
            cand_p2 = float(highs[cand_t2])
            w1_h = p0 - cand_p1
            if w1_h <= 1e-9:
                continue
            retrace = (cand_p2 - cand_p1) / w1_h

        if not math.isfinite(retrace):
            continue
        # Sığ ara duraklamaları (< %23.6) gürültü olarak atla
        if retrace < min_retrace:
            continue
        # Aşırı derin geri çekilme (> %88.6) itki kalitesini bozar
        if retrace > max_retrace:
            continue

        selected_t1 = cand_t1
        selected_t2 = cand_t2
        selected_p1 = cand_p1
        selected_p2 = cand_p2
        selected_retrace = retrace
        break

    if selected_t2 is None or selected_t1 is None:
        if broken_p0:
            out["durum"] = "dip_kirildi_gecersiz" if is_bull else "tepe_kirildi_gecersiz"
            return out
        if t0 + 1 < len(df_clean):
            if is_bull:
                t1_curr = t0 + 1 + int(np.nanargmax(highs[t0 + 1 :]))
                p1_curr = float(highs[t1_curr])
            else:
                t1_curr = t0 + 1 + int(np.nanargmin(lows[t0 + 1 :]))
                p1_curr = float(lows[t1_curr])
            if math.isfinite(p1_curr) and ((is_bull and p1_curr > p0) or ((not is_bull) and p1_curr < p0)):
                out["aday_dalga1"] = _compute_wave1_metrics(
                    t0, t1_curr, p0, p1_curr, direction, opens, highs, lows, closes, vols, rsi, date_strs
                )
        return out

    t1, t2 = selected_t1, selected_t2
    p1, p2 = selected_p1, selected_p2
    w1 = _compute_wave1_metrics(t0, t1, p0, p1, direction, opens, highs, lows, closes, vols, rsi, date_strs)
    w1_height = abs(p1 - p0)
    dt1 = max(int(t1 - t0), 1)
    dt2 = max(int(t2 - t1), 1)
    dt02 = max(int(t2 - t0), 1)

    # Alt periyot GVT / GKD hizalama kontrolü
    lvl = sig.get("saatlik_seviye") or {}
    trust_price = lvl.get("price")
    gvt_gkd_aligned = False
    if trust_price is not None:
        tp = _safe_float(trust_price, float("nan"))
        if math.isfinite(tp) and tp > 0.0:
            gvt_gkd_aligned = abs(p1 - tp) / max(abs(p1), 1e-9) <= 0.025

    ideal_retrace = 0.382 <= selected_retrace <= 0.786
    quality_score = 0
    if ideal_retrace:
        quality_score += 40
    else:
        quality_score += 20
    if w1["rsi_delta"] >= 8.0:
        quality_score += 20
    elif w1["rsi_delta"] >= 4.0:
        quality_score += 10
    if w1["directional_bar_ratio"] >= 0.55:
        quality_score += 15
    if w1["vol_ratio"] >= 1.1:
        quality_score += 15
    if gvt_gkd_aligned:
        quality_score += 10

    if ideal_retrace and quality_score >= 65:
        quality_grade = "A+"
        quality_label = "A+ İdeal 1-2"
    elif quality_score >= 45:
        quality_grade = "B"
        quality_label = "B Geçerli 1-2"
    else:
        quality_grade = "C"
        quality_label = "C Zayıf 1-2"

    # Fib Zaman Projeksiyonları (Mod A: W1-Bazlı, Mod B: 0-2 Sündürme)
    proj_mod_a: Dict[str, Any] = {}
    proj_mod_b: Dict[str, Any] = {}
    for r in FIB_TIME_RATIOS:
        key = f"{r:.3f}"
        bars_a = max(1, int(round(dt1 * r)))
        proj_mod_a[key] = _bar_target_info(closes, dt_naive, epochs, date_strs, t2, bars_a, interval)
        bars_b = max(1, int(round(dt02 * r)))
        proj_mod_b[key] = _bar_target_info(closes, dt_naive, epochs, date_strs, t2, bars_b, interval)

    # Dalga 2 teyidi sonrası gerçekleşen Dalga 3 ilerlemesi
    after_t2_confirm = t2 + rb
    wave3_progress: Optional[Dict[str, Any]] = None
    if after_t2_confirm < len(df_clean):
        if is_bull:
            t3_ext = after_t2_confirm + int(np.nanargmax(highs[after_t2_confirm:]))
            p3_ext = float(highs[t3_ext])
            broke_w1 = bool(np.any(closes[after_t2_confirm:] > p1))
            w3_from_p2 = (p3_ext - p2) / max(w1_height, 1e-9)
            w3_from_p0 = (p3_ext - p0) / max(w1_height, 1e-9)
        else:
            t3_ext = after_t2_confirm + int(np.nanargmin(lows[after_t2_confirm:]))
            p3_ext = float(lows[t3_ext])
            broke_w1 = bool(np.any(closes[after_t2_confirm:] < p1))
            w3_from_p2 = (p2 - p3_ext) / max(w1_height, 1e-9)
            w3_from_p0 = (p0 - p3_ext) / max(w1_height, 1e-9)

        wave3_progress = {
            "w1_tepesi_kirildi": broke_w1,
            "extreme_price_after_w2": round(p3_ext, 2),
            "max_price_after_w2": round(p3_ext, 2),
            "extreme_date_after_w2": date_strs[t3_ext],
            "extreme_index_after_w2": int(t3_ext),
            "bars_from_t2_to_extreme": int(t3_ext - t2),
            "w3_vs_w1_price_ratio": round(float(w3_from_p2), 2),
            "w3_vs_w1_pct": round(float(w3_from_p2 * 100.0), 1),
            "w3_vs_w1_time_ratio": round(float((t3_ext - t2) / dt1), 2),
            "hedef_361_goruldu": bool(w3_from_p2 >= 3.618 or w3_from_p0 >= 3.618),
        }

    # Fib Fiyat Hedefleri (Trend Temelli P2, P0 Bölgesi, ve Log Ölçek)
    sign = 1.0 if is_bull else -1.0
    ratio_base = max(p1 / max(p0, 1e-9), 1e-4)
    fib_fiyat_hedefleri: Dict[str, Any] = {}
    for r in FIB_PRICE_RATIOS:
        key = f"{r:.3f}"
        target_from_w2 = round(max(0.01, p2 + sign * r * w1_height), 2)
        target_from_w0 = round(max(0.01, p0 + sign * r * w1_height), 2)
        target_log = round(max(0.01, p2 * (ratio_base ** r)), 2)
        zone_low = round(min(target_from_w0, target_from_w2), 2)
        zone_high = round(max(target_from_w0, target_from_w2), 2)
        if wave3_progress:
            ext_p = wave3_progress["extreme_price_after_w2"]
            if is_bull:
                reached_lin = bool(ext_p >= target_from_w2 or ext_p >= target_from_w0)
                reached_log = bool(ext_p >= target_log)
            else:
                reached_lin = bool(ext_p <= target_from_w2 or ext_p <= target_from_w0)
                reached_log = bool(ext_p <= target_log)
        else:
            reached_lin = False
            reached_log = False

        fib_fiyat_hedefleri[key] = {
            "ratio": key,
            "pct_label": f"{'+' if is_bull else '-'}%{round(r * 100, 1)}",
            "target_from_w2": target_from_w2,
            "target_from_w0": target_from_w0,
            "target_log": target_log,
            "zone_low": zone_low,
            "zone_high": zone_high,
            "reached": reached_lin,
            "reached_log": reached_log,
        }

    out.update({
        "durum": "1_2_yapisi_hazir",
        "ideal_retrace": ideal_retrace,
        "gvt_gkd_aligned": gvt_gkd_aligned,
        "trust_level_price": round(_safe_float(trust_price), 2) if trust_price is not None else None,
        "quality_score": int(quality_score),
        "quality_grade": quality_grade,
        "quality_label": quality_label,
        "points": {
            "p0": {"index": int(t0), "time": int(epochs[t0]), "date": date_strs[t0], "price": round(p0, 2), "rsi": round(rsi0, 1)},
            "p1": {"index": int(t1), "time": int(epochs[t1]), "date": date_strs[t1], "price": round(p1, 2), "rsi": round(_safe_float(rsi[t1], 50.0), 1)},
            "p2": {"index": int(t2), "time": int(epochs[t2]), "date": date_strs[t2], "price": round(p2, 2), "rsi": round(_safe_float(rsi[t2], 50.0), 1)},
        },
        "dalga1": w1,
        "dalga2": {
            "t2_index": int(t2),
            "t2_date": date_strs[t2],
            "t2_time": int(epochs[t2]),
            "p2_price": round(p2, 2),
            "rsi2": round(_safe_float(rsi[t2], 50.0), 1),
            "duration_bars": dt2,
            "price_retracement_fib": round(float(selected_retrace), 3),
            "time_ratio_dt2_over_dt1": round(float(dt2 / dt1), 2),
            "t1_position_in_02": round(float(dt1 / dt02), 3),
        },
        "fib_fiyat_hedefleri": fib_fiyat_hedefleri,
        "fib_zaman_w1_referans": proj_mod_a,
        "fib_zaman_02_sundurme": proj_mod_b,
        "dalga3_takip": wave3_progress,
    })
    return out


def extract_historical_divergences(
    df: pd.DataFrame,
    direction: str = "BULL",
    interval: str = "1h",
) -> List[Dict[str, Any]]:
    """
    Zaman serisindeki tüm geçmiş PU30 (BULL) veya NU70 (BEAR) pivot çiftlerini
    kronolojik olarak (sıfır geleceğe bakışla) çıkarır.
    """
    direction = direction.upper()
    is_bull = direction == "BULL"
    df_c = df.reset_index(drop=True)
    if "is_closed" in df_c.columns:
        df_c = df_c[df_c["is_closed"]].reset_index(drop=True)
    if len(df_c) < MIN_BARS_REQUIRED:
        return []

    highs = df_c["high"].to_numpy(dtype=np.float64)
    lows = df_c["low"].to_numpy(dtype=np.float64)
    closes = df_c["close"].to_numpy(dtype=np.float64)
    rsi = wilder_rsi(closes, 14)
    _, epochs, date_strs = _df_timestamps(df_c, interval)

    cfg = DEFAULT_PU30_CONFIG if is_bull else DEFAULT_NU70_CONFIG
    lb = cfg.pivot_left_bars
    rb = cfg.pivot_right_bars
    min_gap = SCAN_MIN_GAP_BARS.get(interval, cfg.min_gap_bars)
    max_gap = cfg.max_gap_bars
    eq_tol = cfg.equal_price_tolerance_pct / 100.0
    min_move_pct = cfg.min_bounce_pct if is_bull else cfg.min_pullback_pct

    pivots: List[Dict[str, Any]] = []
    events: List[Dict[str, Any]] = []
    used_p2: set = set()

    for p in range(lb, len(df_c) - rb):
        if not (math.isfinite(highs[p]) and math.isfinite(lows[p]) and math.isfinite(closes[p])):
            continue
        if is_bull:
            if not (np.all(lows[p] < lows[p - lb : p]) and np.all(lows[p] <= lows[p + 1 : p + rb + 1])):
                continue
            w_rsi = rsi[max(0, p - 3) : min(len(rsi), p + 2)]
            fin_w = w_rsi[np.isfinite(w_rsi)]
            if len(fin_w) == 0:
                continue
            p_rsi_min = float(np.min(fin_w))
            bar_rsi = _safe_float(rsi[p], float("nan"))
            next_rsi = _safe_float(rsi[p + 1], float("nan")) if (p + 1 < len(rsi)) else float("nan")
            p2_rsi = bar_rsi if (math.isfinite(bar_rsi) and bar_rsi > 30.0) else (next_rsi if (math.isfinite(next_rsi) and next_rsi > 30.0) else float("nan"))
            cur_piv = {"index": p, "price": float(lows[p]), "rsi_ext": p_rsi_min}

            if math.isfinite(p2_rsi) and p2_rsi > 30.0 and p not in used_p2:
                best_p1 = None
                for prev in reversed(pivots):
                    gap = p - prev["index"]
                    if gap > max_gap:
                        break
                    if gap < min_gap:
                        continue
                    if prev["rsi_ext"] >= 30.0:
                        continue
                    if lows[p] > prev["price"] * (1.0 + eq_tol):
                        continue
                    if p2_rsi <= prev["rsi_ext"]:
                        continue
                    mid_hi = highs[prev["index"] + 1 : p]
                    if len(mid_hi) == 0 or not np.any(np.isfinite(mid_hi)):
                        continue
                    bounce = (float(np.nanmax(mid_hi)) / max(prev["price"], 1e-9) - 1.0) * 100.0
                    if bounce < min_move_pct:
                        continue
                    if best_p1 is None or prev["price"] < best_p1["price"]:
                        best_p1 = prev
                if best_p1 is not None:
                    used_p2.add(p)
                    events.append({
                        "type": "PU30",
                        "direction": "BULL",
                        "confirm_index": int(p + rb),
                        "confirm_date": date_strs[p + rb],
                        "dip1": {"index": best_p1["index"], "price": round(best_p1["price"], 2), "rsi": round(best_p1["rsi_ext"], 1), "date": date_strs[best_p1["index"]], "time": int(epochs[best_p1["index"]])},
                        "dip2": {"index": p, "price": round(float(lows[p]), 2), "rsi": round(p2_rsi, 1), "date": date_strs[p], "time": int(epochs[p])},
                    })
            pivots.append(cur_piv)
        else:
            if not (np.all(highs[p] > highs[p - lb : p]) and np.all(highs[p] >= highs[p + 1 : p + rb + 1])):
                continue
            w_rsi = rsi[max(0, p - 3) : min(len(rsi), p + 2)]
            fin_w = w_rsi[np.isfinite(w_rsi)]
            if len(fin_w) == 0:
                continue
            p_rsi_max = float(np.max(fin_w))
            bar_rsi = _safe_float(rsi[p], float("nan"))
            next_rsi = _safe_float(rsi[p + 1], float("nan")) if (p + 1 < len(rsi)) else float("nan")
            p2_rsi = bar_rsi if (math.isfinite(bar_rsi) and bar_rsi < 70.0) else (next_rsi if (math.isfinite(next_rsi) and next_rsi < 70.0) else float("nan"))
            cur_piv = {"index": p, "price": float(highs[p]), "rsi_ext": p_rsi_max}

            if math.isfinite(p2_rsi) and p2_rsi < 70.0 and p not in used_p2:
                best_p1 = None
                for prev in reversed(pivots):
                    gap = p - prev["index"]
                    if gap > max_gap:
                        break
                    if gap < min_gap:
                        continue
                    if prev["rsi_ext"] <= 70.0:
                        continue
                    if highs[p] < prev["price"] * (1.0 - eq_tol):
                        continue
                    if p2_rsi >= prev["rsi_ext"]:
                        continue
                    mid_lo = lows[prev["index"] + 1 : p]
                    if len(mid_lo) == 0 or not np.any(np.isfinite(mid_lo)):
                        continue
                    pb = (1.0 - float(np.nanmin(mid_lo)) / max(prev["price"], 1e-9)) * 100.0
                    if pb < min_move_pct:
                        continue
                    if best_p1 is None or prev["price"] > best_p1["price"]:
                        best_p1 = prev
                if best_p1 is not None:
                    used_p2.add(p)
                    events.append({
                        "type": "NU70",
                        "direction": "BEAR",
                        "confirm_index": int(p + rb),
                        "confirm_date": date_strs[p + rb],
                        "tepe1": {"index": best_p1["index"], "price": round(best_p1["price"], 2), "rsi": round(best_p1["rsi_ext"], 1), "date": date_strs[best_p1["index"]], "time": int(epochs[best_p1["index"]])},
                        "tepe2": {"index": p, "price": round(float(highs[p]), 2), "rsi": round(p2_rsi, 1), "date": date_strs[p], "time": int(epochs[p])},
                    })
            pivots.append(cur_piv)

    return events


def _simulate_single_entry(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    entry_idx: int,
    stop_price: float,
    targets: Dict[str, float],
    direction: str,
    t2_idx: int,
    mod_a_indices: List[int],
    mod_b_indices: List[int],
    max_horizon: int,
) -> Optional[Dict[str, Any]]:
    if entry_idx < 0 or entry_idx >= len(closes) - 1:
        return None
    entry_price = float(closes[entry_idx])
    if not (math.isfinite(entry_price) and entry_price > 0.0 and math.isfinite(stop_price) and stop_price > 0.0):
        return None

    is_bull = direction == "BULL"
    if is_bull and entry_price <= stop_price:
        return None
    if (not is_bull) and entry_price >= stop_price:
        return None

    end_idx = min(len(closes) - 1, entry_idx + max_horizon)
    hit_bars: Dict[str, Optional[int]] = {"1.000": None, "1.618": None, "2.618": None, "3.618": None}
    stopped_idx: Optional[int] = None
    best_ext_idx = entry_idx
    best_ext_price = entry_price

    for k in range(entry_idx + 1, end_idx + 1):
        h_k = float(highs[k])
        l_k = float(lows[k])
        if not (math.isfinite(h_k) and math.isfinite(l_k)):
            continue

        # Muhafazakâr bar içi sıralama: aynı barda hem stop hem hedef temas ederse stop önce sayılır
        if is_bull:
            if l_k <= stop_price:
                stopped_idx = k
                break
            if h_k > best_ext_price:
                best_ext_price = h_k
                best_ext_idx = k
            for rk, tp in targets.items():
                if hit_bars[rk] is None and h_k >= tp:
                    hit_bars[rk] = int(k - entry_idx)
        else:
            if h_k >= stop_price:
                stopped_idx = k
                break
            if l_k < best_ext_price:
                best_ext_price = l_k
                best_ext_idx = k
            for rk, tp in targets.items():
                if hit_bars[rk] is None and l_k <= tp:
                    hit_bars[rk] = int(k - entry_idx)

    # Birincil işlem sonucu: %161.8 hedefi veya P0 stop veya vade sonu kapanışı
    tp161 = targets["1.618"]
    if hit_bars["1.618"] is not None:
        raw_ret_pct = ((tp161 / entry_price) - 1.0) * 100.0 if is_bull else (1.0 - (tp161 / entry_price)) * 100.0
        outcome = "WIN_161"
    elif stopped_idx is not None:
        raw_ret_pct = ((stop_price / entry_price) - 1.0) * 100.0 if is_bull else (1.0 - (stop_price / entry_price)) * 100.0
        outcome = "STOP_P0"
    else:
        exit_c = float(closes[end_idx])
        raw_ret_pct = ((exit_c / entry_price) - 1.0) * 100.0 if is_bull else (1.0 - (exit_c / entry_price)) * 100.0
        outcome = "TIME_EXIT"

    fib_time_hit_a = any(abs(best_ext_idx - idx) <= 1 for idx in mod_a_indices)
    fib_time_hit_b = any(abs(best_ext_idx - idx) <= 1 for idx in mod_b_indices)
    stop_dist_pct = abs(entry_price - stop_price) / entry_price * 100.0
    tp161_dist_pct = abs(tp161 - entry_price) / entry_price * 100.0

    return {
        "entry_index": int(entry_idx),
        "entry_price": round(entry_price, 2),
        "stop_price": round(stop_price, 2),
        "stop_dist_pct": round(float(stop_dist_pct), 2),
        "tp161_dist_pct": round(float(tp161_dist_pct), 2),
        "outcome": outcome,
        "raw_ret_pct": round(float(raw_ret_pct), 2),
        "hit_100": hit_bars["1.000"] is not None,
        "hit_161": hit_bars["1.618"] is not None,
        "hit_261": hit_bars["2.618"] is not None,
        "hit_361": hit_bars["3.618"] is not None,
        "bars_to_100": hit_bars["1.000"],
        "bars_to_161": hit_bars["1.618"],
        "bars_to_261": hit_bars["2.618"],
        "bars_to_361": hit_bars["3.618"],
        "fib_time_hit_a": bool(fib_time_hit_a),
        "fib_time_hit_b": bool(fib_time_hit_b),
        "bars_t2_to_extreme": int(best_ext_idx - t2_idx),
    }


def _aggregate_wfo_trades(
    trades: List[Dict[str, Any]],
    roundtrip_cost_pct: float = DEFAULT_ROUNDTRIP_COST_PCT,
) -> Dict[str, Any]:
    n = len(trades)
    if n == 0:
        return {
            "count": 0,
            "win_rate_pct": 0.0,
            "hit_100_pct": 0.0,
            "hit_161_pct": 0.0,
            "hit_261_pct": 0.0,
            "hit_361_pct": 0.0,
            "avg_bars_to_161": None,
            "avg_bars_to_361": None,
            "fib_time_hit_mod_a_pct": 0.0,
            "fib_time_hit_mod_b_pct": 0.0,
            "avg_win_pct": 0.0,
            "avg_loss_pct": 0.0,
            "profit_factor": 0.0,
            "gross_ev_pct": 0.0,
            "net_ev_pct": 0.0,
            "net_rr_ratio": 0.0,
            "ev_status": "NO_TRADES",
            "ideal_a_plus_count": 0,
            "ideal_a_plus_hit_161_pct": 0.0,
            "ideal_a_plus_hit_361_pct": 0.0,
        }

    net_rets = np.array([_safe_float(t["raw_ret_pct"]) - roundtrip_cost_pct for t in trades], dtype=np.float64)
    wins = net_rets[net_rets > 0.0]
    losses = net_rets[net_rets <= 0.0]

    win_prob = float(len(wins) / n)
    avg_win = float(np.mean(wins)) if len(wins) > 0 else 0.0
    avg_loss = float(abs(np.mean(losses))) if len(losses) > 0 else 0.0

    gross_profit = float(np.sum(np.maximum(net_rets, 0.0)))
    gross_loss = float(abs(np.sum(np.minimum(net_rets, 0.0))))
    pf = round(gross_profit / gross_loss, 2) if gross_loss > 1e-9 else (9.99 if gross_profit > 0 else 0.0)

    ev_filter = ExpectedValueFilter(min_ev_threshold=0.0, default_roundtrip_cost_pct=roundtrip_cost_pct)
    raw_wins = [float(t["raw_ret_pct"]) for t in trades if float(t["raw_ret_pct"]) > 0.0]
    raw_losses = [abs(float(t["raw_ret_pct"])) for t in trades if float(t["raw_ret_pct"]) <= 0.0]
    raw_win_p = len(raw_wins) / n
    raw_avg_w = float(np.mean(raw_wins)) if raw_wins else 0.0
    raw_avg_l = float(np.mean(raw_losses)) if raw_losses else 0.0
    ev_res = ev_filter.evaluate_trade(raw_win_p, raw_avg_w, raw_avg_l, roundtrip_cost_pct=roundtrip_cost_pct)

    b161 = [int(t["bars_to_161"]) for t in trades if t.get("bars_to_161") is not None]
    b361 = [int(t["bars_to_361"]) for t in trades if t.get("bars_to_361") is not None]
    a_plus = [t for t in trades if t.get("quality_grade") == "A+"]

    return {
        "count": n,
        "win_rate_pct": round(win_prob * 100.0, 1),
        "hit_100_pct": round(sum(1 for t in trades if t["hit_100"]) / n * 100.0, 1),
        "hit_161_pct": round(sum(1 for t in trades if t["hit_161"]) / n * 100.0, 1),
        "hit_261_pct": round(sum(1 for t in trades if t["hit_261"]) / n * 100.0, 1),
        "hit_361_pct": round(sum(1 for t in trades if t["hit_361"]) / n * 100.0, 1),
        "avg_bars_to_161": round(float(np.mean(b161)), 1) if b161 else None,
        "avg_bars_to_361": round(float(np.mean(b361)), 1) if b361 else None,
        "fib_time_hit_mod_a_pct": round(sum(1 for t in trades if t["fib_time_hit_a"]) / n * 100.0, 1),
        "fib_time_hit_mod_b_pct": round(sum(1 for t in trades if t["fib_time_hit_b"]) / n * 100.0, 1),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "profit_factor": pf,
        "gross_ev_pct": round(float(ev_res["gross_expected_value_pct"]), 2),
        "net_ev_pct": round(float(ev_res["expected_value_pct"]), 2),
        "net_rr_ratio": round(float(ev_res["net_reward_to_risk"]), 2),
        "ev_status": ev_res["status"],
        "ideal_a_plus_count": len(a_plus),
        "ideal_a_plus_hit_161_pct": round(sum(1 for t in a_plus if t["hit_161"]) / len(a_plus) * 100.0, 1) if a_plus else 0.0,
        "ideal_a_plus_hit_361_pct": round(sum(1 for t in a_plus if t["hit_361"]) / len(a_plus) * 100.0, 1) if a_plus else 0.0,
    }


def _build_wfo_folds(
    t2_trades: List[Dict[str, Any]],
    w1_trades: List[Dict[str, Any]],
    roundtrip_cost_pct: float,
) -> List[Dict[str, Any]]:
    """Kronolojik 3 Walk-Forward OOS dilimi üretir (train_end < test_start)."""
    sorted_t2 = sorted(t2_trades, key=lambda x: x["t2_date"])
    sorted_w1 = sorted(w1_trades, key=lambda x: x["t2_date"])
    if len(sorted_t2) < 6:
        return []
    # İlk %25 başlangıç kalibrasyon penceresi, kalan %75 3 kronolojik OOS fold
    n = len(sorted_t2)
    train_init = max(2, n // 4)
    oos_slice = sorted_t2[train_init:]
    chunk = max(1, len(oos_slice) // 3)
    folds: List[Dict[str, Any]] = []
    for f_idx in range(3):
        start = f_idx * chunk
        end = len(oos_slice) if f_idx == 2 else min(len(oos_slice), (f_idx + 1) * chunk)
        fold_t2 = oos_slice[start:end]
        if not fold_t2:
            continue
        start_d = fold_t2[0]["t2_date"]
        end_d = fold_t2[-1]["t2_date"]
        fold_w1 = [x for x in sorted_w1 if start_d <= x["t2_date"] <= end_d]
        folds.append({
            "fold": f_idx + 1,
            "train_events": train_init + start,
            "oos_start": start_d,
            "oos_end": end_d,
            "t2_confirm": _aggregate_wfo_trades(fold_t2, roundtrip_cost_pct),
            "w1_breakout": _aggregate_wfo_trades(fold_w1, roundtrip_cost_pct),
        })
    return folds


def _evaluate_symbol_wfo(
    sym: str,
    interval: str,
    directions: Sequence[str],
    scale: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Optional[str]]:
    try:
        df, res = _fetch_adjusted_bars(sym, interval=interval)
        if res is not None and res.status != DataStatus.FRESH:
            return [], [], f"{sym}: {res.status.value}"
        if df is None or len(df) < MIN_BARS_REQUIRED + 10:
            return [], [], None

        df_c = df.reset_index(drop=True)
        if "is_closed" in df_c.columns:
            df_c = df_c[df_c["is_closed"]].reset_index(drop=True)
        if len(df_c) < MIN_BARS_REQUIRED + 10:
            return [], [], None

        highs = df_c["high"].to_numpy(dtype=np.float64)
        lows = df_c["low"].to_numpy(dtype=np.float64)
        closes = df_c["close"].to_numpy(dtype=np.float64)
        max_horizon = 120 if interval in ("15m", "1h") else 60
        rb = 2

        t2_records: List[Dict[str, Any]] = []
        w1_records: List[Dict[str, Any]] = []

        for d in directions:
            events = extract_historical_divergences(df_c, direction=d, interval=interval)
            for ev in events:
                imp = analyze_bidirectional_impulse(df_c, ev, direction=d, interval=interval, rb=rb)
                if imp.get("durum") != "1_2_yapisi_hazir":
                    continue
                p0 = float(imp["p0_price"])
                p1 = float(imp["dalga1"]["p1_price"])
                t2_idx = int(imp["dalga2"]["t2_index"])
                t2_entry_idx = t2_idx + rb
                if t2_entry_idx >= len(closes) - 2:
                    continue

                targets = {
                    rk: float(v["target_log"] if scale == "log" else v["target_from_w2"])
                    for rk, v in imp["fib_fiyat_hedefleri"].items()
                }
                mod_a_idx = [int(imp["fib_zaman_w1_referans"][k]["target_index"]) for k in FIB_TIME_ALIGN_RATIOS if k in imp["fib_zaman_w1_referans"]]
                mod_b_idx = [int(imp["fib_zaman_02_sundurme"][k]["target_index"]) for k in FIB_TIME_ALIGN_RATIOS if k in imp["fib_zaman_02_sundurme"]]

                base_meta = {
                    "symbol": clean_symbol_display(sym),
                    "interval": interval,
                    "direction": d,
                    "t0_date": imp["t0_date"],
                    "t2_date": imp["dalga2"]["t2_date"],
                    "quality_grade": imp["quality_grade"],
                    "retrace_fib": imp["dalga2"]["price_retracement_fib"],
                }

                sim_t2 = _simulate_single_entry(
                    highs, lows, closes, t2_entry_idx, p0, targets, d, t2_idx, mod_a_idx, mod_b_idx, max_horizon
                )
                if sim_t2 is not None:
                    t2_records.append({**base_meta, **sim_t2})

                # W1 / GVT-GKD Kırılım Girişi: t2_entry_idx sonrasında P0 kırılmadan P1 kapanış kırılımı
                w1_break_idx: Optional[int] = None
                is_bull = d == "BULL"
                for k in range(t2_entry_idx, min(len(closes) - 1, t2_entry_idx + 40)):
                    if is_bull:
                        if lows[k] <= p0:
                            break
                        if closes[k] > p1:
                            w1_break_idx = k
                            break
                    else:
                        if highs[k] >= p0:
                            break
                        if closes[k] < p1:
                            w1_break_idx = k
                            break

                if w1_break_idx is not None:
                    sim_w1 = _simulate_single_entry(
                        highs, lows, closes, w1_break_idx, p0, targets, d, t2_idx, mod_a_idx, mod_b_idx, max_horizon
                    )
                    if sim_w1 is not None:
                        w1_records.append({**base_meta, **sim_w1})

        return t2_records, w1_records, None
    except Exception as exc:
        return [], [], f"{sym}: {type(exc).__name__}: {exc}"


def run_impulse_wfo(
    symbols: Optional[Sequence[str]] = None,
    intervals: Sequence[str] = ("1h", "4h", "1d"),
    direction: str = "all",
    scale: str = "linear",
    roundtrip_cost_pct: float = DEFAULT_ROUNDTRIP_COST_PCT,
    max_workers: int = 6,
) -> Dict[str, Any]:
    """BIST evreninde sıfır sızıntılı Çift Yönlü İtki Walk-Forward (WFO) raporu üretir."""
    target_syms = [clean_symbol_display(s) for s in (symbols or BIST100_SYMBOLS) if s and s.strip()]
    dirs: Tuple[str, ...] = ("BULL",) if direction.upper() == "BULL" else (("BEAR",) if direction.upper() == "BEAR" else ("BULL", "BEAR"))
    scale_mode = "log" if str(scale).lower() == "log" else "linear"

    by_interval: Dict[str, Any] = {}
    errors: List[str] = []

    provider = get_default_provider()
    for itv in intervals:
        if itv not in INTERVALS:
            continue
        if len(target_syms) > 1 and hasattr(provider, "prefetch_ohlcv_batch"):
            try:
                provider.prefetch_ohlcv_batch(target_syms, interval=itv)
            except Exception:
                pass

        all_t2: List[Dict[str, Any]] = []
        all_w1: List[Dict[str, Any]] = []

        def _worker(sym_name: str, _itv: str = itv):
            return _evaluate_symbol_wfo(sym_name, _itv, dirs, scale_mode)

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for t2_r, w1_r, err in pool.map(_worker, target_syms):
                all_t2.extend(t2_r)
                all_w1.extend(w1_r)
                if err:
                    errors.append(err)

        def _slice_summary(dir_filter: Optional[str]) -> Dict[str, Any]:
            t2_sub = [x for x in all_t2 if dir_filter is None or x["direction"] == dir_filter]
            w1_sub = [x for x in all_w1 if dir_filter is None or x["direction"] == dir_filter]
            return {
                "t2_confirm": _aggregate_wfo_trades(t2_sub, roundtrip_cost_pct),
                "w1_breakout": _aggregate_wfo_trades(w1_sub, roundtrip_cost_pct),
                "folds": _build_wfo_folds(t2_sub, w1_sub, roundtrip_cost_pct),
            }

        recent_samples = sorted(all_w1 or all_t2, key=lambda x: x["t2_date"], reverse=True)[:15]
        by_interval[itv] = {
            "interval": itv,
            "all": _slice_summary(None),
            "BULL": _slice_summary("BULL"),
            "BEAR": _slice_summary("BEAR"),
            "recent_samples": recent_samples,
        }

    return {
        "status": "success",
        "mode": "impulse_wfo",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "universe_count": len(target_syms),
        "intervals": list(by_interval.keys()),
        "direction": direction.lower(),
        "scale": scale_mode,
        "roundtrip_cost_pct": roundtrip_cost_pct,
        "error_count": len(errors),
        "errors": errors[:20],
        "by_interval": by_interval,
    }


def scan_bidirectional_impulses(
    symbols: Optional[Sequence[str]] = None,
    interval: str = "1h",
    direction: str = "all",
    scale: str = "linear",
    max_workers: int = 6,
) -> Dict[str, Any]:
    """Seçili hisselerde güncel PU30 (BULL) ve NU70 (BEAR) 1-2-3 İtki yapılarını tarar."""
    itv = interval if interval in ("15m", "1h", "4h", "1d") else "1h"
    target_syms = [clean_symbol_display(s) for s in (symbols or BIST100_SYMBOLS[:13]) if s and s.strip()]
    dirs: Tuple[str, ...] = ("BULL",) if direction.upper() == "BULL" else (("BEAR",) if direction.upper() == "BEAR" else ("BULL", "BEAR"))
    scale_mode = "log" if str(scale).lower() == "log" else "linear"

    provider = get_default_provider()
    if len(target_syms) > 1 and hasattr(provider, "prefetch_ohlcv_batch"):
        try:
            provider.prefetch_ohlcv_batch(target_syms, interval=itv)
        except Exception:
            pass

    pu_cfg = dataclasses.replace(
        DEFAULT_PU30_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(itv, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(itv, 8),
    )
    nu_cfg = dataclasses.replace(
        DEFAULT_NU70_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(itv, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(itv, 8),
    )
    sub_itv = "15m" if itv in ("15m", "1h") else "1h"

    def _scan_one(sym: str) -> List[Dict[str, Any]]:
        df, res = _fetch_adjusted_bars(sym, interval=itv)
        if res is not None and res.status != DataStatus.FRESH:
            return []
        if df is None or len(df) < MIN_BARS_REQUIRED:
            return []

        sub_df = df if itv == "15m" else _fetch_adjusted_bars(sym, interval=sub_itv)[0]
        last_close = round(float(df["close"].iloc[-1]), 2)
        found: List[Dict[str, Any]] = []

        if "BULL" in dirs:
            sig_pu = detect_rsi_pu30(df, pu_cfg, ignore_lifetime=True, interval=itv)
            if sig_pu:
                apply_hourly_trust_level(sig_pu, df, sub_df, itv)
                imp = analyze_bidirectional_impulse(df, sig_pu, direction="BULL", interval=itv)
                found.append({
                    "symbol": sym,
                    "interval": itv,
                    "direction": "BULL",
                    "signal_type": "PU30",
                    "last_close": last_close,
                    "bars_since_confirm": sig_pu.get("bars_since_confirm"),
                    "in_live_window": bool(sig_pu.get("bars_since_confirm", 999) <= pu_cfg.signal_lifetime_bars),
                    "p1": sig_pu.get("dip1"),
                    "p2": sig_pu.get("dip2"),
                    "saatlik_seviye": sig_pu.get("saatlik_seviye"),
                    "impulse": imp,
                })

        if "BEAR" in dirs:
            sig_nu = detect_rsi_nu70(df, nu_cfg, ignore_lifetime=True, interval=itv)
            if sig_nu and not sig_nu.get("invalidated"):
                apply_hourly_trust_level(sig_nu, df, sub_df, itv)
                imp = analyze_bidirectional_impulse(df, sig_nu, direction="BEAR", interval=itv)
                found.append({
                    "symbol": sym,
                    "interval": itv,
                    "direction": "BEAR",
                    "signal_type": "NU70",
                    "last_close": last_close,
                    "bars_since_confirm": sig_nu.get("bars_since_confirm"),
                    "in_live_window": bool(sig_nu.get("bars_since_confirm", 999) <= nu_cfg.signal_lifetime_bars),
                    "p1": sig_nu.get("tepe1") or sig_nu.get("dip1"),
                    "p2": sig_nu.get("tepe2") or sig_nu.get("dip2"),
                    "saatlik_seviye": sig_nu.get("saatlik_seviye"),
                    "impulse": imp,
                })
        return found

    items: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for res_list in pool.map(_scan_one, target_syms):
            items.extend(res_list)

    # Hazır 1-2 yapılarını ve A+ kaliteyi öne sırala
    items.sort(
        key=lambda x: (
            x["impulse"].get("durum") == "1_2_yapisi_hazir",
            x["impulse"].get("quality_grade") == "A+",
            bool(x.get("in_live_window")),
            -(x.get("bars_since_confirm") or 999),
        ),
        reverse=True,
    )

    return {
        "status": "success",
        "mode": "impulse_scan",
        "interval": itv,
        "direction": direction.lower(),
        "scale": scale_mode,
        "total_scanned": len(target_syms),
        "ready_count": sum(1 for x in items if x["impulse"].get("durum") == "1_2_yapisi_hazir"),
        "a_plus_count": sum(1 for x in items if x["impulse"].get("quality_grade") == "A+"),
        "bull_count": sum(1 for x in items if x["direction"] == "BULL"),
        "bear_count": sum(1 for x in items if x["direction"] == "BEAR"),
        "items": items,
    }


def get_symbol_impulse_overlay(
    symbol: str,
    interval: str = "1h",
    direction: str = "auto",
    scale: str = "linear",
) -> Dict[str, Any]:
    """Tek bir hissenin grafik üzerine bindirilecek 0->1->2 itki ve Fib Zaman verisini döner."""
    sym = clean_symbol_display(symbol)
    itv = interval if interval in ("15m", "1h", "4h", "1d") else "1h"
    scale_mode = "log" if str(scale).lower() == "log" else "linear"

    df, res = _fetch_adjusted_bars(sym, interval=itv)
    if res is not None and res.status != DataStatus.FRESH:
        return {"status": "unavailable", "symbol": sym, "interval": itv, "impulse": None, "bull_impulse": None, "bear_impulse": None}
    if df is None or len(df) < MIN_BARS_REQUIRED:
        return {"status": "unavailable", "symbol": sym, "interval": itv, "impulse": None, "bull_impulse": None, "bear_impulse": None}

    sub_itv = "15m" if itv in ("15m", "1h") else "1h"
    sub_df = df if itv == "15m" else _fetch_adjusted_bars(sym, interval=sub_itv)[0]

    sig_pu = detect_rsi_pu30(df, DEFAULT_PU30_CONFIG, ignore_lifetime=True, interval=itv)
    sig_nu = detect_rsi_nu70(df, DEFAULT_NU70_CONFIG, ignore_lifetime=True, interval=itv)
    bull_imp = None
    bear_imp = None

    if sig_pu:
        apply_hourly_trust_level(sig_pu, df, sub_df, itv)
        bull_imp = analyze_bidirectional_impulse(df, sig_pu, direction="BULL", interval=itv)
    if sig_nu and not sig_nu.get("invalidated"):
        apply_hourly_trust_level(sig_nu, df, sub_df, itv)
        bear_imp = analyze_bidirectional_impulse(df, sig_nu, direction="BEAR", interval=itv)

    pref = str(direction).lower()
    active_imp = None
    if pref == "bull" and bull_imp:
        active_imp = bull_imp
    elif pref == "bear" and bear_imp:
        active_imp = bear_imp
    else:
        # En güncel hazır 1-2 yapısını tercih et
        bull_ready = bull_imp and bull_imp.get("durum") == "1_2_yapisi_hazir"
        bear_ready = bear_imp and bear_imp.get("durum") == "1_2_yapisi_hazir"
        if bull_ready and bear_ready:
            active_imp = bull_imp if int(bull_imp["t0_index"]) >= int(bear_imp["t0_index"]) else bear_imp
        elif bull_ready:
            active_imp = bull_imp
        elif bear_ready:
            active_imp = bear_imp
        else:
            active_imp = bull_imp or bear_imp

    return {
        "status": "success",
        "symbol": sym,
        "interval": itv,
        "scale": scale_mode,
        "impulse": active_imp,
        "bull_impulse": bull_imp,
        "bear_impulse": bear_imp,
    }
