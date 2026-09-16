"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatTR } from "@/lib/format";

// Mock sector mapping for top BIST stocks
const SECTOR_MAP: Record<string, string[]> = {
  "Bankacılık": ["AKBNK", "GARAN", "ISCTR", "YKBNK", "VAKBN", "HALKB"],
  "Holding & Yatırım": ["KCHOL", "SAHOL", "DOHOL", "ALARK", "TKFEN"],
  "Ulaştırma": ["THYAO", "PGSUS", "DOAS", "TAVHL"],
  "Sanayi & Üretim": ["EREGL", "KRDMD", "TUPRS", "PETKM", "SASA", "HEKTS", "FROTO", "TOASO", "ARCLK", "VESBE"],
  "Perakende": ["BIMAS", "MGROS", "SOKM", "CCOLA", "AEFES"],
  "Enerji": ["ENKAI", "ASTOR", "GESAN", "SMRTG", "EUPWR", "GWIND"],
  "Telekom & Teknoloji": ["TCELL", "TTKOM", "ASELS", "MIATK", "KONT"],
};

interface HeatmapNode {
  symbol: string;
  change: number;
  lastClose: number;
  score: number;
}

interface SectorData {
  sector: string;
  nodes: HeatmapNode[];
  avgChange: number;
}

export default function MarketHeatmap() {
  const [data, setData] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const allSymbols = Object.values(SECTOR_MAP).flat();
        const params = new URLSearchParams({ symbols: allSymbols.join(",") });
        const res = await fetch(`/api/bist/scan?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch");
        
        const json = await res.json();
        const results = json.results || [];
        
        const quoteMap = new Map<string, any>();
        results.forEach((r: any) => quoteMap.set(r.symbol, r.quote));

        const sectorList: SectorData[] = [];

        for (const [sector, symbols] of Object.entries(SECTOR_MAP)) {
          const nodes: HeatmapNode[] = [];
          let sumChange = 0;
          let count = 0;

          for (const sym of symbols) {
            const q = quoteMap.get(sym);
            if (q) {
              nodes.push({
                symbol: sym,
                change: q.change,
                lastClose: q.lastClose,
                score: q.score,
              });
              sumChange += q.change;
              count++;
            }
          }

          if (nodes.length > 0) {
            // Sort nodes by absolute change for visual weight (simulated market cap weighting)
            nodes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
            sectorList.push({
              sector,
              nodes,
              avgChange: sumChange / count,
            });
          }
        }

        setData(sectorList);
      } catch (err) {
        console.error("Heatmap load error", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const getColorClass = (change: number) => {
    if (change >= 3) return "bg-emerald-600";
    if (change > 0) return "bg-emerald-500/80";
    if (change === 0) return "bg-slate-700";
    if (change <= -3) return "bg-rose-700";
    return "bg-rose-500/80";
  };

  if (loading) {
    return <div className="h-64 flex items-center justify-center bg-slate-900/50 rounded-2xl animate-pulse text-slate-500">Isı haritası yükleniyor...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          🔥 Sektörel Isı Haritası
        </h2>
        <span className="text-xs text-slate-500">BIST 30 Ağırlıklı</span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.map((sec) => (
          <div key={sec.sector} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 overflow-hidden">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{sec.sector}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${sec.avgChange >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"}`}>
                {sec.avgChange > 0 ? "+" : ""}{sec.avgChange.toFixed(2)}%
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {sec.nodes.map((node) => (
                <Link 
                  href={`/analysis/${node.symbol}`} 
                  key={node.symbol}
                  className={`group relative flex flex-col items-center justify-center p-3 rounded-lg transition-transform hover:scale-105 ${getColorClass(node.change)}`}
                >
                  <span className="font-bold text-white text-sm">{node.symbol}</span>
                  <span className="text-[10px] font-semibold text-white/80">{node.change > 0 ? "+" : ""}{formatTR(node.change)}%</span>
                  
                  {/* Tooltip */}
                  <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity -top-10 bg-slate-950 border border-slate-700 text-white text-[10px] px-2 py-1 rounded shadow-xl whitespace-nowrap z-10 pointer-events-none">
                    Fiyat: {formatTR(node.lastClose)} ₺ | AI Skor: {node.score}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
