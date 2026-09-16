import { NextResponse } from "next/server";
import ccxt from "ccxt";

export async function GET() {
  try {
    // Instantiate ccxt binance client
    const binance = new ccxt.binance({
      timeout: 10000,
      enableRateLimit: true,
    });

    const btc = await binance.fetchTicker("BTC/USDT");
    const eth = await binance.fetchTicker("ETH/USDT");

    return NextResponse.json({
      source: "live",
      BTC_USDT: {
        last: btc.last,
        change_24h_pct: btc.percentage,
      },
      ETH_USDT: {
        last: eth.last,
        change_24h_pct: eth.percentage,
      },
    });
  } catch (err: any) {
    console.error("[ccxt API error]:", err);
    // Fallback static metrics in case of network blocking or rate limiting in serverless env.
    // Flagged with source:"fallback" and a warning so callers don't mistake these
    // stale hardcoded prices for live data.
    return NextResponse.json({
      source: "fallback",
      warning: "Live Binance fetch failed; showing stale placeholder prices, not real market data.",
      BTC_USDT: { last: 95200.0, change_24h_pct: 1.25 },
      ETH_USDT: { last: 3150.0, change_24h_pct: -0.45 },
    });
  }
}
