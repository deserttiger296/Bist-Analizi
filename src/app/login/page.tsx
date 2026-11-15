import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("bist_session")?.value;
  const user = verifySession(token);

  if (user) {
    redirect("/index.html");
  }

  const sp = await searchParams;
  const loggedOut = sp.logged_out === "1";
  const authError = sp.auth_error;

  return (
    <div className="relative min-h-screen bg-[#060913] text-slate-100 flex flex-col justify-between overflow-x-hidden selection:bg-cyan-500/20 selection:text-cyan-400">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-gradient-to-b from-cyan-500/15 via-blue-600/10 to-transparent blur-3xl opacity-70" />
        <div className="absolute top-1/3 -left-48 w-96 h-96 bg-emerald-500/10 blur-3xl rounded-full" />
        <div className="absolute bottom-10 -right-48 w-96 h-96 bg-cyan-500/10 blur-3xl rounded-full" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(#22d3ee 1px, transparent 1px), linear-gradient(90deg, #22d3ee 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Top Navbar */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            <Image
              src="/static/rsi-mark.svg"
              width={26}
              height={26}
              alt="BIST Analizi Logo"
              unoptimized
            />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              BIST QUANTUM
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
                v2.5
              </span>
            </div>
            <div className="text-[11px] font-medium text-slate-400 tracking-wider">
              NİCEL TİCARET & SİNYAL TERMİNALİ
            </div>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Sistem Çevrimiçi · BIST100 Aktif</span>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="relative z-10 w-full max-w-4xl mx-auto px-4 py-8 flex flex-col items-center justify-center my-auto">
        <div className="w-full max-w-md bg-slate-900/70 border border-cyan-500/25 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl p-8 sm:p-10 relative overflow-hidden">
          {/* Top highlight bar */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />

          {/* Badges / alerts */}
          {loggedOut && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              <span>Başarıyla çıkış yapıldı. Tekrar giriş yapabilirsiniz.</span>
            </div>
          )}

          {authError && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs font-medium flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>Giriş yapılamadı ({authError}). Lütfen tekrar deneyin.</span>
            </div>
          )}

          <div className="text-center mb-8">
            <span className="inline-block text-[11px] font-semibold text-cyan-400 tracking-wider uppercase bg-cyan-950/50 border border-cyan-500/30 px-3 py-1 rounded-full mb-3">
              Güvenli Oturum Portalı
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              BIST Terminaline Giriş
            </h1>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              BIST-100 çoklu zaman dilimi RSI radarı, otonom ReAct quant motoru ve kurumsal risk kalkanına erişmek için oturum açın.
            </p>
          </div>

          {/* Google Sign In Button */}
          <div className="flex flex-col gap-4">
            <a
              href="/api/auth/google"
              className="group relative flex items-center justify-center gap-3 w-full py-3.5 px-6 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_25px_rgba(34,211,238,0.45)] transition-all duration-200 active:scale-[0.99] border border-transparent hover:border-cyan-400 cursor-pointer"
            >
              {/* Official Google G SVG */}
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google ile Güvenli Giriş Yap</span>
            </a>

            <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5 pt-2">
              <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
              </svg>
              <span>OAuth 2.0 & SSL Protokolü ile 256-Bit şifreli koruma</span>
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full mt-10">
          <div className="bg-slate-900/50 border border-slate-800 hover:border-cyan-500/30 rounded-xl p-4 transition-all duration-200">
            <div className="flex items-center gap-2 mb-2 text-cyan-400 font-semibold text-xs">
              <span className="p-1 rounded bg-cyan-950/80 border border-cyan-800/40">⚡</span>
              <span>PU30 / NU70 Radarı</span>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              15m, 1h, 4h ve Günlük periyotlarda fraktal dip/tepe ve GVT/GKD seviyeleri.
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 hover:border-emerald-500/30 rounded-xl p-4 transition-all duration-200">
            <div className="flex items-center gap-2 mb-2 text-emerald-400 font-semibold text-xs">
              <span className="p-1 rounded bg-emerald-950/80 border border-emerald-800/40">🛡️</span>
              <span>Kurumsal Risk Kalkanı</span>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              Net Beklenen Değer (EV), Half-Kelly (%15 tavan) ve Basel III %99 CVaR.
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 hover:border-purple-500/30 rounded-xl p-4 transition-all duration-200">
            <div className="flex items-center gap-2 mb-2 text-purple-400 font-semibold text-xs">
              <span className="p-1 rounded bg-purple-950/80 border border-purple-800/40">⚖️</span>
              <span>Long / Short VİOP</span>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              Spot ve kaldıraçlı VİOP eşleşmesi, piyasa rejim yönü ve piyasa-nötr pair trading.
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 hover:border-amber-500/30 rounded-xl p-4 transition-all duration-200">
            <div className="flex items-center gap-2 mb-2 text-amber-400 font-semibold text-xs">
              <span className="p-1 rounded bg-amber-950/80 border border-amber-800/40">🤖</span>
              <span>13 Ajanlı AI Komitesi</span>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              Otonom ReAct mantığı, Boğa/Ayı münazarası ve Şeytanın Avukatı risk denetimi.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
        <div>
          © 2026 BIST Quantum Sniper · Nicel Finans & Algoritmik Strateji Araştırma Laboratuvarı
        </div>
        <div className="flex items-center gap-6 text-slate-400 text-[11px]">
          <span>Semih PU30/NU70</span>
          <span>•</span>
          <span>BIST100 / VİOP30</span>
          <span>•</span>
          <span>Kurumsal Risk Kalkanı</span>
        </div>
      </footer>
    </div>
  );
}
