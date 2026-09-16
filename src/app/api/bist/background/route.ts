import { NextResponse } from "next/server";
import { getBackgroundResults, runBackgroundScan } from "@/lib/backgroundScanner";
import { recalculateScoreWithWeights } from "@/lib/bist";
import { getLatestScanResults } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A simple in-memory lock (this app runs as a single local Node process, so
// there's no need for the old Firestore-based distributed lock).
let isScanning = false;

export async function GET(request: Request) {
  try {
    let results: any[] = [];
    let lastRun = 0;

    // 1. Try the local memory store first (freshest, populated by the
    //    in-process scanner / most recent manual scan).
    const memStore = getBackgroundResults();
    if (memStore.results.length > 0) {
      results = memStore.results;
      lastRun = memStore.lastRun;
    }

    // 2. Fall back to local Postgres `scan_results` (survives server restarts).
    if (results.length === 0) {
      try {
        const rows = await getLatestScanResults(500);
        if (rows.length > 0) {
          results = rows.map((r) => ({
            symbol: r.symbol,
            status: r.status ?? "IZLE",
            confluenceScore: r.score ?? 0,
            alert: false,
            reasons: [],
            quote: {
              lastClose: 0,
              change: 0,
              rsi: 50,
              score: r.score ?? 0,
              confidence: r.score ?? 0,
              recommendation: r.recommendation ?? "",
              marketRegime: r.regime ?? "RANGING",
              name: r.symbol,
            },
          }));
          lastRun = new Date(rows[0].as_of).getTime();
        }
      } catch (dbErr) {
        console.warn("[Background API] Postgres fetch failed:", dbErr);
      }
    }

    // 3. Trigger a lazy background refresh if data is older than 5 minutes
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    if (Date.now() - lastRun > FIVE_MINUTES_MS && !isScanning) {
      console.log(`[Background API] Data is older than 5 minutes. Triggering lazy refresh in background...`);
      isScanning = true;
      runBackgroundScan()
        .catch(err => console.error("[Background API] Lazy background scan refresh failed:", err.message))
        .finally(() => { isScanning = false; });
    }

    const url = new URL(request.url);
    const trendW = url.searchParams.get("trendW");
    const momentumW = url.searchParams.get("momentumW");
    const volumeW = url.searchParams.get("volumeW");
    const structureW = url.searchParams.get("structureW");

    if ((trendW || momentumW || volumeW || structureW) && results.some(r => r.quote?.trendScore != null)) {
      const weights = {
        trend: Number(trendW ?? 30),
        momentum: Number(momentumW ?? 30),
        volume: Number(volumeW ?? 20),
        structure: Number(structureW ?? 20),
      };

      const updatedResults = results.map(item => {
        if (!item.quote) return item;
        const recalculated = recalculateScoreWithWeights(item.quote, weights);
        return {
          ...item,
          confluenceScore: recalculated.score,
          status: recalculated.status,
          reasons: recalculated.reasons,
          alert: recalculated.alert,
          quote: {
            ...item.quote,
            score: recalculated.score,
            confidence: recalculated.confidence,
            recommendation: recalculated.recommendation,
          }
        };
      });
      return NextResponse.json({ results: updatedResults, lastRun });
    }

    return NextResponse.json({ results, lastRun });
  } catch (err: any) {
    console.error("API GET Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const index = url.searchParams.get("index") || "all";

    if (isScanning) {
      console.log(`[Background API] Scan already in progress. Skipping double trigger.`);
      return NextResponse.json({
        status: "scanning",
        message: "Manuel tarama zaten arka planda devam ediyor."
      });
    }

    isScanning = true;
    console.log(`[Background API] Triggering background scan for index ${index}...`);

    // Fire-and-forget: run the scan without blocking this request. Local-only
    // now, so no QStash/CRON_SECRET auth dance is needed to reach it.
    runBackgroundScan(index)
      .catch(err => console.error("[Background API] Background scan failed:", err.message))
      .finally(() => { isScanning = false; });

    return NextResponse.json({
      status: "started",
      message: "Tarama arka planda başlatıldı."
    }, { status: 202 });

  } catch (err: any) {
    console.error("API POST Error:", err);
    isScanning = false;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
