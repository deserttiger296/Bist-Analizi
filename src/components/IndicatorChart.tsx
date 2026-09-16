"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

interface ChartDataPoint {
  date: string;
  price: number;
  sma20?: number | null;
  rsi?: number | null;
  tsi?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHist?: number | null;
  stochK?: number | null;
  stochD?: number | null;
  cci?: number | null;
}

interface IndicatorChartProps {
  data: ChartDataPoint[];
  type: "macd" | "stochastic" | "cci";
}

const chartConfig = {
  macd: {
    title: "MACD (12, 26, 9)",
    lines: [
      { key: "macd", name: "MACD", color: "#06b6d4" },
      { key: "macdSignal", name: "Sinyal", color: "#f97316" },
    ],
    bar: { key: "macdHist", name: "Histogram", posColor: "#10b981", negColor: "#ef4444" },
    refLines: [],
  },
  stochastic: {
    title: "Stochastic (%K / %D)",
    lines: [
      { key: "stochK", name: "%K", color: "#8b5cf6" },
      { key: "stochD", name: "%D", color: "#f59e0b" },
    ],
    bar: null,
    refLines: [
      { y: 80, label: "Aşırı Alım", color: "#ef4444" },
      { y: 20, label: "Aşırı Satım", color: "#10b981" },
    ],
  },
  cci: {
    title: "CCI (20)",
    lines: [
      { key: "cci", name: "CCI", color: "#ec4899" },
    ],
    bar: null,
    refLines: [
      { y: 100, label: "Güçlü Yükseliş", color: "#f97316" },
      { y: -100, label: "Güçlü Düşüş", color: "#10b981" },
      { y: 0, label: "", color: "#475569" },
    ],
  },
};

export default function IndicatorChart({ data, type }: IndicatorChartProps) {
  const config = chartConfig[type];
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl bg-slate-900/50 text-sm text-slate-500">
        Grafik verisi yükleniyor...
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">{config.title}</p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#334155" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#334155" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "12px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#94a3b8" }}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
          />

          {config.refLines.map((rl, i) => (
            <ReferenceLine
              key={i}
              y={rl.y}
              stroke={rl.color}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: rl.label, fill: rl.color, fontSize: 9, position: "insideTopRight" }}
            />
          ))}

          {config.bar && (
            <Bar
              dataKey={config.bar.key}
              name={config.bar.name}
              fill="#10b981"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          )}

          {config.lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
