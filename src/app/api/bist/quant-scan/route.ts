import { NextResponse } from "next/server";
import { fetchYahooOhlc } from "@/lib/yfinance";
import { runBacktest, BacktestParams } from "@/lib/backtest";
import { BistBar } from "@/lib/bist";
import { calculateQuantHorizons, atr } from "@/lib/indicators";

export const maxDuration = 300; // Allow long execution time

export async function POST(req: Request) {
  try {
    const { symbols, strategy } = await req.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: "Missing or invalid symbols array" }, { status: 400 });
    }

    if (!strategy) {
      return NextResponse.json({ error: "Missing strategy parameter" }, { status: 400 });
    }

    let indexBars: BistBar[] = [];
    if (strategy === "STATISTICAL_ARBITRAGE") {
      try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        indexBars = await fetchYahooOhlc("XU100.IS", ninetyDaysAgo, "1d");
      } catch (e) {
        console.warn("Failed to fetch index bars for Stat-Arb:", e);
      }
    }



    // Process all symbols in parallel for speed, but catch individual errors
    const scanPromises = symbols.map(async (symbol) => {
      try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const yfSymbol = symbol.includes(".") ? symbol : `${symbol}.IS`;
        
        let bars = await fetchYahooOhlc(yfSymbol, ninetyDaysAgo, "1d");
        
        if (!bars || bars.length < 30) {
          return null; // Not enough data
        }

        const params: BacktestParams = {
          bars,
          indexBars: indexBars.length > 0 ? indexBars : undefined,
          initialCapital: 10000,
          strategy: strategy as any,
        };

        const result = runBacktest(params);
        
        if (result.trades && result.trades.length > 0) {
          // Because runBacktest force-closes open positions at the end, the absolute last trade might be a SELL.
          // We need to find the last BUY trade and check if it occurred on the last bar.
          const lastBuy = [...result.trades].reverse().find(t => t.type === "BUY");
          const lastBar = bars[bars.length - 1];

          if (
            lastBuy && 
            lastBuy.date.toISOString().split('T')[0] === lastBar.date.toISOString().split('T')[0]
          ) {
            
            // Calculate Trade Plan (Quant Horizons)
            const highs = bars.map(b => b.high);
            const lows = bars.map(b => b.low);
            const closes = bars.map(b => b.close);
            const atrVals = atr(highs, lows, closes, 14);
            const currentAtr = atrVals[atrVals.length - 1] || (lastBar.close * 0.02);
            
            const tradePlan = calculateQuantHorizons(closes, highs, lows, currentAtr, lastBar.close, 1.0); // usdtryRate=1.0
            
            return {
              symbol,
              price: lastBuy.price,
              reason: lastBuy.reason,
              date: lastBuy.date,
              tradePlan
            };
          }
        }
        return null;
      } catch (err) {
        console.warn(`[QUANT-SCAN] Error scanning ${symbol}:`, err);
        return null; // Ignore failed symbols to keep the scan running
      }
    });

    const results = await Promise.all(scanPromises);
    
    // Filter out nulls
    const validMatches = results.filter((res) => res !== null);

    return NextResponse.json({ matches: validMatches });
  } catch (error: any) {
    console.error("[QUANT-SCAN API] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
