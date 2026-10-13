"""
Long-history test of the strict PU30 rule (RSI only) against random entry timing.

The out-of-sample variant comparison (compare_variants.py) has ~11 trades: too few
to say anything. RF/LSTM filters can only be judged on their unseen window, but
the RSI rule itself has no fitted parameters, so it can be measured on the whole
daily history of the BIST100 universe.

Question answered: in the same stocks, with the same exit rules and costs, do
PU30 entries beat entries at random days? TRY prices drift up with inflation,
so a plain positive return proves nothing; the random baseline absorbs that drift.

- Signals: detect_rsi_pu30 on the price prefix ending at each bar (causal), only
  evaluated where a pivot low was just confirmed (the only bars where a signal
  can confirm). NU70 confirms the same way and is used as an exit warning.
- Trades: same rules as run_portfolio_backtest (entry at the first open after
  knowable_at, stop first, gaps fill at the open, NU70 exit next open, holding
  expiry, costs both ways); one position per symbol at a time.
- Baseline: per symbol, as many random entry bars as that symbol had trades,
  drawn from the bars where the rule could have entered; repeated N times.

Run from the repo root:
  .venv/Scripts/python.exe -m python_bot.scripts.pu30_long_history
"""
import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from python_bot.engine.backtest.backtest_engine import BacktestConfig
from python_bot.engine.data.provider import ISTANBUL_TZ, bar_close_time
from python_bot.engine.signals.rsi_pu30 import (
    DEFAULT_NU70_CONFIG, DEFAULT_PU30_CONFIG, _fetch_adjusted_bars, detect_rsi_nu70, detect_rsi_pu30,
    find_confirmed_pivot_highs, find_confirmed_pivot_lows,
)
from python_bot.engine.universe import BIST100_SYMBOLS

MIN_INDEX = 30          # run_portfolio_backtest starts detecting at bar 30
FORWARD_DAYS = (10, 20)
OUT = Path(__file__).resolve().parents[2] / "docs" / "PU30_LONG_HISTORY.md"


def _ts(value) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    return ts.tz_localize(ISTANBUL_TZ) if ts.tzinfo is None else ts.tz_convert(ISTANBUL_TZ)


def confirm_indices(df, interval="1d", pu30_cfg=DEFAULT_PU30_CONFIG, nu70_cfg=DEFAULT_NU70_CONFIG):
    """Bars where a PU30 / NU70 signal confirms on the prefix ending at that bar.

    A signal confirms at d2 + pivot_right_bars and d2 must be a confirmed pivot, so
    only those bars need the (prefix) detector; the result equals calling it on
    every bar, as run_portfolio_backtest does.
    """
    n = len(df)
    lows = df["low"].to_numpy(dtype=np.float64)
    highs = df["high"].to_numpy(dtype=np.float64)
    pu, nu = [], set()
    for p in find_confirmed_pivot_lows(lows, pu30_cfg.pivot_left_bars, pu30_cfg.pivot_right_bars):
        i = p + pu30_cfg.pivot_right_bars
        if MIN_INDEX <= i < n - 1:
            sig = detect_rsi_pu30(df.iloc[:i + 1], cfg=pu30_cfg, interval=interval)
            if sig and sig["confirm_index"] == i:
                pu.append((i, sig))
    for p in find_confirmed_pivot_highs(highs, nu70_cfg.pivot_left_bars, nu70_cfg.pivot_right_bars):
        i = p + nu70_cfg.pivot_right_bars
        if MIN_INDEX <= i < n - 1:
            sig = detect_rsi_nu70(df.iloc[:i + 1], cfg=nu70_cfg, interval=interval)
            if sig and sig["confirm_index"] == i:
                nu.add(i)
    return pu, nu


def trade_outcomes(df, nu_confirms, cfg):
    """Exit bar, reason and net return % for a position entered at every bar's open.

    Mirrors the per-position branch of run_portfolio_backtest; the return does not
    depend on position size (quantity cancels out).
    """
    n = len(df)
    o, h, l, c = (df[k].to_numpy(dtype=np.float64) for k in ("open", "high", "low", "close"))
    fee, slip = cfg.commission_pct / 100, cfg.slippage_pct / 100
    exit_idx = np.full(n, -1, dtype=np.int64)
    net = np.full(n, np.nan, dtype=np.float64)
    reasons = np.empty(n, dtype=object)
    for e in range(n):
        entry = o[e] * (1 + slip)
        stop, target = entry * (1 - cfg.stop_loss_pct / 100), entry * (1 + cfg.target_pct / 100)
        exit_pending = False
        for j in range(e, n):
            raw = reason = None
            if o[j] <= stop:
                raw, reason = o[j], "STOP_GAP"
            elif l[j] <= stop:
                raw, reason = stop, "STOP"
            elif o[j] >= target:
                raw, reason = o[j], "TARGET_GAP"
            elif h[j] >= target:
                raw, reason = target, "TARGET"
            elif exit_pending:
                raw, reason = o[j], "NU70_EXIT"
            elif j - e >= cfg.holding_bars_max:
                raw, reason = c[j], "HOLDING_EXPIRY"
            if j == n - 1 and raw is None:
                raw, reason = c[j], "END_OF_DATA"
            if raw is not None:
                exit_idx[e], reasons[e] = j, reason
                net[e] = (raw * (1 - slip) * (1 - fee) / (entry * (1 + fee)) - 1) * 100
                break
            if j >= MIN_INDEX and j + 1 < n and j in nu_confirms:
                exit_pending = True
    return exit_idx, reasons, net


def entry_index(df, confirm_i, sig, interval):
    """First bar at or after knowable_at, as the engine's pending order fills."""
    available = _ts(sig.get("knowable_at", bar_close_time(df["date"].iloc[confirm_i], interval)))
    for j in range(confirm_i + 1, len(df)):
        if _ts(df["date"].iloc[j]) >= available:
            return j
    return None


def symbol_trades(df, cfg, interval="1d"):
    """Strict PU30 trades for one symbol, one position at a time (engine semantics)."""
    pu, nu = confirm_indices(df, interval=interval)
    exit_idx, reasons, net = trade_outcomes(df, nu, cfg)
    trades, busy_until = [], -1   # last bar on which a pending order or position blocks new signals
    for i, sig in pu:
        if i < busy_until:
            continue
        # The engine detects after exits on the same bar, so a signal on the exit bar is taken.
        e = entry_index(df, i, sig, interval)
        if e is None:
            continue
        trades.append({"confirm": i, "entry": e, "exit": int(exit_idx[e]), "reason": reasons[e],
                       "net": float(net[e])})
        busy_until = int(exit_idx[e])
    return trades, net, exit_idx


def forward_returns(df, cfg, days):
    """Net return % holding exactly `days` bars from each bar's open (to that bar's close)."""
    o = df["open"].to_numpy(dtype=np.float64)
    c = df["close"].to_numpy(dtype=np.float64)
    fee, slip = cfg.commission_pct / 100, cfg.slippage_pct / 100
    out = np.full(len(o), np.nan, dtype=np.float64)
    if len(o) >= days:
        out[:len(o) - days + 1] = (c[days - 1:] * (1 - slip) * (1 - fee)
                                   / (o[:len(o) - days + 1] * (1 + slip) * (1 + fee)) - 1) * 100
    return out


def analyse_symbol(args):
    symbol, period = args
    cfg = BacktestConfig(interval="1d")
    try:
        df, res = _fetch_adjusted_bars(symbol, interval="1d", period=period)
        if df is None or len(df) < 120:
            return symbol, {"error": (res.error_message if res else None) or "veri yok / çok kısa"}
        df = df[df["is_closed"]].reset_index(drop=True) if "is_closed" in df.columns else df.reset_index(drop=True)
        trades, net, _ = symbol_trades(df, cfg)
        fwd = {d: forward_returns(df, cfg, d) for d in FORWARD_DAYS}
        years = df["date"].map(lambda t: pd.Timestamp(t).year).to_numpy()
        return symbol, {
            "bars": len(df), "first": str(pd.Timestamp(df["date"].iloc[0]).date()),
            "last": str(pd.Timestamp(df["date"].iloc[-1]).date()),
            "trades": trades, "net": net, "fwd": fwd, "years": years,
            "dates": df["date"].map(lambda t: pd.Timestamp(t).normalize()).to_numpy(),
        }
    except Exception as exc:  # one bad symbol must not stop the study
        return symbol, {"error": str(exc)}


def _stats(x):
    x = np.asarray(x, dtype=np.float64)
    x = x[~np.isnan(x)]
    if not len(x):
        return {"n": 0}
    wins, losses = x[x > 0], x[x < 0]
    return {"n": int(len(x)), "mean": float(x.mean()), "median": float(np.median(x)),
            "win_rate": float(len(wins) / len(x) * 100),
            "profit_factor": float(wins.sum() / -losses.sum()) if len(losses) else None}


def random_baseline(results, key, draws, rng):
    """Mean return of the same per-symbol trade counts at random eligible entry bars."""
    pools, counts = [], []
    for r in results.values():
        k = len(r["trades"])
        if not k:
            continue
        values = r["net"] if key == "rule" else r["fwd"][key]
        pool = values[MIN_INDEX + 1:]
        pool = pool[~np.isnan(pool)]
        if len(pool):
            pools.append(pool)
            counts.append(k)
    means = np.empty(draws, dtype=np.float64)
    total = sum(counts)
    for d in range(draws):
        s = 0.0
        for pool, k in zip(pools, counts):
            s += pool[rng.integers(0, len(pool), size=k)].sum()
        means[d] = s / total
    return means


def same_day_excess(results, all_trades, key):
    """Trade return minus the mean return of entering every other symbol on the same day.

    Removes what the whole market did after that date (signals cluster after broad
    sell-offs). Significance uses one value per entry date (mean excess of that day),
    so trades on the same day are not counted as independent evidence.
    """
    series = {s: pd.Series(r["net"] if key == "rule" else r["fwd"][key], index=r["dates"])
              for s, r in results.items()}
    panel = pd.DataFrame(series)
    total, count = panel.sum(axis=1), panel.notna().sum(axis=1)
    rows = []
    for t in all_trades:
        day = results[t["symbol"]]["dates"][t["entry"]]
        own = panel.at[day, t["symbol"]]
        others = count[day] - 1
        if np.isnan(own) or others < 5:
            continue
        rows.append((day, own - (total[day] - own) / others))
    if not rows:
        return {"n": 0}
    ex = pd.DataFrame(rows, columns=["day", "excess"])
    daily = ex.groupby("day")["excess"].mean().to_numpy(dtype=np.float64)
    se = daily.std(ddof=1) / np.sqrt(len(daily)) if len(daily) > 1 else np.nan
    return {"n": int(len(ex)), "days": int(len(daily)), "mean": float(ex["excess"].mean()),
            "median": float(ex["excess"].median()),
            "beat_rate": float((ex["excess"] > 0).mean() * 100),
            "daily_mean": float(daily.mean()), "t_by_day": float(daily.mean() / se) if se and se > 0 else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--period", default="10y")
    ap.add_argument("--draws", type=int, default=2000)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=20261013)
    ap.add_argument("--symbols", nargs="*", default=BIST100_SYMBOLS)
    args = ap.parse_args()
    cfg = BacktestConfig(interval="1d")

    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        raw = dict(pool.map(analyse_symbol, [(s, args.period) for s in args.symbols]))
    errors = {s: r["error"] for s, r in raw.items() if "error" in r}
    results = {s: r for s, r in raw.items() if "error" not in r}
    print(f"{len(results)} hisse, {len(errors)} hata")

    all_trades = [dict(t, symbol=s, year=int(r["years"][t["entry"]])) for s, r in results.items() for t in r["trades"]]
    rule = np.array([t["net"] for t in all_trades], dtype=np.float64)
    rng = np.random.default_rng(args.seed)

    metrics = {}
    for key, label in [("rule", "Kurallı işlem (stop/hedef/20 bar, NU70 çıkış)")] + \
                      [(d, f"Sabit {d} gün tutma") for d in FORWARD_DAYS]:
        if key == "rule":
            sig = rule
        else:
            sig = np.array([results[t["symbol"]]["fwd"][key][t["entry"]] for t in all_trades], dtype=np.float64)
        base = random_baseline(results, key, args.draws, rng)
        sig_stats = _stats(sig)
        metrics[str(key)] = {
            "label": label, "signal": sig_stats,
            "random_mean": float(base.mean()),
            "random_p05": float(np.percentile(base, 5)), "random_p95": float(np.percentile(base, 95)),
            # one-sided: share of random draws whose mean is at least the signal mean
            "p_value": float((np.sum(base >= sig_stats.get("mean", np.inf)) + 1) / (len(base) + 1)),
            "same_day_excess": same_day_excess(results, all_trades, key),
        }
        print(label, metrics[str(key)])

    by_year = {}
    for t in all_trades:
        by_year.setdefault(t["year"], []).append(t["net"])
    year_rows = {y: _stats(v) for y, v in sorted(by_year.items())}
    reasons = pd.Series([t["reason"] for t in all_trades]).value_counts().to_dict() if all_trades else {}
    per_symbol = {s: len(r["trades"]) for s, r in results.items()}
    _write_report(args, cfg, results, errors, metrics, year_rows, reasons, per_symbol, len(all_trades))


def _f(v, d=2):
    return "—" if v is None else (f"{v:.{d}f}" if isinstance(v, float) else str(v))


def _write_report(args, cfg, results, errors, metrics, year_rows, reasons, per_symbol, n_trades):
    firsts = sorted(r["first"] for r in results.values())
    lasts = sorted(r["last"] for r in results.values())
    m = metrics["rule"]
    lines = [
        "# PU30 Uzun Dönem Testi (yalnız RSI, rastgele girişe karşı)",
        "",
        f"Üretildi: {datetime.now(timezone.utc).isoformat(timespec='seconds')} · "
        f"`python -m python_bot.scripts.pu30_long_history --period {args.period} --draws {args.draws} --seed {args.seed}`",
        "",
        f"- Strateji: RSI PU30 `pu30-strict-v3` (1. dip RSI < 30, 2. dip RSI > 30), günlük mumlar; NU70 yalnız çıkış uyarısı.",
        f"- Evren: güncel BIST100 listesi, {len(results)}/{len(results) + len(errors)} hisse "
        f"(veri yok: {', '.join(sorted(errors)) or 'yok'}). Veri {firsts[0] if firsts else '—'} → {lasts[-1] if lasts else '—'} "
        f"(yfinance, temettü/bölünme düzeltmeli; hisse başına en fazla {args.period}).",
        f"- İşlem kuralları `run_portfolio_backtest` ile aynı: giriş knowable_at sonrası ilk açılış, stop %{cfg.stop_loss_pct}, "
        f"hedef %{cfg.target_pct}, en fazla {cfg.holding_bars_max} bar, NU70 teyidinde ertesi açılışta çıkış, "
        f"komisyon %{cfg.commission_pct} + kayma %{cfg.slippage_pct} (her yön). Hisse başına aynı anda tek pozisyon; "
        f"portföy nakit sınırı yok (her sinyal ölçülür).",
        f"- Rastgele taban: her hissede, o hissenin işlem sayısı kadar rastgele giriş günü (kuralın girebileceği günler "
        f"arasından), aynı çıkış kuralları; {args.draws} tekrar. p değeri: rastgele ortalamanın sinyal ortalamasına "
        f"ulaştığı veya geçtiği tekrarların oranı (tek yönlü).",
        "",
        f"## Sonuç: {n_trades} işlem",
        "",
        "| Ölçü | İşlem | Sinyal ort. % | Medyan % | Kazanma % | Profit factor | Rastgele ort. % | Rastgele %5–%95 | p |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for k in metrics.values():
        s = k["signal"]
        lines.append(f"| {k['label']} | {s['n']} | {_f(s.get('mean'))} | {_f(s.get('median'))} | {_f(s.get('win_rate'), 1)} | "
                     f"{_f(s.get('profit_factor'))} | {_f(k['random_mean'])} | {_f(k['random_p05'])} … {_f(k['random_p95'])} | "
                     f"{_f(k['p_value'], 3)} |")
    lines += ["", "## Aynı gün evrene göre fazla getiri", "",
              "Her işlemin getirisi eksi aynı gün evrendeki diğer hisselere aynı kuralla girilseydi ortalama getiri "
              "(piyasanın o tarihten sonraki genel hareketi çıkarılır). t değeri gün bazında: aynı gün açılan "
              "işlemler tek gözlem sayılır.", "",
              "| Ölçü | İşlem | Giriş günü | Ort. fazla % | Medyan fazla % | Evreni geçme % | t (gün bazında) |",
              "|---|---|---|---|---|---|---|"]
    for k in metrics.values():
        e = k["same_day_excess"]
        lines.append(f"| {k['label']} | {e['n']} | {e.get('days', '—')} | {_f(e.get('mean'))} | {_f(e.get('median'))} | "
                     f"{_f(e.get('beat_rate'), 1)} | {_f(e.get('t_by_day'))} |")
    lines += ["", "## Yıllara göre (kurallı işlem, giriş yılı)", "",
              "| Yıl | İşlem | Ort. % | Medyan % | Kazanma % | Profit factor |", "|---|---|---|---|---|---|"]
    for y, s in year_rows.items():
        lines.append(f"| {y} | {s['n']} | {_f(s['mean'])} | {_f(s['median'])} | {_f(s['win_rate'], 1)} | {_f(s['profit_factor'])} |")
    lines += ["", "Çıkış nedenleri: " + ", ".join(f"{k} {v}" for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])) + ".",
              "", "Hisse başına işlem: " + ", ".join(f"{s} {n}" for s, n in sorted(per_symbol.items()) if n) + ".",
              "", "## Yorum sınırları", "",
              "- **Survivorship bias:** evren bugünkü BIST100; geçmişte endeksten çıkan veya kottan silinen hisseler yok.",
              "- İşlemler bağımsız değildir (aynı günlerde birçok hissede sinyal: piyasa çapında düşüşler). Rastgele taban "
              "hisseyi eşler ama tarihi eşlemez; aynı gün fazla getiri tarihi eşler ama hisseyi eşlemez. İkisi aynı "
              "yönü göstermiyorsa sonuç zamanlama değil piyasa/hisse etkisidir.",
              "- Kural parametreleri (pivot 5/2, aralık 8–60, tepki %3, stop %3, hedef %6) bu veriye göre ayarlanmadı; "
              "tek bir kural ölçüldü, çoklu deneme düzeltmesi gerekmez.",
              "- RF/LSTM/MOSTRSI filtreleri burada test edilmez: modeller bu dönemin çoğunu eğitimde gördü. "
              "Filtreler için tek dürüst ölçüm [VARIANT_COMPARISON.md](VARIANT_COMPARISON.md).",
              f"- Ortalama getiri işlem başınadır; {m['signal'].get('n', 0)} işlemin portföy getirisi değildir."]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    OUT.with_suffix(".json").write_text(json.dumps({
        "period": args.period, "draws": args.draws, "seed": args.seed, "metrics": metrics,
        "by_year": {str(k): v for k, v in year_rows.items()}, "exit_reasons": reasons,
        "trades_per_symbol": per_symbol, "errors": errors,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Rapor: {OUT}")


if __name__ == "__main__":
    main()
