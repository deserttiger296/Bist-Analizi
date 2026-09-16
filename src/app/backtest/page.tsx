"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatTR, formatTRY, formatPercent, formatDateTR } from "@/lib/format";
import { BIST_SYMBOLS } from "@/lib/bist100";

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("THYAO");
  const [capital, setCapital] = useState(100000);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bist/${symbol}/backtest?capital=${capital}&strategy=SUPERTREND`);
      if (!res.ok) throw new Error("Backtest failed");
      const data = await res.json();
      setResult(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
              Strateji Backtest Motoru
            </h1>
            <p className="text-slate-400 mt-1">Supertrend & RSI Hibrit Stratejisi (1 Yıllık Veri)</p>
          </div>
          <Link href="/" className="text-sm font-semibold text-slate-400 hover:text-white transition">
            ← Dashboard&apos;a Dön
          </Link>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hisse Seçimi</label>
            <select 
              value={symbol} 
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition"
            >
              {BIST_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Başlangıç Sermayesi (₺)</label>
            <input 
              type="number" 
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition"
            />
          </div>
          <div className="flex items-end">
            <button 
              onClick={runTest}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-2.5 rounded-lg transition-all shadow-lg shadow-blue-900/20"
            >
              {loading ? "Test Ediliyor..." : "Simülasyonu Başlat"}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
            Hata: {error}
          </div>
        )}

        {result && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Stats Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
                <p className="text-xs font-bold text-slate-500 uppercase">Net Kar/Zarar</p>
                <p className={`text-2xl font-bold mt-1 ${result.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {formatTRY(result.pnl)}
                </p>
                <p className={`text-sm font-semibold ${result.pnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {formatPercent(result.pnlPercent)}
                </p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
                <p className="text-xs font-bold text-slate-500 uppercase">Win Rate (Başarı)</p>
                <p className="text-2xl font-bold mt-1 text-white">{result.winRate.toFixed(1)}%</p>
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2">
                  <div className="bg-blue-500 h-full rounded-full" style={{ width: `${result.winRate}%` }}></div>
                </div>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
                <p className="text-xs font-bold text-slate-500 uppercase">Max Drawdown</p>
                <p className="text-2xl font-bold mt-1 text-rose-400">-{result.maxDrawdown.toFixed(2)}%</p>
                <p className="text-xs text-slate-500 mt-1">Maksimum sermaye kaybı</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
                <p className="text-xs font-bold text-slate-500 uppercase">Toplam İşlem</p>
                <p className="text-2xl font-bold mt-1 text-white">{result.trades.length / 2} Adet</p>
                <p className="text-xs text-slate-500 mt-1">Al-Sat döngüsü</p>
              </div>
            </div>

            {/* Trade Log */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 flex justify-between items-center">
                <h3 className="font-bold text-white uppercase tracking-wider text-sm">İşlem Geçmişi (Log)</h3>
                <span className="text-xs text-slate-500">Son 1 Yıl</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] tracking-widest font-bold">
                    <tr>
                      <th className="px-6 py-3">Tarih</th>
                      <th className="px-6 py-3">Tip</th>
                      <th className="px-6 py-3">Fiyat</th>
                      <th className="px-6 py-3">Neden</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {result.trades.map((trade: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-3 text-slate-400 font-medium">{formatDateTR(new Date(trade.date))}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${trade.type === "BUY" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"}`}>
                            {trade.type === "BUY" ? "ALIŞ" : "SATIŞ"}
                          </span>
                        </td>
                        <td className="px-6 py-3 font-bold text-white">{formatTR(trade.price)} ₺</td>
                        <td className="px-6 py-3 text-slate-500 italic">{trade.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
