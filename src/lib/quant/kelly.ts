// src/lib/quant/kelly.ts
// Fractional Kelly Position Sizing Engine — Institutional Risk Control
// Dynamic allocation scaling using win-rate (p) and profit/loss odds (b) with local statistical estimation and 24h caching.

/**
 * Core mathematical Kelly formula.
 * @param p Win rate (between 0.0 and 1.0).
 * @param avgProfit Average profit percentage of winning trades (e.g., 0.08 for 8%).
 * @param avgLoss Average loss percentage of losing trades (e.g., 0.02 for 2%).
 * @param fraction Fractional multiplier (e.g., 0.25 for 1/4 Kelly, kurumsal standart).
 */
export function calculateKellyFraction(
  p: number,
  avgProfit: number,
  avgLoss: number,
  fraction: number = 0.25
): number {
  if (avgLoss <= 0 || avgProfit <= 0) return 0.05; // Default safe sizing if odds cannot be determined
  if (p <= 0.3) return 0.02; // Extremely low win rate -> floor size

  // b = Odds = Ortalama Kazanç / Ortalama Kayıp
  const b = avgProfit / avgLoss;

  // f* = (b * p - q) / b = (b * p - (1 - p)) / b
  const q = 1.0 - p;
  const rawKelly = (b * p - q) / b;

  // Apply fractional scale (e.g., 1/4 Kelly)
  const scaledKelly = rawKelly * fraction;

  // Enforce institutional boundaries: minimum 2%, maximum 25% of total capital per trade
  return Math.max(0.02, Math.min(0.25, scaledKelly));
}

interface KellyCacheEntry {
  sizing: number;
  expiresAt: number;
}

// In-memory cache for symbol sizing to prevent redundant calculations
const kellyCache = new Map<string, KellyCacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours TTL

/**
 * Service function to calculate the dynamic Kelly position multiplier for a given symbol.
 * Uses a local statistical model based on the confluence score proxy and caches results in-memory.
 * @param symbol Stock ticker symbol.
 * @param scoreProxy Confluence score proxy (value between 0.40 and 0.85, representing estimated win probability).
 */
export async function getKellySizingForSymbol(
  symbol: string,
  scoreProxy: number = 0.60
): Promise<number> {
  const now = Date.now();
  const cached = kellyCache.get(symbol);
  if (cached && cached.expiresAt > now) {
    return cached.sizing;
  }

  // Local statistical estimation of win rate from the scoreProxy
  const winRate = Math.max(0.35, Math.min(0.85, scoreProxy));

  // BIST institutional benchmark parameters:
  // Average win of 8% (0.08) and average loss of 3% (0.03) based on BIST historical drawdowns
  const avgWinPct = 0.08;
  const avgLossPct = 0.03;

  const sizing = calculateKellyFraction(winRate, avgWinPct, avgLossPct, 0.25);

  // Cache the result to eliminate any redundant overhead
  kellyCache.set(symbol, {
    sizing,
    expiresAt: now + CACHE_TTL
  });

  return sizing;
}
