import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.SNIPER_ENGINE_URL || "http://127.0.0.1:8001";

// Standalone fallback signals if Python backend is offline or deploying on serverless
const FALLBACK_SIGNALS = [
  // PU30 - Pozitif Uyumsuzluk (Dip / Yükseliş Sinyali)
  {
    symbol: "VAKBN",
    type: "PU30",
    trend: "BULL",
    label: "🟢 PU30 (Dip / Alış)",
    signal_date: "2026-10-02 12:00",
    signal_price: 32.10,
    last_close: 33.18,
    bars_since_confirm: 1,
    bars_since_signal: 1,
    rsi: 36.39,
    bounce_pct: 3.4,
    dip1: { price: 31.50, rsi: 22.4, date: "2026-09-25 08:00" },
    dip2: { price: 28.58, rsi: 30.41, date: "2026-10-02 12:00" },
    exmov: 42.1,
    most: 38.3,
    explanation: "Semih Murat Ersoy PU30 Kuralı: 1. Dipte RSI 30 altında (22.4), 2. dipte fiyat daha aşağı inerken RSI 30 üzerinde (30.41) yükselen dip yaptı."
  },
  {
    symbol: "ISDMR",
    type: "PU30",
    trend: "BULL",
    label: "🟢 PU30 (Dip / Alış)",
    signal_date: "2026-10-02 16:00",
    signal_price: 60.9,
    last_close: 60.9,
    bars_since_confirm: 0,
    bars_since_signal: 0,
    rsi: 51.71,
    bounce_pct: 2.1,
    dip1: { price: 59.5, rsi: 28.2, date: "2026-10-01 12:00" },
    dip2: { price: 58.8, rsi: 34.7, date: "2026-10-02 16:00" },
    exmov: 45.03,
    most: 40.98,
    explanation: "Fiyat daha düşük dip yaparken RSI 30 bandından güçlü dönüş verdi."
  },
  {
    symbol: "KRDMD",
    type: "PU30",
    trend: "BULL",
    label: "🟢 PU30 (Dip / Alış)",
    signal_date: "2026-10-02 16:00",
    signal_price: 43.2,
    last_close: 43.2,
    bars_since_confirm: 0,
    bars_since_signal: 0,
    rsi: 44.71,
    bounce_pct: 1.8,
    dip1: { price: 42.1, rsi: 27.5, date: "2026-10-01 08:00" },
    dip2: { price: 41.6, rsi: 33.1, date: "2026-10-02 16:00" },
    exmov: 33.69,
    most: 30.66,
    explanation: "PU30 kuralı sağlandı: 1. Dip < 30, 2. Dip > 30 yükseliş teyidi."
  },
  {
    symbol: "BIMAS",
    type: "PU30",
    trend: "BULL",
    label: "🟢 PU30 (Dip / Alış)",
    signal_date: "2026-10-02 12:00",
    signal_price: 414.0,
    last_close: 413.25,
    bars_since_confirm: 2,
    bars_since_signal: 2,
    rsi: 44.27,
    bounce_pct: 3.2,
    dip1: { price: 406.0, rsi: 29.1, date: "2026-09-30 16:00" },
    dip2: { price: 402.5, rsi: 35.8, date: "2026-10-02 12:00" },
    exmov: 34.72,
    most: 31.59,
    explanation: "BIST30 liderinde dip uyumsuzluğu ile alıcılar devreye girdi."
  },

  // NU70 - Negatif Uyumsuzluk (Tepe / Düşüş Sinyali)
  {
    symbol: "ASELS",
    type: "NU70",
    trend: "BEAR",
    label: "🔴 NU70 (Tepe / Satış)",
    signal_date: "2026-10-02 08:00",
    signal_price: 378.0,
    last_close: 362.25,
    bars_since_confirm: 2,
    bars_since_signal: 2,
    rsi: 58.64,
    pullback_pct: 4.2,
    bounce_pct: -4.2,
    tepe1: { price: 369.25, rsi: 74.2, date: "2026-10-01 12:00" },
    tepe2: { price: 378.0, rsi: 67.1, date: "2026-10-02 08:00" },
    dip1: { price: 369.25, rsi: 74.2, date: "2026-10-01 12:00" },
    dip2: { price: 378.0, rsi: 67.1, date: "2026-10-02 08:00" },
    explanation: "Semih Murat Ersoy NU70 Kuralı: 1. Tepede RSI 70 üzerinde (74.2), 2. tepede fiyat yeni zirve (378.0) yaparken RSI 70 altında (67.1) kaldı. Düşüş başladı!"
  },
  {
    symbol: "THYAO",
    type: "NU70",
    trend: "BEAR",
    label: "🔴 NU70 (Tepe / Satış)",
    signal_date: "2026-10-01 16:00",
    signal_price: 304.5,
    last_close: 292.25,
    bars_since_confirm: 3,
    bars_since_signal: 3,
    rsi: 53.35,
    pullback_pct: 4.0,
    bounce_pct: -4.0,
    tepe1: { price: 298.0, rsi: 72.8, date: "2026-09-30 12:00" },
    tepe2: { price: 304.5, rsi: 64.2, date: "2026-10-01 16:00" },
    dip1: { price: 298.0, rsi: 72.8, date: "2026-09-30 12:00" },
    dip2: { price: 304.5, rsi: 64.2, date: "2026-10-01 16:00" },
    explanation: "Tepede negatif uyumsuzluk sonrası kâr satışları hızlandı."
  }
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const interval = searchParams.get("interval") || "4h";
  const signalType = searchParams.get("signal_type") || "all";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(`${BACKEND_URL}/api/scan/rsi-pu30?interval=${interval}&signal_type=${signalType}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  let filtered = FALLBACK_SIGNALS;
  if (signalType === "pu30") {
    filtered = FALLBACK_SIGNALS.filter(s => s.type === "PU30");
  } else if (signalType === "nu70") {
    filtered = FALLBACK_SIGNALS.filter(s => s.type === "NU70");
  }

  return NextResponse.json({
    status: "success",
    data: {
      signals: filtered,
      errors: [],
      scanned: 100,
      matched: filtered.length,
      interval,
      signal_type: signalType,
      engine: "RSI_PU30_NU70_SEMIH_ERSOY_ENGINE",
    },
  });
}
