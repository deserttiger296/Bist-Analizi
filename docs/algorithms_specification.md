# 🏛️ Kazananlar Kulübü — BIST Analyst (v3.1) Quantitative Algorithms Specification

This document provides the exact mathematical formulations, operational logic, and TypeScript code implementations for the core quantitative engines powering the Kazananlar Kulübü BIST Analyst platform.

---

## 1. Market Regime Detection Engine (HMM Approximation)

### Mathematical Formulation
The market regime detector classifies BIST state into three states: **TREND (Trending)**, **YATAY (Sideways/Range-bound)**, or **KRİZ (Crisis/Panic)**.

Let $P_t$ be the benchmark index close price at time $t$. The logarithmic returns $R_t$ over a rolling window of length $N$ (typically $N=20$) are defined as:
$$R_t = \ln\left(\frac{P_t}{P_{t-1}}\right)$$

The rolling annualized volatility $\sigma$ is computed as the sample standard deviation of these logarithmic returns, scaled to an annualized basis:
$$\sigma = \sqrt{\frac{1}{N - 1} \sum_{i=t-N+1}^{t} (R_i - \bar{R})^2} \times \sqrt{252}$$
where $\bar{R}$ is the sample mean of the returns over the window.

The index momentum $M$ over the lookback window is defined as the simple rate of change:
$$M = \frac{P_t - P_{t-N}}{P_{t-N}}$$

### Classification Decision Boundaries
1. **KRİZ (Crisis / Extreme Volatility)**: Triggered if the annualized volatility exceeds the crisis threshold:
   $$\sigma \ge 35\% \implies \text{State} = \text{KRİZ}$$
   $$\text{Confidence } C = \min(0.95, 0.7 + (\sigma - 0.35) \times 0.5)$$
2. **YATAY (Calm / Range-bound)**: Triggered if volatility is low and momentum is flat:
   $$\sigma < 15\% \quad \text{AND} \quad |M| < 4\% \implies \text{State} = \text{YATAY}$$
   $$\text{Confidence } C = \min(0.90, 0.6 + (0.15 - \sigma) \times 2.0)$$
3. **TREND (Directional Trend)**: Triggered if momentum is strong:
   $$|M| \ge 4\% \implies \text{State} = \text{TREND}$$
   $$\text{Confidence } C = \min(0.92, 0.6 + (|M| - 0.04) \times 3.0)$$

### Implementation Code (`regime.ts`)
```typescript
export type MarketRegime = "TREND" | "YATAY" | "KRİZ";

export interface RegimeResult {
  regime: MarketRegime;
  volatility: number;
  momentum: number;
  confidence: number;
  calculatedAt: Date;
}

export function detectMarketRegime(indexPrices: number[], lookback: number = 20): RegimeResult {
  const now = new Date();
  if (indexPrices.length < lookback) {
    return { regime: "YATAY", volatility: 0, momentum: 0, confidence: 0.5, calculatedAt: now };
  }

  const returns: number[] = [];
  for (let i = 1; i < indexPrices.length; i++) {
    returns.push(Math.log(indexPrices[i] / indexPrices[i - 1]));
  }

  const activeReturns = returns.slice(-lookback);
  const meanReturn = activeReturns.reduce((sum, r) => sum + r, 0) / activeReturns.length;
  const variance = activeReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / activeReturns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);

  const currentPrice = indexPrices[indexPrices.length - 1];
  const oldPrice = indexPrices[indexPrices.length - lookback];
  const momentum = (currentPrice - oldPrice) / oldPrice;

  let regime: MarketRegime = "YATAY";
  let confidence = 0.5;

  const VOLATILITY_HIGH_THRESHOLD = 0.35;
  const VOLATILITY_LOW_THRESHOLD = 0.15;
  const MOMENTUM_TREND_THRESHOLD = 0.04;

  if (volatility >= VOLATILITY_HIGH_THRESHOLD) {
    regime = "KRİZ";
    confidence = Math.min(0.95, 0.7 + (volatility - VOLATILITY_HIGH_THRESHOLD) * 0.5);
  } else if (volatility < VOLATILITY_LOW_THRESHOLD && Math.abs(momentum) < MOMENTUM_TREND_THRESHOLD) {
    regime = "YATAY";
    confidence = Math.min(0.90, 0.6 + (VOLATILITY_LOW_THRESHOLD - volatility) * 2.0);
  } else if (Math.abs(momentum) >= MOMENTUM_TREND_THRESHOLD) {
    regime = "TREND";
    confidence = Math.min(0.92, 0.6 + (Math.abs(momentum) - MOMENTUM_TREND_THRESHOLD) * 3.0);
  } else {
    regime = Math.abs(momentum) > 0.02 ? "TREND" : "YATAY";
    confidence = 0.55;
  }

  return { regime, volatility, momentum, confidence, calculatedAt: now };
}
```

---

## 2. Dynamic Fractional Kelly Capital Sizing

### Mathematical Formulation
The Kelly Criterion calculates the optimal proportion $f^*$ of capital to allocate to a trade to maximize long-term logarithmic growth of capital:
$$f^* = \frac{b \cdot p - q}{b} = \frac{b \cdot p - (1 - p)}{b}$$
where:
* $p$ is the estimated probability of a winning trade (derived from our confluence score proxy).
* $q = 1 - p$ is the probability of a losing trade.
* $b$ is the odds ratio:
  $$b = \frac{\text{Average Profit of Winning Trades}}{\text{Average Loss of Losing Trades}}$$

To reduce variance and avoid large drawdowns, we scale the Kelly fraction by a factor $k$ (typically $0.25$ or $1/4$ Kelly):
$$f_{\text{scaled}} = f^* \times k$$

The final position size is bounded between a minimum floor of 2% and a maximum ceiling of 25% of total capital:
$$f_{\text{final}} = \max\left(0.02, \min\left(0.25, f_{\text{scaled}}\right)\right)$$

If the market regime is detected as **KRİZ (Crisis)**, all sizes are overridden to $0.0\%$ (capital is frozen in cash).

### Implementation Code (`kelly.ts`)
```typescript
export function calculateKellyFraction(
  p: number,
  avgProfit: number,
  avgLoss: number,
  fraction: number = 0.25
): number {
  if (avgLoss <= 0 || avgProfit <= 0) return 0.05;
  if (p <= 0.3) return 0.02;

  const b = avgProfit / avgLoss;
  const q = 1.0 - p;
  const rawKelly = (b * p - q) / b;
  const scaledKelly = rawKelly * fraction;

  return Math.max(0.02, Math.min(0.25, scaledKelly));
}

export async function getKellySizingForSymbol(
  symbol: string,
  scoreProxy: number = 0.60
): Promise<number> {
  const winRate = Math.max(0.35, Math.min(0.85, scoreProxy));
  
  // BIST institutional benchmark parameters: 8% avg win, 3% avg loss
  const avgWinPct = 0.08;
  const avgLossPct = 0.03;

  return calculateKellyFraction(winRate, avgWinPct, avgLossPct, 0.25);
}
```

---

## 3. Daily Swing Scoring Engine (v3.1 Upgrade)

The Daily Swing engine computes indicator activations across 4 categories (Trend, Momentum, Volume, and Structure).

### The Composite Scoring Formula
The final confluence score is a weighted composite of the category scores:
$$\text{Composite Score} = (0.35 \times \text{Trend}) + (0.25 \times \text{Momentum}) + (0.25 \times \text{Volume}) + (0.15 \times \text{Structure})$$

For each category, the category score is:
$$\text{Category Score} = \frac{\sum \text{Active Indicator Weights in Category}}{\sum \text{Total Maximum Weights in Category}} \times 100$$

### Regime-Adaptive Weight Scaling
Depending on the HMM Market Regime, category weights are scaled dynamically:
* **TRENDING Regimes**: 
  $$\text{Weight}_{\text{Trend}} \leftarrow \text{Weight}_{\text{Trend}} \times 1.3$$
  $$\text{Weight}_{\text{Momentum}} \leftarrow \text{Weight}_{\text{Momentum}} \times 1.3$$
* **RANGING Regimes**:
  $$\text{Weight}_{\text{Structure}} \leftarrow \text{Weight}_{\text{Structure}} \times 1.3$$

### Dynamic RSI Overbought Expandable Ceiling
The overbought RSI boundary is expanded based on market regime to capture strong momentum:
$$\text{RSI Ceiling} = \begin{cases} 85, & \text{if Regime is TRENDING} \\ 70, & \text{if Regime is RANGING} \end{cases}$$

### Divergence Penalties (Critical Override)
If a bearish divergence is detected, the final composite score is penalized directly:
$$\text{Score}_{\text{final}} = \text{Score} - \text{Penalty}$$
$$\text{Penalty} = \begin{cases} 15, & \text{if RSI Bearish Divergence} \\ 10, & \text{if MACD Bearish Divergence} \end{cases}$$

---

## 4. Intraday Scalper Engine (v3.1 Day-Desk)

The Scalper Engine operates on **5-minute charts** to generate high-frequency signals for **BIST 30** assets.

### Tiered RVOL (Relative Volume) Scoring
To prevent signal starvation on lower-volume trading days, the RVOL calculation uses a tiered point system:
$$S_{\text{RVOL}} = \begin{cases} 40, & \text{if } \text{RVOL} > 2.0 \\ 20, & \text{if } 1.3 < \text{RVOL} \le 2.0 \\ 10, & \text{if } 0.8 < \text{RVOL} \le 1.3 \\ 0, & \text{otherwise} \end{cases}$$

The total scalper score is computed as:
$$\text{Scalper Score} = S_{\text{RVOL}} + S_{\text{VWAP}} + S_{\text{RSI\_Speed}}$$
where:
* $S_{\text{VWAP}} = 30$ if $\text{Price} > \text{VWAP}$.
* $S_{\text{RSI\_Speed}} = 30$ if $\text{RSI Momentum} > 3.0$.

### Core Strategy Entry Logic

#### Strategy 1: Momentum Ignition
Enters trades with explosive trend momentum:
$$\text{Signal}_{\text{LONG}} = \text{TRUE} \iff \left( P_t > \text{VWAP} \quad \text{AND} \quad \text{RSI} < 75 \quad \text{AND} \quad \Delta\text{RSI} > 2.0 \quad \text{AND} \quad \text{RVOL} > 1.3 \right)$$

#### Strategy 2: Deep VWAP Reversion
Oversold mean-reversion trade to buy localized panic sells:
$$\text{Signal}_{\text{LONG}} = \text{TRUE} \iff \left( \frac{P_t - \text{VWAP}}{\text{VWAP}} < -2.5\% \quad \text{AND} \quad \text{RSI} < 30 \quad \text{AND} \quad \Delta\text{RSI} > 0 \quad \text{AND} \quad \text{RVOL} > 1.0 \right)$$

#### Strategy 3: Volatility Squeeze Breakout
Enters trades immediately upon Bollinger Band breakouts following extreme narrowing:
$$\text{Signal}_{\text{LONG}} = \text{TRUE} \iff \left( \frac{\text{BB}_{\text{Upper}} - \text{BB}_{\text{Lower}}}{\text{BB}_{\text{SMA}}} < 2.0\% \quad \text{AND} \quad P_t > \text{BB}_{\text{Upper}} \quad \text{AND} \quad \text{RVOL} > 1.5 \right)$$

---

## 5. Walk-Forward Pearson Correlation Calibration

The calibration engine tunes the scoring weights dynamically using Pearson correlation analysis of historical activation states and subsequent log returns.

### Pearson Correlation Coefficient Formula
Let $X$ be the binary indicator activation state vector ($X_i \in \{0, 1\}$) and $Y$ be the T+5 forward log return vector ($Y_i = \ln(P_{i+5}/P_i)$). The correlation coefficient $r_{X,Y}$ is calculated as:
$$r_{X,Y} = \frac{\sum_{i=1}^{n} (X_i - \bar{X})(Y_i - \bar{Y})}{\sqrt{\sum_{i=1}^{n} (X_i - \bar{X})^2 \sum_{i=1}^{n} (Y_i - \bar{Y})^2}}$$
where $\bar{X}$ and $\bar{Y}$ are the sample means.

### Weight Optimization Feedback Loop
The calibrator runs at the end of every week to adjust the weights:
$$\text{Weight}_{\text{new}} = \begin{cases} \text{round}(\text{Weight}_{\text{current}} \times 1.20), & \text{if } r_{X,Y} > 0.15 \quad (\text{High Correlation}) \\ \text{round}(\text{Weight}_{\text{current}} \times 0.80), & \text{if } r_{X,Y} < -0.05 \quad (\text{Negative Correlation}) \\ \text{Weight}_{\text{current}}, & \text{otherwise} \end{cases}$$

### Implementation Code (`walkForwardCalibrator.ts`)
```typescript
function mean(arr: number[]): number {
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

export function optimizeWeights(
  bars: HistoricalBar[],
  baseWeights: CategoryWeights
): { newWeights: CategoryWeights, correlations: Record<string, number> } {
  const correlations: Record<string, number> = {};
  const newWeights: CategoryWeights = JSON.parse(JSON.stringify(baseWeights));

  for (const config of BACKTEST_INDICATORS) {
    const signals = config.signalFn(bars);
    const xActive = [];
    const yRetT5 = [];
    
    for (let i = 0; i < bars.length - 5; i++) {
      xActive.push(signals[i] ? 1 : 0);
      
      const p0 = bars[i].close;
      const p1 = bars[i + 5].close;
      const logRet = p0 > 0 && p1 > 0 ? Math.log(p1 / p0) : 0;
      yRetT5.push(logRet);
    }
    
    const corr = pearsonCorrelation(xActive, yRetT5);
    correlations[config.name] = corr;
    
    if (newWeights[config.category][config.name] !== undefined) {
      let currentWeight = newWeights[config.category][config.name];
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
```

---

*This document defines the mathematical models of the Kazananlar Kulübü BIST Analyst quantitative trading platform.*
