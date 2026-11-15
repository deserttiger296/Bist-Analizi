import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public routes, auth flows, health check and static assets
  if (
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
    return NextResponse.next();
  }

  // 2. Allow API routes so internal client fetches return JSON rather than redirecting
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("bist_session")?.value;

  // 3. Quick check for session cookie
  let hasValidSession = false;
  if (sessionCookie) {
    const parts = sessionCookie.split(".");
    if (parts.length === 3) {
      try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const json = atob(base64);
        const payload = JSON.parse(json);
        if (payload.exp && payload.exp > Math.floor(Date.now() / 1000)) {
          hasValidSession = true;
        }
      } catch {
        hasValidSession = false;
      }
    }
  }

  // 4. Redirect unauthenticated users to /login
  if (!hasValidSession) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/" && pathname !== "/index.html") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|static).*)",
  ],
};
