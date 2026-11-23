import { NextResponse, type NextRequest } from "next/server";
import { verifySessionEdge } from "@/lib/authEdge";

const CANONICAL_HOST = "bist-analizi-forfuck-s-sake.vercel.app";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const rawHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host ||
    "";
  const reqHost = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();

  if (
    reqHost.endsWith(".vercel.app") &&
    reqHost !== CANONICAL_HOST &&
    !pathname.startsWith("/api/py")
  ) {
    return NextResponse.redirect(`https://${CANONICAL_HOST}${pathname}${search}`, 307);
  }

  // 1. Allow public routes, auth flows, health check and static assets
  if (
    pathname === "/privacy" ||
    pathname.startsWith("/privacy/") ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  ) {
    const res = NextResponse.next();
    if (pathname === "/privacy" || pathname.startsWith("/privacy/")) {
      res.headers.set("X-Robots-Tag", "index, follow");
    }
    return res;
  }

  // Allow telemetry route to apply its own token/admin auth (and accept client error POSTs)
  if (pathname === "/api/telemetry/error") {
    return NextResponse.next();
  }

  // 2. Cryptographically verify HS256 JWT session cookie (Web Crypto API)
  const sessionCookie = request.cookies.get("bist_session")?.value;
  const verifiedUser = await verifySessionEdge(sessionCookie);

  // 3. Protect API routes with JSON 401 instead of HTML redirect
  if (pathname.startsWith("/api")) {
    // Allow cron scan when a valid CRON_SECRET bearer/header token is provided
    if (pathname === "/api/bist/cron/scan") {
      const cronSecret = (process.env.CRON_SECRET || "").trim();
      const authHeader = (request.headers.get("authorization") || "").trim();
      const cronHeader = (request.headers.get("x-cron-secret") || "").trim();
      if (
        cronSecret &&
        (authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret)
      ) {
        return NextResponse.next();
      }
    }

    if (!verifiedUser) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized — geçerli oturum gereklidir." },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // 4. Redirect unauthenticated users to /login for page routes
  if (!verifiedUser) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/" && pathname !== "/index.html") {
      loginUrl.searchParams.set("from", pathname);
    }
    const res = NextResponse.redirect(loginUrl);
    if (sessionCookie) {
      res.cookies.delete("bist_session");
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|static).*)",
  ],
};
