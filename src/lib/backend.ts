/** Shared server-only transport. Never substitute generated market data. */
function resolveBackendUrl(): string {
  const explicit = process.env.SNIPER_ENGINE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // On Vercel the lightweight Python engine (api/index.py) is served under
  // /api/py of the production domain -- no extra service or env var needed.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (host) return `https://${host}/api/py`;
  return "http://127.0.0.1:8001";
}

export const BACKEND_URL = resolveBackendUrl();

export async function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280000);
  try {
    const response = await fetch(`${BACKEND_URL}${path}`, { ...init, cache: "no-store", signal: controller.signal });
    const text = await response.text();
    try {
      return Response.json(JSON.parse(text), { status: response.status });
    } catch {
      // e.g. a platform FUNCTION_INVOCATION_TIMEOUT page: the engine was reached but failed.
      const timedOut = /TIMEOUT/i.test(text);
      return Response.json({ status: timedOut ? "timeout" : "backend_error", mode: "real", data: null, scanned: 0, detail: `${timedOut ? "Tarama motoru süre sınırını aştı" : "Tarama motoru hata döndürdü"} (HTTP ${response.status}): ${text.trim().split("\n")[0].slice(0, 120)}`, calculated_at: new Date().toISOString() }, { status: response.ok ? 502 : response.status });
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return Response.json({ status: timedOut ? "timeout" : "backend_unavailable", mode: "real", data: null, scanned: 0, detail: timedOut ? "Backend zaman aşımı" : "Backend erişilemiyor; tarama yapılmadı", calculated_at: new Date().toISOString() }, { status: timedOut ? 504 : 503 });
  } finally { clearTimeout(timeout); }
}
