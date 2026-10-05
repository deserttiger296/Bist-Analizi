import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { Cache } from './cache';
import { fetchStockNews, extractNewsSummary } from './newsService';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const SENTIMENT_MODEL = 'claude-opus-5-5';
// Same news set => same analysis. Keyed by a hash of the news text, so an
// unchanged headline set never triggers a second paid call, however often
// the symbol is re-analyzed.
const LLM_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export type SentimentEngine = 'claude' | 'lexicon' | 'no_news';

export interface SentimentAnalysis {
  sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  score: number; // 0-100
  summary: string; // Turkish 1-line summary
  newsCount: number;
  confidence: number; // 0-100
  engine: SentimentEngine;
}

/**
 * Analyze sentiment for a stock based on recent news.
 * Returns null when the analysis itself failed (API error, refusal, parse
 * failure) -- callers must treat that as "no sentiment", never as neutral news.
 */
export async function analyzeSentiment(
  symbol: string,
  stockName: string,
): Promise<SentimentAnalysis | null> {
  const articles = await fetchStockNews(symbol, 10);
  if (!articles || articles.length === 0) {
    return {
      sentiment: 'NEUTRAL',
      score: 50,
      summary: 'Haber verisi bulunamadı; duyarlılık teyidi yok.',
      newsCount: 0,
      confidence: 0,
      engine: 'no_news',
    };
  }

  const newsSummary = extractNewsSummary(articles);

  if (!process.env.ANTHROPIC_API_KEY) {
    return lexiconSentiment(newsSummary, articles.length);
  }

  const cacheKey = `llm_sentiment_${symbol}_${createHash('sha1').update(newsSummary).digest('hex')}`;
  const cached = await Cache.get<SentimentAnalysis>(cacheKey).catch(() => null);
  if (cached) return cached;

  try {
    const message = await anthropic.messages.create({
      model: SENTIMENT_MODEL,
      max_tokens: 1024,
      // Short classification: low effort keeps thinking (always on for this model) and spend small.
      output_config: { effort: 'low' },
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

    if (message.stop_reason === 'refusal') return null;
    const textBlock = message.content.find((b) => b.type === 'text');
    const parsed = parseSentimentResponse(textBlock && textBlock.type === 'text' ? textBlock.text : '');
    if (!parsed) return null;

    const result: SentimentAnalysis = { ...parsed, newsCount: articles.length, engine: 'claude' };
    await Cache.set(cacheKey, result, LLM_RESULT_TTL_MS).catch(() => undefined);
    return result;
  } catch (error) {
    console.error(`Failed to analyze sentiment for ${symbol}:`, error);
    return null;
  }
}

function lexiconSentiment(newsSummary: string, newsCount: number): SentimentAnalysis {
  const positiveWords = ['yükseli', 'güçlü', 'olumlu', 'potansiyel', 'kazanç'];
  const negativeWords = ['düşüş', 'zayıf', 'olumsuz', 'risk', 'kayıp'];
  const lower = newsSummary.toLowerCase();
  const count = (words: string[]) =>
    words.reduce((n, w) => n + (lower.match(new RegExp(w, 'g')) || []).length, 0);
  const positiveCount = count(positiveWords);
  const negativeCount = count(negativeWords);
  const total = positiveCount + negativeCount || 1;
  const score = Math.round((positiveCount / total) * 100);

  return {
    sentiment: score > 55 ? 'BULLISH' : score < 45 ? 'BEARISH' : 'NEUTRAL',
    score,
    summary: `Haber duyarlılığı (sözlük): ${
      score > 55 ? '✓ Olumlu' : score < 45 ? '✗ Olumsuz' : '→ Nötr'
    } (${newsCount} haber kaynağından).`,
    newsCount,
    confidence: 40,
    engine: 'lexicon',
  };
}

/** Returns null unless the response carries a recognizable SENTIMENT line. */
function parseSentimentResponse(
  text: string,
): Omit<SentimentAnalysis, 'newsCount' | 'engine'> | null {
  const sentimentMatch = text.match(/SENTIMENT:\s*(BULLISH|NEUTRAL|BEARISH)/i);
  if (!sentimentMatch) return null;
  const scoreMatch = text.match(/SCORE:\s*(\d+)/);
  const summaryMatch = text.match(/SUMMARY:\s*([^\n]+)/);
  const confidenceMatch = text.match(/CONFIDENCE:\s*(\d+)/);

  return {
    sentiment: sentimentMatch[1].toUpperCase() as 'BULLISH' | 'NEUTRAL' | 'BEARISH',
    score: Math.min(100, Math.max(0, parseInt(scoreMatch?.[1] || '50'))),
    summary: summaryMatch?.[1]?.trim() || 'Duyarlılık analizi tamamlandı.',
    confidence: Math.min(100, Math.max(0, parseInt(confidenceMatch?.[1] || '50'))),
  };
}
