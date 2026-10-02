import { Pool } from 'pg';

// Create a single global connection pool for the entire application.
// Local Postgres (docker-compose.yml, db/schema.sql) — no cloud DB involved.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Add reasonable timeouts and limits for serverless environments
  max: 20, // Max number of connections in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Circuit breaker: when Postgres is unreachable (e.g. not running locally),
// every symbol in a 100-symbol scan would otherwise retry the connection and
// log a full stack trace on its own failure -- 100+ duplicate traces per
// scan. Once a connection error is seen, skip straight to a fast rejection
// for a cooldown window and log one warning instead, so callers still see
// their persistence calls fail (and their own catch blocks still run) but
// the console stops being flooded. Automatically retries after the cooldown
// in case Postgres comes up later.
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']);
const COOLDOWN_MS = 60_000;
let unavailableUntil = 0;
let warnedThisCooldown = false;

export function isPostgresAvailable(): boolean {
  return Date.now() >= unavailableUntil;
}

// Helper for single queries
export const query = async (text: string, params?: any[]) => {
  if (Date.now() < unavailableUntil) {
    throw new Error('Postgres unavailable (circuit breaker cooldown active)');
  }

  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    unavailableUntil = 0;
    warnedThisCooldown = false;
    return res;
  } catch (error: any) {
    if (CONNECTION_ERROR_CODES.has(error?.code)) {
      unavailableUntil = Date.now() + COOLDOWN_MS;
      if (!warnedThisCooldown) {
        console.warn(`[db] Postgres unreachable (${error.code}) -- suppressing further connection errors for ${COOLDOWN_MS / 1000}s`);
        warnedThisCooldown = true;
      }
    } else {
      console.error('Error executing query', { text, error });
    }
    throw error;
  }
};

// Helper for transactions
export const getClient = async () => {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;
  // Monkey patch the query method to keep track of the last query executed
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
    console.error(`The last executed query on this client was: ${(client as any).lastQuery}`);
  }, 5000);
  
  client.query = ((...args: any[]) => {
    (client as any).lastQuery = args;
    return (query as any).apply(client, args);
  }) as any;
  
  client.release = () => {
    clearTimeout(timeout);
    client.query = query;
    client.release = release;
    return release.apply(client);
  };
  
  return client;
};

// ─── Typed helpers for the 5 local tables in db/schema.sql ─────────────────
// These replace the ~20 Firestore collections / Firebase Data Connect calls
// the app used to make. Every helper is a thin wrapper around `query` and
// upserts on the table's primary key so repeated scans/pipeline runs are safe.

export interface StockRow {
  symbol: string;
  name: string | null;
  sector: string | null;
}

export interface DailyPriceRow {
  symbol: string;
  date: string; // ISO date
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface RegimeStateRow {
  symbol: string;
  as_of: string;
  regime: string;
  confidence: number | null;
}

export interface MlPredictionRow {
  symbol: string;
  as_of: string;
  model_version: string;
  predicted_label: string;
  probability: number | null;
}

export interface ScanResultRow {
  symbol: string;
  as_of: string;
  status: string;
  score: number | null;
  regime: string | null;
  ml_label: string | null;
  ml_probability: number | null;
  recommendation: string | null;
}

export async function upsertStock(row: StockRow) {
  await query(
    `INSERT INTO stocks (symbol, name, sector)
     VALUES ($1, $2, $3)
     ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector`,
    [row.symbol, row.name, row.sector]
  );
}

export async function upsertScanResult(row: ScanResultRow) {
  await query(
    `INSERT INTO scan_results (symbol, as_of, status, score, regime, ml_label, ml_probability, recommendation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (symbol, as_of) DO UPDATE SET
       status = EXCLUDED.status,
       score = EXCLUDED.score,
       regime = EXCLUDED.regime,
       ml_label = EXCLUDED.ml_label,
       ml_probability = EXCLUDED.ml_probability,
       recommendation = EXCLUDED.recommendation`,
    [row.symbol, row.as_of, row.status, row.score, row.regime, row.ml_label, row.ml_probability, row.recommendation]
  );
}

export async function getLatestScanResults(limit = 500): Promise<ScanResultRow[]> {
  const res = await query(
    `SELECT DISTINCT ON (symbol) symbol, as_of, status, score, regime, ml_label, ml_probability, recommendation
     FROM scan_results
     ORDER BY symbol, as_of DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function getScanHistoryForSymbol(symbol: string, limitRows = 30): Promise<ScanResultRow[]> {
  const res = await query(
    `SELECT symbol, as_of, status, score, regime, ml_label, ml_probability, recommendation
     FROM scan_results
     WHERE symbol = $1
     ORDER BY as_of DESC
     LIMIT $2`,
    [symbol, limitRows]
  );
  return res.rows;
}

export async function upsertRegimeState(row: RegimeStateRow) {
  await query(
    `INSERT INTO regime_state (symbol, as_of, regime, confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (symbol, as_of) DO UPDATE SET regime = EXCLUDED.regime, confidence = EXCLUDED.confidence`,
    [row.symbol, row.as_of, row.regime, row.confidence]
  );
}

export async function getLatestRegimeState(symbol: string): Promise<RegimeStateRow | null> {
  const res = await query(
    `SELECT symbol, as_of, regime, confidence FROM regime_state WHERE symbol = $1 ORDER BY as_of DESC LIMIT 1`,
    [symbol]
  );
  return res.rows[0] || null;
}

export async function upsertMlPrediction(row: MlPredictionRow) {
  await query(
    `INSERT INTO ml_predictions (symbol, as_of, model_version, predicted_label, probability)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol, as_of, model_version) DO UPDATE SET
       predicted_label = EXCLUDED.predicted_label,
       probability = EXCLUDED.probability`,
    [row.symbol, row.as_of, row.model_version, row.predicted_label, row.probability]
  );
}

export async function getLatestMlPrediction(symbol: string): Promise<MlPredictionRow | null> {
  const res = await query(
    `SELECT symbol, as_of, model_version, predicted_label, probability
     FROM ml_predictions WHERE symbol = $1 ORDER BY as_of DESC LIMIT 1`,
    [symbol]
  );
  return res.rows[0] || null;
}

export async function upsertDailyPrice(row: DailyPriceRow) {
  await query(
    `INSERT INTO daily_prices (symbol, date, open, high, low, close, volume)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (symbol, date) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume`,
    [row.symbol, row.date, row.open, row.high, row.low, row.close, row.volume]
  );
}

export async function getDailyPrices(symbol: string, limitRows = 200): Promise<DailyPriceRow[]> {
  const res = await query(
    `SELECT symbol, date, open, high, low, close, volume FROM daily_prices
     WHERE symbol = $1 ORDER BY date DESC LIMIT $2`,
    [symbol, limitRows]
  );
  return res.rows;
}

export default pool;
