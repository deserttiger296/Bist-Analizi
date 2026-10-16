# -*- coding: utf-8 -*-
"""
MOSTRSI (14, close, VAR 5, 9) -- Trend Takip ve Kırılım Motoru.
Kıvanç Özbilgiç / Anıl Özekşi MOST mantığının RSI(14) üzerine uygulanmış hali:

  1. RSI(14): Wilder formülüyle hesaplanan standart RSI.
  2. VAR (Variable Moving Average / VIDYA):
     - CMO uzunluğu: 9
     - VAR periyodu: 5
     - Dinamik volatiliteye duyarlı adaptif hareketli ortalama (ExMOV).
  3. MOST (Moving Stop Loss):
     - Yüzde stop: %9.0
     - ExMOV yükselirken stop arkasından takip eder (%9 alttan).
     - ExMOV, MOST stop seviyesini yukarı kestiğinde -> "Bull" (AL) sinyali üretir.
     - ExMOV, MOST stop seviyesini aşağı kestiğinde -> "Bear" (SAT) sinyali üretir.

Bu motor hem 1 saatlik (1s / 1h) hem de günlük (1d) periyotlarda çalışır.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd
from python_bot.engine.signals.rsi_pu30 import (
    _fetch_adjusted_bars,
    _DEFAULT_FETCH_ADJUSTED_BARS,
    wilder_rsi,
    _epoch_seconds,
    _EPOCH,
    INTERVALS,
)
from python_bot.engine.data.provider import DataStatus, are_bars_closed, get_default_provider


@dataclass(frozen=True)
class MOSTRSIConfig:
    rsi_length: int = 14
    var_length: int = 5
    cmo_length: int = 9
    percent: float = 9.0
    signal_lifetime_bars: int = 30  # 1h için son 30 bar (~3.5 işlem günü)


DEFAULT_MOSTRSI_CONFIG = MOSTRSIConfig()


def calc_tradingview_var(src: np.ndarray, length: int = 5, cmo_len: int = 9) -> np.ndarray:
    """
    TradingView Pine Script'teki Variable Moving Average (VAR/VIDYA) formülü:
    valpha = 2 / (length + 1)
    vud = sum(src > src[1] ? src - src[1] : 0, cmo_len)
    vdd = sum(src < src[1] ? src[1] - src : 0, cmo_len)
    vCMO = (vud - vdd) / (vud + vdd)
    VAR = valpha * abs(vCMO) * src + (1 - valpha * abs(vCMO)) * VAR[1]
    """
    n = len(src)
    vma = np.full(n, np.nan)
    valpha = 2.0 / (length + 1.0)
    
    diff = np.diff(src, prepend=src[0])
    up = np.where(diff > 0, diff, 0.0)
    dn = np.where(diff < 0, -diff, 0.0)
    
    start_idx = 14 + cmo_len
    if n <= start_idx:
        return vma
        
    vma[start_idx - 1] = src[start_idx - 1]

    cs_up = np.empty(n + 1, dtype=np.float64)
    cs_dn = np.empty(n + 1, dtype=np.float64)
    cs_up[0] = 0.0
    cs_dn[0] = 0.0
    np.cumsum(up, out=cs_up[1:])
    np.cumsum(dn, out=cs_dn[1:])

    vud_arr = cs_up[start_idx + 1:] - cs_up[start_idx + 1 - cmo_len:n + 1 - cmo_len]
    vdd_arr = cs_dn[start_idx + 1:] - cs_dn[start_idx + 1 - cmo_len:n + 1 - cmo_len]
    denom_arr = vud_arr + vdd_arr
    vcmo_arr = np.where(denom_arr > 0, np.abs(vud_arr - vdd_arr) / np.where(denom_arr > 0, denom_arr, 1.0), 0.0)
    alpha_arr = valpha * vcmo_arr

    for k, i in enumerate(range(start_idx, n)):
        alpha = alpha_arr[k]
        prev = vma[i - 1] if not np.isnan(vma[i - 1]) else src[i]
        vma[i] = alpha * src[i] + (1.0 - alpha) * prev
        
    return vma


def calc_tradingview_most(exmov: np.ndarray, percent: float = 9.0):
    """
    TradingView MOST (Moving Stop Loss) trailing stop formülü.
    """
    n = len(exmov)
    most = np.full(n, np.nan)
    valid_indices = np.where(~np.isnan(exmov))[0]
    if len(valid_indices) == 0:
        return most, np.zeros(n), np.zeros(n, dtype=bool), np.zeros(n, dtype=bool)
        
    start_idx = valid_indices[0]
    most[start_idx] = exmov[start_idx] * (1.0 - percent / 100.0)
    
    for i in range(start_idx + 1, n):
        prev = most[i - 1]
        prev_ex = exmov[i - 1]
        cur_ex = exmov[i]
        fark = cur_ex * percent / 100.0
        hstop = cur_ex - fark
        lstop = cur_ex + fark
        
        if cur_ex > prev and prev_ex > prev:
            most[i] = max(prev, hstop)
        elif cur_ex < prev and prev_ex < prev:
            most[i] = min(prev, lstop)
        elif cur_ex > prev:
            most[i] = hstop
        elif cur_ex < prev:
            most[i] = lstop
        else:
            most[i] = prev
            
    trend = np.where(exmov > most, 1, -1)
    bull = (trend == 1) & (np.roll(trend, 1) == -1)
    bull[0] = False
    bear = (trend == -1) & (np.roll(trend, 1) == 1)
    bear[0] = False
    
    return most, trend, bull, bear


def detect_most_rsi(df: pd.DataFrame, cfg: MOSTRSIConfig = DEFAULT_MOSTRSI_CONFIG, interval: str = "1h") -> Optional[Dict[str, Any]]:
    """
    Belirli bir hissenin OHLC verisinde MOSTRSI hesaplar ve son 'signal_lifetime_bars' bar içinde
    'Bull' (AL) sinyali verip vermediğini tespit eder.
    """
    if df is None or len(df) < (cfg.rsi_length + cfg.cmo_length + 10):
        return None
        
    if "is_closed" in df.columns:
        df = df[df["is_closed"]].copy()
    else:
        df = df.loc[are_bars_closed(df["date"], interval)].copy()
    if len(df) < 30: return None
    closes = df["close"].to_numpy(dtype=float)
    rsi = wilder_rsi(closes, cfg.rsi_length)
    vma = calc_tradingview_var(rsi, cfg.var_length, cfg.cmo_length)
    most, trend, bull, bear = calc_tradingview_most(vma, cfg.percent)
    
    lifetime = cfg.signal_lifetime_bars if interval == "1h" else 5
    recent_bull_indices = np.where(bull[-lifetime:])[0]
    
    if len(recent_bull_indices) == 0:
        return None
        
    idx_in_recent = recent_bull_indices[-1]
    actual_idx = len(df) - lifetime + idx_in_recent
    bars_ago = (len(df) - 1) - actual_idx
    
    date_fmt = INTERVALS[interval][1]
    ts = pd.Timestamp(df["date"].iloc[actual_idx])
    
    return {
        "signal_date": ts.strftime(date_fmt),
        "signal_time": _epoch_seconds(ts),
        "signal_price": float(df["close"].iloc[actual_idx]),
        "last_close": float(df["close"].iloc[-1]),
        "bars_since_signal": int(bars_ago),
        "rsi": round(float(rsi[actual_idx]), 2),
        "exmov": round(float(vma[actual_idx]), 2),
        "most": round(float(most[actual_idx]), 2),
        "current_rsi": round(float(rsi[-1]), 2),
        "current_exmov": round(float(vma[-1]), 2),
        "current_most": round(float(most[-1]), 2),
        "current_trend": "BULL" if trend[-1] == 1 else "BEAR",
    }


def scan_universe_most_rsi(symbols: List[str], cfg: MOSTRSIConfig = DEFAULT_MOSTRSI_CONFIG, interval: str = "1h", max_workers: int = 6) -> Dict[str, Any]:
    """
    Tüm BIST100 hisselerini tarar ve son zamanlarda Bull sinyali vermiş hisseleri getirir.
    En yeni sinyalden en eskiye doğru sıralar.
    """
    from concurrent.futures import ThreadPoolExecutor

    if len(symbols) > 1 and _fetch_adjusted_bars is _DEFAULT_FETCH_ADJUSTED_BARS:
        provider = get_default_provider()
        if hasattr(provider, "prefetch_ohlcv_batch"):
            try:
                provider.prefetch_ohlcv_batch(symbols, interval=interval)
            except Exception:
                pass

    signals = []
    errors = []
    
    def _scan_one(sym: str):
        try:
            df, data_res = _fetch_adjusted_bars(sym, interval=interval)
            if df is None:
                return sym, None, (data_res.error_message if data_res and data_res.error_message else "insufficient history")
            if data_res.status != DataStatus.FRESH:
                return sym, None, data_res.status.value
            res = detect_most_rsi(df, cfg=cfg, interval=interval)
            if res is None:
                return sym, None, None
            res["symbol"] = sym
            return sym, res, None
        except Exception as e:
            return sym, None, str(e)
            
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for sym, res, err in pool.map(_scan_one, symbols):
            if res is not None:
                signals.append(res)
            elif err is not None:
                errors.append({"symbol": sym, "error": err})
                
    signals.sort(key=lambda s: s["bars_since_signal"])
    
    return {
        "signals": signals,
        "errors": errors,
        "attempted": len(symbols),
        "scanned": len(symbols) - len(errors),
        "status": "error" if errors and len(errors) == len(symbols) else ("partial" if errors else "success"),
        "source": "yfinance_auto_adjust",
        "calculated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "matched": len(signals),
        "interval": interval,
        "engine": "MOSTRSI_14_VAR_5_9",
    }


def get_most_rsi_chart_data(symbol: str, cfg: MOSTRSIConfig = DEFAULT_MOSTRSI_CONFIG, interval: str = "1h") -> Optional[Dict[str, Any]]:
    """
    Tek bir hisse için tam mum ve MOSTRSI serilerini üretir (TradingView ile birebir uyumlu grafik için).
    """
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
        
    date_fmt = INTERVALS[interval][1]
    df, _ = _fetch_adjusted_bars(symbol, interval=interval)
    if df is None:
        return None
        
    if "is_closed" in df.columns:
        df = df[df["is_closed"]].copy()
    else:
        df = df.loc[are_bars_closed(df["date"], interval)].copy()
    if len(df) < 30: return None
    closes = df["close"].to_numpy(dtype=float)
    rsi = wilder_rsi(closes, cfg.rsi_length)
    vma = calc_tradingview_var(rsi, cfg.var_length, cfg.cmo_length)
    most, trend, bull, bear = calc_tradingview_most(vma, cfg.percent)
    
    dt_ser = pd.to_datetime(df["date"])
    date_strs = dt_ser.dt.strftime(date_fmt).tolist()
    dt_utc = dt_ser.dt.tz_convert("UTC").dt.tz_localize(None) if dt_ser.dt.tz is not None else dt_ser
    epochs = ((dt_utc - _EPOCH) // pd.Timedelta(seconds=1)).to_numpy(dtype=np.int64).tolist()
    opens = df["open"].to_numpy(dtype=float).tolist()
    highs = df["high"].to_numpy(dtype=float).tolist()
    lows = df["low"].to_numpy(dtype=float).tolist()
    closes_list = closes.tolist()
    rsi_nan = np.isnan(rsi)
    vma_nan = np.isnan(vma)
    most_nan = np.isnan(most)
    rsi_rounded = np.round(rsi, 2).tolist()
    vma_rounded = np.round(vma, 2).tolist()
    most_rounded = np.round(most, 2).tolist()
    trend_list = trend.astype(int).tolist()
    bull_list = bull.tolist()
    bear_list = bear.tolist()

    bars = [
        {
            "time": epochs[i],
            "date": date_strs[i],
            "open": opens[i],
            "high": highs[i],
            "low": lows[i],
            "close": closes_list[i],
            "rsi": None if rsi_nan[i] else rsi_rounded[i],
            "exmov": None if vma_nan[i] else vma_rounded[i],
            "most": None if most_nan[i] else most_rounded[i],
            "trend": trend_list[i],
            "bull": bull_list[i],
            "bear": bear_list[i],
        }
        for i in range(len(df))
    ]
        
    # En son Bull sinyali
    bull_indices = np.where(bull)[0]
    last_bull = None
    if len(bull_indices) > 0:
        b_idx = int(bull_indices[-1])
        last_bull = {
            "index": b_idx,
            "date": date_strs[b_idx],
            "time": epochs[b_idx],
            "price": closes_list[b_idx],
            "bars_ago": int((len(df) - 1) - b_idx),
            "rsi": rsi_rounded[b_idx],
            "exmov": vma_rounded[b_idx],
            "most": most_rounded[b_idx],
        }
        
    return {
        "symbol": symbol,
        "interval": interval,
        "bars": bars,
        "last_bull": last_bull,
        "engine": "MOSTRSI_14_VAR_5_9",
    }
