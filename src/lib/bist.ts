import { fetchBiQuoteTick, fetchBiQuoteOhlc } from "./biquote";
import { getSniperPrediction, SniperPrediction } from "./sniperEngine";
import { smoothPrices } from "./quant/kalman";
// NOTE: Ichimoku, CCI, Stochastic, SAR, ADX+DI, Bollinger squeeze, VWAP, EMA
// ribbon scoring and pivot/Fibonacci targets have been proven statistically
// meaningless for the live decision engine below (see project memory / audit
// notes) and were stripped out of fetchBistLiveQuote's scoring logic. The
// underlying indicator math still lives in ./indicators and is still used by
// fetchChartData() purely for optional reference lines on the price chart —
// that's a display concern, not a trading decision, so it was left alone.
import { linearTSI, rsi, sma, obv, chaikinMoneyFlow, clv, ema, atrFromCloses, accumulationDistribution, macd, stochastic, cci, fairValueGaps, orderBlocks, vpvr, bollingerBands, volumeTrendConfirmation, calculateFibLevels, QuantHorizons, calculateQuantHorizons } from "./indicators";
import { Cache } from "./cache";
import { BIST_SYMBOLS } from "./bist100";
import { getIndexTag } from "./indices";
import { fetchFundamentalMetrics } from "./isYatirim";
import { fetchAkdData, AkdData } from "./akd";
import { fetchSocialSentiment, SocialSentiment } from "./sentiment";
function getHistoricalTtl(barType: 'hourly' | 'daily' | 'weekly' | 'monthly'): number {
  const now = new Date();
  const trTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
  const day = trTime.getDay();
  const hour = trTime.getHours();
  const minute = trTime.getMinutes();
  
  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = isWeekday && (
    (hour === 10 && minute >= 0) || 
    (hour > 10 && hour < 18) || 
    (hour === 18 && minute <= 15)
  );

  if (isMarketHours) {
    if (barType === 'hourly') {
      return 10 * 1000; // 10 seconds for 15-min bars during market hours
    }
    return 30 * 1000; // 30 seconds for daily/weekly/monthly bars during market hours
  }
  
  return 60 * 60 * 1000; // 1 hour outside market hours
}

// Global USDTRY fetcher
let cachedUsdTry = Number.NaN; // unavailable until fetched
let lastUsdTryFetch = 0;

async function getUsdTryRate(): Promise<number> {
  const now = Date.now();
  if (now - lastUsdTryFetch < 5 * 60 * 1000) return cachedUsdTry;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/USDTRY=X?interval=1d&range=1d`;
    const res = await fetch(url);
    const json = await res.json();
    cachedUsdTry = json.chart.result[0].meta.regularMarketPrice;
    lastUsdTryFetch = now;
  } catch (err) {
    console.error("Failed to fetch USDTRY, using fallback", err);
  }
  return cachedUsdTry;
}

export interface BistBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ULTRA-SAFE RAW YAHOO FETCH (No Library Dependency)
export interface TrackerParams {
  minScore: number;
  maxRsi: number;
  minSma20Distance: number;
  minVolumeMultiple: number;
  minPasses: number;
  requireHigherHighs: boolean;
  requireHigherLows: boolean;
}

export interface TrackerResult {
  symbol: string;
  quote: BistLiveQuote;
  confluenceScore: number;
  status: string;
  reasons: string[];
  alert: boolean;
  passCount?: number;
}

export async function fetchYahooRaw(symbol: string, interval = '1d', range = '1y', retries = 1): Promise<BistBar[] | null> {
  const symbolIs = symbol.includes('=X') ? symbol : (symbol.endsWith('.IS') ? symbol : `${symbol}.IS`);
  
    for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
      
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbolIs}?interval=${interval}&range=${range}&ts=${Date.now()}`;
      const res = await fetch(url, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        if (attempt === retries) return null;
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error("No result in Yahoo response");
      
      const timestamps = result.timestamp;
      const quotes = result.indicators?.quote?.[0];
      if (!timestamps || timestamps.length === 0 || !quotes) {
        throw new Error("Missing timestamps or quotes");
      }
      
      const closes = quotes.close;
      
      const bars = timestamps.map((t: number, i: number) => ({
        date: new Date(t * 1000),
        open: quotes.open[i] || closes[i],
        high: quotes.high[i] || closes[i],
        low: quotes.low[i] || closes[i],
        close: closes[i],
        volume: quotes.volume[i] || 0
      })).filter((b: any) => b.close != null);
      
      if (interval === '1d') {
        const missingVolCount = bars.filter((b: any) => b.volume === 0).length;
        if (missingVolCount > bars.length * 0.1) {
          // Previously threw here, discarding otherwise-good OHLC price data
          // over incomplete volume. Every fallback behind this call is
          // currently non-functional for real BIST symbols (İş Yatırım's
          // endpoint no longer returns JSON, Twelve Data has no API key
          // configured, and BiQuote is skipped for anything in
          // BIST_SYMBOLS) -- so throwing meant the chart got nothing at all
          // instead of price data with a few volume gaps. Price is what the
          // chart itself needs most; volume-derived indicators degrade
          // gracefully with some zero bars, an empty chart does not.
          console.warn(`fetchYahooRaw: ${missingVolCount}/${bars.length} bars missing volume for ${symbolIs}, proceeding anyway`);
        }
      }
      return bars;
    } catch (err) {
      console.error(`fetchYahooRaw error for ${symbolIs}:`, err);
      if (attempt === retries) return null;
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
    }
  }
  return null;
}

async function fetchTwelveDataFallback(symbol: string): Promise<BistBar[] | null> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) return null;
  try {
    const cleanSym = symbol.replace('.IS', '') + ':BIST';
    const url = `https://api.twelvedata.com/time_series?symbol=${cleanSym}&interval=1day&outputsize=100&apikey=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.values) return null;
    return data.values.map((v: any) => ({
      date: new Date(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume) || 0
    })).reverse();
  } catch (err) {
    console.error(`[Twelve Data Fallback] Error for ${symbol}:`, err);
    return null;
  }
}

async function fetchIsYatirimFallback(symbol: string): Promise<BistBar[] | null> {
  try {
    const cleanSym = symbol.replace('.IS', '').toUpperCase();
    const url = `https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTeknikAnalizVerisi?hisse=${cleanSym}&period=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    if (!json.d) return null;
    return json.d.map((item: any) => ({
      date: new Date(item.Date),
      open: parseFloat(item.Open) || 0,
      high: parseFloat(item.High) || 0,
      low: parseFloat(item.Low) || 0,
      close: parseFloat(item.Close) || 0,
      volume: parseFloat(item.Volume) || 0
    }));
  } catch (err) {
    console.error(`[İş Yatırım Price Fallback] Error for ${symbol}:`, err);
    return null;
  }
}

export async function getLiveBistHistoricalBars(symbol: string, barType: 'hourly' | 'daily' | 'weekly' | 'monthly', limit: number): Promise<BistBar[]> {
  const symbolIs = symbol.includes('=X') ? symbol : (symbol.endsWith('.IS') ? symbol : `${symbol}.IS`);
  const cacheKey = `hist_v12_${symbolIs}_${barType}`;
  
  try {
    const cached = await Cache.get<any[]>(cacheKey);
    // Rehydrate Dates
    if (cached && cached.length > 0) {
      return cached.map(b => ({ ...b, date: new Date(b.date) }));
    }
  } catch (e) {}

  let bars: BistBar[] = [];

  try {
    let interval = '1d';
    let range = '3mo';
    if (barType === 'hourly') {
      interval = '15m';
      range = '1mo';
    } else if (barType === 'weekly') {
      interval = '1wk';
      range = '2y';
    } else if (barType === 'monthly') {
      interval = '1mo';
      range = '5y';
    }
    bars = await fetchYahooRaw(symbol, interval, range) || [];
    
    // 2. Try Twelve Data Fallback if Yahoo fails
    if (bars.length === 0) {
      bars = await fetchTwelveDataFallback(symbol) || [];
    }

    // 3. Try İş Yatırım public endpoint if Twelve Data fails
    if (bars.length === 0) {
      bars = await fetchIsYatirimFallback(symbol) || [];
    }
    
    // 4. Try BiQuote if all else fails
    if (bars.length === 0 && !BIST_SYMBOLS.includes(symbol.replace('.IS', ''))) {
      const bqOhlc = await fetchBiQuoteOhlc(symbol.replace('.IS', ''), barType === 'hourly' ? '15m' : '1d');
      if (bqOhlc && bqOhlc.bars && bqOhlc.bars.length > 0) {
        bars = bqOhlc.bars.map(b => {
          const d = new Date(b.openTime);
          if (barType === 'daily' || barType === 'weekly' || barType === 'monthly') {
            d.setHours(0, 0, 0, 0); // normalize timestamp
          }
          return { date: d, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
        });
      }
    }

    if (bars && bars.length > 0) {
      const result = bars.slice(-limit);
      await Cache.set(cacheKey, result, getHistoricalTtl(barType));
      return result;
    }
  } catch (err) {}
  return [];
}

export function alignAndConvertBars(assetBars: BistBar[], usdTryBars: BistBar[]): BistBar[] {
  if (!usdTryBars || usdTryBars.length === 0) throw new Error("Historical USDTRY data unavailable");

  // Sort usdTryBars by date ascending
  const sortedRates = [...usdTryBars].sort((a, b) => a.date.getTime() - b.date.getTime());

  return assetBars.map(bar => {
    const t = bar.date.getTime();
    let bestRate = sortedRates[0].close;
    
    // Find closest rate on or before bar date
    for (const r of sortedRates) {
      if (r.date.getTime() <= t) {
        bestRate = r.close;
      } else {
        break;
      }
    }
    
    if (bestRate <= 0) bestRate = cachedUsdTry;
    
    return {
      date: bar.date,
      open: bar.open / bestRate,
      high: bar.high / bestRate,
      low: bar.low / bestRate,
      close: bar.close / bestRate,
      volume: bar.volume
    };
  });
}

export function aggregateBars(bars: BistBar[], groupSize: number): BistBar[] {
  if (groupSize <= 1 || bars.length === 0) return bars;
  const result: BistBar[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    result.push({
      date: chunk[chunk.length - 1].date,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, b) => sum + b.volume, 0)
    });
  }
  return result;
}

export interface BistLiveQuote {
  ticker: string;
  name: string;
  lastClose: number;
  change: number;
  stopLoss: number;
  score: number;
  rsi: number;
  volumeMultiple: number;
  sma20Distance: number;
  ema5: number;
  ema10: number;
  ema20: number;
  ema21: number;
  ema26: number;
  atr14: number;
  atr20: number;
  obv: number;
  ad: number;
  cmf5: number;
  cmf20: number;
  clv: number;
  mfv: number;
  supertrendUp: boolean;
  sarBullish: boolean;
  adxValue: number;
  inSqueeze: boolean;
  breakout: number;
  volumeScore: number;
  trendScore: number;
  momentumScore: number;
  structureScore: number;
  compositeScore: number;
  higherHighs: boolean;
  higherLows: boolean;
  timeframes: any[];
  recentPrices?: number[];
  obvRising?: boolean;
  priceRising?: boolean;
  volumeAnomaly?: boolean; // Hacim Patlaması / Balina
  hourlyBullish?: boolean; // MTF (1H) Onayı
  akdData?: AkdData | null; // Aracı Kurum Dağılımı
  sentimentData?: SocialSentiment | null; // Telegram/Sosyal Medya
  // New technical indicators
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  stochK: number;
  stochD: number;
  cci: number;
  priceUsd: number;
  supportTl: number;
  targetUsd: number;
  // Bollinger Bands
  bollUpper: number;
  bollLower: number;
  bollSma: number;
  bollSqueeze: boolean;
  // VWAP
  vwapValue: number;
  // Ichimoku Cloud
  ichimokuTenkan: number;
  ichimokuKijun: number;
  ichimokuSpanA: number;
  ichimokuSpanB: number;
  ichimokuChikou: number;
  ichimokuBullish: boolean;
  // ADX with DI
  adxPlus: number;
  adxMinus: number;
  // Weighted confidence score
  confidence: number;
  // Advanced analysis
  rsiDivBullish: boolean;
  rsiDivBearish: boolean;
  macdDivBullish: boolean;
  macdDivBearish: boolean;
  pivotSupports: number[];
  pivotResistances: number[];
  nearestSupport: number;
  nearestResistance: number;
  marketRegime: 'TRENDING' | 'RANGING' | 'VOLATILE';
  emaRibbon: number; // 0-3
  volumeConfirm: number; // 0-100%
  signalQuality: number; // 0-4 (how many of 4 categories agree)
  // Multi-level support/target
  support1Tl: number;   // First support (EMA26 / nearest pivot)
  support2Tl: number;   // Second support (lower Bollinger / deeper pivot)
  support3Tl: number;   // Third support (Ichimoku cloud bottom)
  target1Usd: number;   // Conservative target (1.5x ATR)
  target2Usd: number;   // Moderate target (3x ATR)
  target3Usd: number;   // Aggressive target (5x ATR)
  riskRewardRatio: number; // Reward / Risk
  recommendation: string;  // Trade recommendation text
  ema21_2d?: number;
  ema21_3d?: number;
  fibTarget2d?: number; // 1.618 Extension
  fibTarget3d?: number; // 1.618 Extension
  fib382_2d?: number;
  fib500_2d?: number;
  fib618_2d?: number;
  fib382_3d?: number;
  fib500_3d?: number;
  fib618_3d?: number;
  // Multi-Horizon Quantitative Strategy Targets
  quantHorizons?: QuantHorizons;
  // Weekly EMA26
  weeklyEma26: number;
  isWeeklyEma26Bullish: boolean;
  // Fakeout Risk
  isFakeout: boolean;
  fakeoutReasons: string[];
  // Buy Criteria
  meetsBuyCriteria: boolean;
  // Fundamental metrics from İş Yatırım
  fk?: number;
  fdd?: number;
  roe?: number;
  marketCap?: number;
  sector?: string;
  indexTag: string;
  // Dynamic Quant & ML parameters
  kalmanPriceTry: number;
  kalmanPriceUsd: number;
  kellyRecommendedSize: number;
  hmmRegimeState: 'TREND' | 'YATAY' | 'KRİZ';
  hmmRegimeConfidence: number;
  shadowFilters?: {
    isAboveWeeklyEma26: boolean;
    isCmfPositive: boolean;
    isCmfAboveThreshold: boolean;
    isRsiWithinCeiling: boolean;
    isAtrStopOk: boolean;
  };
  stopLossBroken: boolean;
  ruleResults?: any[];
  ruleSignal?: string;
  // Primary ML engine: RF + LSTM + FinBERT sentiment confluence, SHAP
  // explainability, meta-learning calibrated threshold (main_api.py sniper
  // engine). Only populated when fetchBistLiveQuote is called with
  // includeSniper=true (single-symbol analysis view) -- the full confluence
  // prediction is too slow to run per-symbol inside a bulk scan.
  sniper?: SniperPrediction | null;
}

export interface ConfluenceWeights {
  trend: number;
  momentum: number;
  volume: number;
  structure: number;
}

export async function fetchBistLiveQuote(
  symbol: string,
  _fastTrack = false,
  weights?: ConfluenceWeights,
  bulkTick?: any,
  usdTryData?: {
    usdTryDaily: BistBar[];
    usdTryHourly: BistBar[];
    usdTryWeekly: BistBar[];
    usdtry: number;
  },
  // The sniper engine's full RF+LSTM+sentiment+SHAP confluence prediction
  // takes several seconds per symbol -- fine for a single-symbol analysis
  // view, far too slow to run inside a 100-symbol bulk scan. Bulk callers
  // (scanBistSymbols/fetchBulkLiveQuotes) leave this false.
  includeSniper = false
): Promise<BistLiveQuote> {
  try {
    // Fetch fundamentals, AKD, Sentiment, and (optionally) the sniper engine's
    // own prediction in parallel / early
    const [fundamentals, akdData, sentimentData, sniperPrediction] = await Promise.all([
      fetchFundamentalMetrics(symbol).catch(() => null),
      fetchAkdData(symbol).catch(() => null),
      // Bulk scans (bulkTick set) skip news sentiment: it costs one paid LLM call
      // per symbol per scan and nothing in the scan scoring/UI consumes it.
      bulkTick ? Promise.resolve(null) : fetchSocialSentiment(symbol).catch(() => null),
      includeSniper ? getSniperPrediction(symbol).catch(() => null) : Promise.resolve(null)
    ]);

    // Try to get live tick from BiQuote or spark API
    const isBistSymbol = BIST_SYMBOLS.includes(symbol.replace('.IS', ''));
    let bqTick = bulkTick;
    if (!bqTick) {
      bqTick = await fetchBiQuoteTick(symbol.replace('.IS', '')).catch(() => null);

      if (!bqTick && isBistSymbol) {
        try {
          const sparkSymbol = symbol.endsWith('.IS') ? symbol : `${symbol}.IS`;
          const sparkUrl = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${sparkSymbol}&interval=1d&range=1d&ts=${Date.now()}`;
          const sparkRes = await fetch(sparkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
          if (sparkRes.ok) {
            const sparkData = await sparkRes.json();
            const sparkItem = sparkData?.[sparkSymbol];
            if (sparkItem?.close?.length > 0) {
              const last = sparkItem.close[sparkItem.close.length - 1];
              const prevClose = sparkItem.chartPreviousClose || last;
              bqTick = {
                last,
                dayDiffPercent: prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : 0,
                volume: 0
              };
            }
          }
        } catch {}
      }
    }

    // Always get daily bars
    const daily = await getLiveBistHistoricalBars(symbol, 'daily', 100);

    // Fetch USDTRY historical rates (use pre-fetched data if provided, else use cached)
    const usdTryDaily = usdTryData?.usdTryDaily ?? (await getLiveBistHistoricalBars('USDTRY=X', 'daily', 100).catch(() => []) || []);
    const usdTryHourly = usdTryData?.usdTryHourly ?? (await getLiveBistHistoricalBars('USDTRY=X', 'hourly', 24).catch(() => []) || []);
    const usdtry = usdTryData?.usdtry ?? (await getUsdTryRate());

    // Convert to USD bazlı barlar!
    const dailyUsd = alignAndConvertBars(daily, usdTryDaily);

    // Fetch hourly bars for a lightweight MTF (1H trend) confirmation
    const hourly = await getLiveBistHistoricalBars(symbol, 'hourly', 24).catch(() => []) || [];
    const hourlyUsd = alignAndConvertBars(hourly, usdTryHourly);
    let hourlyBullish = true;
    if (hourlyUsd.length > 5) {
      const hCloses = hourlyUsd.map(b => b.close);
      const hEma5 = ema(hCloses, 5);
      const hEma20 = ema(hCloses, 20);
      const safeHEma5 = hEma5.length > 0 ? hEma5[hEma5.length - 1] || 0 : 0;
      const safeHEma20 = hEma20.length > 0 ? hEma20[hEma20.length - 1] || 0 : 0;
      hourlyBullish = safeHEma5 > safeHEma20;
    }

    const closes = dailyUsd.map(b => b.close);
    const highs = dailyUsd.map(b => b.high);
    const lows = dailyUsd.map(b => b.low);
    const volumes = dailyUsd.map(b => b.volume);

    // Determine last close and change from native TRY prices
    const closesTry = daily.map(b => b.close);
    const lastCloseFromBars = closesTry.length > 0 ? closesTry[closesTry.length - 1] : 0;
    const prevCloseFromBars = closesTry.length > 1 ? closesTry[closesTry.length - 2] : lastCloseFromBars;

    const lastClose = bqTick?.last || lastCloseFromBars;
    let change = bqTick?.dayDiffPercent;

    if (change === undefined || change === 0) {
      change = prevCloseFromBars !== 0 ? ((lastClose - prevCloseFromBars) / prevCloseFromBars) * 100 : 0;
    }

    if (lastClose === 0) throw new Error("Price dead");

    // TICK INJECTION (Update cached history with LIVE tick converted to USD)
    if (bqTick && bqTick.last > 0) {
      const liveLastUsd = bqTick.last / usdtry;
      const todayStr = new Date().toISOString().split('T')[0];
      const lastBarDateStr = dailyUsd.length > 0 ? new Date(dailyUsd[dailyUsd.length - 1].date).toISOString().split('T')[0] : '';
      if (lastBarDateStr === todayStr) {
        closes[closes.length - 1] = liveLastUsd;
        highs[highs.length - 1] = Math.max(highs[highs.length - 1], liveLastUsd);
        lows[lows.length - 1] = Math.min(lows[lows.length - 1], liveLastUsd);
        if (bqTick.volume > 0) volumes[volumes.length - 1] = bqTick.volume;
      } else {
        closes.push(liveLastUsd);
        highs.push(liveLastUsd);
        lows.push(liveLastUsd);
        volumes.push(bqTick.volume || 0);
      }
    }

    // ─── MINIMAL CORE: RSI, a couple of EMAs, and volume ──────────────────
    const rsiVals = rsi(closes, 14);
    const safeRsi = closes.length >= 14 ? rsiVals[rsiVals.length - 1] || 50 : 50;

    const priceUsd = lastClose / usdtry;

    // Adaptive Kalman-filtered price: smooths raw closes with volatility-scaled
    // process noise, so a single noisy tick doesn't whipsaw the "smoothed"
    // reference price the way a raw last-close would. Falls back to the raw
    // price when there isn't enough history to filter meaningfully.
    const closesUsd = dailyUsd.map(b => b.close);
    const kalmanPriceTry = closesTry.length >= 5 ? smoothPrices(closesTry)[closesTry.length - 1] : lastClose;
    const kalmanPriceUsd = closesUsd.length >= 5 ? smoothPrices(closesUsd)[closesUsd.length - 1] : priceUsd;

    const sma20Vals = sma(closes, 20);
    const safeSMA20 = closes.length >= 20 ? sma20Vals[sma20Vals.length - 1] || priceUsd : priceUsd;
    const safeEMA5 = closes.length >= 5 ? ema(closes, 5)[ema(closes, 5).length - 1] || priceUsd : priceUsd;
    const safeEMA10 = closes.length >= 10 ? ema(closes, 10)[ema(closes, 10).length - 1] || priceUsd : priceUsd;
    const safeEMA20 = closes.length >= 20 ? ema(closes, 20)[ema(closes, 20).length - 1] || priceUsd : priceUsd;
    const safeEMA21 = closes.length >= 21 ? ema(closes, 21)[ema(closes, 21).length - 1] || priceUsd : priceUsd;
    const safeEMA26 = closes.length >= 26 ? ema(closes, 26)[ema(closes, 26).length - 1] || priceUsd : priceUsd;

    const atr14Vals = atrFromCloses(closes, 14);
    const safeAtr14 = closes.length >= 14 ? atr14Vals[atr14Vals.length - 1] || (priceUsd * 0.02) : (priceUsd * 0.02);
    const atr20Vals = atrFromCloses(closes, 20);
    const safeAtr20 = closes.length >= 20 ? atr20Vals[atr20Vals.length - 1] || (priceUsd * 0.02) : (priceUsd * 0.02);

    const obvVals = obv(closes, volumes);
    const safeObv = obvVals.length > 0 ? obvVals[obvVals.length - 1] || 0 : 0;

    const adVals = accumulationDistribution(highs, lows, closes, volumes);
    const safeAd = adVals.length > 0 ? adVals[adVals.length - 1] || 0 : 0;
    const prevAd = adVals.length > 1 ? adVals[adVals.length - 2] || 0 : 0;

    const cmf5Vals = chaikinMoneyFlow(highs, lows, closes, volumes, 5);
    const safeCmf5 = cmf5Vals.length > 0 ? cmf5Vals[cmf5Vals.length - 1] || 0 : 0;

    const cmf20Vals = chaikinMoneyFlow(highs, lows, closes, volumes, 20);
    const safeCmf20 = cmf20Vals.length > 0 ? cmf20Vals[cmf20Vals.length - 1] || 0 : 0;

    const currentHigh = highs.length > 0 ? highs[highs.length - 1] : priceUsd;
    const currentLow = lows.length > 0 ? lows[lows.length - 1] : priceUsd;
    const currentVol = volumes.length > 0 ? volumes[volumes.length - 1] : 0;

    // Hacim Anomalisi Tespiti (Balina Tespiti)
    const vol10 = volumes.slice(Math.max(0, volumes.length - 11), volumes.length - 1);
    const avgVol10 = vol10.length > 0 ? vol10.reduce((a, b) => a + b, 0) / vol10.length : 0;
    const volumeAnomaly = avgVol10 > 0 && currentVol > (avgVol10 * 3); // %300 patlama

    const safeClv = (currentHigh !== currentLow) ? clv(currentHigh, currentLow, priceUsd) : 0;
    const safeMfv = safeClv * currentVol;

    // Core Logical Flags
    const priceRising = closes.length > 1 ? closes[closes.length - 1] > closes[closes.length - 2] : false;
    const obvRising = obvVals.length > 1 ? obvVals[obvVals.length - 1] > obvVals[obvVals.length - 2] : false;

    // Volume trend confirmation
    const volConfirm = volumeTrendConfirmation(closes, volumes, 10);

    let currentStopLoss = Math.min(safeEMA21, safeEMA26) * usdtry;

    // ─── SIMPLE MULTI-HORIZON TARGET (ATR based — no Fibonacci/pivot math) ─
    const quantHorizons = calculateQuantHorizons(closes, highs, lows, safeAtr14, priceUsd, usdtry);
    const target1Usd = quantHorizons.shortTerm.targetUsd;
    const target2Usd = quantHorizons.mediumTerm.targetUsd;
    const target3Usd = quantHorizons.longTerm.targetUsd;
    const targetUsd = target2Usd; // default mid target

    // ─── REGIME-ADAPTIVE & CUSTOM WEIGHTED SCORING (simplified) ──────────
    // Regime now comes solely from the HMM/volatility regime detector below
    // (the one part of the old indicator stack with a real theoretical
    // basis) instead of an ADX/Bollinger-width heuristic.
    const wTrend = weights?.trend ?? 35;
    const wMomentum = weights?.momentum ?? 25;
    const wVolume = weights?.volume ?? 25;
    const wStructure = weights?.structure ?? 15;

    // Trend Category — EMA alignment + price vs EMA20 (was 6 indicators incl. Ichimoku/Supertrend/SAR)
    const trendActive = [
      safeEMA5 > safeEMA20,
      lastClose > safeEMA20,
      safeEMA20 > safeEMA26,
    ].filter(Boolean).length;
    const trendScore = Math.round((trendActive / 3) * 100);

    // Momentum Category — RSI + OBV only (was 6 indicators incl. MACD/Stochastic/CCI)
    const momentumActive = [
      safeRsi > 40 && safeRsi < 70,
      priceRising ? obvRising : !obvRising,
    ].filter(Boolean).length;
    const momentumScore = Math.round((momentumActive / 2) * 100);

    // Volume & Money Flow Category (unchanged — this was the one category with real signal)
    const volumeActive = [
      safeCmf20 > 0,
      priceRising ? obvRising : (!priceRising && obvRising),
      volConfirm >= 60,
      safeAd > prevAd
    ].filter(Boolean).length;
    const volumeScore = Math.round((volumeActive / 4) * 100);

    // The dedicated "structure" category (Supertrend/SAR/ADX+DI/Bollinger
    // bounce/squeeze/pivot-support) was entirely made up of removed
    // indicators; it's folded into a trend/volume blend rather than an
    // independent signal so the weights UI (trend/momentum/volume/structure
    // sliders) keeps working without a fifth fake category.
    const structureScore = Math.round((trendScore + volumeScore) / 2);

    const signalQuality = [
      trendScore >= 40,
      momentumScore >= 40,
      volumeScore >= 40,
    ].filter(Boolean).length;

    const totalW = wTrend + wMomentum + wVolume + wStructure;
    const rawComposite = ((wTrend * trendScore) + (wMomentum * momentumScore) + (wVolume * volumeScore) + (wStructure * structureScore)) / totalW;
    const compositeScore = Math.round(rawComposite);
    const adjustedConfidence = compositeScore;
    const score = compositeScore;

    // ─── MULTI-LEVEL SUPPORT (TRY) — simple % ladder off the EMA stop ────
    const support1Tl = currentStopLoss;
    const support2Tl = currentStopLoss * 0.97;
    const support3Tl = currentStopLoss * 0.94;

    // ─── DYNAMIC STOP LOSS & BROKEN CHECK ────────────────────
    const initialStopLoss = Math.min(safeEMA21, safeEMA26) * usdtry;
    currentStopLoss = initialStopLoss;
    let stopLossBroken = false;

    if (lastClose < initialStopLoss) {
      stopLossBroken = true;
      const baseSupport = support1Tl < lastClose ? support1Tl : (support2Tl < lastClose ? support2Tl : lastClose * 0.95);
      currentStopLoss = baseSupport * 0.98; // place stop loss 2% below active support
    }

    const meetsBuyCriteria = finalScoreMeetsBuyCriteria(compositeScore, stopLossBroken);

    // Shadow filters evaluation (logged for out-of-sample shadow testing)
    const shadowFilters = {
      isAboveWeeklyEma26: true, // weekly EMA26 gate removed with the rest of the multi-timeframe stack
      isCmfPositive: safeCmf20 > 0,
      isCmfAboveThreshold: safeCmf20 > 0.05,
      isRsiWithinCeiling: safeRsi < 75,
      isAtrStopOk: !stopLossBroken,
    };

    // ─── RISK/REWARD RATIO ───────────────────────────────────
    const risk = Math.max(lastClose - support1Tl, lastClose * 0.01); // min 1% risk
    const reward = (target2Usd * usdtry) - lastClose;
    const riskRewardRatio = reward > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

    // ─── TRADE RECOMMENDATION (simplified) ─────────────────────
    let recommendation = '';
    if (stopLossBroken) {
      recommendation = `⚠️ STOP KIRILDI (YENİ ANALİZ): Fiyat ana stop seviyesinin (${initialStopLoss.toFixed(2)}₺) altına sarktı. Yeni stop ${currentStopLoss.toFixed(2)}₺ ve destekler (${support1Tl.toFixed(2)}₺ / ${support2Tl.toFixed(2)}₺) takip edilerek kademeli alım veya izleme yapılabilir. Hedef: $${targetUsd.toFixed(2)}`;
    } else if (meetsBuyCriteria) {
      recommendation = `✅ ONAYLI AL: Kompozit %${compositeScore} (Trend %${trendScore}, Momentum %${momentumScore}, Hacim %${volumeScore}). Giriş: ${lastClose.toFixed(2)}₺ | Stop: ${currentStopLoss.toFixed(2)}₺ | Hedef: $${targetUsd.toFixed(2)}`;
    } else if (adjustedConfidence >= 55 && signalQuality >= 2) {
      recommendation = `🟡 AL: Confluans ${adjustedConfidence}%, Kalite ${signalQuality}/3. Giriş: ${lastClose.toFixed(2)}₺ | S1: ${support1Tl.toFixed(2)}₺ | Hedef: $${target1Usd.toFixed(2)}`;
    } else if (adjustedConfidence >= 40) {
      recommendation = `🟠 İZLE: Confluans gelişiyor (${adjustedConfidence}%). Destek ${support1Tl.toFixed(2)}₺ testinde giriş fırsatı beklenebilir. Hedef: $${target1Usd.toFixed(2)}`;
    } else if (volumeAnomaly) {
      recommendation = `🐳 BALİNA ALARMI: Hacimde %300+ devasa patlama tespit edildi! (Günlük Ort. ${avgVol10.toFixed(0)} -> Anlık ${currentVol.toFixed(0)})`;
    } else if (adjustedConfidence >= 30) {
      recommendation = `🔵 BEKLE: Confluans zayıf (${adjustedConfidence}%). ${support2Tl.toFixed(2)}₺ desteğinde dip alım fırsatı oluşabilir.`;
    } else {
      recommendation = `🔴 KAÇIN: Confluans çok düşük (${adjustedConfidence}%). Trend olumsuz, yeni pozisyon açılmamalı.`;
    }

    // ─── HMM VOLATILITY REGIME DETECTION ───────────────────────────────
    // Previously called main.py's /api/regime (port 8000, the old engine)
    // with a JS fallback. main.py is no longer part of the active system —
    // the sniper engine (main_api.py) is primary now, and when it's
    // available (single-symbol analysis views, includeSniper=true) its own
    // regime classification is used directly instead of making a second
    // network round-trip. Bulk scans (includeSniper=false) always use the
    // native TS implementation, which has no external dependency at all.
    const REGIME_CODE_TO_STATE: Record<number, 'TREND' | 'YATAY' | 'KRİZ'> = { 0: 'YATAY', 1: 'TREND', 2: 'KRİZ' };
    let hmmRegimeState: 'TREND' | 'YATAY' | 'KRİZ' = 'YATAY';
    let hmmRegimeConfidence = 50;
    if (sniperPrediction?.features?.regime_code != null) {
      hmmRegimeState = REGIME_CODE_TO_STATE[Math.round(sniperPrediction.features.regime_code)] ?? 'YATAY';
      hmmRegimeConfidence = Math.round((sniperPrediction.features.regime_confidence ?? 0.5) * 100);
    } else {
      try {
        const { detectMarketRegime } = await import("./quant/regime");
        const rollingClosesUsd = dailyUsd.map(b => b.close);
        const regimeResult = detectMarketRegime(rollingClosesUsd, 20);
        hmmRegimeState = regimeResult.regime;
        hmmRegimeConfidence = Math.round(regimeResult.confidence * 100);
      } catch (tsErr) {
        console.warn("[bist.ts] TS HMM regime detection failed:", tsErr);
      }
    }
    const marketRegime: 'TRENDING' | 'RANGING' | 'VOLATILE' =
      hmmRegimeState === 'TREND' ? 'TRENDING' : hmmRegimeState === 'KRİZ' ? 'VOLATILE' : 'RANGING';

    // ─── FRACTIONAL KELLY SIZING ENGINE (kept — python_bot/engine/shield analog) ─
    let kellyRecommendedSize = 0.05; // safe fallback (5%)
    try {
      const { getKellySizingForSymbol } = await import("./quant/kelly");
      const winRateProxy = Math.max(0.4, Math.min(0.85, score / 100));
      const calculatedSizing = await getKellySizingForSymbol(symbol, winRateProxy * 0.15);

      let regimeScale = 1.0;
      if (hmmRegimeState === 'KRİZ') {
        regimeScale = 0.0; // Freeze allocation in crisis
      } else if (hmmRegimeState === 'YATAY') {
        regimeScale = 0.7; // Moderate sizing in ranging
      }

      kellyRecommendedSize = Math.max(0.02, Math.min(0.25, calculatedSizing * regimeScale));
    } catch (kSizingErr) {
      console.warn("[bist.ts] Kelly sizing engine failed:", kSizingErr);
    }

    return {
      ticker: symbol,
      name: bqTick?.description || symbol,
      indexTag: getIndexTag(symbol),
      lastClose,
      change,
      stopLoss: currentStopLoss,
      score,
      rsi: safeRsi,
      volumeMultiple: 1.2,
      sma20Distance: safeSMA20 !== 0 ? ((lastClose - safeSMA20) / safeSMA20) * 100 : 0,
      ema5: safeEMA5,
      ema10: safeEMA10,
      ema20: safeEMA20,
      ema21: safeEMA21,
      ema26: safeEMA26,
      atr14: safeAtr14,
      atr20: safeAtr20,
      obv: safeObv,
      ad: safeAd,
      cmf5: safeCmf5,
      cmf20: safeCmf20,
      clv: safeClv,
      mfv: safeMfv,
      // Removed indicators below are inert/neutral placeholders, not live
      // computations — see the NOTE at the top of this file.
      supertrendUp: false,
      sarBullish: false,
      adxValue: 0,
      inSqueeze: false,
      breakout: 0,
      volumeScore,
      trendScore,
      momentumScore,
      structureScore,
      compositeScore,
      higherHighs: priceRising,
      higherLows: lows.length > 1 ? lows[lows.length-1] > lows[lows.length-2] : false,
      timeframes: [],
      recentPrices: closes.slice(-20),
      obvRising,
      priceRising,
      volumeAnomaly,
      hourlyBullish,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      stochK: 50,
      stochD: 50,
      cci: 0,
      priceUsd,
      supportTl: currentStopLoss,
      targetUsd,
      bollUpper: priceUsd * 1.02,
      bollLower: priceUsd * 0.98,
      bollSma: priceUsd,
      bollSqueeze: false,
      vwapValue: priceUsd,
      ichimokuTenkan: priceUsd,
      ichimokuKijun: priceUsd,
      ichimokuSpanA: priceUsd,
      ichimokuSpanB: priceUsd,
      ichimokuChikou: priceUsd,
      ichimokuBullish: false,
      adxPlus: 0,
      adxMinus: 0,
      confidence: adjustedConfidence,
      rsiDivBullish: false,
      rsiDivBearish: false,
      macdDivBullish: false,
      macdDivBearish: false,
      pivotSupports: [],
      pivotResistances: [],
      nearestSupport: support1Tl / usdtry,
      nearestResistance: priceUsd * 1.05,
      marketRegime,
      emaRibbon: 0,
      volumeConfirm: volConfirm,
      signalQuality,
      support1Tl,
      support2Tl,
      support3Tl,
      target1Usd,
      target2Usd,
      target3Usd,
      riskRewardRatio,
      recommendation,
      ema21_2d: 0,
      ema21_3d: 0,
      fibTarget2d: 0,
      fibTarget3d: 0,
      fib382_2d: 0,
      fib500_2d: 0,
      fib618_2d: 0,
      fib382_3d: 0,
      fib500_3d: 0,
      fib618_3d: 0,
      quantHorizons,
      weeklyEma26: 0,
      isWeeklyEma26Bullish: true,
      isFakeout: false,
      fakeoutReasons: [],
      meetsBuyCriteria,
      stopLossBroken,
      fk: fundamentals?.fk,
      fdd: fundamentals?.fdd,
      roe: fundamentals?.roe,
      marketCap: fundamentals?.marketCap,
      sector: fundamentals?.sector,
      akdData,
      sentimentData,
      kalmanPriceTry: kalmanPriceTry,
      kalmanPriceUsd: kalmanPriceUsd,
      kellyRecommendedSize,
      hmmRegimeState,
      hmmRegimeConfidence,
      shadowFilters,
      ruleResults: [],
      ruleSignal: 'WEAK',
      sniper: sniperPrediction,
    };
  } catch (err) {
    console.error(`[bist.ts] Error in fetchBistLiveQuote for ${symbol}:`, err);
    return {
      ticker: symbol, name: symbol, lastClose: 0, change: 0, stopLoss: 0, score: 0, compositeScore: 0, trendScore: 0, momentumScore: 0, volumeScore: 0, structureScore: 0, rsi: 50, volumeMultiple: 1, sma20Distance: 0, ema5: 0, ema10: 0, ema20: 0, ema21: 0, ema26: 0, atr14: 0, atr20: 0, obv: 0, ad: 0, cmf5: 0, cmf20: 0, clv: 0, mfv: 0, supertrendUp: false, sarBullish: false, adxValue: 0, inSqueeze: false, breakout: 0, higherHighs: false, higherLows: false, timeframes: [], macd: 0, macdSignal: 0, macdHistogram: 0, stochK: 50, stochD: 50, cci: 0, priceUsd: 0, supportTl: 0, targetUsd: 0, bollUpper: 0, bollLower: 0, bollSma: 0, bollSqueeze: false, vwapValue: 0, ichimokuTenkan: 0, ichimokuKijun: 0, ichimokuSpanA: 0, ichimokuSpanB: 0, ichimokuChikou: 0, ichimokuBullish: false, adxPlus: 0, adxMinus: 0, confidence: 0, rsiDivBullish: false, rsiDivBearish: false, macdDivBullish: false, macdDivBearish: false, pivotSupports: [], pivotResistances: [], nearestSupport: 0, nearestResistance: 0, marketRegime: 'RANGING', emaRibbon: 0, volumeConfirm: 0, signalQuality: 0, support1Tl: 0, support2Tl: 0, support3Tl: 0, target1Usd: 0, target2Usd: 0, target3Usd: 0, riskRewardRatio: 0, recommendation: 'Veri yok',
      fib382_2d: 0, fib500_2d: 0, fib618_2d: 0, fib382_3d: 0, fib500_3d: 0, fib618_3d: 0, fibTarget2d: 0, fibTarget3d: 0, ema21_2d: 0, ema21_3d: 0,
      weeklyEma26: 0, isWeeklyEma26Bullish: false, isFakeout: false, fakeoutReasons: [], meetsBuyCriteria: false,
      fk: 0, fdd: 0, roe: 0, marketCap: 0, sector: 'Bilinmiyor', indexTag: '',
      kalmanPriceTry: 0, kalmanPriceUsd: 0, kellyRecommendedSize: 0.05, hmmRegimeState: 'YATAY', hmmRegimeConfidence: 50,
      shadowFilters: { isAboveWeeklyEma26: true, isCmfPositive: true, isCmfAboveThreshold: false, isRsiWithinCeiling: true, isAtrStopOk: true },
      stopLossBroken: false,
      ruleResults: [],
      ruleSignal: 'WEAK'
    };
  }
}

function finalScoreMeetsBuyCriteria(compositeScore: number, stopLossBroken: boolean): boolean {
  return compositeScore >= 65 && !stopLossBroken;
}

export function recalculateScoreWithWeights(quote: BistLiveQuote, weights: ConfluenceWeights, params?: any) {
  // Composite math for UI sliders
  const wTrendNorm = weights?.trend ?? 35;
  const wMomentumNorm = weights?.momentum ?? 25;
  const wVolumeNorm = weights?.volume ?? 25;
  const wStructureNorm = weights?.structure ?? 15;

  const totalW = wTrendNorm + wMomentumNorm + wVolumeNorm + wStructureNorm;
  const rawComposite = ((wTrendNorm * quote.trendScore) + (wMomentumNorm * quote.momentumScore) + (wVolumeNorm * quote.volumeScore) + (wStructureNorm * quote.structureScore)) / totalW;

  const adjustedConfidence = Math.round(rawComposite);

  const meetsBuyCriteria = finalScoreMeetsBuyCriteria(adjustedConfidence, quote.stopLossBroken);

  const shadowFilters = {
    isAboveWeeklyEma26: true,
    isCmfPositive: quote.cmf20 > 0,
    isCmfAboveThreshold: quote.cmf20 > 0.05,
    isRsiWithinCeiling: quote.rsi < 75,
    isAtrStopOk: !quote.stopLossBroken,
  };

  // Regenerate trade recommendation with new scores
  let recommendation = '';
  if (meetsBuyCriteria) {
    recommendation = `✅ ONAYLI AL: Kompozit %${adjustedConfidence} (Trend %${quote.trendScore}, Momentum %${quote.momentumScore}). Giriş: ${quote.lastClose.toFixed(2)}₺ | Stop: ${quote.support1Tl.toFixed(2)}₺`;
  } else if (adjustedConfidence >= 55 && quote.signalQuality >= 2) {
    recommendation = `🟡 AL: Confluans ${adjustedConfidence}%, Kalite ${quote.signalQuality}/3. Giriş: ${quote.lastClose.toFixed(2)}₺ | S1: ${quote.support1Tl.toFixed(2)}₺ | Hedef: $${quote.target1Usd.toFixed(2)}`;
  } else if (adjustedConfidence >= 40) {
    recommendation = `🟠 İZLE: Confluans gelişiyor (${adjustedConfidence}%). Destek ${quote.support1Tl.toFixed(2)}₺ testinde giriş fırsatı beklenebilir. Hedef: $${quote.target1Usd.toFixed(2)}`;
  } else if (adjustedConfidence >= 30) {
    recommendation = `🔵 BEKLE: Confluans zayıf (${adjustedConfidence}%). ${quote.support2Tl.toFixed(2)}₺ desteğinde dip alım fırsatı oluşabilir.`;
  } else {
    recommendation = `🔴 KAÇIN: Confluans çok düşük (${adjustedConfidence}%). Trend olumsuz, yeni pozisyon açılmamalı.`;
  }

  const tempQuote = {
    ...quote,
    confidence: adjustedConfidence,
    score: adjustedConfidence,
    meetsBuyCriteria,
  };
  const evalRes = evaluateRiseSignal(tempQuote, params);

  return {
    confidence: adjustedConfidence,
    score: adjustedConfidence,
    status: evalRes.status,
    reasons: evalRes.reasons,
    alert: evalRes.alert,
    recommendation,
    shadowFilters,
  };
}

export async function fetchBulkLiveQuotes(symbols: string[]) {
  const liveData = new Map<string, any>();
  try {
    const batchSize = 20;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const chunk = symbols.slice(i, i + batchSize);
      const cleanSymbols = chunk.map(s => s.replace('.IS', ''));
      
      const bqParams = cleanSymbols.map(s => `symbols=${s}`).join('&');
      const bqUrl = `https://biquote.io/api/latest?${bqParams}`;
      const missingFromBq: string[] = [];
      
      try {
        const bqRes = await fetch(bqUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://biquote.io/'
          },
          cache: 'no-store'
        });
        
        if (bqRes.ok) {
          const bqData = await bqRes.json();
          if (bqData && typeof bqData === 'object' && !bqData.message) {
            for (const sym of cleanSymbols) {
              const tick = bqData[sym];
              if (tick && typeof tick.last === 'number') {
                liveData.set(sym, {
                  last: tick.last,
                  dayDiffPercent: typeof tick.dayDiffPercent === 'number' ? tick.dayDiffPercent : 0,
                  volume: tick.volume || 0
                });
              } else {
                missingFromBq.push(sym);
              }
            }
          } else {
            missingFromBq.push(...cleanSymbols);
          }
        } else {
          missingFromBq.push(...cleanSymbols);
        }
      } catch {
        missingFromBq.push(...cleanSymbols);
      }
      
      // Fallback to Yahoo Spark for any missing symbols in this chunk
      if (missingFromBq.length > 0) {
        const formattedSymbols = missingFromBq.map(s => s.includes('=X') ? s : `${s}.IS`).join(',');
        const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${formattedSymbols}&interval=1d&range=1d&ts=${Date.now()}`;
        try {
          const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            cache: 'no-store'
          });
          if (res.ok) {
            const data = await res.json();
            if (data) {
              for (const key of Object.keys(data)) {
                const item = data[key];
                if (item && item.close && item.close.length > 0) {
                  const sym = item.symbol.replace('.IS', '');
                  const last = item.close[item.close.length - 1];
                  const prevClose = item.chartPreviousClose || last;
                  const dayDiffPercent = prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : 0;
                  liveData.set(sym, {
                    last: last,
                    dayDiffPercent: dayDiffPercent,
                    volume: 0
                  });
                }
              }
            }
          }
        } catch (err) {
          console.error("Bulk Yahoo Finance fallback fetch error:", err);
        }
      }
    }
  } catch (err) {
    console.error("Bulk fetch error:", err);
  }
  console.log(`[fetchBulkLiveQuotes] Successfully fetched ${liveData.size} symbols.`);
  return liveData;
}

export async function scanBistSymbols(symbols: string[], params: any) {
  const results: any[] = [];
  const targetSymbols = symbols;
  
  // Extract custom slider weights if passed in params
  const weights: ConfluenceWeights | undefined = params?.weights;
  
  console.log(`[Scanner] Fetching bulk live quotes for ${targetSymbols.length} symbols...`);
  const bulkTicks = await fetchBulkLiveQuotes(targetSymbols);

  // Pre-fetch USD/TRY data ONCE for the entire scan to avoid redundant thousand of operations
  console.log("[Scanner] Pre-fetching USD/TRY rates once...");
  const usdTryDaily = await getLiveBistHistoricalBars('USDTRY=X', 'daily', 100).catch(() => []) || [];
  const usdTryHourly = await getLiveBistHistoricalBars('USDTRY=X', 'hourly', 24).catch(() => []) || [];
  const usdTryWeekly = await getLiveBistHistoricalBars('USDTRY=X', 'weekly', 100).catch(() => []) || [];
  const usdtry = await getUsdTryRate();
  const usdTryData = { usdTryDaily, usdTryHourly, usdTryWeekly, usdtry };
  
  // INCREASED CONCURRENT BATCHING (50 at a time since data is mostly cached/bulk-fetched)
  const batchSize = 50;
  for (let i = 0; i < targetSymbols.length; i += batchSize) {
    const batch = targetSymbols.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (symbol) => {
      try {
        const bulkTick = bulkTicks.get(symbol);
        // Full analysis for every stock (User requested: no skipping)
        const quote = await fetchBistLiveQuote(symbol, false, weights, bulkTick, usdTryData);
        if (quote.lastClose > 0) {
          const evalRes = evaluateRiseSignal(quote, params);
          return { symbol, quote, confluenceScore: quote.score, status: evalRes.status, reasons: evalRes.reasons, alert: evalRes.alert };
        }
      } catch (err) {
        return null;
      }
      return null;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(r => r !== null));
    
    // Minimal delay between batches to let the event loop breathe
    if (i + batchSize < targetSymbols.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return results;
}

export async function fetchChartData(symbol: string, currency: 'try' | 'usd' = 'try') {
  console.time(`fetchChartData:${symbol}:${currency}`);
  let daily = await getLiveBistHistoricalBars(symbol, 'daily', 200);
  if (!daily || daily.length === 0) {
    console.timeEnd(`fetchChartData:${symbol}:${currency}`);
    return { chartData: [], fvgs: [], obs: [], vpvr: { profile: [], pocPrice: 0 } };
  }

  // Convert to USD if requested
  if (currency === 'usd' && symbol !== 'USDTRY=X') {
    const usdTryDaily = await getLiveBistHistoricalBars('USDTRY=X', 'daily', 200).catch(() => []) || [];
    daily = alignAndConvertBars(daily, usdTryDaily);
  }

  console.time(`indicators:${symbol}`);
  const closes = daily.map(b => b.close);
  const sma20Vals = sma(closes, 20);
  const sma50Vals = sma(closes, 50);
  const sma200Vals = sma(closes, 200);
  const bbVals = bollingerBands(closes, 20, 2);
  const rsiVals = rsi(closes, 14);
  const tsiVals = linearTSI(closes, 13, 25);
  const macdVals = macd(closes, 12, 26, 9);
  const stochVals = stochastic(closes, 14, 3, 3);
  const cciVals = cci(closes, 20);

  const fvgs = fairValueGaps(daily.map(b => b.high), daily.map(b => b.low));
  const obs = orderBlocks(
    daily.map(b => b.open),
    closes,
    daily.map(b => b.high),
    daily.map(b => b.low),
    daily.map(b => b.volume),
    atrFromCloses(closes, 14)
  );
  
  const volProfile = vpvr(closes, daily.map(b => b.volume), 24);

  // 2-Day & 3-Day EMA 21
  const twoDayBars = aggregateBars(daily, 2);
  const twoDayCloses = twoDayBars.map(b => b.close);
  const ema21_2d_vals = ema(twoDayCloses, 21);
  const currentEma21_2d = ema21_2d_vals.length > 0 ? ema21_2d_vals[ema21_2d_vals.length - 1] : null;

  const threeDayBars = aggregateBars(daily, 3);
  const threeDayCloses = threeDayBars.map(b => b.close);
  const ema21_3d_vals = ema(threeDayCloses, 21);
  const currentEma21_3d = ema21_3d_vals.length > 0 ? ema21_3d_vals[ema21_3d_vals.length - 1] : null;

  const safeEma21_2d = (currentEma21_2d === null || isNaN(currentEma21_2d)) ? null : currentEma21_2d;
  const safeEma21_3d = (currentEma21_3d === null || isNaN(currentEma21_3d)) ? null : currentEma21_3d;

  const fib2d = calculateFibLevels(twoDayBars.map(b => b.high), twoDayBars.map(b => b.low), 50);
  const fib3d = calculateFibLevels(threeDayBars.map(b => b.high), threeDayBars.map(b => b.low), 50);

  console.timeEnd(`indicators:${symbol}`);
  console.timeEnd(`fetchChartData:${symbol}`);

  const chartData = daily.map((bar, i) => ({ 
    date: bar.date.toISOString().split('T')[0], 
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    price: bar.close, // Alias for InteractiveChart compatibility
    volume: bar.volume,
    sma20: sma20Vals[i] || null,
    sma50: sma50Vals[i] || null,
    sma200: sma200Vals[i] || null,
    bollUpper: bbVals.upper[i] || null,
    bollMid: bbVals.sma[i] || null,
    bollLower: bbVals.lower[i] || null,
    rsi: rsiVals[i] || null,
    tsi: tsiVals.tsi[i] || null,
    macd: macdVals.macd[i] || null,
    macdSignal: macdVals.signal[i] || null,
    macdHist: macdVals.histogram[i] || null,
    stochK: stochVals.k[i] || null,
    stochD: stochVals.d[i] || null,
    cci: cciVals[i] || null,
  }));

  return { 
    chartData, 
    fvgs, 
    obs, 
    vpvr: volProfile, 
    ema21_2d: safeEma21_2d, 
    ema21_3d: safeEma21_3d,
    fibTarget2d: fib2d.ext1618,
    fibTarget3d: fib3d.ext1618
  };
}

export function evaluateRiseSignal(quote: any, params: any) {
  const reasons: string[] = [];

  // Trend
  if (quote.ema5 > quote.ema20) reasons.push("EMA 5/20 Kesişimi (Momentum)");
  else if (quote.lastClose > quote.ema20) reasons.push("EMA 20 Üzeri (Trend)");

  // Money flow
  if (quote.cmf20 > 0) reasons.push("CMF > 0 (Para Girişi)");

  // OBV
  if (quote.obvRising && !quote.priceRising) reasons.push("OBV Gizli Toplama (Boğa Uyumsuzluğu)");
  else if (quote.obvRising && quote.priceRising) reasons.push("OBV Hacim Onayı");

  if (quote.clv > 0.5) reasons.push("CLV Alım Baskısı");

  // RSI
  if (quote.rsi < 30) reasons.push("RSI Aşırı Satım (Dip Fırsatı)");
  else if (quote.rsi > 70) reasons.push("RSI Aşırı Alım (Dikkat)");

  // Market regime context (HMM — the one indicator kept with a real theoretical basis)
  if (quote.marketRegime === 'TRENDING') reasons.push("Piyasa Rejimi: TREND");
  else if (quote.marketRegime === 'RANGING') reasons.push("Piyasa Rejimi: YATAY");
  else if (quote.marketRegime === 'VOLATILE') reasons.push("Piyasa Rejimi: VOLATİL (Yüksek Risk)");

  // Signal quality
  if (quote.signalQuality >= 3) reasons.push("✅ Tüm Kategoriler Onay (İyi Confluans)");
  else if (quote.signalQuality <= 1) reasons.push("🔴 Zayıf Confluans (Dikkatli Ol)");

  // Volume confirmation
  if (quote.volumeConfirm >= 70) reasons.push(`Hacim Trendi Onayı (%${quote.volumeConfirm})`);

  if (quote.meetsBuyCriteria) {
    reasons.unshift("✅ ONAYLI AL: Kompozit skor eşiğinin üzerinde ve stop kırılmadı!");
  }

  const conf = quote.confidence || quote.score || 0;
  let status = 'İZLE';
  let alert = false;

  if (quote.meetsBuyCriteria) {
    status = 'AL';
    alert = true;
  } else if (conf >= (params?.minScore || 65) && quote.signalQuality >= 2) {
    status = 'POTANSİYEL';
    alert = false;
  } else if (conf > 35) {
    status = 'İZLE';
    alert = false;
  } else {
    status = 'ZAYIF';
    alert = false;
  }

  return { alert, status, reasons: reasons.slice(0, 10) };
}
