import { Cache } from "./cache";
import { analyzeSentiment, type SentimentEngine } from "./sentimentService";

const SENTIMENT_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 saatte bir yenile

export interface SocialSentiment {
  symbol: string;
  mentionCount24h: number; // Analiz edilen haber sayısı (gerçek sayım, tahmin değil)
  isPumpWarning: boolean;  // Anormal bir artış var mı? (Manipülasyon riski)
  notes: string[];         // Kullanıcıya gösterilecek uyarı notları
  engine: SentimentEngine; // claude | lexicon | no_news -- ayrı motorlar, ayrı raporlanır
}

export async function fetchSocialSentiment(symbol: string): Promise<SocialSentiment | null> {
  const cleanSymbol = symbol.replace('.IS', '').toUpperCase();
  const cacheKey = `sentiment_data_${cleanSymbol}`;

  try {
    const cached = await Cache.get<SocialSentiment>(cacheKey);
    if (cached) return cached;
  } catch (e) {}

  try {
    // Call the real sentiment analyzer based on real news!
    const realSentiment = await analyzeSentiment(cleanSymbol, cleanSymbol).catch(() => null);

    if (realSentiment) {
      const isPump = realSentiment.engine === "claude" && realSentiment.score > 80 && realSentiment.newsCount > 5;
      const notes: string[] = [realSentiment.summary];
      
      if (isPump) {
        notes.push(`🚨 ANORMAL İLGİ UYARISI: Haber akışında çok güçlü ve yoğun bir yükseliş beklentisi var.`);
      }
      
      const realData: SocialSentiment = {
        symbol: cleanSymbol,
        mentionCount24h: realSentiment.newsCount,
        isPumpWarning: isPump,
        notes,
        engine: realSentiment.engine,
      };

      await Cache.set(cacheKey, realData, SENTIMENT_CACHE_TTL);
      return realData;
    }
  } catch (error) {
    console.error(`Sentiment Fetch Error for ${cleanSymbol}:`, error);
  }

  // Analysis failed: report "no sentiment", never a fabricated "calm news" result.
  return null;
}
