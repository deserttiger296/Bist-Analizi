// src/lib/scrapers/isYatirimScraper.ts
// İş Yatırım (isyatirim.com.tr) data scraper
// Fetches fundamentals, financial statements, and analyst target prices

const IS_CACHE = new Map<string, { data: any; ts: number }>();
const IS_TTL = 12 * 60 * 60 * 1000; // 12 hours

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': 'https://www.isyatirim.com.tr/',
};

export interface IsYatirimFinancials {
  fk: number | null;
  fdd: number | null;
  roe: number | null;
  netProfit: number | null;
  revenue: number | null;
  equity: number | null;
  totalDebt: number | null;
  debtToEquity: number | null;
  marketCap: number | null;
  sector: string;
  lastUpdated: string;
}

export interface AnalystTarget {
  broker: string;
  targetPrice: number;
  recommendation: string;
  date: string;
}

export interface IsYatirimData {
  financials: IsYatirimFinancials | null;
  targetPrices: AnalystTarget[];
  consensusTarget: number | null;
  consensusRecommendation: string | null;
}

function getCached(key: string): any | null {
  const entry = IS_CACHE.get(key);
  if (entry && Date.now() - entry.ts < IS_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: any): void {
  IS_CACHE.set(key, { data, ts: Date.now() });
}

export async function fetchIsYatirimFundamentals(symbol: string): Promise<IsYatirimFinancials | null> {
  const cacheKey = `is_fund_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const cleanSymbol = symbol.replace('.IS', '').replace('.E', '');
    const url = `https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/OneEndeks?hession=${cleanSymbol}.E&doession=BIST%20100`;
    
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return await scrapeCompanyPage(cleanSymbol);

    const json = await res.json();
    const data = json?.value || json?.d || json;
    if (!data) return null;

    const result: IsYatirimFinancials = {
      fk: parseFloat(data.fk) || null,
      fdd: parseFloat(data.pddd) || null,
      roe: parseFloat(data.roe) || null,
      netProfit: parseFloat(data.netKar) || null,
      revenue: parseFloat(data.satis) || null,
      equity: parseFloat(data.ozKaynak) || null,
      totalDebt: parseFloat(data.toplamBorc) || null,
      debtToEquity: null,
      marketCap: parseFloat(data.piyasaDegeri) || null,
      sector: data.sektor || 'Bilinmiyor',
      lastUpdated: new Date().toISOString(),
    };

    if (result.totalDebt && result.equity && result.equity > 0) {
      result.debtToEquity = result.totalDebt / result.equity;
    }

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[IsYatirimScraper] Fundamentals error for ${symbol}:`, err);
    return null;
  }
}

async function scrapeCompanyPage(symbol: string): Promise<IsYatirimFinancials | null> {
  try {
    const url = `https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hession=${symbol}.E`;
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();

    const extractVal = (label: string): number | null => {
      const regex = new RegExp(`${label}[^>]*>[^<]*<[^>]*>([\\d.,]+)`, 'i');
      const m = html.match(regex);
      return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || null : null;
    };

    const sectorMatch = html.match(/Sekt.r[^>]*>[^<]*<[^>]*>([^<]+)/i);

    return {
      fk: extractVal('F\\/K'), fdd: extractVal('PD\\/DD'), roe: extractVal('ROE'),
      netProfit: null, revenue: null, equity: null, totalDebt: null, debtToEquity: null,
      marketCap: extractVal('Piyasa'), sector: sectorMatch?.[1]?.trim() || 'Bilinmiyor',
      lastUpdated: new Date().toISOString(),
    };
  } catch { return null; }
}

export async function fetchIsYatirimTargetPrices(symbol: string): Promise<AnalystTarget[]> {
  const cacheKey = `is_targets_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const cleanSymbol = symbol.replace('.IS', '').replace('.E', '');
    const url = `https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/HedefFiyat?hession=${cleanSymbol}.E`;
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return [];

    const json = await res.json();
    const data = json?.value || json?.d || [];
    if (!Array.isArray(data)) return [];

    const targets: AnalystTarget[] = data.map((item: any) => ({
      broker: item.araciKurum || item.broker || 'Bilinmiyor',
      targetPrice: parseFloat(item.hedefFiyat || item.targetPrice) || 0,
      recommendation: item.tavsiye || item.recommendation || 'TUT',
      date: item.tarih || item.date || new Date().toISOString(),
    })).filter((t: AnalystTarget) => t.targetPrice > 0);

    setCache(cacheKey, targets);
    return targets;
  } catch (err) {
    console.error(`[IsYatirimScraper] Target prices error for ${symbol}:`, err);
    return [];
  }
}

export async function fetchIsYatirimData(symbol: string): Promise<IsYatirimData> {
  const cacheKey = `is_all_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const [financials, targetPrices] = await Promise.all([
    fetchIsYatirimFundamentals(symbol),
    fetchIsYatirimTargetPrices(symbol),
  ]);

  let consensusTarget: number | null = null;
  let consensusRecommendation: string | null = null;

  if (targetPrices.length > 0) {
    const prices = targetPrices.map(t => t.targetPrice).filter(p => p > 0);
    consensusTarget = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const recs = targetPrices.map(t => t.recommendation.toUpperCase());
    const alC = recs.filter(r => r.includes('AL') || r.includes('BUY')).length;
    const satC = recs.filter(r => r.includes('SAT') || r.includes('SELL')).length;
    consensusRecommendation = alC > satC ? 'AL' : satC > alC ? 'SAT' : 'TUT';
  }

  const result: IsYatirimData = { financials, targetPrices, consensusTarget, consensusRecommendation };
  setCache(cacheKey, result);
  return result;
}
