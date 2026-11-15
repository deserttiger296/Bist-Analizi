"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspacePage, MetricCard, EmptyState } from "@/components/ui/Workspace";

type Suite = { id: string; label: string; description: string };
type TestResult = { name: string; group: string; status: string; duration_sec: number; message: string };
type TestReport = {
  passed: boolean; exit_code: number; timed_out: boolean; label: string; completed_at: string; duration_sec: number;
  summary: { total: number; passed: number; failed: number; error: number; skipped: number };
  results: TestResult[]; output: string;
};

const BIST100_BACKTEST_SUMMARY = [
  {
    tf: "1 Saatlik (1h)",
    mode: "Immediate Confirm (Teyit Mum Kapanışı)",
    signals: 373,
    winRate: "47.7%",
    avgRet: "+0.28%",
    medianRet: "-0.16%",
    pf: "1.17",
    note: "Erken giriş, yüksek sinyal sayısı, gürültüye açık",
  },
  {
    tf: "1 Saatlik (1h)",
    mode: "Saatlik Güven Tazeleyen Tepe Kırılımı (Semih Hoca)",
    signals: 187,
    winRate: "63.6%",
    avgRet: "+0.88%",
    medianRet: "+0.82%",
    pf: "1.54",
    note: "Zayıf sinyallerin %50'sini eler, işlem başı getiri 3.1x artar",
    highlight: true,
  },
  {
    tf: "4 Saatlik (4h)",
    mode: "Immediate Confirm (Teyit Mum Kapanışı)",
    signals: 112,
    winRate: "46.4%",
    avgRet: "+0.54%",
    medianRet: "-0.26%",
    pf: "1.19",
    note: "Orta vade ham PU30 sinyali",
  },
  {
    tf: "4 Saatlik (4h)",
    mode: "Saatlik Güven Tazeleyen Tepe Kırılımı (Semih Hoca)",
    signals: 58,
    winRate: "62.1%",
    avgRet: "+1.76%",
    medianRet: "+1.51%",
    pf: "1.62",
    note: "4s PU30 + 1s yapı kırılımı (Ana Dönüş)",
    highlight: true,
  },
  {
    tf: "Günlük (1d)",
    mode: "Immediate Confirm (Teyit Mum Kapanışı)",
    signals: 22,
    winRate: "50.0%",
    avgRet: "+1.74%",
    medianRet: "+0.11%",
    pf: "1.37",
    note: "Makro dip dönüşleri (1 yıllık pencere)",
  },
];

const RULE_MATRIX = [
  {
    id: "PU30-STRICT",
    title: "Katı 30 / 70 Eşiği (6 Ekim 2026)",
    rule: "PU30 için 1. dip RSI < 30 ve 2. dip RSI > 30 (tam 30.0 reddedilir). NU70 için 1. tepe RSI > 70 ve 2. tepe RSI < 70.",
    examples: "KCAER (24.8 -> 27.7 RED), TOASO (32.9 -> 33.4 RED)",
    status: "AKTİF (Üretim)",
  },
  {
    id: "VAKBN-HAMMER",
    title: "2. Dip Dönüş Mumunda RSI Kontrolü & En Derin Ana Dip (5 Kasım 2026)",
    rule: "Sol penceredeki bir mumda RSI < 30 sarkmış olsa bile, 2. dip pivot mumunun kendisinde (p) veya hemen sağındaki dönüş mumunda (p+1) RSI > 30 ise kabul edilir; birden fazla aday 1. dip varsa en derin ana dip seçilir.",
    examples: "VAKBN 1s: 1. Dip 28.82 TL (RSI 14.8) -> 2. Dip 28.40 TL çekiç mumu (RSI 32.1 > 30)",
    status: "AKTİF (Üretim)",
  },
  {
    id: "ISCTR-KURUS",
    title: "Kuruş Toleranslı İkili Dip / Yatay Mavi Çizgi (%0.25, 5 Kasım 2026)",
    rule: "2. dip fiyatı 1. dibin en fazla +%0.25 üstündeyse (BIST kademe/kuruş farkı) yatay ikili dip olarak PU30 kabul edilir; >%0.25 yüksek dipler reddedilir.",
    examples: "ISCTR 1s: 1. Dip 11.64 TL (RSI 18.7) -> 2. Dip 11.66 TL (+%0.17 / 2 kuruş fark, RSI 36.8 > 30)",
    status: "AKTİF (Üretim)",
  },
  {
    id: "ASELS-TRUST",
    title: "Saatlik Güven Tazeleyen Tepe / Güven Kıran Dip (ASELS Örneği)",
    rule: "2. dipten (t0) sonra dibi kıramayan ilk kesinleşmiş saatlik dip (t2) oluştuğunda, aradaki en yüksek saatlik fiyat (t1) Güven Tazeleyen Tepe olur. Üzerinde saatlik kapanış = AL.",
    examples: "ASELS 4s NU70: 450.00 -> 439.50 -> Güven Kıran Dip 423.00 (kapanış 421.25)",
    status: "AKTİF (Üretim)",
  },
  {
    id: "IMPULSE-FIBTIME",
    title: "1-2 İtki Dalgası & Fibonacci Zaman Sündürme (Testbed)",
    rule: "PU30 dibi = 0 zaman (t0), 1 nolu itki dalgası tepesi = orta referans (t1), 2 nolu düzeltme dibi = zaman startı (t2). Fib Zaman 0.382 / 0.618 / 1.000 / 1.618 hedefleri ve itki kalitesi ölçülür.",
    examples: "VAKBN 1s: W1 +%5.21 (6 bar, hacim 1.45x) -> W2 28.72 (Fib 0.784) -> W3 32.30 (W1'in 2.42 katı)",
    status: "TESTBED (Deneysel)",
  },
];

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<"impulse" | "pytest" | "backtest" | "journal">("pytest");
  const [symbolsInput, setSymbolsInput] = useState("VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS");
  const [interval, setIntervalVal] = useState<"1h" | "4h" | "1d">("1h");
  const [impulseData, setImpulseData] = useState<any[]>([]);
  const [loadingImpulse, setLoadingImpulse] = useState(false);
  const impulseRequest = useRef(0);

  const [pytestData, setPytestData] = useState<TestReport | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState("resilience");
  const [executionMode, setExecutionMode] = useState<"local" | "report">("local");
  const [loadingPytest, setLoadingPytest] = useState(false);

  const [journalRows, setJournalRows] = useState<any[]>([]);
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runImpulseTestbed = async (customSyms?: string, customTf?: "1h" | "4h" | "1d") => {
    const requestId = ++impulseRequest.current;
    setLoadingImpulse(true);
    setImpulseData([]);
    setError(null);
    try {
      const syms = customSyms ?? symbolsInput;
      const tf = customTf ?? interval;
      const qs = new URLSearchParams({ mode: "impulse", symbols: syms, interval: tf }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (requestId !== impulseRequest.current) return;
      if (json.status !== "success") throw new Error(json.detail || "Testbed hatası");
      setImpulseData(json.items || []);
    } catch (e: any) {
      if (requestId === impulseRequest.current) setError(e?.message || "Testbed çalıştırılamadı");
    } finally {
      if (requestId === impulseRequest.current) setLoadingImpulse(false);
    }
  };

  const runPytestSuite = async (suite = selectedSuite) => {
    setLoadingPytest(true);
    setPytestData(null);
    setError(null);
    try {
      if (executionMode === "report") {
        const res = await fetch("/lab-results.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Henüz yayınlanmış test raporu yok. Önce Test Merkezi / CI kapısını çalıştırın.");
        const report = await res.json();
        const result = report.suites.find((item: { suite: string }) => item.suite === suite);
        if (!result) throw new Error("Bu paket yayınlanmış raporda yer almıyor.");
        setPytestData({ ...result, output: "Bu kayıt yayınlanan sürümle birlikte gelen test anlık görüntüsüdür. Canlı sitede test yeniden çalıştırılmadı." });
        return;
      }
      const qs = new URLSearchParams({ mode: "pytest", suite }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Pytest çalıştırılamadı");
      setPytestData(json);
    } catch (e: any) {
      setError(e?.message || "Pytest hatası");
    } finally {
      setLoadingPytest(false);
    }
  };

  const loadJournal = async () => {
    setLoadingJournal(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab?mode=journal`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Günlük okunamadı");
      setJournalRows(json.rows || []);
    } catch (e: any) {
      setError(e?.message || "Günlük hatası");
    } finally {
      setLoadingJournal(false);
    }
  };

  useEffect(() => {
    fetch("/api/lab?mode=catalog").then(async (res) => {
      const body = await res.json();
      if (!res.ok || body.status !== "success") throw new Error(body.detail || "Test paketleri yüklenemedi");
      setSuites(body.suites);
      setExecutionMode(body.execution_mode || "local");
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const syncTab = () => {
      const tab = window.location.hash.slice(1);
      if (tab === "reference") setActiveTab("backtest");
      else if (["pytest", "impulse", "journal"].includes(tab)) setActiveTab(tab as "pytest" | "impulse" | "journal");
    };
    syncTab();
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  return (
    <WorkspacePage title="Test Merkezi" eyebrow="ARAŞTIRMA VE DOĞRULAMA"
      description="Veri güvenilirliğini, RSI kurallarını ve sistem uyumunu doğrulayın. Testler yalnızca başlattığınızda çalışır."
      actions={<><Link href="/mtf-lab.html" className="rsi-button">MTF Strateji Lab</Link><Link href="/index.html#rsipu30" className="rsi-button">RSI Radarı</Link></>}>
      <div className="workspace-notice workspace-notice-warning">Yeni özellik → Test Merkezi → Regresyon → Uyumluluk kapısı → Üretime geçiş. Başarısız veya eksik kontrol geçişi durdurur.</div>
      <div className="workspace-tabs" role="tablist" aria-label="Test Merkezi bölümleri" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {([
          { id: "pytest", label: "Test paketleri" },
          { id: "impulse", label: "İtki analizi" },
          { id: "backtest", label: "Referans ve kurallar" },
          { id: "journal", label: "Sinyal günlüğü" },
        ] as const).map(tab => <button key={tab.id} id={`lab-tab-${tab.id}`} role="tab"
          aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} aria-controls="lab-panel" className="workspace-tab"
          onClick={() => {
            setActiveTab(tab.id);
            window.history.replaceState(null, "", `#${tab.id === "backtest" ? "reference" : tab.id}`);
            if (tab.id === "journal" && journalRows.length === 0) loadJournal();
          }}>{tab.label}</button>)}
      </div>
      <section id="lab-panel" role="tabpanel" aria-labelledby={`lab-tab-${activeTab}`}>
      {error && (
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* TAB 1: IMPULSE & FIB TIME TESTBED */}
      {activeTab === "impulse" && (
        <div className="space-y-6">
          <div className="workspace-panel workspace-panel-body space-y-4">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end justify-between">
              <div className="flex-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Test Edilecek Hisseler (Virgülle Ayırın)
                </label>
                <input
                  type="text"
                  value={symbolsInput}
                  onChange={(e) => setSymbolsInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-emerald-500 focus:outline-none"
                  placeholder="VAKBN,ISCTR,THYAO,ASELS"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Zaman Dilimi
                </label>
                <div className="flex gap-1.5">
                  {(["1h", "4h", "1d"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => {
                        setIntervalVal(tf);
                        runImpulseTestbed(symbolsInput, tf);
                      }}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        interval === tf
                          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const preset = "VAKBN,ISCTR";
                    setSymbolsInput(preset);
                    runImpulseTestbed(preset, "1h");
                    setIntervalVal("1h");
                  }}
                  className="px-3.5 py-2 rounded-xl border border-violet-500/40 bg-violet-950/40 text-violet-300 text-xs font-bold hover:bg-violet-900/50"
                >
                  VAKBN ve ISCTR örneği
                </button>
                <button
                  onClick={() => runImpulseTestbed()}
                  disabled={loadingImpulse}
                  className="rsi-button rsi-button-primary"
                >
                  {loadingImpulse ? "Analiz Ediliyor..." : "İtki analizini başlat"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-emerald-400 font-semibold">0 Noktası (t0):</span>
                <p className="text-slate-400 mt-0.5">PU30 uyumsuzluğunun 2. dibi (1 nolu itki dalgasının başladığı dip).</p>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-cyan-400 font-semibold">1 Tepesi (t1 - Orta Referans):</span>
                <p className="text-slate-400 mt-0.5">1 nolu itki dalgasının zirvesi (Güven Tazeleyen Tepe). RSI ivmesi ve hacim burada ölçülür.</p>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-amber-400 font-semibold">2 Dibi (t2 - Zaman Startı):</span>
                <p className="text-slate-400 mt-0.5">t0 dibini kırmayan yüksek dip. Fibo geri çekilmesi ve Fib Zaman başlangıcı.</p>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-violet-400 font-semibold">Fib Zaman Sündürme:</span>
                <p className="text-slate-400 mt-0.5">t2&apos;den ileriye 0.382 / 0.618 / 1.000 / 1.618 zaman pencereleri ve Dalga 3 takibi.</p>
              </div>
            </div>
          </div>

          {/* Results Cards */}
          <div className="space-y-4" aria-busy={loadingImpulse}>
            {loadingImpulse && <p role="status" className="text-cyan-300">Seçilen hisselerin verileri ve itki yapıları inceleniyor…</p>}
            {!loadingImpulse && impulseData.length === 0 && <p className="rounded-xl border border-slate-800 p-6 text-slate-400">Henüz analiz yapılmadı. Hisse ve zaman dilimini seçip itki analizini başlatın.</p>}
            {impulseData.map((item) => {
              const imp = item.impulse_analysis;
              const w1 = imp?.dalga1;
              const w2 = imp?.dalga2;
              const w3 = imp?.dalga3_takip;
              return (
                <div
                  key={item.symbol}
                  className="workspace-panel workspace-panel-body space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-semibold text-white">{item.symbol}</span>
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-800 text-slate-300">
                        {item.interval}
                      </span>
                      {item.has_signal ? (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                          PU30 TESPİT EDİLDİ ({item.in_live_window ? "CANLI PENCEREDE" : `${item.bars_since_confirm} bar önce`})
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-900 border border-slate-700 text-slate-400">
                          {item.status ? `Veri kullanılamıyor: ${item.status}` : "Bu periyotta PU30 yok"}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      Son Kapanış: <strong className="text-white font-mono">{item.last_close ?? "—"} ₺</strong>
                    </div>
                  </div>

                  {item.status && <p className="text-amber-300 text-sm">{item.error_message || "Veri kalitesi veya geçmiş mum sayısı yetersiz; sinyal değerlendirilmedi."} · {item.bar_count ?? 0} mum</p>}

                  {item.has_signal && imp && (
                    <>
                      {/* 0 - 1 - 2 Anchor Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                          <div className="text-slate-400 font-bold">PU30 Dip 1 → Dip 2 (t0 = 0 Zaman)</div>
                          <div className="text-white font-mono font-bold mt-1 text-sm">
                            {item.dip1.price.toFixed(2)} ₺ → {item.dip2.price.toFixed(2)} ₺
                          </div>
                          <div className="text-emerald-400 font-mono mt-0.5">
                            RSI: {item.dip1.rsi.toFixed(1)} → {item.dip2.rsi.toFixed(1)}
                          </div>
                          <div className="text-slate-500 mt-1">
                            {item.dip1.date} → {item.dip2.date}
                          </div>
                        </div>

                        {w1 ? (
                          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3.5">
                            <div className="text-cyan-300 font-bold">1 Nolu İtki Dalgası (t0 → t1)</div>
                            <div className="text-white font-mono font-bold mt-1 text-sm">
                              {imp.p0_price} ₺ → {w1.p1_price} ₺ (+%{w1.gain_pct})
                            </div>
                            <div className="text-cyan-200 font-mono mt-0.5">
                              Süre: {w1.duration_bars} bar | RSI: {w1.rsi_start} → {w1.rsi_peak} (+{w1.rsi_delta})
                            </div>
                            <div className="text-slate-400 mt-1">
                              Yeşil Mum: %{Math.round(w1.bull_bar_ratio * 100)} | Gövde/Boy: {w1.avg_body_to_range} | Hacim: {w1.volume_multiplier}x
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-slate-400">
                            1-2 yapısı henüz kesinleşmedi ({imp.durum})
                          </div>
                        )}

                        {w2 && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5">
                            <div className="text-amber-300 font-bold">2 Nolu Düzeltme (t1 → t2 Zaman Startı)</div>
                            <div className="text-white font-mono font-bold mt-1 text-sm">
                              {w1.p1_price} ₺ → {w2.p2_price} ₺ (Fibo {w2.price_retracement_fib})
                            </div>
                            <div className="text-amber-200 font-mono mt-0.5">
                              Süre: {w2.duration_bars} bar | W2/W1 Süre: {w2.time_ratio_dt2_over_dt1}x
                            </div>
                            <div className="text-slate-400 mt-1">
                              t2 Tarihi: {w2.t2_date} | t1 Konumu (0..2): {w2.t1_position_in_02}
                            </div>
                          </div>
                        )}

                        {w3 && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5">
                            <div className="text-emerald-300 font-bold">3 Nolu Dalga (t2 Sonrası Gerçekleşen)</div>
                            <div className="text-white font-mono font-bold mt-1 text-sm">
                              Zirve: {w3.max_price_after_w2} ₺ ({w3.w1_tepesi_kirildi ? "W1 KIRILDI ✅" : "W1 Bekleniyor"})
                            </div>
                            <div className="text-emerald-200 font-mono mt-0.5">
                              W3/W1 Fiyat: {w3.w3_vs_w1_price_ratio}x | W3/W1 Süre: {w3.w3_vs_w1_time_ratio}x
                            </div>
                            <div className="text-slate-400 mt-1">
                              Zirve Tarihi: {w3.max_date_after_w2} (+{w3.bars_from_t2_to_peak} bar)
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Fib Time Table */}
                      {imp.fib_zaman_w1_referans && (
                        <div className="overflow-x-auto rounded-xl border border-slate-800">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-900/90 text-slate-400 uppercase">
                              <tr>
                                <th className="py-2.5 px-3">Fib Zaman Seviyesi</th>
                                <th className="py-2.5 px-3">Mod A: W1-Bazlı (Δt1 × Oran)</th>
                                <th className="py-2.5 px-3">Mod A Kapanış</th>
                                <th className="py-2.5 px-3">Mod B: 0–2 Sündürme (Δt02 × Oran)</th>
                                <th className="py-2.5 px-3">Mod B Kapanış</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70 font-mono">
                              {["0.382", "0.618", "1.000", "1.382", "1.618", "2.618"].map((k) => {
                                const fa = imp.fib_zaman_w1_referans[k];
                                const fb = imp.fib_zaman_02_sundurme[k];
                                if (!fa || !fb) return null;
                                return (
                                  <tr key={k} className="hover:bg-slate-900/40">
                                    <td className="py-2 px-3 font-bold text-violet-300">Fib {k}</td>
                                    <td className="py-2 px-3 text-slate-300">
                                      +{fa.bar_offset} bar → {fa.target_date}
                                    </td>
                                    <td className="py-2 px-3 text-emerald-400 font-bold">
                                      {fa.close_at_target ? `${fa.close_at_target} ₺` : "Gelecek Bar"}
                                    </td>
                                    <td className="py-2 px-3 text-slate-300">
                                      +{fb.bar_offset} bar → {fb.target_date}
                                    </td>
                                    <td className="py-2 px-3 text-cyan-400 font-bold">
                                      {fb.close_at_target ? `${fb.close_at_target} ₺` : "Gelecek Bar"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: BACKTEST & RULES */}
      {activeTab === "backtest" && (
        <div className="space-y-6">
          <div className="workspace-panel workspace-panel-body space-y-4">
            <h2 className="text-lg font-semibold text-white">
              Kayıtlı BIST100 karşılaştırması
            </h2>
            <p className="text-xs text-slate-400">
              Kayıtlı referans tablosu. Bu ekranda yeniden hesaplanmaz; veri dönemi ve çalıştırma raporu bağlı olmadığından güncel doğrulama sonucu olarak değerlendirilmemelidir.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 uppercase">
                  <tr>
                    <th className="py-3 px-4">Periyot</th>
                    <th className="py-3 px-4">Giriş Tetik Modu</th>
                    <th className="py-3 px-4">İşlem Sayısı</th>
                    <th className="py-3 px-4">Başarı (Win Rate)</th>
                    <th className="py-3 px-4">Ort. Getiri</th>
                    <th className="py-3 px-4">Medyan Getiri</th>
                    <th className="py-3 px-4">Profit Factor</th>
                    <th className="py-3 px-4">Açıklama</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {BIST100_BACKTEST_SUMMARY.map((row, i) => (
                    <tr
                      key={i}
                      className={row.highlight ? "bg-emerald-950/20 text-emerald-200" : "text-slate-300"}
                    >
                      <td className="py-3 px-4 font-bold">{row.tf}</td>
                      <td className="py-3 px-4 font-sans font-bold">{row.mode}</td>
                      <td className="py-3 px-4">{row.signals}</td>
                      <td className="py-3 px-4 font-bold text-emerald-400">{row.winRate}</td>
                      <td className="py-3 px-4 font-bold text-cyan-300">{row.avgRet}</td>
                      <td className="py-3 px-4">{row.medianRet}</td>
                      <td className="py-3 px-4 font-bold">{row.pf}</td>
                      <td className="py-3 px-4 font-sans text-slate-400">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="workspace-panel workspace-panel-body space-y-4">
            <h2 className="text-lg font-semibold text-white">Kural doğrulama matrisi</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RULE_MATRIX.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-emerald-400">{r.id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-200">
                      {r.status}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white">{r.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{r.rule}</p>
                  <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/30 border border-cyan-500/20 rounded-lg px-2.5 py-1.5">
                    Örnek: {r.examples}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PYTEST SUITE */}
      {activeTab === "pytest" && (
        <div className="workspace-panel workspace-panel-body space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Birim ve regresyon testleri</h2>
              <p className="text-xs text-slate-400">
                Paket seçin ve çalıştırın. Veri güvenilirliği ağ gerektirmeyen timeout, önbellek ve eksik mum senaryolarını doğrular; MTF paketi strateji Lab kurallarını denetler.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => runPytestSuite()}
                disabled={loadingPytest}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-500 disabled:opacity-50"
              >
                {loadingPytest ? "Yükleniyor…" : executionMode === "report" ? "Seçilen paketin raporunu göster" : "Seçilen paketi çalıştır"}
              </button>
              <button
                onClick={() => runPytestSuite("all")}
                disabled={loadingPytest || executionMode === "report"}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 font-bold text-xs hover:bg-slate-800 disabled:opacity-50"
              >
                Tüm testleri çalıştır
              </button>
            </div>
          </div>

          {executionMode === "report" && <p className="rounded-xl border border-cyan-500/30 p-3 text-xs text-cyan-200">Vercel görünümü: Testler geliştirme / CI ortamında çalıştırılır. Burada yayınla birlikte gelen tarihli rapor incelenir; canlıda yeniden çalıştırılmaz.</p>}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Test paketi seçimi">
            {suites.map((suite) => <button key={suite.id} aria-pressed={selectedSuite === suite.id} disabled={loadingPytest} onClick={() => setSelectedSuite(suite.id)} className={`rounded-xl border p-4 text-left ${selectedSuite === suite.id ? "border-emerald-500 bg-emerald-950/40" : "border-slate-700 bg-slate-950"}`}>
              <strong className="text-sm text-white">{suite.label}</strong><span className="block text-xs text-slate-400 mt-2">{suite.description}</span>
            </button>)}
          </div>
          {loadingPytest && <p role="status" className="text-cyan-300 text-sm">Testler çalışıyor. Tamamlandığında her testin sonucu ve süresi burada gösterilecek.</p>}
          {!loadingPytest && !pytestData && <EmptyState title="Henüz test sonucu yok" description="Bir test paketi seçip doğrulamayı başlatın. Geçen ve başarısız kontroller burada gösterilecek." />}

          {pytestData && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                    pytestData.passed
                      ? "bg-emerald-950 border border-emerald-500/50 text-emerald-300"
                      : "bg-rose-950 border border-rose-500/50 text-rose-300"
                  }`}
                >
                  {pytestData.timed_out ? "Süre sınırına ulaşıldı" : pytestData.passed ? "Paket geçti" : `Paket başarısız (kod ${pytestData.exit_code})`}
                </span>
                <span className="text-xs text-slate-400">{pytestData.label} · {pytestData.duration_sec} sn · {new Date(pytestData.completed_at).toLocaleString("tr-TR")}</span>
              </div>
              <div className="workspace-metrics" aria-live="polite">
                {([ ["Toplam", pytestData.summary.total], ["Geçen", pytestData.summary.passed], ["Başarısız", pytestData.summary.failed], ["Hata", pytestData.summary.error], ["Atlanan", pytestData.summary.skipped] ] as const).map(([label, count]) => <MetricCard key={label} label={label} value={count} />)}
              </div>
              <div className="max-h-96 overflow-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs"><caption className="sr-only">Test sonuçları</caption><thead className="bg-slate-900 text-slate-300"><tr><th className="p-3">Test</th><th className="p-3">Sonuç</th><th className="p-3">Süre</th></tr></thead><tbody>
                  {pytestData.results.map((test, i) => <tr key={i} className="border-t border-slate-800"><td className="p-3 break-all text-slate-300">{test.name}{test.message && <p className="mt-1 text-rose-300">{test.message}</p>}</td><td className={`p-3 ${test.status === "passed" ? "text-emerald-300" : "text-amber-300"}`}>{({passed: "Geçti", failed: "Başarısız", error: "Hata", skipped: "Atlandı"} as Record<string, string>)[test.status]}</td><td className="p-3 text-slate-400">{test.duration_sec} sn</td></tr>)}
                </tbody></table>
              </div>
              <details><summary className="cursor-pointer text-sm text-slate-400">Ayrıntılı test çıktısı</summary>
              <pre className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                {pytestData.output}
              </pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIVE SIGNAL JOURNAL */}
      {activeTab === "journal" && (
        <div className="workspace-panel workspace-panel-body space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Sinyal günlüğü</h2>
              <p className="text-xs text-slate-400">
                Tarayıcı çalıştıkça tespit edilen tüm sinyallerin `knowable_at` zaman damgası ve saatlik güven seviyeleriyle değiştirilemez (append-only) kaydı.
              </p>
            </div>
            <button
              onClick={loadJournal}
              disabled={loadingJournal}
              className="px-4 py-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-bold text-xs"
            >
              {loadingJournal ? "Yükleniyor..." : "Günlüğü yenile"}
            </button>
          </div>

          {journalRows.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-slate-400 text-xs">
              Henüz kayıtlı sinyal günlüğü satırı yok veya tarayıcı yeni başlatıldı. Tarayıcı çalıştırıldığında otomatik kaydedilir.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-900 text-slate-400 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Sembol</th>
                    <th className="py-2.5 px-3">TF</th>
                    <th className="py-2.5 px-3">Tip</th>
                    <th className="py-2.5 px-3">1. Dip/Tepe</th>
                    <th className="py-2.5 px-3">2. Dip/Tepe</th>
                    <th className="py-2.5 px-3">Saatlik Güven Seviyesi</th>
                    <th className="py-2.5 px-3">Durum</th>
                    <th className="py-2.5 px-3">Bilinebilir Zaman</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {journalRows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 font-bold text-white">{r.symbol}</td>
                      <td className="py-2 px-3 text-slate-300">{r.interval}</td>
                      <td className="py-2 px-3 text-emerald-400 font-bold">{r.signal_type}</td>
                      <td className="py-2 px-3 text-slate-300">
                        {r.p1_price} (RSI {r.p1_rsi})
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        {r.p2_price} (RSI {r.p2_rsi})
                      </td>
                      <td className="py-2 px-3 text-cyan-300">{r.trust_level_price || "—"}</td>
                      <td className="py-2 px-3 text-amber-300">{r.trust_level_state || "—"}</td>
                      <td className="py-2 px-3 text-slate-400">{r.knowable_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </section>
    </WorkspacePage>
  );
}
