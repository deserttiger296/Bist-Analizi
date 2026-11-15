import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const response = NextResponse.redirect(`${origin}/index.html?logged_out=1`);
  response.cookies.delete("bist_session");
  return response;
}
