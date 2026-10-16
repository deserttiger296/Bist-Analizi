# -*- coding: utf-8 -*-
"""
Full BIST100 Universe Backtest for Strict RSI PU30/NU70 (`pu30-strict-v3`):
- 4h Yalnız PU30 (Strict 30/70)
- 4h PU30 + 1h Çapraz Teyit (DOUBLE_BULL)
- 4h PU30 + 1h MOSTRSI Bull
- 4h PU30 + Saatlik Güven Seviyesi Kırılımı (hourly_trust_level break)
- 1h Yalnız PU30 (SCALP_1H)
- 1d Yalnız PU30 (Günlük Strict 30/70, aynı ~730g pencere)

Look-ahead bias protection:
- Every 4h signal is evaluated only at `bar_close_time(row.date, "4h")`.
- Any 1h cross-check (`DOUBLE_BULL`, `MOSTRSI`, `hourly_trust_level`) slices the 1h
  DataFrame to bars whose close time `date + 1h <= close_4h`.
- Entry fills on the NEXT bar open after `knowable_at` with commission + slippage.

Run from repo root:
  .venv\\Scripts\\python.exe -m python_bot.scripts.backtest_pu30_bist100
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import numpy as np
import pandas as pd

from python_bot.engine.backtest.backtest_engine import BacktestConfig, run_portfolio_backtest
from python_bot.engine.data.provider import (
    ISTANBUL_TZ,
    bar_close_time,
    get_default_provider,
)
from python_bot.engine.signals.most_rsi import detect_most_rsi
from python_bot.engine.signals.rsi_pu30 import (
    DEFAULT_PU30_CONFIG,
    _fetch_adjusted_bars,
    detect_rsi_pu30,
    hourly_trust_level,
)
from python_bot.engine.universe import BIST100_SYMBOLS

OUT_MD = Path(__file__).resolve().parents[2] / "docs" / "BIST100_PU30_BACKTEST.md"
OUT_JSON = OUT_MD.with_suffix(".json")


def _fmt(v, digits=2):
    return "—" if v is None else (f"{v:.{digits}f}" if isinstance(v, (float, np.floating)) else str(v))


def _row_dict(name: str, interval: str, s) -> dict:
    return {
        "variant": name,
        "interval": interval,
        "trades": s.total_trades,
        "winning_trades": s.winning_trades,
        "losing_trades": s.losing_trades,
        "win_rate_pct": s.win_rate_pct,
        "net_return_pct": s.total_net_return_pct,
        "expectancy_pct": s.avg_trade_net_return_pct,
        "avg_win_pct": s.average_win_pct,
        "avg_loss_pct": s.average_loss_pct,
        "profit_factor": s.profit_factor,
        "max_drawdown_pct": s.max_drawdown_pct,
        "exposure_pct": s.exposure_pct,
    }


def main():
    t0 = time.time()
    provider = get_default_provider()
    print(f"[Backtest] Prefetching 1h (730d) and 1d (2y) bars for {len(BIST100_SYMBOLS)} BIST100 symbols...")
    provider.prefetch_ohlcv_batch(BIST100_SYMBOLS, interval="4h", period="730d", chunk_size=25)
    provider.prefetch_ohlcv_batch(BIST100_SYMBOLS, interval="1d", period="2y", chunk_size=25)

    frames_4h = {}
    frames_1h = {}
    frames_1d = {}
    h1_close_times = {}
    errors = {}

    for sym in BIST100_SYMBOLS:
        df4, res4 = _fetch_adjusted_bars(sym, interval="4h", period="730d")
        df1, res1 = _fetch_adjusted_bars(sym, interval="1h", period="730d")
        dfd, resd = _fetch_adjusted_bars(sym, interval="1d", period="2y")
        if df4 is None or df1 is None or len(df4) < 50 or len(df1) < 100:
            errors[sym] = (res4.error_message if res4 else "insufficient 4h/1h data")
            continue
        frames_4h[sym] = df4.reset_index(drop=True)
        frames_1h[sym] = df1.reset_index(drop=True)
        dt1 = pd.DatetimeIndex(frames_1h[sym]["date"])
        dt1 = dt1.tz_localize(ISTANBUL_TZ) if dt1.tz is None else dt1.tz_convert(ISTANBUL_TZ)
        h1_close_times[sym] = dt1 + pd.Timedelta(hours=1)
        if dfd is not None and len(dfd) >= 50:
            frames_1d[sym] = dfd.reset_index(drop=True)

    print(
        f"[Backtest] Loaded {len(frames_4h)}/{len(BIST100_SYMBOLS)} symbols in {time.time() - t0:.1f}s "
        f"(errors: {len(errors)})"
    )

    def _h1_prefix_at_4h_bar(sym: str, prefix_4h: pd.DataFrame) -> pd.DataFrame:
        close_4h = bar_close_time(prefix_4h["date"].iloc[-1], "4h")
        closes_1h = h1_close_times[sym]
        cut_idx = int(np.searchsorted(closes_1h.asi8, close_4h.value, side="right"))
        return frames_1h[sym].iloc[:cut_idx]

    def flt_double_bull(sym: str, prefix_4h: pd.DataFrame, sig: dict) -> bool:
        h1_pre = _h1_prefix_at_4h_bar(sym, prefix_4h)
        if len(h1_pre) < 35:
            return False
        return detect_rsi_pu30(h1_pre, cfg=DEFAULT_PU30_CONFIG, interval="1h") is not None

    def flt_most_rsi_1h(sym: str, prefix_4h: pd.DataFrame, sig: dict) -> bool:
        h1_pre = _h1_prefix_at_4h_bar(sym, prefix_4h)
        if len(h1_pre) < 35:
            return False
        return detect_most_rsi(h1_pre, interval="1h") is not None

    # Track already-triggered (sym, confirm_date) pairs so a single PU30 signal doesn't re-trigger
    triggered_trust_signals = set()

    def trig_hourly_trust_break(sym: str, prefix_4h: pd.DataFrame, sig: dict) -> bool:
        sig_id = (sym, sig.get("confirm_date"))
        if sig_id in triggered_trust_signals:
            return False
        h1_pre = _h1_prefix_at_4h_bar(sym, prefix_4h)
        if len(h1_pre) < 35:
            return False
        p2_open = prefix_4h["date"].iloc[sig["dip2"]["index"]]
        lvl = hourly_trust_level(h1_pre, p2_open, "4h", bull=True)
        if lvl.get("kirildi"):
            triggered_trust_signals.add(sig_id)
            return True
        return False

    cfg_4h = BacktestConfig(interval="4h")
    cfg_1h = BacktestConfig(interval="1h")
    cfg_1d = BacktestConfig(interval="1d")

    rows = []

    print("[Backtest] Running 1/6: 4h Yalnız PU30 (pu30-strict-v3)...")
    s_4h_base = run_portfolio_backtest(frames_4h, config=cfg_4h)
    rows.append(_row_dict("4s Yalnız PU30 (Katı 30/70)", "4h", s_4h_base))
    print(rows[-1])

    print("[Backtest] Running 2/6: 4h PU30 + Saatlik Güven Seviyesi Kırılımı...")
    s_4h_trust = run_portfolio_backtest(frames_4h, config=cfg_4h, entry_trigger=trig_hourly_trust_break)
    rows.append(_row_dict("4s PU30 + Saatlik Güven Tazeleyen Tepe Kırılımı", "4h", s_4h_trust))
    print(rows[-1])

    print("[Backtest] Running 3/6: 4h PU30 + 1h PU30 Çapraz Teyit (DOUBLE_BULL)...")
    s_4h_double = run_portfolio_backtest(frames_4h, config=cfg_4h, signal_filter=flt_double_bull)
    rows.append(_row_dict("4s PU30 + 1s PU30 Çapraz Teyit (DOUBLE_BULL)", "4h", s_4h_double))
    print(rows[-1])

    print("[Backtest] Running 4/6: 4h PU30 + 1h MOSTRSI Bull...")
    s_4h_most = run_portfolio_backtest(frames_4h, config=cfg_4h, signal_filter=flt_most_rsi_1h)
    rows.append(_row_dict("4s PU30 + 1s MOSTRSI Bull", "4h", s_4h_most))
    print(rows[-1])

    print("[Backtest] Running 5/6: 1h Yalnız PU30 (SCALP_1H)...")
    s_1h_base = run_portfolio_backtest(frames_1h, config=cfg_1h)
    rows.append(_row_dict("1s Yalnız PU30 (SCALP_1H)", "1h", s_1h_base))
    print(rows[-1])

    print("[Backtest] Running 6/6: 1d Yalnız PU30 (2y)...")
    s_1d_base = run_portfolio_backtest(frames_1d, config=cfg_1d)
    rows.append(_row_dict("1g Yalnız PU30 (Günlük Katı 30/70)", "1d", s_1d_base))
    print(rows[-1])

    # Equal-weight buy-and-hold over the 4h window (~730d)
    bh_returns = []
    start_dates = []
    end_dates = []
    for sym, df in frames_4h.items():
        if len(df) > 1:
            bh_returns.append(float(df["close"].iloc[-1] / df["open"].iloc[0] - 1.0) * 100.0)
            start_dates.append(pd.Timestamp(df["date"].iloc[0]))
            end_dates.append(pd.Timestamp(df["date"].iloc[-1]))

    win_start = str(min(start_dates).date()) if start_dates else "—"
    win_end = str(max(end_dates).date()) if end_dates else "—"
    benchmarks = {
        f"BIST100 Eşit Ağırlık Al-Tut ({win_start} → {win_end})": float(np.mean(bh_returns)) if bh_returns else None,
    }

    lines = [
        "# BIST100 Tam Evren RSI PU30/NU70 (`pu30-strict-v3`) Backtest Raporu",
        "",
        f"Üretildi: {datetime.now(timezone.utc).isoformat(timespec='seconds')} · "
        f"`python -m python_bot.scripts.backtest_pu30_bist100`",
        "",
        "## Metodoloji ve Look-Ahead Koruması",
        f"- **Evren:** BIST100 ({len(frames_4h)}/{len(BIST100_SYMBOLS)} hisse; veri hatası olanlar: {', '.join(errors) or 'yok'}).",
        f"- **Veri Penceresi:** `{win_start}` → `{win_end}` (yfinance 730 günlük 1s/4s intraday sınırı ve 2 yıllık 1g geçmiş).",
        "- **Katı Semih Hoca Kuralı (`pu30-strict-v3` / `nu70-strict-v3`):** PU30 için 1. dip RSI(14) **< 30**, 2. dip RSI(14) **> 30**, 2. dip fiyatı < 1. dip fiyatı, ara tepki ≥ %3, dipler arası 8–60 bar, pivot (sol 5, sağ 2).",
        "- **Saatlik Güven Seviyesi (`hourly_trust_level`):** 4s PU30 teyidinden sonra 1s grafikte 2. dibin altına inmeyen ilk kesinleşmiş saatlik dip (`yapi_pivotu`) oluşur; iki dip arasındaki en yüksek saatlik fiyat (`güven tazeleyen tepe`) saatlik kapanışla aşıldığında (`kirildi=True`) bir sonraki bar açılışında giriş yapılır.",
        f"- **Ortak İşlem ve Sürtünme Varsayımları:** Başlangıç sermayesi {cfg_4h.initial_capital:,.0f} TL, spot yalnız-long, NU70 = çıkış uyarısı; zarar kes %{cfg_4h.stop_loss_pct}, kâr al %{cfg_4h.target_pct}, azami tutma {cfg_4h.holding_bars_max} bar; komisyon %{cfg_4h.commission_pct} + kayma %{cfg_4h.slippage_pct} (her yön ayrı); işlem başı özsermaye riski %{cfg_4h.risk_per_trade_pct}, en fazla {cfg_4h.max_positions} eşzamanlı pozisyon. Aynı mumda hem stop hem hedef görülürse muhafazakâr olarak **STOP** önceliklidir.",
        "",
        "## Sonuç Tablosu",
        "",
        "| Varyant | Periyot | İşlem | Kazanan | Kaybeden | Kazanma % | Net Getiri % | İşlem Başı Beklenti % | Ort. Kazanç % | Ort. Kayıp % | Profit Factor | Maks. Düşüş % | Piyasada % |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in rows:
        lines.append(
            f"| {r['variant']} | `{r['interval']}` | {r['trades']} | {r['winning_trades']} | {r['losing_trades']} | "
            f"{_fmt(r['win_rate_pct'], 1)} | {_fmt(r['net_return_pct'])} | {_fmt(r['expectancy_pct'])} | "
            f"{_fmt(r['avg_win_pct'])} | {_fmt(r['avg_loss_pct'])} | {_fmt(r['profit_factor'])} | "
            f"{_fmt(r['max_drawdown_pct'])} | {_fmt(r['exposure_pct'], 1)} |"
        )

    lines += [
        "",
        "| Karşılaştırma (Aynı Pencere) | Getiri % |",
        "|---|---:|",
    ]
    for k, v in benchmarks.items():
        lines.append(f"| {k} | {_fmt(v)} |")

    lines += [
        "",
        "## Dürüst Değerlendirme ve Sınırlar",
        "- **Katı 30/70 kuralının seçiciliği:** 1. dip RSI < 30 ve 2. dip RSI > 30 koşulu birleştiğinde sinyaller oldukça nadirdir (düşük piyasada kalma oranı / `exposure_pct`).",
        "- **Saatlik güven seviyesi ve çoklu zaman dilimi filtreleri:** Ek teyit koşulları (`hourly_trust_level` kırılımı, `1s PU30 DOUBLE_BULL`, `1s MOSTRSI`) işlem sayısını daha da azaltır; küçük örneklem boyutlarında tekil işlemler istatistikleri domine edebilir.",
        "- **Sağlayıcı kısıtları:** yfinance yalnızca hâlen işlem gören hisseleri döndürür (survivorship bias); resmi tatil/yarım gün takvimi ve intrabar tick sırası sertifikalı değildir.",
    ]

    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    OUT_JSON.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "window_start": win_start,
                "window_end": win_end,
                "symbols_tested": len(frames_4h),
                "symbols_attempted": len(BIST100_SYMBOLS),
                "rows": rows,
                "benchmarks": benchmarks,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"[Backtest] Wrote {OUT_MD} and {OUT_JSON} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
