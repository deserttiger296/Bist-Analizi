import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  let origin = req.nextUrl.origin || "http://localhost:3000";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    origin = "http://localhost:3000";
  } else if (host.includes("forfuck-s-sake.vercel.app")) {
    origin = "https://bist-analizi-forfuck-s-sake.vercel.app";
  }
  const response = NextResponse.redirect(`${origin}/login?logged_out=1`);
  response.cookies.delete("bist_session");
  return response;
}
