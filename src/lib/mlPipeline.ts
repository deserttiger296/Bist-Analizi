// src/lib/mlPipeline.ts
// ML Pipeline — historical scan data (from local Postgres) used for pattern
// recognition / prediction context. Previously read from Firestore
// (alarm_history / scan_results collections + Firebase Admin SDK); now reads
// the equivalent local `scan_results` / `ml_predictions` tables via src/lib/db.ts.

import { getScanHistoryForSymbol, upsertMlPrediction, query } from "@/lib/db";

// ─── Historical Data Fetcher ─────────────────────────────────────────────
export async function fetchHistoricalScans(
  symbol: string,
  days = 30
): Promise<any[]> {
  try {
    const rows = await getScanHistoryForSymbol(symbol, days);
    return rows;
  } catch (err) {
    console.error(`[MLPipeline] Error fetching historical scans for ${symbol}:`, err);
    return [];
  }
}

// ─── ML Context Builder ─────────────────────────────────────────────────
export interface MLContext {
  symbol: string;
  currentData: any;
  historicalScans: any[];
  trendDirection: "UP" | "DOWN" | "SIDEWAYS";
  avgScore: number;
  scoreVolatility: number;
  fakeoutFrequency: number;
  alertFrequency: number;
}

export function buildMLContext(
  symbol: string,
  currentData: any,
  historicalScans: any[]
): MLContext {
  const scores = historicalScans
    .map(s => s.confluenceScore || s.score || 0)
    .filter(s => s > 0);

  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  // Score volatility (standard deviation)
  const variance = scores.length > 1
    ? scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length
    : 0;
  const scoreVolatility = Math.sqrt(variance);

  // Trend direction based on score trajectory
  let trendDirection: "UP" | "DOWN" | "SIDEWAYS" = "SIDEWAYS";
  if (scores.length >= 5) {
    const recent = scores.slice(0, 5);
    const older = scores.slice(5, 10);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.length > 0
      ? older.reduce((a, b) => a + b, 0) / older.length
      : recentAvg;

    if (recentAvg > olderAvg * 1.1) trendDirection = "UP";
    else if (recentAvg < olderAvg * 0.9) trendDirection = "DOWN";
  }

  // Fakeout frequency
  const fakeoutCount = historicalScans.filter(s =>
    s.isFakeout || s.status === "TUZAK"
  ).length;
  const fakeoutFrequency = historicalScans.length > 0
    ? (fakeoutCount / historicalScans.length) * 100
    : 0;

  // Alert frequency
  const alertCount = historicalScans.filter(s => s.alert).length;
  const alertFrequency = historicalScans.length > 0
    ? (alertCount / historicalScans.length) * 100
    : 0;

  return {
    symbol,
    currentData,
    historicalScans,
    trendDirection,
    avgScore,
    scoreVolatility,
    fakeoutFrequency,
    alertFrequency,
  };
}

// ─── Prediction Persistence ───────────────────────────────────────────────
export interface PredictionRecord {
  symbol: string;
  predictedAt: Date;
  prediction: "UP" | "DOWN" | "SIDEWAYS";
  confidence: number;
  priceAtPrediction: number;
  priceAfter5Days?: number;
  wasCorrect?: boolean;
}

export async function savePrediction(record: PredictionRecord): Promise<void> {
  try {
    await upsertMlPrediction({
      symbol: record.symbol,
      as_of: record.predictedAt.toISOString().split("T")[0],
      model_version: "ts-heuristic-v1",
      predicted_label: record.prediction,
      probability: record.confidence,
    });
  } catch (err) {
    console.error("[MLPipeline] Error saving prediction:", err);
  }
}

// NOTE: the simplified `ml_predictions` schema (db/schema.sql) does not carry
// a `wasCorrect` / outcome column the way the old Firestore document did, so
// there's no stored ground-truth to grade predictions against yet. This is a
// placeholder until outcome tracking is added to the local pipeline; it does
// not throw and preserves the previous return shape for API compatibility.
export async function evaluatePastPredictions(): Promise<{
  total: number;
  correct: number;
  accuracy: number;
}> {
  try {
    const res = await query(`SELECT COUNT(*)::int AS total FROM ml_predictions`);
    return { total: res.rows[0]?.total ?? 0, correct: 0, accuracy: 0 };
  } catch (err) {
    console.error("[MLPipeline] Error evaluating predictions:", err);
    return { total: 0, correct: 0, accuracy: 0 };
  }
}

// ─── Score Trend Analysis ────────────────────────────────────────────────
export function analyzeScoreTrend(scores: number[]): {
  trend: "IMPROVING" | "DECLINING" | "STABLE";
  momentum: number;
  movingAvg5: number;
  movingAvg10: number;
} {
  if (scores.length < 3) {
    return { trend: "STABLE", momentum: 0, movingAvg5: 0, movingAvg10: 0 };
  }

  const ma5 = scores.length >= 5
    ? scores.slice(0, 5).reduce((a, b) => a + b, 0) / 5
    : scores.reduce((a, b) => a + b, 0) / scores.length;

  const ma10 = scores.length >= 10
    ? scores.slice(0, 10).reduce((a, b) => a + b, 0) / 10
    : ma5;

  const momentum = ma5 - ma10;

  let trend: "IMPROVING" | "DECLINING" | "STABLE" = "STABLE";
  if (momentum > 5) trend = "IMPROVING";
  else if (momentum < -5) trend = "DECLINING";

  return { trend, momentum, movingAvg5: ma5, movingAvg10: ma10 };
}

// ─── Batch ML Analysis ──────────────────────────────────────────────────
export async function batchAnalyzeSymbols(symbols: string[]): Promise<Map<string, MLContext>> {
  const results = new Map<string, MLContext>();

  for (const symbol of symbols) {
    try {
      const historical = await fetchHistoricalScans(symbol, 30);
      // We don't have currentData here, so just build a partial context
      const context = buildMLContext(symbol, {}, historical);
      results.set(symbol, context);
    } catch (err) {
      console.error(`[MLPipeline] Error analyzing ${symbol}:`, err);
    }
  }

  return results;
}

// ─── Purged K-Fold Cross-Validation (Lopez de Prado Method) ───────────────
export interface SplitResult {
  trainSet: any[];
  testSet: any[];
}

/**
 * Splits financial time series data into purged train and test sets.
 * Removes training points that overlap with test points to prevent look-ahead bias/leakage.
 * @param data Historical records containing 'createdAt' or 'syncedAt'.
 * @param testRatio Percentage of data reserved for testing (default 20%).
 * @param eventLengthDays Duration of holding period (default 5 days).
 */
export function purgeAndEmbargoSplit(
  data: any[],
  testRatio: number = 0.2,
  eventLengthDays: number = 5
): SplitResult {
  if (data.length < 10) return { trainSet: data, testSet: [] };

  // Sort data chronologically (oldest first)
  const sortedData = [...data].sort((a, b) => {
    const timeA = new Date(a.createdAt || a.syncedAt || a.as_of || 0).getTime();
    const timeB = new Date(b.createdAt || b.syncedAt || b.as_of || 0).getTime();
    return timeA - timeB;
  });

  const testSize = Math.floor(sortedData.length * testRatio);
  const testStartIndex = sortedData.length - testSize;

  const testSet = sortedData.slice(testStartIndex);
  const rawTrainSet = sortedData.slice(0, testStartIndex);

  // Time boundaries of the test set
  const testStartTime = new Date(testSet[0].createdAt || testSet[0].syncedAt || testSet[0].as_of).getTime();

  // Purging: Remove any training events that overlap into the test set's start time
  // Embargo: Add a safety window (eventLengthDays) after the training period to prevent auto-correlation leakage
  const purgingWindowMs = eventLengthDays * 24 * 60 * 60 * 1000;
  const cutoffTime = testStartTime - purgingWindowMs;

  const trainSet = rawTrainSet.filter(item => {
    const itemTime = new Date(item.createdAt || item.syncedAt || item.as_of).getTime();
    // Keep only training samples that ended BEFORE the test window minus the embargo buffer
    return itemTime < cutoffTime;
  });

  return { trainSet, testSet };
}
