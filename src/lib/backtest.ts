import { BistBar } from "./bist";
import { supertrend, rsi, atrFromCloses, ema, bollingerBands, sma } from "./indicators";

// Helper to access indicators inside functions to avoid circular deps if they occur
function importIndicators() {
  return { bollingerBands, sma };
}

export interface Trade {
  type: "BUY" | "SELL";
  price: number;
  date: Date;
  reason: string;
}

export interface BacktestResult {
  initialCapital: number;
  finalCapital: number;
  pnl: number;
  pnlPercent: number;
  trades: Trade[];
  winRate: number;
  maxDrawdown: number;
}

export interface BacktestParams {
  bars: BistBar[];
  indexBars?: BistBar[]; // Added for Statistical Arbitrage
  initialCapital: number;
  strategy?: "SUPERTREND" | "EMA_CROSS" | "VOLATILITY_BREAKOUT" | "MEAN_REVERSION" | "STATISTICAL_ARBITRAGE";
  // Strategy params
  rsiBuyThreshold?: number;
  rsiSellThreshold?: number;
}

export function runBacktest(params: BacktestParams): BacktestResult {
  const { bars, initialCapital } = params;
  
  if (bars.length < 50) {
    return {
      initialCapital,
      finalCapital: initialCapital,
      pnl: 0,
      pnlPercent: 0,
      trades: [],
      winRate: 0,
      maxDrawdown: 0
    };
  }

  const closes = bars.map(b => b.close);
  const atrVals = atrFromCloses(closes, 10);
  const st = supertrend(closes, atrVals, 3);
  const rsiVals = rsi(closes, 14);

  let capital = initialCapital;
  let shares = 0;
  let positionOpenPrice = 0;
  let maxCapital = initialCapital;
  let maxDrawdown = 0;
  
  let winningTrades = 0;
  let losingTrades = 0;

  const trades: Trade[] = [];

  const rsiBuy = params.rsiBuyThreshold || 70;
  const rsiSell = params.rsiSellThreshold || 80;
  const strategy = params.strategy || "SUPERTREND";
  const indexBars = params.indexBars || [];
  
  // Calculate EMAs for EMA_CROSS strategy
  const ema21 = ema(closes, 21);
  const ema26 = ema(closes, 26);
  const ema5 = ema(closes, 5);

  // Indicators for MEAN_REVERSION
  const { lower: bbLower } = importIndicators().bollingerBands(closes, 20, 2);
  
  // Helpers for VOLATILITY_BREAKOUT (Donchian Channels)
  const highestHigh20 = (idx: number) => Math.max(...closes.slice(Math.max(0, idx - 20), idx));
  const lowestLow10 = (idx: number) => Math.min(...closes.slice(Math.max(0, idx - 10), idx));

  // Precompute Relative Ratio for STATISTICAL_ARBITRAGE
  const ratios: number[] = [];
  if (strategy === "STATISTICAL_ARBITRAGE" && indexBars.length > 0) {
    // We assume indexBars dates roughly align with bars
    // For simplicity, we just align by index if lengths are similar, or find matching dates
    // To be safe and fast, we map index close by date string
    const indexMap = new Map<string, number>();
    indexBars.forEach(b => indexMap.set(b.date.toISOString().split('T')[0], b.close));
    
    for (let i = 0; i < bars.length; i++) {
       const dStr = bars[i].date.toISOString().split('T')[0];
       const iClose = indexMap.get(dStr) || indexBars[indexBars.length - 1].close; 
       ratios.push(closes[i] / iClose);
    }
  }

  const bbRatio = ratios.length > 0 ? importIndicators().bollingerBands(ratios, 20, 2) : null;

  for (let i = 20; i < bars.length; i++) {
    const currentPrice = bars[i].close;
    const currentST = st.trend[i];
    const prevST = st.trend[i - 1];
    const currentRSI = rsiVals[i];

    // Check Drawdown
    const currentPortfolioValue = capital + (shares * currentPrice);
    if (currentPortfolioValue > maxCapital) {
      maxCapital = currentPortfolioValue;
    }
    const drawdown = (maxCapital - currentPortfolioValue) / maxCapital;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    let isBuySignal = false;
    let isSellSignal = false;
    let buyReason = "";
    let sellReason = "";

    if (strategy === "SUPERTREND") {
      isBuySignal = currentST === "UP" && prevST === "DOWN" && currentRSI < rsiBuy;
      buyReason = `ST UP, RSI ${(currentRSI || 0).toFixed(1)}`;
      isSellSignal = (currentST === "DOWN" && prevST === "UP") || currentRSI > rsiSell;
      sellReason = currentRSI > rsiSell ? `RSI OB ${(currentRSI || 0).toFixed(1)}` : `ST DOWN`;
    } else if (strategy === "EMA_CROSS") {
      const currentEma5 = ema5[i];
      const prevEma5 = ema5[i - 1];
      const currentEma21 = ema21[i];
      const prevEma21 = ema21[i - 1];
      const currentEma26 = ema26[i];
      
      // Buy when EMA5 crosses above EMA21 and RSI is not overbought
      isBuySignal = prevEma5 <= prevEma21 && currentEma5 > currentEma21 && currentRSI < rsiBuy;
      buyReason = `EMA5>21, RSI ${(currentRSI || 0).toFixed(1)}`;
      
      // Sell when price drops below the slower EMA26 (trailing stop) or RSI overbought
      isSellSignal = currentPrice < currentEma26 || currentRSI > rsiSell;
      sellReason = currentPrice < currentEma26 ? `Price < EMA26 (Stop)` : `RSI OB ${(currentRSI || 0).toFixed(1)}`;
    } else if (strategy === "VOLATILITY_BREAKOUT") {
      const h20 = highestHigh20(i);
      const l10 = lowestLow10(i);
      isBuySignal = currentPrice > h20;
      buyReason = `20-Günlük Zirve Kırılımı (${h20.toFixed(2)})`;
      isSellSignal = currentPrice < l10;
      sellReason = `10-Günlük Dip Kırılımı Stop (${l10.toFixed(2)})`;
    } else if (strategy === "MEAN_REVERSION") {
      // Deep Dip Hunter
      isBuySignal = currentPrice < bbLower[i] && currentRSI < 30;
      buyReason = `RSI < 30 ve Bollinger Altı (Dip Avı)`;
      isSellSignal = currentRSI > 50;
      sellReason = `RSI > 50 Ortalamaya Dönüş (Kâr Al)`;
    } else if (strategy === "STATISTICAL_ARBITRAGE" && bbRatio) {
      const curRatio = ratios[i];
      const curLowerBB = bbRatio.lower[i];
      const curMidBB = bbRatio.sma[i];
      // Buy when ratio drops below its 20-day lower bollinger band (stock severely underperforming index)
      isBuySignal = curRatio < curLowerBB;
      buyReason = `Endekse Göre Aşırı Ucuzluk (Z-Score < -2)`;
      // Sell when ratio returns to mean
      isSellSignal = curRatio >= curMidBB;
      sellReason = `Ortalamaya Dönüş (Z-Score = 0)`;
    }

    // BUY LOGIC
    if (shares === 0 && isBuySignal) {
      const affordableShares = Math.floor(capital / currentPrice);
      if (affordableShares > 0) {
        shares = affordableShares;
        const cost = shares * currentPrice;
        capital -= cost;
        positionOpenPrice = currentPrice;
        
        trades.push({
          type: "BUY",
          price: currentPrice,
          date: bars[i].date,
          reason: buyReason
        });
      }
    }
    // SELL LOGIC
    else if (shares > 0 && isSellSignal) {
      const revenue = shares * currentPrice;
      capital += revenue;
      
      const profit = currentPrice - positionOpenPrice;
      if (profit > 0) winningTrades++;
      else losingTrades++;

      trades.push({
        type: "SELL",
        price: currentPrice,
        date: bars[i].date,
        reason: sellReason
      });

      shares = 0;
      positionOpenPrice = 0;
    }
  }

  // Force close at the end if open
  if (shares > 0) {
    const currentPrice = bars[bars.length - 1].close;
    capital += shares * currentPrice;
    
    const profit = currentPrice - positionOpenPrice;
    if (profit > 0) winningTrades++;
    else losingTrades++;

    trades.push({
      type: "SELL",
      price: currentPrice,
      date: bars[bars.length - 1].date,
      reason: "BACKTEST_END"
    });
    shares = 0;
  }

  const pnl = capital - initialCapital;
  const pnlPercent = (pnl / initialCapital) * 100;
  const totalTrades = winningTrades + losingTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  return {
    initialCapital,
    finalCapital: capital,
    pnl,
    pnlPercent,
    trades,
    winRate,
    maxDrawdown: maxDrawdown * 100
  };
}
