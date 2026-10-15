"""Point-in-time replay of the MTF lab decision over a whole universe.

For every symbol and every closed BIST 4h session block (13:30 and last
afternoon 1h bar), the lab's own ``build_mtf_decision`` is run on data that
existed at that moment: closed 1h bars, the 4h blocks built from them, closed
daily bars plus the forming daily bar aggregated from the same 1h bars. Forward
returns are measured from the next 1h bar's open, so a decision never sees its
own outcome.

Known limits (reported, not hidden):
* Yahoo keeps ~730 days of 1h history, so this is a ~2-3 year test.
* 15m history is only 60 days; replays use 1h lower-timeframe NU only.
* Universes are today's index lists (survivorship bias).
"""
from __future__ import annotations

import argparse
import pickle
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from python_bot.engine.data.provider import ISTANBUL_TZ, get_default_provider, resample_bist_4h
from python_bot.engine.universe import BIST100_SYMBOLS, BIST30_SYMBOLS

CACHE_DIR = Path(".cache/mtf_lab_research")
HORIZONS = (1, 3, 5, 10)          # sessions after entry
BARS_PER_SESSION = 9              # Yahoo BIST 1h bars 09:30..17:30
H1_WINDOW = 3000                  # ~330 sessions of 1h history per decision
D1_WINDOW = 251                   # live lab requests 1y of daily bars
MIN_H1_BARS = 1000                # RSI / pivot warm-up before the first decision
FRESH = {"1h": "FRESH", "4h": "FRESH", "1d": "FRESH", "15m": "FRESH"}


def universe(name: str) -> List[str]:
    return {"bist30": BIST30_SYMBOLS, "bist100": BIST100_SYMBOLS,
            "all": sorted(set(BIST30_SYMBOLS) | set(BIST100_SYMBOLS))}[name]


def load_symbol(symbol: str, refresh: bool = False) -> Optional[Tuple[pd.DataFrame, pd.DataFrame]]:
    """Cached 1h (max Yahoo history) and 5y daily bars from the shared provider."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{symbol}.pkl"
    if path.exists() and not refresh:
        with path.open("rb") as handle:
            return pickle.load(handle)
    provider = get_default_provider()
    hourly = provider.fetch_ohlcv(symbol, interval="1h")
    daily = provider.fetch_ohlcv(symbol, interval="1d", period="5y")
    if hourly.df is None or daily.df is None or not len(hourly.df) or not len(daily.df):
        return None
    data = (hourly.df.reset_index(drop=True), daily.df.reset_index(drop=True))
    with path.open("wb") as handle:
        pickle.dump(data, handle)
    return data


def _day_ordinal(days: pd.Series) -> pd.Series:
    # Unit-agnostic (provider frames are datetime64[s], resampled ones [ns]).
    return (days - pd.Timestamp("1970-01-01")).dt.days.astype(np.int64)


def _prepare(h1: pd.DataFrame, d1: pd.DataFrame):
    h1 = h1.copy()
    dates = pd.to_datetime(h1.date)
    h1["date"] = dates.dt.tz_localize(ISTANBUL_TZ) if dates.dt.tz is None else dates.dt.tz_convert(ISTANBUL_TZ)
    h1 = h1[(h1.date.dt.dayofweek < 5) & (h1.date.dt.hour >= 9) & (h1.date.dt.hour < 18)]
    h1 = h1.sort_values("date").reset_index(drop=True)
    h1["is_closed"] = True
    day = h1.date.dt.tz_localize(None).dt.normalize()
    bucket = (h1.date.dt.hour >= 14).astype(np.int64)
    key = _day_ordinal(day) * 2 + bucket  # (day, block) ordinal
    # Running intraday OHLCV gives the forming daily bar at any closed 1h bar.
    grouped = h1.groupby(day)
    running = pd.DataFrame({"open": grouped.open.transform("first"), "high": grouped.high.cummax(),
                            "low": grouped.low.cummin(), "close": h1.close,
                            "volume": grouped.volume.cumsum().astype(np.float64)})

    f4 = resample_bist_4h(h1.drop(columns=["is_closed"]))
    f4.columns = [c.lower() for c in f4.columns]
    f4["is_closed"] = True
    f4_day = f4.date.dt.tz_localize(None).dt.normalize()
    f4_key = _day_ordinal(f4_day) * 2 + (f4.date.dt.hour >= 14).astype(np.int64)

    d1 = d1.copy()
    d1["date"] = pd.to_datetime(d1.date).dt.tz_localize(None) if pd.to_datetime(d1.date).dt.tz is not None \
        else pd.to_datetime(d1.date)
    d1 = d1.sort_values("date").reset_index(drop=True)
    d1["is_closed"] = True
    d1["volume"] = d1.volume.astype(np.float64)
    return h1, day, bucket, key, running, f4, f4_key.to_numpy(), d1


def _features(decision: Dict[str, Any]) -> Dict[str, Any]:
    tfs = decision["timeframes"]
    hourly, session = tfs["1h"], tfs["4h"]
    hp, sp = hourly.get("pu30") or {}, session.get("pu30") or {}
    daily = decision["daily_structure"]
    lower = (decision.get("lower_timeframes") or {}).get("timeframes", {}).get("1h", {})
    price, resistance = decision["current_price"], decision["resistance"]
    return {
        "state": decision["state"],
        "h_valid": bool(hourly["valid_pu30"]),
        "h_age": hp.get("bars_since_confirm") if hourly["valid_pu30"] else np.nan,
        "h_bounce": hp.get("bounce_pct", np.nan) if hourly["valid_pu30"] else np.nan,
        "h_rsi": hourly.get("current_rsi"),
        "s_valid_raw": bool(session["valid_pu30"] or session.get("consumed")),
        "s_age": sp.get("bars_since_confirm") if (session["valid_pu30"] or session.get("consumed")) else np.nan,
        "s_bounce": sp.get("bounce_pct", np.nan) if (session["valid_pu30"] or session.get("consumed")) else np.nan,
        "s_rsi": session.get("current_rsi"),
        "consumed": bool(session.get("consumed")),
        "bars_since_breakout": decision.get("bars_since_breakout"),
        "resistance_broken": bool(decision["resistance_broken"]),
        "above": bool(decision["price_above_resistance"]),
        "dist_res": (price / resistance - 1.0) if price and resistance else np.nan,
        "daily_status": daily.get("status"),
        "daily_forming": bool(daily.get("forming_pu")),
        "d_rsi": daily.get("current_rsi"),
        "d_d1_rsi": daily.get("d1_rsi"),
        "d_support_gap": (price / daily["support"] - 1.0) if price and daily.get("support") else np.nan,
        "lower_nu": bool(lower.get("nu_pressure")),
        "lower_broken": lower.get("rsi_trend_broken"),
        "price": price,
    }


def replay_symbol(symbol: str, step: int = 1, refresh: bool = False) -> pd.DataFrame:
    """One row per closed 4h block (every ``step``-th) with features and forward returns."""
    from python_bot.engine.signals.pu30_mtf import build_mtf_decision

    loaded = load_symbol(symbol, refresh=refresh)
    if loaded is None:
        return pd.DataFrame()
    h1, day, bucket, key, running, f4, f4_key, d1 = _prepare(*loaded)
    last_of_block = np.flatnonzero(np.r_[key.to_numpy()[1:] != key.to_numpy()[:-1], True])
    evals = [i for i in last_of_block if i + 1 >= MIN_H1_BARS][::step]
    d_dates = d1.date.to_numpy()
    opens, highs, lows, closes = (h1[c].to_numpy(dtype=np.float64) for c in ("open", "high", "low", "close"))
    rows = []
    for i in evals:
        k, today = int(key.iloc[i]), day.iloc[i]
        h = h1.iloc[max(0, i - H1_WINDOW + 1): i + 1].reset_index(drop=True)
        f = f4.iloc[: int(np.searchsorted(f4_key, k, side="right"))]
        f = f.iloc[-(H1_WINDOW // 4):].reset_index(drop=True)
        closed_days = d1.iloc[: int(np.searchsorted(d_dates, np.datetime64(today), side="left"))]
        forming = pd.DataFrame([{"date": today, **running.iloc[i].to_dict(), "is_closed": bool(bucket.iloc[i])}])
        d = pd.concat([closed_days.iloc[-D1_WINDOW:], forming], ignore_index=True)
        try:
            decision = build_mtf_decision({"1h": h, "4h": f, "1d": d, "15m": None}, FRESH)
        except Exception as error:  # a broken row must be visible, not silently dropped
            rows.append({"symbol": symbol, "t": h1.date.iloc[i], "state": "REPLAY_ERROR", "error": repr(error)})
            continue
        row = {"symbol": symbol, "t": h1.date.iloc[i] + pd.Timedelta(hours=1), **_features(decision)}
        entry = i + 1
        if entry < len(h1):
            row["entry_price"] = opens[entry]
            for hz in HORIZONS:
                exit_ = entry + hz * BARS_PER_SESSION - 1
                row[f"fwd_{hz}"] = closes[exit_] / opens[entry] - 1.0 if exit_ < len(h1) else np.nan
            end = min(len(h1), entry + 5 * BARS_PER_SESSION)
            row["mfe_5"] = highs[entry:end].max() / opens[entry] - 1.0
            row["mae_5"] = lows[entry:end].min() / opens[entry] - 1.0
        rows.append(row)
    return pd.DataFrame(rows)


def _replay_job(args):
    symbol, step, refresh = args
    started = time.time()
    try:
        frame = replay_symbol(symbol, step=step, refresh=refresh)
        return symbol, frame, None, time.time() - started
    except Exception as error:
        return symbol, pd.DataFrame(), repr(error), time.time() - started


def replay_universe(symbols: List[str], step: int = 1, workers: int = 4, refresh: bool = False,
                    out: Optional[Path] = None) -> pd.DataFrame:
    # Downloads stay sequential (Yahoo rate limits); replay is CPU bound and parallel.
    for symbol in symbols:
        load_symbol(symbol, refresh=refresh)
    frames, failures = [], {}
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for symbol, frame, error, seconds in pool.map(_replay_job, [(s, step, False) for s in symbols]):
            print(f"{symbol:6} rows={len(frame):5d} {seconds:6.1f}s" + (f" ERROR {error}" if error else ""), flush=True)
            if error:
                failures[symbol] = error
            frames.append(frame)
    result = pd.concat([f for f in frames if len(f)], ignore_index=True)
    result.attrs["failures"] = failures
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        result.to_pickle(out)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--universe", default="all", choices=("bist30", "bist100", "all"))
    parser.add_argument("--symbols", default="", help="comma separated override")
    parser.add_argument("--step", type=int, default=1, help="use every n-th 4h block")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--refresh", action="store_true", help="re-download cached bars")
    parser.add_argument("--out", default=str(CACHE_DIR / "replay.pkl"))
    args = parser.parse_args()
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] or universe(args.universe)
    started = time.time()
    result = replay_universe(symbols, step=args.step, workers=args.workers, refresh=args.refresh, out=Path(args.out))
    print(f"rows={len(result)} symbols={result.symbol.nunique()} failures={result.attrs['failures']} "
          f"seconds={time.time() - started:.0f}")


if __name__ == "__main__":
    main()
