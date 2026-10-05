// src/lib/sniperEngine.ts
// Thin fetch wrapper around python_bot's main_api.py sniper engine (RF + LSTM
// + FinBERT sentiment confluence, SHAP explainability, meta-learning
// calibration). Runs separately via uvicorn on SNIPER_ENGINE_URL
// (main_api:app, port 8001 by default -- see start_all.ps1).
//
// This is the PRIMARY prediction engine for the app. Like pythonEngine.ts,
// every function here fails soft (logs a warning, resolves to null) so a
// down/unstarted engine degrades the UI instead of crashing it.
import { BACKEND_URL } from "./backend";

// 127.0.0.1, not "localhost" -- uvicorn is started with --host 127.0.0.1,
// and Node's fetch on Windows can resolve "localhost" to the IPv6 ::1
// first, which nothing is listening on, causing a fast "fetch failed"
// instead of falling back to IPv4.
const DEFAULT_TIMEOUT_MS = 10000;

function getBaseUrl(): string {
  return BACKEND_URL;
}

async function fetchJson<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  // Plain concatenation: new URL(path, base) would drop a base path such as /api/py.
  const url = `${getBaseUrl()}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[sniperEngine] ${path} returned ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    return (await res.json()) as T;
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? "timed out" : (err?.message || String(err));
    console.warn(`[sniperEngine] ${path} unreachable (${getBaseUrl()}): ${reason}. Is the signal engine reachable?`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ShapAttribution {
  feature: string;
  label_tr: string;
  description_tr: string;
  shap_value: number;
  abs_importance: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface SentimentResult {
  sentiment_score: number;
  sentiment_label: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  news_count: number;
  engine: string;
  headlines_analyzed?: string[];
}

export interface SniperPrediction {
  symbol: string;
  as_of: string;
  predicted_label: "UP" | "DOWN" | "FLAT";
  probability: number;
  model_version: string;
  regime_confidence: number;
  current_price: number;
  class_probabilities: Record<string, number>;
  features: Record<string, number>;

  sniper_label: string;
  sniper_approved: boolean;
  sniper_threshold: number;
  meta_weights: Record<string, any>;

  shap_attributions?: ShapAttribution[];
  shap_base_value?: number;
  shap_engine?: string;

  explanation: string[];

  lstm_probability?: number;
  quantum_approved: boolean;

  sentiment?: SentimentResult;
  sentiment_approved: boolean;

  confluence_level: number;
  confluence_label: string;

  target_price_tl?: number;
  target_price_usd?: number;
  usd_rate?: number;
  potential_roi?: number;
}

/**
 * Runs the sniper engine's full RF + LSTM + sentiment confluence prediction
 * for a single symbol. Returns null if the engine is unreachable, the model
 * isn't trained yet, or the request fails -- callers should treat this as
 * "sniper prediction unavailable", not a hard error.
 */
export async function getSniperPrediction(symbol: string): Promise<SniperPrediction | null> {
  // main_api.py wraps every response as {status, data: <payload>} -- unwrap
  // it here, same as getSniperSentiment/getSniperMetaWeights below.
  const result = await fetchJson<{ status: string; data: SniperPrediction }>("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  }, 20000); // RF + LSTM + sentiment + SHAP in one call can be slower than a simple GET
  return result?.data ?? null;
}

export interface SniperScanResult {
  status: string;
  count: number;
  data: SniperPrediction[];
}

/**
 * Runs the sniper engine across the full BIST100 universe, returning only
 * symbols that cleared the sniper's approval threshold. This is a heavier
 * call (up to ~100 symbols, parallelized server-side) -- give it a longer
 * timeout than a single-symbol prediction.
 */
export async function getSniperScanAll(): Promise<SniperScanResult | null> {
  return fetchJson<SniperScanResult>("/api/scan_all", {}, 120000);
}

export async function getSniperSentiment(symbol: string): Promise<SentimentResult | null> {
  const result = await fetchJson<{ status: string; symbol: string; data: SentimentResult }>(`/api/sentiment/${symbol}`);
  return result?.data ?? null;
}

export interface MetaWeights {
  rf_threshold: number;
  lstm_threshold: number;
  sentiment_threshold: number;
  rf_hit_rate: number;
  lstm_hit_rate: number;
  last_calibrated: string | null;
  total_signals_evaluated: number;
}

export async function getSniperMetaWeights(): Promise<MetaWeights | null> {
  const result = await fetchJson<{ status: string; data: MetaWeights }>("/api/meta/weights");
  return result?.data ?? null;
}

export interface DailyHistoryRow {
  date: string;
  symbol: string;
  predicted_label: "UP" | "DOWN" | "FLAT";
  probability: string;
  current_price: string;
  sniper_approved: "True" | "False";
  confluence_level: string;
  resolve_after_days: string;
  resolved: "True" | "False";
  actual_price: string;
  actual_return_pct: string;
  was_correct: "True" | "False" | "";
}

export interface DailyHistory {
  rows: DailyHistoryRow[];
  total_rows: number;
  resolved_rows: number;
  pending_rows: number;
  overall_accuracy_pct: number | null;
  approved_only_accuracy_pct: number | null;
  approved_only_count: number;
}

/**
 * Daily scan history logged by run_daily_scan.py -- every symbol predicted
 * each day, with actual outcomes filled in once old enough to resolve.
 * Calling this also triggers resolution of any newly-eligible pending rows
 * server-side, so the page stays current between scheduled scan runs.
 */
export async function getSniperHistory(days?: number): Promise<DailyHistory | null> {
  const result = await fetchJson<{ status: string; data: DailyHistory }>(
    days ? `/api/history?days=${days}` : "/api/history",
    {},
    30000
  );
  return result?.data ?? null;
}
