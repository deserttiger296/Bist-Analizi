export const dynamic = 'force-dynamic';

import Link from "next/link";
import { WorkspacePage, Panel, MetricCard, StatusBadge } from "@/components/ui/Workspace";
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
  TUZAK: "BOĞA TUZAĞI ",
};

const indicatorDescriptions: Record<string, string> = {
  "Stochastic %K": "80 üzeri aşırı alım, 20 altı aşırı satım bölgesidir.",
  "CCI": "Fiyatın istatistiksel ortalamadan uzaklığını gösterir.",
  "RSI": "Göreceli Güç Endeksi — 70 üzeri aşırı alım, 30 altı aşırı satım.",
  "MACD": "Trend dönüş sinyali — sinyal üstü kesişim al sinyali.",
  "MACD Histogram": "Pozitif = yükseliş ivmesi, negatif = düşüş baskısı.",
  "EMA 5 / EMA 20": "Kısa ve uzun vadeli trend karşılaştırması.",
  "CMF 20": "Chaikin Para Akışı — pozitif ise alım baskısı.",
  "Hacim Onay": "Son 10 günlük hacim/fiyat trend uyumu.",
  "Piyasa Rejimi": "HMM tabanlı piyasa rejimi sınıflandırması.",
  "R/R Oranı": "Risk Ödül Oranı — potansiyel kazancın riske edilen tutara oranı.",
  "Güven Skoru": "Ağırlıklı confluans puanı (Kurumsal & Teknik uyum).",
};

export default async function StockReportPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  
  // includeSniper=true: this is a single-symbol deep-dive view, so it's
  // worth the extra seconds to run the full sniper engine (RF+LSTM+sentiment
  // confluence, SHAP explanation) as the primary AI verdict for this stock.
  const quote = await fetchBistLiveQuote(symbol, false, undefined, undefined, undefined, true);
  
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
  // Only real, actually-computed indicators. Stochastic, CCI, ADX/+DI-DI,
  // Supertrend, SAR, Bollinger (bands + squeeze), VWAP, Ichimoku, EMA Ribbon,
  // Fibonacci (2D/3D), RSI/MACD divergence, and weekly EMA26 trend were all
  // hardcoded placeholder values in fetchBistLiveQuote (bist.ts) -- some to
  // 0, some to a fixed non-neutral verdict (Supertrend/SAR/Ichimoku always
  // showed bearish, weekly trend always showed bullish, regardless of the
  // actual stock). That's not a rounding gap, it's a constant lie dressed up
  // as a live indicator -- removed rather than left to mislead a real trade
  // decision. The underlying math still exists in ./indicators for anyone
  // who wants to wire a real computation back in later.
  const indicators = [
    { label: "RSI", value: formatTR(quote.rsi, 1), status: quote.rsi > 70 ? "danger" : quote.rsi < 30 ? "success" : "neutral" },
    { label: "MACD", value: formatTR(quote.macd, 3), status: (quote.macd ?? 0) > (quote.macdSignal ?? 0) ? "success" : "danger" },
    { label: "Stochastic %K", value: formatTR(quote.stochK, 1), status: quote.stochK == null ? "neutral" : quote.stochK > 80 ? "danger" : quote.stochK < 20 ? "success" : "neutral" },
    { label: "CCI", value: formatTR(quote.cci, 1), status: quote.cci == null ? "neutral" : quote.cci > 100 ? "warning" : quote.cci < -100 ? "success" : "neutral" },
    { label: "MACD Histogram", value: formatTR(quote.macdHistogram, 3), status: (quote.macdHistogram ?? 0) > 0 ? "success" : "danger" },
    { label: "EMA 5 / EMA 20", value: `${formatTR(quote.ema5)} / ${formatTR(quote.ema20)}`, status: quote.ema5 > quote.ema20 ? "success" : "danger" },
    { label: "CMF 20", value: formatTR(quote.cmf20, 4), status: quote.cmf20 > 0 ? "success" : "danger" },
    { label: "Hacim Onay", value: `%${quote.volumeConfirm}`, status: quote.volumeConfirm >= 60 ? "success" : "danger" },
    { label: "Piyasa Rejimi", value: quote.marketRegime === 'TRENDING' ? ' TREND' : quote.marketRegime === 'RANGING' ? ' YATAY' : ' VOLATİL', status: quote.marketRegime === 'TRENDING' ? "success" : "warning" },
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
    <WorkspacePage title={quote.ticker} eyebrow="RSI ANALİZİ · HİSSE İNCELEMESİ" description={<>{quote.name} için veri kaynağından alınan teknik görünüm. <StatusBadge tone={signal.includes("BUY") ? "positive" : signal.includes("SELL") || signal === "TUZAK" ? "negative" : "neutral"}>{signalLabel[signal] || signal}</StatusBadge></>} actions={<div className="flex flex-wrap gap-2 print:hidden"><PrintButton /><Link href="/lab#reference" className="rsi-button">Referans ve kurallar</Link><Link href="/index.html#rsipu30" className="rsi-button">RSI Radarı</Link></div>} className="print:bg-white print:text-black">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.45fr_0.85fr] print:grid-cols-1 print:gap-4">
          <div className="space-y-6 print:space-y-4">
            {/* Warning / Approved Callout Boxes */}
            {quote.stopLossBroken && (
              <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 ">
                <h4 className="text-red-400 font-semibold text-base flex items-center gap-2">
                   Stop seviyesi ihlal edildi
                </h4>
                <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
                  Fiyat, ana stop seviyesinin altına sarkarak stop-loss sınırını ihlal etmiştir. Sistemimiz otomatik olarak <strong>yeni bir stop seviyesi ({formatTR(quote.stopLoss)} ₺)</strong> ve en yakın destekleri hesaplayarak analiz planını güncelledi. Kademeli alım, izleme veya pozisyon azaltma düşünülebilir.
                </p>
              </div>
            )}

            {quote.isFakeout && (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 ">
                <h4 className="text-rose-400 font-semibold text-base flex items-center gap-2">
                   Sahte yükseliş uyarısı
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
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 ">
                <h4 className="text-emerald-400 font-semibold text-base flex items-center gap-2">
                   Teknik filtreler karşılandı
                </h4>
                <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
                  Bu hisse senedi, sistemin en katı filtrelerini başarıyla geçmiştir. <strong>Trend, Momentum ve Hacim/Para Akışı</strong> gruplarının her birinde ayrı ayrı <strong>%60</strong>&apos;ın üzerinde onay almış ve haftalık <strong>EMA26</strong> seviyesinin üzerinde macro boğa trendindedir. Herhangi bir sahte yükseliş tuzağı bulunmamaktadır.
                </p>
              </div>
            )}

            <div className="workspace-metrics print:grid-cols-2">
              <MetricCard label="Son kapanış" value={`${formatTR(quote.lastClose)} ₺`} detail={`${quote.change >= 0 ? "+" : ""}${formatTR(quote.change)}% değişim`} tone={quote.change >= 0 ? "positive" : "negative"} />
              <MetricCard label="SMA20 mesafesi" value={`${formatTR(quote.sma20Distance, 1)}%`} />
              <MetricCard label="RSI" value={formatTR(quote.rsi, 1)} />
              <MetricCard label="Hacim / ortalama" value={`${formatTR(quote.volumeMultiple, 1)}×`} />
            </div>

            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between print:mb-2">
                <h2 className="text-lg sm:text-xl font-semibold text-white print:text-black">Semih Ersoy PU30 / NU70 Uyumsuzluk, Fraktal &amp; İtki Analizi (İnteraktif Grafik)</h2>
                <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-500">15DK · 1S · 4S · GÜNLÜK</span>
              </div>
              <div className="mt-4 sm:mt-6 print:mt-0">
                <InteractiveChartWrapper symbol={quote.ticker} />
              </div>
            </Panel>

            {/* Phase 2: Broker Consensus & AKD Smart Money Flow Panels */}
            <div className="grid grid-cols-1 gap-6 print:hidden">
              <AkdFlowPanel data={akdFlow} ticker={quote.ticker} />
              <BrokerConsensusPanel data={consensus} ticker={quote.ticker} />
            </div>

            {/* Symbol Specific News */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-white print:text-black flex items-center gap-2">
                   Haber & İstihbarat
                </h2>
                <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-emerald-300 print:text-cyan-600 font-bold">KAP & Medya</span>
              </div>
              {symbolNews.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-sm">Bu hisse için son 24 saatte önemli bir haber akışı tespit edilmedi.</div>
              ) : (
                <div className="space-y-4">
                  {symbolNews.map((news) => (
                    <div key={news.id} className={`p-4 rounded-xl border ${news.sentiment === 'positive' ? 'bg-emerald-950/20 border-emerald-500/20' : news.sentiment === 'negative' ? 'bg-rose-950/20 border-rose-500/20' : 'bg-slate-900/50 border-slate-700'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-xs font-semibold uppercase tracking-widest ${news.sentiment === 'positive' ? 'text-emerald-400' : news.sentiment === 'negative' ? 'text-rose-400' : 'text-sky-400'}`}>
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
            </Panel>

            {/* Full Indicator Table */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-white print:text-black">Teknik Göstergeler</h2>
                <span className="text-xs text-emerald-300 print:text-cyan-700 uppercase font-bold tracking-widest">{indicators.length} Veri</span>
              </div>
              <div className="workspace-table-wrap">
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
            </Panel>

            {/* Model değerlendirmesi — primary engine (RF + LSTM + sentiment confluence) */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4 border-slate-700">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black"> Model değerlendirmesi</h2>
                <span className="text-sm text-emerald-300 print:text-cyan-700">RF / LSTM / haber modeli</span>
              </div>
              {quote.sniper?.explanation ? (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold uppercase tracking-wide ${quote.sniper.sniper_approved ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-400' : 'bg-slate-800/60 border border-slate-600/40 text-slate-300'}`}>
                      {quote.sniper.sniper_label ?? '—'}
                    </span>
                    <span className="text-xs text-slate-400">{quote.sniper.confluence_label ?? ''}</span>
                    <span className="text-xs text-slate-500 ml-auto">
                      UP %{Math.round((quote.sniper.class_probabilities?.UP ?? 0) * 100)} · DOWN %{Math.round((quote.sniper.class_probabilities?.DOWN ?? 0) * 100)} · FLAT %{Math.round((quote.sniper.class_probabilities?.FLAT ?? 0) * 100)}
                    </span>
                  </div>
                  <ul className="mt-5 space-y-3 text-gray-300 print:text-gray-800 print:mt-2">
                    {(quote.sniper.explanation?.length ?? 0) === 0 ? (
                      <li className="text-slate-500 text-sm">Model motoru için aktif gerekçe bulunamadı.</li>
                    ) : (
                      quote.sniper.explanation.map((item, i) => (
                        <li key={i} className="flex gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 print:border-none print:border-b print:border-gray-200 print:bg-transparent print:p-2">
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-300 shrink-0 print:bg-cyan-600 print:mt-1.5" />
                          <span className="text-sm">{item}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  ML tahmin motoru bu ortamda yok (canlı sitede RF/LSTM çalışmaz; yalnızca tam yerel motorda) ya da yanıt vermedi. Aşağıdaki teknik confluans analizi ikincil sinyal olarak gösteriliyor.
                </p>
              )}
            </Panel>

            {/* Why? — Signal Reasons (secondary, JS-native technical confluence) */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black">Teknik sinyal gerekçeleri</h2>
                <span className="text-sm text-emerald-300 print:text-cyan-700">Teknik değerlendirme</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 print:text-gray-500">Aktif olan teknik sinyallerin birleşimi ile oluşturulan confluans puanı.</p>
              <ul className="mt-5 space-y-3 text-gray-300 print:text-gray-800 print:mt-2">
                {evaluation.reasons.length === 0 ? (
                  <li className="text-slate-500 text-sm">Aktif sinyal bulunamadı.</li>
                ) : (
                  evaluation.reasons.map((item, i) => (
                    <li key={i} className="flex gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 print:border-none print:border-b print:border-gray-200 print:bg-transparent print:p-2">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-300 shrink-0 print:bg-cyan-600 print:mt-1.5" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))
                )}
              </ul>
            </Panel>
          </div>

          <div className="space-y-6 print:space-y-4">
            {/* Trade Recommendation */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black">Teknik senaryo</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-500">Aksiyon</span>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-5 print:bg-gray-50 print:border-gray-300">
                <p className="text-sm leading-relaxed text-gray-200 print:text-gray-800">{quote.recommendation}</p>
              </div>
            </Panel>

            {/* Action Plan - Multi-level Support (TRY) & Target (USD) */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white print:text-black">Destek ve hedef seviyeleri</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400 print:text-gray-500">Destek TL | Hedef USD</span>
              </div>
              <div className="mt-6 space-y-3 print:mt-2">
                {/* Support Levels (TRY) */}
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-300 print:text-cyan-700 mb-2">Destek Seviyeleri (₺)</p>
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
                      <div className="rounded-2xl bg-slate-900/60 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3 border border-slate-700">
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

                      <div className="rounded-2xl bg-slate-900/60 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3 border border-slate-700">
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

                      <div className="rounded-2xl bg-slate-900/60 p-4 text-sm print:bg-gray-100 print:rounded-lg print:p-3 border border-slate-700">
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
                       <strong>Algoritma Yöntemi:</strong> Yapay zeka destekli Nicel Model (Quant Model) bazlı risk analizi. Ufuk bazlı dinamik Risk/Ödül, ATR Volatilite Bantları ve Fibonacci uzantıları hesaplanmıştır.
                    </p>
                  </>
                )}
              </div>
            </Panel>

            {/* Score Matrix (visual) */}
            <Panel className="print:border-gray-300 print:bg-white print:shadow-none print:p-0 print:mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-emerald-300 print:text-cyan-700">Skor Matrisi</p>
                  <h3 className="mt-3 text-2xl font-semibold text-white print:text-black print:mt-1">Birleşik teknik puan</h3>
                </div>
                <div className="rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-gray-200 print:bg-gray-200 print:text-black">{quote.score}/100</div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 print:mt-3">
                {[
                  { label: "Trend", value: quote.trendScore, max: 100, color: "bg-emerald-400" },
                  { label: "Momentum", value: quote.momentumScore, max: 100, color: "bg-emerald-400" },
                  { label: "Hacim", value: quote.volumeScore, max: 100, color: "bg-emerald-500" },
                  { label: "Genel Skor", value: quote.score, max: 100, color: "bg-emerald-400" },
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
            </Panel>

            {/* Portfolio / Paper Trading */}
            <Portfolio currentSymbol={symbol} currentPrice={quote.lastClose} />
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}
