/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export function AuthButton() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser(data.user);
          setIsAdmin(Boolean(data.isAdmin));
        } else {
          setUser(null);
          setIsAdmin(false);
        }
      })
      .catch(() => {
        setUser(null);
        setIsAdmin(false);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-7 w-24 rounded-lg bg-slate-800/50 animate-pulse" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs shadow-sm">
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name}
            className="w-5 h-5 rounded-full border border-cyan-500/50"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-cyan-600 font-bold text-white flex items-center justify-center text-[10px]">
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="font-semibold text-slate-200 max-w-[90px] truncate" title={user.email}>
          {user.name}
        </span>
        {isAdmin && (
          <a
            href="/admin/security"
            className="text-cyan-400 hover:text-cyan-300 font-semibold ml-1 text-[11px] transition-colors"
            title="Güvenlik, Giriş Logları ve Yasaklama Paneli"
          >
            Güvenlik
          </a>
        )}
        <a
          href="/api/auth/logout"
          className="text-slate-400 hover:text-rose-400 font-bold ml-1 text-[11px] transition-colors"
          title="Çıkış Yap"
        >
          Çıkış
        </a>
      </div>
    );
  }

  return (
    <a
      href="/api/auth/google"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-900/90 hover:bg-slate-800 text-slate-200 font-semibold text-xs transition-all shadow-sm"
      title="Google Hesabınızla Giriş Yapın"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
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
      <span>Google ile Giriş</span>
    </a>
  );
}
