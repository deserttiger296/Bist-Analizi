# -*- coding: utf-8 -*-
r"""
Daily scan + history logger. Run this once a day (schedule it with Windows
Task Scheduler or cron) to:
  1. Predict every BIST100 symbol with the full sniper pipeline (RF + LSTM +
     sentiment confluence) and log every result -- not just the ones that
     clear the buy threshold, so "did the model call it right" is answerable
     for the whole universe, not a cherry-picked subset.
  2. Resolve any previously-logged predictions old enough to check against
     what actually happened.

Usage:
    python_bot/.venv/Scripts/python.exe run_daily_scan.py

To schedule on Windows (run once daily at 18:30, after BIST close):
    schtasks /create /tn "BIST Sniper Daily Scan" /tr "\"<path-to>\.venv\Scripts\python.exe\" \"<path-to>\run_daily_scan.py\"" /sc daily /st 18:30
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, ".")

from python_bot.main_api import BIST100_SYMBOLS, predict_rf, _process_prediction
from python_bot.engine.journal.daily_history import log_daily_scan, resolve_pending_outcomes

SCAN_MAX_WORKERS = 10


def _predict_one(symbol: str):
    try:
        raw = predict_rf(symbol)
        result = _process_prediction(raw, symbol)
        return {
            "symbol": symbol,
            "predicted_label": result["predicted_label"],
            "probability": result["probability"],
            "current_price": result["current_price"],
            "sniper_approved": result["sniper_approved"],
            "confluence_level": result["confluence_level"],
        }
    except Exception as e:
        print(f"[DailyScan] Skipping {symbol}: {e}")
        return None


def main():
    print(f"[DailyScan] Starting full-universe scan of {len(BIST100_SYMBOLS)} symbols...")
    t0 = time.time()

    predictions = []
    with ThreadPoolExecutor(max_workers=SCAN_MAX_WORKERS) as pool:
        for result in pool.map(_predict_one, BIST100_SYMBOLS):
            if result is not None:
                predictions.append(result)

    print(f"[DailyScan] Got {len(predictions)}/{len(BIST100_SYMBOLS)} predictions in {time.time() - t0:.1f}s")

    log_daily_scan(predictions)
    print(f"[DailyScan] Logged {len(predictions)} rows to engine/journal/daily_scan_log.csv")

    resolved = resolve_pending_outcomes()
    print(f"[DailyScan] Resolved {resolved} previously-pending predictions against actual outcomes")


if __name__ == "__main__":
    main()
