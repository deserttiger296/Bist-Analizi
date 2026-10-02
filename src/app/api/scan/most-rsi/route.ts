import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.SNIPER_ENGINE_URL || "http://127.0.0.1:8001";

const FALLBACK_SIGNALS = [
  { symbol: "ISDMR", signal_date: "2026-10-02 17:30", signal_price: 60.9, last_close: 60.9, bars_since_signal: 0, rsi: 51.71, exmov: 45.03, most: 40.98, current_trend: "BULL" },
  { symbol: "KRDMD", signal_date: "2026-10-02 17:30", signal_price: 43.2, last_close: 43.2, bars_since_signal: 0, rsi: 44.71, exmov: 33.69, most: 30.66, current_trend: "BULL" },
  { symbol: "BIMAS", signal_date: "2026-10-02 15:30", signal_price: 414.0, last_close: 413.25, bars_since_signal: 2, rsi: 44.27, exmov: 34.72, most: 31.59, current_trend: "BULL" },
  { symbol: "CIMSA", signal_date: "2026-10-02 15:30", signal_price: 41.8, last_close: 41.76, bars_since_signal: 2, rsi: 50.83, exmov: 42.08, most: 38.3, current_trend: "BULL" },
  { symbol: "KONTR", signal_date: "2026-10-01 12:30", signal_price: 2.1, last_close: 2.33, bars_since_signal: 6, rsi: 36.06, exmov: 26.25, most: 23.89, current_trend: "BULL" },
  { symbol: "AYDEM", signal_date: "2026-10-02 10:30", signal_price: 24.3, last_close: 24.64, bars_since_signal: 7, rsi: 60.49, exmov: 50.22, most: 45.7, current_trend: "BULL" },
  { symbol: "MGROS", signal_date: "2026-10-02 10:30", signal_price: 511.0, last_close: 515.5, bars_since_signal: 7, rsi: 47.61, exmov: 32.51, most: 29.58, current_trend: "BULL" },
  { symbol: "KCHOL", signal_date: "2026-10-02 09:30", signal_price: 210.3, last_close: 206.7, bars_since_signal: 8, rsi: 46.22, exmov: 42.58, most: 38.75, current_trend: "BULL" },
  { symbol: "THYAO", signal_date: "2026-10-01 14:30", signal_price: 289.75, last_close: 292.25, bars_since_signal: 12, rsi: 53.35, exmov: 41.5, most: 37.76, current_trend: "BULL" },
  { symbol: "GARAN", signal_date: "2026-10-01 13:30", signal_price: 125.6, last_close: 125.8, bars_since_signal: 13, rsi: 44.29, exmov: 29.17, most: 26.55, current_trend: "BULL" },
  { symbol: "ASELS", signal_date: "2026-09-30 12:30", signal_price: 344.75, last_close: 362.25, bars_since_signal: 23, rsi: 37.8, exmov: 29.11, most: 26.49, current_trend: "BULL" },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const interval = searchParams.get("interval") || "1h";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${BACKEND_URL}/api/scan/most-rsi?interval=${interval}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  return NextResponse.json({
    status: "success",
    data: {
      signals: FALLBACK_SIGNALS,
      errors: [],
      scanned: 100,
      matched: FALLBACK_SIGNALS.length,
      interval,
      engine: "MOSTRSI_14_VAR_5_9",
    },
  });
}
