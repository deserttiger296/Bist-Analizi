import type { BistLiveQuote } from "./bist";

/**
 * Type guard for BistLiveQuote.
 * Validates the minimum required fields to ensure the object is safe to use.
 */
export function isBistLiveQuote(obj: unknown): obj is BistLiveQuote {
  if (!obj || typeof obj !== "object") return false;
  const q = obj as Record<string, unknown>;
  return (
    typeof q.ticker === "string" &&
    typeof q.lastClose === "number" &&
    typeof q.score === "number" &&
    typeof q.rsi === "number" &&
    typeof q.ema5 === "number" &&
    typeof q.ema20 === "number" &&
    Array.isArray(q.timeframes)
  );
}

// ─── Number Formatting ───────────────────────────────────────────────────────

/**
 * Format a number using Turkish locale (1.234,56)
 */
export function formatTR(value: number | null | undefined, digits = 2): string {
  if (value == null || isNaN(value)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Format as Turkish Lira currency
 */
export function formatTRY(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(value);
}

/**
 * Format a percentage value
 */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || isNaN(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatTR(value, digits)}%`;
}

/**
 * Format large numbers in compact form (1.2M, 3.4B etc.)
 */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Format a date string to Turkish locale
 */
export function formatDateTR(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
