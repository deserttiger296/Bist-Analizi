"""PU30 decision states. Forming bars may veto, but never confirm a purchase."""
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, replace
from datetime import datetime, time as dtime

import numpy as np
import pandas as pd
from python_bot.engine.data.provider import (bar_close_time, is_bar_closed, DataResult, DataStatus,
    get_default_provider, clean_symbol_display, normalize_bist_symbol, validate_and_clean_ohlcv, ISTANBUL_TZ)

from python_bot.engine.signals.rsi_pu30 import (
    PU30Config as ClassicPU30Config, detect_rsi_nu70, find_confirmed_pivot_lows,
    find_confirmed_pivot_highs, wilder_rsi, _dip_rsi, _epoch_seconds, INTERVALS, MIN_BARS_REQUIRED,
)


@dataclass(frozen=True)
class PU30Config(ClassicPU30Config):
    allow_equal_price: Optional[bool] = None


DEFAULT_PU30_CONFIG = PU30Config()


def source_is_delayed(last_source, now_ist, interval):
    """Regular weekday sessions only; holidays remain explicitly uncertified."""
    last = pd.Timestamp(last_source)
    last = last.tz_localize(ISTANBUL_TZ) if last.tzinfo is None else last.tz_convert(ISTANBUL_TZ)
    now = pd.Timestamp(now_ist)
    day = now.normalize()
    if now.weekday() >= 5 or now.time() < dtime(10, 30):
        day -= pd.Timedelta(days=1)
        while day.weekday() >= 5: day -= pd.Timedelta(days=1)
        expected = day + pd.Timedelta(hours=18, minutes=10)
    else:
        expected = min(now, day + pd.Timedelta(hours=18, minutes=10))
    if interval == "1d":
        # A daily open bar may be absent until the provider publishes it;
        # the previous completed session must still be present.
        required_day = expected.normalize()
        if expected.time() < dtime(18, 10):
            required_day -= pd.Timedelta(days=1)
            while required_day.weekday() >= 5: required_day -= pd.Timedelta(days=1)
        return last.normalize() < required_day
    return expected - (last + pd.Timedelta(hours=1)) > pd.Timedelta(minutes=90)

def _fetch_adjusted_bars(
    symbol: str, interval: str = "4h", period: Optional[str] = None,
    include_forming_bar: bool = False,
) -> Tuple[Optional[pd.DataFrame], Optional[DataResult]]:
    """DataProvider arayüzü üzerinden temizlenmiş ve BIST seansına hizalanmış veriyi getirir."""
    provider = get_default_provider()
    result = provider.fetch_ohlcv(symbol, interval=interval, period=period, include_forming_bar=include_forming_bar)
    if result.status in (DataStatus.ERROR, DataStatus.DELISTED) or result.df is None:
        return None, result
    if interval in ("1h", "1d") and result.status == DataStatus.FRESH:
        if source_is_delayed(result.df.date.iloc[-1], datetime.now(ISTANBUL_TZ), interval):
            result = replace(result, status=DataStatus.STALE)
    return result.df, result

def _load_pu30_frames(symbol, interval="4h", period=None):
    """One snapshot per timeframe, including forming bars for invalidation."""
    from dataclasses import replace
    from python_bot.engine.data.provider import resample_bist_4h
    frames, results = {}, {}
    for tf in ("1h", "4h", "1d"):
        if tf == "4h" and frames.get("1h") is not None and results.get("1h") is not None:
            session = resample_bist_4h(frames["1h"])
            if len(session) >= MIN_BARS_REQUIRED:
                session.columns = [c.lower() for c in session.columns]
                session["is_closed"] = [is_bar_closed(t, "4h") for t in session.date]
                frames["4h"] = session
                results["4h"] = replace(results["1h"], interval="4h", df=session,
                    bar_count=len(session), last_bar_time=pd.Timestamp(session.date.iloc[-1]).isoformat(),
                    is_forming_bar_included=not bool(session.is_closed.iloc[-1]))
                continue
        try:
            frame, result = _fetch_adjusted_bars(
                symbol, interval=tf, period=period if tf == interval else None,
                include_forming_bar=True)
        except Exception as error:
            frame, result = None, DataResult(symbol=symbol, interval=tf, status=DataStatus.ERROR, error_message=str(error))
        frames[tf] = frame.reset_index(drop=True) if frame is not None else None
        results[tf] = result
    return frames, results

def detect_rsi_pu30(
    df: pd.DataFrame,
    cfg: PU30Config = DEFAULT_PU30_CONFIG,
    ignore_lifetime: bool = False,
    interval: str = "4h",
    include_invalidated: bool = False,
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
                allow_equal = interval == "1h" if cfg.allow_equal_price is None else cfg.allow_equal_price
                if cfg.require_lower_price:
                    if d2["price"] > d1["price"] or (not allow_equal and d2["price"] == d1["price"]):
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

                    bars_since = int(is_closed_arr[confirm_index + 1:].sum())
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
                        "bars_since_dip2": int(is_closed_arr[d2["index"] + 1:].sum()),
                        "latest_bar_time": pd.Timestamp(dates[-1]).isoformat(),
                        "latest_bar_closed": bool(is_closed_arr[-1]),
                        "current_rsi": None if np.isnan(rsi[-1]) else float(rsi[-1]),
                        "gap_bars": gap,
                        "explanation": explanation,
                    }
                    break

        dips.append(d2)

    if signal and (ignore_lifetime or signal["bars_since_confirm"] <= cfg.signal_lifetime_bars):
        # A later low/RSI failure invalidates this pair, even on a forming bar
        # or before a replacement pivot has accumulated its right-hand bars.
        p = signal["dip2"]["index"]
        lower = np.flatnonzero(lows[p + 1:] < signal["dip2"]["price"])
        failed_rsi = np.flatnonzero(rsi[p + 1:] < cfg.rsi_threshold) if cfg.strict_threshold else []
        reasons = []
        if len(lower): reasons.append("SECOND_LOW_BROKEN")
        if len(failed_rsi): reasons.append("RSI_BELOW_30")
        signal["valid"] = not reasons
        signal["invalidated"] = bool(reasons)
        signal["invalidation_reasons"] = reasons
        if reasons:
            first = min([int(a[0]) for a in (lower, failed_rsi) if len(a)]) + p + 1
            signal["invalidated_at"] = pd.Timestamp(dates[first]).isoformat()
            signal["tetiklendi"] = False
            signal["is_active"] = False
            signal["label"] = "PU30 İPTAL: dip / RSI bozuldu"
            signal["guven_tazeleyen_tepe"]["kirildi"] = False
            return signal if include_invalidated else None
        # Only a CLOSED bar after confirmation can activate the resistance.
        eligible = np.arange(n) >= signal["confirm_index"]
        closed_indices = np.flatnonzero(is_closed_arr & eligible)
        resistance = signal["guven_tazeleyen_tepe"]["price"]
        signal["tetiklendi"] = bool(len(closed_indices) and closes[closed_indices[-1]] > resistance)
        signal["guven_tazeleyen_tepe"]["kirildi"] = signal["tetiklendi"]
        signal["is_active"] = signal["tetiklendi"]
        signal["local_fibonacci_levels"] = signal.pop("fibonacci_levels")
        signal["fibonacci_levels"] = []  # macro targets are assigned by MTF confirmation
        return signal
    return None

def timeframe_state(df, interval, status="FRESH") -> Dict[str, Any]:
    if df is None or len(df) < 25:
        return {"data_status": status if status != "FRESH" else "INSUFFICIENT_HISTORY",
                "pu30": None, "valid_pu30": False, "latest_bar_time": None}
    df = df.reset_index(drop=True)
    signal = detect_rsi_pu30(df, interval=interval, include_invalidated=True, ignore_lifetime=True)
    rsi = wilder_rsi(df.close.to_numpy(dtype=float))
    closed = df.is_closed.to_numpy(dtype=bool)
    return {
        "data_status": status, "pu30": signal,
        "valid_pu30": bool(status == "FRESH" and signal and signal.get("valid")),
        "latest_bar_time": pd.Timestamp(df.date.iloc[-1]).isoformat(),
        "latest_bar_closed": bool(closed[-1]),
        "last_closed_bar_time": pd.Timestamp(df.loc[closed, "date"].iloc[-1]).isoformat() if closed.any() else None,
        "bar_count": len(df), "closed_bar_count": int(closed.sum()),
        "current_rsi": None if not np.isfinite(rsi[-1]) else float(rsi[-1]),
    }


def daily_structure(df, state):
    """Daily support may form a live PU candidate before right-pivot confirmation."""
    if df is None or state["data_status"] != "FRESH":
        return {"status": "UNKNOWN", "reason": "Günlük veri eksik veya güncel değil"}
    df = df.reset_index(drop=True)
    closed = df.is_closed.to_numpy(dtype=bool)
    lows = df.low.to_numpy(dtype=float)
    historical = state.get("pu30") if state.get("valid_pu30") else None
    if historical:
        p = historical["dip2"]["index"]
        support = historical["dip2"]["price"]
        source = "DAILY_PU30_LOW"
    else:
        pivots = find_confirmed_pivot_lows(lows, 5, 2, closed)
        if not pivots:
            return {"status": "UNKNOWN", "reason": "Teyitli günlük dip yok"}
        p, source = pivots[-1], "DAILY_CONFIRMED_LOW"
        support = float(lows[p])
    rsi = state.get("current_rsi")
    history_rsi = wilder_rsi(df.close.to_numpy(dtype=float))
    d1_rsi = float(history_rsi[p]) if np.isfinite(history_rsi[p]) else None
    support_broken = bool(np.any(lows[p + 1:] < support))
    info = {"support": float(support), "support_source": source, "source": source,
            "support_date": pd.Timestamp(df.date.iloc[p]).isoformat(),
            "current_rsi": rsi, "d1_rsi": d1_rsi, "support_broken": support_broken,
            "current_low": float(lows[-1]), "forming_pu": False}
    if rsi is None or not np.isfinite(rsi):
        return dict(info, status="UNKNOWN", reason="Günlük RSI hesaplanamadı")
    negative = detect_rsi_nu70(df, interval="1d") is not None
    info["negative_divergence"] = negative
    # Latest live daily RSI is intentional: no two-day right pivot is required.
    forming = bool(support_broken and d1_rsi is not None and rsi > d1_rsi and rsi >= 30)
    if negative:
        return dict(info, status="BROKEN", reason="Günlük NU70 negatif uyumsuzluk veto koşulu")
    if rsi < 30:
        return dict(info, status="BROKEN", reason="Günlük RSI 30 altında")
    if support_broken:
        if d1_rsi is None:
            return dict(info, status="UNKNOWN", reason="Önceki günlük dip RSI değeri hesaplanamadı")
        if forming:
            return dict(info, status="INTACT", source="DAILY_FORMING_PU",
                        support_source="DAILY_FORMING_PU", forming_pu=True,
                        reason="Günlükte PU oluşumu aktif (Fiyat yeni dipte ama RSI daha yüksek ve >= 30)")
        return dict(info, status="BROKEN", reason="Günlük destek kırıldı ve RSI önceki dip RSI değerinin üzerinde değil")
    return dict(info, status="INTACT", reason="Günlük dip korunuyor, RSI ≥30 ve NU70 yok")


def invalidate_session_from_hourly(hourly_df, session):
    """An unconfirmed hourly low can invalidate a confirmed 4h pair."""
    result = dict(session)
    signal = session.get("pu30")
    if not signal:
        return result
    reasons = list(signal.get("invalidation_reasons", []))
    invalidated_at = signal.get("invalidated_at")
    if hourly_df is not None and len(hourly_df):
        start = pd.Timestamp(signal["dip2"]["time"], unit="s", tz="UTC")
        after = hourly_df[pd.to_datetime(hourly_df.date, utc=True) >= bar_close_time(start, "4h")]
        broken = after[after.low < signal["dip2"]["price"]]
        if len(broken):
            reasons.append("HOURLY_LOW_BROKE_SESSION_LOW")
            invalidated_at = pd.Timestamp(broken.date.iloc[0]).isoformat()
    current_rsi = session.get("current_rsi")
    if current_rsi is not None and current_rsi < 30:
        reasons.append("RSI_BELOW_30")
        invalidated_at = invalidated_at or session.get("latest_bar_time")
    if reasons:
        result["valid_pu30"] = False
        result["pu30"] = dict(signal, valid=False, invalidated=True, is_active=False,
                              tetiklendi=False, invalidation_reasons=list(dict.fromkeys(reasons)),
                              invalidated_at=invalidated_at)
        if signal.get("guven_tazeleyen_tepe"):
            result["pu30"]["guven_tazeleyen_tepe"] = dict(signal["guven_tazeleyen_tepe"], kirildi=False)
    return result


def classify_pu30_state(*, data_fresh, daily_status, hourly_pu,
                       session_pu, closed_breakout, price_above_resistance):
    if not data_fresh or daily_status == "UNKNOWN":
        return "DATA_UNAVAILABLE"
    if daily_status != "INTACT":
        return "DAILY_VETO"
    if session_pu and closed_breakout and price_above_resistance:
        return "FULL_CONFIRMATION"
    if hourly_pu and not session_pu:
        return "EARLY_REACTION"
    return "WAITING_CONFIRMATION"


def macro_fibonacci(df, signal, lookback=100):
    """Largest confirmed pre-dip1 swing high in the last 100 bars up to dip2."""
    p1, p2 = signal["dip1"]["index"], signal["dip2"]["index"]
    high = df.high.to_numpy(dtype=float)
    pivots = find_confirmed_pivot_highs(high, 5, 2, df.is_closed.to_numpy(dtype=bool))
    candidates = [p for p in pivots if max(0, p2 - lookback + 1) <= p and p + 2 < p1]
    if not candidates:
        return {"status": "UNAVAILABLE", "levels": [], "reason": "Ana düşüş öncesi teyitli swing high bulunamadı"}
    top = max(candidates, key=lambda p: high[p])
    low = float(signal["dip2"]["price"])
    if high[top] <= low:
        return {"status": "UNAVAILABLE", "levels": []}
    levels = [{"label": f"Makro Fibo {ratio:.3f}" + (" (İlk ana teknik hedef)" if ratio == .382 else ""),
               "level": ratio, "price": round(low + (float(high[top]) - low) * ratio, 2),
               "color": "#10b981"} for ratio in (.382, .5, .618, 1.0)]
    return {"status": "AVAILABLE", "lookback_bars": lookback,
            "swing_high": {"price": float(high[top]), "date": pd.Timestamp(df.date.iloc[top]).isoformat()},
            "swing_low": {"price": low, "date": pd.Timestamp(df.date.iloc[p2]).isoformat()},
            "target_0382": levels[0]["price"], "levels": levels}


def build_mtf_decision(frames, statuses=None):
    statuses = statuses or {}
    states = {tf: timeframe_state(frames.get(tf), tf, statuses.get(tf, "ERROR")) for tf in ("1h", "4h", "1d")}
    states["4h"] = invalidate_session_from_hourly(frames.get("1h"), states["4h"])
    daily = daily_structure(frames.get("1d"), states["1d"])
    hourly, session = states["1h"], states["4h"]
    four = session.get("pu30")
    # A closed 1h bar or a closed 4h bar must clear the BETWEEN-DIPS resistance.
    resistance, resistance_broken, breakout_at = None, False, None
    if session["valid_pu30"]:
        resistance = four["guven_tazeleyen_tepe"]["price"]
        confirmations = []
        for tf in ("1h", "4h"):
            frame = frames.get(tf)
            if frame is None or states[tf]["data_status"] != "FRESH": continue
            eligible = frame[frame.is_closed.astype(bool)]
            if len(eligible):
                row = eligible.iloc[-1]
                close_at = bar_close_time(row.date, tf)
                if close_at >= pd.Timestamp(four["knowable_at"]):
                    confirmations.append((close_at, float(row.close)))
        if confirmations:
            close_at, price = max(confirmations, key=lambda item: item[0])
            resistance_broken = price > resistance
            breakout_at = close_at.isoformat() if resistance_broken else None
    fresh = all(s["data_status"] == "FRESH" for s in states.values())
    price_frame = frames.get("1h")
    current_price = float(price_frame.close.iloc[-1]) if price_frame is not None and len(price_frame) else None
    above = bool(current_price is not None and resistance is not None and current_price > resistance)
    state = classify_pu30_state(data_fresh=fresh, daily_status=daily["status"],
        hourly_pu=hourly["valid_pu30"], session_pu=session["valid_pu30"],
        closed_breakout=resistance_broken, price_above_resistance=above)
    if state == "DATA_UNAVAILABLE":
        label = "VERİ / GÜNLÜK YAPI TEYİDİ BEKLENİYOR"
        action = "Eksik veya gecikmiş veriyle ana alım onayı verilmez."
    elif state == "DAILY_VETO":
        label = "GÜNLÜK YAPI BOZUK — ALIM ONAYI YOK"
        action = daily["reason"]
    elif state == "FULL_CONFIRMATION":
        label = "TAM ONAYLI ALIM (1S+4S+1G UYUMLU — YÜKSEK MARJ POTANSİYELİ)"
        action = "Teyitli 4S PU30, direnç üzerinde kapanış, direnç üstünde güncel fiyat ve günlük yapı koşulları sağlandı."
    elif state == "EARLY_REACTION":
        label = "TEPKİ ÇIKIŞI — SEANSLIKTA SON BİR DİP DAHA BEKLENİYOR"
        action = "Saatlik PU tepkisi: hafif bir tepki sonrası 4S'de yeni dip olasılığı var. Ana alım için geçerli 4S PU30 ve direnç üzerinde kapanış beklenmeli."
    else:
        state, label = "WAITING_CONFIRMATION", "DİP OLUŞUM / TEYİT BEKLENİYOR"
        action = "Geçerli 4S PU30, güven tazeleyen direnç üzerinde kapanış ve direnç üstünde güncel fiyat bekleniyor."
    macro = macro_fibonacci(frames["4h"], four) if state == "FULL_CONFIRMATION" else {"status": "NOT_CONFIRMED", "levels": []}
    result = {"state": state, "label": label, "action": action,
            "is_active_buy": state == "FULL_CONFIRMATION", "timeframes": states,
            "daily_structure": daily, "resistance": resistance,
            "resistance_broken": resistance_broken, "breakout_at": breakout_at,
            "current_price": current_price, "price_above_resistance": above,
            "layer_flags": {"1G_Saglam": daily["status"] == "INTACT",
                            "1S_PU": hourly["valid_pu30"], "4S_PU": session["valid_pu30"]},
            "macro_fibonacci": macro}
    if "15m" in frames:
        lower = detect_lower_tf_nu_and_rsi_trend(frames.get("15m"), frames.get("1h"))
        result["lower_timeframes"] = lower
        aligned = session["valid_pu30"] and daily["status"] == "INTACT"
        lower_fresh = statuses.get("15m") == "FRESH" and statuses.get("1h") == "FRESH"
        if fresh and lower_fresh and daily["status"] != "UNKNOWN" and lower["nu_pressure"] and not lower["rsi_trend_broken"] and not aligned:
            result.update(state="LOWER_TF_NU_PRESSURE", is_active_buy=False,
                label="SEANSLIK VE GÜNLÜK UYUM SAĞLAMIYOR — KISA VADELİ TEPKİ / NU BASKISI",
                action="15D/1S negatif uyumsuzluk baskısı var; RSI düşen trend kırılımı ve 4S/1G uyumu bekleniyor.",
                macro_fibonacci={"status": "NOT_CONFIRMED", "levels": []})
    return result


def calc_most(closes, length=9, percent=1.1):
    """Price EMA + percentage trailing stop; this is independent of MOSTRSI."""
    if length < 1 or not np.isfinite(percent) or percent <= 0:
        raise ValueError("length >= 1 and percent > 0 required")
    values = np.asarray(closes, dtype=float)
    if values.ndim != 1 or np.any(~np.isfinite(values)) or np.any(values <= 0):
        raise ValueError("closes must contain finite positive prices")
    n = len(values)
    ema = pd.Series(values).ewm(span=length, adjust=False, min_periods=length).mean().to_numpy()
    most = np.full(n, np.nan)
    for i in range(length - 1, n):
        lower, upper = ema[i] * (1 - percent / 100), ema[i] * (1 + percent / 100)
        if i == length - 1:
            most[i] = lower
        elif ema[i] > most[i - 1] and ema[i - 1] > most[i - 1]:
            most[i] = max(most[i - 1], lower)
        elif ema[i] < most[i - 1] and ema[i - 1] < most[i - 1]:
            most[i] = min(most[i - 1], upper)
        else:
            most[i] = lower if ema[i] > most[i - 1] else upper if ema[i] < most[i - 1] else most[i - 1]
    ready = n >= length
    return {"status": "READY" if ready else "INSUFFICIENT_HISTORY", "length": length, "percent": percent,
            "ema": [float(v) if np.isfinite(v) else None for v in ema],
            "most": [float(v) if np.isfinite(v) else None for v in most],
            "current_ema": float(ema[-1]) if ready else None,
            "current_most": float(most[-1]) if ready else None,
            "above_ema": bool(values[-1] > ema[-1]) if ready else None,
            "above_most": bool(values[-1] > most[-1]) if ready else None}


def _lower_tf_state(df, interval):
    empty = {"status": "UNAVAILABLE", "nu_pressure": False, "rsi_trend_broken": None,
             "rsi_trend": None, "most": None}
    if df is None or len(df) < 25:
        return empty
    original = df.reset_index(drop=True)
    closed = original[original.is_closed.astype(bool)].reset_index(drop=True)
    if len(closed) < 25:
        return empty
    rsi = wilder_rsi(closed.close.to_numpy(dtype=float))
    price_peaks = find_confirmed_pivot_highs(closed.high.to_numpy(dtype=float), 2, 2)
    price_peaks = [p for p in price_peaks if p >= len(closed) - 100 and np.isfinite(rsi[p])]
    nu = False
    pair = None
    if len(price_peaks) >= 2:
        a, b = price_peaks[-2:]
        nu = bool(closed.high.iloc[b] > closed.high.iloc[a] and rsi[b] < rsi[a])
        if nu:
            pair = {"price1": float(closed.high.iloc[a]), "price2": float(closed.high.iloc[b]),
                    "rsi1": float(rsi[a]), "rsi2": float(rsi[b]),
                    "date1": pd.Timestamp(closed.date.iloc[a]).isoformat(),
                    "date2": pd.Timestamp(closed.date.iloc[b]).isoformat()}
    peaks = find_confirmed_pivot_highs(rsi, 2, 2)
    peaks = [p for p in peaks if p >= len(closed) - 100 and np.isfinite(rsi[p])]
    trend_peaks = []
    for count in (3, 2):
        chosen = peaks[-count:]
        if len(chosen) == count and np.all(np.diff(rsi[chosen]) < 0):
            trend_peaks = chosen
            break
    trend_source = "RSI_PIVOTS"
    if not trend_peaks and nu:
        trend_peaks = price_peaks[-2:]
        trend_source = "PRICE_PIVOT_RSI"
    trend, broken = None, None
    if trend_peaks:
        slope, intercept = np.polyfit(trend_peaks, rsi[trend_peaks], 1)
        projected = float(slope * (len(closed) - 1) + intercept)
        broken = bool(slope < 0 and rsi[-1] > projected)
        trend = {"slope": float(slope), "intercept": float(intercept), "value_now": projected,
                 "source": trend_source, "peak_count": len(trend_peaks),
                 "peaks": [{"date": pd.Timestamp(closed.date.iloc[p]).isoformat(), "rsi": float(rsi[p])} for p in trend_peaks]}
    most = calc_most(original.close.to_numpy(dtype=float))
    # A universe scan needs current status, not thousands of EMA/stop points.
    # calc_most remains available with full arrays for dedicated chart consumers.
    most_summary = {key: value for key, value in most.items() if key not in ("ema", "most")}
    return {"status": "READY", "interval": interval, "nu_pressure": nu, "nu_pair": pair,
            "rsi_trend_broken": broken, "rsi_trend": trend, "current_closed_rsi": float(rsi[-1]),
            "trend_checked_at": pd.Timestamp(closed.date.iloc[-1]).isoformat(),
            "latest_bar_time": pd.Timestamp(original.date.iloc[-1]).isoformat(),
            "latest_bar_closed": bool(original.is_closed.iloc[-1]),
            "most": most_summary}


def detect_lower_tf_nu_and_rsi_trend(df_15m, df_1h):
    states = {"15m": _lower_tf_state(df_15m, "15m"), "1h": _lower_tf_state(df_1h, "1h")}
    pressured = [s for s in states.values() if s["status"] == "READY" and s["nu_pressure"]]
    return {"timeframes": states, "nu_pressure": bool(pressured),
            "rsi_trend_broken": bool(pressured) and all(s["rsi_trend_broken"] is True for s in pressured)}


def _fetch_lab_15m(symbol):
    """15m history is requested only by lab endpoints, never by classic scans."""
    import yfinance as yf
    try:
        raw = yf.download(normalize_bist_symbol(symbol), period="60d", interval="15m",
                          auto_adjust=True, progress=False, timeout=15)
        if raw is None or raw.empty:
            return None, "ERROR"
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.droplevel(1)
        raw = raw.reset_index()
        raw = raw.rename(columns={raw.columns[0]: "date"})
        frame, _ = validate_and_clean_ohlcv(raw, "15m")
        if len(frame) < 25:
            return None, "INSUFFICIENT_HISTORY"
        dates = pd.to_datetime(frame.date)
        frame["date"] = dates.dt.tz_localize(ISTANBUL_TZ) if dates.dt.tz is None else dates.dt.tz_convert(ISTANBUL_TZ)
        now = pd.Timestamp.now(tz=ISTANBUL_TZ)
        frame["is_closed"] = frame.date + pd.Timedelta(minutes=15) <= now
        delayed = source_is_delayed(frame.date.iloc[-1], now, "1h")
        if now.weekday() < 5 and dtime(10, 30) <= now.time() <= dtime(18, 10):
            delayed = delayed or now - frame.date.iloc[-1] > pd.Timedelta(minutes=45)
        status = "STALE" if delayed else "FRESH"
        return frame, status
    except Exception:
        return None, "ERROR"


def get_symbol_mtf_lab_data(symbol):
    frames, quality = _load_pu30_frames(symbol)
    statuses = {tf: result.status.value if result else "ERROR" for tf, result in quality.items()}
    frames["15m"], statuses["15m"] = _fetch_lab_15m(symbol)
    decision = build_mtf_decision(frames, statuses)
    return {"symbol": clean_symbol_display(symbol), "engine": "mtf-lab-v1",
            "decision": decision, "data_statuses": statuses,
            "calculated_at": pd.Timestamp.now(tz="UTC").isoformat()}


def scan_universe_mtf_lab(symbols, max_workers=8):
    from concurrent.futures import ThreadPoolExecutor
    rows, errors = [], []
    def one(symbol):
        try:
            return get_symbol_mtf_lab_data(symbol), None
        except Exception as error:
            return None, {"symbol": clean_symbol_display(symbol), "error": str(error)}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for row, error in pool.map(one, symbols):
            if row is not None:
                rows.append(row)
                unavailable = [tf for tf, status in row["data_statuses"].items() if status != "FRESH"]
                if unavailable:
                    errors.append({"symbol": row["symbol"], "error": "Veri eksik/gecikmiş: " + ", ".join(unavailable)})
            if error: errors.append(error)
    groups = {key: [r for r in rows if r["decision"]["state"] == key] for key in
              ("EARLY_REACTION", "FULL_CONFIRMATION", "LOWER_TF_NU_PRESSURE")}
    return {"engine": "mtf-lab-v1", "status": "error" if errors and not rows else "partial" if errors else "success",
            "rows": rows, "groups": groups, "errors": errors, "scanned": len(rows),
            "calculated_at": pd.Timestamp.now(tz="UTC").isoformat()}
