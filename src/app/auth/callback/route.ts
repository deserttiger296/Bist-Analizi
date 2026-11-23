import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getClientIp,
  normalizeEmail,
  signSession,
  verifyOAuthState,
} from "@/lib/auth";
import { isUserBanned, recordLoginEvent } from "@/lib/authAudit";
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
  const ipAddress = getClientIp(req.headers);
  const userAgent = req.headers.get("user-agent") || "unknown";

  if (error) {
    return NextResponse.redirect(`${origin}/login?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?auth_error=missing_code`);
  }

  // Enforce cryptographic HMAC state verification (works statelessly even when
  // mobile Safari / in-app WebViews drop the oauth_state cookie) to prevent Login CSRF.
  const savedState = req.cookies.get("oauth_state")?.value;
  const hmacValid = verifyOAuthState(state);
  const cookieMatches = !savedState || savedState === state;
  if (!hmacValid || !cookieMatches) {
    console.warn("[OAuth callback] Rejected invalid OAuth state", {
      hmacValid,
      hasSavedState: Boolean(savedState),
      ipAddress,
    });
    recordTelemetryError({
      source: "oauth_callback",
      url: req.url,
      userAgent,
      message: "OAuth callback rejected due to invalid CSRF state",
      context: { stage: "state_check", hmacValid, hasSavedState: Boolean(savedState), ipAddress },
    });
    return NextResponse.redirect(`${origin}/login?auth_error=invalid_state`);
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
        userAgent,
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
        userAgent,
        message: `OAuth userinfo failed (HTTP ${userRes.status})`,
        stack: userErrText,
        context: { stage: "userinfo", status: userRes.status },
      });
      return NextResponse.redirect(`${origin}/login?auth_error=userinfo_failed`);
    }

    const profile = await userRes.json();
    const email = normalizeEmail(profile.email);
    const googleSub = typeof profile.sub === "string" ? profile.sub : "";
    const displayName = profile.name || profile.given_name || "Kullanıcı";

    if (!email || !googleSub) {
      return NextResponse.redirect(`${origin}/login?auth_error=userinfo_incomplete`);
    }

    if (profile.email_verified === false) {
      await recordLoginEvent({
        googleSub,
        email,
        name: displayName,
        picture: profile.picture,
        status: "BLOCKED",
        blockReason: "Google e-posta adresi doğrulanmamış",
        ipAddress,
        userAgent,
      });
      return NextResponse.redirect(`${origin}/login?auth_error=unverified_email`);
    }

    // 3. Giriş Yasağı (Ban) Kontrolü
    const banStatus = await isUserBanned(email, googleSub);
    if (banStatus.banned) {
      await recordLoginEvent({
        googleSub,
        email,
        name: displayName,
        picture: profile.picture,
        status: "BLOCKED",
        blockReason: banStatus.reason || "Hesap yasaklı",
        ipAddress,
        userAgent,
      });
      const blockedRes = NextResponse.redirect(`${origin}/login?auth_error=banned`);
      clearSessionCookie(blockedRes);
      blockedRes.cookies.delete("oauth_state");
      return blockedRes;
    }

    const sessionUser = {
      id: googleSub,
      email,
      name: displayName,
      picture: profile.picture,
      given_name: profile.given_name,
    };

    // 4. Başarılı Google Girişini Logla
    await recordLoginEvent({
      googleSub,
      email,
      name: displayName,
      picture: profile.picture,
      status: "ALLOWED",
      ipAddress,
      userAgent,
    });

    // 5. Oturum Çerezini Oluştur (30 gün geçerli)
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
  } catch (err: unknown) {
    console.error("[OAuth] Callback exception:", err);
    const errObj = err as { message?: string; stack?: string } | null;
    recordTelemetryError({
      source: "oauth_callback",
      url: req.url,
      userAgent,
      message: errObj?.message ? `OAuth callback exception: ${errObj.message}` : "OAuth callback exception",
      stack: errObj?.stack || String(err),
      context: { stage: "exception" },
    });
    return NextResponse.redirect(`${origin}/login?auth_error=internal_error`);
  }
}
