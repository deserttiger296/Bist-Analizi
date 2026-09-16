"use client";

import { useState, useEffect } from "react";
import LiveSignalPanel from "@/components/LiveSignalPanel";

interface StockQuickItem {
  symbol: string;
  name: string;
  category: string;
}

const QUICK_STOCKS: StockQuickItem[] = [
  { symbol: "THYAO", name: "Türk Hava Yolları", category: "Ulaşım" },
  { symbol: "GARAN", name: "Garanti BBVA", category: "Banka" },
  { symbol: "AKBNK", name: "Akbank", category: "Banka" },
  { symbol: "TUPRS", name: "Tüpraş", category: "Enerji" },
  { symbol: "EREGL", name: "Erdemir", category: "Metal" },
  { symbol: "SASA", name: "Sasa Polyester", category: "Kimya" },
  { symbol: "KCHOL", name: "Koç Holding", category: "Holding" },
  { symbol: "ASELS", name: "Aselsan", category: "Savunma" },
  { symbol: "FROTO", name: "Ford Otosan", category: "Otomotiv" },
  { symbol: "BIMAS", name: "Bim Mağazalar", category: "Perakende" },
];

export default function RadarPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("THYAO");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pulseColor, setPulseColor] = useState<boolean>(true);

  // Sync with URL query param on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const sym = params.get("symbol");
      if (sym) {
        setSelectedSymbol(sym.toUpperCase());
      }
    }
  }, []);

  // Heartbeat pulse simulation for the live connection indicator
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseColor((prev) => !prev);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleSelectSymbol = (sym: string) => {
    const cleanSym = sym.trim().toUpperCase();
    if (!cleanSym) return;
    setSelectedSymbol(cleanSym);
    
    // Smooth URL update without reload
    if (typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}?symbol=${cleanSym}`;
      window.history.pushState({ path: newUrl }, "", newUrl);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      handleSelectSymbol(searchQuery);
      setSearchQuery("");
    }
  };

  const filteredStocks = QUICK_STOCKS.filter(
    (stock) =>
      stock.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      stock.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Top Banner Header */}
      <div className="pb-4 border-b border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-cyan-400 font-bold">Canlı Sinyal Analiz Merkezi</p>
          <h1 className="text-3xl font-black text-white mt-1">Live Sinyal Radarı</h1>
          <p className="text-slate-400 text-sm mt-1">
            BIST genelindeki hisseleri gerçek zamanlı momentum, hacim ve TSI (True Strength Index) dalgalarıyla izleyin.
          </p>
        </div>

        {/* Pulsing Live Connection Indicator */}
        <div className="flex items-center gap-3 px-4 py-2 bg-[#0f1524] rounded-2xl border border-white/5 shadow-lg flex-shrink-0 self-start md:self-auto">
          <span className="relative flex h-3 w-3">
            <span
              className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 transition-all duration-1000 ${
                pulseColor ? "scale-150 animate-ping" : "scale-100"
              }`}
            ></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <div>
            <p className="text-[10px] font-black tracking-widest text-emerald-400 uppercase">Live Bağlantı</p>
            <p className="text-[9px] text-slate-500">Her 30 saniyede bir otomatik yenilenir</p>
          </div>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Quick Navigation & Search */}
        <div className="lg:col-span-1 space-y-6 flex flex-col">
          {/* Search Card */}
          <div className="bg-[#0f1524] p-4 rounded-2xl border border-white/5 shadow-xl">
            <h3 className="text-xs font-black tracking-wider text-slate-400 uppercase mb-3">Hisse Arama</h3>
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Örn: THYAO, EREGL..."
                className="flex-1 bg-slate-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-all font-semibold uppercase placeholder-slate-600"
              />
              <button
                type="submit"
                className="bg-cyan-600/90 text-white font-bold px-4 py-2 rounded-xl border border-cyan-400/30 hover:bg-cyan-500 hover:scale-105 active:scale-95 transition shadow-[0_0_15px_rgba(34,211,238,0.2)] text-sm cursor-pointer"
              >
                Ara
              </button>
            </form>
          </div>

          {/* Quick Select Panel */}
          <div className="bg-[#0f1524] rounded-2xl border border-white/5 shadow-xl flex-1 flex flex-col min-h-[300px]">
            <div className="p-4 border-b border-white/5">
              <h3 className="text-xs font-black tracking-wider text-slate-400 uppercase">Popüler Hisseler</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[450px] scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              {filteredStocks.length > 0 ? (
                filteredStocks.map((stock) => {
                  const isSelected = selectedSymbol === stock.symbol;
                  return (
                    <button
                      key={stock.symbol}
                      onClick={() => handleSelectSymbol(stock.symbol)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl transition-all border text-left cursor-pointer group ${
                        isSelected
                          ? "bg-cyan-500/10 border-cyan-500/30 text-white shadow-[0_0_15px_rgba(34,211,238,0.05)]"
                          : "bg-transparent border-transparent text-slate-400 hover:text-white hover:bg-white/5 hover:border-white/5"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm group-hover:text-cyan-400 transition-colors">
                            {stock.symbol}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 border border-white/5 text-slate-500">
                            {stock.category}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 truncate max-w-[150px] mt-0.5">
                          {stock.name}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-bold transition-all ${
                          isSelected ? "text-cyan-400 translate-x-0" : "text-slate-600 group-hover:text-slate-300 group-hover:translate-x-1"
                        }`}
                      >
                        {isSelected ? "●" : "→"}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="p-4 text-center text-slate-600 text-xs">Aradığınız hisse bulunamadı.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Live Radar and Explanations */}
        <div className="lg:col-span-3 space-y-6">
          {/* Glowing Neon Frame surrounding LiveSignalPanel */}
          <div className="bg-[#0f1524]/60 backdrop-blur-md rounded-3xl border border-white/10 p-1.5 shadow-[0_0_50px_rgba(34,211,238,0.03)] relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-blue-500/5 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <div className="bg-[#0f1524] rounded-[22px] overflow-hidden border border-white/5">
              <LiveSignalPanel symbol={selectedSymbol} />
            </div>
          </div>

          {/* Educational Documentation Banner */}
          <div className="bg-slate-950/40 rounded-2xl border border-white/5 p-5 md:p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-300 leading-relaxed">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <span className="text-lg">🎯</span>
                <h4>Confluence Skoru</h4>
              </div>
              <p className="text-xs text-slate-400">
                0-100 arasında hesaplanan skordur. Breakout (+30), Hacim (+25), Trend (+25) ve Momentum (+20) değerlerinin matematiksel toplamından elde edilir. 70 ve üzeri güçlü yükseliş teyididir.
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <span className="text-lg">📊</span>
                <h4>TSI Dalga Analizi</h4>
              </div>
              <p className="text-xs text-slate-400">
                True Strength Index (9,3,2,10) sistemiyle 4 farklı zaman diliminde (5D, 15D, 1H, 1G) trend eğilimini ve histogram momentumunu ölçer. Çapraz kesişimler erken sinyal üretir.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-rose-400 font-bold">
                <span className="text-lg">🛡️</span>
                <h4>Dinamik Stop Seviyesi</h4>
              </div>
              <p className="text-xs text-slate-400">
                Hissenin volatilite derinliğini ölçmek için 14 periyotluk ATR (Average True Range) kullanılır. 1.5 ATR mesafe hesaplanarak trend kırılımı öncesi en güvenli stop loss eşiği dinamik olarak çizilir.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
