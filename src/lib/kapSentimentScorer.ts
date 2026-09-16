// src/lib/kapSentimentScorer.ts
// KAP (Public Disclosure Platform) sentiment scoring.
// Previously called out to Google Gemini for this; that cloud dependency has
// been removed in favor of the algorithmic keyword-based heuristic below,
// which was already the offline fallback path and needs no API key or
// network call.

export interface KapSentimentResult {
  symbol: string;
  category: string;
  sentiment: "ÇOK OLUMLU" | "OLUMLU" | "NÖTR" | "NEGATİF";
  impactScore: number;
  summary: string;
  isActionable: boolean;
}

export async function scoreKapSentiment(title: string, content: string, defaultSymbol: string = "BIST"): Promise<KapSentimentResult> {
  return fallbackScoring(title, content, defaultSymbol);
}

function fallbackScoring(title: string, content: string, defaultSymbol: string): KapSentimentResult {
  const upperText = (title + " " + content).toUpperCase();

  let sentiment: "ÇOK OLUMLU" | "OLUMLU" | "NÖTR" | "NEGATİF" = "NÖTR";
  let impactScore = 50;
  let category = "Genel Açıklama";
  let isActionable = false;

  const positiveWords = ["KÂR", "KAZAN", "ALIM", "SÖZLEŞME", "İHALE", "OLUMLU", "ARTIRIM", "BEDELSİZ"];
  const negativeWords = ["ZARAR", "KAYIP", "OLUMSUZ", "CEZA", "ERTELENDİ", "DAVA", "AZALTIM"];

  let positiveCount = 0;
  let negativeCount = 0;

  positiveWords.forEach(word => {
    if (upperText.includes(word)) positiveCount++;
  });

  negativeWords.forEach(word => {
    if (upperText.includes(word)) negativeCount++;
  });

  if (positiveCount > negativeCount) {
    sentiment = positiveCount >= 3 ? "ÇOK OLUMLU" : "OLUMLU";
    impactScore = positiveCount >= 3 ? 85 : 70;
    isActionable = true;
  } else if (negativeCount > positiveCount) {
    sentiment = "NEGATİF";
    impactScore = 30;
    isActionable = true;
  }

  if (upperText.includes("İHALE") || upperText.includes("SÖZLEŞME")) {
    category = "Yeni İş İlişkisi / İhale";
  } else if (upperText.includes("TEMETTÜ")) {
    category = "Temettü Ödemesi";
  } else if (upperText.includes("SERMAYE") || upperText.includes("BEDELSİZ")) {
    category = "Sermaye İşlemleri";
  }

  return {
    symbol: defaultSymbol.toUpperCase(),
    category,
    sentiment,
    impactScore,
    summary: title.slice(0, 80) + "...",
    isActionable,
  };
}
