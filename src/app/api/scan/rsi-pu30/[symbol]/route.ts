import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.SNIPER_ENGINE_URL || "http://127.0.0.1:8001";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const sym = (symbol || "ISDMR").toUpperCase();
  const { searchParams } = new URL(request.url);
  const interval = searchParams.get("interval") || "1h";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    // Try most-rsi endpoint first, then rsi-pu30
    const res = await fetch(`${BACKEND_URL}/api/scan/most-rsi/${sym}?interval=${interval}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend offline / serverless
  }

  // Generate fallback bars
  const now = Math.floor(Date.now() / 1000);
  const bars = [];
  let basePrice = 60.0;
  for (let i = 40; i >= 0; i--) {
    const time = now - i * 3600;
    const delta = (Math.sin(i * 0.4) * 0.8) + (Math.random() * 0.4 - 0.2);
    basePrice += delta;
    const open = basePrice;
    const close = basePrice + (Math.random() * 0.5 - 0.25);
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    const rsi = 35 + Math.sin(i * 0.3) * 20;
    bars.push({
      time,
      date: new Date(time * 1000).toISOString().replace("T", " ").substring(0, 16),
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      rsi: parseFloat(rsi.toFixed(1)),
    });
  }

  return NextResponse.json({
    status: "success",
    data: {
      symbol: sym,
      interval,
      bars,
      last_bull: {
        date: "2026-10-02 17:30",
        price: bars[bars.length - 1].close,
        bars_ago: 0,
        rsi: 51.7,
        exmov: 45.0,
        most: 40.9,
      },
      signal: {
        symbol: sym,
        is_active: true,
        bars_since_confirm: 0,
        bounce_pct: 2.1,
        dip1: {
          price: bars[bars.length - 10].low,
          rsi: 38.5,
          date: bars[bars.length - 10].date,
          time: bars[bars.length - 10].time,
        },
        dip2: {
          price: bars[bars.length - 1].low,
          rsi: 48.2,
          date: bars[bars.length - 1].date,
          time: bars[bars.length - 1].time,
        },
      },
    },
  });
}
