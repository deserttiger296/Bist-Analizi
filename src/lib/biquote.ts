/**
 * BiQuote API client for real-time BIST market data
 * Free, no authentication required, CORS enabled
 * Docs: https://biquote.io/docs
 */

const BIQUOTE_API = 'https://biquote.io/api';

export interface BiQuoteTick {
  symbol: string;
  description: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  timestamp: string;
  source: string;
  type: string;
  mid: number;
  spread: number;
  high: number;
  low: number;
  direction: string;
  dayDiffPercent: number;
}

export interface BiQuoteOhlcBar {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume: number;
  isOpen: boolean;
}

export interface BiQuoteOhlc {
  symbol: string;
  interval: string;
  bars: BiQuoteOhlcBar[];
}

export async function fetchBiQuoteTick(symbol: string): Promise<BiQuoteTick | null> {
  try {
    const response = await fetch(`${BIQUOTE_API}/${symbol}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://biquote.io/'
      },
    });

    if (!response.ok) {
      console.warn(`BiQuote tick fetch failed for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data && (data.message || typeof data.last !== 'number')) {
      return null;
    }
    return data || null;
  } catch (error) {
    console.error(`BiQuote tick error for ${symbol}:`, error);
    return null;
  }
}

export async function fetchBiQuoteOhlc(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1M' = '1d'
): Promise<BiQuoteOhlc | null> {
  try {
    const response = await fetch(`${BIQUOTE_API}/Ohlc/${symbol}?interval=${interval}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://biquote.io/'
      },
    });

    if (!response.ok) {
      console.warn(`BiQuote OHLC fetch failed for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data || null;
  } catch (error) {
    console.error(`BiQuote OHLC error for ${symbol}:`, error);
    return null;
  }
}

export async function fetchBiQuoteHistoricalBars(
  symbol: string,
  interval: '1h' | '1d' | '1w' | '1M' = '1d',
  limit: number = 100
): Promise<number[]> {
  const ohlc = await fetchBiQuoteOhlc(symbol, interval);
  if (!ohlc || !ohlc.bars.length) {
    return [];
  }
  return ohlc.bars.map(bar => bar.close).slice(-limit);
}
