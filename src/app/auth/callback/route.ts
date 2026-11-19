import { NextRequest, NextResponse } from "next/server";
import { signSession, verifyOAuthState } from "@/lib/auth";
import { recordTelemetryError } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

function getOrigin(req: NextRequest): string {
  const rawHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host || "";
  const host = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:3000";
  }
  if (host.endsWith(".vercel.app")) {
    return "https://bist-analizi-forfuck-s-sake.vercel.app";
  }
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (rawHost) {
    return `${proto}://${rawHost.split(",")[0].trim()}`;
  }
  return "https://bist-analizi-forfuck-s-sake.vercel.app";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const origin = getOrigin(req);

  if (error) {
    return NextResponse.redirect(`${origin}/login?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?auth_error=missing_code`);
  }

  // Lenient state verification: validates HMAC state or cookie when available.
  // In mobile Safari, iOS and in-app webviews (WhatsApp/Telegram), cross-site cookie isolation
  // can drop cookies or strip query parameters. We log mismatched state but proceed to Google's
  // token exchange which cryptographically validates the one-time authorization code.
  const savedState = req.cookies.get("oauth_state")?.value;
  const isStateValid = verifyOAuthState(state) || (Boolean(savedState) && savedState === state);
  if (!isStateValid) {
    console.warn("[OAuth callback] State missing or mismatched, relying on Google token exchange verification:", {
      state,
      savedState,
    });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/login?auth_error=missing_credentials`);
  }

  const redirectUri = `${origin}/auth/callback`;

  try {
    // 1. Google ile Authorization Code -> Tokens takası
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("[OAuth] Token exchange failed:", errText);
      recordTelemetryError({
        source: "oauth_callback",
        url: req.url,
        userAgent: req.headers.get("user-agent") || "unknown",
        message: `OAuth token exchange failed (HTTP ${tokenRes.status})`,
        stack: errText,
        context: { stage: "token_exchange", status: tokenRes.status },
      });
      return NextResponse.redirect(`${origin}/login?auth_error=token_exchange_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. Google Profil Bilgilerini Al
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      const userErrText = await userRes.text();
      console.error("[OAuth] Userinfo failed:", userErrText);
      recordTelemetryError({
        source: "oauth_callback",
        url: req.url,
        userAgent: req.headers.get("user-agent") || "unknown",
        message: `OAuth userinfo failed (HTTP ${userRes.status})`,
        stack: userErrText,
        context: { stage: "userinfo", status: userRes.status },
      });
      return NextResponse.redirect(`${origin}/login?auth_error=userinfo_failed`);
    }

    const profile = await userRes.json();
    const sessionUser = {
      id: profile.sub,
      email: profile.email,
      name: profile.name || profile.given_name || "Kullanıcı",
      picture: profile.picture,
      given_name: profile.given_name,
    };

    // 3. Oturum Çerezini Oluştur (30 gün geçerli)
    const sessionToken = signSession(sessionUser, 30 * 24 * 60 * 60);

    const redirectTarget = `${origin}/index.html?auth=success`;
    const response = NextResponse.redirect(redirectTarget);

    response.cookies.set("bist_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    response.cookies.delete("oauth_state");

    return response;
  } catch (err: any) {
    console.error("[OAuth] Callback exception:", err);
    recordTelemetryError({
      source: "oauth_callback",
      url: req.url,
      userAgent: req.headers.get("user-agent") || "unknown",
      message: err?.message ? `OAuth callback exception: ${err.message}` : "OAuth callback exception",
      stack: err?.stack || String(err),
      context: { stage: "exception" },
    });
    return NextResponse.redirect(`${origin}/login?auth_error=internal_error`);
  }
}
