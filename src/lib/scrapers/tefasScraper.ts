import { Cache } from "../cache";

// ─── INTERFACES ────────────────────────────────────────────────────────────────

export interface FundInfo {
  fundCode: string;          // Fon kodu (e.g. "TI2")
  fundName: string;          // Fon adı
  managementCompany: string; // Yönetici kuruluş
  holdingPercentage: number; // Hissedeki ağırlık (%)
  fundSize: number;          // Fon büyüklüğü (TRY)
  fundType: string;          // Fon türü
}

export interface FundPerformance {
  fundCode: string;          // Fon kodu
  fundName: string;          // Fon adı
  managementCompany: string; // Yönetici kuruluş
  dailyReturn: number;       // Günlük getiri (%)
  weeklyReturn: number;      // Haftalık getiri (%)
  monthlyReturn: number;     // Aylık getiri (%)
  threeMonthReturn: number;  // 3 aylık getiri (%)
  sixMonthReturn: number;    // 6 aylık getiri (%)
  yearlyReturn: number;      // Yıllık getiri (%)
  fundSize: number;          // Fon büyüklüğü (TRY)
  fundPrice: number;         // Fon birim fiyatı (TRY)
  fundType: string;          // Fon türü
}

export interface TefasData {
  fundsHolding: FundInfo[];
  topFunds: FundPerformance[];
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const TEFAS_TTL = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_DELAY_MS = 1500;

const HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*; q=0.01',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanSymbol(symbol: string): string {
  return symbol.replace('.IS', '').toUpperCase();
}

function parseTurkishNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/\./g, '').replace(',', '.').replace('%', '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// ─── FETCH FUND HOLDINGS ───────────────────────────────────────────────────────

export async function fetchFundHoldings(symbol: string): Promise<FundInfo[]> {
  const cleanSym = cleanSymbol(symbol);
  const cacheKey = `tefas_holdings_v1_${cleanSym}`;

  try {
    const cached = await Cache.get<FundInfo[]>(cacheKey);
    if (cached) return cached;
  } catch (_e) {
    console.warn("[TEFAS Scraper] Cache read error:", _e);
  }

  const fundsHolding: FundInfo[] = [];

  // Strategy 1: Try TEFAS API endpoint
  try {
    const today = new Date().toISOString().split('T')[0];
    const apiUrl = `https://www.tefas.gov.tr/api/DB/BindHistoryAllocation`
      + `?fonKod=&baession=${today}&biession=${today}`;

    const res = await fetch(apiUrl, {
      headers: {
        ...HEADERS,
        'Referer': 'https://www.tefas.gov.tr/',
        'Origin': 'https://www.tefas.gov.tr',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await res.json();
        const data = Array.isArray(json) ? json : (json.data || json.d || []);

        // Filter for funds that hold our target stock
        for (const item of data) {
          const record = item as Record<string, unknown>;
          const holdingName = String(record.PIYNM || record.FONUNVAN || '').toUpperCase();
          const holdingCode = String(record.PIYKOD || record.HISSEKOD || '').toUpperCase();

          if (holdingCode === cleanSym || holdingName.includes(cleanSym)) {
            fundsHolding.push({
              fundCode: String(record.FONKOD || record.fonKod || ''),
              fundName: String(record.FONUNVAN || record.fonUnvan || ''),
              managementCompany: String(record.PIYSTIPI || record.kurulus || ''),
              holdingPercentage: parseTurkishNumber(record.PIYDEGER || record.oran || 0),
              fundSize: parseTurkishNumber(record.PIYTOPLAM || record.fonBuyukluk || 0),
              fundType: String(record.FONTIPI || record.fonTipi || 'Hisse Senedi'),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[TEFAS Scraper] API endpoint failed for ${cleanSym}:`, err);
  }

  // Strategy 2: Try fund info page scraping
  if (fundsHolding.length === 0) {
    try {
      await delay(REQUEST_DELAY_MS);
      const pageUrl = `https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=${cleanSym}`;
      const res = await fetch(pageUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const html = await res.text();

        // Look for fund allocation tables that mention the stock
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch: RegExpExecArray | null;

        while ((trMatch = trRegex.exec(html)) !== null) {
          const rowHtml = trMatch[1];
          if (!rowHtml.toUpperCase().includes(cleanSym)) continue;

          const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells: string[] = [];
          let tdMatch: RegExpExecArray | null;
          while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
            cells.push(stripHtmlTags(tdMatch[1]));
          }

          if (cells.length >= 2) {
            fundsHolding.push({
              fundCode: cells[0] || cleanSym,
              fundName: cells.length > 1 ? cells[1] : '',
              managementCompany: cells.length > 2 ? cells[2] : '',
              holdingPercentage: cells.length > 3 ? parseTurkishNumber(cells[3]) : 0,
              fundSize: cells.length > 4 ? parseTurkishNumber(cells[4]) : 0,
              fundType: 'Hisse Senedi',
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[TEFAS Scraper] HTML scrape error for ${cleanSym}:`, err);
    }
  }

  if (fundsHolding.length > 0) {
    await Cache.set(cacheKey, fundsHolding, TEFAS_TTL);
  }

  return fundsHolding;
}

// ─── FETCH TOP BIST EQUITY FUNDS ───────────────────────────────────────────────

export async function fetchTopBistFunds(): Promise<FundPerformance[]> {
  const cacheKey = 'tefas_top_bist_funds_v1';

  try {
    const cached = await Cache.get<FundPerformance[]>(cacheKey);
    if (cached) return cached;
  } catch (_e) {
    console.warn("[TEFAS Scraper] Cache read error:", _e);
  }

  const topFunds: FundPerformance[] = [];

  // Strategy 1: Try TEFAS Fund API
  try {
    const today = new Date().toISOString().split('T')[0];
    const apiUrl = `https://www.tefas.gov.tr/api/DB/BindHistoryInfo`
      + `?fonTipiKod=YAT&baession=${today}&biession=${today}`;

    const res = await fetch(apiUrl, {
      headers: {
        ...HEADERS,
        'Referer': 'https://www.tefas.gov.tr/',
        'Origin': 'https://www.tefas.gov.tr',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await res.json();
        const data = Array.isArray(json) ? json : (json.data || json.d || []);

        for (const item of data) {
          const record = item as Record<string, unknown>;
          const fundType = String(record.PIYSTIPI || record.fonTipi || '').toUpperCase();

          // Filter for equity (hisse senedi) focused funds
          const isEquityFund = fundType.includes('HİSSE') || fundType.includes('HISSE')
            || fundType.includes('STOCK') || fundType.includes('PAY')
            || String(record.FONUNVAN || '').toUpperCase().includes('HİSSE');

          if (!isEquityFund && data.length > 20) continue;

          topFunds.push({
            fundCode: String(record.FONKOD || record.fonKod || ''),
            fundName: String(record.FONUNVAN || record.fonUnvan || ''),
            managementCompany: String(record.PIYSTIPI || record.kurulus || ''),
            dailyReturn: parseTurkishNumber(record.PIYDEGER || record.gunlukGetiri || 0),
            weeklyReturn: parseTurkishNumber(record.PIYHAFTALIK || record.haftalikGetiri || 0),
            monthlyReturn: parseTurkishNumber(record.PIYAYLIK || record.aylikGetiri || 0),
            threeMonthReturn: parseTurkishNumber(record.PIY3AYLIK || record.ucAylikGetiri || 0),
            sixMonthReturn: parseTurkishNumber(record.PIY6AYLIK || record.altiAylikGetiri || 0),
            yearlyReturn: parseTurkishNumber(record.PIYYILLIK || record.yillikGetiri || 0),
            fundSize: parseTurkishNumber(record.PIYTOPLAM || record.fonBuyukluk || 0),
            fundPrice: parseTurkishNumber(record.PIYFIYAT || record.fonFiyat || 0),
            fundType: fundType || 'Yatırım Fonu',
          });
        }

        // Sort by yearly return descending
        topFunds.sort((a, b) => b.yearlyReturn - a.yearlyReturn);
      }
    }
  } catch (err) {
    console.warn("[TEFAS Scraper] Top funds API error:", err);
  }

  // Strategy 2: Scrape the TEFAS comparison page
  if (topFunds.length === 0) {
    try {
      await delay(REQUEST_DELAY_MS);
      const pageUrl = 'https://www.tefas.gov.tr/TarihselVeriler.aspx';
      const res = await fetch(pageUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const html = await res.text();

        // Parse fund data from the table
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch: RegExpExecArray | null;

        while ((trMatch = trRegex.exec(html)) !== null) {
          const rowHtml = trMatch[1];
          const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells: string[] = [];
          let tdMatch: RegExpExecArray | null;
          while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
            cells.push(stripHtmlTags(tdMatch[1]));
          }

          // Skip header rows or rows with too few columns
          if (cells.length < 4) continue;
          if (cells[0].toUpperCase().includes('FON') && cells[0].toUpperCase().includes('KOD')) continue;

          const fundCode = cells[0].trim();
          if (!fundCode || fundCode.length > 10) continue;

          topFunds.push({
            fundCode,
            fundName: cells.length > 1 ? cells[1] : '',
            managementCompany: '',
            dailyReturn: cells.length > 2 ? parseTurkishNumber(cells[2]) : 0,
            weeklyReturn: 0,
            monthlyReturn: cells.length > 3 ? parseTurkishNumber(cells[3]) : 0,
            threeMonthReturn: cells.length > 4 ? parseTurkishNumber(cells[4]) : 0,
            sixMonthReturn: cells.length > 5 ? parseTurkishNumber(cells[5]) : 0,
            yearlyReturn: cells.length > 6 ? parseTurkishNumber(cells[6]) : 0,
            fundSize: cells.length > 7 ? parseTurkishNumber(cells[7]) : 0,
            fundPrice: cells.length > 8 ? parseTurkishNumber(cells[8]) : 0,
            fundType: 'Yatırım Fonu',
          });
        }

        // Sort by yearly return descending
        topFunds.sort((a, b) => b.yearlyReturn - a.yearlyReturn);
      }
    } catch (err) {
      console.warn("[TEFAS Scraper] HTML scrape error:", err);
    }
  }

  // Limit to top 20
  const result = topFunds.slice(0, 20);

  if (result.length > 0) {
    await Cache.set(cacheKey, result, TEFAS_TTL);
  }

  return result;
}

// ─── COMBINED FETCHER ──────────────────────────────────────────────────────────

export async function fetchTefasData(symbol: string): Promise<TefasData> {
  const fundsHolding = await fetchFundHoldings(symbol);

  await delay(REQUEST_DELAY_MS);

  const topFunds = await fetchTopBistFunds();

  return {
    fundsHolding,
    topFunds,
  };
}
