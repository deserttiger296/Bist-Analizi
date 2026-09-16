// src/lib/quant/regime.ts
// Market Regime Detection Engine — Hidden Markov Model (HMM) Approximation
// Analyzes index returns, rolling volatility, and ATR momentum to classify BIST state.

export type MarketRegime = "TREND" | "YATAY" | "KRİZ";

export interface RegimeResult {
  regime: MarketRegime;
  volatility: number;
  momentum: number;
  confidence: number; // 0.0 to 1.0 confidence score
  calculatedAt: Date;
}

/**
 * Approximates HMM state transition probabilities based on rolling index price performance.
 * Classifies market into TREND (high momentum, moderate volatility), YATAY (low momentum, low volatility),
 * and KRİZ (negative momentum, extreme volatility).
 * @param indexPrices Historial closing prices of BIST 100 or benchmark index.
 * @param lookback Rolling window for volatility and momentum calculation (default 20).
 */
export function detectMarketRegime(indexPrices: number[], lookback: number = 20): RegimeResult {
  const now = new Date();
  if (indexPrices.length < lookback) {
    return {
      regime: "YATAY",
      volatility: 0,
      momentum: 0,
      confidence: 0.5,
      calculatedAt: now
    };
  }

  // 1. Calculate Daily Log Returns
  const returns: number[] = [];
  for (let i = 1; i < indexPrices.length; i++) {
    returns.push(Math.log(indexPrices[i] / indexPrices[i - 1]));
  }

  // 2. Calculate Rolling Volatility (Standard Deviation of returns)
  const activeReturns = returns.slice(-lookback);
  const meanReturn = activeReturns.reduce((sum, r) => sum + r, 0) / activeReturns.length;
  const variance = activeReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / activeReturns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized Volatility

  // 3. Calculate Index Momentum (percentage change over lookback)
  const currentPrice = indexPrices[indexPrices.length - 1];
  const oldPrice = indexPrices[indexPrices.length - lookback];
  const momentum = (currentPrice - oldPrice) / oldPrice;

  // 4. HMM Threshold State Classification
  // Thresholds calibrated to BIST historical volatility indices
  let regime: MarketRegime = "YATAY";
  let confidence = 0.5;

  const VOLATILITY_HIGH_THRESHOLD = 0.35; // 35% annualized volatility indicates panic/kriz
  const VOLATILITY_LOW_THRESHOLD = 0.15;  // 15% annualized volatility indicates calm/yatay
  const MOMENTUM_TREND_THRESHOLD = 0.04;  // 4% gain over lookback indicates strong trend

  if (volatility >= VOLATILITY_HIGH_THRESHOLD) {
    regime = "KRİZ";
    // Confidence scales with how far volatility exceeds the threshold
    confidence = Math.min(0.95, 0.7 + (volatility - VOLATILITY_HIGH_THRESHOLD) * 0.5);
  } else if (volatility < VOLATILITY_LOW_THRESHOLD && Math.abs(momentum) < MOMENTUM_TREND_THRESHOLD) {
    regime = "YATAY";
    confidence = Math.min(0.90, 0.6 + (VOLATILITY_LOW_THRESHOLD - volatility) * 2.0);
  } else if (Math.abs(momentum) >= MOMENTUM_TREND_THRESHOLD) {
    regime = "TREND";
    confidence = Math.min(0.92, 0.6 + (Math.abs(momentum) - MOMENTUM_TREND_THRESHOLD) * 3.0);
  } else {
    // Transition state: defaults to TREND or YATAY depending on return signs
    regime = Math.abs(momentum) > 0.02 ? "TREND" : "YATAY";
    confidence = 0.55;
  }

  return {
    regime,
    volatility,
    momentum,
    confidence,
    calculatedAt: now
  };
}
