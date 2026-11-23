import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { isUserBanned } from "@/lib/authAudit";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("bist_session")?.value;
  const user = verifySession(token);

  if (user) {
    const ban = await isUserBanned(user.email, user.id);
    if (ban.banned) {
      redirect("/login?auth_error=banned");
    }
    redirect("/index.html");
  } else {
    redirect("/login");
  }
}
