"use client";

import { useState, useEffect } from "react";
import clsx from "clsx";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import VerdictDisplay from "./VerdictDisplay";

interface StockCardProps {
  stock: {
    ticker: string;
    name: string;
    price: number;
    signal: string;
    confidence: string;
    change24h: number;
    volume: number;
    recentPrices?: number[];
    rsi?: number;
    breakout?: number;
    hullBreakout?: boolean;
    maCrossover?: boolean;
    supertrendUp?: boolean;
    inSqueeze?: boolean;
    adxValue?: number;
    sarBullish?: boolean;
    stochK?: number;
    cciValue?: number;
    momentumPhase?: number;
    priceUsd?: number;
    supportTl?: number;
    targetUsd?: number;
    indexTag?: string;
  };
  isSelected: boolean;
}

const signalStyles: Record<string, string> = {
  STRONG_BUY: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50",
  BUY: "bg-green-500/20 text-green-400 border border-green-500/50",
  HOLD: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/50",
  SELL: "bg-orange-500/20 text-orange-400 border border-orange-500/50",
  STRONG_SELL: "bg-red-500/20 text-red-400 border border-red-500/50",
  WATCH: "bg-blue-500/20 text-blue-400 border border-blue-500/50",
};

const getIndexBadge = (tag?: string) => {
  if (!tag) return null;
  switch (tag) {
    case "BIST 30": return <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[8px] font-black uppercase tracking-wider inline-flex items-center gap-0.5">🥇 30</span>;
    case "BIST 50": return <span className="px-1.5 py-0.5 rounded bg-slate-400/20 border border-slate-400/50 text-slate-300 text-[8px] font-black uppercase tracking-wider inline-flex items-center gap-0.5">🥈 50</span>;
    case "BIST 100": return <span className="px-1.5 py-0.5 rounded bg-orange-600/20 border border-orange-600/50 text-orange-400 text-[8px] font-black uppercase tracking-wider inline-flex items-center gap-0.5">🥉 100</span>;
    default: return <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/50 text-indigo-400 text-[8px] font-black uppercase tracking-wider inline-flex items-center gap-0.5">🔹 TÜM</span>;
  }
};

const signalLabels: Record<string, string> = {
  STRONG_BUY: "Güçlü Al",
  BUY: "Al",
  HOLD: "Bekle",
  SELL: "Sat",
  STRONG_SELL: "Güçlü Sat",
  WATCH: "Gözlemle",
};

export default function StockCard({ stock, isSelected }: StockCardProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isPositive = stock.change24h >= 0;
  const changeColor = isPositive ? "text-emerald-400" : "text-rose-400";
  const strokeColor = isPositive ? "#10b981" : "#f43f5e"; // Emerald vs Rose
  const chartData = (stock.recentPrices || [])
    .filter(p => typeof p === 'number' && Number.isFinite(p))
    .map((p, i) => ({ price: p, index: i }));
  
  // Unique IDs for SVG gradients to prevent collisions
  const posGradientId = `colorPos-${stock.ticker}`;
  const negGradientId = `colorNeg-${stock.ticker}`;
  const fillColor = isPositive ? `url(#${posGradientId})` : `url(#${negGradientId})`;

  // Dynamic tags (SMC / Institutional Notes)
  const tags = [];
  if (stock.hullBreakout) tags.push({ label: "HULL KIRILIM", color: "text-cyan-300 bg-cyan-900/30 border-cyan-700" });
  if (stock.maCrossover) tags.push({ label: "KESİŞME", color: "text-violet-300 bg-violet-900/30 border-violet-700" });
  if (stock.inSqueeze) tags.push({ label: "SIKIŞMA", color: "text-amber-300 bg-amber-900/30 border-amber-700" });
  if (stock.supertrendUp === false) tags.push({ label: "SUPERTREND ▼", color: "text-rose-300 bg-rose-900/30 border-rose-700" });
  if (stock.supertrendUp === true && !stock.hullBreakout) tags.push({ label: "SUPERTREND ▲", color: "text-emerald-300 bg-emerald-900/30 border-emerald-700" });
  if (stock.rsi && stock.rsi < 35) tags.push({ label: "RSI AŞIRI SATIM", color: "text-blue-300 bg-blue-900/30 border-blue-800" });
  if (stock.rsi && stock.rsi > 65) tags.push({ label: "RSI AŞIRI ALIM", color: "text-orange-300 bg-orange-900/30 border-orange-800" });
  if (stock.adxValue && stock.adxValue > 25) tags.push({ label: `ADX: ${stock.adxValue?.toFixed(0)} GÜÇLÜ`, color: "text-green-300 bg-green-900/30 border-green-700" });
  if (stock.breakout && stock.breakout > 20) tags.push({ label: "DİP BÖLGE", color: "text-purple-300 bg-purple-900/30 border-purple-800" });
  if (stock.volume && stock.volume > 2) tags.push({ label: "HACİM PATLAMASI", color: "text-yellow-300 bg-yellow-900/30 border-yellow-800" });
  if (stock.stochK && stock.stochK < 20) tags.push({ label: "STOCH AŞIRI SATIM", color: "text-sky-300 bg-sky-900/30 border-sky-700" });
  if (stock.cciValue && stock.cciValue < -100) tags.push({ label: "CCI DÜŞÜK", color: "text-indigo-300 bg-indigo-900/30 border-indigo-700" });
  if (stock.momentumPhase) tags.push({ label: `FAZ ${stock.momentumPhase}`, color: stock.momentumPhase === 2 ? "text-yellow-400 bg-yellow-950/40 border-yellow-500/50" : "text-slate-400 bg-slate-800/40 border-slate-700" });
  if ((stock as any).ema21_3d && stock.price > (stock as any).ema21_3d) tags.push({ label: "3D TREND ▲", color: "text-fuchsia-300 bg-fuchsia-900/30 border-fuchsia-700" });
  if ((stock as any).fibTarget3d) tags.push({ label: "FIBO MASTER", color: "text-rose-400 bg-rose-950/40 border-rose-500/50 shadow-[0_0_8px_rgba(251,113,133,0.3)] animate-pulse" });
  if (tags.length === 0) tags.push({ label: "NÖTR PA", color: "text-gray-400 bg-gray-800/30 border-gray-700" });

  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-xl border p-4 transition-all duration-300 backdrop-blur-sm",
        isSelected 
          ? "border-cyan-500/50 bg-slate-800/80 shadow-[0_0_15px_rgba(6,182,212,0.2)]" 
          : "border-slate-700/50 bg-slate-900/40 hover:bg-slate-800/60 hover:border-slate-600"
      )}
    >
      <div className="relative z-10 flex flex-col gap-3">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-xl text-white tracking-tight">{stock.ticker}</h3>
              {getIndexBadge(stock.indexTag)}
            </div>
            <p className="text-xs text-slate-400 truncate max-w-[120px]">{stock.name}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className={clsx("px-2 py-1 text-xs font-bold rounded shadow-sm", signalStyles[stock.signal] || signalStyles.HOLD)}>
              {signalLabels[stock.signal] || "Bekle"}
            </div>
          </div>
        </div>

        {/* Price and Sparkline container */}
        <div className="flex items-end justify-between gap-2 mt-1">
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-white tracking-tight">
              {typeof stock.price === 'number' ? stock.price.toFixed(2) : '—'} ₺
            </span>
            <div className="flex items-center gap-2">
              <span className={clsx("text-sm font-semibold", changeColor)}>
                {isPositive ? "+" : ""}{typeof stock.change24h === 'number' ? stock.change24h.toFixed(2) : '0.00'}%
              </span>
              {typeof stock.priceUsd === 'number' && stock.priceUsd > 0 && (
                <span className="text-xs text-slate-400 font-medium">
                  (${stock.priceUsd.toFixed(2)})
                </span>
              )}
            </div>
          </div>

          {/* Sparkline Chart */}
          <div className="h-12 w-24 flex-shrink-0">
            {mounted && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id={posGradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id={negGradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <YAxis domain={['dataMin', 'dataMax']} hide />
                  <Area 
                    type="monotone" 
                    dataKey="price" 
                    stroke={strokeColor} 
                    strokeWidth={2}
                    fill={fillColor} 
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">No Data</div>
            )}
          </div>
        </div>

        {/* Support & Target Info */}
        {(typeof stock.supportTl === 'number' && typeof stock.targetUsd === 'number') && (
          <div className="flex justify-between items-center text-xs mt-1 border-t border-slate-700/50 pt-2">
            <div className="flex flex-col">
              <span className="text-slate-400">Destek (TL)</span>
              <span className="text-rose-300 font-medium">{stock.supportTl.toFixed(2)} ₺</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-slate-400">Hedef (USD)</span>
              <span className="text-emerald-300 font-medium">${stock.targetUsd.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* AI Verdict from News Sentiment */}
        <div className="mt-2 border-t border-slate-700/50 pt-2">
          <VerdictDisplay ticker={stock.ticker} />
        </div>

        {/* SMC Tags */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {tags.slice(0, 2).map((tag, idx) => (
            <span key={idx} className={clsx("text-[10px] px-2 py-0.5 rounded border font-medium uppercase tracking-wider", tag.color)}>
              {tag.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
