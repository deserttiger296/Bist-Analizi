import { NextResponse } from "next/server";
import { fetchChartData } from "@/lib/bist";

export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const url = new URL(request.url);
  const currency = (url.searchParams.get("currency") || "try").toLowerCase() as 'try' | 'usd';

  try {
    const chartData = await fetchChartData(symbol, currency);
    return NextResponse.json({ data: chartData });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Chart data fetch failed", symbol },
      { status: 500 }
    );
  }
}
