import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rawHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  const host = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();
  let origin = req.nextUrl.origin || "http://localhost:3000";
  if (host === "localhost" || host === "127.0.0.1") {
    origin = "http://localhost:3000";
  } else if (host.endsWith(".vercel.app")) {
    origin = "https://bist-analizi-forfuck-s-sake.vercel.app";
  }
  const response = NextResponse.redirect(`${origin}/login?logged_out=1`);
  response.cookies.delete("bist_session");
  return response;
}
