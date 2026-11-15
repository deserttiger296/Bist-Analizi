"use client";

import { useState, useEffect } from "react";
import LiveSignalPanel from "@/components/LiveSignalPanel";
import { WorkspacePage, Panel, EmptyState, StatusBadge } from "@/components/ui/Workspace";

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
    <WorkspacePage title="Sinyal Radarı" description="Bir hisse seçerek momentum, hacim ve zaman dilimi göstergelerini birlikte inceleyin." actions={<StatusBadge>30 saniyede bir yenileme</StatusBadge>}>
      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-[18px] items-start">
        <Panel title="Hisse seçimi" description="Sembol veya şirket adıyla arayın.">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <label htmlFor="radar-symbol" className="sr-only">Hisse sembolü</label>
            <input id="radar-symbol" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Örn. THYAO" autoComplete="off" className="min-w-0 flex-1 uppercase" />
            <button type="submit" className="rsi-button rsi-button-primary">İncele</button>
          </form>
          <p className="workspace-field-label mt-6">Hızlı seçim</p>
          <div className="space-y-2">
            {filteredStocks.map(stock => <button key={stock.symbol} type="button" onClick={() => handleSelectSymbol(stock.symbol)} aria-pressed={selectedSymbol === stock.symbol} className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${selectedSymbol === stock.symbol ? "border-[#3b6a5d] bg-[#18372e] text-[#8be5c5]" : "border-[#29384b] bg-[#121e2c] text-slate-300 hover:border-[#4c6b78]"}`}>
              <span className="min-w-0"><strong className="block text-sm font-semibold">{stock.symbol}</strong><span className="block text-xs text-slate-400 truncate">{stock.name}</span></span>
              <span className="text-[10px] text-slate-400">{stock.category}</span>
            </button>)}
            {!filteredStocks.length && <EmptyState title="Eşleşen hisse yok" description="Sembolü incelemek için arama formunu kullanabilirsiniz." />}
          </div>
        </Panel>
        <div className="space-y-[18px] min-w-0">
          <LiveSignalPanel symbol={selectedSymbol} />
          <Panel title="Göstergeleri nasıl okuyabilirsiniz?">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-slate-400 leading-7">
              <div><h3 className="font-semibold text-slate-200 mb-2">Birleşik skor</h3><p>Trend, momentum, hacim ve fiyat yapısının birlikte değerlendirilmesini sağlar. Bileşenler veri kaynağındaki hesaplamaları yansıtır.</p></div>
              <div><h3 className="font-semibold text-slate-200 mb-2">TSI zaman dilimleri</h3><p>TSI, sinyal ve histogram değerlerini periyotlar arasında karşılaştırın. Her satır kendi zaman diliminin sonucunu gösterir.</p></div>
              <div><h3 className="font-semibold text-slate-200 mb-2">ATR stop seviyesi</h3><p>Veri motorunun volatiliteye göre hesapladığı referans seviyesidir. Fiyat ve mevcut risk görünümüyle birlikte incelenir.</p></div>
            </div>
          </Panel>
        </div>
      </div>
    </WorkspacePage>
  );
}
