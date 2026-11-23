import crypto from "crypto";
import type { NextResponse } from "next/server";
import { isProductionEnv, parseEmailList } from "@/lib/authEdge";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  given_name?: string;
}

const DEV_FALLBACK_SECRET = "bist_dev_only_session_secret_do_not_use_in_prod";

function getAuthSecret(): string | null {
  const configured = (process.env.AUTH_SECRET || "").trim();
  if (configured.length >= 16) {
    return configured;
  }
  if (isProductionEnv()) {
    console.error("[auth] CRITICAL: AUTH_SECRET is missing or shorter than 16 chars in production.");
    return null;
  }
  return configured || DEV_FALLBACK_SECRET;
}

export function normalizeEmail(email?: string | null): string {
  return String(email || "").trim().toLowerCase();
}

export function getAdminEmails(): Set<string> {
  return parseEmailList(process.env.ADMIN_EMAILS);
}

export function isAdminEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return getAdminEmails().has(normalized);
}

export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip") || headers.get("cf-connecting-ip");
  if (realIp) {
    return realIp.trim().slice(0, 64);
  }
  return "unknown";
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set("bist_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function signOAuthState(): string {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(12).toString("hex");
  const raw = `${ts}.${nonce}`;
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return `${raw}.${sig}`;
}

export function verifyOAuthState(state?: string | null): boolean {
  const secret = getAuthSecret();
  if (!secret || !state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const ageMs = Date.now() - Number(ts);
  if (!Number.isFinite(ageMs) || ageMs < -60000 || ageMs > 30 * 60 * 1000) {
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(`${ts}.${nonce}`).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function signSession(user: AuthUser, expiresInSec = 30 * 24 * 60 * 60): string {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  const normalizedUser: AuthUser = {
    ...user,
    email: normalizeEmail(user.email),
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...normalizedUser, iat, exp })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifySession(token?: string | null): AuthUser | null {
  const secret = getAuthSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf-8")) as {
      alg?: string;
    };
    if (parsedHeader.alg !== "HS256") return null;

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest("base64url");
    if (signature.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (typeof data.exp !== "number" || !Number.isFinite(data.exp)) {
      return null;
    }
    if (data.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    const email = normalizeEmail(data.email);
    if (!email || typeof data.id !== "string") {
      return null;
    }
    return {
      id: data.id,
      email,
      name: typeof data.name === "string" ? data.name : "Kullanıcı",
      picture: typeof data.picture === "string" ? data.picture : undefined,
      given_name: typeof data.given_name === "string" ? data.given_name : undefined,
    };
  } catch {
    return null;
  }
}
