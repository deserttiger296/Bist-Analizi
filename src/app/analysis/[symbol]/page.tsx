export const dynamic = 'force-dynamic';

import Link from "next/link";
import InteractiveChartWrapper from "@/components/InteractiveChartWrapper";
import PrintButton from "@/components/PrintButton";
import Portfolio from "@/components/Portfolio";
import { fetchBistLiveQuote, evaluateRiseSignal } from "@/lib/bist";
import { fetchNewsForSymbol } from "@/lib/news";
import BrokerConsensusPanel from "@/components/BrokerConsensusPanel";
import AkdFlowPanel from "@/components/AkdFlowPanel";
import { fetchConsensusTargetPrice } from "@/lib/scrapers/hedeffiyatScraper";
import { fetchAkdData } from "@/lib/akd";

// Helper for UI formatting
function formatTR(val: number | null | undefined, digits = 2): string {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const signalLabel: Record<string, string> = {
  STRONG_BUY: "Güçlü Al",
  BUY: "Al",
  HOLD: "Bekle",
  SELL: "Sat",
  STRONG_SELL: "Güçlü Sat",
  WATCH: "Gözlemle",
  TUZAK: "BOĞA TUZAĞI ⚠️",
};

const signalClass: Record<string, string> = {
  STRONG_BUY: "bg-emerald-500 text-slate-950",
  BUY: "bg-sky-500 text-slate-950",
  HOLD: "bg-amber-500 text-slate-950",
  SELL: "bg-rose-500 text-slate-950",
  STRONG_SELL: "bg-red-600 text-white",
  WATCH: "bg-gray-600 text-white",
  TUZAK: "bg-rose-950 text-rose-400 border border-rose-500/30 animate-pulse",
};

const indicatorDescriptions: Record<string, string> = {
  "RSI": "Göreceli Güç Endeksi — 70 üzeri aşırı alım, 30 altı aşırı satım.",
  "MACD": "Trend dönüş sinyali — sinyal üstü kesişim al sinyali.",
  "MACD Histogram": "Pozitif = yükseliş ivmesi, negatif = düşüş baskısı.",
  "Stochastic %K": "80 üzeri aşırı alım, 20 altı aşırı satım bölgesi.",
  "CCI": "100 üzeri güçlü momentum, -100 altı aşırı satım.",
  "EMA 5 / EMA 20": "Kısa ve uzun vadeli trend karşılaştırması.",
  "CMF 20": "Chaikin Para Akışı — pozitif ise alım baskısı.",
  "ADX": "Trend gücü — 25 üzeri güçlü trend mevcut.",
  "Supertrend": "Volatilite tabanlı trend takip göstergesi.",
  "SAR": "Parabolic SAR — trend yönü ve stop-loss referansı.",
  "Bollinger Üst / Alt": "20 günlük SMA ± 2σ bant sınırları.",
  "Bollinger Sıkışma": "Bantların daralması — kırılım beklentisi.",
  "VWAP": "Hacim Ağırlıklı Ort. Fiyat — kurumsal referans.",
  "Ichimoku": "Bulut üstü = boğa, altı = ayı.",
  "Tenkan / Kijun": "Tenkan > Kijun = kısa vadeli yükseliş.",
  "+DI / -DI": "Yönsel güç: +DI > -DI = alıcı baskın.",
  "EMA 21 (2D)": "2 günlük periyotta trend yönü.",
  "Fib 0.382 (2D)": "2 günlük periyotta Fibonacci 0.382 düzeltme seviyesi.",
  "Fib 0.500 (2D)": "2 günlük periyotta Fibonacci 0.500 orta nokta seviyesi.",
  "Fib 0.618 (2D)": "2 günlük periyotta Altın Oran destek/direnç seviyesi.",
  "Fib 0.382 (3D)": "3 günlük periyotta Fibonacci 0.382 düzeltme seviyesi.",
  "Fib 0.500 (3D)": "3 günlük periyotta Fibonacci 0.500 orta nokta seviyesi.",
  "Fib 0.618 (3D)": "3 günlük periyotta Altın Oran destek/direnç seviyesi.",
  "Haftalık EMA26": "Haftalık periyotta 26 haftalık Üstel Hareketli Ortalama değeri.",
  "Haftalık Trend": "Haftalık periyotta EMA26 ortalamasının üzerinde (Boğa) veya altında (Ayı) olma durumu.",
  "RSI Uyumsuzluk": "Fiyat ve RSI göstergesi arasındaki uyuşmazlık (reversal sinyali).",
  "MACD Uyumsuzluk": "Fiyat ve MACD göstergesi arasındaki uyuşmazlık (reversal sinyali).",
  "R/R Oranı": "Risk Ödül Oranı — potansiyel kazancın riske edilen tutara oranı.",
  "Güven Skoru": "Ağırlıklı confluans puanı (Kurumsal & Teknik uyum).",
};

export default async function StockReportPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  
  const quote = await fetchBistLiveQuote(symbol);
  
  // Fetch symbol specific news
  const symbolNews = await fetchNewsForSymbol(symbol);

  // Fetch Phase 2 Fundamental Consensus and AKD Flows
  const [consensus, akdFlow] = await Promise.all([
    fetchConsensusTargetPrice(symbol).catch(() => null),
    fetchAkdData(symbol).catch(() => null),
  ]);
  
  // Get evaluation reasons
  const evaluation = evaluateRiseSignal(quote, {
    minScore: 50, maxRsi: 80, minSma20Distance: 0, minVolumeMultiple: 1, minPasses: 0, requireHigherHighs: false, requireHigherLows: false
  });

  let signal = "HOLD";
  if (evaluation.status === "TUZAK") signal = "TUZAK";
  else if (evaluation.status === "AL") signal = "STRONG_BUY";
  else if (evaluation.status === "POTANSİYEL") signal = "BUY";
  else if (evaluation.status === "İZLE") signal = "HOLD";
  else if (evaluation.status === "ZAYIF") signal = "SELL";
  
  // Indicator table data
  const indicators = [
    { label: "RSI", value: formatTR(quote.rsi, 1), status: quote.rsi > 70 ? "danger" : quote.rsi < 30 ? "success" : "neutral" },
    { label: "MACD", value: formatTR(quote.macd, 3), status: (quote.macd ?? 0) > (quote.macdSignal ?? 0) ? "success" : "danger" },
    { label: "MACD Histogram", value: formatTR(quote.macdHistogram, 3), status: (quote.macdHistogram ?? 0) > 0 ? "success" : "danger" },
    { label: "Stochastic %K", value: formatTR(quote.stochK, 1), status: (quote.stochK ?? 0) > 80 ? "danger" : (quote.stochK ?? 0) < 20 ? "success" : "neutral" },
    { label: "CCI", value: formatTR(quote.cci, 1), status: (quote.cci ?? 0) > 100 ? "warning" : (quote.cci ?? 0) < -100 ? "success" : "neutral" },
    { label: "EMA 5 / EMA 20", value: `${formatTR(quote.ema5)} / ${formatTR(quote.ema20)}`, status: quote.ema5 > quote.ema20 ? "success" : "danger" },
    { label: "CMF 20", value: formatTR(quote.cmf20, 4), status: quote.cmf20 > 0 ? "success" : "danger" },
    { label: "ADX", value: formatTR(quote.adxValue, 1), status: quote.adxValue > 25 ? "success" : "neutral" },
    { label: "Supertrend", value: quote.supertrendUp ? "▲ Yükseliş" : "▼ Düşüş", status: quote.supertrendUp ? "success" : "danger" },
    { label: "SAR", value: quote.sarBullish ? "Boğa" : "Ayı", status: quote.sarBullish ? "success" : "danger" },
    // New indicators
    { label: "Bollinger Üst / Alt", value: `${formatTR(quote.bollUpper)} / ${formatTR(quote.bollLower)}`, status: quote.lastClose > quote.bollUpper ? "danger" : quote.lastClose < quote.bollLower ? "success" : "neutral" },
    { label: "Bollinger Sıkışma", value: quote.bollSqueeze ? "⚠ Sıkışma" : "Normal", status: quote.bollSqueeze ? "warning" : "neutral" },
    { label: "VWAP", value: formatTR(quote.vwapValue), status: quote.lastClose > quote.vwapValue ? "success" : "danger" },
    { label: "Ichimoku", value: quote.ichimokuBullish ? "Bulut Üstü (Boğa)" : "Bulut İçi/Altı", status: quote.ichimokuBullish ? "success" : "danger" },
    { label: "Tenkan / Kijun", value: `${formatTR(quote.ichimokuTenkan)} / ${formatTR(quote.ichimokuKijun)}`, status: quote.ichimokuTenkan > quote.ichimokuKijun ? "success" : "danger" },
    { label: "+DI / -DI", value: `${formatTR(quote.adxPlus, 1)} / ${formatTR(quote.adxMinus, 1)}`, status: quote.adxPlus > quote.adxMinus ? "success" : "danger" },
    { label: "EMA Ribbon", value: `${quote.emaRibbon}/3`, status: quote.emaRibbon >= 2 ? "success" : quote.emaRibbon === 1 ? "warning" : "danger" },
    { label: "Hacim Onay", value: `%${quote.volumeConfirm}`, status: quote.volumeConfirm >= 60 ? "success" : "danger" },
    { label: "Piyasa Rejimi", value: quote.marketRegime === 'TRENDING' ? '📈 TREND' : quote.marketRegime === 'RANGING' ? '📊 YATAY' : '⚡ VOLATİL', status: quote.marketRegime === 'TRENDING' ? "success" : "warning" },
    { label: "EMA 21 (2D)", value: formatTR(quote.ema21_2d), status: quote.lastClose > (quote.ema21_2d || 0) ? "success" : "danger" },
    // Fibonacci 2D
    { label: "Fib 0.382 (2D)", value: formatTR(quote.fib382_2d), status: Math.abs(quote.lastClose - (quote.fib382_2d || 0)) / quote.lastClose < 0.015 ? "warning" : "neutral" },
    { label: "Fib 0.500 (2D)", value: formatTR(quote.fib500_2d), status: Math.abs(quote.lastClose - (quote.fib500_2d || 0)) / quote.lastClose < 0.015 ? "warning" : "neutral" },
    { label: "Fib 0.618 (2D)", value: formatTR(quote.fib618_2d), status: Math.abs(quote.lastClose - (quote.fib618_2d || 0)) / quote.lastClose < 0.015 ? "success" : "neutral" },
    // Fibonacci 3D
    { label: "Fib 0.382 (3D)", value: formatTR(quote.fib382_3d), status: Math.abs(quote.lastClose - (quote.fib382_3d || 0)) / quote.lastClose < 0.015 ? "warning" : "neutral" },
    { label: "Fib 0.500 (3D)", value: formatTR(quote.fib500_3d), status: Math.abs(quote.lastClose - (quote.fib500_3d || 0)) / quote.lastClose < 0.015 ? "warning" : "neutral" },
    { label: "Fib 0.618 (3D)", value: formatTR(quote.fib618_3d), status: Math.abs(quote.lastClose - (quote.fib618_3d || 0)) / quote.lastClose < 0.015 ? "success" : "neutral" },
    { label: "RSI Uyumsuzluk", value: quote.rsiDivBullish ? '⭐ Boğa' : quote.rsiDivBearish ? '⚠ Ayı' : 'Yok', status: quote.rsiDivBullish ? "success" : quote.rsiDivBearish ? "danger" : "neutral" },
    { label: "MACD Uyumsuzluk", value: quote.macdDivBullish ? '⭐ Boğa' : quote.macdDivBearish ? '⚠ Ayı' : 'Yok', status: quote.macdDivBullish ? "success" : quote.macdDivBearish ? "danger" : "neutral" },
    { label: "Haftalık EMA26", value: formatTR(quote.weeklyEma26), status: "neutral" },
    { label: "Haftalık Trend", value: quote.isWeeklyEma26Bullish ? "Boğa (EMA26 Üstü) ↗️" : "Ayı (EMA26 Altı) ↘️", status: quote.isWeeklyEma26Bullish ? "success" : "danger" },
    { label: "R/R Oranı", value: `${quote.riskRewardRatio}:1`, status: quote.riskRewardRatio >= 2 ? "success" : quote.riskRewardRatio >= 1 ? "warning" : "danger" },
    { label: "Güven Skoru", value: `${quote.confidence}%`, status: quote.confidence >= 65 ? "success" : quote.confidence >= 45 ? "warning" : "danger" },
  ];

  const statusColors: Record<string, string> = {
    success: "text-emerald-400",
    danger: "text-red-400",
    warning: "text-orange-400",
    neutral: "text-slate-300",
  };

  const statusDotColors: Record<string, string> = {
    success: "bg-emerald-400",
    danger: "bg-red-400",
    warning: "bg-orange-400",
    neutral: "bg-slate-500",
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-6 text-white print:bg-white print:bg-none print:text-black">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between print:flex-row print:justify-between">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-400 print:text-cyan-700">BIST Analiz Raporu</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-semibold tracking-tight text-white print:text-black">{quote.ticker}</h1>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold print:border print:border-black ${signalClass[signal] || "bg-gray-600 text-white"}`}>
                {signalLabel[signal] || signal}
              </span>
            </div>
            <p className="max-w-2xl text-gray-300 print:text-gray-700">{quote.name} için canlı piyasa verileriyle oluşturulmuş detaylı teknik analiz raporu.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <PrintButton />
            <Link
              href="/backtest"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-white transition hover:border-cyan-500 hover:bg-slate-700"
            >
              Backtest
            </Link>
            <Link
              href="/"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-white transition hover:border-cyan-500 hover:bg-slate-700"
            >
              Dashboard
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.45fr_0.85fr] print:grid-cols-1 print:gap-4">
          <div className="space-y-6 print:space-y-4">
            {/* Warning / Approved Callout Boxes */}
            {quote.stopLossBroken && (
              <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 shadow-lg shadow-red-500/5 animate-pulse">
                <h4 className="text-red-400 font-black text-base flex items-center gap-2">
                  🚨 STOP LİMİTİ KIRILDI! REKALİBRASYON YAPILDI
                </h4>
                <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
                  Fiyat, ana stop seviyesinin altına sarkarak stop-loss sınırını ihlal etmiştir. Sistemimiz otomatik olarak <strong>yeni bir stop seviyesi ({formatTR(quote.stopLoss)} ₺)</strong> ve en yakın destekleri hesaplayarak analiz planını güncelledi. Kademeli alım, izleme veya pozisyon azaltma düşünülebilir.
                </p>
              </div>
            )}

            {quote.isFakeout && (
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
                    {quote.fakeoutReasons?.map((reason: string, idx: number) => (
                      <li key={idx} className="font-bold text-rose-400">{reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {quote.meetsBuyCriteria && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 shadow-lg shadow-emerald-500/5">
                <h4 className="text-emerald-400 font-black text-base flex items-center gap-2">
                  ✅ ONAYLI ALIM SİNYALİ!
                </h4>
                <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
                  Bu hisse senedi, sistemin en katı filtrelerini başarıyla geçmiştir. <strong>Trend, Momentum ve Hacim/Para Akışı</strong> gruplarının her birinde ayrı ayrı <strong>%60</strong>&apos;ın üzerinde onay almış ve haftalık <strong>EMA26</strong> seviyesinin üzerinde macro boğa trendindedir. Herhangi bir sahte yükseliş tuzağı bulunmamaktadır.
                </p>
              </div>
            )}

            {/* Price & Quick Metrics */}
            <div className="card border-cyan-500/20 bg-slate-900 p-4 sm:p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-cyan-400 print:text-cyan-700">Son Fiyat</p>
                  <p className="text-5xl font-semibold text-white print:text-black">{formatTR(quote.lastClose)} ₺</p>
                  <p className="mt-1 text-sm text-gray-400 print:text-gray-600">{quote.change >= 0 ? "+" : ""}{formatTR(quote.change)}% 24s</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-xl bg-slate-800 p-3 sm:p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-[10px] sm:text-xs text-gray-400 print:text-gray-600 uppercase font-bold tracking-wider">SMA20</p>
                    <p className="mt-1 text-base sm:text-lg font-semibold text-white print:text-black">{formatTR(quote.sma20Distance, 1)}%</p>
                  </div>
                  <div className="rounded-xl bg-slate-800 p-3 sm:p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-[10px] sm:text-xs text-gray-400 print:text-gray-600 uppercase font-bold tracking-wider">RSI</p>
                    <p className="mt-1 text-base sm:text-lg font-semibold text-white print:text-black">{formatTR(quote.rsi, 1)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1 rounded-xl bg-slate-800 p-3 sm:p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-[10px] sm:text-xs text-gray-400 print:text-gray-600 uppercase font-bold tracking-wider">Hacim</p>
                    <p className="mt-1 text-base sm:text-lg font-semibold text-white print:text-black">{formatTR(quote.volumeMultiple, 1)}x</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-4 sm:p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between print:mb-2">
                <h2 className="text-lg sm:text-xl font-semibold text-white print:text-black">İnteraktif Grafik</h2>
                <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-500">150 Günlük Veri</span>
              </div>
              <div className="mt-4 sm:mt-6 print:mt-0">
                <InteractiveChartWrapper symbol={quote.ticker} />
              </div>
            </div>

            {/* Phase 2: Broker Consensus & AKD Smart Money Flow Panels */}
            <div className="grid grid-cols-1 gap-6 print:hidden">
              <AkdFlowPanel data={akdFlow} ticker={quote.ticker} />
              <BrokerConsensusPanel data={consensus} ticker={quote.ticker} />
            </div>

            {/* Symbol Specific News */}
            <div className="card p-4 sm:p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-white print:text-black flex items-center gap-2">
                  📰 Haber & İstihbarat
                </h2>
                <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-cyan-400 print:text-cyan-600 font-bold">KAP & Medya</span>
              </div>
              {symbolNews.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-sm">Bu hisse için son 24 saatte önemli bir haber akışı tespit edilmedi.</div>
              ) : (
                <div className="space-y-4">
                  {symbolNews.map((news) => (
                    <div key={news.id} className={`p-4 rounded-xl border ${news.sentiment === 'positive' ? 'bg-emerald-950/20 border-emerald-500/20' : news.sentiment === 'negative' ? 'bg-rose-950/20 border-rose-500/20' : 'bg-slate-900/50 border-slate-700'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-xs font-black uppercase tracking-widest ${news.sentiment === 'positive' ? 'text-emerald-400' : news.sentiment === 'negative' ? 'text-rose-400' : 'text-sky-400'}`}>
                          {news.source.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-slate-500">{new Date(news.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <h4 className="font-bold text-sm text-white mb-1.5">{news.title}</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">{news.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Full Indicator Table */}
            <div className="card p-4 sm:p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-white print:text-black">Teknik Göstergeler</h2>
                <span className="text-xs text-cyan-300 print:text-cyan-700 uppercase font-bold tracking-widest">{indicators.length} Veri</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 print:border-gray-300">
                      <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500 print:text-gray-500">İndikatör</th>
                      <th className="py-2 px-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500 print:text-gray-500">Durum</th>
                      <th className="py-2 px-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500 print:text-gray-500">Değer</th>
                      <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500 print:text-gray-500 hidden lg:table-cell">Açıklama</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indicators.map((ind, i) => (
                      <tr
                        key={ind.label}
                        className={`border-b border-slate-800/50 transition-colors hover:bg-slate-800/40 print:border-gray-200 ${i % 2 === 0 ? "bg-slate-950/30 print:bg-gray-50" : ""}`}
                      >
                        <td className="py-2.5 px-3 font-semibold text-slate-200 print:text-black">{ind.label}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDotColors[ind.status]}`} />
                        </td>
                        <td className={`py-2.5 px-3 text-right font-mono font-bold ${statusColors[ind.status]} print:text-black`}>{ind.value}</td>
                        <td className="py-2.5 px-3 text-xs text-slate-500 print:text-gray-500 hidden lg:table-cell">{indicatorDescriptions[ind.label] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Why? — Signal Reasons */}
            <div className="card p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black">Neden Bu Sinyal?</h2>
                <span className="text-sm text-cyan-300 print:text-cyan-700">Confluans Analizi</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 print:text-gray-500">Aktif olan teknik sinyallerin birleşimi ile oluşturulan confluans puanı.</p>
              <ul className="mt-5 space-y-3 text-gray-300 print:text-gray-800 print:mt-2">
                {evaluation.reasons.length === 0 ? (
                  <li className="text-slate-500 text-sm">Aktif sinyal bulunamadı.</li>
                ) : (
                  evaluation.reasons.map((item, i) => (
                    <li key={i} className="flex gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 print:border-none print:border-b print:border-gray-200 print:bg-transparent print:p-2">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400 shrink-0 print:bg-cyan-600 print:mt-1.5" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="space-y-6 print:space-y-4">
            {/* Trade Recommendation */}
            <div className="card p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black">Öneri</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-500">Aksiyon</span>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-5 print:bg-gray-50 print:border-gray-300">
                <p className="text-sm leading-relaxed text-gray-200 print:text-gray-800">{quote.recommendation}</p>
              </div>
            </div>

            {/* Action Plan - Multi-level Support (TRY) & Target (USD) */}
            <div className="card p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black">Hareket Planı</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-500">Destek TL | Hedef USD</span>
              </div>
              <div className="mt-6 space-y-3 print:mt-2">
                {/* Support Levels (TRY) */}
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-400 print:text-cyan-700 mb-2">Destek Seviyeleri (₺)</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">S1 (Yakın Destek)</p>
                    <p className="mt-2 text-xl font-semibold text-rose-400 print:text-red-600">{formatTR(quote.support1Tl)} ₺</p>
                  </div>
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">S2 (Orta Destek)</p>
                    <p className="mt-2 text-xl font-semibold text-rose-400 print:text-red-600">{formatTR(quote.support2Tl)} ₺</p>
                  </div>
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">S3 (Ana Destek)</p>
                    <p className="mt-2 text-xl font-semibold text-rose-400 print:text-red-600">{formatTR(quote.support3Tl)} ₺</p>
                  </div>
                </div>
                {/* Target Levels (USD) */}
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 print:text-emerald-700 mb-2 mt-4">Hedef Seviyeleri ($)</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">T1 (Kısa Vade)</p>
                    <p className="mt-2 text-xl font-semibold text-emerald-400 print:text-emerald-600">${formatTR(quote.target1Usd, 2)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">T2 (Orta Vade)</p>
                    <p className="mt-2 text-xl font-semibold text-emerald-400 print:text-emerald-600">${formatTR(quote.target2Usd, 2)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">T3 (Uzun Vade)</p>
                    <p className="mt-2 text-xl font-semibold text-emerald-400 print:text-emerald-600">${formatTR(quote.target3Usd, 2)}</p>
                  </div>
                </div>
                {/* R/R & Stop */}
                <div className="grid gap-3 sm:grid-cols-2 mt-3">
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">Stop Loss</p>
                    <p className="mt-2 text-xl font-semibold text-rose-400 print:text-red-600">{formatTR(quote.stopLoss)} ₺</p>
                  </div>
                  <div className="rounded-2xl bg-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3">
                    <p className="text-gray-400 print:text-gray-600">Risk/Reward</p>
                    <p className={`mt-2 text-xl font-semibold ${quote.riskRewardRatio >= 2 ? 'text-emerald-400' : quote.riskRewardRatio >= 1 ? 'text-orange-400' : 'text-red-400'}`}>{quote.riskRewardRatio}:1</p>
                  </div>
                </div>

                {/* Quant Horizons */}
                {quote.quantHorizons && (
                  <>
                    <p className="text-xs uppercase tracking-[0.2em] text-violet-400 print:text-violet-700 mb-2 mt-6">Nicel Sinyal Ufukları - {quote.ticker}</p>
                    <div className="grid gap-3 sm:grid-cols-3 mb-3">
                      <div className="rounded-2xl bg-gradient-to-br from-violet-900/50 to-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3 border border-violet-600/30">
                        <p className="text-violet-300 print:text-violet-700 font-semibold text-lg">Kısa Vade</p>
                        <p className="text-xs text-gray-400 mb-2">Swing (1-5 Gün)</p>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">Hedef:</span>
                          <span className="text-emerald-400 font-bold">{formatTR(quote.quantHorizons.shortTerm.targetTl)} ₺</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">Hedef ($):</span>
                          <span className="text-emerald-400 font-bold">${formatTR(quote.quantHorizons.shortTerm.targetUsd)}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-gray-400">Stop Loss:</span>
                          <span className="text-red-400 font-bold">{formatTR(quote.quantHorizons.shortTerm.stopLossTl)} ₺</span>
                        </div>
                        <div className="pt-2 border-t border-slate-700 flex justify-between items-center">
                          <span className="text-xs text-gray-400">R/R Oranı</span>
                          <span className="text-white font-bold">{quote.quantHorizons.shortTerm.rrRatio}:1</span>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gradient-to-br from-fuchsia-900/50 to-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3 border border-fuchsia-600/30">
                        <p className="text-fuchsia-300 print:text-fuchsia-700 font-semibold text-lg">Orta Vade</p>
                        <p className="text-xs text-gray-400 mb-2">Trend (1-4 Hafta)</p>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">Hedef:</span>
                          <span className="text-emerald-400 font-bold">{formatTR(quote.quantHorizons.mediumTerm.targetTl)} ₺</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">Hedef ($):</span>
                          <span className="text-emerald-400 font-bold">${formatTR(quote.quantHorizons.mediumTerm.targetUsd)}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-gray-400">Stop Loss:</span>
                          <span className="text-red-400 font-bold">{formatTR(quote.quantHorizons.mediumTerm.stopLossTl)} ₺</span>
                        </div>
                        <div className="pt-2 border-t border-slate-700 flex justify-between items-center">
                          <span className="text-xs text-gray-400">R/R Oranı</span>
                          <span className="text-white font-bold">{quote.quantHorizons.mediumTerm.rrRatio}:1</span>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gradient-to-br from-blue-900/50 to-slate-800 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3 border border-blue-600/30">
                        <p className="text-blue-300 print:text-blue-700 font-semibold text-lg">Uzun Vade</p>
                        <p className="text-xs text-gray-400 mb-2">Pozisyon (1-6 Ay)</p>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">Hedef:</span>
                          <span className="text-emerald-400 font-bold">{formatTR(quote.quantHorizons.longTerm.targetTl)} ₺</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">Hedef ($):</span>
                          <span className="text-emerald-400 font-bold">${formatTR(quote.quantHorizons.longTerm.targetUsd)}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-gray-400">Stop Loss:</span>
                          <span className="text-red-400 font-bold">{formatTR(quote.quantHorizons.longTerm.stopLossTl)} ₺</span>
                        </div>
                        <div className="pt-2 border-t border-slate-700 flex justify-between items-center">
                          <span className="text-xs text-gray-400">R/R Oranı</span>
                          <span className="text-white font-bold">{quote.quantHorizons.longTerm.rrRatio}:1</span>
                        </div>
                      </div>
                    </div>
                    
                    <p className="text-xs text-gray-500 mt-3 print:text-gray-600">
                      💡 <strong>Algoritma Yöntemi:</strong> Yapay zeka destekli Nicel Model (Quant Model) bazlı risk analizi. Ufuk bazlı dinamik Risk/Ödül, ATR Volatilite Bantları ve Fibonacci uzantıları hesaplanmıştır.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Score Matrix (visual) */}
            <div className="card p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-cyan-400 print:text-cyan-700">Skor Matrisi</p>
                  <h3 className="mt-3 text-2xl font-semibold text-white print:text-black print:mt-1">Confluans Puanı</h3>
                </div>
                <div className="rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-gray-200 print:bg-gray-200 print:text-black">{quote.score}/100</div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 print:mt-3">
                {[
                  { label: "Trend", value: quote.trendScore, max: 100, color: "bg-blue-500" },
                  { label: "Momentum", value: quote.momentumScore, max: 100, color: "bg-purple-500" },
                  { label: "Hacim", value: quote.volumeScore, max: 100, color: "bg-emerald-500" },
                  { label: "Genel Skor", value: quote.score, max: 100, color: "bg-orange-500" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-slate-950/70 p-4 print:bg-gray-100 print:rounded-lg print:p-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-600">{item.label}</p>
                    <p className="mt-2 text-xl font-semibold text-white print:text-black print:text-lg print:mt-1">{item.value} / {item.max}</p>
                    <div className="mt-2 h-1 w-full rounded-full bg-slate-800">
                      <div className={`h-1 rounded-full ${item.color} transition-all`} style={{ width: `${(item.value / item.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* MACD / Stoch / CCI Quick Summary */}
            <div className="card p-6 print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-cyan-400 mb-4">Hızlı İndikatör Özeti</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-slate-950/50 p-3 border border-slate-800">
                  <span className="text-xs font-bold text-slate-400">MACD</span>
                  <span className={`text-sm font-bold ${(quote.macdHistogram ?? 0) > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {(quote.macdHistogram ?? 0) > 0 ? "▲ Pozitif" : "▼ Negatif"} ({formatTR(quote.macdHistogram, 3)})
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-950/50 p-3 border border-slate-800">
                  <span className="text-xs font-bold text-slate-400">Stochastic %K</span>
                  <span className={`text-sm font-bold ${(quote.stochK ?? 0) > 80 ? "text-red-400" : (quote.stochK ?? 0) < 20 ? "text-emerald-400" : "text-white"}`}>
                    {formatTR(quote.stochK, 1)} {(quote.stochK ?? 0) > 80 ? "(Aşırı Alım)" : (quote.stochK ?? 0) < 20 ? "(Aşırı Satım)" : "(Normal)"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-950/50 p-3 border border-slate-800">
                  <span className="text-xs font-bold text-slate-400">CCI</span>
                  <span className={`text-sm font-bold ${(quote.cci ?? 0) > 100 ? "text-orange-400" : (quote.cci ?? 0) < -100 ? "text-emerald-400" : "text-white"}`}>
                    {formatTR(quote.cci, 1)} {(quote.cci ?? 0) > 100 ? "(Güçlü Momentum)" : (quote.cci ?? 0) < -100 ? "(Aşırı Satım)" : "(Normal)"}
                  </span>
                </div>
              </div>
            </div>

            {/* Portfolio / Paper Trading */}
            <Portfolio currentSymbol={symbol} currentPrice={quote.lastClose} />
          </div>
        </div>
      </div>
    </main>
  );
}
