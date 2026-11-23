import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, isAdminEmail, verifySession } from "@/lib/auth";
import { isUserBanned } from "@/lib/authAudit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("bist_session")?.value;
  const user = verifySession(sessionToken);

  if (!user) {
    return NextResponse.json({ authenticated: false, user: null, isAdmin: false });
  }

  const ban = await isUserBanned(user.email, user.id);
  if (ban.banned) {
    const res = NextResponse.json(
      {
        authenticated: false,
        banned: true,
        reason: ban.reason || "Hesabınızın sisteme erişimi kısıtlanmıştır.",
        user: null,
        isAdmin: false,
      },
      { status: 403 }
    );
    clearSessionCookie(res);
    return res;
  }

  return NextResponse.json({
    authenticated: true,
    isAdmin: isAdminEmail(user.email),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      given_name: user.given_name,
    },
  });
}
