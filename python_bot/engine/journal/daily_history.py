# -*- coding: utf-8 -*-
"""
Forward-looking decision journal for the daily full-universe scan (run_daily_scan.py).

Design (see CLAUDE.md / project instructions, "ileriye donuk kayit"):
- A decision row (one per symbol per day) is written once and never rewritten --
  predicted_label/probability/current_price/sniper_approved/confluence_level at
  the moment of the call are immutable history.
- The actual outcome, once the forward horizon has elapsed, is appended as a
  SEPARATE event row in its own file (never edited back into the decision row).
- get_history() joins the two in memory to produce the flattened view the API
  and frontend expect. Logging the same (date, symbol) decision twice is a no-op.

Correctness check caveat: `was_correct` here is a simple directional check
(predicted UP/DOWN against the sign of the realized return, FLAT against a
+-1% band). It intentionally does NOT re-derive the ATR-scaled threshold used
to build the training labels in local_classifier.py -- that would need the
ATR at decision time, which isn't stored. This is a coarser, honestly-labeled
proxy for "was the direction call right", not the training label definition.
"""
import csv
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from python_bot.engine.data.provider import normalize_bist_symbol

_JOURNAL_DIR = Path(__file__).resolve().parent
DECISIONS_FILE = _JOURNAL_DIR / "daily_scan_log.csv"
OUTCOMES_FILE = _JOURNAL_DIR / "daily_scan_outcomes.csv"

RESOLVE_AFTER_DAYS = 5  # matches local_classifier.FORWARD_HORIZON_DAYS

DECISION_FIELDNAMES = [
    "date", "symbol", "predicted_label", "probability", "current_price",
    "sniper_approved", "confluence_level", "resolve_after_days",
]
OUTCOME_FIELDNAMES = ["date", "symbol", "actual_price", "actual_return_pct", "was_correct", "resolved_at"]

_lock = threading.Lock()


def _read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _append_csv(path: Path, fieldnames: List[str], rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_exists = path.exists()
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def log_daily_scan(predictions: List[Dict[str, Any]]) -> int:
    """Appends one immutable decision row per (date, symbol). Re-running the
    scan on the same day for a symbol already logged today is a no-op, so a
    retried/duplicated run_daily_scan.py call can't double-log a signal."""
    today = datetime.now(timezone.utc).date().isoformat()
    with _lock:
        existing_keys = {(d["date"], d["symbol"]) for d in _read_csv(DECISIONS_FILE)}
        rows = []
        for p in predictions:
            key = (today, p["symbol"])
            if key in existing_keys:
                continue
            rows.append({
                "date": today,
                "symbol": p["symbol"],
                "predicted_label": p["predicted_label"],
                "probability": p["probability"],
                "current_price": p["current_price"],
                "sniper_approved": p["sniper_approved"],
                "confluence_level": p["confluence_level"],
                "resolve_after_days": RESOLVE_AFTER_DAYS,
            })
            existing_keys.add(key)
        if rows:
            _append_csv(DECISIONS_FILE, DECISION_FIELDNAMES, rows)
        return len(rows)


def _fetch_actual_price(symbol: str) -> float:
    import yfinance as yf
    ticker = normalize_bist_symbol(symbol)
    df = yf.download(ticker, period="5d", progress=False, auto_adjust=True, timeout=15)
    if df is None or df.empty:
        raise ValueError(f"No recent price data for {symbol}")
    if hasattr(df.columns, "droplevel") and df.columns.nlevels > 1:
        df.columns = df.columns.droplevel(1)
    return float(df["Close"].iloc[-1])


def resolve_pending_outcomes() -> int:
    """Appends an outcome event for every decision row that is past its
    resolve_after_days horizon and doesn't already have one. Never rewrites
    the decision row itself. Safe to call repeatedly/concurrently (e.g. on
    every /api/history request) -- outcomes already resolved are skipped,
    and the read-check-append sequence is lock-protected against a race
    between two callers resolving the same row at once."""
    with _lock:
        decisions = _read_csv(DECISIONS_FILE)
        if not decisions:
            return 0
        already_resolved = {(o["date"], o["symbol"]) for o in _read_csv(OUTCOMES_FILE)}
        today = datetime.now(timezone.utc).date()
        new_outcomes = []
        for d in decisions:
            key = (d["date"], d["symbol"])
            if key in already_resolved:
                continue
            try:
                decision_date = datetime.strptime(d["date"], "%Y-%m-%d").date()
                resolve_after = int(d.get("resolve_after_days") or RESOLVE_AFTER_DAYS)
            except (ValueError, TypeError):
                continue
            if (today - decision_date).days < resolve_after:
                continue  # forward horizon hasn't elapsed yet -- stays pending
            try:
                current_price = float(d["current_price"])
                actual_price = _fetch_actual_price(d["symbol"])
            except Exception:
                continue  # transient data issue -- leave pending, retry on next call
            actual_return_pct = (actual_price / current_price - 1.0) * 100.0 if current_price else 0.0
            label = d["predicted_label"]
            was_correct = (
                (label == "UP" and actual_return_pct > 0)
                or (label == "DOWN" and actual_return_pct < 0)
                or (label == "FLAT" and abs(actual_return_pct) <= 1.0)
            )
            new_outcomes.append({
                "date": d["date"],
                "symbol": d["symbol"],
                "actual_price": round(actual_price, 4),
                "actual_return_pct": round(actual_return_pct, 2),
                "was_correct": was_correct,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            })
            already_resolved.add(key)
        if new_outcomes:
            _append_csv(OUTCOMES_FILE, OUTCOME_FIELDNAMES, new_outcomes)
        return len(new_outcomes)


def _accuracy_pct(rows: List[Dict[str, str]]) -> Optional[float]:
    graded = [r for r in rows if r.get("was_correct") in ("True", "False")]
    if not graded:
        return None
    return sum(1 for r in graded if r["was_correct"] == "True") / len(graded) * 100.0


def get_history(limit_days: Optional[int] = None) -> Dict[str, Any]:
    """Joins decisions with their (possibly absent) outcome event in memory --
    the join, not the storage, so decision rows on disk stay untouched."""
    decisions = _read_csv(DECISIONS_FILE)
    outcomes = {(o["date"], o["symbol"]): o for o in _read_csv(OUTCOMES_FILE)}

    rows = []
    for d in decisions:
        o = outcomes.get((d["date"], d["symbol"]))
        row = dict(d)
        if o:
            row["resolved"] = "True"
            row["actual_price"] = o["actual_price"]
            row["actual_return_pct"] = o["actual_return_pct"]
            row["was_correct"] = o["was_correct"]
        else:
            row["resolved"] = "False"
            row["actual_price"] = ""
            row["actual_return_pct"] = ""
            row["was_correct"] = ""
        rows.append(row)

    if limit_days is not None:
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=limit_days)).isoformat()
        rows = [r for r in rows if r["date"] >= cutoff]

    resolved_rows = [r for r in rows if r["resolved"] == "True"]
    pending_rows = [r for r in rows if r["resolved"] != "True"]
    approved_resolved_rows = [r for r in resolved_rows if r.get("sniper_approved") == "True"]

    return {
        "rows": rows,
        "total_rows": len(rows),
        "resolved_rows": len(resolved_rows),
        "pending_rows": len(pending_rows),
        "overall_accuracy_pct": _accuracy_pct(resolved_rows),
        "approved_only_accuracy_pct": _accuracy_pct(approved_resolved_rows),
        "approved_only_count": len(approved_resolved_rows),
    }
