"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password })
      });
      
      if (res.ok) {
        router.push("/");
        router.refresh(); // Refresh to clear any cached states
      } else {
        const data = await res.json();
        setError(data.message || "Geçersiz kimlik veya parola!");
      }
    } catch (err) {
      setError("Bağlantı hatası oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glowing effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="bg-[#0f1524]/80 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.3)] mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" />
                <rect x="4" y="4" width="16" height="16" transform="rotate(45 12 12)" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 text-center tracking-tight">
              KAZANANLAR KULÜBÜ
            </h1>
            <p className="text-slate-400 text-sm mt-2">Sistem Terminali</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 tracking-wider">KULLANICI ID</label>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="w-full bg-[#0b0f19] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder:text-slate-700"
                placeholder="ID giriniz..."
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 tracking-wider">GÜVENLİK PAROLASI</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0b0f19] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder:text-slate-700"
                placeholder="Parola giriniz..."
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm font-medium text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-4 rounded-xl text-white font-bold tracking-wide transition-all duration-300 relative overflow-hidden group ${isLoading ? 'bg-cyan-600/50 cursor-not-allowed' : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] hover:-translate-y-0.5'}`}
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
              <span className="relative z-10 flex items-center justify-center gap-2">
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Giriş Yapılıyor...
                  </>
                ) : (
                  "Sisteme Giriş Yap"
                )}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
