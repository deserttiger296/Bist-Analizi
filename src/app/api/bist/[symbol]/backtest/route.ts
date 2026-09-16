import { NextResponse } from "next/server";
import { fetchChartData } from "@/lib/bist";
import { runBacktest } from "@/lib/backtest";

export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  
  const { searchParams } = new URL(request.url);
  const initialCapital = Number(searchParams.get("capital") || "100000");
  const strategy = searchParams.get("strategy") as any || "VOLATILITY_BREAKOUT";

  try {
    const data = await fetchChartData(symbol);
    if (!data || !data.chartData || data.chartData.length === 0) {
      throw new Error("Tarihsel veri bulunamadı");
    }

    // Convert chartData to BistBar array
    const bars = data.chartData.map((d: any) => ({
      date: new Date(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume
    }));

    let indexBars = undefined;
    if (strategy === "STATISTICAL_ARBITRAGE") {
      const indexData = await fetchChartData("XU100.IS");
      if (indexData && indexData.chartData) {
        indexBars = indexData.chartData.map((d: any) => ({
          date: new Date(d.date),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume
        }));
      }
    }

    const result = runBacktest({
      bars,
      indexBars,
      initialCapital,
      strategy,
      rsiBuyThreshold: 70,
      rsiSellThreshold: 80
    });

    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Backtest failed", symbol },
      { status: 500 }
    );
  }
}
