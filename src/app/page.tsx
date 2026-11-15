import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("bist_session")?.value;
  const user = verifySession(token);

  if (user) {
    redirect("/index.html");
  } else {
    redirect("/login");
  }
}
