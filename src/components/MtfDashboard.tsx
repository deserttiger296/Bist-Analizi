"use client";

interface MtfDashboardProps {
  stock: {
    ticker: string;
    rsi?: number;
    adxValue?: number;
    supertrendUp?: boolean;
    sarBullish?: boolean;
    hullBreakout?: boolean;
    maCrossover?: boolean;
    inSqueeze?: boolean;
    squeezeMom?: number;
    stochK?: number;
    stochD?: number;
    cciValue?: number;
    williamsR?: number;
    rocValue?: number;
    atr?: number;
    timeframes?: { timeframe: string; rsi: number; macd: number; macdSignal: number; trend: string; tsi: number; signal: number }[];
  };
}

function Cell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</span>
      <span className={`text-xs font-bold px-2 py-1 rounded min-w-[52px] text-center ${color}`}>{value}</span>
    </div>
  );
}

function Gauge({ label, value, min, max, unit = "", reverseColor = false }: {
  label: string; value: number; min: number; max: number; unit?: string; reverseColor?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const isPositive = reverseColor ? pct < 50 : pct > 50;
  const barColor = isPositive ? "bg-emerald-500" : "bg-rose-500";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={`font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>{value.toFixed(1)}{unit}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-800">
        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BoolCell({ label, active, trueLabel, falseLabel }: { label: string; active?: boolean; trueLabel?: string; falseLabel?: string }) {
  return (
    <Cell
      label={label}
      value={active ? (trueLabel || "✓ EVET") : (falseLabel || "— HAYIR")}
      color={active ? "bg-emerald-600/30 text-emerald-300 border border-emerald-700/50" : "bg-rose-900/20 text-rose-400 border border-rose-800/30"}
    />
  );
}

export default function MtfDashboard({ stock }: MtfDashboardProps) {
  const adxStrength = (stock.adxValue ?? 0) > 40 ? "ÇOK GÜÇLÜ" : (stock.adxValue ?? 0) > 25 ? "GÜÇLÜ" : "ZAYIF";
  const adxColor = (stock.adxValue ?? 0) > 25 ? "bg-green-600/30 text-green-300 border border-green-700/50" : "bg-gray-700/30 text-gray-400 border border-gray-700";
  const rsiZone = (stock.rsi ?? 50) > 70 ? "AŞIRI ALIM" : (stock.rsi ?? 50) < 30 ? "AŞIRI SATIM" : "NORMAL";
  const rsiColor = (stock.rsi ?? 50) > 70 ? "bg-orange-600/30 text-orange-300 border border-orange-700/50" : (stock.rsi ?? 50) < 30 ? "bg-blue-600/30 text-blue-300 border border-blue-700/50" : "bg-slate-700/30 text-slate-300 border border-slate-600";

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-5 space-y-5">
      <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
        <span className="text-cyan-400">⬡</span> Çoklu Gösterge Paneli (MTF)
      </h3>

      {/* Trend & Structure Row */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">Trend & Yapı</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          <BoolCell label="Supertrend" active={stock.supertrendUp} trueLabel="▲ YÜKSELİŞ" falseLabel="▼ DÜŞÜŞ" />
          <BoolCell label="Par. SAR" active={stock.sarBullish} trueLabel="▲ YÜKSELİŞ" falseLabel="▼ DÜŞÜŞ" />
          <BoolCell label="Hull Kırılım" active={stock.hullBreakout} />
          <BoolCell label="MA Kesişme" active={stock.maCrossover} />
          <BoolCell label="Sıkışma" active={stock.inSqueeze} trueLabel="● SIKIŞIYOR" falseLabel="○ SERBEST" />
          <BoolCell label="Sq. Mom." active={(stock.squeezeMom ?? 0) > 0} trueLabel="▲ POZİTİF" falseLabel="▼ NEGATİF" />
          <Cell label="ADX Gücü" value={adxStrength} color={adxColor} />
          <Cell label="RSI Bölge" value={rsiZone} color={rsiColor} />
        </div>
      </div>

      {/* Gauges Row */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">Momentum Ölçerleri</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <Gauge label="RSI (14)" value={stock.rsi ?? 50} min={0} max={100} />
          <Gauge label="Stoch %K" value={stock.stochK ?? 50} min={0} max={100} />
          <Gauge label="CCI (20)" value={Math.max(-200, Math.min(200, stock.cciValue ?? 0))} min={-200} max={200} />
          <Gauge label="Williams %R" value={stock.williamsR ?? -50} min={-100} max={0} reverseColor />
          <Gauge label="ROC (12)" value={Math.max(-10, Math.min(10, stock.rocValue ?? 0))} min={-10} max={10} unit="%" />
          <Gauge label="ADX (14)" value={stock.adxValue ?? 0} min={0} max={60} />
        </div>
      </div>

      {/* Timeframe Matrix — resmindeki alt panel */}
      {stock.timeframes && stock.timeframes.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">Zaman Dilimi Matrisi (TSI & Trend)</p>
          <div className="grid grid-cols-3 gap-2">
            {stock.timeframes.map((tf) => {
              const bullish = tf.trend === "BULLISH";
              const bearish = tf.trend === "BEARISH";
              const bg = bullish ? "bg-emerald-600" : bearish ? "bg-rose-600" : "bg-slate-600";
              return (
                <div key={tf.timeframe} className={`${bg}/20 border ${bullish ? "border-emerald-700" : bearish ? "border-rose-700" : "border-slate-700"} rounded-lg p-3 space-y-2`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-white">{tf.timeframe}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${bullish ? "bg-emerald-600 text-white" : bearish ? "bg-rose-600 text-white" : "bg-slate-600 text-gray-300"}`}>
                      {bullish ? "▲" : bearish ? "▼" : "—"}
                    </span>
                  </div>
                  <div className="space-y-1 text-[10px] text-gray-400">
                    <div className="flex justify-between"><span>TSI</span><span className={tf.tsi > tf.signal ? "text-emerald-400" : "text-rose-400"}>{tf.tsi?.toFixed(1)}</span></div>
                    <div className="flex justify-between"><span>RSI</span><span className={tf.rsi > 50 ? "text-emerald-400" : "text-rose-400"}>{tf.rsi?.toFixed(1)}</span></div>
                    <div className="flex justify-between"><span>MACD</span><span className={tf.macd > tf.macdSignal ? "text-emerald-400" : "text-rose-400"}>{tf.macd?.toFixed(2)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
