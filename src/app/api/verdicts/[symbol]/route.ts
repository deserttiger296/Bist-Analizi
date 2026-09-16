import { NextResponse } from 'next/server';
import { analyzeSentiment } from '@/lib/sentimentService';
import { verdictCache } from '@/lib/verdictCache';

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    const upperSymbol = symbol.toUpperCase();
    
    // Check cache first
    const cached = verdictCache.get(upperSymbol);
    if (cached) {
      return NextResponse.json({ 
        verdict: cached,
        cached: true,
        timestamp: new Date().toISOString(),
      });
    }

    // If not cached, generate new verdict
    const verdict = await generateVerdict(upperSymbol);
    
    // Cache for 4 hours
    verdictCache.set(upperSymbol, verdict);

    return NextResponse.json({
      verdict,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Verdict generation error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate verdict' },
      { status: 500 }
    );
  }
}

/**
 * Generate institutional verdict in Turkish
 * Combines technical score with sentiment analysis
 */
async function generateVerdict(symbol: string): Promise<string> {
  try {
    // Get sentiment from news
    const sentiment = await analyzeSentiment(symbol, symbol);

    // Create a concise Turkish verdict
    const sentimentText = 
      sentiment.sentiment === 'BULLISH' ? '✓ Olumlu haber havası' :
      sentiment.sentiment === 'BEARISH' ? '✗ Olumsuz haber havası' :
      '→ Nötr haber ortamı';

    const verdict = `${sentimentText}. ${sentiment.summary}`;

    return verdict;
  } catch (error) {
    console.error(`Failed to generate verdict for ${symbol}:`, error);
    return 'Verdikt oluşturulamadı. Lütfen tekrar deneyin.';
  }
}

export const revalidate = 300; // ISR: revalidate every 5 minutes
