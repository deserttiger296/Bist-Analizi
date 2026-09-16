import { NextResponse } from "next/server";
import { runBackgroundScan } from "@/lib/backgroundScanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow this route to run for a while — a full BIST scan can take minutes.
export const maxDuration = 300;

// Local-only trigger for the market scan. Previously this required either a
// QStash webhook signature or a CRON_SECRET bearer token because it was
// exposed to the public internet (Vercel + GitHub Actions cron). The app now
// only runs on localhost, so it can be triggered directly — by the "run scan
// now" button in the UI, or by a local scheduler (cron / Windows Task
// Scheduler) hitting this endpoint on your own machine.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const index = url.searchParams.get("index") || "all";

  console.log(`[CronScan] Scan triggered for index ${index}`);

  try {
    console.log(`[CronScan] Starting market scan for index ${index}...`);
    const results = await runBackgroundScan(index);
    const lastRun = Date.now();

    console.log(`[CronScan] Scan complete — ${results.length} results synced.`);
    return NextResponse.json({ success: true, timestamp: lastRun, total: results.length });
  } catch (error: any) {
    console.error("[CronScan] Scan failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
