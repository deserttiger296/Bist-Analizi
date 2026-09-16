import { NextResponse } from "next/server";
import { fetchBistLiveQuote } from "@/lib/bist";
import { isBistLiveQuote } from "@/lib/format";

export async function GET(_: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();

  if (!symbol || symbol.length < 2 || symbol.length > 10) {
    return NextResponse.json(
      { error: "Geçersiz sembol", symbol },
      { status: 400 }
    );
  }

  try {
    const quote = await fetchBistLiveQuote(symbol);
    
    // Type guard validation
    if (!isBistLiveQuote(quote)) {
      return NextResponse.json(
        { error: "Veri doğrulama hatası — beklenen format alınamadı", symbol },
        { status: 502 }
      );
    }

    // Check for dead data (price = 0 means the fetch silently failed)
    if (quote.lastClose === 0) {
      return NextResponse.json(
        { error: "Canlı fiyat verisi alınamadı", symbol },
        { status: 503 }
      );
    }

    return NextResponse.json(quote);
  } catch (error: any) {
    console.error(`[API /bist/${symbol}] Error:`, error?.message || error);
    return NextResponse.json(
      { error: error?.message ?? "Quote fetch failed", symbol },
      { status: 500 }
    );
  }
}
