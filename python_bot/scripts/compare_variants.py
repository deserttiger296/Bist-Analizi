"""
Variant comparison on identical data and execution assumptions:
  RSI only | RSI + MOSTRSI | RSI + RF | RSI + LSTM   (+ buy-and-hold benchmarks)

- Entries are allowed only in the FINAL partition: dates after both models'
  selection_end, i.e. data neither model was fit or evaluated on.
- Every filter is point-in-time: RF/LSTM read causal features up to the signal
  bar; MOSTRSI runs on the same price prefix the RSI detector saw.
- The news filter is NOT tested: there is no point-in-time news history.

Run from the repo root (after training RF and LSTM on the same universe):
  .venv/Scripts/python.exe -m python_bot.scripts.compare_variants
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from python_bot.engine.backtest.backtest_engine import BacktestConfig, run_portfolio_backtest
from python_bot.engine.brain.deep_model import load_lstm, lstm_probability_from_features
from python_bot.engine.brain.local_classifier import (
    MODEL_PATH, validate_artifact, build_features, _fetch_history, _fetch_benchmark_close,
)
from python_bot.engine.signals.most_rsi import detect_most_rsi
from python_bot.engine.signals.rsi_pu30 import _fetch_adjusted_bars

THRESHOLD = 0.60  # same default threshold the live engine uses
WARMUP_BARS = 200
OUT = Path(__file__).resolve().parents[2] / "docs" / "VARIANT_COMPARISON.md"


def _day(ts) -> pd.Timestamp:
    return pd.Timestamp(pd.Timestamp(ts).date())


def main():
    rf = joblib.load(MODEL_PATH)
    validate_artifact(rf)
    lstm = load_lstm()
    if lstm is None:
        sys.exit("LSTM not trained -- run train_deep_model first")
    lstm_model, lstm_meta = lstm
    universe = lstm_meta["symbols"]
    final_start = max(_day(rf["selection_end"]), _day(lstm_meta["selection_end"])) + pd.Timedelta(days=1)
    print(f"Final (out-of-sample) window starts {final_start.date()} | {len(universe)} symbols")

    bench = _fetch_benchmark_close(period="3y")
    frames, features, errors = {}, {}, {}
    for sym in universe:
        try:
            bars, res = _fetch_adjusted_bars(sym, interval="1d", period="3y")
            if bars is None:
                raise ValueError(res.error_message if res else "no data")
            days = bars["date"].map(_day)
            start = max(0, int(np.searchsorted(days.to_numpy(), np.datetime64(final_start))) - WARMUP_BARS)
            frames[sym] = bars.iloc[start:].reset_index(drop=True)
            feat = build_features(_fetch_history(sym, period="3y"), bench)
            feat.index = feat.index.map(_day)
            features[sym] = feat
        except Exception as e:
            errors[sym] = str(e)

    def in_final(prefix):
        return _day(prefix["date"].iloc[-1]) >= final_start

    def feature_prefix(sym, prefix):
        feat = features[sym]
        day = _day(prefix["date"].iloc[-1])
        cut = feat.loc[:day]
        return cut if len(cut) and cut.index[-1] == day else None

    def rf_ok(sym, prefix, sig):
        if not in_final(prefix):
            return False
        cut = feature_prefix(sym, prefix)
        if cut is None or cut[rf["feature_columns"]].iloc[-1].isna().any():
            return False
        proba = rf["model"].predict_proba(cut[rf["feature_columns"]].iloc[[-1]].to_numpy(dtype=np.float64))[0]
        return float(proba[list(rf["model"].classes_).index("UP")]) >= THRESHOLD

    def lstm_ok(sym, prefix, sig):
        if not in_final(prefix):
            return False
        cut = feature_prefix(sym, prefix)
        try:
            return cut is not None and lstm_probability_from_features(cut, lstm_meta, lstm_model) >= THRESHOLD
        except ValueError:
            return False

    variants = {
        "Yalnız RSI": lambda s, p, sig: in_final(p),
        "RSI + MOSTRSI": lambda s, p, sig: in_final(p) and detect_most_rsi(p, interval="1d") is not None,
        "RSI + RF": rf_ok,
        "RSI + LSTM": lstm_ok,
    }
    cfg = BacktestConfig(interval="1d")
    rows = []
    for name, flt in variants.items():
        s = run_portfolio_backtest(frames, config=cfg, signal_filter=flt)
        rows.append({
            "variant": name, "trades": s.total_trades, "net_return_pct": s.total_net_return_pct,
            "expectancy_pct": s.avg_trade_net_return_pct, "avg_win_pct": s.average_win_pct,
            "avg_loss_pct": s.average_loss_pct, "profit_factor": s.profit_factor,
            "max_drawdown_pct": s.max_drawdown_pct, "exposure_pct": s.exposure_pct,
            "win_rate_pct": s.win_rate_pct,
        })
        print(rows[-1])

    # Benchmarks over the same final window
    bh = []
    for sym, df in frames.items():
        w = df[df["date"].map(_day) >= final_start]
        if len(w) > 1:
            bh.append(float(w["close"].iloc[-1] / w["open"].iloc[0] - 1) * 100)
    b = bench.copy()
    b.index = b.index.map(_day)
    b = b[b.index >= final_start]
    benchmarks = {
        "Eşit ağırlık al-tut (evren)": float(np.mean(bh)) if bh else None,
        "XU100 al-tut": float((b.iloc[-1] / b.iloc[0] - 1) * 100) if len(b) > 1 else None,
    }
    _write_report(rows, benchmarks, final_start, universe, errors, cfg)


def _fmt(v, digits=2):
    return "—" if v is None else (f"{v:.{digits}f}" if isinstance(v, float) else str(v))


def _write_report(rows, benchmarks, final_start, universe, errors, cfg):
    lines = [
        "# Varyant Karşılaştırması (out-of-sample)",
        "",
        f"Üretildi: {datetime.now(timezone.utc).isoformat(timespec='seconds')} · "
        f"`python -m python_bot.scripts.compare_variants`",
        "",
        f"- Strateji: RSI PU30/NU70 `pu30-strict-v3` / `nu70-strict-v3` (1. dip RSI < 30, 2. dip RSI > 30; NU ayna kural).",
        f"- Evren: {len(universe)} hisse (veri hatası: {', '.join(errors) or 'yok'}), günlük mumlar.",
        f"- Girişler yalnızca **{final_start.date()}** sonrasında: RF ve LSTM'in ne eğitildiği ne değerlendirildiği dönem.",
        f"- Ortak işlem varsayımları: spot, yalnız long, NU70 = çıkış uyarısı; stop %{cfg.stop_loss_pct}, hedef %{cfg.target_pct}, "
        f"en fazla {cfg.holding_bars_max} bar; komisyon %{cfg.commission_pct} + kayma %{cfg.slippage_pct} (her yön); "
        f"işlem başına özsermaye riski %{cfg.risk_per_trade_pct}, en fazla {cfg.max_positions} pozisyon; giriş knowable_at sonrası ilk açılış.",
        f"- Model eşiği: P(UP) ≥ {THRESHOLD} (canlı motorla aynı). Haber filtresi test edilmedi: geçmişe dönük zaman damgalı haber verisi yok.",
        "",
        "| Varyant | İşlem | Net getiri % | İşlem başı beklenti % | Ort. kazanç % | Ort. kayıp % | Profit factor | Maks. düşüş % | Piyasada % | Kazanma % |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| {r['variant']} | {r['trades']} | {_fmt(r['net_return_pct'])} | {_fmt(r['expectancy_pct'])} | "
                     f"{_fmt(r['avg_win_pct'])} | {_fmt(r['avg_loss_pct'])} | {_fmt(r['profit_factor'])} | "
                     f"{_fmt(r['max_drawdown_pct'])} | {_fmt(r['exposure_pct'], 1)} | {_fmt(r['win_rate_pct'], 1)} |")
    lines += ["", "| Karşılaştırma | Getiri % |", "|---|---|"]
    lines += [f"| {k} | {_fmt(v)} |" for k, v in benchmarks.items()]
    lines += [
        "",
        "**Yorum sınırları:** Tek bir son dönem, az sayıda işlem; hisseler arası korelasyon ve örtüşen işlemler nedeniyle "
        "işlemler bağımsız değildir. Bu tablo istatistiksel anlamlılık iddia etmez; yalnızca aynı koşullarda "
        "filtrelerin RSI tabanına bir şey ekleyip eklemediğinin ilk, dürüst ölçümüdür. Parametreler bu döneme göre ayarlanmadı.",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT.with_suffix(".json")).write_text(json.dumps({"rows": rows, "benchmarks": benchmarks,
                                                       "final_start": str(final_start.date())}, indent=2), encoding="utf-8")
    print(f"Rapor: {OUT}")


if __name__ == "__main__":
    main()
