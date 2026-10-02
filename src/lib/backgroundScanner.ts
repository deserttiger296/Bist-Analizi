// src/lib/backgroundScanner.ts

import { scanBistSymbols, TrackerParams } from "@/lib/bist";
import { BIST_SYMBOLS } from "@/lib/bist100";
import type { TrackerResult } from "@/lib/bist";
import { Cache } from "./cache";
import { upsertStock, upsertScanResult, isPostgresAvailable } from "@/lib/db";
import { getSniperScanAll } from "@/lib/sniperEngine";

// Global store for results (server‑side only)
interface ScannerStore {
  results: TrackerResult[];
  lastRun: number;
  intervalId?: NodeJS.Timeout;
}

// Use a global variable to keep state across requests (works in Next.js server runtime)
const globalStore: ScannerStore = (global as any)._bistBackgroundScanner || {
  results: [],
  lastRun: 0,
};
(global as any)._bistBackgroundScanner = globalStore;

const RESULTS_TTL = 24 * 60 * 60 * 1000; // Store for 24h

// Configuration – run every 1 hour
const SCAN_INTERVAL_MS = 1 * 60 * 60 * 1000;

const params: TrackerParams = {
  minScore: 60,
  maxRsi: 85,
  minSma20Distance: 10,
  minVolumeMultiple: 1.5,
  minPasses: 5,
  requireHigherHighs: true,
  requireHigherLows: true,
};

// Persist scan results to the local Postgres `stocks` / `scan_results` tables.
// Replaces the old dual Firestore + Firebase Data Connect (cloud Postgres) sync.
async function persistResultsToPostgres(results: TrackerResult[]) {
  if (!isPostgresAvailable()) {
    console.warn(`[BackgroundScanner] Postgres unavailable, skipping persistence for ${results.length} results (will retry once the connection recovers)`);
    return;
  }

  const asOf = new Date().toISOString().split("T")[0];
  const CHUNK_SIZE = 30;
  let successCount = 0;

  for (let i = 0; i < results.length; i += CHUNK_SIZE) {
    const chunk = results.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (r: any) => {
        try {
          await upsertStock({
            symbol: r.symbol,
            name: r.quote?.name || r.symbol,
            sector: r.quote?.sector || null,
          });
          await upsertScanResult({
            symbol: r.symbol,
            as_of: asOf,
            status: r.status,
            score: Math.round(r.confluenceScore ?? r.quote?.score ?? 0),
            regime: r.quote?.hmmRegimeState ?? r.quote?.marketRegime ?? null,
            ml_label: null,
            ml_probability: null,
            recommendation: r.quote?.recommendation ?? null,
          });
          successCount++;
        } catch (e) {
          console.warn(`[BackgroundScanner] Failed to persist ${r.symbol} to Postgres:`, e);
        }
      })
    );
  }
  console.log(`[BackgroundScanner] Persisted ${successCount}/${results.length} stocks to local Postgres.`);
}

export async function forceRunScan() {
  try {
    const results = await mergeSniperResults(await scanBistSymbols(BIST_SYMBOLS, params));
    globalStore.results = results;
    globalStore.lastRun = Date.now();

    await Cache.set("scanner_results", results, RESULTS_TTL);
    await Cache.set("scanner_last_run", globalStore.lastRun, RESULTS_TTL);

    try {
      await persistResultsToPostgres(results);
    } catch (e) {
      console.warn("[BackgroundScanner] Postgres persistence failed:", e);
    }

    console.log(`[BackgroundScanner] Forced scan completed – ${results.length} alerts at ${new Date().toLocaleTimeString()}`);
    return results;
  } catch (err) {
    console.error("[BackgroundScanner] forced scan error", err);
    throw err;
  }
}

// Merges the sniper engine's own full-universe scan (RF + LSTM + sentiment
// confluence, run server-side in Python, parallelized) into the JS-scored
// results by symbol. The JS composite score stays the fast first-pass filter
// across the whole symbol list; this attaches the sniper's real verdict onto
// whichever of those symbols it also approved, so "ONAYLI AL" cards can show
// genuine ML confirmation instead of only the technical score. Best-effort:
// if the sniper engine isn't running, results are returned unchanged.
async function mergeSniperResults(results: TrackerResult[]): Promise<TrackerResult[]> {
  const sniperScan = await getSniperScanAll().catch(() => null);
  if (!sniperScan || sniperScan.data.length === 0) return results;

  const sniperBySymbol = new Map(sniperScan.data.map(p => [p.symbol, p]));
  let matched = 0;

  for (const result of results) {
    const sniperPrediction = sniperBySymbol.get(result.symbol);
    if (!sniperPrediction) continue;
    result.quote.sniper = sniperPrediction;
    matched++;
    // Sniper confirmation upgrades an already-decent technical score to a
    // firm "AL" status rather than overriding a weak one outright -- the
    // sniper's own threshold gating already happened server-side, so this
    // is about surfacing agreement, not letting one engine invent a signal
    // the other found no support for at all.
    if (sniperPrediction.sniper_approved && result.confluenceScore >= 45 && result.status !== "AL") {
      result.status = "AL";
      result.alert = true;
      result.reasons = [
        `🎯 Sniper Motoru Onayı: ${sniperPrediction.sniper_label} (${sniperPrediction.confluence_label})`,
        ...result.reasons,
      ];
    }
  }

  console.log(`[BackgroundScanner] Sniper engine confirmed ${matched}/${results.length} scanned symbols (${sniperScan.data.length} total sniper approvals)`);
  return results;
}

export async function runBackgroundScan(index: string = "all") {
  console.log(`[BackgroundScanner] Starting scan for index: ${index}...`);

  // Load from cache on first run if empty
  if (globalStore.results.length === 0) {
    try {
      const cachedResults = await Cache.get<TrackerResult[]>("scanner_results");
      const cachedLastRun = await Cache.get<number>("scanner_last_run");
      if (cachedResults) {
        globalStore.results = cachedResults;
      }
      if (cachedLastRun) globalStore.lastRun = cachedLastRun;
    } catch (e) {}
  }

  try {
    let targetSymbols = BIST_SYMBOLS;
    if (index === "bist30" || index === "bist100" || index === "others") {
      const { BIST_30, BIST_100 } = await import("./indices");
      if (index === "bist30") targetSymbols = BIST_SYMBOLS.filter(s => BIST_30.includes(s.replace('.IS', '')));
      else if (index === "bist100") targetSymbols = BIST_SYMBOLS.filter(s => BIST_100.includes(s.replace('.IS', '')));
      else if (index === "others") targetSymbols = BIST_SYMBOLS.filter(s => !BIST_100.includes(s.replace('.IS', '')));
    }
    console.log(`[BackgroundScanner] Sliced target symbols size: ${targetSymbols.length}`);

    const results = await mergeSniperResults(await scanBistSymbols(targetSymbols, params));

    // Merge into globalStore
    if (globalStore.results.length === 0) {
      globalStore.results = results;
    } else {
      const resultMap = new Map(globalStore.results.map(r => [r.symbol, r]));
      results.forEach(r => resultMap.set(r.symbol, r));
      globalStore.results = Array.from(resultMap.values());
    }
    globalStore.lastRun = Date.now();

    // Persist to local Postgres (replaces Firestore + Firebase Data Connect sync)
    try {
      await persistResultsToPostgres(results);
    } catch (dbErr) {
      console.warn("[BackgroundScanner] Postgres sync failed:", dbErr);
    }

    await Cache.set("scanner_results", globalStore.results, RESULTS_TTL);
    await Cache.set("scanner_last_run", globalStore.lastRun, RESULTS_TTL);

    console.log(`[BackgroundScanner] Scan completed – ${results.length} alerts`);
    return results;
  } catch (err: any) {
    console.error("[BackgroundScanner] scan error", err.message);
    throw err;
  }
}

function startBackgroundScanner() {
  if (globalStore.intervalId) return;

  // Local-only system: no serverless/QStash path anymore. Run an interval
  // scanner whenever the Next.js server process is up.
  console.log("[BackgroundScanner] Starting local interval scanner...");
  globalStore.intervalId = setInterval(runBackgroundScan, SCAN_INTERVAL_MS);
}

async function initializeStoreFromCache() {
  try {
    const cachedResults = await Cache.get<TrackerResult[]>("scanner_results");
    const cachedLastRun = await Cache.get<number>("scanner_last_run");
    if (cachedResults && cachedResults.length > 0) {
      globalStore.results = cachedResults;
      console.log(`[BackgroundScanner] Loaded ${cachedResults.length} results from Cache.`);
    }
    if (cachedLastRun) globalStore.lastRun = cachedLastRun;
  } catch (e) {}

  // No static fallback JSON — scanner will populate on first live scan run.
}

// Start when this module is imported (server startup)
startBackgroundScanner();
initializeStoreFromCache();

export function getBackgroundResults(): { results: TrackerResult[]; lastRun: number } {
  return { results: globalStore.results, lastRun: globalStore.lastRun };
}
