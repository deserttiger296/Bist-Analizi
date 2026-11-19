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
    MIN_BARS_REQUIRED,
    SCAN_LIFETIME_BARS,
    SCAN_MIN_GAP_BARS,
    _fetch_adjusted_bars,
    apply_hourly_trust_level,
    detect_rsi_nu70,
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
    if alt == "15dk" or interval == "1h":
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


def _evaluate_4h_fractal_context(
    sym: str,
    itv: str,
    target_1r: float,
    target_2r: float,
) -> Dict[str, Any]:
    """
    Semih Hoca 1S / 4S Fraktal Kuralı:
    1S'de NU70 varken 4S'de henüz NU70 yoksa ara salınım (1R) sonrası
    4S NU70'i kurmak için en az 1 zirve daha beklenir; asıl sert satış o zirvededir.
    """
    if itv != "1h":
        return {
            "has_4h_nu70": itv == "4h",
            "rsi_4h": None,
            "fractal_phase_code": "ANA_ZIRVE_SERT_SATIS",
            "fractal_phase_badge": f"🔥 {itv.upper()} Ana Zirve NU70: Sert Satış Fazı",
            "recommended_tp_label": "2R Ana Düşüş Hedefi",
            "recommended_tp_price": target_2r,
            "fractal_profit_plan": (
                f"{itv.upper()} ana periyotta NU70 zirvesi oluştu; 1 Saatlik GKD kırılımıyla birlikte "
                f"2R Ana Hedef ({target_2r:.2f} ₺) odaklı sert satış fazıdır."
            ),
        }

    has_4h_nu70 = False
    rsi_4h: Optional[float] = None
    try:
        df_4h, res_4h = _fetch_adjusted_bars(sym, interval="4h")
        if df_4h is not None and len(df_4h) >= MIN_BARS_REQUIRED and (res_4h is None or res_4h.status == DataStatus.FRESH):
            rsi_arr_4h = wilder_rsi(df_4h["close"].to_numpy(dtype=np.float64), 14)
            finite_4h = rsi_arr_4h[np.isfinite(rsi_arr_4h)]
            if len(finite_4h) > 0:
                rsi_4h = round(float(finite_4h[-1]), 1)
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
            "fractal_phase_code": "SALINIM_SONRA_YENI_ZIRVE",
            "fractal_phase_badge": "⚠️ 4S NU Yok: Önce Salınım → Sonra 1 Zirve Daha",
            "recommended_tp_label": "1R Ara Salınım Hedefi (Kısa Kâr Al)",
            "recommended_tp_price": target_1r,
            "fractal_profit_plan": (
                f"1S NU70 yakalandı ancak 4 Saatlikte henüz NU70 YOK{rsi_txt}. Semih Hoca Kuralı: "
                f"Kağıt kesin salacak (ara düzeltme) fakat saldıktan sonra 4S NU70'i kurmak için EN AZ 1 ZİRVE DAHA yapacak. "
                f"Kâr Hesabı: Bu ilk salınımda hedef abartılmaz, 1R Ara Salınım Hedefi ({target_1r:.2f} ₺) bölgesinde kâr alınır; "
                f"asıl sert satış bir sonraki yeni zirvede 4S NU70 doğduğunda yapılır."
            ),
        }

    return {
        "has_4h_nu70": True,
        "rsi_4h": rsi_4h,
        "fractal_phase_code": "CIFT_KILIT_SERT_SATIS",
        "fractal_phase_badge": "🔥 1S + 4S NU70 Onaylı: Sert Satış Fazı",
        "recommended_tp_label": "2R Ana Düşüş Hedefi (Sert Satış)",
        "recommended_tp_price": target_2r,
        "fractal_profit_plan": (
            f"Hem 1 Saatlik hem 4 Saatlik grafikte NU70 tamamlanmış durumda. "
            f"'Bir zirve daha' aşaması geçildiği için net ve sert satış fazıdır; "
            f"2R Ana Hedef ({target_2r:.2f} ₺) takip edilir."
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
    itv = interval if interval in ("1h", "4h", "1d") else "1h"
    sub_interval = "15m" if itv == "1h" else "1h"

    target_symbols = [s.upper().strip() for s in (symbols or BIST100_SYMBOLS) if s and s.strip()]
    if viop_only:
        target_symbols = [s for s in target_symbols if s in VIOP_SYMBOLS]

    if len(target_symbols) > 1:
        try:
            provider = get_default_provider()
            if hasattr(provider, "prefetch_ohlcv_batch"):
                for prefetch_itv in tuple(dict.fromkeys((itv, sub_interval, "4h"))):
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
        "scan_error_count": len(scan_errors),
        "scan_errors": scan_errors,
        "strict_signals": strict_signals,
        "early_candidates": early_candidates,
        "invalidated_signals": invalidated_signals,
    }
