"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Route Segment Error Caught:", error);
  }, [error]);

  return (
    <div className="w-full h-full flex items-center justify-center min-h-[400px] p-6">
      <div className="max-w-lg w-full bg-[#0f1524] border border-red-500/20 rounded-xl p-8 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        
        <div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Sayfa Yüklenirken Hata Oluştu</h2>
          <p className="text-sm text-slate-400">
            Bu sayfanın verileri çekilirken veya işlenirken bir sorun yaşandı. Lütfen tekrar deneyin.
          </p>
        </div>

        <div className="p-3 bg-black/40 rounded border border-slate-800 text-left overflow-hidden text-xs font-mono text-slate-400 max-h-32 overflow-y-auto">
          {error.message || "Bilinmeyen bir hata"}
        </div>

        <button
          onClick={() => reset()}
          className="bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 px-6 rounded-lg transition-colors border border-slate-700"
        >
          Yeniden Yükle
        </button>
      </div>
    </div>
  );
}
