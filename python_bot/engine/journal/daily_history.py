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
SIGNAL_DECISIONS_FILE = _JOURNAL_DIR / "pu30_signal_log.csv"
SIGNAL_OUTCOMES_FILE = _JOURNAL_DIR / "pu30_signal_outcomes.csv"

RESOLVE_AFTER_DAYS = 5  # matches local_classifier.FORWARD_HORIZON_DAYS

DECISION_FIELDNAMES = [
    "date", "symbol", "predicted_label", "probability", "current_price",
    "sniper_approved", "confluence_level", "resolve_after_days",
]
OUTCOME_FIELDNAMES = ["date", "symbol", "actual_price", "actual_return_pct", "was_correct", "resolved_at"]

SIGNAL_DECISION_FIELDNAMES = [
    "date", "symbol", "interval", "signal_type", "confirm_date", "knowable_at",
    "entry_price", "trust_level_price", "trust_level_durum", "tetiklendi",
    "confirmed_timeframes", "resolve_after_days",
]
SIGNAL_OUTCOME_FIELDNAMES = [
    "date", "symbol", "interval", "signal_type", "confirm_date", "tetiklendi",
    "actual_price", "actual_return_pct", "was_correct", "resolved_at",
]

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


def _signal_key(row: Dict[str, Any]) -> tuple:
    return (
        str(row.get("symbol", "")),
        str(row.get("interval", "")),
        str(row.get("signal_type", "")),
        str(row.get("confirm_date", "")),
        str(row.get("tetiklendi", "")),
    )


def log_pu30_signals(signals: List[Dict[str, Any]], interval: str = "4h") -> int:
    """Appends one immutable decision row per unique (symbol, interval, signal_type,
    confirm_date, tetiklendi) event. If a signal is first observed with
    tetiklendi=False and later breaks its hourly trust level (tetiklendi=True),
    the break is logged as a new immutable event without modifying the earlier row."""
    today = datetime.now(timezone.utc).date().isoformat()
    with _lock:
        existing_keys = {_signal_key(d) for d in _read_csv(SIGNAL_DECISIONS_FILE)}
        rows = []
        for s in signals:
            sym = str(s.get("symbol", ""))
            sig_interval = str(s.get("interval") or interval)
            sig_type = str(s.get("type") or s.get("signal_type") or "")
            confirm_date = str(s.get("confirm_date") or s.get("pivot_date") or "")
            if not sym or not sig_type or not confirm_date:
                continue
            tetiklendi_str = str(bool(s.get("tetiklendi", False)))
            candidate = {
                "symbol": sym,
                "interval": sig_interval,
                "signal_type": sig_type,
                "confirm_date": confirm_date,
                "tetiklendi": tetiklendi_str,
            }
            key = _signal_key(candidate)
            if key in existing_keys:
                continue
            saatlik = s.get("saatlik_seviye") or {}
            trust_price = saatlik.get("price")
            if trust_price is None:
                lvl_obj = s.get("guven_tazeleyen_tepe") or s.get("guven_kiran_dip") or {}
                trust_price = lvl_obj.get("price") if isinstance(lvl_obj, dict) else None
            trust_durum = saatlik.get("durum") or ("kirildi" if s.get("tetiklendi") else "bekleniyor")
            confirmed_tfs = s.get("confirmed_timeframes") or [sig_interval]
            if isinstance(confirmed_tfs, list):
                confirmed_tfs_str = ",".join(str(x) for x in confirmed_tfs)
            else:
                confirmed_tfs_str = str(confirmed_tfs)

            rows.append({
                "date": today,
                "symbol": sym,
                "interval": sig_interval,
                "signal_type": sig_type,
                "confirm_date": confirm_date,
                "knowable_at": str(s.get("knowable_at") or ""),
                "entry_price": s.get("last_close") or s.get("current_price") or "",
                "trust_level_price": "" if trust_price is None else trust_price,
                "trust_level_durum": trust_durum,
                "tetiklendi": tetiklendi_str,
                "confirmed_timeframes": confirmed_tfs_str,
                "resolve_after_days": RESOLVE_AFTER_DAYS,
            })
            existing_keys.add(key)
        if rows:
            _append_csv(SIGNAL_DECISIONS_FILE, SIGNAL_DECISION_FIELDNAMES, rows)
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


def resolve_pending_signal_outcomes() -> int:
    """Appends an outcome event for every PU30/NU70 signal decision row past its
    resolve_after_days horizon without mutating SIGNAL_DECISIONS_FILE."""
    with _lock:
        decisions = _read_csv(SIGNAL_DECISIONS_FILE)
        if not decisions:
            return 0
        already_resolved = {_signal_key(o) for o in _read_csv(SIGNAL_OUTCOMES_FILE)}
        today = datetime.now(timezone.utc).date()
        new_outcomes = []
        for d in decisions:
            key = _signal_key(d)
            if key in already_resolved:
                continue
            try:
                decision_date = datetime.strptime(d["date"], "%Y-%m-%d").date()
                resolve_after = int(d.get("resolve_after_days") or RESOLVE_AFTER_DAYS)
            except (ValueError, TypeError):
                continue
            if (today - decision_date).days < resolve_after:
                continue
            try:
                entry_price = float(d["entry_price"])
                actual_price = _fetch_actual_price(d["symbol"])
            except Exception:
                continue
            actual_return_pct = (actual_price / entry_price - 1.0) * 100.0 if entry_price else 0.0
            sig_type = d.get("signal_type", "")
            was_correct = (
                (sig_type == "PU30" and actual_return_pct > 0)
                or (sig_type == "NU70" and actual_return_pct < 0)
            )
            new_outcomes.append({
                "date": d["date"],
                "symbol": d["symbol"],
                "interval": d["interval"],
                "signal_type": sig_type,
                "confirm_date": d["confirm_date"],
                "tetiklendi": d.get("tetiklendi", "False"),
                "actual_price": round(actual_price, 4),
                "actual_return_pct": round(actual_return_pct, 2),
                "was_correct": was_correct,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            })
            already_resolved.add(key)
        if new_outcomes:
            _append_csv(SIGNAL_OUTCOMES_FILE, SIGNAL_OUTCOME_FIELDNAMES, new_outcomes)
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

    sig_decisions = _read_csv(SIGNAL_DECISIONS_FILE)
    sig_outcomes = {_signal_key(o): o for o in _read_csv(SIGNAL_OUTCOMES_FILE)}
    sig_rows = []
    for sd in sig_decisions:
        so = sig_outcomes.get(_signal_key(sd))
        srow = dict(sd)
        if so:
            srow["resolved"] = "True"
            srow["actual_price"] = so["actual_price"]
            srow["actual_return_pct"] = so["actual_return_pct"]
            srow["was_correct"] = so["was_correct"]
        else:
            srow["resolved"] = "False"
            srow["actual_price"] = ""
            srow["actual_return_pct"] = ""
            srow["was_correct"] = ""
        sig_rows.append(srow)

    if limit_days is not None:
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=limit_days)).isoformat()
        rows = [r for r in rows if r["date"] >= cutoff]
        sig_rows = [r for r in sig_rows if r["date"] >= cutoff]

    resolved_rows = [r for r in rows if r["resolved"] == "True"]
    pending_rows = [r for r in rows if r["resolved"] != "True"]
    approved_resolved_rows = [r for r in resolved_rows if r.get("sniper_approved") == "True"]

    sig_resolved_rows = [r for r in sig_rows if r["resolved"] == "True"]
    sig_pending_rows = [r for r in sig_rows if r["resolved"] != "True"]
    sig_triggered_resolved = [r for r in sig_resolved_rows if r.get("tetiklendi") == "True"]

    return {
        "rows": rows,
        "total_rows": len(rows),
        "resolved_rows": len(resolved_rows),
        "pending_rows": len(pending_rows),
        "overall_accuracy_pct": _accuracy_pct(resolved_rows),
        "approved_only_accuracy_pct": _accuracy_pct(approved_resolved_rows),
        "approved_only_count": len(approved_resolved_rows),
        "pu30_signal_rows": sig_rows,
        "pu30_total_rows": len(sig_rows),
        "pu30_resolved_rows": len(sig_resolved_rows),
        "pu30_pending_rows": len(sig_pending_rows),
        "pu30_overall_accuracy_pct": _accuracy_pct(sig_resolved_rows),
        "pu30_triggered_accuracy_pct": _accuracy_pct(sig_triggered_resolved),
        "pu30_triggered_count": len(sig_triggered_resolved),
    }
