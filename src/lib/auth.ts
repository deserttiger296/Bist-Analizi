import crypto from "crypto";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  given_name?: string;
}

const SECRET = process.env.AUTH_SECRET || "bist_default_session_secret_change_in_prod_2026";

export function signSession(user: AuthUser, expiresInSec = 30 * 24 * 60 * 60): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const payload = Buffer.from(JSON.stringify({ ...user, exp })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifySession(token?: string | null): AuthUser | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const expectedSig = crypto
      .createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    if (signature.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
      given_name: data.given_name,
    };
  } catch {
    return null;
  }
}
