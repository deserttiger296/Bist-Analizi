export interface EdgeSessionPayload {
  id: string;
  email: string;
  name: string;
  picture?: string;
  given_name?: string;
  exp: number;
}

const DEV_FALLBACK_SECRET = "bist_dev_only_session_secret_do_not_use_in_prod";

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function getEdgeAuthSecret(): string | null {
  const configured = (process.env.AUTH_SECRET || "").trim();
  if (configured.length >= 16) {
    return configured;
  }
  if (isProductionEnv()) {
    return null;
  }
  return configured || DEV_FALLBACK_SECRET;
}

export function parseEmailList(raw?: string | null): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(/[,;\s]+/)) {
    const cleaned = part.trim().toLowerCase();
    if (cleaned) out.add(cleaned);
  }
  return out;
}

export function isEmailBannedByEnv(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parseEmailList(process.env.BANNED_EMAILS).has(normalized);
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlUtf8(input: string): string {
  const bytes = base64UrlToUint8Array(input);
  return new TextDecoder().decode(bytes);
}

/**
 * Cryptographically verifies the HS256 JWT session cookie using Web Crypto API (Edge-safe).
 * Returns the decoded payload only if the HMAC-SHA256 signature is valid, unexpired,
 * and not listed in BANNED_EMAILS.
 */
export async function verifySessionEdge(
  token?: string | null
): Promise<EdgeSessionPayload | null> {
  if (!token) return null;
  const secret = getEdgeAuthSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const header = JSON.parse(decodeBase64UrlUtf8(headerB64)) as { alg?: string; typ?: string };
    if (header.alg !== "HS256") return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signingInput = encoder.encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64UrlToUint8Array(signatureB64);
    const sigBuf = sigBytes.buffer.slice(
      sigBytes.byteOffset,
      sigBytes.byteOffset + sigBytes.byteLength
    ) as ArrayBuffer;
    const valid = await crypto.subtle.verify("HMAC", key, sigBuf, signingInput);
    if (!valid) return null;

    const data = JSON.parse(decodeBase64UrlUtf8(payloadB64)) as Partial<EdgeSessionPayload>;
    if (!data || typeof data.exp !== "number" || !Number.isFinite(data.exp)) {
      return null;
    }
    if (data.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (typeof data.email !== "string" || !data.email.trim() || typeof data.id !== "string") {
      return null;
    }
    if (isEmailBannedByEnv(data.email)) {
      return null;
    }

    return {
      id: data.id,
      email: data.email.trim().toLowerCase(),
      name: typeof data.name === "string" ? data.name : "Kullanıcı",
      picture: typeof data.picture === "string" ? data.picture : undefined,
      given_name: typeof data.given_name === "string" ? data.given_name : undefined,
      exp: data.exp,
    };
  } catch {
    return null;
  }
}
