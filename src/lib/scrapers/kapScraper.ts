import { Cache } from "../cache";

// ─── INTERFACES ────────────────────────────────────────────────────────────────

export interface KapDisclosure {
  id: string;
  title: string;
  company: string;
  symbol: string;
  type: string;         // Bildirim tipi
  date: string;         // Bildirim tarihi
  url: string;
  isImportant: boolean; // Özel Durum Açıklaması
}

export interface DividendInfo {
  symbol: string;
  year: string;           // Temettü dönemi
  grossDividend: number;  // Brüt temettü (TRY/pay)
  netDividend: number;    // Net temettü (TRY/pay)
  paymentDate: string;    // Ödeme tarihi
  dividendYield: number;  // Temettü verimi (%)
}

export interface KapData {
  disclosures: KapDisclosure[];
  dividends: DividendInfo[];
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const KAP_TTL = 30 * 60 * 1000; // 30 minutes
const REQUEST_DELAY_MS = 1500;

const HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanSymbol(symbol: string): string {
  return symbol.replace('.IS', '').toUpperCase();
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function isImportantDisclosure(title: string): boolean {
  const importantKeywords = [
    'ÖZEL DURUM',
    'KAR DAĞITIM',
    'TEMETTÜ',
    'BİRLEŞME',
    'DEVRALMA',
    'SERMAYE ARTIRIMI',
    'HALKA ARZ',
    'GENEL KURUL',
    'YÖNETİM KURULU',
    'FİNANSAL TABLO',
    'BAĞIMSIZ DENETİM',
  ];
  const upper = title.toUpperCase();
  return importantKeywords.some((kw) => upper.includes(kw));
}

// ─── FETCH DISCLOSURES ─────────────────────────────────────────────────────────

export async function fetchKapDisclosures(symbol: string): Promise<KapDisclosure[]> {
  const cleanSym = cleanSymbol(symbol);
  const cacheKey = `kap_disclosures_v1_${cleanSym}`;

  try {
    const cached = await Cache.get<KapDisclosure[]>(cacheKey);
    if (cached) return cached;
  } catch (_e) {
    console.warn("[KAP Scraper] Cache read error:", _e);
  }

  const disclosures: KapDisclosure[] = [];

  // Strategy 1: Try the KAP API endpoint (JSON)
  try {
    const apiUrl = `https://www.kap.org.tr/tr/api/disclosures?hisse=${cleanSym}&tip=ALL&limit=20`;
    const res = await fetch(apiUrl, {
      headers: {
        ...HEADERS,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await res.json();
        const items = Array.isArray(json) ? json : (json.d || json.data || json.disclosures || []);

        for (const item of items) {
          const record = item as Record<string, unknown>;
          disclosures.push({
            id: String(record.disclosureIndex || record.id || record.ID || ''),
            title: String(record.disclosureTitle || record.title || record.BASLIK || ''),
            company: String(record.companyName || record.company || record.SIRKET || cleanSym),
            symbol: cleanSym,
            type: String(record.disclosureType || record.type || record.TIP || 'Genel'),
            date: String(record.publishDate || record.date || record.TARIH || ''),
            url: record.disclosureIndex
              ? `https://www.kap.org.tr/tr/Bildirim/${record.disclosureIndex}`
              : 'https://www.kap.org.tr',
            isImportant: isImportantDisclosure(String(record.disclosureTitle || record.title || '')),
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[KAP Scraper] API endpoint failed for ${cleanSym}:`, err);
  }

  // Strategy 2: Scrape company page HTML if API returned nothing
  if (disclosures.length === 0) {
    try {
      await delay(REQUEST_DELAY_MS);
      const pageUrl = `https://www.kap.org.tr/tr/bist-sirketler/${cleanSym}`;
      const res = await fetch(pageUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const html = await res.text();

        // Parse disclosure rows from HTML
        // KAP typically renders: <a href="/tr/Bildirim/XXXXXX" ...> ... </a>
        const rowRegex = /<a\s+href="\/tr\/Bildirim\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match: RegExpExecArray | null;

        while ((match = rowRegex.exec(html)) !== null) {
          const id = match[1];
          const innerHtml = match[2];

          // Extract fields from inner HTML
          const titleMatch = /<(?:div|span|td)[^>]*class="[^"]*(?:title|subject|baslik)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|td)>/i.exec(innerHtml);
          const dateMatch = /<(?:div|span|td)[^>]*class="[^"]*(?:date|tarih)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|td)>/i.exec(innerHtml);
          const typeMatch = /<(?:div|span|td)[^>]*class="[^"]*(?:type|tip|category)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|td)>/i.exec(innerHtml);

          const title = titleMatch ? stripHtmlTags(titleMatch[1]) : stripHtmlTags(innerHtml).slice(0, 150);
          const date = dateMatch ? stripHtmlTags(dateMatch[1]) : '';
          const type = typeMatch ? stripHtmlTags(typeMatch[1]) : 'Genel';

          if (!title) continue;

          disclosures.push({
            id,
            title,
            company: cleanSym,
            symbol: cleanSym,
            type,
            date: date || new Date().toLocaleDateString('tr-TR'),
            url: `https://www.kap.org.tr/tr/Bildirim/${id}`,
            isImportant: isImportantDisclosure(title),
          });

          if (disclosures.length >= 20) break;
        }
      }
    } catch (err) {
      console.error(`[KAP Scraper] HTML scrape error for ${cleanSym}:`, err);
    }
  }

  if (disclosures.length > 0) {
    await Cache.set(cacheKey, disclosures, KAP_TTL);
  }

  return disclosures;
}

// ─── FETCH DIVIDENDS ───────────────────────────────────────────────────────────

export async function fetchKapDividends(symbol: string): Promise<DividendInfo[]> {
  const cleanSym = cleanSymbol(symbol);
  const cacheKey = `kap_dividends_v1_${cleanSym}`;

  try {
    const cached = await Cache.get<DividendInfo[]>(cacheKey);
    if (cached) return cached;
  } catch (_e) {
    console.warn("[KAP Scraper] Cache read error:", _e);
  }

  const dividends: DividendInfo[] = [];

  try {
    // Try the KAP kar dağıtım (dividend) page
    const url = `https://www.kap.org.tr/tr/bist-sirketler/${cleanSym}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[KAP Scraper] Dividend page HTTP ${res.status} for ${cleanSym}`);
      return dividends;
    }

    const html = await res.text();

    // Look for dividend table rows
    // Pattern: <tr> containing temettü/kar dağıtım data with TRY amounts
    const dividendSectionRegex = /(?:temett[üu]|kar\s*da[ğg][ıi]t[ıi]m)[^<]*<\/(?:h[1-6]|div|th)>([\s\S]*?)(?:<\/table>|<\/section>)/gi;
    const sectionMatch = dividendSectionRegex.exec(html);

    if (sectionMatch) {
      const tableHtml = sectionMatch[1];
      // Extract rows: <tr>...</tr>
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;

      while ((trMatch = trRegex.exec(tableHtml)) !== null) {
        const rowHtml = trMatch[1];
        // Extract <td> values
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells: string[] = [];
        let tdMatch: RegExpExecArray | null;
        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
          cells.push(stripHtmlTags(tdMatch[1]));
        }

        if (cells.length >= 3) {
          // Try to parse: [year, grossDividend, netDividend, paymentDate, yield]
          const year = cells[0] || '';
          const grossStr = cells[1] || '0';
          const netStr = cells.length > 2 ? cells[2] : grossStr;
          const paymentDate = cells.length > 3 ? cells[3] : '';
          const yieldStr = cells.length > 4 ? cells[4] : '0';

          const grossDividend = parseFloat(grossStr.replace(',', '.')) || 0;
          const netDividend = parseFloat(netStr.replace(',', '.')) || 0;

          if (grossDividend > 0 || netDividend > 0) {
            dividends.push({
              symbol: cleanSym,
              year,
              grossDividend,
              netDividend,
              paymentDate,
              dividendYield: parseFloat(yieldStr.replace('%', '').replace(',', '.')) || 0,
            });
          }
        }
      }
    }

    // Fallback: scan for any temettü mentions across the whole page
    if (dividends.length === 0) {
      const temMatch = /(\d{4})\s*(?:yıl|dönem)[^<]*?(?:brüt|net)\s*(?:temettü|temett[üu])[^<]*?([\d,.]+)\s*(?:TL|TRY)/gi;
      let tm: RegExpExecArray | null;
      while ((tm = temMatch.exec(html)) !== null) {
        const year = tm[1];
        const amount = parseFloat(tm[2].replace(',', '.')) || 0;
        if (amount > 0) {
          dividends.push({
            symbol: cleanSym,
            year,
            grossDividend: amount,
            netDividend: amount * 0.85, // Approximate net after withholding
            paymentDate: '',
            dividendYield: 0,
          });
        }
      }
    }

    if (dividends.length > 0) {
      await Cache.set(cacheKey, dividends, KAP_TTL);
    }
  } catch (err) {
    console.error(`[KAP Scraper] Dividend fetch error for ${cleanSym}:`, err);
  }

  return dividends;
}

// ─── COMBINED FETCHER ──────────────────────────────────────────────────────────

export async function fetchKapData(symbol: string): Promise<KapData> {
  const disclosures = await fetchKapDisclosures(symbol);

  // Respect rate limiting
  await delay(REQUEST_DELAY_MS);

  const dividendData = await fetchKapDividends(symbol);

  return {
    disclosures,
    dividends: dividendData,
  };
}
