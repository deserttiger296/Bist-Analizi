"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

interface AiInstitutionalAnalysisProps {
  stock: any;
}

export default function AiInstitutionalAnalysis({ stock }: AiInstitutionalAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setMetrics(null);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockData: stock }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate AI report");
      }

      setReport(data.analysis);
      setMetrics(data.metrics);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getDecisionColor = (decision: string) => {
    if (!decision) return "bg-gray-800 text-gray-300 border-gray-700";
    if (decision.includes("STRONG_BUY")) return "bg-green-950 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]";
    if (decision.includes("BUY")) return "bg-green-900/40 border-green-600/50 text-green-400";
    if (decision.includes("HOLD")) return "bg-yellow-900/40 border-yellow-600/50 text-yellow-400";
    if (decision.includes("STRONG_SELL")) return "bg-red-950 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]";
    if (decision.includes("SELL")) return "bg-red-900/40 border-red-600/50 text-red-400";
    return "bg-gray-800 text-gray-300 border-gray-700";
  };

  const getRegimeColor = (regime: string) => {
    if (!regime) return "text-gray-400";
    if (regime.includes("BULL")) return "text-green-400";
    if (regime.includes("BEAR")) return "text-red-400";
    if (regime.includes("RANGE")) return "text-yellow-400";
    if (regime.includes("VOLATILE")) return "text-purple-400";
    return "text-gray-400";
  };

  return (
    <div className="card space-y-6 border border-indigo-900/50 bg-indigo-950/10 p-6 rounded-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
            AI Quant Engine & DSS
          </h3>
          <p className="text-xs text-indigo-300/60 mt-1 uppercase tracking-wider font-semibold">BIST Karar Destek Sistemi</p>
        </div>
        <button
          onClick={generateReport}
          disabled={loading}
          className="rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 px-6 py-2.5 text-sm font-bold text-white transition disabled:opacity-50 flex items-center justify-center min-w-[180px] shadow-lg shadow-indigo-900/50 border border-indigo-500/50"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analiz Ediliyor...
            </span>
          ) : "Sistemi Çalıştır"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-400 border border-red-900/50">
          <div className="font-bold mb-1">Analiz Hatası:</div>
          {error}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
          {/* Decision Card */}
          <div className={`col-span-1 md:col-span-2 lg:col-span-2 rounded-2xl border p-6 flex flex-col justify-center items-center ${getDecisionColor(metrics.decision)}`}>
            <div className="text-xs font-bold uppercase tracking-widest opacity-80 mb-2">Sistem Kararı</div>
            <div className="text-4xl font-black tracking-tight drop-shadow-md">{metrics.decision}</div>
            {metrics.position_sizing_pct !== undefined && (
              <div className="mt-3 px-4 py-1.5 bg-black/30 rounded-full text-sm font-bold tracking-wide">
                Önerilen Pozisyon: %{metrics.position_sizing_pct}
              </div>
            )}
          </div>

          {/* Regime & Confluence */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 flex flex-col justify-between">
            <div>
              <div className="text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-widest">Piyasa Rejimi</div>
              <div className={`text-xl font-black tracking-wide ${getRegimeColor(metrics.regime)}`}>{metrics.regime || "Bilinmiyor"}</div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="text-[10px] text-slate-400 mb-2 uppercase font-bold tracking-widest">MTF Uyumu</div>
              <div className="flex items-center gap-2 text-sm">
                {metrics.mtf_confluence ? (
                  <span className="flex items-center gap-1.5 text-green-400 font-bold bg-green-400/10 px-2.5 py-1 rounded-md">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span> Uyumlu (Confluence)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-yellow-500 font-bold bg-yellow-500/10 px-2.5 py-1 rounded-md">
                    <span className="w-2 h-2 rounded-full bg-yellow-500"></span> Parçalı / Çelişkili
                  </span>
                )}
              </div>
            </div>
            
            {/* AKD Smart Money Add-on */}
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-widest">AKD Kurumsal Flow</div>
              <div className="font-semibold text-sm mt-1">
                {metrics.akd_flow === "ACCUMULATION" ? (
                  <span className="text-green-400 bg-green-400/10 px-2.5 py-1 rounded-md">🟢 Kurumsal Toplama</span>
                ) : metrics.akd_flow === "DISTRIBUTION" ? (
                  <span className="text-red-400 bg-red-400/10 px-2.5 py-1 rounded-md">🔴 Kurumsal Dağıtım</span>
                ) : (
                  <span className="text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md">Nötr</span>
                )}
              </div>
            </div>
          </div>

          {/* Tactical Metrics & Sentiment */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 flex flex-col justify-between">
            <div>
              <div className="text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-widest">Karanlık Oda / Takas</div>
              <div className="font-semibold text-sm mt-1">
                {metrics.tactical_metrics?.dark_pool_block_trade_detected ? (
                  <span className="text-purple-400 bg-purple-400/10 px-2.5 py-1 rounded-md flex inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping"></span> Olağandışı Hacim
                  </span>
                ) : (
                  <span className="text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md">Normal Seyir</span>
                )}
              </div>
            </div>
            
            {/* Sentiment Trap Radar */}
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-widest">Haber Duyarlılığı (Sentiment)</div>
              <div className="font-semibold text-sm mt-1">
                {metrics.sentiment_trap === "SELL_THE_NEWS_TRAP" ? (
                  <span className="text-red-500 bg-red-500/10 border border-red-500/50 px-2.5 py-1 rounded-md flex inline-flex items-center gap-1 shadow-[0_0_10px_rgba(239,68,68,0.3)]">
                    ⚠️ HABERİ SAT TUZAĞI (TRAP)
                  </span>
                ) : metrics.sentiment_trap === "BUY_THE_DIP_TRAP" ? (
                  <span className="text-green-500 bg-green-500/10 border border-green-500/50 px-2.5 py-1 rounded-md flex inline-flex items-center gap-1">
                    ✅ PANİK ALIMI (DIP BUY)
                  </span>
                ) : (
                  <span className="text-blue-400">Normal Haber Akışı</span>
                )}
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-widest">Katalizör / Kurumsal</div>
              <div className="text-sm font-semibold text-cyan-300 line-clamp-2 leading-tight" title={metrics.tactical_metrics?.corporate_action_catalyst}>
                {metrics.tactical_metrics?.corporate_action_catalyst && metrics.tactical_metrics.corporate_action_catalyst !== "NULL" 
                  ? metrics.tactical_metrics.corporate_action_catalyst 
                  : "Yakın bir olay/duyuru yok"}
              </div>
            </div>
          </div>

          {/* Action Levels Grid */}
          {metrics.levels && (
            <div className="col-span-1 md:col-span-2 lg:col-span-4 grid grid-cols-2 md:grid-cols-5 gap-3 mt-1">
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 transition hover:bg-slate-800/60">
                <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Giriş Bölgesi</div>
                <div className="text-base font-mono font-bold mt-1.5 text-blue-300">
                  {Array.isArray(metrics.levels.entry_zone) ? metrics.levels.entry_zone.join(" - ") : metrics.levels.entry_zone}
                </div>
              </div>
              <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-4 transition hover:bg-red-950/40">
                <div className="text-[10px] uppercase text-red-400/80 font-bold tracking-wider">Stop-Loss (ATR)</div>
                <div className="text-base font-mono font-bold mt-1.5 text-red-400 drop-shadow-sm">{metrics.levels.stop_loss}</div>
              </div>
              <div className="bg-green-950/20 border border-green-900/30 rounded-xl p-4 transition hover:bg-green-950/40">
                <div className="text-[10px] uppercase text-green-400/80 font-bold tracking-wider">İlk Hedef (TP1)</div>
                <div className="text-base font-mono font-bold mt-1.5 text-green-400 drop-shadow-sm">{metrics.levels.take_profit_1}</div>
              </div>
              <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 transition hover:bg-indigo-950/40">
                <div className="text-[10px] uppercase text-indigo-400/80 font-bold tracking-wider">Ana Hedef (TP2)</div>
                <div className="text-base font-mono font-bold mt-1.5 text-indigo-400 drop-shadow-sm">{metrics.levels.take_profit_2}</div>
              </div>
              
              {/* Dynamic Fibonacci Proximity */}
              <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-4 transition hover:bg-amber-950/40">
                <div className="text-[10px] uppercase text-amber-400/80 font-bold tracking-wider">Fibonacci 0.618</div>
                <div className="text-base font-mono font-bold mt-1.5 text-amber-400 drop-shadow-sm">
                  {metrics.fibonacci_proximity ? `%${metrics.fibonacci_proximity} Uzakta` : "N/A"}
                </div>
              </div>
            </div>
          )}

          {/* XAI: Explainable AI Prediction Autopsy */}
          {metrics.xai_breakdown && (
            <div className="col-span-1 md:col-span-2 lg:col-span-4 bg-slate-900/40 border border-indigo-500/30 rounded-xl p-5 mt-2">
              <div className="flex justify-between items-center mb-4">
                <div className="text-xs uppercase text-indigo-300 font-bold tracking-widest flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                  XAI: Açıklanabilir YZ Tahmin Otopsisi
                </div>
                <div className="text-[10px] bg-indigo-900/50 text-indigo-200 px-2 py-1 rounded">Şeffaf Kutu Analizi</div>
              </div>
              
              <div className="space-y-3">
                {metrics.xai_breakdown.map((item: any, idx: number) => {
                  const isPositive = item.contribution > 0;
                  const isDrag = item.role === "OPPOSING_DRAG";
                  const barColor = isDrag ? "bg-red-500" : "bg-emerald-500";
                  const width = Math.min(100, Math.abs(item.contribution));
                  
                  return (
                    <div key={idx} className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-bold text-slate-300">{item.indicator}</span>
                        <span className={isDrag ? "text-red-400" : "text-emerald-400"}>
                          {isPositive ? "+" : ""}{item.contribution.toFixed(1)}% ({item.role})
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-2">
                        <div className={`${barColor} h-2 rounded-full`} style={{ width: `${width}%` }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Risk Flags */}
          {metrics.risk_flags && metrics.risk_flags.length > 0 && (
            <div className="col-span-1 md:col-span-2 lg:col-span-4 bg-orange-950/30 border border-orange-900/50 rounded-xl p-4 mt-1">
              <div className="text-[10px] uppercase text-orange-400 font-bold mb-2 tracking-widest">Risk Bildirimleri</div>
              <ul className="text-sm text-orange-200/80 space-y-1.5 list-disc pl-5 font-medium">
                {metrics.risk_flags.map((flag: string, idx: number) => (
                  <li key={idx} className="leading-snug">{flag}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="prose prose-invert prose-indigo max-w-none rounded-2xl bg-slate-900/60 p-6 md:p-8 text-slate-300 border border-slate-800 shadow-inner">
          <ReactMarkdown>{report}</ReactMarkdown>
        </div>
      )}
      
      {!report && !metrics && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-indigo-500/20 bg-indigo-950/10 p-10 text-center flex flex-col items-center justify-center group hover:bg-indigo-950/20 transition-colors duration-300">
          <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div className="text-lg font-bold text-indigo-200 mb-2">Yapay Zeka Karar Destek Motoru Hazır</div>
          <p className="text-sm text-indigo-300/60 max-w-md leading-relaxed">
            Yukarıdaki butona tıklayarak hisse için Smart Money Concepts (SMC), Makro Rejim Filtreleri ve Takas/Karanlık Oda analizlerini başlatabilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
}
