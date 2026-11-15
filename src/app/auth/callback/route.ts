import { NextRequest, NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function getOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return "http://localhost:3000";
  }
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) {
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "https://bist-analizi.vercel.app";
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

  const savedState = req.cookies.get("oauth_state")?.value;
  if (!savedState || savedState !== state) {
    // State mismatch / CSRF guard (if state cookie expired, continue if code exists in dev)
    if (process.env.NODE_ENV === "production") {
      return NextResponse.redirect(`${origin}/login?auth_error=state_mismatch`);
    }
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
      return NextResponse.redirect(`${origin}/login?auth_error=token_exchange_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. Google Profil Bilgilerini Al
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error("[OAuth] Userinfo failed:", await userRes.text());
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
    return NextResponse.redirect(`${origin}/login?auth_error=internal_error`);
  }
}
