import { NextResponse } from "next/server";
import { fetchEnrichedFundamentals } from "@/lib/fundScraper";

export async function GET(_: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();

  // Validate symbol
  if (!symbol || symbol.length < 2 || symbol.length > 10) {
    return NextResponse.json(
      { error: "Geçersiz sembol", symbol },
      { status: 400 }
    );
  }

  try {
    const data = await fetchEnrichedFundamentals(symbol);

    // Check if all sources failed
    const allFailed = Object.values(data.sources).every((s) => s === 'failed');

    if (allFailed) {
      return NextResponse.json(
        {
          error: "Temel veri kaynakları yanıt vermedi",
          symbol,
          sources: data.sources,
          errors: data.errors,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    console.error(`[API /bist/${symbol}/fundamentals] Error:`, message);
    return NextResponse.json(
      { error: message, symbol },
      { status: 500 }
    );
  }
}
