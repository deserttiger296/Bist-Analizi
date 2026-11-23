import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail, verifySession } from "@/lib/auth";
import {
  getAuthStorageMode,
  isUserBanned,
  listLoginLogs,
  type LoginEventStatus,
} from "@/lib/authAudit";

export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get("bist_session")?.value;
  const user = verifySession(token);
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  const ban = await isUserBanned(user.email, user.id);
  if (ban.banned) {
    return { error: NextResponse.json({ ok: false, error: "Forbidden (banned)" }, { status: 403 }) };
  }
  if (!isAdminEmail(user.email)) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Forbidden — sadece ADMIN_EMAILS yetkili hesapları erişebilir." },
        { status: 403 }
      ),
    };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const limitParam = Number(sp.get("limit") || "100");
  const rawStatus = (sp.get("status") || "ALL").toUpperCase();
  const status: LoginEventStatus | "ALL" =
    rawStatus === "ALLOWED" || rawStatus === "BLOCKED" || rawStatus === "ERROR"
      ? rawStatus
      : "ALL";
  const search = sp.get("q") || "";

  const [logs, storage] = await Promise.all([
    listLoginLogs({
      limit: Number.isFinite(limitParam) ? limitParam : 100,
      status,
      search,
    }),
    getAuthStorageMode(),
  ]);

  return NextResponse.json({
    ok: true,
    count: logs.length,
    storage,
    logs,
  });
}
