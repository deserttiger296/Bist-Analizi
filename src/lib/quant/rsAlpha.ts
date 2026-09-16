import { rsi } from '../indicators';

export interface RsAlphaResult {
  symbol: string;
  hasStrongAlpha: boolean;    // "Güçlü Alfa" (RSI Yükselen Dip)
  hasVerticalDrop: boolean;   // "Dikey Aşağı Kırılım" (Rölatif Sat)
  relativeRsi: number;
  message: string;
}

// Helper: Pivot Lows
function findPivotLows(arr: number[], leftBars: number, rightBars: number) {
  const pivots: { index: number; value: number }[] = [];
  for (let i = leftBars; i < arr.length - rightBars; i++) {
    let isPivot = true;
    for (let j = 1; j <= leftBars; j++) {
      if (arr[i - j] <= arr[i]) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      for (let j = 1; j <= rightBars; j++) {
        if (arr[i + j] <= arr[i]) {
          isPivot = false;
          break;
        }
      }
    }
    if (isPivot) {
      pivots.push({ index: i, value: arr[i] });
    }
  }
  return pivots;
}

export async function analyzeRS(symbol: string): Promise<RsAlphaResult> {
  const formattedSymbol = symbol.endsWith('.IS') ? symbol : `${symbol}.IS`;
  
  // Fetch both Stock and XU100.IS
  const [stockRes, indexRes] = await Promise.all([
    fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${formattedSymbol}?interval=1wk&range=2y`),
    fetch(`https://query1.finance.yahoo.com/v8/finance/chart/XU100.IS?interval=1wk&range=2y`)
  ]);

  const stockData = await stockRes.json();
  const indexData = await indexRes.json();

  const stockResult = stockData.chart?.result?.[0];
  const indexResult = indexData.chart?.result?.[0];

  if (!stockResult || !indexResult) {
    throw new Error("Missing data from API");
  }

  const stockTimestamps = stockResult.timestamp as number[];
  const indexTimestamps = indexResult.timestamp as number[];
  const stockCloses = stockResult.indicators.quote[0].close as number[];
  const indexCloses = indexResult.indicators.quote[0].close as number[];

  // Align timestamps
  const ratioChart: number[] = [];
  let indexCursor = 0;

  for (let i = 0; i < stockTimestamps.length; i++) {
    const ts = stockTimestamps[i];
    const sClose = stockCloses[i];
    if (!sClose) continue;

    // Find closest index timestamp
    while (indexCursor < indexTimestamps.length && indexTimestamps[indexCursor] < ts - 86400) {
      indexCursor++;
    }

    if (indexCursor < indexTimestamps.length && Math.abs(indexTimestamps[indexCursor] - ts) <= 86400 * 3) {
      const iClose = indexCloses[indexCursor];
      if (iClose) {
        ratioChart.push(sClose / iClose);
      }
    }
  }

  if (ratioChart.length < 30) {
    throw new Error("Not enough aligned data for RS Analysis");
  }

  // Calculate Relative RSI
  const relRsiValues = rsi(ratioChart, 14);
  const currentRsi = relRsiValues[relRsiValues.length - 1];

  // Rule 1: Güçlü Alfa (RSI Yükselen Dipler)
  const rsiPivots = findPivotLows(relRsiValues, 5, 5);
  let hasStrongAlpha = false;
  
  if (rsiPivots.length >= 2) {
    const lastRsiDip = rsiPivots[rsiPivots.length - 1];
    const prevRsiDip = rsiPivots[rsiPivots.length - 2];
    
    // Yükselen dip şartı
    if (lastRsiDip.value > prevRsiDip.value && (ratioChart.length - lastRsiDip.index) <= 20) {
      hasStrongAlpha = true;
    }
  }

  // Rule 2: Dikey Aşağı Kırılım (Rölatif Sat)
  // Son 52 haftanın en güçlü rölatif dibini aşağı kırdı mı?
  let hasVerticalDrop = false;
  const recentRatios = ratioChart.slice(-52);
  const ratioPivots = findPivotLows(recentRatios, 5, 5);
  
  if (ratioPivots.length >= 1) {
     const minRecentPivot = Math.min(...ratioPivots.map(p => p.value));
     const currentRatio = ratioChart[ratioChart.length - 1];
     
     // Eğer mevcut oran, son 52 haftanın en düşük pivot desteğinden %3 daha aşağıdaysa sert kırılım say.
     if (currentRatio < minRecentPivot * 0.97) {
       hasVerticalDrop = true;
     }
  }

  let message = "Rölatif (Hisse/XU100) grafik nötr durumda.";
  if (hasStrongAlpha && !hasVerticalDrop) {
    message = "Güçlü Alfa: Endeks düşerken bu hisseyi KORU (Yatada kalacaktır). Endeks döndüğü an Alım Tetikleyicisini aktif et.";
  } else if (hasVerticalDrop) {
    message = "Dikey Aşağı Kırılım: Hisse endekse göre SAT vermiştir. Hisse nominal yükselse bile POZİSYONU AZALT / BAŞKA SEKTÖRE GEÇ.";
  }

  return {
    symbol: symbol.replace('.IS', ''),
    hasStrongAlpha,
    hasVerticalDrop,
    relativeRsi: currentRsi,
    message
  };
}
