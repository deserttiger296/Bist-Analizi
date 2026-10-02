// src/lib/rsiPu30Engine.ts
// Client for the RSI PU30 bullish-divergence engine (python_bot/engine/signals/rsi_pu30.py).
// Deliberately its own file, not folded into sniperEngine.ts -- this is a
// separate rule-based engine with no ML and no shared state with the sniper
// pipeline, and the client code mirrors that separation.

const DEFAULT_BASE_URL = "http://127.0.0.1:8001";
const DEFAULT_TIMEOUT_MS = 10000;

function getBaseUrl(): string {
  return process.env.SNIPER_ENGINE_URL || DEFAULT_BASE_URL;
}

async function fetchJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const url = new URL(path, getBaseUrl());
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[rsiPu30Engine] ${path} returned ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? "timed out" : (err?.message || String(err));
    console.warn(`[rsiPu30Engine] ${path} unreachable (${getBaseUrl()}): ${reason}. Is main_api:app running on port 8001?`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface DipPoint {
  index: number;
  price: number;
  rsi: number;
  date: string; // YYYY-MM-DD
}

export interface Pu30Signal {
  symbol: string;
  dip1: DipPoint;
  dip2: DipPoint;
  bounce_pct: number;
  bars_since_confirm: number;
  last_close: number;
}

export interface Pu30ScanResult {
  signals: Pu30Signal[];
  errors: { symbol: string; error: string }[];
  scanned: number;
  matched: number;
}

export async function getRsiPu30Scan(): Promise<Pu30ScanResult | null> {
  const result = await fetchJson<{ status: string; data: Pu30ScanResult }>("/api/scan/rsi-pu30", 120000);
  return result?.data ?? null;
}

export interface Pu30Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  rsi: number | null;
}

export interface Pu30SymbolDetailSignal {
  dip1: DipPoint;
  dip2: DipPoint;
  bounce_pct: number;
  bars_since_confirm: number;
  is_active: boolean;
}

export interface Pu30SymbolDetail {
  symbol: string;
  bars: Pu30Bar[];
  signal: Pu30SymbolDetailSignal | null;
}

export async function getRsiPu30SymbolDetail(symbol: string): Promise<Pu30SymbolDetail | null> {
  const result = await fetchJson<{ status: string; data: Pu30SymbolDetail }>(`/api/scan/rsi-pu30/${encodeURIComponent(symbol)}`);
  return result?.data ?? null;
}

export interface MostRsiSignal {
  symbol: string;
  signal_date: string;
  signal_time: number;
  signal_price: number;
  last_close: number;
  bars_since_signal: number;
  rsi: number;
  exmov: number;
  most: number;
  current_rsi: number;
  current_exmov: number;
  current_most: number;
  current_trend: "BULL" | "BEAR";
}

export interface MostRsiScanResult {
  signals: MostRsiSignal[];
  errors: { symbol: string; error: string }[];
  scanned: number;
  matched: number;
  interval: string;
  engine: string;
}

export interface MostRsiBar {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  rsi: number | null;
  exmov: number | null;
  most: number | null;
  trend: number;
  bull: boolean;
  bear: boolean;
}

export interface MostRsiDetail {
  symbol: string;
  interval: string;
  bars: MostRsiBar[];
  last_bull: {
    index: number;
    date: string;
    time: number;
    price: number;
    bars_ago: number;
    rsi: number;
    exmov: number;
    most: number;
  } | null;
  engine: string;
}

export async function getMostRsiScan(interval = "1h"): Promise<MostRsiScanResult | null> {
  const result = await fetchJson<{ status: string; data: MostRsiScanResult }>(`/api/scan/most-rsi?interval=${interval}`, 120000);
  return result?.data ?? null;
}

export async function getMostRsiSymbolDetail(symbol: string, interval = "1h"): Promise<MostRsiDetail | null> {
  const result = await fetchJson<{ status: string; data: MostRsiDetail }>(`/api/scan/most-rsi/${encodeURIComponent(symbol)}?interval=${interval}`);
  return result?.data ?? null;
}

