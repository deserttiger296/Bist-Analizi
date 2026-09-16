// yahooFinanceClass is unused in favor of fetchYahooRaw
import pool from '../db';
import { fetchBiQuoteOhlc } from '../biquote';
import { fetchYahooRaw } from '../bist';

export interface HistoricalBar {
  symbol: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

/**
 * Ensures the table exists (useful if Firebase Data Connect migration hasn't run yet)
 */
async function ensureTableExists() {
  const query = `
    CREATE TABLE IF NOT EXISTS "HistoricalKLine" (
      "symbol" VARCHAR(50) NOT NULL,
      "date" DATE NOT NULL,
      "open" DOUBLE PRECISION NOT NULL,
      "high" DOUBLE PRECISION NOT NULL,
      "low" DOUBLE PRECISION NOT NULL,
      "close" DOUBLE PRECISION NOT NULL,
      "volume" DOUBLE PRECISION NOT NULL,
      "adjClose" DOUBLE PRECISION,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("symbol", "date")
    );
  `;
  await pool.query(query);
}

/**
 * Fetch historical data using Yahoo Finance (primary) or BiQuote (fallback)
 */
export async function fetchHistoricalData(symbol: string, days: number = 252): Promise<HistoricalBar[]> {
  const isIndex = symbol === 'XU100';
  const yahooSymbol = isIndex ? 'XU100' : symbol;
  
  let range = '1y';
  if (days <= 5) range = '5d';
  else if (days <= 30) range = '1mo';
  else if (days <= 90) range = '3mo';
  else if (days <= 180) range = '6mo';
  else if (days <= 365) range = '1y';
  else if (days <= 730) range = '2y';
  else range = '5y';

  try {
    const result = await fetchYahooRaw(yahooSymbol, '1d', range);
    if (result && result.length > 0) {
      return result.map((bar: any) => ({
        symbol,
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        adjClose: bar.close
      }));
    }
  } catch (err: any) {
    console.warn(`Yahoo Finance raw fetch failed for ${symbol}: ${err.message}. Falling back to BiQuote...`);
  }

  // Fallback to BiQuote
  try {
    // BiQuote doesn't directly support 1-year history easily in a single generic call without specific params or it might limit to 100 bars.
    // Let's try 1d interval.
    const biquoteSymbol = isIndex ? 'XU100' : symbol;
    const result = await fetchBiQuoteOhlc(biquoteSymbol, '1d');
    
    if (result && result.bars && result.bars.length > 0) {
      // BiQuote dates are ISO strings
      return result.bars.map(bar => ({
        symbol,
        date: new Date(bar.openTime),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        adjClose: bar.close // BiQuote doesn't provide adjClose
      }));
    }
  } catch (err: any) {
    console.error(`BiQuote fallback failed for ${symbol}: ${err.message}`);
  }

  return [];
}

/**
 * Insert or Update bars in PostgreSQL
 */
export async function ingestHistoricalData(symbol: string, days: number = 252): Promise<number> {
  await ensureTableExists();
  
  const bars = await fetchHistoricalData(symbol, days);
  if (bars.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const insertQuery = `
      INSERT INTO "HistoricalKLine" (symbol, date, open, high, low, close, volume, "adjClose")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (symbol, date) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        "adjClose" = EXCLUDED."adjClose"
    `;

    for (const bar of bars) {
      await client.query(insertQuery, [
        bar.symbol,
        bar.date.toISOString().split('T')[0], // Cast to YYYY-MM-DD
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.adjClose
      ]);
    }

    await client.query('COMMIT');
    return bars.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Bulk ingest multiple symbols (sequential to respect rate limits)
 */
export async function ingestBulkHistorical(symbols: string[], days: number = 252) {
  const results: Record<string, number> = {};
  for (const symbol of symbols) {
    try {
      const count = await ingestHistoricalData(symbol, days);
      results[symbol] = count;
      // Sleep slightly to avoid API rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e: any) {
      console.error(`Failed to ingest ${symbol}:`, e);
      results[symbol] = -1;
    }
  }
  return results;
}

export async function ingestXU100Historical(days: number = 252) {
  return await ingestHistoricalData('XU100', days);
}

/**
 * Retrieve historical bars from DB
 */
export async function getHistoricalKLinesFromDB(symbol: string, startDate?: Date, endDate?: Date): Promise<HistoricalBar[]> {
  await ensureTableExists();
  
  let queryStr = `SELECT * FROM "HistoricalKLine" WHERE symbol = $1`;
  const params: any[] = [symbol];
  let paramIdx = 2;

  if (startDate) {
    queryStr += ` AND date >= $${paramIdx++}`;
    params.push(startDate.toISOString().split('T')[0]);
  }
  
  if (endDate) {
    queryStr += ` AND date <= $${paramIdx++}`;
    params.push(endDate.toISOString().split('T')[0]);
  }
  
  queryStr += ` ORDER BY date ASC`;
  
  const result = await pool.query(queryStr, params);
  return result.rows.map(r => ({
    symbol: r.symbol,
    date: r.date,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    adjClose: Number(r.adjClose)
  }));
}
