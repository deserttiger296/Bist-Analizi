// src/lib/pythonEngine.ts
// Thin fetch wrapper around python_bot's FastAPI quant service
// (bist-analyst-app/python_bot, run separately via uvicorn on PYTHON_ENGINE_URL).
//
// The service is optional infrastructure: if it isn't running (e.g. local dev
// without the Python venv started, or a deploy target that doesn't run it),
// every function here fails soft — logs a warning and resolves to null so
// callers can treat the enrichment as best-effort rather than crashing.

const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = 8000;

function getBaseUrl(): string {
  return process.env.PYTHON_ENGINE_URL || DEFAULT_BASE_URL;
}

async function fetchJson<T>(path: string, params: Record<string, string | number | undefined>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const url = new URL(path, getBaseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[pythonEngine] ${path} returned ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    return (await res.json()) as T;
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? "timed out" : (err?.message || String(err));
    console.warn(`[pythonEngine] ${path} unreachable (${getBaseUrl()}): ${reason}. Is python_bot's uvicorn server running?`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── /api/cointegration ────────────────────────────────────────────────────
// Engle-Granger + Johansen stat-arb pair test, real statsmodels implementation.

export interface EngleGrangerResult {
  method: "engle_granger";
  hedge_ratio_beta: number;
  intercept_alpha: number;
  p_value: number;
  t_stat: number;
  critical_value_5pct: number;
  is_cointegrated: boolean;
}

export interface JohansenResult {
  method: "johansen";
  trace_statistics: number[];
  critical_values_95pct: number[];
  cointegration_rank: number;
  is_cointegrated: boolean;
  hedge_ratio_from_eigenvector: number | null;
}

export interface CointegrationResult {
  asset_a: string;
  asset_b: string;
  observations: number;
  engle_granger: EngleGrangerResult;
  johansen: JohansenResult;
  consensus_cointegrated: boolean;
}

/**
 * Runs the python_bot cointegration screen for a BIST pair (e.g. GARAN/AKBNK).
 * Returns null if the python engine is unreachable or the request fails —
 * callers should treat this as "cointegration data unavailable", not an error.
 */
export async function getCointegration(
  assetA: string,
  assetB: string,
  period: string = "2y"
): Promise<CointegrationResult | null> {
  return fetchJson<CointegrationResult>("/api/cointegration", { asset_a: assetA, asset_b: assetB, period });
}
