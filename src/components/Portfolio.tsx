"use client";

import { useState, useEffect } from "react";
import { formatTR, formatTRY, formatPercent } from "@/lib/format";

interface Position {
  symbol: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
}

interface PortfolioState {
  balance: number;
  positions: Position[];
  history: any[];
}

export default function Portfolio({ currentSymbol, currentPrice }: { currentSymbol?: string, currentPrice?: number }) {
  const [portfolio, setPortfolio] = useState<PortfolioState>({
    balance: 100000,
    positions: [],
    history: []
  });
  const [amountToBuy, setAmountToBuy] = useState(0);

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("bist_portfolio");
    if (saved) {
      setPortfolio(JSON.parse(saved));
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem("bist_portfolio", JSON.stringify(portfolio));
  }, [portfolio]);

  // Sync prices for all portfolio items
  useEffect(() => {
    if (portfolio.positions.length === 0) return;

    const syncPrices = async () => {
      try {
        const symbols = portfolio.positions.map(p => p.symbol).join(",");
        const res = await fetch(`/api/bist/scan?symbols=${symbols}`);
        if (!res.ok) return;
        const json = await res.json();
        
        if (json.results && json.results.length > 0) {
          setPortfolio(prev => {
            const newPositions = prev.positions.map(pos => {
              const result = json.results.find((r: any) => r.symbol === pos.symbol);
              if (result) {
                // Auto-Alert Logic
                if (result.status === 'ALARM' && pos.currentPrice < result.quote.lastClose) {
                  new Notification(`🚀 BIST Fırsat: ${pos.symbol}`, {
                    body: `Güven Skoru: %${result.quote.confidence}. Trend güçleniyor!`,
                    icon: '/favicon.ico'
                  });
                }
                
                return { ...pos, currentPrice: result.quote.lastClose };
              }
              return pos;
            });
            return { ...prev, positions: newPositions };
          });
        }
      } catch (e) {
        console.error("Portfolio sync error", e);
      }
    };

    // Initial sync
    syncPrices();

    // Poll every 60 seconds
    const interval = setInterval(syncPrices, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio.positions.length]);

  // Request notification permissions
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  const handleBuy = () => {
    if (!currentSymbol || !currentPrice || amountToBuy <= 0) return;
    const totalCost = amountToBuy * currentPrice;
    if (totalCost > portfolio.balance) {
      alert("Yetersiz bakiye!");
      return;
    }

    const existingPos = portfolio.positions.find(p => p.symbol === currentSymbol);
    let newPositions = [...portfolio.positions];

    if (existingPos) {
      const totalShares = existingPos.shares + amountToBuy;
      const newAvgPrice = ((existingPos.shares * existingPos.avgPrice) + (amountToBuy * currentPrice)) / totalShares;
      newPositions = portfolio.positions.map(p => 
        p.symbol === currentSymbol ? { ...p, shares: totalShares, avgPrice: newAvgPrice } : p
      );
    } else {
      newPositions.push({
        symbol: currentSymbol,
        shares: amountToBuy,
        avgPrice: currentPrice,
        currentPrice: currentPrice
      });
    }

    setPortfolio({
      ...portfolio,
      balance: portfolio.balance - totalCost,
      positions: newPositions
    });
    setAmountToBuy(0);
  };

  const handleSell = (symbol: string, sharesToSell: number) => {
    const pos = portfolio.positions.find(p => p.symbol === symbol);
    if (!pos || sharesToSell <= 0 || sharesToSell > pos.shares) return;

    // Use currentPrice if it's for the currently viewed stock, otherwise use the last known price in the position
    const sellPrice = (symbol === currentSymbol && currentPrice) ? currentPrice : pos.currentPrice;
    const revenue = sharesToSell * sellPrice;

    let newPositions = portfolio.positions
      .map(p => p.symbol === symbol ? { ...p, shares: p.shares - sharesToSell } : p)
      .filter(p => p.shares > 0);

    setPortfolio({
      ...portfolio,
      balance: portfolio.balance + revenue,
      positions: newPositions
    });
  };

  const totalPositionValue = portfolio.positions.reduce((sum, p) => sum + (p.shares * (p.symbol === currentSymbol && currentPrice ? currentPrice : p.currentPrice)), 0);
  const totalEquity = portfolio.balance + totalPositionValue;
  const totalPnL = totalEquity - 100000;
  const totalPnLPercent = (totalPnL / 100000) * 100;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div className="bg-gradient-to-r from-indigo-900/40 to-slate-900/40 px-6 py-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sanal Portföy</h3>
          <p className="text-2xl font-bold text-white mt-1">{formatTRY(totalEquity)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-slate-500 uppercase">Toplam Kar/Zarar</p>
          <p className={`text-sm font-bold mt-1 ${totalPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {totalPnL >= 0 ? "+" : ""}{formatTRY(totalPnL)} ({formatPercent(totalPnLPercent)})
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Quick Trade Panel */}
        {currentSymbol && (
          <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-white">{currentSymbol} İşlem Yap</span>
              <span className="text-xs text-slate-500">Fiyat: {formatTR(currentPrice || 0)} ₺</span>
            </div>
            <div className="flex gap-2">
              <input 
                type="number" 
                placeholder="Lot Miktarı"
                value={amountToBuy || ""}
                onChange={(e) => setAmountToBuy(Number(e.target.value))}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button 
                onClick={handleBuy}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
              >
                AL
              </button>
            </div>
            <p className="text-[10px] text-slate-500">Maliyet: {formatTRY((amountToBuy || 0) * (currentPrice || 0))} | Kalan Bakiye: {formatTRY(portfolio.balance)}</p>
          </div>
        )}

        {/* Positions Table */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Açık Pozisyonlar</h4>
          {portfolio.positions.length === 0 ? (
            <p className="text-sm text-slate-600 italic py-4 text-center">Henüz açılmış bir pozisyonunuz yok.</p>
          ) : (
            <div className="space-y-2">
              {portfolio.positions.map(pos => {
                const currentP = (pos.symbol === currentSymbol && currentPrice) ? currentPrice : pos.currentPrice;
                const pnl = (currentP - pos.avgPrice) * pos.shares;
                const pnlP = ((currentP - pos.avgPrice) / pos.avgPrice) * 100;

                return (
                  <div key={pos.symbol} className="flex items-center justify-between p-3 bg-slate-900/40 border border-slate-800/50 rounded-xl hover:bg-slate-800/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center font-bold text-white text-xs">
                        {pos.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-bold text-white text-sm">{pos.symbol}</p>
                        <p className="text-[10px] text-slate-500">{pos.shares} Lot @ {formatTR(pos.avgPrice)}</p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div>
                        <p className={`text-sm font-bold ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {formatTRY(pnl)}
                        </p>
                        <p className={`text-[10px] font-semibold ${pnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {pnlP >= 0 ? "+" : ""}{pnlP.toFixed(2)}%
                        </p>
                      </div>
                      <button 
                        onClick={() => handleSell(pos.symbol, pos.shares)}
                        className="p-2 hover:bg-rose-500/10 text-rose-500 rounded-lg transition-colors"
                        title="Tümünü Sat"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Portfolio Reset */}
        <button 
          onClick={() => {
            if(confirm("Tüm portföyü sıfırlamak istediğinize emin misiniz?")) {
              setPortfolio({ balance: 100000, positions: [], history: [] });
            }
          }}
          className="text-[10px] text-slate-600 hover:text-rose-500 transition-colors uppercase font-bold tracking-widest"
        >
          Portföyü Sıfırla
        </button>
      </div>
    </div>
  );
}
