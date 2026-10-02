"use client";

import dynamic from "next/dynamic";
import type { Pu30Bar, Pu30SymbolDetailSignal } from "@/lib/rsiPu30Engine";

// lightweight-charts touches the canvas/DOM directly and has no meaningful
// server-rendered output, so it needs ssr:false -- which next/dynamic only
// allows inside a Client Component. The [symbol] page itself is a Server
// Component (it awaits data directly), so that ssr:false call has to live
// in this tiny wrapper rather than in the page.
const RsiPu30Chart = dynamic(() => import("@/components/RsiPu30Chart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] w-full items-center justify-center rounded-2xl bg-[#0b0f19] border border-slate-800/80">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
    </div>
  ),
});

export default function RsiPu30ChartLoader({ bars, signal }: { bars: Pu30Bar[]; signal: Pu30SymbolDetailSignal | null }) {
  return <RsiPu30Chart bars={bars} signal={signal} />;
}
