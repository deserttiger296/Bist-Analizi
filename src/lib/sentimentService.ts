import Anthropic from '@anthropic-ai/sdk';
import { fetchStockNews, extractNewsSummary } from './newsService';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export interface SentimentAnalysis {
  sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  score: number; // 0-100
  summary: string; // Turkish 1-line summary
  newsCount: number;
  confidence: number; // 0-100
}

/**
 * Analyze sentiment for a stock based on recent news
 * Returns: sentiment direction, score (0-100), Turkish summary, and confidence level
 */
export async function analyzeSentiment(
  symbol: string,
  stockName: string,
): Promise<SentimentAnalysis> {
  try {
    // Fetch recent news
    const articles = await fetchStockNews(symbol, 10);
    if (!articles || articles.length === 0) {
      return {
        sentiment: 'NEUTRAL',
        score: 50,
        summary: 'Haber verisi bulunamadı. Teknik analiz tercih edin.',
        newsCount: 0,
        confidence: 20,
      };
    }

    const newsSummary = extractNewsSummary(articles);

    if (!process.env.ANTHROPIC_API_KEY) {
      // Fallback: Simple algorithmic sentiment
      const positiveWords = ['yükseli', 'güçlü', 'olumlu', 'potansiyel', 'kazanç'];
      const negativeWords = ['düşüş', 'zayıf', 'olumsuz', 'risk', 'kayıp'];

      let positiveCount = 0,
        negativeCount = 0;
      const lowerSummary = newsSummary.toLowerCase();
      positiveWords.forEach((w) => {
        positiveCount += (lowerSummary.match(new RegExp(w, 'g')) || []).length;
      });
      negativeWords.forEach((w) => {
        negativeCount += (lowerSummary.match(new RegExp(w, 'g')) || []).length;
      });

      const total = positiveCount + negativeCount || 1;
      const score = Math.round((positiveCount / total) * 100);

      return {
        sentiment: score > 55 ? 'BULLISH' : score < 45 ? 'BEARISH' : 'NEUTRAL',
        score,
        summary: `Haber duyarlılığı: ${
          score > 55 ? '✓ Olumlu' : score < 45 ? '✗ Olumsuz' : '→ Nötr'
        } (${articles.length} haber kaynağından).`,
        newsCount: articles.length,
        confidence: 40,
      };
    }

    // Use Claude for advanced sentiment analysis
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      temperature: 0.3,
      system: `Sen bir finansal habercilik analisti. Türkçe olarak, borsa haberleri hakkında duygusal analiz yap.
Yanıt biçimi:
SENTIMENT: BULLISH|NEUTRAL|BEARISH
SCORE: 0-100
SUMMARY: Tek satır Türkçe özet (en fazla 15 kelime)
CONFIDENCE: 0-100`,
      messages: [
        {
          role: 'user',
          content: `Hisse: ${symbol} (${stockName})\nSon haberler:\n${newsSummary}\n\nBu haberlerin ${symbol} için ne anlam taşıdığını analiz et.`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const sentiment = parseSentimentResponse(responseText);

    return {
      ...sentiment,
      newsCount: articles.length,
    };
  } catch (error) {
    console.error(`Failed to analyze sentiment for ${symbol}:`, error);
    return {
      sentiment: 'NEUTRAL',
      score: 50,
      summary: 'Duyarlılık analizi başarısız. Lütfen tekrar deneyin.',
      newsCount: 0,
      confidence: 10,
    };
  }
}

/**
 * Parse Claude's sentiment response
 */
function parseSentimentResponse(text: string): Omit<SentimentAnalysis, 'newsCount'> {
  const sentimentMatch = text.match(/SENTIMENT:\s*(BULLISH|NEUTRAL|BEARISH)/i);
  const scoreMatch = text.match(/SCORE:\s*(\d+)/);
  const summaryMatch = text.match(/SUMMARY:\s*([^\n]+)/);
  const confidenceMatch = text.match(/CONFIDENCE:\s*(\d+)/);

  const sentiment = (sentimentMatch?.[1]?.toUpperCase() || 'NEUTRAL') as 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  const score = Math.min(100, Math.max(0, parseInt(scoreMatch?.[1] || '50')));
  const summary = summaryMatch?.[1]?.trim() || 'Duyarlılık analizi tamamlandı.';
  const confidence = Math.min(100, Math.max(0, parseInt(confidenceMatch?.[1] || '50')));

  return { sentiment, score, summary, confidence };
}
