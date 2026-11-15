import fs from "fs";
import os from "os";
import path from "path";

export interface TelemetryErrorInput {
  message: string;
  source?: string;
  url?: string;
  userAgent?: string;
  stack?: string | null;
  context?: Record<string, unknown>;
}

export interface TelemetryErrorRecord {
  id: string;
  timestamp: string;
  url: string;
  userAgent: string;
  message: string;
  source: string;
  stack: string | null;
  context: Record<string, unknown>;
}

const MAX_MEMORY_ERRORS = 100;
const SENSITIVE_KEY_RE =
  /^(password|pass|secret|client_secret|token|access_token|refresh_token|id_token|api_?key|authorization|cookie|set-cookie|code|state)$/i;

const globalTelemetry = globalThis as unknown as {
  __bistTelemetryErrors?: TelemetryErrorRecord[];
};

function getMemoryBuffer(): TelemetryErrorRecord[] {
  if (!globalTelemetry.__bistTelemetryErrors) {
    globalTelemetry.__bistTelemetryErrors = [];
  }
  return globalTelemetry.__bistTelemetryErrors;
}

/**
 * Masks tokens, OAuth codes, passwords, secrets, and bearer headers from telemetry strings.
 */
export function sanitizeTelemetryText(input: string, maxLength = 2000): string {
  let text = String(input ?? "");
  // Mask Bearer / Basic authorization headers
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [MASKED]");
  // Mask query/form parameters like code=..., token=..., client_secret=..., password=...
  text = text.replace(
    /([?&\s"'(]|^)(code|access_token|refresh_token|id_token|token|client_secret|password|secret|api_?key)=([^&\s"',)}\]]+)/gi,
    "$1$2=[MASKED]"
  );
  // Mask JSON-style secret fields
  text = text.replace(
    /("(?:password|client_secret|access_token|refresh_token|id_token|token|secret|api_?key|authorization)"\s*:\s*)"([^"]+)"/gi,
    '$1"[MASKED]"'
  );
  // Mask URL user:pass@ credentials
  text = text.replace(/(https?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, "$1$2:[MASKED]@");

  if (maxLength > 0 && text.length > maxLength) {
    return text.slice(0, maxLength);
  }
  return text;
}

function sanitizeContextValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeTelemetryText(value, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeContextValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[MASKED]" : sanitizeContextValue(v, depth + 1);
    }
    return out;
  }
  return sanitizeTelemetryText(String(value), 200);
}

function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }
  return sanitizeContextValue(context, 0) as Record<string, unknown>;
}

function getCandidateLogFiles(): string[] {
  const primary = path.join(process.cwd(), ".cache", "runtime_errors.jsonl");
  const fallback = path.join(os.tmpdir(), "runtime_errors.jsonl");
  return primary === fallback ? [primary] : [primary, fallback];
}

function appendToWritableLog(record: TelemetryErrorRecord): void {
  const line = JSON.stringify(record) + "\n";
  for (const logFile of getCandidateLogFiles()) {
    try {
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(logFile, line, "utf8");
      return;
    } catch {
      // Try next writable location (e.g. /tmp on serverless read-only cwd)
    }
  }
}

/**
 * Sanitizes, logs, buffers in memory, and appends an application/telemetry error to disk.
 */
export function recordTelemetryError(input: TelemetryErrorInput): TelemetryErrorRecord {
  const record: TelemetryErrorRecord = {
    id: "err_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    url: sanitizeTelemetryText(input.url || "unknown", 500),
    userAgent: sanitizeTelemetryText(input.userAgent || "unknown", 300),
    message: sanitizeTelemetryText(input.message || "Unknown error", 1000),
    source: sanitizeTelemetryText(input.source || "client", 100),
    stack: input.stack ? sanitizeTelemetryText(input.stack, 1500) : null,
    context: sanitizeContext(input.context),
  };

  const mem = getMemoryBuffer();
  mem.push(record);
  if (mem.length > MAX_MEMORY_ERRORS) {
    mem.splice(0, mem.length - MAX_MEMORY_ERRORS);
  }

  console.error("[TELEMETRY ERROR CAUGHT]", JSON.stringify(record));
  appendToWritableLog(record);

  return record;
}

/**
 * Reads recent telemetry error records from disk logs and the in-memory ring buffer.
 */
export function readTelemetryErrors(limit = 50): TelemetryErrorRecord[] {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  const byId = new Map<string, TelemetryErrorRecord>();

  for (const logFile of getCandidateLogFiles()) {
    try {
      if (!fs.existsSync(logFile)) continue;
      const raw = fs.readFileSync(logFile, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-safeLimit * 2);
      for (const line of tail) {
        try {
          const parsed = JSON.parse(line) as TelemetryErrorRecord;
          if (parsed && parsed.id) {
            byId.set(parsed.id, parsed);
          }
        } catch {
          // Skip malformed JSONL line
        }
      }
    } catch {
      // Ignore unreadable candidate file
    }
  }

  for (const item of getMemoryBuffer()) {
    byId.set(item.id, item);
  }

  return Array.from(byId.values())
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, safeLimit);
}
