"use client";

import { useState } from "react";
import Link from "next/link";

interface FeatureWeight {
  label: string;
  name: string;
  pct: number;
  color: string;
}

const FEATURE_WEIGHTS: FeatureWeight[] = [
  { label: "ATR (Volatilite)", name: "atr_14", pct: 25.41, color: "from-emerald-400 to-teal-500" },
  { label: "SMA50 (Orta Vade Trend)", name: "close_over_sma50", pct: 20.96, color: "from-teal-400 to-cyan-500" },
  { label: "MACD (Momentum)", name: "macd", pct: 17.25, color: "from-cyan-400 to-sky-500" },
  { label: "RSI (Göreceli Güç)", name: "rsi_14", pct: 14.24, color: "from-sky-400 to-blue-500" },
  { label: "EMA9 (Kısa Vade Trend)", name: "close_over_ema9", pct: 11.98, color: "from-blue-400 to-indigo-500" },
  { label: "Hacim (Volume Ratio)", name: "volume_ratio", pct: 10.15, color: "from-indigo-400 to-violet-500" },
];

const ARCH_CARDS = [
  {
    title: "Scikit-Learn (Yapay Zeka)",
    code: "RandomForestClassifier",
    desc: "Karar ağaçlarından oluşan bu kütüphane, teknik göstergeleri ve XU100 relatif momentum özelliklerini analiz ederek hissenin Yön (UP/DOWN/FLAT) tahminini yapar.",
    tag: "Machine Learning",
    badgeColor: "bg-emerald-950/60 border-emerald-500/40 text-emerald-400",
  },
  {
    title: "PyTorch (Derin Öğrenme)",
    code: "QuantumLSTM",
    desc: "30 günlük zaman serisi hafızası ile LSTM ağı, RandomForest'in göremediği sıralı desenleri yakalar. Çapraz kontrol ikinci motorudur.",
    tag: "Deep Learning",
    badgeColor: "bg-blue-950/60 border-blue-500/40 text-blue-400",
  },
  {
    title: "SHAP (Açıklanabilir AI)",
    code: "TreeExplainer",
    desc: "Nobel ödüllü Shapley Değerleri teorisine dayanan matematiksel XAI kütüphanesi. Her tahmin için hangi göstergenin ne kadar katkı yaptığını sayısal olarak kanıtlar.",
    tag: "Explainable AI",
    badgeColor: "bg-violet-950/60 border-violet-500/40 text-violet-400",
  },
  {
    title: "Pandas-TA (Teknik Analiz)",
    code: "pandas_ta",
    desc: "RSI, MACD, Bollinger, ATR ve EMA gibi göstergeleri nanosaniyeler içinde C++ hızında hesaplayıp yapay zekaya besler.",
    tag: "Technical Engine",
    badgeColor: "bg-amber-950/60 border-amber-500/40 text-amber-400",
  },
  {
    title: "HMMlearn (Piyasa Rejimi)",
    code: "hmmlearn",
    desc: "Hidden Markov Models (Saklı Markov Modelleri). Fiyat hareketindeki gizli kaosu çözerek piyasanın AYI (Kriz) mı yoksa BOĞA (Ralli) mı olduğunu tespit eder.",
    tag: "Regime Detection",
    badgeColor: "bg-rose-950/60 border-rose-500/40 text-rose-400",
  },
  {
    title: "FinBERT (Haber Duygu Analizi)",
    code: "Financial_Lexicon",
    desc: "Finansal haberleri analiz eden NLP motoru. Üçüncü confluence motoru olarak piyasa duyarlılığını ölçer ve zaman bozunumlu duyarlılık skoru üretir.",
    tag: "NLP Sentiment",
    badgeColor: "bg-cyan-950/60 border-cyan-500/40 text-cyan-400",
  },
  {
    title: "VectorBT (Backtest)",
    code: "vectorbt",
    desc: "Profesyonel kuantların kullandığı vektörize backtest kütüphanesi. Sinyallerin geçmiş performansını, max drawdown ve win rate oranlarını simüle eder.",
    tag: "Backtesting",
    badgeColor: "bg-fuchsia-950/60 border-fuchsia-500/40 text-fuchsia-400",
  },
  {
    title: "YFinance (Canlı Veri)",
    code: "yfinance",
    desc: "BIST100 hisselerinin anlık ve geçmiş seans verilerini tamamen ücretsiz ve sınırsız çekmemizi sağlar.",
    tag: "Data Feed",
    badgeColor: "bg-lime-950/60 border-lime-500/40 text-lime-400",
  },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "architecture" | "weights" | "sniper">("dashboard");
  const [searchSymbol, setSearchSymbol] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [singleResult, setSingleResult] = useState<any>(null);
  const [radarResults, setRadarResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSingleScan = async () => {
    if (!searchSymbol.trim()) return;
    setIsScanning(true);
    setError(null);
    try {
      const res = await fetch("http://127.0.0.1:8001/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: searchSymbol.trim().toUpperCase() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Analiz hatası");
      setSingleResult(json.data);
    } catch (err: any) {
      setError(err?.message || "Sunucuya bağlanılamadı. Python main_api.py (port 8001) açık mı?");
    } finally {
      setIsScanning(false);
    }
  };

  const handleRadarScan = async () => {
    setIsScanning(true);
    setError(null);
    try {
      const res = await fetch("http://127.0.0.1:8001/api/scan_all");
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Radar tarama hatası");
      setRadarResults(json.data || []);
    } catch (err: any) {
      setError(err?.message || "Sunucuya bağlanılamadı. Python main_api.py (port 8001) açık mı?");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-[#0c1322] via-[#0f172a] to-[#0a0f1d] p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.08)]">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-cyan-950/80 border border-cyan-500/30 text-cyan-400 mb-3 uppercase tracking-wider">
              <span>🎯 AI Trading Terminal v2.0</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              QUANTUM SNIPER
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              BIST100 için RandomForest, Deep Learning (QuantumLSTM), SHAP Açıklanabilir AI ve TradingView MOSTRSI motorlarıyla güçlendirilmiş algoritmik analiz masası.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/rsi-pu30"
              className="px-4 py-2.5 rounded-xl border border-violet-500/40 bg-violet-950/40 text-violet-300 font-bold text-xs hover:border-violet-400 hover:bg-violet-900/50 transition-all flex items-center gap-2"
            >
              <span>📉 MOSTRSI &amp; PU30 Tarayıcı</span>
            </Link>
            <button
              onClick={handleRadarScan}
              disabled={isScanning}
              className="px-5 py-2.5 rounded-xl border border-cyan-500/50 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black text-xs hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-50"
            >
              {isScanning ? "Taranıyor..." : "📡 TÜM BIST100'Ü TARA"}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-t border-slate-800/80 pt-6 mt-6 overflow-x-auto">
          {[
            { id: "dashboard", label: "📊 Piyasa Radarı" },
            { id: "architecture", label: "🧠 Sistem Mimarisi" },
            { id: "weights", label: "⚖️ AI Ağırlıkları" },
            { id: "sniper", label: "🎯 Sniper Motoru Özeti" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                  : "bg-slate-900/40 border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4 text-rose-300 text-xs font-medium">
          ⚠️ {error}
        </div>
      )}

      {/* VIEW: DASHBOARD / RADAR */}
      {activeTab === "dashboard" && (
        <div className="space-y-6">
          {/* Search single stock */}
          <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-4 flex flex-col sm:flex-row items-center gap-3">
            <input
              type="text"
              placeholder="Tek Hisse Analiz Et (Örn: THYAO, ASELS, GARAN)"
              value={searchSymbol}
              onChange={(e) => setSearchSymbol(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSingleScan()}
              className="w-full sm:flex-1 rounded-xl bg-slate-900 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400 uppercase font-mono"
            />
            <button
              onClick={handleSingleScan}
              disabled={isScanning}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-cyan-600 text-white font-bold text-xs hover:bg-cyan-500 transition-colors disabled:opacity-50"
            >
              {isScanning ? "Taranıyor..." : "HİSSE TARA"}
            </button>
          </div>

          {/* Single Stock Result Card */}
          {singleResult && (
            <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black text-white">{searchSymbol.toUpperCase()}</h2>
                  <span className={`px-2.5 py-0.5 rounded-md text-xs font-black ${
                    singleResult.sniper_approved ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400" : "bg-amber-500/20 border border-amber-500/40 text-amber-400"
                  }`}>
                    {singleResult.sniper_label}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 font-bold">Son Fiyat</p>
                  <p className="text-xl font-mono font-bold text-white">{singleResult.current_price?.toFixed(2)} ₺</p>
                </div>
              </div>

              {singleResult.explanation && (
                <div className="space-y-1.5 pt-3 border-t border-slate-800">
                  <p className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Açıklanabilir AI (XAI) Nedenleri:</p>
                  {singleResult.explanation.map((exp: string, idx: number) => (
                    <p key={idx} className="text-xs text-slate-300 leading-relaxed font-mono">• {exp}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Radar Multiple Results */}
          {radarResults.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>🔥 GÜNÜN SNIPER FIRSATLARI (BIST100)</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/30 text-cyan-400 text-xs">
                    {radarResults.length} Hisse
                  </span>
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {radarResults.map((r, i) => (
                  <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-cyan-500/50 transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-black text-white">{r.symbol}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                        AL ONAYI
                      </span>
                    </div>
                    <div className="text-xl font-bold text-white mt-2">{r.current_price?.toFixed(2)} ₺</div>
                    <div className="mt-2 text-xs text-slate-400">
                      Güven Skoru: <span className="font-bold text-cyan-400">%{(r.class_probabilities?.UP * 100).toFixed(0)}</span>
                    </div>
                    {r.target_price_tl && (
                      <div className="mt-1 text-xs text-emerald-400 font-bold">
                        Hedef: {r.target_price_tl.toFixed(2)} ₺ (+%{r.potential_roi?.toFixed(1)})
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {radarResults.length === 0 && !singleResult && (
            <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-8 text-center space-y-3">
              <div className="text-4xl opacity-50">📡</div>
              <h3 className="text-base font-bold text-white">BIST100 Radarını Çalıştırın</h3>
              <p className="text-slate-400 text-xs max-w-md mx-auto">
                Yukarıdaki "TÜM BIST100'Ü TARA" butonuna basarak tüm hisseleri RandomForest, LSTM ve FinBERT modelleriyle filtreleyebilir veya arama kutusuna hisse kodu yazarak anlık analiz alabilirsiniz.
              </p>
            </div>
          )}
        </div>
      )}

      {/* VIEW: ARCHITECTURE */}
      {activeTab === "architecture" && (
        <div className="space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-xl font-black text-white">🧠 Sistem Mimarisi ve Açık Kaynak Kütüphaneler (GitHub)</h2>
            <p className="text-slate-400 text-xs mt-1">Bu platform, dünyanın en güçlü açık kaynaklı Python veri bilimi kütüphaneleri üzerine inşa edilmiştir.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {ARCH_CARDS.map((card, i) => (
              <div key={i} className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 flex flex-col justify-between hover:border-cyan-500/40 transition-colors">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${card.badgeColor}`}>
                      {card.tag}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white">{card.title}</h3>
                  <code className="text-[11px] text-cyan-400 bg-slate-950 px-1.5 py-0.5 rounded font-mono mt-1 inline-block">
                    {card.code}
                  </code>
                  <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW: AI WEIGHTS */}
      {activeTab === "weights" && (
        <div className="space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-xl font-black text-white">⚖️ Yapay Zeka Karar Ağırlıkları (Feature Importances)</h2>
            <p className="text-slate-400 text-xs mt-1">Yapay Zekanın "AL" kararı verirken arka planda hangi göstergelere ne kadar güvendiğinin matematiksel (RandomForest) kanıtı.</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-6 space-y-4">
            {FEATURE_WEIGHTS.map((item, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-300">{item.label}</span>
                  <span className="text-cyan-400 font-mono">%{item.pct.toFixed(2)}</span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${item.color} transition-all duration-700`}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-slate-500 pt-3 border-t border-slate-800 italic">
              * Sonuçlar THYAO hissesinin geçmiş 5 yıllık verisiyle hesaplanan Model Feature Importance çıktısıdır.
            </p>
          </div>
        </div>
      )}

      {/* VIEW: SNIPER MOTORU */}
      {activeTab === "sniper" && (
        <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-6 space-y-4">
          <h2 className="text-xl font-black text-white">🎯 BIST Quantum Sniper Nasıl Çalışır?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <span className="text-emerald-400 font-bold text-sm block mb-1">1. Ön Filtreleme</span>
              Teknik indikatörler (RSI, ATR, MACD, Bollinger) ve HMM Rejim tespiti yapılarak hisse sinyal havuzuna alınır.
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <span className="text-cyan-400 font-bold text-sm block mb-1">2. Derin Öğrenme Doğrulaması</span>
              RandomForest %60 güven barajını geçerse, PyTorch QuantumLSTM ağı 30 günlük hafızası ile trend teyidi yapar.
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <span className="text-violet-400 font-bold text-sm block mb-1">3. MOSTRSI Kırılımı</span>
              TradingView MOSTRSI (14, VAR 5, 9) motoru 1 saatlik ve günlük periyotlarda yeşil Bull kesişimlerini takip eder.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
