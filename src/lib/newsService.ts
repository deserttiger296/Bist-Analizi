// Multi-source news API integration with fallbacks
// Supports: NewsAPI, Finnhub, Twelve Data + local fallback

const NEWS_API_KEY = process.env.NEWSAPI_KEY || '';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '';

interface NewsArticle {
  title: string;
  description: string;
  content: string;
  publishedAt: string;
  source: { name: string };
  url: string;
}

interface NewsResult {
  articles: NewsArticle[];
  totalResults: number;
}

/**
 * Try Finnhub first (best Turkish support), then NewsAPI, then Twelve Data
 */
export async function fetchStockNews(symbol: string, limit = 10): Promise<NewsArticle[]> {
  // Try Finnhub first
  if (FINNHUB_API_KEY) {
    const finnhubNews = await fetchFinnhubNews(symbol, limit).catch(() => null);
    if (finnhubNews && finnhubNews.length > 0) {
      return finnhubNews;
    }
  }

  // Fallback to NewsAPI
  if (NEWS_API_KEY) {
    const newsApiNews = await fetchNewsApiNews(symbol, limit).catch(() => null);
    if (newsApiNews && newsApiNews.length > 0) {
      return newsApiNews;
    }
  }

  // Fallback to Twelve Data
  if (TWELVEDATA_API_KEY) {
    const twelveDataNews = await fetchTwelveDataNews(symbol, limit).catch(() => null);
    if (twelveDataNews && twelveDataNews.length > 0) {
      return twelveDataNews;
    }
  }

  // Final fallback: demo news
  console.warn(
    'No news APIs configured. Using demo news. Set FINNHUB_API_KEY, NEWSAPI_KEY, or TWELVEDATA_API_KEY in .env.local'
  );
  return getDemoNews(symbol);
}

/**
 * Finnhub: Best for Turkish/BIST stocks
 * Free tier: 60 API calls/minute
 * https://finnhub.io/
 */
async function fetchFinnhubNews(symbol: string, limit: number): Promise<NewsArticle[]> {
  const query = `${symbol} BIST`;
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
    token: FINNHUB_API_KEY,
  });

  const response = await fetch(`https://finnhub.io/api/v1/company-news?${params}`, {
    headers: { 'User-Agent': 'BIST-Analyst/1.0' },
  });

  if (!response.ok) {
    console.warn(`Finnhub error: ${response.status}`);
    throw new Error(`Finnhub: ${response.status}`);
  }

  const data = await response.json() as any[];
  return (data || []).map((item) => ({
    title: item.headline || '',
    description: item.summary || '',
    content: item.summary || '',
    publishedAt: new Date(item.datetime * 1000).toISOString(),
    source: { name: item.source || 'Finnhub' },
    url: item.url || '',
  }));
}

/**
 * NewsAPI: Broad coverage
 * Free tier: 100 requests/day
 * https://newsapi.org/
 */
async function fetchNewsApiNews(symbol: string, limit: number): Promise<NewsArticle[]> {
  const query = `${symbol} BIST haber`;
  const params = new URLSearchParams({
    q: query,
    language: 'tr',
    sortBy: 'publishedAt',
    pageSize: limit.toString(),
    apiKey: NEWS_API_KEY,
  });

  const response = await fetch(`https://newsapi.org/v2/everything?${params}`, {
    headers: { 'User-Agent': 'BIST-Analyst/1.0' },
  });

  if (!response.ok) {
    console.warn(`NewsAPI error: ${response.status}`);
    throw new Error(`NewsAPI: ${response.status}`);
  }

  const data = (await response.json()) as NewsResult;
  return data.articles || [];
}

/**
 * Twelve Data: Stock-focused
 * Free tier: 800 API calls/day
 * https://twelvedata.com/
 */
async function fetchTwelveDataNews(symbol: string, limit: number): Promise<NewsArticle[]> {
  const params = new URLSearchParams({
    symbol: symbol,
    limit: limit.toString(),
    apikey: TWELVEDATA_API_KEY,
  });

  const response = await fetch(`https://api.twelvedata.com/news?${params}`, {
    headers: { 'User-Agent': 'BIST-Analyst/1.0' },
  });

  if (!response.ok) {
    console.warn(`Twelve Data error: ${response.status}`);
    throw new Error(`Twelve Data: ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (!data.data) return [];

  return data.data.map((item: any) => ({
    title: item.title || '',
    description: item.description || '',
    content: item.description || '',
    publishedAt: item.published_at || new Date().toISOString(),
    source: { name: item.source || 'Twelve Data' },
    url: item.url || '',
  }));
}

/**
 * Demo news for testing without API key
 */
function getDemoNews(symbol: string): NewsArticle[] {
  const demoArticles: NewsArticle[] = [
    {
      title: `${symbol} Hisseleri Yükselişe Geçti`,
      description: 'Son teknik verilere göre güçlü alım sinyali görülüyor.',
      content: 'Kurumsal yatırımcılar pozisyon almaya başladı...',
      publishedAt: new Date().toISOString(),
      source: { name: 'Demo Kaynağı' },
      url: 'https://example.com',
    },
  ];
  return demoArticles;
}

/**
 * Extract sentiment-relevant snippets from news articles
 */
export function extractNewsSummary(articles: NewsArticle[]): string {
  const summaries = articles
    .slice(0, 5)
    .map((a) => `"${a.title}": ${a.description || a.content?.substring(0, 100) || ''}`)
    .join('\n');

  return summaries || 'Habercilik verisi yok.';
}
