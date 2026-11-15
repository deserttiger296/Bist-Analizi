import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const errorRecord = {
      id: "err_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      url: body.url || req.headers.get("referer") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      message: String(body.message || "Unknown error"),
      source: body.source || "client",
      stack: body.stack ? String(body.stack).slice(0, 1500) : null,
      context: body.context || {},
    };

    console.error("[TELEMETRY ERROR CAUGHT]", JSON.stringify(errorRecord));

    // Persist to .cache if writable
    try {
      const cacheDir = path.join(process.cwd(), ".cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const logFile = path.join(cacheDir, "runtime_errors.jsonl");
      fs.appendFileSync(logFile, JSON.stringify(errorRecord) + "\n", "utf8");
    } catch {
      // Serverless / read-only filesystem guard
    }

    return NextResponse.json({ ok: true, id: errorRecord.id });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Failed to log" }, { status: 500 });
  }
}
