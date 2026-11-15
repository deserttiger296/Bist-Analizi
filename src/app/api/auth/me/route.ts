import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("bist_session")?.value;
  const user = verifySession(sessionToken);

  if (!user) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      given_name: user.given_name,
    },
  });
}
