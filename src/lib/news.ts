import { Cache } from "./cache";

const NEWS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

export interface NewsItem {
  id: string;
  symbol?: string; // Hisse spesifik ise hisse kodu (Örn: THYAO)
  title: string;
  content: string;
  source: "KAP" | "ARACI_KURUM" | "MEDYA" | "FON_GIRIS";
  date: string;
  sentiment: "positive" | "negative" | "neutral";
  url?: string;
}

export async function fetchMarketNews(): Promise<NewsItem[]> {
  const cacheKey = `bist_market_news`;

  try {
    const cached = await Cache.get<NewsItem[]>(cacheKey);
    if (cached) return cached;
  } catch (e) {}

  try {
    let newsItems: NewsItem[] = [];

    // No cloud news store anymore (was Firestore-backed) -- serve the
    // static/demo market news set below until a local news source is wired up.
    if (newsItems.length === 0) {
      newsItems = [
        {
          id: "news-1",
          symbol: "THYAO",
          title: "Model Portföy Güncellemesi: THYAO Hedef Fiyat Yükseldi",
          content: "İş Yatırım, Türk Hava Yolları için hedef fiyatını 420 TL'den 510 TL'ye yükseltti ve 'AL' tavsiyesini korudu.",
          source: "ARACI_KURUM",
          date: new Date(Date.now() - 3600000).toISOString(), // 1 saat önce
          sentiment: "positive"
        },
        {
          id: "news-2",
          symbol: "EREGL",
          title: "KAP: Yeni İş İlişkisi / İhale Kazanımı",
          content: "Şirketimiz yurt içi yerleşik bir müşteri ile 45.000.000 USD tutarında çelik tedarik sözleşmesi imzalamıştır.",
          source: "KAP",
          date: new Date(Date.now() - 7200000).toISOString(),
          sentiment: "positive"
        },
        {
          id: "news-3",
          symbol: "SASA",
          title: "Yabancı Fon Girişi Radarı",
          content: "Son 2 işlem gününde Citibank ve Yatırım Fonları üzerinden ciddi miktarda mal toplandığı tespit edildi.",
          source: "FON_GIRIS",
          date: new Date(Date.now() - 14400000).toISOString(),
          sentiment: "positive"
        },
        {
          id: "news-4",
          title: "BIST 100 Endeksinde Yabancı Takas Oranı Arttı",
          content: "TCMB verilerine göre yabancı yatırımcılar geçtiğimiz hafta borsada 250 milyon dolarlık net alım gerçekleştirdi.",
          source: "MEDYA",
          date: new Date(Date.now() - 86400000).toISOString(),
          sentiment: "positive"
        }
      ];
    }

    await Cache.set(cacheKey, newsItems, NEWS_CACHE_TTL);
    return newsItems;

  } catch (error) {
    console.error(`Market News Fetch Error:`, error);
    return [];
  }
}

export async function fetchNewsForSymbol(symbol: string): Promise<NewsItem[]> {
  const cleanSymbol = symbol.replace('.IS', '').toUpperCase();
  const allNews = await fetchMarketNews();
  
  // Sadece bu hisseyi ilgilendiren haberleri filtrele
  return allNews.filter(n => n.symbol === cleanSymbol);
}

