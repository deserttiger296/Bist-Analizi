# -*- coding: utf-8 -*-
"""
Local Postgres access layer.

Replaces the Firestore/Firebase writer that this repo's Next.js app used to
depend on. python_bot itself never imported Firebase directly (confirmed by
audit) -- this module exists purely to give the new local-only pipeline
(`scripts/run_pipeline.py`) a place to persist its output, against the
schema defined in `db/schema.sql` (stocks, daily_prices, regime_state,
ml_predictions, scan_results).

Connects to a single local, unauthenticated-by-default Postgres instance
(see docker-compose.yml at the repo root) via `DATABASE_URL`, defaulting to:

    postgresql://bist:bist_local_dev@localhost:5432/bist_analyst

No pooling, no ORM -- this is a low-volume, once-a-day batch job, so plain
psycopg2 connections opened per call are simple and sufficient.
"""
import os
import logging
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg2
import psycopg2.extensions

logger = logging.getLogger("BIST_DB")

DEFAULT_DATABASE_URL = "postgresql://bist:bist_local_dev@localhost:5432/bist_analyst"


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


@contextmanager
def get_connection() -> Iterator[psycopg2.extensions.connection]:
    """
    Yields a psycopg2 connection to the local Postgres instance, committing
    on success and rolling back on error. Caller is responsible for cursors.
    """
    conn = psycopg2.connect(get_database_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# stocks
# ---------------------------------------------------------------------------

def upsert_stock(symbol: str, name: Optional[str] = None, sector: Optional[str] = None) -> None:
    sql = """
        INSERT INTO stocks (symbol, name, sector)
        VALUES (%s, %s, %s)
        ON CONFLICT (symbol) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, stocks.name),
            sector = COALESCE(EXCLUDED.sector, stocks.sector)
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (symbol, name, sector))


# ---------------------------------------------------------------------------
# daily_prices
# ---------------------------------------------------------------------------

def upsert_daily_price(symbol: str, date: str, open_: Optional[float], high: Optional[float],
                        low: Optional[float], close: Optional[float], volume: Optional[int]) -> None:
    sql = """
        INSERT INTO daily_prices (symbol, date, open, high, low, close, volume)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (symbol, date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (symbol, date, open_, high, low, close, volume))


def upsert_daily_prices_bulk(rows: list) -> int:
    """
    rows: list of tuples (symbol, date, open, high, low, close, volume).
    Returns the number of rows upserted.
    """
    if not rows:
        return 0
    sql = """
        INSERT INTO daily_prices (symbol, date, open, high, low, close, volume)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (symbol, date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, rows)
    return len(rows)


# ---------------------------------------------------------------------------
# regime_state
# ---------------------------------------------------------------------------

def upsert_regime_state(symbol: str, as_of: str, regime: str, confidence: Optional[float]) -> None:
    sql = """
        INSERT INTO regime_state (symbol, as_of, regime, confidence)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (symbol, as_of) DO UPDATE SET
            regime = EXCLUDED.regime,
            confidence = EXCLUDED.confidence
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (symbol, as_of, regime, confidence))


# ---------------------------------------------------------------------------
# ml_predictions
# ---------------------------------------------------------------------------

def upsert_ml_prediction(symbol: str, as_of: str, model_version: str,
                          predicted_label: str, probability: Optional[float]) -> None:
    sql = """
        INSERT INTO ml_predictions (symbol, as_of, model_version, predicted_label, probability)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (symbol, as_of, model_version) DO UPDATE SET
            predicted_label = EXCLUDED.predicted_label,
            probability = EXCLUDED.probability
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (symbol, as_of, model_version, predicted_label, probability))


# ---------------------------------------------------------------------------
# scan_results
# ---------------------------------------------------------------------------

def upsert_scan_result(symbol: str, as_of: str, status: str, score: Optional[float],
                        regime: Optional[str], ml_label: Optional[str],
                        ml_probability: Optional[float], recommendation: Optional[str]) -> None:
    sql = """
        INSERT INTO scan_results (symbol, as_of, status, score, regime, ml_label, ml_probability, recommendation)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (symbol, as_of) DO UPDATE SET
            status = EXCLUDED.status,
            score = EXCLUDED.score,
            regime = EXCLUDED.regime,
            ml_label = EXCLUDED.ml_label,
            ml_probability = EXCLUDED.ml_probability,
            recommendation = EXCLUDED.recommendation
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (symbol, as_of, status, score, regime, ml_label, ml_probability, recommendation))
