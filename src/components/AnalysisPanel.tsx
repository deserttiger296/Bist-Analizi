"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const ScoreChart = dynamic(() => import("./ScoreChart"), { 
  ssr: false,
  loading: () => <div className="h-[300px] flex items-center justify-center bg-slate-900/50 rounded-xl text-slate-500">Analiz grafiği hazırlanıyor...</div>
});

// ─── Tooltip Descriptions ────────────────────────────────────────────────────
const indicatorInfo: Record<string, string> = {
  "RSI": "Göreceli Güç Endeksi — 70 üzeri aşırı alım, 30 altı aşırı satım bölgesi.",
  "MACD": "Hareketli Ortalama Yakınsama-Uzaklaşma — Trend dönüş sinyali verir.",
  "MACD Sinyal": "MACD sinyal çizgisi — MACD üzerinden kesişim al/sat sinyali.",
  "MACD Histogram": "MACD ile Sinyal arasındaki fark — pozitif ise yükseliş eğilimi.",
  "Stoch %K": "Stochastic %K — 80 üzeri aşırı alım, 20 altı aşırı satım.",
  "Stoch %D": "Stochastic %D — %K'nın düzeltilmiş ortalaması, sinyal hattı.",
  "CCI": "Emtia Kanal Endeksi — 100 üzeri güçlü momentum, -100 altı aşırı satım.",
  "EMA 5": "5 günlük Üstel Hareketli Ortalama — kısa vadeli trend.",
  "EMA 20": "20 günlük Üstel Hareketli Ortalama — uzun vadeli destek/direnç.",
  "SMA 20 Mesafe": "Fiyatın 20-günlük SMA'ya olan uzaklığı (%).",
  "ATR 14": "14 günlük Ortalama Gerçek Aralık — günlük volatilite ölçer.",
  "CMF 20": "Chaikin Para Akışı — pozitif değer alım baskısını gösterir.",
  "OBV": "Denge Hacmi — hacim ile fiyat uyumunu ölçer.",
  "ADX": "Ortalama Yönelim Endeksi — 25 üzeri güçlü trend.",
  "Supertrend": "Volatilite-tabanlı trend takip göstergesi.",
  "Parabolic SAR": "Dur ve Ters Çevir — trend yönü ve stop-loss referansı.",
  "Bollinger Üst": "20 günlük SMA + 2σ — aşırı alım bölgesi (fiyat üstüne çıkarsa dikkat).",
  "Bollinger Alt": "20 günlük SMA - 2σ — aşırı satım bölgesi (fiyat altına düşerse dip fırsatı).",
  "Bollinger Sıkışma": "Bantların daralması — volatilite artışı ve kırılım beklentisi.",
  "VWAP": "Hacim Ağırlıklı Ortalama Fiyat — kurumsal alım/satım referansı.",
  "Ichimoku": "Bulut üstü = güçlü boğa, bulut altı = ayı bölgesi.",
  "Tenkan / Kijun": "Tenkan > Kijun = kısa vadeli yükseliş sinyali.",
  "+DI / -DI": "+DI > -DI = alıcılar baskın, -DI > +DI = satıcılar baskın.",
  "EMA 21 (2D)": "2 günlük periyotta 21 barlık Üstel Hareketli Ortalama — ana trend yönü.",
  "EMA 21 (3D)": "3 günlük periyotta 21 barlık Üstel Hareketli Ortalama — kurumsal trend onayı.",
  "Fibo Hedef (2D)": "2 günlük periyotta 1.618 Fibonacci Genişlemesi — orta vadeli ana hedef.",
  "Fibo Hedef (3D)": "3 günlük periyotta 1.618 Fibonacci Genişlemesi — uzun vadeli kurumsal hedef.",
  "Haftalık EMA26": "Makro Trend Filtresi — Haftalık periyotta 26 haftalık Üstel Hareketli Ortalama.",
  "Haftalık Trend": "Hisse fiyatının haftalık EMA26 seviyesinin üzerinde (Boğa) veya altında (Ayı) olma durumu.",
  "Güven Skoru": "Ağırlıklı konfluans puanı (Kurumsal & Teknik uyum).",
};

function getValueColor(key: string, value: number): string {
  if (key === "RSI") {
    if (value > 70) return "text-red-400";
    if (value < 30) return "text-emerald-400";
    return "text-white";
  }
  if (key === "CCI") {
    if (value > 100) return "text-orange-400";
    if (value < -100) return "text-emerald-400";
    return "text-white";
  }
  if (key === "MACD Histogram") {
    return value > 0 ? "text-emerald-400" : "text-red-400";
  }
  if (key === "Stoch %K") {
    if (value > 80) return "text-red-400";
    if (value < 20) return "text-emerald-400";
    return "text-white";
  }
  if (key === "CMF 20") {
    return value > 0 ? "text-emerald-400" : "text-red-400";
  }
  if (key === "ADX") {
    return value > 25 ? "text-emerald-400" : "text-slate-300";
  }
  return "text-white";
}

function formatVal(val: number | undefined | null, digits = 2): string {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function AnalysisPanel({ stock }: any) {
  const scores = [
    { label: "Trend", value: stock.trendScore || 0, color: "bg-blue-500", max: 100 },
    { label: "Momentum", value: stock.momentumScore || 0, color: "bg-purple-500", max: 100 },
    { label: "Hacim", value: stock.volumeScore || 0, color: "bg-emerald-500", max: 100 },
    { label: "Sinyal", value: stock.score || 0, color: "bg-orange-500", max: 100 },
  ];

  const getSignalLabel = (score: number, isFakeout?: boolean, meetsBuyCriteria?: boolean) => {
    if (isFakeout) {
      return { text: "⚠️ BOĞA TUZAĞI", color: "#f87171", bg: "rgba(248, 113, 113, 0.15)" };
    }
    if (meetsBuyCriteria) {
      return { text: "✅ ONAYLI AL", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)" };
    }
    if (score >= 75) return { text: "GÜÇLÜ AL", color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" };
    if (score >= 60) return { text: "AL", color: "#34d399", bg: "rgba(52, 211, 153, 0.1)" };
    if (score >= 40) return { text: "TUT / İZLE", color: "#fbbf24", bg: "rgba(251, 191, 36, 0.1)" };
    return { text: "ZAYIF / SAT", color: "#f87171", bg: "rgba(248, 113, 113, 0.1)" };
  };

  const signal = getSignalLabel(stock.score || 0, stock.isFakeout, stock.meetsBuyCriteria);

  // Build indicator rows for the table
  const indicatorRows: { label: string; value: string; colorClass: string }[] = [
    { label: "RSI", value: formatVal(stock.rsi, 1), colorClass: getValueColor("RSI", stock.rsi) },
    { label: "MACD", value: formatVal(stock.macd, 3), colorClass: "text-white" },
    { label: "MACD Sinyal", value: formatVal(stock.macdSignal, 3), colorClass: "text-white" },
    { label: "MACD Histogram", value: formatVal(stock.macdHistogram, 3), colorClass: getValueColor("MACD Histogram", stock.macdHistogram || 0) },
    { label: "Stoch %K", value: formatVal(stock.stochK, 1), colorClass: getValueColor("Stoch %K", stock.stochK || 0) },
    { label: "Stoch %D", value: formatVal(stock.stochD, 1), colorClass: "text-white" },
    { label: "CCI", value: formatVal(stock.cci, 1), colorClass: getValueColor("CCI", stock.cci || 0) },
    { label: "EMA 5", value: formatVal(stock.ema5), colorClass: "text-white" },
    { label: "EMA 20", value: formatVal(stock.ema20), colorClass: "text-white" },
    { label: "SMA 20 Mesafe", value: `${formatVal(stock.sma20Distance, 1)}%`, colorClass: "text-white" },
    { label: "ATR 14", value: formatVal(stock.atr14), colorClass: "text-white" },
    { label: "CMF 20", value: formatVal(stock.cmf20, 4), colorClass: getValueColor("CMF 20", stock.cmf20 || 0) },
    { label: "ADX", value: formatVal(stock.adxValue, 1), colorClass: getValueColor("ADX", stock.adxValue || 0) },
    { label: "Supertrend", value: stock.supertrendUp ? "▲ Yükseliş" : "▼ Düşüş", colorClass: stock.supertrendUp ? "text-emerald-400" : "text-red-400" },
    { label: "Parabolic SAR", value: stock.sarBullish ? "Boğa" : "Ayı", colorClass: stock.sarBullish ? "text-emerald-400" : "text-red-400" },
    // Bollinger Bands
    { label: "Bollinger Üst", value: formatVal(stock.bollUpper), colorClass: "text-white" },
    { label: "Bollinger Alt", value: formatVal(stock.bollLower), colorClass: "text-white" },
    { label: "Bollinger Sıkışma", value: stock.inSqueeze ? "⚠ Sıkışma" : "Normal", colorClass: stock.inSqueeze ? "text-orange-400" : "text-slate-300" },
    // VWAP
    { label: "VWAP", value: formatVal(stock.vwapValue), colorClass: (stock.price || stock.lastClose) > (stock.vwapValue || 0) ? "text-emerald-400" : "text-red-400" },
    // Ichimoku
    { label: "Ichimoku", value: stock.ichimokuBullish ? "Bulut Üstü (Boğa)" : "Bulut İçi/Altı", colorClass: stock.ichimokuBullish ? "text-emerald-400" : "text-red-400" },
    { label: "Tenkan / Kijun", value: `${formatVal(stock.ichimokuTenkan)} / ${formatVal(stock.ichimokuKijun)}`, colorClass: (stock.ichimokuTenkan || 0) > (stock.ichimokuKijun || 0) ? "text-emerald-400" : "text-red-400" },
    // ADX DI
    { label: "+DI / -DI", value: `${formatVal(stock.adxPlus, 1)} / ${formatVal(stock.adxMinus, 1)}`, colorClass: (stock.adxPlus || 0) > (stock.adxMinus || 0) ? "text-emerald-400" : "text-red-400" },
    // Multi-timeframe
    { label: "EMA 21 (2D)", value: formatVal(stock.ema21_2d), colorClass: (stock.price || stock.lastClose) > (stock.ema21_2d || 0) ? "text-emerald-400 font-bold" : "text-red-400 font-bold" },
    { label: "EMA 21 (3D)", value: formatVal(stock.ema21_3d), colorClass: (stock.price || stock.lastClose) > (stock.ema21_3d || 0) ? "text-fuchsia-400 font-bold" : "text-red-400 font-bold" },
    { label: "Fibo Hedef (2D)", value: formatVal(stock.fibTarget2d), colorClass: "text-emerald-300 font-bold" },
    { label: "Fibo Hedef (3D)", value: formatVal(stock.fibTarget3d), colorClass: "text-fuchsia-300 font-bold" },
    // Weekly EMA26
    { label: "Haftalık EMA26", value: formatVal(stock.weeklyEma26), colorClass: "text-white" },
    { label: "Haftalık Trend", value: stock.isWeeklyEma26Bullish ? "Boğa (EMA26 Üstü) ↗️" : "Ayı (EMA26 Altı) ↘️", colorClass: stock.isWeeklyEma26Bullish ? "text-emerald-400 font-bold" : "text-rose-400 font-bold" },
    // Confidence
    { label: "Güven Skoru", value: `${stock.confidence || stock.score || 0}%`, colorClass: (stock.confidence || stock.score || 0) >= 65 ? "text-emerald-400" : (stock.confidence || stock.score || 0) >= 45 ? "text-orange-400" : "text-red-400" },
  ];

  return (
    <div className="space-y-6">
      {/* Premium Header Card */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="mb-2 text-xs font-bold uppercase tracking-widest text-cyan-400">Canlı Analiz Raporu</div>
          <h2 className="text-4xl font-black text-white">{stock.ticker}</h2>
          <p className="text-sm text-slate-400">{stock.name}</p>
          
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-5xl font-black text-white">{stock.price?.toFixed(2)}</span>
            <span className="text-xl font-bold text-slate-500">₺</span>
          </div>

          <div 
            className="mt-6 rounded-2xl px-6 py-2 text-sm font-black tracking-tighter"
            style={{ backgroundColor: signal.bg, color: signal.color, border: `1px solid ${signal.color}33` }}
          >
            {signal.text} ( {stock.score}% )
          </div>

          {stock.fibTarget3d && (
            <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-fuchsia-400 uppercase tracking-widest bg-fuchsia-500/10 px-3 py-1 rounded-full border border-fuchsia-500/20">
              <span className="animate-pulse">💎</span> Master Fibo Hedefi: {formatVal(stock.fibTarget3d)} ₺
            </div>
          )}
        </div>
        {/* Decorative elements */}
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/5 blur-[100px]" />
        <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-purple-500/5 blur-[100px]" />
      </div>

      {/* Warning / Approved Callout Boxes */}
      {stock.isFakeout && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 shadow-lg shadow-rose-500/5 animate-pulse">
          <h4 className="text-rose-400 font-black text-base flex items-center gap-2">
            ⚠️ UYARI: BOĞA TUZAĞI (SAHTE YÜKSELİŞ) TESPİT EDİLDİ!
          </h4>
          <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
            Bu hisse senedi ani bir yükseliş göstermiş veya teknik puan kazanmış olsa da, sistemimiz tarafından <strong>Sahte Yükseliş / Tuzak</strong> olarak işaretlenmiştir. Yeni pozisyon açılması yüksek risk barındırabilir.
          </p>
          <div className="mt-3 space-y-1.5 border-t border-rose-500/20 pt-3">
            <span className="text-[10px] font-bold text-rose-300 uppercase tracking-wider">Tuzak Tespit Kriterleri:</span>
            <ul className="list-disc pl-4 space-y-1 text-slate-300 text-xs">
              {stock.fakeoutReasons?.map((reason: string, idx: number) => (
                <li key={idx} className="font-bold text-rose-400">{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {stock.meetsBuyCriteria && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 shadow-lg shadow-emerald-500/5">
          <h4 className="text-emerald-400 font-black text-base flex items-center gap-2">
            ✅ ONAYLI ALIM SİNYALİ!
          </h4>
          <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
            Bu hisse senedi, sistemin en katı filtrelerini başarıyla geçmiştir. <strong>Trend, Momentum ve Hacim/Para Akışı</strong> gruplarının her birinde ayrı ayrı <strong>%60</strong>&apos;ın üzerinde onay almış ve haftalık <strong>EMA26</strong> seviyesinin üzerinde macro boğa trendindedir. Herhangi bir sahte yükseliş tuzağı bulunmamaktadır.
          </p>
        </div>
      )}

      {/* Score Matrix */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-cyan-400">Skor Matrisi</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { range: "75–100", label: "GÜÇLÜ AL", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" },
            { range: "60–74", label: "AL", color: "bg-green-500/20 text-green-400 border-green-500/40" },
            { range: "40–59", label: "TUT / İZLE", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40" },
            { range: "0–39", label: "ZAYIF / SAT", color: "bg-red-500/20 text-red-400 border-red-500/40" },
          ].map((tier) => (
            <div
              key={tier.range}
              className={`rounded-xl border p-3 text-center text-xs font-bold ${tier.color} ${
                (stock.score || 0) >= parseInt(tier.range) && (stock.score || 0) <= parseInt(tier.range.split("–")[1])
                  ? "ring-2 ring-white/30 scale-105"
                  : "opacity-50"
              } transition-all`}
            >
              <div className="text-lg">{tier.label}</div>
              <div className="mt-1 text-[10px] opacity-70">{tier.range} puan</div>
            </div>
          ))}
        </div>
      </div>

      {/* Metrics + Chart side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Score Bars */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="mb-4 text-sm font-bold text-slate-400">Alt Skorlar</h3>
          <div className="space-y-4">
            {scores.map((s) => (
              <div key={s.label}>
                <div className="mb-1 flex justify-between text-xs font-bold">
                  <span className="text-slate-500">{s.label}</span>
                  <span className="text-slate-300">{s.value} / {s.max}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800">
                  <div 
                    className={`h-1.5 rounded-full ${s.color} transition-all duration-1000`} 
                    style={{ width: `${(s.value / s.max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Score Chart */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="mb-4 text-sm font-bold text-slate-400">Grafiksel Görünüm</h3>
          <ScoreChart stock={stock} />
        </div>
      </div>

      {/* Dynamic Indicator Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-cyan-400">Teknik İndikatör Tablosu</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">İndikatör</th>
                <th className="py-2 px-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">Değer</th>
                <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500 hidden md:table-cell">Açıklama</th>
              </tr>
            </thead>
            <tbody>
              {indicatorRows.map((row, i) => (
                <tr
                  key={row.label}
                  className={`border-b border-slate-800/50 transition-colors hover:bg-slate-800/40 ${i % 2 === 0 ? "bg-slate-950/30" : ""}`}
                >
                  <td className="py-2.5 px-3 font-semibold text-slate-200">{row.label}</td>
                  <td className={`py-2.5 px-3 text-right font-mono font-bold ${row.colorClass}`}>{row.value}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-500 hidden md:table-cell">{indicatorInfo[row.label] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex justify-end pt-4">
        <Link 
          href={`/analysis/${stock.ticker}`} 
          className="group flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 px-8 py-4 text-sm font-black text-white shadow-lg transition-all hover:scale-105 hover:shadow-cyan-500/20 active:scale-95"
        >
          DETAYLI TEKNİK ANALİZ RAPORU
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>
    </div>
  );
}
