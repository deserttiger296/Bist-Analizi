import { Cache } from "./cache";

export interface FundamentalMetrics {
  fk: number;
  fdd: number;
  roe: number;
  marketCap: number;
  sector: string;
}

const SECTOR_DATA_TTL = 12 * 60 * 60 * 1000; // 12 Hours cache

export async function fetchFundamentalMetrics(symbol: string): Promise<FundamentalMetrics | null> {
  const cleanSym = symbol.replace('.IS', '').toUpperCase();
  const cacheKey = `fund_v1_${cleanSym}`;

  // 1. Try to fetch single stock cache first
  try {
    const cached = await Cache.get<FundamentalMetrics>(cacheKey);
    if (cached) return cached;
  } catch (e) {
    console.warn("[İş Yatırım Cache] Read error:", e);
  }

  // 2. Fetch from İş Yatırım
  try {
    const allSectorsCacheKey = "isyatirim_all_sectors_data";
    let allSectors = await Cache.get<any[]>(allSectorsCacheKey);

    if (!allSectors) {
      const url = `https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/SirketBilgileriBySektor?sektor=TUM`;
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          },
          signal: AbortSignal.timeout(5000) // Lower timeout to 5s
        });

        if (!res.ok) {
          throw new Error(`İş Yatırım API returned status: ${res.status}`);
        }

        const json = await res.json();
        allSectors = json.d || [];
        
        if (allSectors && allSectors.length > 0) {
          await Cache.set(allSectorsCacheKey, allSectors, SECTOR_DATA_TTL);
        } else {
          // If empty, cache short-lived empty array
          await Cache.set(allSectorsCacheKey, [], 5 * 60 * 1000);
        }
      } catch (err) {
        console.error(`[İş Yatırım API] Failed to fetch sector data:`, err);
        // Cache empty array for 5 minutes on error to prevent repeated timeouts in the loop
        await Cache.set(allSectorsCacheKey, [], 5 * 60 * 1000);
        allSectors = [];
      }
    }

    const stockData = allSectors?.find((item: any) => item.KOD === cleanSym);
    
    if (stockData) {
      // Clean and parse values
      const fk = typeof stockData.FK === 'number' ? stockData.FK : parseFloat(stockData.FK?.toString().replace(',', '.')) || 0;
      const fdd = typeof stockData.PD_DD === 'number' ? stockData.PD_DD : parseFloat(stockData.PD_DD?.toString().replace(',', '.')) || 0;
      const roe = typeof stockData.NET_KAR_OZSERMAYE === 'number' ? stockData.NET_KAR_OZSERMAYE : parseFloat(stockData.NET_KAR_OZSERMAYE?.toString().replace(',', '.')) || 0;
      const marketCap = typeof stockData.PIYASA_DEGERI === 'number' ? stockData.PIYASA_DEGERI : parseFloat(stockData.PIYASA_DEGERI?.toString().replace('.', '').replace(',', '.')) || 0;
      const sector = stockData.SEKTOR_ADI || "Diğer";

      const metrics: FundamentalMetrics = { fk, fdd, roe, marketCap, sector };
      
      // Cache it
      await Cache.set(cacheKey, metrics, SECTOR_DATA_TTL);
      return metrics;
    }
  } catch (err) {
    console.error(`[İş Yatırım API] Failed to parse metrics for ${cleanSym}:`, err);
  }

  return null;
}
