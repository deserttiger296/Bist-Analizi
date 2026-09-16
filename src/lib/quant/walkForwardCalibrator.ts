import pool from '../db';
import { HistoricalBar } from './historicalDataIngestion';
import { BACKTEST_INDICATORS, IndicatorBacktestConfig } from './backtestEngine';

export interface WalkForwardConfig {
  trainWindowDays: number;
  validationWindowDays: number;
  slideStepDays: number;
  minWinRate: number;
}

export interface CategoryWeights {
  trend: Record<string, number>;
  momentum: Record<string, number>;
  volume: Record<string, number>;
  structure: Record<string, number>;
}

export interface CalibrationResult {
  iterationId: string;
  trainPeriod: { start: Date; end: Date };
  valPeriod: { start: Date; end: Date };
  optimizedWeightsJson: string;
  trainWinRate: number;
  valWinRate: number;
  pearsonT5: number;
  pearsonT10: number;
  pearsonT20: number;
  isDeployable: boolean;
  isDeployed?: boolean;
}

function mean(arr: number[]) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  const n = x.length;
  const xMean = mean(x);
  const yMean = mean(y);
  
  let num = 0;
  let denX = 0;
  let denY = 0;
  
  for (let i = 0; i < n; i++) {
    const xDiff = x[i] - xMean;
    const yDiff = y[i] - yMean;
    num += xDiff * yDiff;
    denX += xDiff * xDiff;
    denY += yDiff * yDiff;
  }
  
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * Computes forward log returns
 */
function getForwardLogReturn(bars: HistoricalBar[], index: number, horizon: number): number {
  if (index + horizon >= bars.length) return 0; // Not enough forward data
  const p0 = bars[index].close;
  const p1 = bars[index + horizon].close;
  if (p0 <= 0 || p1 <= 0) return 0;
  return Math.log(p1 / p0);
}

/**
 * Optimizes weights based on the Pearson correlation between an indicator's active state and the forward log return.
 * If correlation is strongly positive, we increase its weight. If negative, we decrease it.
 */
export function optimizeWeights(
  bars: HistoricalBar[],
  baseWeights: CategoryWeights,
  indicators: IndicatorBacktestConfig[] = BACKTEST_INDICATORS
): { newWeights: CategoryWeights, correlations: Record<string, number> } {
  
  const correlations: Record<string, number> = {};
  
  // Clone base weights
  const newWeights: CategoryWeights = JSON.parse(JSON.stringify(baseWeights));

  for (const config of indicators) {
    const signals = config.signalFn(bars);
    
    const xActive = [];
    const yRetT5 = [];
    
    for (let i = 0; i < bars.length - 5; i++) {
      // 1 if active, 0 if inactive
      xActive.push(signals[i] ? 1 : 0);
      yRetT5.push(getForwardLogReturn(bars, i, 5));
    }
    
    const corr = pearsonCorrelation(xActive, yRetT5);
    correlations[config.name] = corr;
    
    // Adjust weight
    if (newWeights[config.category][config.name] !== undefined) {
      let currentWeight = newWeights[config.category][config.name];
      // Basic rule: 
      // If corr > 0.15, increase weight by 20%
      // If corr < -0.05, decrease weight by 20%
      if (corr > 0.15) {
        currentWeight = Math.round(currentWeight * 1.2);
      } else if (corr < -0.05) {
        currentWeight = Math.round(currentWeight * 0.8);
      }
      newWeights[config.category][config.name] = Math.max(0, currentWeight);
    }
  }

  return { newWeights, correlations };
}

/**
 * Validates a given set of weights over a validation period
 */
export function validateWeights(bars: HistoricalBar[], weights: CategoryWeights, indicators: IndicatorBacktestConfig[] = BACKTEST_INDICATORS) {
  let winCount = 0;
  let totalSignals = 0;
  
  const xScore = [];
  const yRetT5 = [];
  const yRetT10 = [];
  const yRetT20 = [];

  // Compute total max possible score theoretically (simplified for testing)
  let maxWeight = 0;
  for (const cat of Object.values(weights)) {
    for (const w of Object.values(cat as Record<string, number>)) maxWeight += w;
  }
  if (maxWeight === 0) maxWeight = 1;

  // Precompute signals
  const allSignals = indicators.map(ind => ({
    name: ind.name,
    category: ind.category,
    activeArr: ind.signalFn(bars)
  }));

  for (let i = 0; i < bars.length - 20; i++) {
    let currentScore = 0;
    
    for (const ind of allSignals) {
      if (ind.activeArr[i] && weights[ind.category as keyof CategoryWeights][ind.name]) {
        currentScore += weights[ind.category as keyof CategoryWeights][ind.name];
      }
    }
    
    const normalizedScore = (currentScore / maxWeight) * 100;
    
    // Simulating "AL" signal threshold (e.g., score > 60)
    if (normalizedScore > 60) {
      totalSignals++;
      const ret5 = getForwardLogReturn(bars, i, 5);
      if (ret5 > 0) winCount++;
      
      xScore.push(normalizedScore);
      yRetT5.push(ret5);
      yRetT10.push(getForwardLogReturn(bars, i, 10));
      yRetT20.push(getForwardLogReturn(bars, i, 20));
    }
  }

  const winRate = totalSignals > 0 ? (winCount / totalSignals) * 100 : 0;
  
  return {
    winRate,
    pearsonT5: pearsonCorrelation(xScore, yRetT5),
    pearsonT10: pearsonCorrelation(xScore, yRetT10),
    pearsonT20: pearsonCorrelation(xScore, yRetT20),
  };
}

/**
 * Runs the Walk-Forward Analysis iteration
 */
export async function runWalkForwardAnalysis(
  bars: HistoricalBar[],
  baseWeights: CategoryWeights,
  config: WalkForwardConfig
): Promise<CalibrationResult[]> {
  const results: CalibrationResult[] = [];
  
  // Need minimum bars for train + val
  const totalRequired = config.trainWindowDays + config.validationWindowDays;
  if (bars.length < totalRequired) return results;

  let currentStart = 0;
  
  while (currentStart + totalRequired <= bars.length) {
    const trainEnd = currentStart + config.trainWindowDays;
    const valEnd = trainEnd + config.validationWindowDays;
    
    const trainBars = bars.slice(currentStart, trainEnd);
    const valBars = bars.slice(trainEnd, valEnd);
    
    // 1. Optimize on train data
    const { newWeights } = optimizeWeights(trainBars, baseWeights);
    
    // Train performance just to see what it achieved on in-sample data
    const trainPerf = validateWeights(trainBars, newWeights);
    
    // 2. Validate on holdout data
    const valPerf = validateWeights(valBars, newWeights);
    
    const iterationId = `wf_${trainBars[0].date.toISOString().split('T')[0]}_${valBars[valBars.length-1].date.toISOString().split('T')[0]}`;
    
    results.push({
      iterationId,
      trainPeriod: { start: trainBars[0].date, end: trainBars[trainBars.length - 1].date },
      valPeriod: { start: valBars[0].date, end: valBars[valBars.length - 1].date },
      optimizedWeightsJson: JSON.stringify(newWeights),
      trainWinRate: trainPerf.winRate,
      valWinRate: valPerf.winRate,
      pearsonT5: valPerf.pearsonT5,
      pearsonT10: valPerf.pearsonT10,
      pearsonT20: valPerf.pearsonT20,
      isDeployable: valPerf.winRate >= config.minWinRate
    });
    
    currentStart += config.slideStepDays;
  }
  
  return results;
}

export async function saveCalibrationIterations(iterations: CalibrationResult[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "CalibrationIteration" (
        "id" SERIAL PRIMARY KEY,
        "iterationId" VARCHAR(100) NOT NULL UNIQUE,
        "trainStart" DATE NOT NULL,
        "trainEnd" DATE NOT NULL,
        "valStart" DATE NOT NULL,
        "valEnd" DATE NOT NULL,
        "weightsJson" TEXT NOT NULL,
        "trainWinRate" DOUBLE PRECISION NOT NULL,
        "valWinRate" DOUBLE PRECISION NOT NULL,
        "pearsonT5" DOUBLE PRECISION,
        "pearsonT10" DOUBLE PRECISION,
        "pearsonT20" DOUBLE PRECISION,
        "isDeployed" BOOLEAN NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insertQuery = `
      INSERT INTO "CalibrationIteration" (
        "iterationId", "trainStart", "trainEnd", "valStart", "valEnd",
        "weightsJson", "trainWinRate", "valWinRate", "pearsonT5", "pearsonT10", "pearsonT20", "isDeployed"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT ("iterationId") DO NOTHING
    `;

    for (const iter of iterations) {
      await client.query(insertQuery, [
        iter.iterationId,
        iter.trainPeriod.start.toISOString().split('T')[0],
        iter.trainPeriod.end.toISOString().split('T')[0],
        iter.valPeriod.start.toISOString().split('T')[0],
        iter.valPeriod.end.toISOString().split('T')[0],
        iter.optimizedWeightsJson,
        iter.trainWinRate,
        iter.valWinRate,
        iter.pearsonT5,
        iter.pearsonT10,
        iter.pearsonT20,
        iter.isDeployable
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
