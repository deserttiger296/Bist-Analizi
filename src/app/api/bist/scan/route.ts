import { NextResponse } from "next/server";
import { defaultTrackerSymbols } from "@/lib/constants";
import { BIST_SYMBOLS } from "@/lib/bist100";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbolsParam = url.searchParams.get("symbols");
    const mode = url.searchParams.get("mode"); // "full" = all symbols, "tracker" = default

    let symbols: string[];
    if (symbolsParam) {
      symbols = symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    } else if (mode === "full") {
      symbols = BIST_SYMBOLS;
    } else {
      symbols = defaultTrackerSymbols;
    }

    const weights = {
      trend: Number(url.searchParams.get("trendW") ?? 30),
      momentum: Number(url.searchParams.get("momentumW") ?? 30),
      volume: Number(url.searchParams.get("volumeW") ?? 20),
      structure: Number(url.searchParams.get("structureW") ?? 20),
    };

    const params = {
      minScore: Number(url.searchParams.get("minScore") ?? 60),
      maxRsi: Number(url.searchParams.get("maxRsi") ?? 85),
      minSma20Distance: Number(url.searchParams.get("minSma20Distance") ?? 10),
      minVolumeMultiple: Number(url.searchParams.get("minVolumeMultiple") ?? 1.5),
      minPasses: Number(url.searchParams.get("minPasses") ?? 5),
      requireHigherHighs: url.searchParams.get("requireHigherHighs") !== "false",
      requireHigherLows: url.searchParams.get("requireHigherLows") !== "false",
      weights,
    };

    // MASSIVE OPTIMIZATION: Return pre-calculated cached results instead of blocking the thread!
    const { getBackgroundResults } = await import("@/lib/backgroundScanner");
    const memStore = getBackgroundResults();
    const results = memStore.results.filter(r => symbols.includes(r.symbol));

    // Dynamic Scanning fallback for missing/custom symbols requested by TrackerPanel
    const missingSymbols = symbols.filter(s => !results.some(r => r.symbol === s));
    if (missingSymbols.length > 0) {
      console.log(`[Scan API] Dynamically scanning ${missingSymbols.length} missing symbols: ${missingSymbols.join(", ")}`);
      try {
        const { scanBistSymbols } = await import("@/lib/bist");
        const dynamicResults = await scanBistSymbols(missingSymbols, params);
        if (dynamicResults.length > 0) {
          // Merge into the global memory store so future reads are instantly cached
          const resultMap = new Map(memStore.results.map(r => [r.symbol, r]));
          dynamicResults.forEach(r => resultMap.set(r.symbol, r));
          memStore.results = Array.from(resultMap.values());

          // 3. Append to returned results
          results.push(...dynamicResults);
        }
      } catch (scanErr) {
        console.error("[Scan API] Dynamic scan of missing symbols failed:", scanErr);
      }
    }

    return NextResponse.json({ params, results, scannedCount: symbols.length });
  } catch (error: any) {
    console.error("Scan route error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Scan failed", results: [] },
      { status: 500 }
    );
  }
}
