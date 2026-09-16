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
