import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail, verifySession } from "@/lib/auth";
import { readTelemetryErrors, recordTelemetryError } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

function isAuthorizedWatchdogRequest(req: NextRequest): boolean {
  // 1. Valid Watchdog Token header
  const expectedToken = (process.env.WATCHDOG_TOKEN || "").trim();
  const providedToken = (req.headers.get("x-watchdog-token") || "").trim();
  if (expectedToken && providedToken) {
    const a = Buffer.from(expectedToken, "utf8");
    const b = Buffer.from(providedToken, "utf8");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }

  // 2. Authenticated ADMIN user session cookie
  const sessionCookie = req.cookies.get("bist_session")?.value;
  const sessionUser = sessionCookie ? verifySession(sessionCookie) : null;
  if (sessionUser && isAdminEmail(sessionUser.email)) {
    return true;
  }

  // 3. Direct local loopback development request (never allow bypass on Vercel)
  if (!process.env.VERCEL && process.env.NODE_ENV !== "production") {
    const host = (req.headers.get("host") || req.nextUrl.hostname || "").toLowerCase();
    const xff = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const isLocalHost =
      host === "localhost" ||
      host.startsWith("localhost:") ||
      host === "127.0.0.1" ||
      host.startsWith("127.0.0.1:") ||
      host.startsWith("[::1]");
    const isLocalIp = !xff || xff === "127.0.0.1" || xff === "::1" || xff === "::ffff:127.0.0.1";
    if (isLocalHost && isLocalIp) {
      return true;
    }
  }

  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedWatchdogRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") || "50");
  const errors = readTelemetryErrors(Number.isFinite(limitParam) ? limitParam : 50);
  return NextResponse.json({ ok: true, count: errors.length, errors });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const errorRecord = recordTelemetryError({
      url: typeof body.url === "string" ? body.url : req.headers.get("referer") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      message: String(body.message || "Unknown error"),
      source: typeof body.source === "string" ? body.source : "client",
      stack: body.stack ? String(body.stack) : null,
      context:
        body.context && typeof body.context === "object" && !Array.isArray(body.context)
          ? (body.context as Record<string, unknown>)
          : {},
    });

    return NextResponse.json({ ok: true, id: errorRecord.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to log";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
