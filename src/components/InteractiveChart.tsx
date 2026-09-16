"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Label,
} from "recharts";

interface ChartDataPoint {
  date: string;
  price: number | null;
  rsi: number | null;
  tsi: number | null;
  sma20: number | null;
}

export default function InteractiveChart({ symbol }: { symbol: string }) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showPrice, setShowPrice] = useState(true);
  const [showSma, setShowSma] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showTsi, setShowTsi] = useState(false);
  const [fibTargets, setFibTargets] = useState<{ t2d: number | null, t3d: number | null }>({ t2d: null, t3d: null });
  const [showFibo, setShowFibo] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/bist/${symbol}/chart`);
        if (!res.ok) throw new Error("Failed to fetch chart data");
        const json = await res.json();
        setData(json.data?.chartData || []);
        setFibTargets({
          t2d: json.data?.fibTarget2d || null,
          t3d: json.data?.fibTarget3d || null
        });
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border border-slate-700/50 bg-slate-900/50">
        <p className="text-slate-400">Grafik yükleniyor...</p>
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border border-rose-900/30 bg-slate-900/50">
        <p className="text-rose-400">Veri alınamadı: {error || "Boş veri"}</p>
      </div>
    );
  }

  // Find min and max for price axis to make it dynamic
  const prices = data.map((d) => d.price).filter((p) => p !== null) as number[];
  const minPrice = prices.length ? Math.min(...prices) * 0.95 : 'auto';
  const maxPrice = prices.length ? Math.max(...prices) * 1.05 : 'auto';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <button
          onClick={() => setShowPrice(!showPrice)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            showPrice ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50" : "bg-slate-800 text-slate-500 border-slate-700"
          }`}
        >
          Fiyat
        </button>
        <button
          onClick={() => setShowSma(!showSma)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            showSma ? "bg-orange-500/20 text-orange-300 border-orange-500/50" : "bg-slate-800 text-slate-500 border-slate-700"
          }`}
        >
          SMA20
        </button>
        <button
          onClick={() => setShowRsi(!showRsi)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            showRsi ? "bg-purple-500/20 text-purple-300 border-purple-500/50" : "bg-slate-800 text-slate-500 border-slate-700"
          }`}
        >
          RSI (14)
        </button>
        <button
          onClick={() => setShowTsi(!showTsi)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            showTsi ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" : "bg-slate-800 text-slate-500 border-slate-700"
          }`}
        >
          TSI (Lineer)
        </button>
        <button
          onClick={() => setShowFibo(!showFibo)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            showFibo ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50" : "bg-slate-800 text-slate-500 border-slate-700"
          }`}
        >
          FIBO HEDEFLER
        </button>
      </div>

      <div className="h-80 w-full rounded-xl bg-slate-900/50 p-2 print:h-96 print:bg-white print:border print:border-gray-300">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickMargin={10} />
            
            {/* Primary Axis for Price and SMA */}
            <YAxis 
              yAxisId="left" 
              domain={[minPrice, maxPrice]} 
              stroke="#94a3b8" 
              fontSize={10}
              tickFormatter={(val) => val.toFixed(1)}
            />
            
            {/* Secondary Axis for Oscillators (RSI, TSI) */}
            {(showRsi || showTsi) && (
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                domain={[-100, 100]} 
                stroke="#94a3b8" 
                fontSize={10} 
              />
            )}
            
            <Tooltip
              contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc", borderRadius: "8px", fontSize: "12px" }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} className="print:text-slate-900" />

            {showPrice && (
              <Line yAxisId="left" type="monotone" dataKey="price" name="Fiyat" stroke="#06b6d4" strokeWidth={2} dot={false} />
            )}
            {showSma && (
              <Line yAxisId="left" type="monotone" dataKey="sma20" name="SMA20" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
            )}
            {showRsi && (
              <Line yAxisId="right" type="monotone" dataKey="rsi" name="RSI" stroke="#a855f7" strokeWidth={1.5} dot={false} />
            )}
            {showTsi && (
              <Line yAxisId="right" type="monotone" dataKey="tsi" name="TSI" stroke="#10b981" strokeWidth={1.5} dot={false} />
            )}
            {showFibo && fibTargets.t2d && (
              <ReferenceLine yAxisId="left" y={fibTargets.t2d} stroke="#10b981" strokeDasharray="3 3">
                <Label value="FIBO 2D" position="right" fill="#10b981" fontSize={10} fontWeight="bold" />
              </ReferenceLine>
            )}
            {showFibo && fibTargets.t3d && (
              <ReferenceLine yAxisId="left" y={fibTargets.t3d} stroke="#d946ef" strokeDasharray="3 3">
                <Label value="MASTER 3D" position="right" fill="#d946ef" fontSize={10} fontWeight="bold" />
              </ReferenceLine>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
