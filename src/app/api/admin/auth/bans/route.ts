import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail, normalizeEmail, verifySession } from "@/lib/auth";
import {
  banUser,
  getAuthStorageMode,
  isUserBanned,
  listBannedUsers,
  unbanUser,
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

  const [bans, storage] = await Promise.all([listBannedUsers(), getAuthStorageMode()]);
  return NextResponse.json({
    ok: true,
    count: bans.length,
    storage,
    bans,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    const targetEmail = normalizeEmail(body?.email);
    if (!targetEmail || !targetEmail.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "Geçerli bir e-posta adresi girilmelidir." },
        { status: 400 }
      );
    }

    if (targetEmail === normalizeEmail(auth.user.email) || isAdminEmail(targetEmail)) {
      return NextResponse.json(
        { ok: false, error: "Yönetici (ADMIN_EMAILS) hesabı yasaklanamaz." },
        { status: 400 }
      );
    }

    const record = await banUser({
      email: targetEmail,
      googleSub: typeof body?.googleSub === "string" ? body.googleSub : null,
      reason: typeof body?.reason === "string" ? body.reason : null,
      bannedBy: auth.user.email,
      expiresAt: typeof body?.expiresAt === "string" ? body.expiresAt : null,
    });

    return NextResponse.json({ ok: true, ban: record }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Yasaklama işlemi başarısız.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let email = normalizeEmail(req.nextUrl.searchParams.get("email"));
  if (!email) {
    const body = await req.json().catch(() => ({}));
    email = normalizeEmail(body?.email);
  }
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "Kaldırılacak e-posta adresi belirtilmelidir." },
      { status: 400 }
    );
  }

  const result = await unbanUser(email);
  if (result.envLocked) {
    return NextResponse.json({
      ok: true,
      removed: result.removed,
      envLocked: true,
      message:
        "Veritabanı/dosya yasağı kaldırıldı ancak bu hesap BANNED_EMAILS ortam değişkeninde tanımlı olduğu için env'den de kaldırılmalıdır.",
    });
  }

  return NextResponse.json({
    ok: true,
    removed: result.removed,
    envLocked: false,
  });
}
