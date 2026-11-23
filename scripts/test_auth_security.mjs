import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifySessionEdge, isEmailBannedByEnv, getEdgeAuthSecret } from "../src/lib/authEdge.ts";

function makeJwt(payload, secret, alg = "HS256") {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

test("verifySessionEdge accepts a valid HS256 token and rejects tampered/forged/expired tokens", async () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevBanned = process.env.BANNED_EMAILS;
  process.env.AUTH_SECRET = "test_super_secret_key_for_unit_tests_2026";
  delete process.env.BANNED_EMAILS;

  try {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt(
      { id: "google-sub-123", email: "User@Example.COM", name: "Test User", exp },
      process.env.AUTH_SECRET
    );

    const verified = await verifySessionEdge(validToken);
    assert.ok(verified, "valid HS256 token must verify");
    assert.equal(verified.email, "user@example.com");
    assert.equal(verified.id, "google-sub-123");

    // 1. Forged signature (exact bypass that used to work before our fix!)
    const parts = validToken.split(".");
    const forgedToken = `${parts[0]}.${parts[1]}.fake_signature_bypass`;
    assert.equal(await verifySessionEdge(forgedToken), null, "forged signature must be rejected");

    // 2. Wrong secret
    const wrongSecretToken = makeJwt(
      { id: "google-sub-123", email: "user@example.com", name: "Test User", exp },
      "attacker_wrong_secret_key_1234567890"
    );
    assert.equal(await verifySessionEdge(wrongSecretToken), null, "wrong secret must be rejected");

    // 3. alg: none downgrade attack
    const noneAlgToken = makeJwt(
      { id: "google-sub-123", email: "user@example.com", name: "Test User", exp },
      process.env.AUTH_SECRET,
      "none"
    );
    assert.equal(await verifySessionEdge(noneAlgToken), null, "alg:none must be rejected");

    // 4. Expired token
    const expiredToken = makeJwt(
      { id: "google-sub-123", email: "user@example.com", name: "Test User", exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.AUTH_SECRET
    );
    assert.equal(await verifySessionEdge(expiredToken), null, "expired token must be rejected");

    // 5. Env-level BANNED_EMAILS immediately invalidates even a validly signed token
    process.env.BANNED_EMAILS = "blocked@test.com, user@example.com";
    assert.equal(isEmailBannedByEnv("USER@example.com"), true);
    assert.equal(await verifySessionEdge(validToken), null, "banned email must be rejected at edge");
  } finally {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
    if (prevBanned === undefined) delete process.env.BANNED_EMAILS;
    else process.env.BANNED_EMAILS = prevBanned;
  }
});

test("getEdgeAuthSecret fails closed in production when AUTH_SECRET is unset or too short", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevVercel = process.env.VERCEL;
  try {
    process.env.VERCEL = "1";
    delete process.env.AUTH_SECRET;
    assert.equal(getEdgeAuthSecret(), null, "must fail closed in prod when AUTH_SECRET missing");

    process.env.AUTH_SECRET = "short";
    assert.equal(getEdgeAuthSecret(), null, "must fail closed in prod when AUTH_SECRET < 16 chars");

    process.env.AUTH_SECRET = "valid_production_secret_32_bytes_long";
    assert.equal(getEdgeAuthSecret(), "valid_production_secret_32_bytes_long");
  } finally {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }
});

test("middleware and callback enforce cryptographic auth, OAuth state, ban check, and login logging", () => {
  const middlewareSrc = fs.readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8");
  assert.match(middlewareSrc, /verifySessionEdge/, "middleware must use Web Crypto verification");
  assert.match(middlewareSrc, /status:\s*401/, "middleware must protect /api routes with 401");
  assert.doesNotMatch(middlewareSrc, /atob\(/, "middleware must not rely on unsigned atob decoding");

  const callbackSrc = fs.readFileSync(path.join(process.cwd(), "src/app/auth/callback/route.ts"), "utf8");
  assert.match(callbackSrc, /if \(!hmacValid \|\| !cookieMatches\)/, "callback must enforce OAuth state");
  assert.match(callbackSrc, /isUserBanned/, "callback must check ban status");
  assert.match(callbackSrc, /recordLoginEvent/, "callback must log Google logins");
});
