"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReportGeneratorForm() {
  const [symbol, setSymbol] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (symbol.trim()) {
      const cleanSymbol = symbol.trim().toUpperCase().replace(".IS", "");
      router.push(`/analysis/${cleanSymbol}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center">
      <input
        type="text"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="THYAO, GARAN, ASELS..."
        className="w-full bg-slate-900 border-2 border-slate-700 text-white px-6 py-4 rounded-xl focus:outline-none focus:border-cyan-500 transition-colors text-lg font-medium placeholder:text-slate-600 uppercase"
        autoFocus
      />
      <button
        type="submit"
        disabled={!symbol.trim()}
        className="absolute right-2 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-lg hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/25"
      >
        Rapor Üret
      </button>
    </form>
  );
}
