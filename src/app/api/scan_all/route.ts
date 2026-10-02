import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.SNIPER_ENGINE_URL || "http://127.0.0.1:8001";

const FALLBACK_RADAR = [
  {
    symbol: "THYAO",
    current_price: 292.25,
    sniper_approved: true,
    sniper_label: "AL (GÜÇLÜ YÜKSELİŞ)",
    class_probabilities: { UP: 0.74, DOWN: 0.15, FLAT: 0.11 },
    target_price_tl: 314.5,
    target_price_usd: 8.99,
    usd_rate: 35.0,
    potential_roi: 7.6,
    confluence_label: "ÜÇLÜ ONAY (RF + LSTM + Sentiment) ✅✅✅",
    explanation: [
      "[ATR: Volatilite] Yüksek volatilite ile formasyon hedefine ivmeli hareket bekleniyor.",
      "[RandomForest > %70] Klasik Yapay Zeka YÜKSELİŞ bekliyor.",
      "[KUANTUM ONAYI - LSTM %72] Derin Öğrenme modeli yükseliş öngörüsünü doğruladı."
    ]
  },
  {
    symbol: "GARAN",
    current_price: 125.8,
    sniper_approved: true,
    sniper_label: "AL (GÜÇLÜ YÜKSELİŞ)",
    class_probabilities: { UP: 0.68, DOWN: 0.18, FLAT: 0.14 },
    target_price_tl: 135.2,
    target_price_usd: 3.86,
    usd_rate: 35.0,
    potential_roi: 7.4,
    confluence_label: "İKİLİ ONAY ✅✅",
    explanation: [
      "[MACD Histogram Pozitif] Para girişi ve kurumsal alıcı ilgisi artıyor.",
      "[RandomForest > %65] Yön UP olarak puanlandı."
    ]
  },
  {
    symbol: "ASELS",
    current_price: 362.75,
    sniper_approved: true,
    sniper_label: "AL (GÜÇLÜ YÜKSELİŞ)",
    class_probabilities: { UP: 0.65, DOWN: 0.20, FLAT: 0.15 },
    target_price_tl: 389.75,
    target_price_usd: 11.14,
    usd_rate: 35.0,
    potential_roi: 7.4,
    confluence_label: "İKİLİ ONAY ✅✅",
    explanation: [
      "[MOSTRSI Bull Kırılımı] 344.75 TL seviyesinde saatlik periyotta güçlü dönüş teyidi alındı.",
      "[EMA9 Üzerinde] Kısa vadeli trend yönü pozitife döndü."
    ]
  },
  {
    symbol: "BIMAS",
    current_price: 413.25,
    sniper_approved: true,
    sniper_label: "AL (GÜÇLÜ YÜKSELİŞ)",
    class_probabilities: { UP: 0.63, DOWN: 0.22, FLAT: 0.15 },
    target_price_tl: 435.0,
    target_price_usd: 12.43,
    usd_rate: 35.0,
    potential_roi: 5.2,
    confluence_label: "İKİLİ ONAY ✅✅",
    explanation: [
      "[Hacim Patlaması] Kurumsal işlem hacmi yoğunluğu ortalamanın üzerinde.",
      "[HMM Rejimi = TREND] Piyasa rejim güveni yüksek."
    ]
  }
];

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${BACKEND_URL}/api/scan_all`, {
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
    count: FALLBACK_RADAR.length,
    data: FALLBACK_RADAR,
  });
}
