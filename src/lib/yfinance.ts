import yahooFinanceClass from 'yahoo-finance2';
import type { BistBar } from './bist';
const yahooFinance = new (yahooFinanceClass as any)();

export interface YahooQuotePayload {
  symbol: string;
  shortName: string;
  longName: string;
  currentPrice: number;
  previousClose: number;
  regularMarketVolume: number;
  averageDailyVolume10Day: number;
  averageDailyVolume3Month: number;
}

export interface YahooChartPayload {
  symbol: string;
  period: string;
  interval: string;
  closes: number[];
}

export interface GlobalMarketData {
  sp500: { price: number; change: number };
  vix: { price: number; change: number };
  us10y: { yield: number; change: number };
  usdtry: { price: number };
  bist30: { price: number; change: number };
  bist100: { price: number; change: number };
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuotePayload> {
  const quote: any = await yahooFinance.quote(symbol);
  return {
    symbol,
    shortName: quote?.shortName || quote?.longName || symbol,
    longName: quote?.longName || quote?.shortName || symbol,
    currentPrice: quote?.regularMarketPrice || 0,
    previousClose: quote?.regularMarketPreviousClose || 0,
    regularMarketVolume: quote?.regularMarketVolume || 0,
    averageDailyVolume10Day: quote?.averageDailyVolume10Day || 0,
    averageDailyVolume3Month: quote?.averageDailyVolume3Month || 0,
  };
}

export async function fetchYahooChart(symbol: string, period: string, interval: string): Promise<YahooChartPayload> {
  const hist = (await yahooFinance.historical(symbol, { period, interval } as any)) || [];
  const rows = Array.isArray(hist) ? (hist as any[]) : [];
  const closes = rows.map((row) => row?.close).filter((v) => v !== null && v !== undefined);
  return { symbol, period, interval, closes };
}

export async function fetchYahooOhlc(symbol: string, period1: string | Date, interval: '1d' | '1wk' | '1mo' = '1d'): Promise<BistBar[]> {
  // Use a string like "2023-01-01" or Date object for period1
  try {
    const result = await yahooFinance.chart(symbol, { period1: period1 as any, interval: interval as any });
    if (!result || !result.quotes || !Array.isArray(result.quotes)) return [];

    return result.quotes.map((row: any) => ({
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume || 0
    }));
  } catch (e) {
    console.error(`Yahoo chart fetch error for ${symbol}:`, e);
    return [];
  }
}

export async function fetchGlobalMarketData(): Promise<GlobalMarketData> {
  const [sp500, vix, us10y, usdtry, bist30, bist100]: any[] = await Promise.all([
    yahooFinance.quote('^GSPC'),
    yahooFinance.quote('^VIX'),
    yahooFinance.quote('^TNX'),
    yahooFinance.quote('USDTRY=X'),
    yahooFinance.quote('XU030.IS'),
    yahooFinance.quote('XU100.IS'),
  ]);

  return {
    sp500: {
      price: sp500?.regularMarketPrice || 0,
      change: sp500?.regularMarketChangePercent || 0,
    },
    vix: {
      price: vix?.regularMarketPrice || 0,
      change: vix?.regularMarketChangePercent || 0,
    },
    us10y: {
      yield: us10y?.regularMarketPrice || 0,
      change: us10y?.regularMarketChangePercent || 0,
    },
    usdtry: {
      price: usdtry?.regularMarketPrice || 1,
    },
    bist30: {
      price: bist30?.regularMarketPrice || 0,
      change: bist30?.regularMarketChangePercent || 0,
    },
    bist100: {
      price: bist100?.regularMarketPrice || 0,
      change: bist100?.regularMarketChangePercent || 0,
    },
  };
}
