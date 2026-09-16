import { AkdData } from "@/lib/akd";

interface AkdFlowPanelProps {
  data: AkdData | null;
  ticker: string;
}

export default function AkdFlowPanel({ data, ticker }: AkdFlowPanelProps) {
  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-sm text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <h3 className="text-lg font-bold text-white">🐳 Aracı Kurum Dağılımı (AKD)</h3>
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black tracking-wider animate-pulse">CANLI VERİ</span>
        </div>
        <p className="text-sm text-slate-400">
          Bu hisse senedi ({ticker}) için güncel kurum dağılımı ve akıllı para akışı verisi bulunmuyor.
        </p>
      </div>
    );
  }

  const isPositive = data.netDifference >= 0;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-6 backdrop-blur-md shadow-2xl relative overflow-hidden group transition-all duration-300 hover:border-cyan-500/30">
      {/* Background glow effects */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -z-10 group-hover:bg-emerald-500/10 transition-colors duration-500" />
      <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -z-10" />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800/80 pb-4 mb-6 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              🐳 Aracı Kurum Dağılımı (AKD & Smart Money)
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black tracking-wider animate-pulse">CANLI VERİ</span>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">
            Analist hedefleri ve akıllı para akışlarından derlenmiş canlı simülasyon akışları.
          </p>
        </div>
        
        {/* Dynamic status badge */}
        <div className="flex flex-wrap gap-2">
          {data.smartMoneyInflow ? (
            <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-black rounded-lg uppercase tracking-wide animate-pulse">
              🐳 Akıllı Para Girişi
            </span>
          ) : (
            <span className="px-3 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-black rounded-lg uppercase tracking-wide">
              📉 Kurumsal Dağıtım
            </span>
          )}
        </div>
      </div>

      {/* Net lot flows metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 text-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Kurumsal Net Lot Farkı</span>
          <span className={`text-xl font-black ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? "+" : ""}{data.netDifference.toLocaleString('tr-TR')} Lot
          </span>
        </div>

        <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 text-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Yabancı Alım (BofA/Citi)</span>
          <span className={`text-base font-black uppercase ${data.isForeignBuying ? 'text-emerald-400' : 'text-slate-500'}`}>
            {data.isForeignBuying ? "✅ Aktif Alıcı" : "❌ Satıcı veya Nötr"}
          </span>
        </div>

        <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 text-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Yatırım Fonları</span>
          <span className={`text-base font-black uppercase ${data.isFundBuying ? 'text-emerald-400' : 'text-slate-500'}`}>
            {data.isFundBuying ? "✅ Lot Topluyor" : "❌ Pasif konumda"}
          </span>
        </div>
      </div>

      {/* Side-by-side Buyer and Seller distribution list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Buyers Card */}
        <div className="rounded-xl bg-emerald-950/5 border border-emerald-500/10 p-4 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center justify-between border-b border-emerald-500/10 pb-2">
            <span>📈 Toplam Alıcı (İlk 3 Kurum)</span>
            <span className="text-[10px] font-normal tracking-normal text-slate-400">Lot Miktarı</span>
          </h4>
          <div className="space-y-3">
            {data.topBuyers.map((buyer, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-200">{idx + 1}. {buyer.name}</span>
                  <span className="font-mono text-slate-400 font-bold">{buyer.volume.toLocaleString('tr-TR')} Lot ({buyer.percentage}%)</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800/50 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${buyer.percentage}%` }} />
                </div>
              </div>
            ))}
            {data.topBuyers.length === 0 && (
              <div className="text-center py-4 text-slate-500 text-xs font-medium">Büyüklük verisi bulunamadı.</div>
            )}
          </div>
        </div>

        {/* Sellers Card */}
        <div className="rounded-xl bg-rose-950/5 border border-rose-500/10 p-4 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center justify-between border-b border-rose-500/10 pb-2">
            <span>📉 Toplam Satıcı (İlk 3 Kurum)</span>
            <span className="text-[10px] font-normal tracking-normal text-slate-400">Lot Miktarı</span>
          </h4>
          <div className="space-y-3">
            {data.topSellers.map((seller, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-200">{idx + 1}. {seller.name}</span>
                  <span className="font-mono text-slate-400 font-bold">{seller.volume.toLocaleString('tr-TR')} Lot ({seller.percentage}%)</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800/50 overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: `${seller.percentage}%` }} />
                </div>
              </div>
            ))}
            {data.topSellers.length === 0 && (
              <div className="text-center py-4 text-slate-500 text-xs font-medium">Büyüklük verisi bulunamadı.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
