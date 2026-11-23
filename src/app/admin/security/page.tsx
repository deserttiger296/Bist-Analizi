import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminEmail, verifySession } from "@/lib/auth";
import { isUserBanned } from "@/lib/authAudit";
import { SecurityAdminClient } from "./SecurityAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("bist_session")?.value;
  const user = verifySession(token);

  if (!user) {
    redirect("/login?from=/admin/security");
  }

  const ban = await isUserBanned(user.email, user.id);
  if (ban.banned) {
    redirect("/login?auth_error=banned");
  }

  if (!isAdminEmail(user.email)) {
    return (
      <div className="min-h-screen bg-[#060913] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-slate-900/80 border border-rose-500/30 rounded-2xl p-8 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-2">
            Yetkisiz Erişim (403)
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">
            Güvenlik Paneli Sadece Yöneticilere Açıktır
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">
            Giriş yaptığınız hesap (<span className="font-mono text-cyan-300">{user.email}</span>)
            yönetici listesinde (<code className="text-amber-300">ADMIN_EMAILS</code>) yer almıyor.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-6">
            Bu panele erişmek için <code className="text-slate-200">.env.local</code> veya Vercel
            Ortam Değişkenlerine <code className="text-cyan-300">ADMIN_EMAILS={user.email}</code>{" "}
            ekleyip uygulamayı yeniden başlatın.
          </p>
          <Link
            href="/index.html"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium transition-colors"
          >
            ← Terminale Dön
          </Link>
        </div>
      </div>
    );
  }

  return <SecurityAdminClient adminEmail={user.email} />;
}
