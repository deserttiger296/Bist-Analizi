// src/lib/quant/kalman.ts
// Adaptive Kalman Filter — Institutional Grade Market Noise Filter
// Integrates 1D Kalman state estimation with dynamically scaled process noise (Q) based on volatility.

export class AdaptiveKalmanFilter {
  private x: number = 0; // State estimate (smoothed price)
  private p: number = 1; // Estimation error covariance
  private q: number = 0.01; // Process noise covariance (dynamically updated)
  private r: number = 0.05; // Measurement noise covariance (broker data feed error)
  private isInitialized: boolean = false;

  constructor(r: number = 0.05) {
    this.r = r;
  }

  /**
   * Updates the filter state with a new price measurement.
   * @param z Current raw price measurement.
   * @param volatility Volatility metric (e.g., standard deviation or ATR) to scale Q.
   */
  public update(z: number, volatility: number): number {
    if (!this.isInitialized) {
      this.x = z;
      this.p = 1.0;
      this.isInitialized = true;
      return this.x;
    }

    // 1. Adaptive Q Scaling: Q scales with historical price volatility
    // High volatility -> Larger Q -> Quick filter adaptation (low lag)
    // Low volatility -> Smaller Q -> Smooth filtering (removes noise)
    this.q = Math.max(0.0001, Math.min(10.0, Math.pow(volatility, 2) * 0.1));

    // 2. Prediction Step (Time Update)
    // x_k|k-1 = x_k-1
    // P_k|k-1 = P_k-1 + Q
    const pPredict = this.p + this.q;

    // 3. Correction Step (Measurement Update)
    // K_k = P_k|k-1 / (P_k|k-1 + R)
    const kGain = pPredict / (pPredict + this.r);

    // x_k|k = x_k|k-1 + K_k * (z_k - x_k|k-1)
    this.x = this.x + kGain * (z - this.x);

    // P_k|k = (1 - K_k) * P_k|k-1
    this.p = (1.0 - kGain) * pPredict;

    return this.x;
  }

  /**
   * Resets the filter state.
   */
  public reset(): void {
    this.isInitialized = false;
    this.x = 0;
    this.p = 1;
  }
}

/**
   * Helper to smooth an entire series of prices using an adaptive Kalman Filter.
   * Dynamically estimates rolling volatility of the raw price series.
   * @param closes Raw closing prices.
   * @param lookback Lookback window for estimating dynamic volatility (default 10).
   * @param r Measurement noise covariance (default 0.05).
   */
export function smoothPrices(closes: number[], lookback: number = 10, r: number = 0.05): number[] {
  if (closes.length === 0) return [];
  
  const filter = new AdaptiveKalmanFilter(r);
  const smoothed: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    // Estimate dynamic volatility using a rolling standard deviation or absolute price changes
    let volatility = 0.01;
    if (i >= lookback) {
      const window = closes.slice(i - lookback + 1, i + 1);
      const mean = window.reduce((sum, val) => sum + val, 0) / lookback;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lookback;
      volatility = Math.sqrt(variance);
    } else if (i > 0) {
      // Fallback for initial bars
      volatility = Math.abs(closes[i] - closes[i - 1]);
    }

    const smoothedVal = filter.update(closes[i], volatility);
    smoothed.push(smoothedVal);
  }

  return smoothed;
}
