// src/lib/quant/pairs.ts
// Pairs Trading Engine — Engle-Granger Cointegration & Dynamic Spread Z-Score
// Tracks relative values between correlated assets (e.g., AKBNK/GARAN) and adapts thresholds to market regimes.

export interface PairScanResult {
  assetA: string;
  assetB: string;
  hedgeRatio: number;
  correlation: number;
  currentSpread: number;
  zScore: number;
  signal: "BUY_A_SELL_B" | "SELL_A_BUY_B" | "LIQUIDATE" | "NEUTRAL";
}

/**
 * Calculates the Pearson correlation coefficient between two time series.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    num += diffX * diffY;
    denX += diffX * diffX;
    denY += diffY * diffY;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * Performs simple linear regression to estimate the hedge ratio (slope).
 * Price_A = hedgeRatio * Price_B + intercept
 */
export function estimateHedgeRatio(pricesA: number[], pricesB: number[]): { hedgeRatio: number; intercept: number } {
  const n = Math.min(pricesA.length, pricesB.length);
  if (n === 0) return { hedgeRatio: 1, intercept: 0 };

  const meanA = pricesA.reduce((a, b) => a + b, 0) / n;
  const meanB = pricesB.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;

  for (let i = 0; i < n; i++) {
    num += (pricesB[i] - meanB) * (pricesA[i] - meanA);
    den += Math.pow(pricesB[i] - meanB, 2);
  }

  const hedgeRatio = den !== 0 ? num / den : 1;
  const intercept = meanA - hedgeRatio * meanB;

  return { hedgeRatio, intercept };
}

/**
 * Calculates the rolling spread and standardizes it into a Z-score.
 * Spread = Price_A - (hedgeRatio * Price_B + intercept)
 */
export function calculateSpreadZScore(
  seriesA: number[],
  seriesB: number[],
  hedgeRatio: number,
  intercept: number,
  lookback: number = 20
): { spread: number; zScore: number } {
  const spreads: number[] = [];
  const n = Math.min(seriesA.length, seriesB.length);

  for (let i = 0; i < n; i++) {
    spreads.push(seriesA[i] - (hedgeRatio * seriesB[i] + intercept));
  }

  const currentSpread = spreads[spreads.length - 1] || 0;
  if (spreads.length < lookback) {
    return { spread: currentSpread, zScore: 0 };
  }

  const activeSpreads = spreads.slice(-lookback);
  const mean = activeSpreads.reduce((sum, val) => sum + val, 0) / lookback;
  const variance = activeSpreads.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lookback;
  const stdDev = Math.sqrt(variance);

  const zScore = stdDev !== 0 ? (currentSpread - mean) / stdDev : 0;
  return { spread: currentSpread, zScore };
}

/**
 * Evaluates pairs trading signals based on the spread Z-score, adapted to the HMM market regime.
 * @param zScore Current spread Z-score.
 * @param regime Current HMM market regime ("TREND", "YATAY", "KRİZ").
 */
export function generatePairsSignal(
  zScore: number,
  regime: "TREND" | "YATAY" | "KRİZ"
): "BUY_A_SELL_B" | "SELL_A_BUY_B" | "LIQUIDATE" | "NEUTRAL" {
  // Dynamic threshold scaling based on HMM regime
  // Yatay (Mean-Reverting) -> Lower entry threshold (faster entries)
  // Trend (Breakouts) -> High entry threshold (avoid getting run over by diverging pairs)
  // Kriz (High Volatility) -> Extreme entry thresholds (safety first)
  let entryThreshold = 2.0;
  let exitThreshold = 0.5;

  if (regime === "YATAY") {
    entryThreshold = 1.5; // Scale entry to 1.5 standard deviations
    exitThreshold = 0.2;
  } else if (regime === "TREND") {
    entryThreshold = 2.5; // Require 2.5 standard deviations due to trend divergence risk
    exitThreshold = 0.8;
  } else if (regime === "KRİZ") {
    entryThreshold = 3.0; // Extreme risk protection
    exitThreshold = 1.0;
  }

  if (zScore >= entryThreshold) {
    return "SELL_A_BUY_B"; // Spread is too wide; short Asset A, long Asset B
  } else if (zScore <= -entryThreshold) {
    return "BUY_A_SELL_B"; // Spread is too narrow; long Asset A, short Asset B
  } else if (Math.abs(zScore) <= exitThreshold) {
    return "LIQUIDATE"; // Spread reverted to mean; close all positions
  }

  return "NEUTRAL";
}
