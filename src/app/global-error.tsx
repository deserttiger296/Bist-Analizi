"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service like Sentry or Firebase Crashlytics equivalent
    console.error("Global Application Error Caught:", error);
  }, [error]);

  return (
    <html>
      <body className="bg-[#0b0f19] text-white flex items-center justify-center min-h-screen">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/30">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          
          <div>
            <h1 className="text-2xl font-black text-red-400 mb-2">Sistem Çöktü</h1>
            <p className="text-sm text-slate-400">
              Beklenmeyen bir hata oluştu. Sorun loglara kaydedildi ve inceleniyor.
            </p>
          </div>

          <div className="p-4 bg-black/50 rounded-lg border border-slate-800 text-left overflow-hidden text-xs font-mono text-red-300">
            {error.message || "Bilinmeyen bir hata"}
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <button
              onClick={() => reset()}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-red-500/20"
            >
              Tekrar Dene
            </button>
            <Link 
              href="/"
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-lg transition-colors text-center"
            >
              Ana Sayfaya Dön
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
