import { ConsensusData } from "@/lib/scrapers/hedeffiyatScraper";

interface BrokerConsensusPanelProps {
  data: ConsensusData | null;
  ticker: string;
}

export default function BrokerConsensusPanel({ data, ticker }: BrokerConsensusPanelProps) {
  if (!data || !data.brokerTargets || data.brokerTargets.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-sm text-center">
        <h3 className="text-lg font-bold text-white mb-2">🏦 Aracı Kurum Hedef Fiyat Analizi</h3>
        <p className="text-sm text-slate-400">
          Bu hisse senedi ({ticker}) için güncel aracı kurum konsensüs veya hedef fiyat analizi raporu bulunmuyor.
        </p>
      </div>
    );
  }

  // Calculate percentages for progress bars
  const total = Math.max(1, data.buyCount + data.holdCount + data.sellCount);
  const buyPct = Math.round((data.buyCount / total) * 100);
  const holdPct = Math.round((data.holdCount / total) * 100);
  const sellPct = Math.round((data.sellCount / total) * 100);

  const getConsensusColor = (potentialReturn: number) => {
    if (potentialReturn > 25) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (potentialReturn > 5) return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
    if (potentialReturn < -5) return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    return "text-slate-400 bg-slate-500/10 border-slate-500/20";
  };

  const getRecommendationBadge = (rec: string) => {
    const upper = rec.toUpperCase();
    if (upper.includes("AL") || upper.includes("BUY")) {
      return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 uppercase">AL</span>;
    }
    if (upper.includes("SAT") || upper.includes("SELL")) {
      return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/10 border border-rose-500/20 text-rose-400 uppercase">SAT</span>;
    }
    return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-slate-500/10 border border-slate-500/20 text-slate-300 uppercase">TUT</span>;
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-6 backdrop-blur-md shadow-2xl relative overflow-hidden group transition-all duration-300 hover:border-cyan-500/30">
      {/* Background glow effects */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl -z-10 group-hover:bg-cyan-500/10 transition-colors duration-500" />
      <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -z-10" />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800/80 pb-4 mb-6 gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🏦 Aracı Kurum Hedef Fiyat Konsensüsü
          </h2>
          <p className="text-xs text-slate-400 font-medium mt-1">
            Hedef Fiyat veritabanındaki son analist raporları baz alınmıştır.
          </p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-950/40 border border-slate-800 px-3 py-1 rounded-lg">
          Son Güncelleme: {new Date(data.lastUpdated).toLocaleDateString('tr-TR')}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6 items-stretch">
        
        {/* Left Column: Aggregated stats */}
        <div className="space-y-6 flex flex-col justify-between">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 relative">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Konsensüs Hedef</span>
              <span className="text-2xl font-black text-white">{data.consensusTarget.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
              {data.currentPrice > 0 && (
                <span className="text-[10px] text-slate-400 block mt-1">Aktif Fiyat: {data.currentPrice.toLocaleString('tr-TR')} ₺</span>
              )}
            </div>

            <div className={`rounded-xl border p-4 relative flex flex-col justify-between ${getConsensusColor(data.potentialReturn)}`}>
              <div>
                <span className="text-[10px] font-bold opacity-75 uppercase tracking-widest block mb-1">Potansiyel Getiri</span>
                <span className="text-2xl font-black">{data.potentialReturn >= 0 ? "+" : ""}{data.potentialReturn.toFixed(1)}%</span>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest mt-1 block opacity-60">Konsensüs Yönü</span>
            </div>
          </div>

          {/* Recommendation count breakdown */}
          <div className="rounded-xl bg-slate-950/30 border border-slate-800/50 p-4 space-y-3">
            <div className="flex justify-between items-center text-xs font-bold text-slate-300">
              <span>Analist Dağılımı ({data.totalAnalysts} Analist)</span>
              <span className="text-[10px] text-cyan-400 tracking-wider font-mono">Tavsiye Dağılımı</span>
            </div>

            {/* Visual stacked progress bar */}
            <div className="h-2 w-full rounded-full bg-slate-800/50 flex overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${buyPct}%` }} title={`Al: %${buyPct}`} />
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${holdPct}%` }} title={`Tut: %${holdPct}`} />
              <div className="h-full bg-rose-500 transition-all" style={{ width: `${sellPct}%` }} title={`Sat: %${sellPct}`} />
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-bold">
              <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/5 px-2 py-1 rounded border border-emerald-500/10">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Al: {data.buyCount} ({buyPct}%)</span>
              </div>
              <div className="flex items-center gap-1.5 text-amber-400 bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span>Tut: {data.holdCount} ({holdPct}%)</span>
              </div>
              <div className="flex items-center gap-1.5 text-rose-400 bg-rose-500/5 px-2 py-1 rounded border border-rose-500/10">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span>Sat: {data.sellCount} ({sellPct}%)</span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Individual Analyst Targets list */}
        <div className="rounded-xl bg-slate-950/20 border border-slate-800/60 flex flex-col overflow-hidden max-h-[220px]">
          <div className="overflow-y-auto flex-1 custom-scrollbar">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-slate-950/90 backdrop-blur border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                <tr>
                  <th className="py-2 px-3">Aracı Kurum</th>
                  <th className="py-2 px-3 text-right">Hedef Fiyat</th>
                  <th className="py-2 px-3 text-center">Tavsiye</th>
                  <th className="py-2 px-3 text-right">Getiri</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {data.brokerTargets.map((target, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-slate-300">{target.broker}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-white">{target.targetPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
                    <td className="py-2.5 px-3 text-center">{getRecommendationBadge(target.recommendation)}</td>
                    <td className={`py-2.5 px-3 text-right font-mono font-bold ${target.potentialReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {target.potentialReturn >= 0 ? "+" : ""}{target.potentialReturn.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
