import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

function resolveOrigin(req: NextRequest): string {
  const rawHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  const host = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:3000";
  }
  if (host.endsWith(".vercel.app")) {
    return "https://bist-analizi-forfuck-s-sake.vercel.app";
  }
  return req.nextUrl.origin || "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const origin = resolveOrigin(req);
  const response = NextResponse.redirect(`${origin}/login?logged_out=1`);
  clearSessionCookie(response);
  return response;
}

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
