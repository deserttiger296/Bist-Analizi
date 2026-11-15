import { NextRequest, NextResponse } from "next/server";
import { signOAuthState } from "@/lib/auth";

export const dynamic = "force-dynamic";

function getOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return "http://localhost:3000";
  }
  if (host.includes("forfuck-s-sake.vercel.app")) {
    return "https://bist-analizi-forfuck-s-sake.vercel.app";
  }
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) {
    return `${proto}://${host}`;
  }
  return "https://bist-analizi-forfuck-s-sake.vercel.app";
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID ortam değişkeni tanımlanmamış." },
      { status: 500 }
    );
  }

  const origin = getOrigin(req);
  const redirectUri = `${origin}/auth/callback`;
  const state = signOAuthState();

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("state", state);
  googleAuthUrl.searchParams.set("access_type", "online");
  googleAuthUrl.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(googleAuthUrl.toString());
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return res;
}
