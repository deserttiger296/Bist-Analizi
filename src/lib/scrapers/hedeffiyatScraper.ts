import { Cache } from "../cache";

// ─── INTERFACES ────────────────────────────────────────────────────────────────

export interface BrokerTarget {
  broker: string;           // Aracı kurum adı
  targetPrice: number;      // Hedef fiyat (TRY)
  recommendation: string;   // AL / TUT / SAT / ENP
  date: string;             // Rapor tarihi
  potentialReturn: number;  // Getiri potansiyeli (%)
}

export interface ConsensusData {
  consensusTarget: number;          // Konsensüs hedef fiyat
  currentPrice: number;             // Güncel fiyat (sayfada görünen)
  brokerTargets: BrokerTarget[];    // Bireysel aracı kurum hedefleri
  buyCount: number;                 // AL tavsiye sayısı
  holdCount: number;                // TUT tavsiye sayısı
  sellCount: number;                // SAT tavsiye sayısı
  potentialReturn: number;          // Potansiyel getiri (%)
  totalAnalysts: number;            // Toplam analist sayısı
  lastUpdated: string;              // Son güncelleme
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const HEDEF_FIYAT_TTL = 24 * 60 * 60 * 1000; // 24 hours

const HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function cleanSymbol(symbol: string): string {
  return symbol.replace('.IS', '').toUpperCase();
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function parseTurkishPrice(text: string): number {
  // Handle Turkish number format: "123,45" or "1.234,56"
  const cleaned = text
    .replace(/[^\d,.]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function normalizeRecommendation(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (upper.includes('AL') || upper.includes('BUY') || upper.includes('OUTPERFORM') || upper.includes('ENP')) {
    return 'AL';
  }
  if (upper.includes('TUT') || upper.includes('HOLD') || upper.includes('NEUTRAL') || upper.includes('MP')) {
    return 'TUT';
  }
  if (upper.includes('SAT') || upper.includes('SELL') || upper.includes('UNDERPERFORM') || upper.includes('EAP')) {
    return 'SAT';
  }
  return raw || 'Bilinmiyor';
}

// ─── FETCH CONSENSUS TARGET PRICE ──────────────────────────────────────────────

export async function fetchConsensusTargetPrice(symbol: string): Promise<ConsensusData | null> {
  const cleanSym = cleanSymbol(symbol);
  const cacheKey = `hedeffiyat_consensus_v1_${cleanSym}`;

  try {
    const cached = await Cache.get<ConsensusData>(cacheKey);
    if (cached) return cached;
  } catch (_e) {
    console.warn("[Hedef Fiyat Scraper] Cache read error:", _e);
  }

  try {
    const url = `https://www.hedeffiyat.com/hisse/${cleanSym}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`[Hedef Fiyat Scraper] HTTP ${res.status} for ${cleanSym}`);
      return null;
    }

    const html = await res.text();

    // ─── EXTRACT CONSENSUS TARGET PRICE ──────────────────────────────
    let consensusTarget = 0;
    let currentPrice = 0;
    let potentialReturn = 0;

    // Look for consensus target price — various possible patterns:
    // "Konsensüs Hedef Fiyat: 123,45 TL"
    // "Hedef Fiyat" ... "123,45"
    const consensusPatterns = [
      /(?:konsens[üu]s|ortalama)\s*(?:hedef\s*)?fiyat[^<]*?(?:<[^>]*>)*\s*([\d.,]+)\s*(?:TL|TRY)?/gi,
      /hedef\s*fiyat[^<]*?(?:<[^>]*>)*\s*([\d.,]+)\s*(?:TL|TRY)?/gi,
      /(?:target|consensus)[^<]*?(?:<[^>]*>)*\s*([\d.,]+)/gi,
    ];

    for (const pattern of consensusPatterns) {
      const m = pattern.exec(html);
      if (m) {
        const parsed = parseTurkishPrice(m[1]);
        if (parsed > 0) {
          consensusTarget = parsed;
          break;
        }
      }
    }

    // Current price
    const pricePatterns = [
      /(?:g[üu]ncel|son|mevcut)\s*(?:fiyat|kapanış)[^<]*?(?:<[^>]*>)*\s*([\d.,]+)\s*(?:TL|TRY)?/gi,
      /(?:kapan[ıi]ş|close)[^<]*?(?:<[^>]*>)*\s*([\d.,]+)/gi,
    ];

    for (const pattern of pricePatterns) {
      const m = pattern.exec(html);
      if (m) {
        const parsed = parseTurkishPrice(m[1]);
        if (parsed > 0) {
          currentPrice = parsed;
          break;
        }
      }
    }

    // Potential return
    const returnPatterns = [
      /(?:getiri|potansiyel|return)[^<]*?(?:<[^>]*>)*\s*[%]?\s*([-\d.,]+)\s*%?/gi,
      /(?:yükselme|artış)\s*(?:potansiyeli)?[^<]*?(?:<[^>]*>)*\s*([-\d.,]+)\s*%/gi,
    ];

    for (const pattern of returnPatterns) {
      const m = pattern.exec(html);
      if (m) {
        const parsed = parseFloat(m[1].replace(',', '.'));
        if (!isNaN(parsed)) {
          potentialReturn = parsed;
          break;
        }
      }
    }

    // Calculate potential return from prices if not found directly
    if (potentialReturn === 0 && consensusTarget > 0 && currentPrice > 0) {
      potentialReturn = Math.round(((consensusTarget - currentPrice) / currentPrice) * 10000) / 100;
    }

    // ─── EXTRACT INDIVIDUAL BROKER TARGETS ───────────────────────────
    const brokerTargets: BrokerTarget[] = [];

    // Try table rows: <tr> ... <td>Broker</td><td>Target</td><td>Recommendation</td><td>Date</td> ...
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(html)) !== null) {
      const rowHtml = trMatch[1];

      // Extract all <td> cells
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
        cells.push(stripHtmlTags(tdMatch[1]));
      }

      // We need at least 3 columns: broker, target price, recommendation
      if (cells.length >= 3) {
        const brokerName = cells[0];
        // Skip header rows
        if (brokerName.toUpperCase().includes('KURUM') || brokerName.toUpperCase().includes('BROKER')) continue;

        // Find the cell that looks like a price (contains digits and comma/dot)
        let targetPrice = 0;
        let recommendation = '';
        let date = '';

        for (let i = 1; i < cells.length; i++) {
          const cell = cells[i].trim();
          if (!cell) continue;

          // Check if it's a price (digits with optional comma/dot)
          if (/^\d{1,3}[.,]?\d{0,2}$/.test(cell.replace(/\s/g, '')) || /^[\d.,]+$/.test(cell)) {
            if (targetPrice === 0) {
              targetPrice = parseTurkishPrice(cell);
            }
          }
          // Check if it's a recommendation
          else if (/^(AL|TUT|SAT|BUY|HOLD|SELL|ENP|EAP|MP|OUTPERFORM|NEUTRAL|UNDERPERFORM)/i.test(cell)) {
            recommendation = normalizeRecommendation(cell);
          }
          // Check if it's a date
          else if (/\d{2}[.\/]\d{2}[.\/]\d{2,4}/.test(cell)) {
            date = cell;
          }
        }

        if (brokerName && targetPrice > 0) {
          const brokerReturn = currentPrice > 0
            ? Math.round(((targetPrice - currentPrice) / currentPrice) * 10000) / 100
            : 0;

          brokerTargets.push({
            broker: brokerName,
            targetPrice,
            recommendation: recommendation || 'Bilinmiyor',
            date,
            potentialReturn: brokerReturn,
          });
        }
      }
    }

    // ─── EXTRACT RECOMMENDATION DISTRIBUTION ─────────────────────────
    let buyCount = 0;
    let holdCount = 0;
    let sellCount = 0;

    // Try to find explicit counts in the HTML
    const buyCountMatch = /(?:al|buy|outperform)[^<]*?(?:<[^>]*>)*\s*(?:\(?\s*)?(\d+)/gi.exec(html);
    const holdCountMatch = /(?:tut|hold|neutral)[^<]*?(?:<[^>]*>)*\s*(?:\(?\s*)?(\d+)/gi.exec(html);
    const sellCountMatch = /(?:sat|sell|underperform)[^<]*?(?:<[^>]*>)*\s*(?:\(?\s*)?(\d+)/gi.exec(html);

    if (buyCountMatch) buyCount = parseInt(buyCountMatch[1]) || 0;
    if (holdCountMatch) holdCount = parseInt(holdCountMatch[1]) || 0;
    if (sellCountMatch) sellCount = parseInt(sellCountMatch[1]) || 0;

    // Fall back to counting from broker targets
    if (buyCount === 0 && holdCount === 0 && sellCount === 0 && brokerTargets.length > 0) {
      buyCount = brokerTargets.filter((t) => t.recommendation === 'AL').length;
      holdCount = brokerTargets.filter((t) => t.recommendation === 'TUT').length;
      sellCount = brokerTargets.filter((t) => t.recommendation === 'SAT').length;
    }

    // Calculate consensus from broker targets if not found in page
    if (consensusTarget === 0 && brokerTargets.length > 0) {
      const sum = brokerTargets.reduce((acc, t) => acc + t.targetPrice, 0);
      consensusTarget = Math.round((sum / brokerTargets.length) * 100) / 100;
    }

    const totalAnalysts = Math.max(buyCount + holdCount + sellCount, brokerTargets.length);

    // If we got absolutely nothing, return null
    if (consensusTarget === 0 && brokerTargets.length === 0) {
      console.warn(`[Hedef Fiyat Scraper] No data extracted for ${cleanSym}`);
      return null;
    }

    const result: ConsensusData = {
      consensusTarget,
      currentPrice,
      brokerTargets,
      buyCount,
      holdCount,
      sellCount,
      potentialReturn,
      totalAnalysts,
      lastUpdated: new Date().toISOString(),
    };

    await Cache.set(cacheKey, result, HEDEF_FIYAT_TTL);
    return result;
  } catch (err) {
    console.error(`[Hedef Fiyat Scraper] Error for ${cleanSym}:`, err);
    return null;
  }
}
