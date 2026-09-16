import pool from '../db';
import { HistoricalBar } from './historicalDataIngestion';
import {
  ema, sma, rsi, macd, chaikinMoneyFlow, bollingerBands, supertrend, atr
} from '../indicators';

export interface IndicatorBacktestConfig {
  name: string;
  category: 'trend' | 'momentum' | 'volume' | 'structure';
  // Given all historical bars, return an array of booleans indicating if the signal was ACTIVE on that day
  signalFn: (bars: HistoricalBar[]) => boolean[];
  holdPeriod: number; // T+N days forward return
}

export interface BacktestMetrics {
  indicatorName: string;
  category: string;
  symbol: string | null;
  windowStart: Date;
  windowEnd: Date;
  totalSignals: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  avgReturn: number;
  sharpeRatio: number | null;
  isValid: boolean;
}

/**
 * Common Indicator Configurations mapped exactly to ConfluenceEngine logic
 */
export const BACKTEST_INDICATORS: IndicatorBacktestConfig[] = [
  {
    name: 'emaCross',
    category: 'trend',
    holdPeriod: 5,
    signalFn: (bars) => {
      const closes = bars.map(b => b.close);
      const ema5 = ema(closes, 5);
      const ema21 = ema(closes, 21);
      return closes.map((_, i) => i > 0 && ema5[i] > ema21[i] && ema5[i-1] <= ema21[i-1]);
    }
  },
  {
    name: 'priceAboveEma20',
    category: 'trend',
    holdPeriod: 5,
    signalFn: (bars) => {
      const closes = bars.map(b => b.close);
      const ema20 = ema(closes, 20);
      return closes.map((c, i) => c > ema20[i]);
    }
  },
  {
    name: 'macdHistogram',
    category: 'momentum',
    holdPeriod: 5,
    signalFn: (bars) => {
      const closes = bars.map(b => b.close);
      const { histogram } = macd(closes);
      return closes.map((_, i) => histogram[i] > 0);
    }
  },
  {
    name: 'rsiBullishZone',
    category: 'momentum',
    holdPeriod: 5,
    signalFn: (bars) => {
      const closes = bars.map(b => b.close);
      const rsi14 = rsi(closes, 14);
      return closes.map((_, i) => rsi14[i] >= 40 && rsi14[i] <= 70);
    }
  },
  {
    name: 'cmfPositive',
    category: 'volume',
    holdPeriod: 5,
    signalFn: (bars) => {
      const h = bars.map(b => b.high);
      const l = bars.map(b => b.low);
      const c = bars.map(b => b.close);
      const v = bars.map(b => b.volume);
      const cmf = chaikinMoneyFlow(h, l, c, v, 20);
      return bars.map((_, i) => cmf[i] > 0);
    }
  },
  {
    name: 'supertrendUp',
    category: 'structure',
    holdPeriod: 5,
    signalFn: (bars) => {
      const h = bars.map(b => b.high);
      const l = bars.map(b => b.low);
      const c = bars.map(b => b.close);
      const atrVals = atr(h, l, c, 14);
      const { trend } = supertrend(c, atrVals, 3);
      return bars.map((_, i) => trend[i] === 'UP');
    }
  },
  {
    name: 'bollingerSqueeze',
    category: 'structure',
    holdPeriod: 5,
    signalFn: (bars) => {
      const c = bars.map(b => b.close);
      const { upper, lower } = bollingerBands(c, 20, 2);
      const bbWidths = upper.map((u, i) => (u - lower[i]) / c[i]);
      const avgBbWidth = sma(bbWidths.map(w => isNaN(w) ? 0 : w), 20);
      return bars.map((_, i) => bbWidths[i] < avgBbWidth[i] * 0.8);
    }
  }
];

/**
 * Measure the forward performance of generated signals
 */
export function measureSignalPerformance(bars: HistoricalBar[], signals: boolean[], holdPeriod: number) {
  let totalSignals = 0;
  let winCount = 0;
  let lossCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalReturn = 0;
  let maxDrawdown = 0;

  for (let i = 0; i < bars.length - holdPeriod; i++) {
    if (signals[i]) {
      totalSignals++;
      const entryPrice = bars[i].close;
      const exitPrice = bars[i + holdPeriod].close;
      const ret = (exitPrice - entryPrice) / entryPrice;
      
      // Calculate local drawdown during hold period
      let lowestDuringHold = entryPrice;
      for (let j = i + 1; j <= i + holdPeriod; j++) {
        if (bars[j].low < lowestDuringHold) {
          lowestDuringHold = bars[j].low;
        }
      }
      const localDrawdown = (entryPrice - lowestDuringHold) / entryPrice;
      if (localDrawdown > maxDrawdown) maxDrawdown = localDrawdown;

      totalReturn += ret;

      if (ret > 0) {
        winCount++;
        grossProfit += ret;
      } else {
        lossCount++;
        grossLoss += Math.abs(ret);
      }
    }
  }

  const winRate = totalSignals > 0 ? (winCount / totalSignals) * 100 : 0;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99 : 0);
  const avgReturn = totalSignals > 0 ? (totalReturn / totalSignals) * 100 : 0;
  // A signal is "valid" if winRate > 55% or it has a very high profit factor
  const isValid = totalSignals >= 5 && (winRate >= 55 || (winRate >= 50 && profitFactor > 1.5));

  return {
    totalSignals,
    winCount,
    lossCount,
    winRate,
    profitFactor,
    maxDrawdown: maxDrawdown * 100,
    avgReturn,
    sharpeRatio: null, // Simplified for now
    isValid
  };
}

/**
 * Run a backtest for a single indicator over a given historical dataset
 */
export function runPerIndicatorBacktest(symbol: string, bars: HistoricalBar[], config: IndicatorBacktestConfig): BacktestMetrics {
  if (bars.length < 50) {
    return {
      indicatorName: config.name, category: config.category, symbol,
      windowStart: new Date(), windowEnd: new Date(),
      totalSignals: 0, winCount: 0, lossCount: 0, winRate: 0, profitFactor: 0,
      maxDrawdown: 0, avgReturn: 0, sharpeRatio: null, isValid: false
    };
  }

  const signals = config.signalFn(bars);
  const perf = measureSignalPerformance(bars, signals, config.holdPeriod);

  return {
    indicatorName: config.name,
    category: config.category,
    symbol,
    windowStart: bars[0].date,
    windowEnd: bars[bars.length - 1].date,
    ...perf
  };
}

/**
 * Save backtest results to PostgreSQL
 */
export async function saveBacktestResults(results: BacktestMetrics[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Ensure table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "BacktestResult" (
        "id" SERIAL PRIMARY KEY,
        "indicatorName" VARCHAR(100) NOT NULL,
        "category" VARCHAR(50) NOT NULL,
        "symbol" VARCHAR(50),
        "windowStart" DATE NOT NULL,
        "windowEnd" DATE NOT NULL,
        "totalSignals" INTEGER NOT NULL,
        "winCount" INTEGER NOT NULL,
        "lossCount" INTEGER NOT NULL,
        "winRate" DOUBLE PRECISION NOT NULL,
        "profitFactor" DOUBLE PRECISION NOT NULL,
        "maxDrawdown" DOUBLE PRECISION NOT NULL,
        "avgReturn" DOUBLE PRECISION NOT NULL,
        "sharpeRatio" DOUBLE PRECISION,
        "isValid" BOOLEAN NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insertQuery = `
      INSERT INTO "BacktestResult" (
        "indicatorName", "category", "symbol", "windowStart", "windowEnd",
        "totalSignals", "winCount", "lossCount", "winRate", "profitFactor",
        "maxDrawdown", "avgReturn", "sharpeRatio", "isValid"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;

    for (const r of results) {
      await client.query(insertQuery, [
        r.indicatorName, r.category, r.symbol,
        r.windowStart.toISOString().split('T')[0],
        r.windowEnd.toISOString().split('T')[0],
        r.totalSignals, r.winCount, r.lossCount, r.winRate,
        r.profitFactor, r.maxDrawdown, r.avgReturn, r.sharpeRatio, r.isValid
      ]);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
