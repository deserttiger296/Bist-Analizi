# -*- coding: utf-8 -*-
"""
Batch pipeline: fetch latest BIST daily bars -> HMM regime + local ML
prediction -> upsert into local Postgres.

Replaces any notion of a real-time/websocket sync (there never was a
Firebase/Firestore dependency in python_bot -- confirmed by earlier audit --
so this is purely additive). Meant to be run once per invocation, either
manually or via a cron entry / Windows Task Scheduler job that the user sets
up themselves:

    python_bot/.venv/Scripts/python.exe python_bot/scripts/run_pipeline.py

For each symbol in the basket this script:
  1. Fetches recent daily OHLCV via yfinance and upserts it into `daily_prices`.
  2. Runs `classify_regime_hmm` (engine/brain/regime_hmm.py) and upserts the
     result into `regime_state`.
  3. Runs `local_classifier.predict` (engine/brain/local_classifier.py) and
     upserts the result into `ml_predictions`.
  4. Writes one combined row (status/score/regime/ml_label/ml_probability/
     recommendation) into `scan_results`.

No websocket/real-time logic, no OS-level scheduling is registered here.
"""
import sys
import logging
from pathlib import Path
from datetime import datetime, date

import numpy as np
import pandas as pd
import yfinance as yf

# Make `engine.*` importable regardless of the current working directory
# this script is launched from (python_bot/ root or scripts/ itself).
_PYTHON_BOT_ROOT = Path(__file__).resolve().parent.parent
if str(_PYTHON_BOT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_BOT_ROOT))

from python_bot.engine.brain.regime_hmm import classify_regime_hmm
from python_bot.engine.brain.local_classifier import predict as ml_predict
from engine import db

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("BIST_RunPipeline")

# Reasonable liquid BIST30-ish basket. Reuses the same names as
# live_scanner.py's BIST_BASKET (kept independent here so this script has no
# import-time dependency on trading_bot.py/live_scanner.py).
DEFAULT_SYMBOLS = [
    "THYAO", "TCELL", "ISCTR", "AKBNK", "YKBNK",
    "GARAN", "KCHOL", "SAHOL", "TUPRS", "SISE",
    "ASELS", "BIMAS", "FROTO", "EREGL", "PGSUS",
    "ARCLK", "TOASO", "SASA", "KOZAL", "PETKM",
]


def _normalize_symbol(symbol: str) -> str:
    return symbol if symbol.endswith(".IS") else f"{symbol}.IS"


def _recommendation_from_ml(predicted_label: str, probability: float) -> str:
    """Simple, transparent mapping from model output to a human recommendation."""
    if predicted_label == "UP" and probability >= 0.55:
        return "AL" if probability < 0.75 else "GÜÇLÜ AL"
    if predicted_label == "DOWN" and probability >= 0.55:
        return "SAT" if probability < 0.75 else "GÜÇLÜ SAT"
    return "İZLE"


def process_symbol(symbol: str, as_of: date) -> dict:
    ticker = _normalize_symbol(symbol)
    logger.info(f"[{symbol}] Fetching latest daily OHLCV via yfinance...")

    hist = yf.download(ticker, period="1y", progress=False)
    if isinstance(hist.columns, pd.MultiIndex):
        hist.columns = hist.columns.droplevel(1)

    if hist.empty:
        raise ValueError(f"No historical data returned for {ticker}")

    db.upsert_stock(symbol=symbol)

    # 1) Persist recent daily bars (last 30 sessions is plenty for a daily
    # batch job -- we don't need to re-upsert years of history every run).
    recent = hist.tail(30)
    rows = []
    for idx, r in recent.iterrows():
        bar_date = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)
        rows.append((
            symbol, bar_date,
            float(r["Open"]) if pd.notna(r["Open"]) else None,
            float(r["High"]) if pd.notna(r["High"]) else None,
            float(r["Low"]) if pd.notna(r["Low"]) else None,
            float(r["Close"]) if pd.notna(r["Close"]) else None,
            int(r["Volume"]) if pd.notna(r["Volume"]) else None,
        ))
    db.upsert_daily_prices_bulk(rows)

    # 2) Market regime (HMM)
    close = hist["Close"]
    regime_result = classify_regime_hmm(close, n_states=3)
    db.upsert_regime_state(
        symbol=symbol,
        as_of=as_of.isoformat(),
        regime=regime_result["regime"],
        confidence=regime_result["confidence"],
    )

    # 3) Local ML prediction
    ml_result = ml_predict(symbol)
    db.upsert_ml_prediction(
        symbol=symbol,
        as_of=as_of.isoformat(),
        model_version=ml_result.get("model_version", "local_rf_v1"),
        predicted_label=ml_result["predicted_label"],
        probability=ml_result["probability"],
    )

    # 4) Combined scan_results row
    recommendation = _recommendation_from_ml(ml_result["predicted_label"], ml_result["probability"])
    db.upsert_scan_result(
        symbol=symbol,
        as_of=as_of.isoformat(),
        status="OK",
        score=ml_result["probability"] * 100.0,
        regime=regime_result["regime"],
        ml_label=ml_result["predicted_label"],
        ml_probability=ml_result["probability"],
        recommendation=recommendation,
    )

    return {
        "symbol": symbol,
        "regime": regime_result["regime"],
        "ml_label": ml_result["predicted_label"],
        "ml_probability": ml_result["probability"],
        "recommendation": recommendation,
    }


def run_pipeline(symbols=None) -> None:
    symbols = symbols or DEFAULT_SYMBOLS
    as_of = date.today()
    logger.info(f"=== Starting local batch pipeline for {len(symbols)} symbols (as_of={as_of}) ===")

    succeeded = []
    failed = []
    for symbol in symbols:
        try:
            result = process_symbol(symbol, as_of)
            succeeded.append(result)
            logger.info(f"[{symbol}] OK -> regime={result['regime']} "
                        f"ml={result['ml_label']} ({result['ml_probability']:.2f}) "
                        f"rec={result['recommendation']}")
        except Exception as e:
            logger.error(f"[{symbol}] FAILED: {e}")
            failed.append((symbol, str(e)))

    print("\n" + "=" * 60)
    print("BIST LOCAL PIPELINE RUN SUMMARY")
    print("=" * 60)
    print(f"As of:      {as_of.isoformat()}")
    print(f"Requested:  {len(symbols)} symbols")
    print(f"Succeeded:  {len(succeeded)}")
    print(f"Failed:     {len(failed)}")
    if failed:
        print("\nFailures:")
        for symbol, err in failed:
            print(f"  - {symbol}: {err}")
    if succeeded:
        print("\nWritten to daily_prices / regime_state / ml_predictions / scan_results:")
        for r in succeeded:
            print(f"  {r['symbol']:8s} regime={r['regime']:8s} "
                  f"ml={r['ml_label']:5s} p={r['ml_probability']:.2f}  -> {r['recommendation']}")
    print("=" * 60)


if __name__ == "__main__":
    run_pipeline()
