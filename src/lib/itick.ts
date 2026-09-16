/**
 * iTick API client for real-time BIST market data
 * Free tier: Unlimited calls for basic real-time quotes
 * Docs: https://blog.itick.io/en/stock-api/turkey-stock-api-bist-real-time-depth-historical-data-technical/
 */

const ITICK_API = 'https://api.itick.org';
const ITICK_TOKEN = process.env.ITICK_API_TOKEN || 'free'; // Use 'free' for public access, or set ITICK_API_TOKEN env var

export interface iTickQuoteResponse {
  code: number; // 0 = success, others = error
  data?: {
    s: string; // symbol
    n: string; // name
    ld: number; // last price (daily)
    o: number; // open
    h: number; // high
    l: number; // low
    chp: number; // change percent
    v: number; // volume
    t: number; // timestamp (ms)
  };
  msg?: string;
}

export interface iTickKLineResponse {
  code: number;
  data?: Array<{
    t: number; // timestamp (ms)
    o: number; // open
    h: number; // high
    l: number; // low
    c: number; // close
    v: number; // volume
  }>;
  msg?: string;
}

function getHeaders() {
  return {
    'Accept': 'application/json',
    ...(ITICK_TOKEN && ITICK_TOKEN !== 'free' && { 'token': ITICK_TOKEN }),
  };
}

export async function fetchiTickQuote(symbol: string): Promise<iTickQuoteResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${ITICK_API}/stock/quote?region=TR&code=${symbol}`, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`iTick quote fetch failed for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Check if we got actual data
    if (data?.code === 0 && data?.data?.ld) {
      return data;
    }

    return null;
  } catch (error) {
    console.error(`iTick quote error for ${symbol}:`, error);
    return null;
  }
}

export async function fetchiTickKLine(
  symbol: string,
  ktype: 1 | 2 | 3 | 4 | 5 | 8 | 9 | 10 = 8, // 8=daily, 5=60min, 1=1min, etc.
  limit: number = 100
): Promise<iTickKLineResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const params = new URLSearchParams({
      region: 'TR',
      code: symbol,
      kType: String(ktype),
      limit: String(limit),
    });

    const response = await fetch(`${ITICK_API}/stock/kline?${params}`, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`iTick kline fetch failed for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data?.code === 0 && data?.data?.length) {
      return data;
    }

    return null;
  } catch (error) {
    console.error(`iTick kline error for ${symbol}:`, error);
    return null;
  }
}

export async function fetchiTickHistoricalBars(
  symbol: string,
  ktype: 1 | 2 | 3 | 4 | 5 | 8 | 9 | 10 = 8,
  limit: number = 100
): Promise<number[]> {
  const kline = await fetchiTickKLine(symbol, ktype, limit);
  if (!kline || !kline.data?.length) {
    return [];
  }
  return kline.data.map(bar => bar.c).slice(-limit);
}
