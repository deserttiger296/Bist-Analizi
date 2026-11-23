import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { isPostgresAvailable, query } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth";
import { isEmailBannedByEnv, parseEmailList } from "@/lib/authEdge";

export type LoginEventStatus = "ALLOWED" | "BLOCKED" | "ERROR";

export interface LoginLogInput {
  googleSub?: string | null;
  email: string;
  name?: string | null;
  picture?: string | null;
  status: LoginEventStatus;
  blockReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginLogRecord {
  id: string;
  googleSub: string | null;
  email: string;
  name: string | null;
  picture: string | null;
  status: LoginEventStatus;
  blockReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface BannedUserRecord {
  email: string;
  googleSub: string | null;
  reason: string | null;
  bannedBy: string | null;
  bannedAt: string;
  expiresAt: string | null;
  active: boolean;
  source: "postgres" | "file" | "env";
}

export interface BanCheckResult {
  banned: boolean;
  reason: string | null;
  source: "postgres" | "file" | "env" | null;
  expiresAt: string | null;
}

const MAX_MEMORY_LOGS = 500;

const globalAudit = globalThis as unknown as {
  __bistAuthLogs?: LoginLogRecord[];
  __bistBannedMap?: Map<string, BannedUserRecord>;
  __bistAuthTablesReady?: boolean;
};

function getMemoryLogs(): LoginLogRecord[] {
  if (!globalAudit.__bistAuthLogs) {
    globalAudit.__bistAuthLogs = [];
  }
  return globalAudit.__bistAuthLogs;
}

function getMemoryBans(): Map<string, BannedUserRecord> {
  if (!globalAudit.__bistBannedMap) {
    globalAudit.__bistBannedMap = new Map<string, BannedUserRecord>();
  }
  return globalAudit.__bistBannedMap;
}

function canTryPostgres(): boolean {
  const conn = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  return Boolean(conn) && isPostgresAvailable();
}

async function ensureAuthTables(): Promise<boolean> {
  if (!canTryPostgres()) return false;
  if (globalAudit.__bistAuthTablesReady) return true;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS auth_login_logs (
        id TEXT PRIMARY KEY,
        google_sub TEXT,
        email TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        status TEXT NOT NULL,
        block_reason TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_auth_login_logs_created_at ON auth_login_logs (created_at DESC)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_auth_login_logs_email ON auth_login_logs (email, created_at DESC)`
    );
    await query(`
      CREATE TABLE IF NOT EXISTS banned_users (
        email TEXT PRIMARY KEY,
        google_sub TEXT,
        reason TEXT,
        banned_by TEXT,
        banned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_banned_users_active ON banned_users (active, banned_at DESC)`
    );
    globalAudit.__bistAuthTablesReady = true;
    return true;
  } catch {
    return false;
  }
}

function getCandidateFiles(filename: string): string[] {
  const primary = path.join(process.cwd(), ".cache", filename);
  const fallback = path.join(os.tmpdir(), filename);
  return primary === fallback ? [primary] : [primary, fallback];
}

function appendJsonlFile(filename: string, obj: unknown): void {
  const line = JSON.stringify(obj) + "\n";
  for (const filePath of getCandidateFiles(filename)) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, line, "utf8");
      return;
    } catch {
      // Try fallback location
    }
  }
}

function readJsonFile<T>(filename: string): T | null {
  for (const filePath of getCandidateFiles(filename)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function writeJsonFile(filename: string, data: unknown): boolean {
  const payload = JSON.stringify(data, null, 2);
  for (const filePath of getCandidateFiles(filename)) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, payload, "utf8");
      return true;
    } catch {
      // Try fallback location
    }
  }
  return false;
}

function loadFileBans(): Map<string, BannedUserRecord> {
  const map = new Map<string, BannedUserRecord>(getMemoryBans());
  const parsed = readJsonFile<Record<string, BannedUserRecord>>("banned_users.json");
  if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed)) {
      const email = normalizeEmail(v?.email || k);
      if (email && v) {
        map.set(email, { ...v, email, source: "file" });
      }
    }
  }
  return map;
}

function persistFileBans(map: Map<string, BannedUserRecord>): void {
  const mem = getMemoryBans();
  mem.clear();
  const obj: Record<string, BannedUserRecord> = {};
  for (const [k, v] of map.entries()) {
    if (v.source !== "env") {
      mem.set(k, v);
      obj[k] = v;
    }
  }
  writeJsonFile("banned_users.json", obj);
}

function isBanActive(ban: { active: boolean; expiresAt: string | null }): boolean {
  if (!ban.active) return false;
  if (!ban.expiresAt) return true;
  const expMs = Date.parse(ban.expiresAt);
  if (!Number.isFinite(expMs)) return true;
  return expMs > Date.now();
}

function clampText(val?: string | null, max = 300): string | null {
  if (!val) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function getAuthStorageMode(): Promise<{
  mode: "postgres" | "file_fallback";
  persistent: boolean;
  envBanCount: number;
}> {
  const envBanCount = parseEmailList(process.env.BANNED_EMAILS).size;
  const pgReady = await ensureAuthTables();
  if (pgReady) {
    return { mode: "postgres", persistent: true, envBanCount };
  }
  return {
    mode: "file_fallback",
    persistent: !Boolean(process.env.VERCEL),
    envBanCount,
  };
}

/**
 * Records a Google OAuth login attempt (ALLOWED, BLOCKED, or ERROR) into Postgres
 * when available, and always mirrors into the structured log + local JSONL fallback.
 */
export async function recordLoginEvent(input: LoginLogInput): Promise<LoginLogRecord> {
  const email = normalizeEmail(input.email) || "unknown";
  const record: LoginLogRecord = {
    id: `auth_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    googleSub: clampText(input.googleSub, 128),
    email,
    name: clampText(input.name, 160),
    picture: clampText(input.picture, 500),
    status: input.status,
    blockReason: clampText(input.blockReason, 300),
    ipAddress: clampText(input.ipAddress, 64),
    userAgent: clampText(input.userAgent, 300),
    createdAt: new Date().toISOString(),
  };

  console.info(
    "[AUTH AUDIT]",
    JSON.stringify({
      id: record.id,
      status: record.status,
      email: record.email,
      ip: record.ipAddress,
      reason: record.blockReason,
      at: record.createdAt,
    })
  );

  const mem = getMemoryLogs();
  mem.push(record);
  if (mem.length > MAX_MEMORY_LOGS) {
    mem.splice(0, mem.length - MAX_MEMORY_LOGS);
  }

  if (await ensureAuthTables()) {
    try {
      await query(
        `INSERT INTO auth_login_logs
           (id, google_sub, email, name, picture, status, block_reason, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          record.id,
          record.googleSub,
          record.email,
          record.name,
          record.picture,
          record.status,
          record.blockReason,
          record.ipAddress,
          record.userAgent,
          record.createdAt,
        ]
      );
      return record;
    } catch (err) {
      console.warn("[authAudit] Failed writing login log to Postgres, using file fallback:", err);
    }
  }

  appendJsonlFile("auth_login_logs.jsonl", record);
  return record;
}

export async function listLoginLogs(options?: {
  limit?: number;
  status?: LoginEventStatus | "ALL";
  search?: string;
}): Promise<LoginLogRecord[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 100)));
  const statusFilter = options?.status && options.status !== "ALL" ? options.status : null;
  const search = (options?.search || "").trim().toLowerCase();

  if (await ensureAuthTables()) {
    try {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (statusFilter) {
        params.push(statusFilter);
        clauses.push(`status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        clauses.push(`(LOWER(email) LIKE $${params.length} OR LOWER(COALESCE(name, '')) LIKE $${params.length})`);
      }
      params.push(limit);
      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const res = await query(
        `SELECT id, google_sub, email, name, picture, status, block_reason, ip_address, user_agent, created_at
         FROM auth_login_logs
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        googleSub: row.google_sub ? String(row.google_sub) : null,
        email: String(row.email),
        name: row.name ? String(row.name) : null,
        picture: row.picture ? String(row.picture) : null,
        status: String(row.status) as LoginEventStatus,
        blockReason: row.block_reason ? String(row.block_reason) : null,
        ipAddress: row.ip_address ? String(row.ip_address) : null,
        userAgent: row.user_agent ? String(row.user_agent) : null,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at || ""),
      }));
    } catch (err) {
      console.warn("[authAudit] Failed reading login logs from Postgres, using file fallback:", err);
    }
  }

  const byId = new Map<string, LoginLogRecord>();
  for (const filePath of getCandidateFiles("auth_login_logs.jsonl")) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-limit * 4)) {
        try {
          const parsed = JSON.parse(line) as LoginLogRecord;
          if (parsed?.id) byId.set(parsed.id, parsed);
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore unreadable file
    }
  }
  for (const item of getMemoryLogs()) {
    byId.set(item.id, item);
  }

  return Array.from(byId.values())
    .filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (search) {
        const hay = `${item.email} ${item.name || ""} ${item.ipAddress || ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

/**
 * Checks whether an account (by email or Google sub) is currently banned.
 * Checks BANNED_EMAILS env first, then Postgres, then local file/memory fallback.
 */
export async function isUserBanned(
  email?: string | null,
  googleSub?: string | null
): Promise<BanCheckResult> {
  const normalizedEmail = normalizeEmail(email);
  const cleanSub = clampText(googleSub, 128);

  if (normalizedEmail && isEmailBannedByEnv(normalizedEmail)) {
    return {
      banned: true,
      reason: "Hesap ortam değişkeni (BANNED_EMAILS) ile engellenmiş.",
      source: "env",
      expiresAt: null,
    };
  }

  if (await ensureAuthTables()) {
    try {
      const res = await query(
        `SELECT email, reason, expires_at, active
         FROM banned_users
         WHERE active = TRUE
           AND (email = $1 OR ($2::TEXT IS NOT NULL AND google_sub = $2))
         LIMIT 1`,
        [normalizedEmail, cleanSub]
      );
      const row = res.rows[0];
      if (row) {
        const expiresAt =
          row.expires_at instanceof Date
            ? row.expires_at.toISOString()
            : row.expires_at
              ? String(row.expires_at)
              : null;
        if (isBanActive({ active: Boolean(row.active), expiresAt })) {
          return {
            banned: true,
            reason: row.reason ? String(row.reason) : "Yönetici tarafından erişim kısıtlandı.",
            source: "postgres",
            expiresAt,
          };
        }
      }
      return { banned: false, reason: null, source: null, expiresAt: null };
    } catch (err) {
      console.warn("[authAudit] Failed checking ban in Postgres, falling back to file:", err);
    }
  }

  const fileBans = loadFileBans();
  const byEmail = normalizedEmail ? fileBans.get(normalizedEmail) : undefined;
  if (byEmail && isBanActive(byEmail)) {
    return {
      banned: true,
      reason: byEmail.reason || "Yönetici tarafından erişim kısıtlandı.",
      source: "file",
      expiresAt: byEmail.expiresAt,
    };
  }
  if (cleanSub) {
    for (const ban of fileBans.values()) {
      if (ban.googleSub === cleanSub && isBanActive(ban)) {
        return {
          banned: true,
          reason: ban.reason || "Yönetici tarafından erişim kısıtlandı.",
          source: "file",
          expiresAt: ban.expiresAt,
        };
      }
    }
  }

  return { banned: false, reason: null, source: null, expiresAt: null };
}

export async function listBannedUsers(): Promise<BannedUserRecord[]> {
  const byEmail = new Map<string, BannedUserRecord>();

  if (await ensureAuthTables()) {
    try {
      const res = await query(
        `SELECT email, google_sub, reason, banned_by, banned_at, expires_at, active
         FROM banned_users
         WHERE active = TRUE
         ORDER BY banned_at DESC`
      );
      for (const row of res.rows) {
        const email = normalizeEmail(row.email);
        const expiresAt =
          row.expires_at instanceof Date
            ? row.expires_at.toISOString()
            : row.expires_at
              ? String(row.expires_at)
              : null;
        if (!isBanActive({ active: Boolean(row.active), expiresAt })) continue;
        byEmail.set(email, {
          email,
          googleSub: row.google_sub ? String(row.google_sub) : null,
          reason: row.reason ? String(row.reason) : null,
          bannedBy: row.banned_by ? String(row.banned_by) : null,
          bannedAt:
            row.banned_at instanceof Date
              ? row.banned_at.toISOString()
              : String(row.banned_at || ""),
          expiresAt,
          active: true,
          source: "postgres",
        });
      }
    } catch (err) {
      console.warn("[authAudit] Failed listing bans from Postgres, using file fallback:", err);
      for (const [email, rec] of loadFileBans().entries()) {
        if (isBanActive(rec)) byEmail.set(email, rec);
      }
    }
  } else {
    for (const [email, rec] of loadFileBans().entries()) {
      if (isBanActive(rec)) byEmail.set(email, rec);
    }
  }

  for (const envEmail of parseEmailList(process.env.BANNED_EMAILS)) {
    if (!byEmail.has(envEmail)) {
      byEmail.set(envEmail, {
        email: envEmail,
        googleSub: null,
        reason: "BANNED_EMAILS ortam değişkeni",
        bannedBy: "env",
        bannedAt: new Date(0).toISOString(),
        expiresAt: null,
        active: true,
        source: "env",
      });
    }
  }

  return Array.from(byEmail.values()).sort((a, b) =>
    String(b.bannedAt).localeCompare(String(a.bannedAt))
  );
}

export async function banUser(input: {
  email: string;
  googleSub?: string | null;
  reason?: string | null;
  bannedBy: string;
  expiresAt?: string | null;
}): Promise<BannedUserRecord> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("Geçerli bir e-posta adresi girilmelidir.");
  }
  const googleSub = clampText(input.googleSub, 128);
  const reason = clampText(input.reason, 300) || "Yönetici tarafından erişim kısıtlandı.";
  const bannedBy = normalizeEmail(input.bannedBy) || "admin";
  const bannedAt = new Date().toISOString();
  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const parsed = Date.parse(input.expiresAt);
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      expiresAt = new Date(parsed).toISOString();
    }
  }

  if (await ensureAuthTables()) {
    try {
      await query(
        `INSERT INTO banned_users (email, google_sub, reason, banned_by, banned_at, expires_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           google_sub = COALESCE(EXCLUDED.google_sub, banned_users.google_sub),
           reason = EXCLUDED.reason,
           banned_by = EXCLUDED.banned_by,
           banned_at = EXCLUDED.banned_at,
           expires_at = EXCLUDED.expires_at,
           active = TRUE`,
        [email, googleSub, reason, bannedBy, bannedAt, expiresAt]
      );
      return {
        email,
        googleSub,
        reason,
        bannedBy,
        bannedAt,
        expiresAt,
        active: true,
        source: "postgres",
      };
    } catch (err) {
      console.warn("[authAudit] Failed persisting ban to Postgres, using file fallback:", err);
    }
  }

  const record: BannedUserRecord = {
    email,
    googleSub,
    reason,
    bannedBy,
    bannedAt,
    expiresAt,
    active: true,
    source: "file",
  };
  const map = loadFileBans();
  map.set(email, record);
  persistFileBans(map);
  return record;
}

export async function unbanUser(emailInput: string): Promise<{ removed: boolean; envLocked: boolean }> {
  const email = normalizeEmail(emailInput);
  if (!email) return { removed: false, envLocked: false };

  const envLocked = isEmailBannedByEnv(email);
  let removed = false;

  if (await ensureAuthTables()) {
    try {
      const res = await query(
        `UPDATE banned_users SET active = FALSE WHERE email = $1 AND active = TRUE`,
        [email]
      );
      removed = (res.rowCount || 0) > 0;
    } catch (err) {
      console.warn("[authAudit] Failed unbanning user in Postgres, trying file fallback:", err);
    }
  }

  const map = loadFileBans();
  if (map.has(email)) {
    map.delete(email);
    persistFileBans(map);
    removed = true;
  }

  return { removed, envLocked };
}
