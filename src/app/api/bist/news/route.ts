import { NextResponse } from 'next/server';
import { fetchMarketNews } from '@/lib/news';

export async function GET() {
  try {
    const news = await fetchMarketNews();
    return NextResponse.json({ success: true, news });
  } catch (error) {
    console.error("News API Error:", error);
    return NextResponse.json({ success: false, news: [] }, { status: 500 });
  }
}
