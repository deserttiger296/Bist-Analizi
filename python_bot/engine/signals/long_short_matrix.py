# -*- coding: utf-8 -*-
"""
Long / Short Karar Matrisi & VİOP Strateji Motoru (Semih Hoca Metodolojisi)
==========================================================================
PU30 (Dip Dönüşü & GVT Teyidi) -> LONG (Spot Alım / VİOP Uzun)
NU70 (Zirve Yorulması & GKD Kırılımı) -> SHORT (Spot Çıkış / VİOP Açığa Satış)
"""
from __future__ import annotations

import dataclasses
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

from python_bot.engine.data.provider import DataStatus, get_default_provider
from python_bot.engine.signals.nu70_confirmation import detect_early_highest_nu70_candidate
from python_bot.engine.signals.rsi_pu30 import (
    DEFAULT_NU70_CONFIG,
    DEFAULT_PU30_CONFIG,
    MIN_BARS_REQUIRED,
    SCAN_LIFETIME_BARS,
    SCAN_MIN_GAP_BARS,
    _fetch_adjusted_bars,
    apply_hourly_trust_level,
    detect_rsi_nu70,
    detect_rsi_pu30,
    scan_universe_rsi_pu30,
    wilder_rsi,
)
from python_bot.engine.universe import BIST100_SYMBOLS

VIOP_SYMBOLS: Set[str] = {
    "AEFES", "AKBNK", "ARCLK", "ASELS", "ASTOR", "BIMAS", "CCOLA", "DOHOL", "EKGYO", "ENKAI",
    "EREGL", "FROTO", "GARAN", "GUBRF", "HALKB", "HEKTS", "ISCTR", "KCHOL", "KRDMD", "MGROS",
    "OYAKC", "PETKM", "PGSUS", "SAHOL", "SASA", "SISE", "SOKM", "TAVHL", "TCELL", "THYAO",
    "TOASO", "TRALT", "TRMET", "TSKB", "TTKOM", "TTRAK", "TUPRS", "ULKER", "VAKBN", "VESTL",
    "YKBNK",
}


def _sub_tf_label(lvl: Dict[str, Any], interval: str) -> str:
    alt = lvl.get("alt_periyot")
    if alt == "15dk" or interval in ("15m", "1h"):
        return "15dk"
    return "Saatlik"


def _compute_short_action_state(
    last_close: float,
    tepe2_price: float,
    lvl: Dict[str, Any],
    interval: str,
) -> Dict[str, Any]:
    """NU70 short stop, hedef, R:R ve alt-periyot GKD kırılım durumunu hesaplar."""
    lvl_price = lvl.get("price")
    lvl_durum = lvl.get("durum")
    fiyat_konum = lvl.get("fiyat_seviyenin")
    tf_lbl = _sub_tf_label(lvl, interval)
    gkd_price = round(float(lvl_price), 2) if lvl_price is not None else None
    raw_broken = (lvl_price is not None) and (lvl_durum == "kirildi")
    triggered = raw_broken and (fiyat_konum in (None, "altinda"))

    stop_loss = round(float(tepe2_price) * 1.025, 2)
    risk = max(stop_loss - last_close, last_close * 0.02)
    target_1r = round(max(0.01, last_close - (risk * 1.0)), 2)
    target_tp1 = round(max(0.01, last_close - (risk * 2.0)), 2)
    target_tp2 = round(max(0.01, last_close - (risk * 3.5)), 2)
    rr_ratio = round((last_close - target_tp1) / max(risk, 0.01), 2)

    action = "SHORT" if triggered else "SHORT_PUSD"
    if triggered:
        status_text = f"{tf_lbl} GKD Kırıldı (Satış / Çıkış)"
    elif raw_broken and fiyat_konum == "ustunde":
        status_text = f"{tf_lbl} GKD Üzerine Döndü (Teyit Bekleniyor)"
    else:
        status_text = f"{tf_lbl} GKD Bekleniyor (Zirve Yorulması)"

    return {
        "gkd_price": gkd_price,
        "triggered": triggered,
        "action": action,
        "status_text": status_text,
        "stop_loss": stop_loss,
        "target_1r": target_1r,
        "target_tp1": target_tp1,
        "target_tp2": target_tp2,
        "rr_ratio": rr_ratio,
        "entry_level": gkd_price if gkd_price is not None else round(float(tepe2_price), 2),
    }


def _format_early_candidate(sym_name: str, interval_name: str, cand: Dict[str, Any]) -> Dict[str, Any]:
    candle = cand.get("peak_candle") or {}
    p1 = cand["tepe1"]
    p2 = cand["tepe2"]
    gkd = cand.get("guven_kiran_dip") or {}
    return {
        "symbol": sym_name,
        "interval": interval_name,
        "type": "NU70_ADAY",
        "candidate_kind": cand["candidate_kind"],
        "last_close": cand["last_close"],
        "entry_level": gkd.get("price"),
        "gkd_broken": bool(gkd.get("kirildi")),
        "stop_loss": round(float(p2["price"]) * 1.025, 2),
        "is_viop": sym_name in VIOP_SYMBOLS,
        "tepe1_rsi": p1["rsi"],
        "tepe2_rsi": p2["rsi"],
        "rsi_at_peak": p2.get("rsi_at_peak"),
        "tepe1_price": round(float(p1["price"]), 2),
        "tepe2_price": round(float(p2["price"]), 2),
        "peak_candle": candle,
        "is_hanging_man": bool(candle.get("is_hanging_man")),
        "is_shooting_star": bool(candle.get("is_shooting_star")),
        "candle_label": candle.get("label_tr", "Yok"),
        "pullback_pct": cand["pullback_pct"],
        "gap_bars": cand["gap_bars"],
        "confirm_date": cand["confirm_date"],
    }


def build_long_short_matrix(
    symbols: Optional[List[str]] = None,
    intervals: tuple = ("1h", "4h"),
    viop_only: bool = False,
    max_workers: int = 6,
) -> Dict[str, Any]:
    """
    Tüm evren için Semih PU30/NU70 sinyallerini tarar ve Long / Short
    aksiyon seviyeleri, hedefler, stoplar ve piyasa yönüyle birleştirir.
    """
    target_symbols = [s.upper().strip() for s in (symbols or BIST100_SYMBOLS)]
    if viop_only:
        target_symbols = [s for s in target_symbols if s in VIOP_SYMBOLS]

    long_candidates: List[Dict[str, Any]] = []
    short_candidates: List[Dict[str, Any]] = []
    short_early_candidates: List[Dict[str, Any]] = []
    scan_errors: List[Dict[str, str]] = []
    strict_short_keys: Set[Tuple[str, str]] = set()

    for itv in intervals:
        scan_res = scan_universe_rsi_pu30(target_symbols, max_workers=max_workers, interval=itv, signal_type="all")
        if scan_res.get("signals"):
            try:
                from python_bot.engine.journal.daily_history import log_pu30_signals
                log_pu30_signals(scan_res["signals"], interval=itv)
            except Exception:
                pass
        for err_msg in scan_res.get("errors") or []:
            scan_errors.append({
                "symbol": "*",
                "interval": str(itv),
                "stage": "strict_scan",
                "error": str(err_msg),
            })
        for sig in scan_res.get("signals", []):
            sym = str(sig.get("symbol", "")).upper()
            sig_type = sig.get("type")
            confluence = sig.get("confluence", "")
            last_close = round(float(sig.get("last_close", 0.0)), 2)
            lvl = sig.get("saatlik_seviye") or {}
            lvl_price = lvl.get("price")
            lvl_durum = lvl.get("durum")
            fiyat_konum = lvl.get("fiyat_seviyenin")
            tf_lbl = _sub_tf_label(lvl, itv)
            is_viop = sym in VIOP_SYMBOLS

            if sig_type == "PU30":
                p1 = sig.get("dip1", {})
                p2 = sig.get("dip2", {})
                gvt_price = round(float(lvl_price), 2) if lvl_price is not None else None
                raw_broken = (lvl_price is not None) and (lvl_durum == "kirildi")
                triggered = raw_broken and (fiyat_konum in (None, "ustunde"))

                stop_loss = round(float(p2.get("price", last_close)) * 0.975, 2)
                risk = max(last_close - stop_loss, last_close * 0.02)
                target_tp1 = round(last_close + (risk * 2.0), 2)
                target_tp2 = round(last_close + (risk * 3.5), 2)
                rr_ratio = round((target_tp1 - last_close) / max(risk, 0.01), 2)

                action = "LONG" if triggered else "LONG_PUSD"
                if triggered:
                    status_text = f"{tf_lbl} GVT Aşıldı (Alım Onaylı)"
                elif raw_broken and fiyat_konum == "altinda":
                    status_text = f"{tf_lbl} GVT Altına Döndü (Teyit Bekleniyor)"
                else:
                    status_text = f"{tf_lbl} GVT Bekleniyor (Pusuda)"

                long_candidates.append({
                    "symbol": sym,
                    "interval": itv,
                    "type": "PU30",
                    "action": action,
                    "status_text": status_text,
                    "confluence": confluence,
                    "last_close": last_close,
                    "entry_level": gvt_price if gvt_price is not None else round(float(p2.get("price", last_close)), 2),
                    "gvt_price": gvt_price,
                    "stop_loss": stop_loss,
                    "target_tp1": target_tp1,
                    "target_tp2": target_tp2,
                    "rr_ratio": rr_ratio,
                    "is_viop": is_viop,
                    "triggered": triggered,
                    "p1": p1,
                    "p2": p2,
                    "knowable_at": sig.get("knowable_at"),
                })

            elif sig_type == "NU70":
                strict_short_keys.add((sym, itv))
                p1 = sig.get("tepe1", {})
                p2 = sig.get("tepe2", {})
                s_state = _compute_short_action_state(last_close, float(p2.get("price", last_close)), lvl, itv)

                peak_candle = sig.get("peak_candle") or {}
                short_candidates.append({
                    "symbol": sym,
                    "interval": itv,
                    "type": "NU70",
                    "action": s_state["action"],
                    "status_text": s_state["status_text"],
                    "confluence": confluence,
                    "last_close": last_close,
                    "entry_level": s_state["entry_level"],
                    "gkd_price": s_state["gkd_price"],
                    "stop_loss": s_state["stop_loss"],
                    "target_tp1": s_state["target_tp1"],
                    "target_tp2": s_state["target_tp2"],
                    "rr_ratio": s_state["rr_ratio"],
                    "is_viop": is_viop,
                    "triggered": s_state["triggered"],
                    "p1": p1,
                    "p2": p2,
                    "tepe1_rsi": round(float(p1.get("rsi")), 1) if p1.get("rsi") is not None else None,
                    "tepe2_rsi": round(float(p2.get("rsi")), 1) if p2.get("rsi") is not None else None,
                    "rsi_at_peak": p2.get("rsi_at_peak"),
                    "peak_candle": peak_candle,
                    "is_hanging_man": bool(peak_candle.get("is_hanging_man")),
                    "is_shooting_star": bool(peak_candle.get("is_shooting_star")),
                    "candle_label": peak_candle.get("label_tr", "Yok"),
                    "knowable_at": sig.get("knowable_at"),
                })

        # Erken Yüksek Tepe & Asılan Adam Adayları (strict NU70 dışındaki izleme listesi)
        missing_syms = [s for s in target_symbols if (s, itv) not in strict_short_keys]
        if missing_syms:
            def _scan_early(
                sym_name: str, interval_name: str = itv
            ) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, str]]]:
                try:
                    df_sym, res_sym = _fetch_adjusted_bars(sym_name, interval=interval_name)
                    if res_sym is not None and res_sym.status != DataStatus.FRESH:
                        err_detail = getattr(res_sym, "error_message", None) or f"data_status:{res_sym.status.value}"
                        return None, {
                            "symbol": sym_name,
                            "interval": interval_name,
                            "stage": "early_nu70",
                            "error": str(err_detail),
                        }
                    if df_sym is None or len(df_sym) < MIN_BARS_REQUIRED:
                        return None, None
                    rsi_arr = wilder_rsi(df_sym["close"].to_numpy(dtype=float), 14)
                    cand = detect_early_highest_nu70_candidate(df_sym, rsi_arr, interval=interval_name)
                    if cand is None:
                        return None, None
                    return _format_early_candidate(sym_name, interval_name, cand), None
                except Exception as exc:
                    return None, {
                        "symbol": sym_name,
                        "interval": interval_name,
                        "stage": "early_nu70",
                        "error": f"{type(exc).__name__}: {exc}",
                    }

            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                for item, err in pool.map(_scan_early, missing_syms):
                    if item is not None:
                        short_early_candidates.append(item)
                    if err is not None:
                        scan_errors.append(err)

    long_candidates.sort(key=lambda x: (x["triggered"], x["rr_ratio"]), reverse=True)
    short_candidates.sort(
        key=lambda x: (
            x["triggered"],
            bool(x.get("is_hanging_man") or x.get("is_shooting_star")),
            x["rr_ratio"],
        ),
        reverse=True,
    )
    short_early_candidates.sort(
        key=lambda x: (
            bool(x.get("is_hanging_man")),
            bool(x.get("is_shooting_star")),
            -int(x.get("gap_bars", 99)),
        ),
        reverse=True,
    )

    long_active = sum(1 for x in long_candidates if x["triggered"])
    short_active = sum(1 for x in short_candidates if x["triggered"])

    if short_active >= max(long_active * 2, 4):
        market_bias = "DEFANSİF / SHORT BASKILI (Kâr Realizasyonu Fazı)"
        market_bias_code = "BEARISH"
    elif long_active >= max(short_active * 2, 4):
        market_bias = "AGRESİF / LONG TRENDİ (Dip Dönüşü Fazı)"
        market_bias_code = "BULLISH"
    else:
        market_bias = "NÖTR / DENGELİ (Seçici İki Yönlü Piyasa)"
        market_bias_code = "NEUTRAL"

    pair_trading = None
    if long_candidates and short_candidates:
        best_long = next((x for x in long_candidates if x["triggered"]), long_candidates[0])
        best_short = next((x for x in short_candidates if x["triggered"]), short_candidates[0])
        pair_trading = {
            "long_symbol": best_long["symbol"],
            "long_price": best_long["last_close"],
            "long_confluence": best_long["confluence"],
            "short_symbol": best_short["symbol"],
            "short_price": best_short["last_close"],
            "short_confluence": best_short["confluence"],
            "thesis": (
                f"Piyasa-Nötr Alfa Stratejisi: Endeks yönünden bağımsız, "
                f"güçlü dip dönüşü teyitli {best_long['symbol']} AL (LONG) ile "
                f"zirvede desteği kırılmış zayıf {best_short['symbol']} SAT (SHORT) eşleşmesi."
            ),
        }

    return {
        "status": "success",
        "market_bias": market_bias,
        "market_bias_code": market_bias_code,
        "total_scanned": len(target_symbols),
        "long_active_count": long_active,
        "short_active_count": short_active,
        "long_total": len(long_candidates),
        "short_total": len(short_candidates),
        "short_early_total": len(short_early_candidates),
        "scan_errors": scan_errors,
        "scan_error_count": len(scan_errors),
        "pair_trading": pair_trading,
        "longs": long_candidates,
        "shorts": short_candidates,
        "short_early_candidates": short_early_candidates,
    }


def _last_finite_rsi(df: Any) -> Optional[float]:
    rsi_arr = wilder_rsi(df["close"].to_numpy(dtype=np.float64), 14)
    finite_vals = rsi_arr[np.isfinite(rsi_arr)]
    return round(float(finite_vals[-1]), 1) if len(finite_vals) > 0 else None


def detect_oversold_pre_pu30(
    raw_df: Any,
    active_sig: Optional[Dict[str, Any]] = None,
    lookback_bars: int = 36,
    cfg: Any = None,
) -> Optional[Dict[str, Any]]:
    """
    Aşırı satım (RSI < 30) bölgesine inip henüz RSI > 30 üzerinde 2. dip (PU30)
    kurmamış hisseleri tespit eder (Semih Hoca ASELS 15dk Kuralı).
    """
    if raw_df is None:
        return None
    df_imp = raw_df.reset_index(drop=True)
    if "is_closed" in df_imp.columns:
        df_imp = df_imp[df_imp["is_closed"]].reset_index(drop=True)
    if len(df_imp) < MIN_BARS_REQUIRED:
        return None
    pu_cfg = cfg or DEFAULT_PU30_CONFIG
    closes_arr = df_imp["close"].to_numpy(dtype=np.float64)
    highs_arr = df_imp["high"].to_numpy(dtype=np.float64)
    lows_arr = df_imp["low"].to_numpy(dtype=np.float64)
    rsi_arr = wilder_rsi(closes_arr, pu_cfg.rsi_length)
    after_idx = int(active_sig["dip2"]["index"]) + 1 if (active_sig and active_sig.get("dip2")) else 0
    look_start = max(after_idx, len(df_imp) - lookback_bars)
    if look_start >= len(df_imp):
        return None
    win_rsi = rsi_arr[look_start:]
    fin_mask = np.isfinite(win_rsi)
    if not np.any(fin_mask):
        return None
    rel_min = int(np.argmin(np.where(fin_mask, win_rsi, np.inf)))
    min_rsi = float(win_rsi[rel_min])
    if not np.isfinite(min_rsi) or min_rsi >= pu_cfg.rsi_threshold:
        return None
    abs_idx = look_start + rel_min
    oversold_price = float(lows_arr[abs_idx])
    if not np.isfinite(oversold_price):
        return None
    last_fin = rsi_arr[np.isfinite(rsi_arr)]
    current_rsi = float(last_fin[-1]) if len(last_fin) > 0 else min_rsi
    tail_highs = highs_arr[abs_idx:]
    fin_highs = tail_highs[np.isfinite(tail_highs)]
    bounce_high = float(fin_highs.max()) if len(fin_highs) > 0 else oversold_price
    tail_rsi = rsi_arr[abs_idx:]
    fin_tail_rsi = tail_rsi[np.isfinite(tail_rsi)]
    max_rsi_after = float(fin_tail_rsi.max()) if len(fin_tail_rsi) > 0 else current_rsi
    has_reaction = bool(
        current_rsi >= 38.0
        or max_rsi_after >= 38.0
        or ((bounce_high / max(oversold_price, 0.01) - 1.0) * 100.0 >= 0.8)
    )
    oversold_date = str(df_imp["date"].iloc[abs_idx])[:16] if "date" in df_imp.columns else str(abs_idx)
    return {
        "has_oversold_dip1": True,
        "oversold_rsi": round(min_rsi, 1),
        "oversold_price": round(oversold_price, 2),
        "oversold_date": oversold_date,
        "current_rsi": round(current_rsi, 1),
        "has_reaction": has_reaction,
        "reaction_label": "Tepki Geldi → 2. Dip (PU30) Bekleniyor" if has_reaction else "Tepkisiz Düşüş → Şelale Riski",
        "next_dip_zone_below": round(oversold_price, 2),
        "badge": (
            f"⚠️ 1. Dip ({oversold_price:.2f} ₺, RSI {min_rsi:.1f} < 30) Görüldü · "
            f"Henüz RSI > 30 Dip Yok → {oversold_price:.2f} ₺ Altına En Az 1 Dip Daha Gelecek"
        ),
        "explanation": (
            f"Fiyat {oversold_date} mumunda {oversold_price:.2f} ₺ ile aşırı satıma (RSI {min_rsi:.1f} < 30) indi ve "
            f"şu an RSI {current_rsi:.1f} seviyesinde. Henüz RSI > 30 üzerinde 2. bir dip (PU30) yapmadı. "
            f"Semih Hoca İki Senaryolu Kuralı (ASELS 15dk): "
            f"(1) Tepki ile yükselip RSI güç toplarsa ({current_rsi:.1f}), oradan en az {oversold_price:.2f} ₺ altına bir dip daha sarkıp "
            f"RSI > 30 kalarak hızla kalkar (PU30). "
            f"(2) Tepki gelmeden / RSI güç toplamadan direkt aşağı basarlarsa şelale düşüşü devam eder, uzak durulur."
        ),
    }


def _evaluate_4h_fractal_context(
    sym: str,
    itv: str,
    target_1r: float,
    target_2r: float,
) -> Dict[str, Any]:
    """
    Semih Hoca 1S / 4S Fraktal & Günlük Döngü Kuralı:
    1S'de NU70 varken 4S'de henüz NU70 yoksa ara salınım (1R) sonrası
    4S NU70'i kurmak için en az 1 zirve daha beklenir; asıl sert satış o zirvededir.
    Günlükte RSI < 70 (düşüş/tepki trendi) ise günlükte tepe aramak anlamsızdır;
    satışlar Günlük RSI < 30'a inip tepki + yeni dip (PU30) kurana kadar sürer.
    """
    rsi_1d: Optional[float] = None
    try:
        df_1d, res_1d = _fetch_adjusted_bars(sym, interval="1d")
        if df_1d is not None and len(df_1d) >= MIN_BARS_REQUIRED and (res_1d is None or res_1d.status == DataStatus.FRESH):
            rsi_1d = _last_finite_rsi(df_1d)
    except Exception:
        rsi_1d = None

    daily_note = (
        f" Günlükte tepe aramak anlamsız (Günlük RSI: {rsi_1d}, kağıt günlükte tepede değil / düşüş trendinde). "
        f"Satışlar Günlük RSI 30 altına (aşırı satıma) inene kadar sürer; ardından ilk tepki (1. dalga) ve "
        f"Günlük RSI > 30 üzerinde yeni dip (Günlük PU30 = ana dönüş yeri) oluşur."
        if rsi_1d is not None and rsi_1d < 70.0
        else ""
    )

    if itv == "15m":
        has_1h_nu70 = False
        rsi_1h: Optional[float] = None
        try:
            df_1h, res_1h = _fetch_adjusted_bars(sym, interval="1h")
            if df_1h is not None and len(df_1h) >= MIN_BARS_REQUIRED and (res_1h is None or res_1h.status == DataStatus.FRESH):
                rsi_1h = _last_finite_rsi(df_1h)
                cfg_1h = dataclasses.replace(
                    DEFAULT_NU70_CONFIG,
                    signal_lifetime_bars=SCAN_LIFETIME_BARS.get("1h", 24),
                    min_gap_bars=SCAN_MIN_GAP_BARS.get("1h", 8),
                )
                sig_1h = detect_rsi_nu70(df_1h, cfg_1h, ignore_lifetime=False, interval="1h")
                has_1h_nu70 = bool(sig_1h and not sig_1h.get("invalidated"))
        except Exception:
            has_1h_nu70 = False
            rsi_1h = None

        if not has_1h_nu70:
            rsi_txt = f" (1S RSI: {rsi_1h})" if rsi_1h is not None else ""
            return {
                "has_1h_nu70": False,
                "rsi_1h": rsi_1h,
                "has_4h_nu70": False,
                "rsi_4h": None,
                "rsi_1d": rsi_1d,
                "fractal_phase_code": "TUZAK_15DK_YENI_ZIRVE_BEKLENIR",
                "fractal_phase_badge": "☠️ 15dk Tek Başına NU70 Tuzak: Öğleden Sonra Yeni Zirve Riski",
                "recommended_tp_label": "1R Kısa Salınım Hedefi (Tuzak Riski — Şort Tehlikeli)",
                "recommended_tp_price": target_1r,
                "fractal_profit_plan": (
                    f"15 Dakikalıkta NU70 oluştu ancak Saatlikte (1S) henüz NU70 YOK{rsi_txt}. Semih Hoca Kuralı: "
                    f"'Öğlene kadar düşerim, öğleden sonra dönüp yeni zirve yapabilirim' der. 15dk'lık uyumsuzluk tek başına "
                    f"tuzaktır; en fazla 1R ({target_1r:.2f} ₺) kısa salınım beklenir. Asıl sert basış dönüp yeni zirveyi aldığında "
                    f"Saatlikte (1S) NU70 doğarsa başlar (ASELS örneği).{daily_note}"
                ),
            }

        return {
            "has_1h_nu70": True,
            "rsi_1h": rsi_1h,
            "has_4h_nu70": False,
            "rsi_4h": None,
            "rsi_1d": rsi_1d,
            "fractal_phase_code": "KASKAD_15DK_1S_ONAYLI",
            "fractal_phase_badge": "🔥 15dk + 1S NU70 Onaylı: Gerçek Basış Başladı",
            "recommended_tp_label": "2R Ana Düşüş Hedefi (Saatlik Onaylı Basış)",
            "recommended_tp_price": target_2r,
            "fractal_profit_plan": (
                f"Hem 15 Dakikalık hem Saatlik (1S) grafikte NU70 onaylandı. "
                f"Tuzak aşaması geçildi ve yeni zirve sonrası Saatlik NU70 devreye girdiği için gerçek satış basışı başlıyor; "
                f"2R Ana Hedef ({target_2r:.2f} ₺) takip edilir.{daily_note}"
            ),
        }

    if itv != "1h":
        return {
            "has_1h_nu70": True,
            "rsi_1h": None,
            "has_4h_nu70": itv == "4h",
            "rsi_4h": None,
            "rsi_1d": rsi_1d,
            "fractal_phase_code": "ANA_ZIRVE_SERT_SATIS",
            "fractal_phase_badge": f"🔥 {itv.upper()} Ana Zirve NU70: Sert Satış Fazı",
            "recommended_tp_label": "2R Ana Düşüş Hedefi",
            "recommended_tp_price": target_2r,
            "fractal_profit_plan": (
                f"{itv.upper()} ana periyotta NU70 zirvesi oluştu; 1 Saatlik GKD kırılımıyla birlikte "
                f"2R Ana Hedef ({target_2r:.2f} ₺) odaklı sert satış fazıdır.{daily_note}"
            ),
        }

    has_4h_nu70 = False
    rsi_4h: Optional[float] = None
    try:
        df_4h, res_4h = _fetch_adjusted_bars(sym, interval="4h")
        if df_4h is not None and len(df_4h) >= MIN_BARS_REQUIRED and (res_4h is None or res_4h.status == DataStatus.FRESH):
            rsi_4h = _last_finite_rsi(df_4h)
            cfg_4h = dataclasses.replace(
                DEFAULT_NU70_CONFIG,
                signal_lifetime_bars=SCAN_LIFETIME_BARS.get("4h", 15),
                min_gap_bars=SCAN_MIN_GAP_BARS.get("4h", 6),
            )
            sig_4h = detect_rsi_nu70(df_4h, cfg_4h, ignore_lifetime=False, interval="4h")
            has_4h_nu70 = bool(sig_4h and not sig_4h.get("invalidated"))
    except Exception:
        has_4h_nu70 = False
        rsi_4h = None

    if not has_4h_nu70:
        rsi_txt = f" (4S RSI: {rsi_4h})" if rsi_4h is not None else ""
        return {
            "has_4h_nu70": False,
            "rsi_4h": rsi_4h,
            "rsi_1d": rsi_1d,
            "fractal_phase_code": "SALINIM_SONRA_YENI_ZIRVE",
            "fractal_phase_badge": "⚠️ 4S NU Yok: Önce Salınım → Sonra 1 Zirve Daha",
            "recommended_tp_label": "1R Ara Salınım Hedefi (Kısa Kâr Al)",
            "recommended_tp_price": target_1r,
            "fractal_profit_plan": (
                f"1S NU70 yakalandı ancak 4 Saatlikte henüz NU70 YOK{rsi_txt}. Semih Hoca Kuralı: "
                f"Kağıt kesin salacak (ara düzeltme) fakat saldıktan sonra 4S NU70'i kurmak için EN AZ 1 ZİRVE DAHA yapacak. "
                f"Kâr Hesabı: Bu ilk salınımda hedef abartılmaz, 1R Ara Salınım Hedefi ({target_1r:.2f} ₺) bölgesinde kâr alınır; "
                f"asıl sert satış bir sonraki yeni zirvede 4S NU70 doğduğunda yapılır.{daily_note}"
            ),
        }

    return {
        "has_4h_nu70": True,
        "rsi_4h": rsi_4h,
        "rsi_1d": rsi_1d,
        "fractal_phase_code": "CIFT_KILIT_SERT_SATIS",
        "fractal_phase_badge": "🔥 1S + 4S NU70 Onaylı: Sert Satış Fazı",
        "recommended_tp_label": "2R Ana Düşüş Hedefi (Sert Satış)",
        "recommended_tp_price": target_2r,
        "fractal_profit_plan": (
            f"Hem 1 Saatlik hem 4 Saatlik grafikte NU70 tamamlanmış durumda. "
            f"'Bir zirve daha' aşaması geçildiği için net ve sert satış fazıdır; "
            f"2R Ana Hedef ({target_2r:.2f} ₺) takip edilir.{daily_note}"
        ),
    }


def build_nu70_peak_lab(
    symbols: Optional[List[str]] = None,
    interval: str = "1h",
    viop_only: bool = False,
    max_workers: int = 6,
) -> Dict[str, Any]:
    """
    Semih NU70 (görülen en yüksek fiyatta RSI < 70) + Asılan Adam / Kayan Yıldız
    ve erken tepe izleme adaylarını Long / Short Matrisi'nden bağımsız tarar.
    """
    itv = interval if interval in ("15m", "1h", "4h", "1d") else "1h"
    sub_interval = "15m" if itv in ("15m", "1h") else "1h"

    target_symbols = [s.upper().strip() for s in (symbols or BIST100_SYMBOLS) if s and s.strip()]
    if viop_only:
        target_symbols = [s for s in target_symbols if s in VIOP_SYMBOLS]

    if len(target_symbols) > 1:
        try:
            provider = get_default_provider()
            if hasattr(provider, "prefetch_ohlcv_batch"):
                for prefetch_itv in tuple(dict.fromkeys((itv, sub_interval, "1h", "4h", "1d"))):
                    try:
                        provider.prefetch_ohlcv_batch(target_symbols, interval=prefetch_itv)
                    except Exception:
                        pass
        except Exception:
            pass

    cfg = dataclasses.replace(
        DEFAULT_NU70_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(itv, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(itv, 8),
    )
    pu_cfg = dataclasses.replace(
        DEFAULT_PU30_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(itv, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(itv, 8),
    )

    def _analyze_one(sym: str) -> Dict[str, Any]:
        try:
            df, res_sym = _fetch_adjusted_bars(sym, interval=itv)
            if res_sym is not None and res_sym.status != DataStatus.FRESH:
                err_detail = getattr(res_sym, "error_message", None) or f"data_status:{res_sym.status.value}"
                return {
                    "error": {
                        "symbol": sym,
                        "interval": itv,
                        "stage": "nu70_peak_lab",
                        "error": str(err_detail),
                    }
                }
            if df is None or len(df) < MIN_BARS_REQUIRED:
                if df is None:
                    return {
                        "error": {
                            "symbol": sym,
                            "interval": itv,
                            "stage": "nu70_peak_lab",
                            "error": "insufficient_history",
                        }
                    }
                return {}

            last_close = round(float(df["close"].iloc[-1]), 2)
            is_viop = sym in VIOP_SYMBOLS
            sig = detect_rsi_nu70(df, cfg, ignore_lifetime=False, interval=itv, include_invalidated=True)

            out: Dict[str, Any] = {}
            sig_pu = detect_rsi_pu30(df, pu_cfg, ignore_lifetime=True, interval=itv)
            pre_pu30 = detect_oversold_pre_pu30(df, sig_pu, cfg=pu_cfg)
            if pre_pu30 is not None:
                out["oversold_watch"] = {
                    "symbol": sym,
                    "interval": itv,
                    "is_viop": is_viop,
                    "last_close": last_close,
                    **pre_pu30,
                }
            has_active_strict = sig is not None and not sig.get("invalidated")

            if has_active_strict and sig is not None:
                sub_df, sub_res = _fetch_adjusted_bars(sym, interval=sub_interval)
                sub_valid = (
                    sub_df
                    if (
                        sub_df is not None
                        and len(sub_df) >= MIN_BARS_REQUIRED
                        and sub_res is not None
                        and sub_res.status == DataStatus.FRESH
                    )
                    else None
                )
                apply_hourly_trust_level(sig, df, sub_valid, itv)
                lvl = sig.get("saatlik_seviye") or {}
                p1 = sig.get("tepe1") or {}
                p2 = sig.get("tepe2") or {}
                peak_candle = sig.get("peak_candle") or {}
                s_state = _compute_short_action_state(last_close, float(p2.get("price", last_close)), lvl, itv)
                fractal_ctx = _evaluate_4h_fractal_context(sym, itv, s_state["target_1r"], s_state["target_tp1"])
                out["strict"] = {
                    "symbol": sym,
                    "interval": itv,
                    "is_viop": is_viop,
                    "last_close": last_close,
                    "tepe1_price": round(float(p1.get("price", 0.0)), 2),
                    "tepe1_rsi": round(float(p1["rsi"]), 1) if p1.get("rsi") is not None else None,
                    "tepe1_date": p1.get("date"),
                    "tepe2_price": round(float(p2.get("price", 0.0)), 2),
                    "tepe2_rsi": round(float(p2["rsi"]), 1) if p2.get("rsi") is not None else None,
                    "rsi_at_peak": p2.get("rsi_at_peak"),
                    "rsi_source": p2.get("rsi_source"),
                    "tepe2_date": p2.get("date"),
                    "confirm_date": sig.get("confirm_date"),
                    "candle_pattern": peak_candle.get("pattern", "NONE"),
                    "candle_label": peak_candle.get("label_tr", "Yok"),
                    "is_hanging_man": bool(peak_candle.get("is_hanging_man")),
                    "is_shooting_star": bool(peak_candle.get("is_shooting_star")),
                    "has_any_top_candle": bool(peak_candle.get("has_any_top_candle")),
                    "gkd_price": s_state["gkd_price"],
                    "status_text": s_state["status_text"],
                    "triggered": s_state["triggered"],
                    "stop_loss": s_state["stop_loss"],
                    "target_1r": s_state["target_1r"],
                    "target_tp1": s_state["target_tp1"],
                    "rr_ratio": s_state["rr_ratio"],
                    "pullback_pct": sig.get("pullback_pct"),
                    "gap_bars": sig.get("gap_bars"),
                    "bars_since_confirm": sig.get("bars_since_confirm"),
                    **fractal_ctx,
                }
                return out

            if sig is not None and sig.get("invalidated"):
                p1 = sig.get("tepe1") or {}
                p2 = sig.get("tepe2") or {}
                peak_candle = sig.get("peak_candle") or {}
                out["invalidated"] = {
                    "symbol": sym,
                    "interval": itv,
                    "is_viop": is_viop,
                    "last_close": last_close,
                    "tepe1_price": round(float(p1.get("price", 0.0)), 2),
                    "tepe1_rsi": round(float(p1["rsi"]), 1) if p1.get("rsi") is not None else None,
                    "tepe2_price": round(float(p2.get("price", 0.0)), 2),
                    "tepe2_rsi": round(float(p2["rsi"]), 1) if p2.get("rsi") is not None else None,
                    "candle_label": peak_candle.get("label_tr", "Yok"),
                    "invalidation_reason": sig.get("invalidation_reason") or "HIGHER_HIGH_BROKEN",
                    "confirm_date": sig.get("confirm_date"),
                }

            rsi_arr = wilder_rsi(df["close"].to_numpy(dtype=float), 14)
            cand = detect_early_highest_nu70_candidate(df, rsi_arr, interval=itv)
            if cand is not None:
                out["early"] = _format_early_candidate(sym, itv, cand)
            return out
        except Exception as exc:
            return {
                "error": {
                    "symbol": sym,
                    "interval": itv,
                    "stage": "nu70_peak_lab",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            }

    strict_signals: List[Dict[str, Any]] = []
    early_candidates: List[Dict[str, Any]] = []
    invalidated_signals: List[Dict[str, Any]] = []
    oversold_dip_watch: List[Dict[str, Any]] = []
    scan_errors: List[Dict[str, str]] = []

    if target_symbols:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for item in pool.map(_analyze_one, target_symbols):
                if "strict" in item:
                    strict_signals.append(item["strict"])
                if "early" in item:
                    early_candidates.append(item["early"])
                if "invalidated" in item:
                    invalidated_signals.append(item["invalidated"])
                if "oversold_watch" in item:
                    oversold_dip_watch.append(item["oversold_watch"])
                if "error" in item:
                    scan_errors.append(item["error"])

    strict_signals.sort(
        key=lambda x: (
            bool(x.get("is_hanging_man")),
            bool(x.get("is_shooting_star")),
            bool(x.get("triggered")),
            -int(x.get("bars_since_confirm") or 0),
        ),
        reverse=True,
    )
    early_candidates.sort(
        key=lambda x: (
            bool(x.get("is_hanging_man")),
            bool(x.get("is_shooting_star")),
            -int(x.get("gap_bars") or 99),
        ),
        reverse=True,
    )
    invalidated_signals.sort(key=lambda x: x["symbol"])
    oversold_dip_watch.sort(
        key=lambda x: (not bool(x.get("has_reaction")), float(x.get("oversold_rsi") or 99.0))
    )

    hanging_man_count = sum(1 for x in strict_signals + early_candidates if x.get("is_hanging_man"))
    shooting_star_count = sum(1 for x in strict_signals + early_candidates if x.get("is_shooting_star"))

    return {
        "status": "success",
        "mode": "nu70lab",
        "interval": itv,
        "total_scanned": len(target_symbols),
        "strict_count": len(strict_signals),
        "candle_confirmed_count": hanging_man_count + shooting_star_count,
        "hanging_man_count": hanging_man_count,
        "shooting_star_count": shooting_star_count,
        "triggered_count": sum(1 for x in strict_signals if x.get("triggered")),
        "early_count": len(early_candidates),
        "invalidated_count": len(invalidated_signals),
        "oversold_watch_count": len(oversold_dip_watch),
        "scan_error_count": len(scan_errors),
        "scan_errors": scan_errors,
        "strict_signals": strict_signals,
        "early_candidates": early_candidates,
        "invalidated_signals": invalidated_signals,
        "oversold_dip_watch": oversold_dip_watch,
    }
