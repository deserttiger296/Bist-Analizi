import { NextResponse } from 'next/server';
import { analyzeRS } from '@/lib/quant/rsAlpha';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json(
      { success: false, error: 'Symbol parameter is required. (e.g. ?symbol=MIATK)' },
      { status: 400 }
    );
  }

  try {
    const analysis = await analyzeRS(symbol);
    return NextResponse.json({ success: true, data: analysis });
  } catch (error: any) {
    console.error('RS Alpha API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'RS Alpha Analysis Failed' },
      { status: 500 }
    );
  }
}
