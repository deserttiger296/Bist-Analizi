# -*- coding: utf-8 -*-
"""
Long / Short Karar Matrisi & VİOP Strateji Motoru (Semih Hoca Metodolojisi)
==========================================================================
PU30 (Dip Dönüşü & GVT Teyidi) -> LONG (Spot Alım / VİOP Uzun)
NU70 (Zirve Yorulması & GKD Kırılımı) -> SHORT (Spot Çıkış / VİOP Açığa Satış)
"""
from __future__ import annotations

import dataclasses
from typing import Any, Dict, List, Optional, Set

from python_bot.engine.data.provider import DataStatus, get_default_provider
from python_bot.engine.signals.rsi_pu30 import (
    MIN_BARS_REQUIRED,
    SCAN_LIFETIME_BARS,
    detect_rsi_nu70,
    detect_rsi_pu30,
    scan_universe_rsi_pu30,
)
from python_bot.engine.universe import BIST100_SYMBOLS

VIOP_SYMBOLS: Set[str] = {
    "AKBNK", "ARCLK", "ASELS", "ASTOR", "BIMAS", "CCOLA", "DOHOL", "EKGYO", "ENKAI", "EREGL",
    "FROTO", "GARAN", "GUBRF", "HALKB", "HEKTS", "ISCTR", "KCHOL", "KOZAA", "KOZAL", "KRDMD",
    "MGROS", "OYAKC", "PETKM", "PGSUS", "SAHOL", "SASA", "SISE", "SOKM", "TAVHL", "TCELL",
    "THYAO", "TOASO", "TSKB", "TTKOM", "TTRAK", "TUPRS", "ULKER", "VAKBN", "VESTL", "YKBNK"
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

    long_candidates = []
    short_candidates = []

    for itv in intervals:
        scan_res = scan_universe_rsi_pu30(target_symbols, max_workers=max_workers, interval=itv, signal_type="all")
        for sig in scan_res.get("signals", []):
            sym = sig.get("symbol", "").upper()
            sig_type = sig.get("type")
            confluence = sig.get("confluence", "")
            last_close = float(sig.get("last_close", 0.0))
            lvl = sig.get("saatlik_seviye") or {}
            lvl_price = lvl.get("price")
            lvl_durum = lvl.get("durum")
            is_viop = sym in VIOP_SYMBOLS

            if sig_type == "PU30":
                p1 = sig.get("dip1", {})
                p2 = sig.get("dip2", {})
                gvt_price = lvl_price if lvl_price is not None else float(p2.get("price", last_close))
                triggered = (lvl_durum == "kirildi")
                
                # Risk & Hedef Hesabı
                stop_loss = round(float(p2.get("price", last_close)) * 0.975, 2)
                risk = max(last_close - stop_loss, last_close * 0.02)
                # Minimum 1.5x - 2.5x R:R hedefi
                target_tp1 = round(last_close + (risk * 2.0), 2)
                target_tp2 = round(last_close + (risk * 3.5), 2)
                rr_ratio = round((target_tp1 - last_close) / max(risk, 0.01), 2)

                action = "LONG" if triggered else "LONG_PUSD"
                status_text = "GVT Aşıldı (Alım Onaylı)" if triggered else "GVT Bekleniyor (Pusuda)"

                long_candidates.append({
                    "symbol": sym,
                    "interval": itv,
                    "type": "PU30",
                    "action": action,
                    "status_text": status_text,
                    "confluence": confluence,
                    "last_close": last_close,
                    "entry_level": gvt_price,
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
                p1 = sig.get("tepe1", {})
                p2 = sig.get("tepe2", {})
                gkd_price = lvl_price if lvl_price is not None else float(p2.get("price", last_close))
                triggered = (lvl_durum == "kirildi")

                # Risk & Geri Çekilme Hedefi
                stop_loss = round(float(p2.get("price", last_close)) * 1.025, 2)
                risk = max(stop_loss - last_close, last_close * 0.02)
                target_tp1 = round(max(0.01, last_close - (risk * 2.0)), 2)
                target_tp2 = round(max(0.01, last_close - (risk * 3.5)), 2)
                rr_ratio = round((last_close - target_tp1) / max(risk, 0.01), 2)

                action = "SHORT" if triggered else "SHORT_PUSD"
                status_text = "15dk GKD Kırıldı (Satış / Çıkış)" if triggered else "GKD Bekleniyor (Zirve Yorulması)"

                short_candidates.append({
                    "symbol": sym,
                    "interval": itv,
                    "type": "NU70",
                    "action": action,
                    "status_text": status_text,
                    "confluence": confluence,
                    "last_close": last_close,
                    "entry_level": gkd_price,
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

    # Sıralama: Tetiklenenler ve yüksek R:R oranı öne
    long_candidates.sort(key=lambda x: (x["triggered"], x["rr_ratio"]), reverse=True)
    short_candidates.sort(key=lambda x: (x["triggered"], x["rr_ratio"]), reverse=True)

    long_active = sum(1 for x in long_candidates if x["triggered"])
    short_active = sum(1 for x in short_candidates if x["triggered"])

    # Piyasa Eğilimi
    if short_active >= max(long_active * 2, 4):
        market_bias = "DEFANSİF / SHORT BASKILI (Kâr Realizasyonu Fazı)"
        market_bias_code = "BEARISH"
    elif long_active >= max(short_active * 2, 4):
        market_bias = "AGRESİF / LONG TRENDİ (Dip Dönüşü Fazı)"
        market_bias_code = "BULLISH"
    else:
        market_bias = "NÖTR / DENGELİ (Seçici İki Yönlü Piyasa)"
        market_bias_code = "NEUTRAL"

    # Pair Trading / Hedging Eşleşmesi (En iyi Long vs En zayıf Short)
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
                f"zirvede 15dk desteği kırılmış zayıf {best_short['symbol']} SAT (SHORT) eşleşmesi."
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
        "pair_trading": pair_trading,
        "longs": long_candidates,
        "shorts": short_candidates,
    }
