# PU30 MTF entegrasyonu ve güncel fonksiyonlar

> Güncel mimari: MTF yalnız ayrı laboratuvarda çalışır. Klasik motor MTF öncesi davranışına döndürülmüştür. Geçerli entegrasyon: [MTF_LAB_IZOLE_ENTEGRASYON.md](MTF_LAB_IZOLE_ENTEGRASYON.md). Aşağıdaki önceki MTF bağlama anlatımları tarihsel nottur.

Güncel sürüm: `pu30-mtf-v5`. Bu rehberdeki kod blokları mevcut kaynak dosyalarından çıkarılmıştır; özet/pseudocode değildir. Fonksiyonlar kendi modüllerinin mevcut importlarıyla birlikte kullanılır. Tam çalışan kaynaklar `python_bot/engine/signals/rsi_pu30.py` ve `python_bot/engine/signals/pu30_mtf.py` dosyalarındadır.

1. Veri katmanı: `_load_pu30_frames` saatlik ve günlük veriyi oluşan mum dahil getirir; 4S mumları aynı saatlik seriden sentezler. Mum kapanış durumu ayrıca tutulur; açık mum yalnız veto edebilir.
2. Sinyal katmanı: `detect_rsi_pu30` kapanmış sağ pivot mumlarını bekler. 1S için eşit ikinci dip kabul edilir; RSI1 <30, RSI2 >30 ve RSI2 >RSI1 korunur. `PU30Config.allow_equal_price` ile davranış açıkça seçilebilir. 4S/1G varsayılanı daha düşük ikinci diptir.
3. Çapraz iptal: `invalidate_session_from_hourly` 4S ikinci dip mumundan sonra gelen saatlik Low değerlerini, açık mumlar dahil, denetler. Dibi delen tek bir fiyat veya 4S RSI <30, `4S_PU=False` yapar.
4. Karar: `classify_pu30_state` günlük veto/veri korumalarını önce uygular. Evre 1 günlük sağlam + saatlik PU + 4S PU yoktur. Evre 2 günlük sağlam + 4S PU + kapanmış direnç kırılımı + güncel fiyatın direnç üstünde olmasıdır. Ayrı bir tarihsel saatlik PU kanıtı Evre 2'ye ek şart değildir.
5. Hedef: `macro_fibonacci`, 4S dip2'de biten son 100 mum içindeki, ilk dipten önce teyit edilmiş en yüksek tepeyi seçer. Son 4S dip tabandır. 0.382/0.50/0.618 aynı makro dalgadan hesaplanır. Teyitli ana tepe yoksa hedef uydurulmaz.
6. Entegrasyon: `scan_universe_rsi_pu30` ve `get_symbol_chart_data` aynı `build_mtf_decision` sonucunu kullanır. JSON `layer_flags` alanında `1G_Saglam`, `1S_PU`, `4S_PU` döner. Geçerli MTF yapısı yalnız beş mum geçti diye silinmez; fiyat/RSI/günlük/veri koşullarıyla karar yenilenir.
7. Arayüz: `public/static/app.js` ve Python sürümündeki eş kopyası Evre 1'i sarı, tam onayı yeşil gösterir; üç hedefi de yazar. RSI API yanıtları `no-store` kullanır.

Günlük sağlamlık, geçerli günlük PU'nun ikinci dibinin veya son teyitli günlük dibin korunması, güncel günlük RSI >=30 ve geçerli NU70 bulunmamasıyla belirlenir. Eksik veri/teyitli günlük dip yokluğu sağlamlık varsayımına çevrilmez.

Ekranda 'İlk ana hedef (Makro Fibo 0.382)' kullanılır. Teknik durum etiketi ve Fibonacci seviyesi fiyat/getiri garantisi değildir. Eski tek periyotlu backtest raporları bu MTF sürümünün performans doğrulaması değildir.


## PU30 yapılandırması

```python
@dataclass(frozen=True)
class PU30Config:
    rsi_length: int = 14
    rsi_threshold: float = 30.0
    rsi2_above_threshold: bool = False # strict_threshold=True zaten ikinci dip > 30 koşulunu zorunlu tutar
    require_higher_rsi: bool = True    # 2. dip RSI > 1. dip RSI
    require_lower_price: bool = True   # 2. dip Fiyat < 1. dip Fiyat
    allow_equal_price: Optional[bool] = None  # None: 1S eşit dip kabul eder; 4S/1G daha düşük dip ister
    strict_threshold: bool = True      # PU30: ilk dip < 30, ikinci dip > 30 (6 Ekim 2026 düzeltmesi)
    max_rsi_dip: float = 55.0          # 1. dip RSI bu tavanın altında olmalı (referans: rsi_uyumsuzluk.py/.pine)
    pivot_left_bars: int = 5
    pivot_right_bars: int = 2
    min_gap_bars: int = 8
    max_gap_bars: int = 60
    min_bounce_pct: float = 3.0
    signal_lifetime_bars: int = 5
```

## Veri ve PU30 tespiti


### _load_pu30_frames

```python
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
```


### detect_rsi_pu30

```python
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
```


## Periyot ve günlük yapı


### timeframe_state

```python
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
```


### daily_structure

```python
def daily_structure(df, state):
    """Daily PU support, otherwise last confirmed daily low; RSI/NU70 veto."""
    if df is None or state["data_status"] != "FRESH":
        return {"status": "UNKNOWN", "reason": "Günlük veri eksik veya güncel değil"}
    df = df.reset_index(drop=True)
    closed = df.is_closed.to_numpy(dtype=bool)
    lows = df.low.to_numpy(dtype=float)
    historical = state.get("pu30") if state.get("valid_pu30") else None
    if historical:
        p = historical["dip2"]["index"]
        support = historical["dip2"]["price"]
        broken = historical.get("invalidated", False)
        source = "DAILY_PU30_LOW"
    else:
        pivots = find_confirmed_pivot_lows(lows, 5, 2, closed)
        if not pivots:
            return {"status": "UNKNOWN", "reason": "Teyitli günlük dip yok"}
        p, source = pivots[-1], "DAILY_CONFIRMED_LOW"
        support = float(lows[p])
        broken = False
    broken = broken or bool(np.any(lows[p + 1:] < support))
    rsi = state.get("current_rsi")
    if rsi is None:
        return {"status": "UNKNOWN", "reason": "Günlük RSI hesaplanamadı"}
    negative = detect_rsi_nu70(df, interval="1d") is not None
    intact = not broken and rsi >= 30 and not negative
    return {"status": "INTACT" if intact else "BROKEN", "support": support,
            "support_source": source, "support_date": pd.Timestamp(df.date.iloc[p]).isoformat(),
            "current_rsi": rsi, "negative_divergence": negative,
            "reason": "Günlük dip korunuyor, RSI ≥30 ve NU70 yok" if intact else "Günlük dip, RSI veya negatif uyumsuzluk veto koşulu"}
```


## Çapraz iptal ve karar matrisi


### invalidate_session_from_hourly

```python
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
```


### classify_pu30_state

```python
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
```


## Makro Fibonacci ve ana birleştirme


### macro_fibonacci

```python
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
```


### build_mtf_decision

```python
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
    return {"state": state, "label": label, "action": action,
            "is_active_buy": state == "FULL_CONFIRMATION", "timeframes": states,
            "daily_structure": daily, "resistance": resistance,
            "resistance_broken": resistance_broken, "breakout_at": breakout_at,
            "current_price": current_price, "price_above_resistance": above,
            "layer_flags": {"1G_Saglam": daily["status"] == "INTACT",
                            "1S_PU": hourly["valid_pu30"], "4S_PU": session["valid_pu30"]},
            "macro_fibonacci": macro}
```
