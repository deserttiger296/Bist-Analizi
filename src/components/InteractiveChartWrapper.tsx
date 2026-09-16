"use client";

import dynamic from "next/dynamic";

const LightweightChartWidget = dynamic(
  () => import("./LightweightChartWidget").then(mod => mod.LightweightChartWidget),
  { 
    ssr: false, 
    loading: () => (
      <div className="flex flex-col h-[600px] w-full items-center justify-center rounded-2xl bg-[#0b0f19] border border-slate-800/80">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent shadow-[0_0_15px_rgba(6,182,212,0.3)]" />
        <p className="text-xs font-semibold text-slate-400 mt-4 uppercase tracking-widest animate-pulse">Grafik Motoru Yükleniyor...</p>
      </div>
    )
  }
);

export default function InteractiveChartWrapper({ symbol }: { symbol: string }) {
  return (
    <div className="w-full">
      <LightweightChartWidget symbol={symbol} height={600} />
    </div>
  );
}
