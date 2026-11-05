"""
Experimental Testbed: PU30 Sonrası 1 Nolu İtki Dalgası (Impulse) & Fib Zaman Analizi
====================================================================================
Üretim (production) PU30 motoruna dokunmadan, Semih Hoca'nın tarif ettiği:
  1. Önce dip oluşumu + RSI uyumsuzluğu (PU30 -> t0, P0)
  2. Sonra 1 nolu itki dalgası oluşumu (t0 -> t1, P0 -> P1)
  3. 2 nolu düzeltme dalgası oluşumu (t1 -> t2, P1 -> P2, P2 > P0)
  4. Fib Zaman projeksiyonu (0 = t0, orta referans = t1, zaman startı = t2;
     0.382 / 0.618 / 1.000 / 1.618 sündürme ve standart projeksiyon modları)

Kullanım:
  .venv\\Scripts\\python.exe python_bot/scripts/testbed_impulse_fib_time.py VAKBN ISCTR --interval 1h
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python_bot.engine.data.provider import DataStatus, get_default_provider
from python_bot.engine.signals.rsi_pu30 import (
    DEFAULT_PU30_CONFIG,
    SCAN_LIFETIME_BARS,
    SCAN_MIN_GAP_BARS,
    detect_rsi_pu30,
    wilder_rsi,
)


def analyze_impulse_and_fib_time(
    df: pd.DataFrame,
    sig: Dict[str, Any],
    lb: int = 5,
    rb: int = 2,
) -> Dict[str, Any]:
    """
    PU30 2. dibinden (t0) itibaren:
      - 1 nolu itki dalgasının anatomisini (süre, % getiri, RSI ivmesi, hacim çarpanı, gövde oranı)
      - 2 nolu düzeltme dalgasının anatomisini (Fibo fiyat geri çekilmesi, süre oranı)
      - Fib Zaman (0.382 / 0.618 / 1.0 / 1.618) projeksiyon pencerelerini
    hesaplar.
    """
    df = df.reset_index(drop=True)
    if "is_closed" in df.columns:
        df = df[df["is_closed"]].reset_index(drop=True)

    closes = df["close"].to_numpy(dtype=np.float64)
    highs = df["high"].to_numpy(dtype=np.float64)
    lows = df["low"].to_numpy(dtype=np.float64)
    opens = df["open"].to_numpy(dtype=np.float64)
    vols = df["volume"].to_numpy(dtype=np.float64) if "volume" in df.columns else np.ones(len(df))
    dates = pd.to_datetime(df["date"])
    rsi = wilder_rsi(closes, 14)

    t0 = int(sig["dip2"]["index"])
    p0 = float(lows[t0])
    rsi0 = float(rsi[t0])

    # t0'dan sonraki yapı pivotlarını (2 nolu dalga dibi adayları) bul
    wave2_pivots: List[int] = []
    for p in range(t0 + 2, len(lows) - rb):
        left = lows[max(t0 + 1, p - lb):p]
        right = lows[p + 1:p + rb + 1]
        if len(left) > 0 and np.all(lows[p] < left) and np.all(lows[p] <= right):
            wave2_pivots.append(p)

    out: Dict[str, Any] = {
        "t0_index": t0,
        "t0_date": str(dates.iloc[t0])[:16],
        "p0_price": round(p0, 2),
        "rsi0": round(rsi0, 1),
        "durum": "itki_devam_ediyor",
    }

    if not wave2_pivots:
        # Henüz 2 nolu dalga dibi kesinleşmedi; mevcut en yüksek noktayı aday 1. dalga tepesi olarak incele
        if t0 + 1 < len(highs):
            t1_curr = t0 + 1 + int(np.argmax(highs[t0 + 1:]))
            p1_curr = float(highs[t1_curr])
            out["aday_dalga1"] = _compute_wave1_metrics(
                t0, t1_curr, p0, p1_curr, opens, highs, lows, closes, vols, rsi, dates
            )
        return out

    # İlk geçerli 1-2 dalga yapısını ve varsa daha büyük (ana) 1-2 yapısını çıkar
    t2 = wave2_pivots[0]
    if lows[t0 + 1:t2 + 1].min() < p0:
        out["durum"] = "dip_kirildi_gecersiz"
        return out

    between = slice(t0 + 1, t2)
    t1 = t0 + 1 + int(np.argmax(highs[between]))
    p1 = float(highs[t1])
    p2 = float(lows[t2])

    w1 = _compute_wave1_metrics(t0, t1, p0, p1, opens, highs, lows, closes, vols, rsi, dates)
    wave1_height = max(p1 - p0, 1e-9)
    retrace_pct = (p1 - p2) / wave1_height

    dt1 = max(t1 - t0, 1)
    dt2 = max(t2 - t1, 1)
    dt02 = max(t2 - t0, 1)

    # Mod A: Standart 3 noktalı Trend-Based Fib Time (t0 -> t1 referans, t2'den ileri projeksiyon)
    # Mod B: Sündürülmüş Fib Zaman (t0=0, t1=0.618 veya 0.382, t2=1.0 kalibrasyonu ile ileri projeksiyon)
    fib_ratios = [0.382, 0.618, 1.000, 1.382, 1.618, 2.618]
    proj_from_w1: Dict[str, Any] = {}
    proj_stretched_02: Dict[str, Any] = {}

    for r in fib_ratios:
        bars_a = max(1, int(round(dt1 * r)))
        proj_from_w1[f"{r:.3f}"] = _bar_target_info(df, dates, t2, bars_a)

        bars_b = max(1, int(round(dt02 * r)))
        proj_stretched_02[f"{r:.3f}"] = _bar_target_info(df, dates, t2, bars_b)

    # Dalga 2 sonrası (Dalga 3) gerçekleşen hareket (varsa)
    after_t2_confirm = t2 + rb
    wave3_progress: Optional[Dict[str, Any]] = None
    if after_t2_confirm < len(highs):
        t3_peak = after_t2_confirm + int(np.argmax(highs[after_t2_confirm:]))
        p3_peak = float(highs[t3_peak])
        broke_w1 = bool(np.any(closes[after_t2_confirm:] > p1))
        wave3_progress = {
            "w1_tepesi_kirildi": broke_w1,
            "max_price_after_w2": round(p3_peak, 2),
            "max_date_after_w2": str(dates.iloc[t3_peak])[:16],
            "bars_from_t2_to_peak": int(t3_peak - t2),
            "w3_vs_w1_price_ratio": round((p3_peak - p2) / wave1_height, 2),
            "w3_vs_w1_time_ratio": round((t3_peak - t2) / dt1, 2),
        }

    out.update({
        "durum": "1_2_yapisi_hazir",
        "dalga1": w1,
        "dalga2": {
            "t2_index": t2,
            "t2_date": str(dates.iloc[t2])[:16],
            "p2_price": round(p2, 2),
            "rsi2": round(float(rsi[t2]), 1),
            "duration_bars": dt2,
            "price_retracement_fib": round(retrace_pct, 3),
            "time_ratio_dt2_over_dt1": round(dt2 / dt1, 2),
            "t1_position_in_02": round(dt1 / dt02, 3),
        },
        "fib_zaman_w1_referans": proj_from_w1,
        "fib_zaman_02_sundurme": proj_stretched_02,
        "dalga3_takip": wave3_progress,
    })
    return out


def _compute_wave1_metrics(
    t0: int,
    t1: int,
    p0: float,
    p1: float,
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    vols: np.ndarray,
    rsi: np.ndarray,
    dates: pd.Series,
) -> Dict[str, Any]:
    dt1 = max(t1 - t0, 1)
    gain_pct = (p1 / p0 - 1.0) * 100.0
    rsi_start = float(rsi[t0])
    rsi_peak = float(np.nanmax(rsi[t0:t1 + 1]))

    # İtki kalitesi: yeşil mum oranı, gövde/boy oranı ve hacim artışı
    w1_slice = slice(t0 + 1, t1 + 1)
    bull_bars = int(np.sum(closes[w1_slice] > opens[w1_slice]))
    ranges = np.maximum(highs[w1_slice] - lows[w1_slice], 1e-9)
    bodies = np.abs(closes[w1_slice] - opens[w1_slice])
    body_ratio = float(np.mean(bodies / ranges)) if len(ranges) else 0.0

    prior_slice = slice(max(0, t0 - 20), t0 + 1)
    prior_vol = float(np.mean(vols[prior_slice])) if prior_slice.stop > prior_slice.start else 1.0
    w1_vol = float(np.mean(vols[w1_slice])) if len(vols[w1_slice]) else prior_vol
    vol_mult = w1_vol / max(prior_vol, 1.0)

    return {
        "t1_index": t1,
        "t1_date": str(dates.iloc[t1])[:16],
        "p1_price": round(p1, 2),
        "duration_bars": dt1,
        "gain_pct": round(gain_pct, 2),
        "rsi_start": round(rsi_start, 1),
        "rsi_peak": round(rsi_peak, 1),
        "rsi_delta": round(rsi_peak - rsi_start, 1),
        "rsi_crossed_50": bool(rsi_peak >= 50.0),
        "bull_bar_ratio": round(bull_bars / dt1, 2),
        "avg_body_to_range": round(body_ratio, 2),
        "volume_multiplier": round(vol_mult, 2),
    }


def _bar_target_info(df: pd.DataFrame, dates: pd.Series, t2: int, offset_bars: int) -> Dict[str, Any]:
    target_idx = t2 + offset_bars
    if target_idx < len(df):
        return {
            "bar_offset": offset_bars,
            "target_index": target_idx,
            "target_date": str(dates.iloc[target_idx])[:16],
            "close_at_target": round(float(df["close"].iloc[target_idx]), 2),
        }
    bars_ahead = target_idx - (len(df) - 1)
    return {
        "bar_offset": offset_bars,
        "target_index": target_idx,
        "target_date": f"+{bars_ahead} bar ileride",
        "close_at_target": None,
    }


def analyze_viop_15m_gkd(symbol: str, pivot_open: Any, interval: str, bull: bool) -> Dict[str, Any]:
    """
    Semih Hoca VİOP Kuralı (ASELS 5 Kasım 2026 15dk örneği):
    1 saatlikte PU30 veya NU70 bulunduğunda, Güven Kıran Dip (GKD) / Güven Tazeleyen Tepe (GTT)
    15 dakikalık grafikte aranır; yatay çizgi çekilir, 15dk mum kapanışı kırılınca işlem tetiklenir.
    """
    import yfinance as yf
    from python_bot.engine.signals.rsi_pu30 import hourly_trust_level, normalize_bist_symbol

    yf_sym = normalize_bist_symbol(symbol)
    try:
        raw15 = yf.Ticker(yf_sym).history(period="30d", interval="15m")
        if raw15 is None or raw15.empty:
            return {"durum": "15dk_veri_yok"}
        df15 = raw15.reset_index().rename(
            columns={"Datetime": "date", "Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"}
        )
        df15["is_closed"] = True
        res = hourly_trust_level(df15, pivot_open, interval, bull=bull)
        if res.get("price") is not None and res.get("kirilim_date"):
            # Kırılım sonrası retest ("gitti geldi") ve maksimum çözülme/ralli hesabı
            dates15 = pd.to_datetime(df15["date"])
            k_mask = dates15 >= pd.Timestamp(res["kirilim_date"])
            after_df = df15[k_mask]
            lvl = float(res["price"])
            if len(after_df) > 0:
                if bull:
                    max_move = float(after_df["high"].max())
                    retest_bars = int(((after_df["low"] <= lvl * 1.003) & (after_df["close"] >= lvl * 0.997)).sum())
                    move_pct = round((max_move / lvl - 1.0) * 100.0, 2)
                else:
                    max_move = float(after_df["low"].min())
                    retest_bars = int(((after_df["high"] >= lvl * 0.997) & (after_df["close"] <= lvl * 1.003)).sum())
                    move_pct = round((1.0 - max_move / lvl) * 100.0, 2)
                res["retest_bar_sayisi"] = retest_bars
                res["kirilim_sonrasi_uc_fiyat"] = round(max_move, 2)
                res["kirilim_sonrasi_hareket_pct"] = move_pct
        return res
    except Exception as e:
        return {"durum": f"hata: {e}"}


def analyze_15m_to_1h_fractal_chain(symbol: str, provider: Any) -> Dict[str, Any]:
    """
    Semih Hoca 15dk -> 1s Fraktal Zincir Kuralı (PGSUS & ASELS Kasım 2026):
    1) Sadece 15dk'da NU70 varsa (Saatlikte NU70 yoksa, üst periyot 4s/G PU30 boğadaysa):
       -> ÇOK TEHLİKELİ TUZAK! 'Öğlene kadar düşerim, öğleden sonra dönüp yeni zirve yapabilirim' der.
    2) Fiyat 15dk düzeltmesinden sonra 'dönüp yeni zirveyi (veya ikili tepeyi) aldığında':
       -> 1 Saatlikte (1s) NU70 doğar! Ardından 15dk GKD kırılınca gerçek basış başlar (ASELS 3-5 Kasım).
    """
    import dataclasses
    from python_bot.engine.signals.rsi_pu30 import (
        DEFAULT_NU70_CONFIG, DEFAULT_PU30_CONFIG, SCAN_LIFETIME_BARS, SCAN_MIN_GAP_BARS,
        detect_rsi_nu70, detect_rsi_pu30,
    )

    out: Dict[str, Any] = {}
    for tf in ("15m", "1h", "4h", "1d"):
        r = provider.fetch_ohlcv(symbol, interval=tf, include_forming_bar=False)
        if r.status != DataStatus.FRESH or r.df is None:
            continue
        pu_c = dataclasses.replace(
            DEFAULT_PU30_CONFIG,
            signal_lifetime_bars=SCAN_LIFETIME_BARS.get(tf, 15),
            min_gap_bars=SCAN_MIN_GAP_BARS.get(tf, 6),
        )
        nu_c = dataclasses.replace(
            DEFAULT_NU70_CONFIG,
            signal_lifetime_bars=SCAN_LIFETIME_BARS.get(tf, 15),
            min_gap_bars=SCAN_MIN_GAP_BARS.get(tf, 6),
        )
        out[f"{tf}_pu30"] = detect_rsi_pu30(r.df, pu_c, interval=tf)
        out[f"{tf}_nu70"] = detect_rsi_nu70(r.df, nu_c, interval=tf)
    return out


def main() -> int:
    import dataclasses
    from python_bot.engine.signals.rsi_pu30 import DEFAULT_NU70_CONFIG, detect_rsi_nu70, hourly_trust_level

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="Testbed: PU30/NU70 Sonrası 1-2 İtki, 15dk VİOP GKD/GVT & Fib Zaman Analizi")
    ap.add_argument("symbols", nargs="*", default=["PGSUS", "ASELS", "VAKBN", "ISCTR"], help="İncelenecek semboller")
    ap.add_argument("--interval", default="1h", choices=["15m", "1h", "4h", "1d"])
    args = ap.parse_args()

    provider = get_default_provider()
    pu_cfg = dataclasses.replace(
        DEFAULT_PU30_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(args.interval, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(args.interval, 8),
    )
    nu_cfg = dataclasses.replace(
        DEFAULT_NU70_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(args.interval, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(args.interval, 8),
    )

    for sym in args.symbols:
        res = provider.fetch_ohlcv(sym, interval=args.interval, include_forming_bar=False)
        if res.status != DataStatus.FRESH or res.df is None:
            print(f"{sym}: veri alınamadı ({res.status})")
            continue

        sig_pu = detect_rsi_pu30(res.df, pu_cfg, ignore_lifetime=True, interval=args.interval)
        sig_nu = detect_rsi_nu70(res.df, nu_cfg, ignore_lifetime=True, interval=args.interval)

        # En yakın (en güncel) sinyali seç
        candidates = [s for s in (sig_pu, sig_nu) if s is not None]
        if not candidates:
            print(f"{sym} [{args.interval}]: PU30 / NU70 sinyali bulunamadı")
            continue
        sig = min(candidates, key=lambda s: s["bars_since_confirm"])
        is_bull = sig["type"] == "PU30"

        print("=" * 82)
        p1 = sig["dip1"] if is_bull else sig["tepe1"]
        p2 = sig["dip2"] if is_bull else sig["tepe2"]
        lbl = "Dip" if is_bull else "Tepe"
        print(f"{sym} [{args.interval}] {sig['type']} | 1. {lbl}: {p1['price']:.2f} ({p1['date']}, RSI {p1['rsi']:.1f}) -> "
              f"2. {lbl} (t0): {p2['price']:.2f} ({p2['date']}, RSI {p2['rsi']:.1f})")

        # Fraktal Zincir (15dk -> 1s -> 4s -> 1d) Durumu
        chain = analyze_15m_to_1h_fractal_chain(sym, provider)
        active_tfs = [f"{tf}:{t}" for tf in ("15m", "1h", "4h", "1d") for t in ("pu30", "nu70") if chain.get(f"{tf}_{t}")]
        print(f"  [Aktif Fraktal Zincir] {', '.join(active_tfs) if active_tfs else 'Yok'}")
        if chain.get("15m_nu70") and not chain.get("1h_nu70"):
            bull_upper = [tf for tf in ("1h", "4h", "1d") if chain.get(f"{tf}_pu30")]
            print(f"  [⚠️ 15dk UYUMSUZLUK TUZAĞI UYARISI] Üst periyotta ({'+'.join(bull_upper) or '1s'}) NU70 YOK! "
                  "15dk uyumsuzlukta short açmak ÇOK TEHLİKELİ: 'Öğlene kadar düşerim, öğleden sonra dönüp yeni zirve yapabilirim' der. "
                  "Ancak dönüp yeni zirveyi aldığında Saatlikte (1s) NU70 doğarsa o zaman gerçek basış başlar!")
        elif chain.get("1h_nu70"):
            print("  [🚨 SAATLİK NU70 AKTİF] 15dk düzeltmesi sonrası dönüp zirveyi yokladı ve Saatlikte NU70 doğurdu -> 15dk GKD kırılımıyla basış!")

        # Alt Periyot GVT/GKD Analizi (Günlüğün GVT'si Saatlik; Saatliğin GVT'si 15 Dakikalık)
        pivot_open_ts = res.df["date"].iloc[p2["index"]]
        seviye_adi = "Güven Tazeleyen Tepe (GVT)" if is_bull else "Güven Kıran Dip (GKD)"
        if args.interval in ("1d", "4h"):
            h1_res = provider.fetch_ohlcv(sym, interval="1h", include_forming_bar=False)
            if h1_res.df is not None:
                lvl_1h = hourly_trust_level(h1_res.df, pivot_open_ts, args.interval, bull=is_bull)
                print(f"  [Alt Periyot Kuralı: {args.interval} -> 1 Saatlik {seviye_adi} (Min 15 Gün Vade, <1 Günde Bozulma Takibi)]")
                print(f"    1s {seviye_adi}: {lvl_1h.get('price')} TL ({str(lvl_1h.get('date'))[:16]}) | Durum: {lvl_1h.get('durum')} | "
                      f"Kırılım: {str(lvl_1h.get('kirilim_date', '-'))[:16]} | Son Kapanış: {lvl_1h.get('son_kapanis')} TL")
        else:
            # 1s sinyalde hem 1s GVT hem 15dk GVT kıyaslaması ("Saatlik gvt ararsan 3 lira kazanırsın, 15 dakikalığa göre ara")
            lvl_1h = hourly_trust_level(res.df, pivot_open_ts, args.interval, bull=is_bull)
            gkd15 = analyze_viop_15m_gkd(sym, pivot_open_ts, args.interval, bull=is_bull)
            if gkd15.get("price") is not None:
                ext_info = gkd15.get("dip" if is_bull else "zirve", {})
                yapi_info = gkd15.get("yapi_pivotu", {})
                print(f"  [Alt Periyot Kuralı: 1 Saatlik -> 15dk {seviye_adi}] Yatay Çizgi: {gkd15['price']:.2f} TL ({str(gkd15.get('date'))[:16]}) | Durum: {gkd15['durum']}")
                print(f"    15dk Uç Nokta: {ext_info.get('price')} ({str(ext_info.get('date'))[:16]}) -> "
                      f"Yapı Pivotu: {yapi_info.get('price')} ({str(yapi_info.get('date'))[:16]})")
                if gkd15.get("kirildi"):
                    print(f"    15dk Kırılım Kapanışı: {str(gkd15.get('kirilim_date'))[:16]} | "
                          f"Retest ('Gitti-Geldi') Barı: {gkd15.get('retest_bar_sayisi', 0)} bar | "
                          f"Kırılım Sonrası Uç: {gkd15.get('kirilim_sonrasi_uc_fiyat')} TL (%{gkd15.get('kirilim_sonrasi_hareket_pct')}) | "
                          f"Son Kapanış: {gkd15.get('son_kapanis')} TL")
                if lvl_1h.get("price") is not None:
                    print(f"    [Kıyas: 1s {seviye_adi} Aransaydı] Seviye: {lvl_1h['price']:.2f} TL (Kırılım: {str(lvl_1h.get('kirilim_date', '-'))[:16]}) "
                          f"vs 15dk {seviye_adi}: {gkd15['price']:.2f} TL (Kırılım: {str(gkd15.get('kirilim_date', '-'))[:16]})")

        if is_bull:
            report = analyze_impulse_and_fib_time(res.df, sig)
            if "dalga1" in report:
                w1 = report["dalga1"]
                w2 = report["dalga2"]
                print(f"  [1 Nolu İtki Dalgası]  t0 -> t1 ({w1['t1_date']}) | Fiyat: {report['p0_price']} -> {w1['p1_price']} "
                      f"(+%{w1['gain_pct']}) | Süre: {w1['duration_bars']} bar")
                print(f"    İtki Anatomisi: RSI {w1['rsi_start']} -> {w1['rsi_peak']} (+{w1['rsi_delta']}, "
                      f"RSI>=50: {w1['rsi_crossed_50']}) | Yeşil Mum: %{int(w1['bull_bar_ratio']*100)} | "
                      f"Gövde/Boy: {w1['avg_body_to_range']} | Hacim Çarpanı: {w1['volume_multiplier']}x")
                print(f"  [2 Nolu Düzeltme]      t1 -> t2 ({w2['t2_date']}) | Fiyat: {w1['p1_price']} -> {w2['p2_price']} "
                      f"(Fibo Geri Çekilme: {w2['price_retracement_fib']}) | Süre: {w2['duration_bars']} bar "
                      f"(t1 konumu t0..t2 içinde: {w2['t1_position_in_02']})")
                print("  [Fib Zaman Projeksiyonu (t2 Zaman Startından İleri)]")
                for k in ("0.382", "0.618", "1.000", "1.618"):
                    fa = report["fib_zaman_w1_referans"][k]
                    fb = report["fib_zaman_02_sundurme"][k]
                    print(f"    Fib {k}: W1-Bazlı (+{fa['bar_offset']}b -> {fa['target_date']}, kapanış={fa['close_at_target']}) | "
                          f"0-2 Sündürme (+{fb['bar_offset']}b -> {fb['target_date']}, kapanış={fb['close_at_target']})")
                if report.get("dalga3_takip"):
                    w3 = report["dalga3_takip"]
                    print(f"  [Dalga 3 Takip]        W1 Kırıldı: {w3['w1_tepesi_kirildi']} | "
                          f"Zirve: {w3['max_price_after_w2']} ({w3['max_date_after_w2']}, t2'den +{w3['bars_from_t2_to_peak']} bar) | "
                          f"W3/W1 Fiyat: {w3['w3_vs_w1_price_ratio']}x | W3/W1 Süre: {w3['w3_vs_w1_time_ratio']}x")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

