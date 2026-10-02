# -*- coding: utf-8 -*-
"""
RSI PU30 -- Pozitif Uyumsuzluk (Bullish Divergence) Tarama Algoritması.

Deliberately a SEPARATE, self-contained engine: no imports from engine/brain
(the RF/LSTM/sentiment sniper pipeline), no shared state, no ML. Pure
rule-based RSI divergence detection on OHLC bars, exactly as specified:

  1. Dip 1: a price low where RSI < threshold (oversold).
  2. Bounce: price rises >= min_bounce_pct off Dip 1 without breaking below it.
  3. Dip 2: a deeper price low than Dip 1.
  4. Divergence: Dip 2's RSI is > threshold AND higher than Dip 1's RSI --
     price made a lower low while RSI made a higher low, i.e. selling
     pressure is weakening even as price falls further.

This module only detects the signal. It does not score, rank against other
engines, or feed into sniper_approved -- that's the point of keeping it
separate.
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
    min_gap_bars: int = 5
    max_gap_bars: int = 60
    min_bounce_pct: float = 1.0
    signal_lifetime_bars: int = 5


DEFAULT_CONFIG = PU30Config()

# interval -> (yfinance history period, display date format, bar length in
# minutes). Pivot/gap parameters are in BARS, so the same config works on
# both timeframes: a 60-bar max dip gap is ~3 months daily, ~1.5 weeks hourly.
INTERVALS = {
    "1d": ("1y", "%Y-%m-%d", 24 * 60),
    "1h": ("3mo", "%Y-%m-%d %H:%M", 60),
}

_EPOCH = pd.Timestamp("1970-01-01")


def _epoch_seconds(ts: Any) -> int:
    """UTCTimestamp for lightweight-charts. Strips any tzinfo first and
    treats the remaining wall-clock numbers as UTC -- i.e. a 15:30
    Europe/Istanbul bar becomes epoch-seconds-for-15:30-UTC. This makes the
    chart render BIST's actual local session hours as-is, regardless of the
    viewer's own machine timezone (the library doesn't apply any further
    timezone shift to UTCTimestamp values)."""
    ts = pd.Timestamp(ts)
    if ts.tzinfo is not None:
        ts = ts.tz_localize(None)
    return int((ts - _EPOCH) / pd.Timedelta(seconds=1))

# Minimum bars needed before a symbol can produce any pivot at all:
# rsi_length (to seed Wilder's average) + left pivot window + right
# confirmation + a little headroom for the first dip-to-dip gap.
MIN_BARS_REQUIRED = DEFAULT_CONFIG.rsi_length + DEFAULT_CONFIG.pivot_left_bars + DEFAULT_CONFIG.pivot_right_bars + DEFAULT_CONFIG.min_gap_bars


def wilder_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """
    Wilder RSI, matching TradingView's ta.rsi bar for bar: the seed average
    is a simple mean of the first `period` gains/losses, every value after
    that is RMA-smoothed (not a rolling simple mean), so a plain
    rolling-mean RSI implementation will NOT reproduce this.
    """
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
    """
    Bar p is a confirmed pivot low if its low is strictly below every one of
    the `lb` bars to its left, and <= every one of the `rb` bars to its
    right (confirmation lags rb bars behind the pivot itself -- this is
    deliberate, not an off-by-one: a pivot can't be known until the bars
    after it exist).
    """
    n = len(lows)
    pivots = []
    for p in range(lb, n - rb):
        left = lows[p - lb:p]
        right = lows[p + 1:p + rb + 1]
        if np.all(lows[p] < left) and np.all(lows[p] <= right):
            pivots.append(p)
    return pivots


def _dip_rsi(rsi: np.ndarray, p: int, lb: int, rb: int) -> float:
    """RSI's own local minimum can lag the price pivot by a bar or two, so
    take the min RSI across the same window used to confirm the pivot."""
    window = rsi[max(0, p - lb):p + rb + 1]
    window = window[~np.isnan(window)]
    return float(window.min()) if len(window) else float("nan")


def detect_rsi_pu30(df: pd.DataFrame, cfg: PU30Config = DEFAULT_CONFIG, ignore_lifetime: bool = False, interval: str = "1d") -> Optional[Dict[str, Any]]:
    """
    Runs the full Dip1/bounce/Dip2/divergence state machine on one symbol's
    chronological daily bars. `df` must have columns: date/open/high/low/close,
    already split/dividend adjusted, already stripped of the live incomplete
    bar if the session is open. Returns the most recent qualifying signal if
    it's still within signal_lifetime_bars, else None -- unless
    `ignore_lifetime` is set, which returns the most recent match found
    anywhere in the series regardless of age. Used by the chart/detail
    endpoint so a symbol whose signal has just aged out of "active" can still
    be inspected, not just symbols currently passing the live filter.
    """
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
                if np.isnan(d1["rsi"]) or d1["rsi"] >= cfg.rsi_threshold:
                    continue
                if d2["price"] >= d1["price"]:
                    continue
                if d2["rsi"] <= d1["rsi"]:
                    continue

                between_lo = lows[d1["index"] + 1:d2["index"]]
                between_hi = highs[d1["index"] + 1:d2["index"]]
                if len(between_lo) == 0:
                    continue
                min_between = float(between_lo.min())
                max_between = float(between_hi.max())
                bounce_pct = (max_between / d1["price"] - 1.0) * 100.0

                if min_between >= d1["price"] and bounce_pct >= cfg.min_bounce_pct:
                    confirm_index = d2["index"] + cfg.pivot_right_bars
                    bars_since = (n - 1) - confirm_index
                    date_fmt = INTERVALS[interval][1]
                    # dates[...] is numpy.datetime64 (from df['date'].to_numpy()),
                    # not a pandas Timestamp -- no .strftime, and NOT
                    # JSON-serializable via FastAPI's jsonable_encoder
                    # (confirmed: it raises, doesn't silently stringify).
                    # Converting here means every caller gets plain, JSON-safe
                    # values (a display string AND a chart-ready epoch time),
                    # not just the ones that remember to.
                    d1_ts = pd.Timestamp(dates[d1["index"]])
                    d2_ts = pd.Timestamp(dates[d2["index"]])
                    signal = {
                        "dip1": {**d1, "date": d1_ts.strftime(date_fmt), "time": _epoch_seconds(d1_ts)},
                        "dip2": {**d2, "date": d2_ts.strftime(date_fmt), "time": _epoch_seconds(d2_ts)},
                        "bounce_pct": round(bounce_pct, 2),
                        "bars_since_confirm": bars_since,
                    }
                    break

        dips.append(d2)

    if signal and (ignore_lifetime or signal["bars_since_confirm"] <= cfg.signal_lifetime_bars):
        return signal
    return None


def _normalize_symbol(symbol: str) -> str:
    return symbol if symbol.endswith(".IS") else f"{symbol}.IS"


def _fetch_adjusted_bars(symbol: str, interval: str = "1d", period: Optional[str] = None) -> Optional[pd.DataFrame]:
    """Adjusted (split/dividend-corrected) OHLC bars at the given interval --
    raw prices produce fake dips across any split/bonus-issue boundary. Drops
    the still-forming last bar (its time window hasn't fully elapsed yet),
    and any bar with a null/zero low (holiday artifacts yfinance occasionally
    returns)."""
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
    default_period, _, bar_minutes = INTERVALS[interval]
    period = period or default_period

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
            # Daily bars are stamped at midnight for the trading date they
            # represent, not an actual session start time -- a day's bar is
            # "done" once that date's session has closed (18:00 local), not
            # 24 wall-clock hours after its midnight timestamp.
            session_open = now_ist.weekday() < 5 and 10 <= now_ist.hour < 18
            if session_open and last_ist.date() == now_ist.date():
                df = df.iloc[:-1]
        else:
            bar_end = last_ist + timedelta(minutes=bar_minutes)
            if now_ist < bar_end.to_pydatetime():
                df = df.iloc[:-1]

    min_bars = MIN_BARS_REQUIRED
    return df.reset_index(drop=True) if len(df) >= min_bars else None


def scan_universe_rsi_pu30(symbols: List[str], cfg: PU30Config = DEFAULT_CONFIG, max_workers: int = 4, interval: str = "1d") -> Dict[str, Any]:
    """Scans every symbol, returns only those with a currently-active signal,
    newest confirmation first, tie-broken by divergence strength (RSI gap)."""
    from concurrent.futures import ThreadPoolExecutor

    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []

    def _scan_one(symbol: str):
        try:
            df = _fetch_adjusted_bars(symbol, interval=interval)
            if df is None:
                return symbol, None, "insufficient history"
            sig = detect_rsi_pu30(df, cfg, interval=interval)
            if sig is None:
                return symbol, None, None
            sig["symbol"] = symbol
            sig["last_close"] = float(df["close"].iloc[-1])
            return symbol, sig, None
        except Exception as e:
            return symbol, None, str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for symbol, sig, err in pool.map(_scan_one, symbols):
            if sig is not None:
                results.append(sig)
            elif err is not None:
                errors.append({"symbol": symbol, "error": err})

    def sort_key(s):
        rsi_gap = s["dip2"]["rsi"] - s["dip1"]["rsi"]
        return (s["bars_since_confirm"], -rsi_gap)

    results.sort(key=sort_key)

    return {"signals": results, "errors": errors, "scanned": len(symbols), "matched": len(results), "interval": interval}


def get_symbol_chart_data(symbol: str, cfg: PU30Config = DEFAULT_CONFIG, interval: str = "1d", period: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Full price + RSI series for one symbol, plus whatever divergence pair
    (if any) was most recently found -- regardless of whether it's still
    inside the "active" lifetime window. This is what the frontend chart
    renders: a price pane with Dip1/Dip2 marked, an RSI pane with the same
    two points marked and a connector line showing the divergence.
    """
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
    date_fmt = INTERVALS[interval][1]

    df = _fetch_adjusted_bars(symbol, interval=interval, period=period)
    if df is None:
        return None

    closes = df["close"].to_numpy(dtype=float)
    rsi = wilder_rsi(closes, cfg.rsi_length)
    signal = detect_rsi_pu30(df, cfg, ignore_lifetime=True, interval=interval)

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
        })

    result = {"symbol": symbol, "interval": interval, "bars": bars, "signal": None}
    if signal is not None:
        # dip dates/times are already JSON-safe plain values -- detect_rsi_pu30
        # converts them before returning, specifically so every caller
        # (this function included) gets one automatically.
        result["signal"] = {
            "dip1": {
                "date": signal["dip1"]["date"],
                "time": signal["dip1"]["time"],
                "price": signal["dip1"]["price"],
                "rsi": round(signal["dip1"]["rsi"], 2),
                "index": signal["dip1"]["index"],
            },
            "dip2": {
                "date": signal["dip2"]["date"],
                "time": signal["dip2"]["time"],
                "price": signal["dip2"]["price"],
                "rsi": round(signal["dip2"]["rsi"], 2),
                "index": signal["dip2"]["index"],
            },
            "bounce_pct": signal["bounce_pct"],
            "bars_since_confirm": signal["bars_since_confirm"],
            "is_active": signal["bars_since_confirm"] <= cfg.signal_lifetime_bars,
        }
    return result
