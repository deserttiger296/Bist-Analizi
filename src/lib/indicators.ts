// src/lib/indicators.ts - Institutional Technical Analysis Engine (Optimized & Stable)
// This version merges indicators_fix.ts with missing institutional components

// ─────────────────────────────────────────────────────────────────────────────
// CORE AVERAGES
// ─────────────────────────────────────────────────────────────────────────────

export function sma(values: number[], length: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < length) {
      result.push(NaN);
      continue;
    }
    const window = values.slice(i + 1 - length, i + 1);
    result.push(window.reduce((sum, value) => sum + value, 0) / length);
  }
  return result;
}

export function ema(values: number[], length: number): number[] {
  const result: number[] = [];
  if (values.length === 0) return result;
  const k = 2 / (length + 1);
  let prev: number | null = null;
  for (const value of values) {
    if (prev === null) {
      prev = value;
      result.push(value);
      continue;
    }
    prev = value * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

export function wma(values: number[], length: number): number[] {
  const result: number[] = [];
  const weightSum = (length * (length + 1)) / 2;
  for (let i = 0; i < values.length; i++) {
    if (i < length - 1) {
      result.push(NaN);
      continue;
    }
    const window = values.slice(i - length + 1, i + 1);
    let sum = 0;
    for (let w = 0; w < length; w++) {
      sum += window[w] * (w + 1);
    }
    result.push(sum / weightSum);
  }
  return result;
}

export function hma(values: number[], length = 14): number[] {
  const halfLength = Math.floor(length / 2);
  const sqrtLength = Math.floor(Math.sqrt(length));
  const wmaHalf = wma(values, halfLength);
  const wmaFull = wma(values, length);
  const rawHma = [];
  for (let i = 0; i < values.length; i++) {
    if (isNaN(wmaHalf[i]) || isNaN(wmaFull[i])) {
      rawHma.push(NaN);
    } else {
      rawHma.push(wmaHalf[i] * 2 - wmaFull[i]);
    }
  }
  return wma(rawHma, sqrtLength);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOMENTUM INDICATORS
// ─────────────────────────────────────────────────────────────────────────────

export function rsi(values: number[], length = 14): number[] {
  if (values.length < length + 1) return values.map(() => NaN);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  const avgGain = ema(gains, length);
  const avgLoss = ema(losses, length);
  const result = [NaN];
  for (let i = 0; i < avgGain.length; i += 1) {
    if (i < length - 1 || avgLoss[i] === 0) {
      result.push(NaN);
      continue;
    }
    const rs = avgGain[i] / avgLoss[i];
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

export function linearTSI(values: number[], long = 25, short = 13, signalLength = 7) {
  const changes = values.map((value, index) => {
    if (index === 0) return 0;
    return value - values[index - 1];
  });
  const absChanges = changes.map((change) => Math.abs(change));
  const emaLong = ema(changes, long);
  const emaLongAbs = ema(absChanges, long);
  const emaShort = ema(emaLong, short);
  const emaShortAbs = ema(emaLongAbs, short);
  const tsi = emaShort.map((n, i) => {
    const denom = emaShortAbs[i];
    return denom === 0 ? 0 : (n / denom) * 100;
  });
  const signal = ema(tsi, signalLength);
  const histogram = tsi.map((value, i) => value - (signal[i] || 0));
  return { tsi, signal, histogram };
}

export function macd(values: number[], fastLength = 12, slowLength = 26, signalLength = 9) {
  const fastEma = ema(values, fastLength);
  const slowEma = ema(values, slowLength);
  const macdLine = fastEma.map((value, index) => value - (slowEma[index] || 0));
  const signal = ema(macdLine, signalLength);
  const histogram = macdLine.map((value, index) => value - (signal[index] || 0));
  return { macd: macdLine, signal, histogram };
}

export function stochastic(closes: number[], length = 14, smoothK = 3, smoothD = 3): { k: number[]; d: number[] } {
  const rawK: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < length - 1) { rawK.push(NaN); continue; }
    const window = closes.slice(i - length + 1, i + 1);
    const highest = Math.max(...window);
    const lowest = Math.min(...window);
    const range = highest - lowest;
    rawK.push(range === 0 ? 50 : ((closes[i] - lowest) / range) * 100);
  }
  const smoothedK = ema(rawK.filter(v => !isNaN(v)), smoothK);
  const paddedK = Array(rawK.length - smoothedK.length).fill(NaN).concat(smoothedK);
  const smoothedD = ema(smoothedK, smoothD);
  const paddedD = Array(rawK.length - smoothedD.length).fill(NaN).concat(smoothedD);
  return { k: paddedK, d: paddedD };
}

export function cci(closes: number[], length = 20): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < length - 1) { result.push(NaN); continue; }
    const window = closes.slice(i - length + 1, i + 1);
    const mean = window.reduce((s, v) => s + v, 0) / length;
    const meanDev = window.reduce((s, v) => s + Math.abs(v - mean), 0) / length;
    result.push(meanDev === 0 ? 0 : (closes[i] - mean) / (0.015 * meanDev));
  }
  return result;
}

export function williamsR(closes: number[], length = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < length - 1) { result.push(NaN); continue; }
    const window = closes.slice(i - length + 1, i + 1);
    const highest = Math.max(...window);
    const lowest = Math.min(...window);
    const range = highest - lowest;
    result.push(range === 0 ? -50 : ((highest - closes[i]) / range) * -100);
  }
  return result;
}

export function roc(closes: number[], length = 12): number[] {
  return closes.map((c, i) => {
    if (i < length) return NaN;
    const prev = closes[i - length];
    return prev === 0 ? 0 : ((c - prev) / prev) * 100;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VOLATILITY & TREND INDICATORS
// ─────────────────────────────────────────────────────────────────────────────

export function atr(highs: number[], lows: number[], closes: number[], length = 14): number[] {
  const trValues: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { trValues.push(highs[i] - lows[i]); continue; }
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trValues.push(Math.max(hl, hc, lc));
  }
  return ema(trValues, length);
}

export function atrFromCloses(closes: number[], length = 14): number[] {
  const trValues: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { trValues.push(0); continue; }
    trValues.push(Math.abs(closes[i] - closes[i - 1]));
  }
  return ema(trValues, length);
}

export function bollingerBands(values: number[], length = 20, stdDev = 2) {
  const smaValues = sma(values, length);
  const bands = smaValues.map((sma, index) => {
    if (isNaN(sma)) return { upper: NaN, lower: NaN };
    const window = values.slice(Math.max(0, index - length + 1), index + 1);
    const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
    const variance = window.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / window.length;
    const std = Math.sqrt(variance);
    return { upper: sma + stdDev * std, lower: sma - stdDev * std };
  });
  return { sma: smaValues, upper: bands.map(b => b.upper), lower: bands.map(b => b.lower) };
}

export function keltnerChannels(closes: number[], length = 20, multiplier = 2): { upper: number[]; lower: number[]; mid: number[] } {
  const mid = ema(closes, length);
  const atrVals = atrFromCloses(closes, length);
  const upper = mid.map((m, i) => m + multiplier * (atrVals[i] || 0));
  const lower = mid.map((m, i) => m - multiplier * (atrVals[i] || 0));
  return { upper, lower, mid };
}

export function supertrend(closes: number[], atrValues: number[], multiplier = 3): { upperBand: number[]; lowerBand: number[]; trend: ("UP" | "DOWN")[] } {
  const upperBand: number[] = [];
  const lowerBand: number[] = [];
  const trend: ("UP" | "DOWN")[] = [];
  for (let i = 0; i < closes.length; i++) {
    const hl2 = closes[i]; 
    const rawUpper = hl2 + multiplier * (atrValues[i] || 0);
    const rawLower = hl2 - multiplier * (atrValues[i] || 0);
    if (i === 0) {
      upperBand.push(rawUpper);
      lowerBand.push(rawLower);
      trend.push("UP");
      continue;
    }
    const prevUpper = upperBand[i - 1];
    const prevLower = lowerBand[i - 1];
    const prevClose = closes[i - 1];
    const finalUpper = rawUpper < prevUpper || prevClose > prevUpper ? rawUpper : prevUpper;
    const finalLower = rawLower > prevLower || prevClose < prevLower ? rawLower : prevLower;
    upperBand.push(finalUpper);
    lowerBand.push(finalLower);
    const prevTrend = trend[i - 1];
    if (prevTrend === "DOWN") {
      trend.push(closes[i] > finalUpper ? "UP" : "DOWN");
    } else {
      trend.push(closes[i] < finalLower ? "DOWN" : "UP");
    }
  }
  return { upperBand, lowerBand, trend };
}

export function adx(closes: number[], length = 14) {
  if (closes.length < length + 1) {
    const nans = closes.map(() => NaN);
    return { adx: nans, plusDI: nans, minusDI: nans };
  }
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const upMove = closes[i] - closes[i - 1];
    const downMove = closes[i - 1] - closes[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.abs(closes[i] - closes[i - 1]));
  }
  const smoothTr = ema(tr, length);
  const smoothPlus = ema(plusDM, length);
  const smoothMinus = ema(minusDM, length);
  const plusDI = smoothPlus.map((p, i) => (smoothTr[i] ? (p / smoothTr[i]) * 100 : 0));
  const minusDI = smoothMinus.map((m, i) => (smoothTr[i] ? (m / smoothTr[i]) * 100 : 0));
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i];
    const denom = p + m;
    return denom === 0 ? 0 : (Math.abs(p - m) / denom) * 100;
  });
  return { adx: ema(dx, length), plusDI, minusDI };
}

export function adxDI(_highs: number[], _lows: number[], closes: number[], length = 14) {
  return adx(closes, length);
}

export function parabolicSAR(closes: number[], step = 0.02, max = 0.2): { sar: number[]; trend: ("UP" | "DOWN")[] } {
  const sar: number[] = [];
  const trend: ("UP" | "DOWN")[] = [];
  if (closes.length < 2) return { sar: closes.map(() => NaN), trend: closes.map(() => "UP") };
  let bull = closes[1] > closes[0];
  let af = step;
  let ep = bull ? Math.max(...closes.slice(0, 2)) : Math.min(...closes.slice(0, 2));
  let prevSar = bull ? Math.min(...closes.slice(0, 2)) : Math.max(...closes.slice(0, 2));
  sar.push(prevSar);
  trend.push(bull ? "UP" : "DOWN");
  for (let i = 1; i < closes.length; i++) {
    let currentSar = prevSar + af * (ep - prevSar);
    if (bull) {
      if (closes[i] > ep) { ep = closes[i]; af = Math.min(af + step, max); }
      if (closes[i] < currentSar) { bull = false; currentSar = ep; ep = closes[i]; af = step; }
    } else {
      if (closes[i] < ep) { ep = closes[i]; af = Math.min(af + step, max); }
      if (closes[i] > currentSar) { bull = true; currentSar = ep; ep = closes[i]; af = step; }
    }
    sar.push(currentSar);
    trend.push(bull ? "UP" : "DOWN");
    prevSar = currentSar;
  }
  return { sar, trend };
}

// ─────────────────────────────────────────────────────────────────────────────
// VOLUME INDICATORS
// ─────────────────────────────────────────────────────────────────────────────

export function obv(closes: number[], volumes: number[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    let prevObv = result[i - 1];
    if (closes[i] > closes[i - 1]) result.push(prevObv + volumes[i]);
    else if (closes[i] < closes[i - 1]) result.push(prevObv - volumes[i]);
    else result.push(prevObv);
  }
  return result;
}

export function accumulationDistribution(highs: number[], lows: number[], closes: number[], volumes: number[]): number[] {
  const result: number[] = [];
  let prevAd = 0;
  for (let i = 0; i < closes.length; i++) {
    const range = highs[i] - lows[i];
    const mfm = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    prevAd += mfm * volumes[i];
    result.push(prevAd);
  }
  return result;
}

export function chaikinMoneyFlow(highs: number[], lows: number[], closes: number[], volumes: number[], length = 20): number[] {
  const mfvs: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const range = highs[i] - lows[i];
    const mfm = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    mfvs.push(mfm * volumes[i]);
  }
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < length - 1) { result.push(NaN); continue; }
    const mfvSum = mfvs.slice(i - length + 1, i + 1).reduce((s, v) => s + v, 0);
    const volSum = volumes.slice(i - length + 1, i + 1).reduce((s, v) => s + v, 0);
    result.push(volSum === 0 ? 0 : mfvSum / volSum);
  }
  return result;
}

export function vwap(c: number[], v: number[]): number[] {
  const result: number[] = [];
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < c.length; i++) {
    cumPV += c[i] * (v[i] || 0);
    cumV += v[i] || 0;
    result.push(cumV === 0 ? c[i] : cumPV / cumV);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTITUTIONAL & SMC INDICATORS
// ─────────────────────────────────────────────────────────────────────────────

export function ichimokuCloud(h: number[], l: number[], c: number[], tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  const len = c.length;
  const highLowAvg = (arrH: number[], arrL: number[], start: number, period: number) => {
    const sliceH = arrH.slice(start, start + period);
    const sliceL = arrL.slice(start, start + period);
    if (sliceH.length < period) return NaN;
    return (Math.max(...sliceH) + Math.min(...sliceL)) / 2;
  };
  const tenkan: number[] = [];
  const kijun: number[] = [];
  const spanA: number[] = [];
  const spanB: number[] = [];
  for (let i = 0; i < len; i++) {
    tenkan.push(i >= tenkanPeriod - 1 ? highLowAvg(h, l, i - tenkanPeriod + 1, tenkanPeriod) : NaN);
    kijun.push(i >= kijunPeriod - 1 ? highLowAvg(h, l, i - kijunPeriod + 1, kijunPeriod) : NaN);
    const t = tenkan[i];
    const k = kijun[i];
    spanA.push((!isNaN(t) && !isNaN(k)) ? (t + k) / 2 : NaN);
    spanB.push(i >= senkouBPeriod - 1 ? highLowAvg(h, l, i - senkouBPeriod + 1, senkouBPeriod) : NaN);
  }
  // Project Span A/B 26 bars forward
  const projectedSpanA = Array(26).fill(NaN).concat(spanA.slice(0, -26));
  const projectedSpanB = Array(26).fill(NaN).concat(spanB.slice(0, -26));
  const chikou = c.slice(26).concat(Array(26).fill(NaN));
  return { tenkan, kijun, spanA: projectedSpanA, spanB: projectedSpanB, chikou };
}

export interface FibLevels {
  h: number;
  l: number;
  level236: number;
  level382: number;
  level500: number;
  level618: number;
  level786: number;
  // Extensions for targets
  ext1272: number;
  ext1414: number;
  ext1618: number;
  ext2618: number;
}

export function calculateFibLevels(h: number[], l: number[], lookback = 60): FibLevels {
  const sliceH = h.slice(-lookback);
  const sliceL = l.slice(-lookback);
  const high = Math.max(...sliceH);
  const low = Math.min(...sliceL);
  const diff = high - low;
  return {
    h: high, l: low,
    level236: high - 0.236 * diff,
    level382: high - 0.382 * diff,
    level500: high - 0.500 * diff,
    level618: high - 0.618 * diff,
    level786: high - 0.786 * diff,
    ext1272: low + 1.272 * diff,
    ext1414: low + 1.414 * diff,
    ext1618: low + 1.618 * diff,
    ext2618: low + 2.618 * diff,
  };
}

export interface PivotPoints {
  supports: number[];
  resistances: number[];
}

export function pivotPoints(c: number[], l: number[], h: number[], leftBars = 3, rightBars = 3): PivotPoints {
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = leftBars; i < c.length - rightBars; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = 1; j <= leftBars; j++) {
      if (l[i] > l[i - j]) isLow = false;
      if (h[i] < h[i - j]) isHigh = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (l[i] > l[i + j]) isLow = false;
      if (h[i] < h[i + j]) isHigh = false;
    }
    if (isLow) supports.push(l[i]);
    if (isHigh) resistances.push(h[i]);
  }
  return {
    supports: supports.sort((a, b) => b - a),
    resistances: resistances.sort((a, b) => a - b)
  };
}

export function detectDivergence(prices: number[], indicator: number[], lookback = 20) {
  if (prices.length < lookback || indicator.length < lookback) return { bullish: false, bearish: false };
  
  const p = prices.slice(-lookback);
  const ind = indicator.slice(-lookback);
  
  const half = Math.floor(lookback / 2);
  const p1 = p.slice(0, half);
  const p2 = p.slice(half);
  
  const ind1 = ind.slice(0, half);
  const ind2 = ind.slice(half);
  
  // Bullish Divergence (Lower Low in price, Higher Low in indicator)
  const pMinIdx1 = p1.indexOf(Math.min(...p1));
  const pMinIdx2 = p2.indexOf(Math.min(...p2));
  
  const priceAtLow1 = p1[pMinIdx1];
  const priceAtLow2 = p2[pMinIdx2];
  const indAtLow1 = ind1[pMinIdx1];
  const indAtLow2 = ind2[pMinIdx2];
  
  const bullish = priceAtLow2 < priceAtLow1 && indAtLow2 > indAtLow1;
  
  // Bearish Divergence (Higher High in price, Lower High in indicator)
  const pMaxIdx1 = p1.lastIndexOf(Math.max(...p1));
  const pMaxIdx2 = p2.lastIndexOf(Math.max(...p2));
  
  const priceAtHigh1 = p1[pMaxIdx1];
  const priceAtHigh2 = p2[pMaxIdx2];
  const indAtHigh1 = ind1[pMaxIdx1];
  const indAtHigh2 = ind2[pMaxIdx2];
  
  const bearish = priceAtHigh2 > priceAtHigh1 && indAtHigh2 < indAtHigh1;
  
  return { bullish, bearish };
}

export function volumeTrendConfirmation(c: number[], v: number[], lookback = 10): number {
  if (c.length < lookback + 1) return 0;
  let matches = 0;
  const start = c.length - lookback;
  for (let i = start; i < c.length; i++) {
    if ((c[i] > c[i - 1] && v[i] > v[i - 1]) || (c[i] < c[i - 1] && v[i] < v[i - 1])) matches++;
  }
  return (matches / lookback) * 100;
}

export function clv(high: number, low: number, close: number): number {
  const range = high - low;
  if (range === 0) return 0;
  return ((close - low) - (high - close)) / range;
}

export interface FVG {
  index: number;
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  mitigated: boolean;
}

export function fairValueGaps(highs: number[], lows: number[]): FVG[] {
  const fvgs: FVG[] = [];
  if (highs.length < 3) return fvgs;
  for (let i = 2; i < highs.length; i++) {
    const high1 = highs[i - 2];
    const low3 = lows[i];
    const low1 = lows[i - 2];
    const high3 = highs[i];
    if (low3 > high1) fvgs.push({ index: i - 1, type: "BULLISH", top: low3, bottom: high1, mitigated: false });
    if (high3 < low1) fvgs.push({ index: i - 1, type: "BEARISH", top: low1, bottom: high3, mitigated: false });
  }
  return fvgs;
}

export interface OrderBlock {
  index: number;
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  mitigated: boolean;
}

export function orderBlocks(opens: number[], closes: number[], highs: number[], lows: number[], volumes: number[], atrVals: number[]): OrderBlock[] {
  const obs: OrderBlock[] = [];
  if (closes.length < 4) return obs;
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  for (let i = 1; i < closes.length - 2; i++) {
    const isDownCandle = closes[i] < opens[i];
    const isUpCandle = closes[i] > opens[i];
    const nextMove = Math.abs(closes[i + 2] - closes[i]);
    const isImpulsiveBullish = (closes[i + 2] > closes[i]) && nextMove > (atrVals[i] * 1.5) && volumes[i + 1] > avgVol;
    const isImpulsiveBearish = (closes[i + 2] < closes[i]) && nextMove > (atrVals[i] * 1.5) && volumes[i + 1] > avgVol;
    if (isDownCandle && isImpulsiveBullish) obs.push({ index: i, type: "BULLISH", top: highs[i], bottom: lows[i], mitigated: false });
    if (isUpCandle && isImpulsiveBearish) obs.push({ index: i, type: "BEARISH", top: highs[i], bottom: lows[i], mitigated: false });
  }
  return obs;
}

export interface VPVRLevel {
  priceMin: number;
  priceMax: number;
  volume: number;
}

export function vpvr(closes: number[], volumes: number[], bins = 50): { profile: VPVRLevel[], pocPrice: number } {
  if (closes.length === 0) return { profile: [], pocPrice: 0 };
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const range = maxPrice - minPrice;
  if (range === 0) return { profile: [{ priceMin: minPrice, priceMax: maxPrice, volume: volumes.reduce((a, b) => a + b, 0) }], pocPrice: minPrice };
  const binSize = range / bins;
  const profile: VPVRLevel[] = Array.from({ length: bins }, (_, i) => ({ priceMin: minPrice + (i * binSize), priceMax: minPrice + ((i + 1) * binSize), volume: 0 }));
  for (let i = 0; i < closes.length; i++) {
    let binIndex = Math.floor((closes[i] - minPrice) / binSize);
    if (binIndex >= bins) binIndex = bins - 1;
    profile[binIndex].volume += volumes[i] || 0;
  }
  let maxVol = 0; let pocPrice = 0;
  for (const bin of profile) { if (bin.volume > maxVol) { maxVol = bin.volume; pocPrice = (bin.priceMin + bin.priceMax) / 2; } }
  return { profile, pocPrice };
}

export function detectMarketRegime(adx: number, currentBbWidth: number, avgBbWidth: number): 'TRENDING' | 'RANGING' | 'VOLATILE' {
  if (adx > 25) return 'TRENDING';
  if (currentBbWidth > avgBbWidth * 1.5) return 'VOLATILE';
  return 'RANGING';
}

export function emaRibbonScore(ema5: number, ema10: number, ema20: number, ema50: number): number {
  let score = 0;
  if (ema5 > ema10) score++;
  if (ema10 > ema20) score++;
  if (ema20 > ema50) score++;
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME-BASED TARGET CALCULATION (Future Goals with Timeframes)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuantHorizons {
  shortTerm: {
    targetTl: number;
    targetUsd: number;
    stopLossTl: number;
    rrRatio: number;
  };
  mediumTerm: {
    targetTl: number;
    targetUsd: number;
    stopLossTl: number;
    rrRatio: number;
  };
  longTerm: {
    targetTl: number;
    targetUsd: number;
    stopLossTl: number;
    rrRatio: number;
  };
}

// Linear regression for trend projection
export function linearRegression(values: number[], periods: number = 20): { slope: number; intercept: number; forecast: number } {
  if (values.length < 2) return { slope: 0, intercept: values[values.length - 1] || 0, forecast: 0 };
  
  const n = Math.min(periods, values.length);
  const data = values.slice(-n);
  
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const forecast = intercept + slope * (n - 1) + slope; // Next period
  
  return { slope, intercept, forecast: Math.max(0, forecast) };
}

// Calculate Multi-Horizon targets based on Quantitative AI Bot architecture
export function calculateQuantHorizons(
  closes: number[],
  highs: number[],
  lows: number[],
  atr14: number,
  currentPrice: number,
  usdtryRate: number
): QuantHorizons {
  const safeAtr = atr14 || (currentPrice * 0.02);
  const sma200Vals = sma(closes, 200);
  const safeSma200 = sma200Vals.length > 0 ? sma200Vals[sma200Vals.length - 1] || currentPrice : currentPrice;
  const fib = calculateFibLevels(highs, lows, 60);

  // SHORT-TERM (Swing)
  // Risk: 1.5x ATR | Reward: 2.5x ATR
  const stStop = currentPrice - (1.5 * safeAtr);
  const stTarget = Math.max(currentPrice + (2.5 * safeAtr), currentPrice * 1.03);
  
  // MEDIUM-TERM (Trend)
  // Risk: 2.5x ATR | Reward: 5x ATR
  const mtStop = currentPrice - (2.5 * safeAtr);
  const mtTarget = Math.max(currentPrice + (5.0 * safeAtr), currentPrice * 1.08, fib.ext1618 || 0);

  // LONG-TERM (Position)
  // Risk: 4x ATR | Reward: 10x ATR (or 20% min)
  const ltStop = Math.min(currentPrice - (4.0 * safeAtr), safeSma200);
  const ltTarget = Math.max(currentPrice + (10.0 * safeAtr), currentPrice * 1.20, fib.ext2618 || 0);

  const calcRr = (target: number, stop: number) => {
      const risk = currentPrice - stop;
      const reward = target - currentPrice;
      if (risk <= 0) return 0;
      return Math.round((reward / risk) * 100) / 100;
  };

  return {
    shortTerm: {
      targetTl: stTarget * usdtryRate,
      targetUsd: stTarget,
      stopLossTl: stStop * usdtryRate,
      rrRatio: calcRr(stTarget, stStop)
    },
    mediumTerm: {
      targetTl: mtTarget * usdtryRate,
      targetUsd: mtTarget,
      stopLossTl: mtStop * usdtryRate,
      rrRatio: calcRr(mtTarget, mtStop)
    },
    longTerm: {
      targetTl: ltTarget * usdtryRate,
      targetUsd: ltTarget,
      stopLossTl: ltStop * usdtryRate,
      rrRatio: calcRr(ltTarget, ltStop)
    }
  };
}