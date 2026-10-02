-- Local Postgres schema replacing Firestore. Simplified from ~20 Firestore
-- collections down to the tables the simplified system actually needs.

CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT
);

CREATE TABLE IF NOT EXISTS daily_prices (
  symbol TEXT NOT NULL REFERENCES stocks(symbol),
  date DATE NOT NULL,
  open DOUBLE PRECISION,
  high DOUBLE PRECISION,
  low DOUBLE PRECISION,
  close DOUBLE PRECISION,
  volume BIGINT,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS regime_state (
  symbol TEXT NOT NULL,
  as_of DATE NOT NULL,
  regime TEXT NOT NULL,           -- e.g. TREND / RANGE / VOLATILE
  confidence DOUBLE PRECISION,
  PRIMARY KEY (symbol, as_of)
);

CREATE TABLE IF NOT EXISTS ml_predictions (
  symbol TEXT NOT NULL,
  as_of DATE NOT NULL,
  model_version TEXT NOT NULL,
  predicted_label TEXT NOT NULL,  -- e.g. UP / DOWN / FLAT
  probability DOUBLE PRECISION,
  PRIMARY KEY (symbol, as_of, model_version)
);

CREATE TABLE IF NOT EXISTS scan_results (
  symbol TEXT NOT NULL,
  as_of DATE NOT NULL,
  status TEXT NOT NULL,
  score DOUBLE PRECISION,
  regime TEXT,
  ml_label TEXT,
  ml_probability DOUBLE PRECISION,
  recommendation TEXT,
  PRIMARY KEY (symbol, as_of)
);

CREATE INDEX IF NOT EXISTS idx_daily_prices_symbol_date ON daily_prices (symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_scan_results_as_of ON scan_results (as_of DESC);

-- Fundamentals: point-in-time by design, unlike the tables above.
--
-- daily_prices/scan_results/ml_predictions are safe keyed by "as of date"
-- because a past OHLCV bar or a past model prediction never changes after
-- the fact. Fundamentals are different: a company's Q2 revenue as reported
-- in July can be RESTATED in a later filing. A backtest that runs "as of
-- August 2026" must only ever see the figure that was actually known in
-- August, never a later revision -- using the revised number would be
-- look-ahead bias (Phase 39 / P0 item 1 of the roadmap).
--
-- So `reported_at` (when KAP actually published this figure) is part of the
-- primary key, not just a timestamp column: a restatement inserts a NEW row
-- rather than overwriting the old one, and both stay queryable forever.
-- "What was known as of date X" = for each (symbol, period_end, period_type,
-- metric), the row with the latest reported_at <= X.
--
-- Metric/value (EAV) rather than fixed columns (revenue DOUBLE, ebitda
-- DOUBLE, ...) deliberately, because BIST sectors report different line
-- items -- a bank's XBRL taxonomy has no "inventory" line, an industrial's
-- has no "net interest margin". Fixed columns would mean either a sparse
-- wide table or pretending every sector reports the same things, which is
-- exactly the "banks scored like industrials" problem flagged in the
-- roadmap (Phase 5 / P1 item 5).
CREATE TABLE IF NOT EXISTS fundamentals (
  symbol TEXT NOT NULL REFERENCES stocks(symbol),
  period_end DATE NOT NULL,        -- fiscal period this data describes, e.g. 2026-06-30 for Q2 2026
  period_type TEXT NOT NULL,       -- 'Q1' / 'Q2' / 'Q3' / 'Q4' / 'FY'
  metric TEXT NOT NULL,            -- e.g. 'revenue', 'ebitda', 'net_income', 'eps', 'total_assets'
  value DOUBLE PRECISION,
  currency TEXT NOT NULL DEFAULT 'TRY',
  reported_at DATE NOT NULL,       -- when KAP actually published this figure -- the point-in-time anchor
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'KAP_XBRL',
  is_restatement BOOLEAN NOT NULL DEFAULT FALSE,  -- true if a later reported_at revises an earlier filing for the same period
  PRIMARY KEY (symbol, period_end, period_type, metric, reported_at)
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_symbol_period ON fundamentals (symbol, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_fundamentals_reported_at ON fundamentals (reported_at);
