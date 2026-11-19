"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspacePage, MetricCard, EmptyState } from "@/components/ui/Workspace";
import { BIST_30 } from "@/lib/indices";

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
    meaning: "Aşırı satım/alım bölgesinden net dönüş gelmeden erken ve gürültülü sinyalleri eler.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "VAKBN-HAMMER",
    title: "2. Dip Dönüş Mumunda RSI Kontrolü & En Derin Ana Dip (5 Kasım 2026)",
    rule: "Sol penceredeki bir mumda RSI < 30 sarkmış olsa bile, 2. dip pivot mumunun kendisinde (p) veya hemen sağındaki dönüş mumunda (p+1) RSI > 30 ise kabul edilir; birden fazla aday 1. dip varsa en derin ana dip seçilir.",
    examples: "VAKBN 1s: 1. Dip 28.82 TL (RSI 14.8) -> 2. Dip 28.40 TL çekiç mumu (RSI 32.1 > 30)",
    meaning: "Pencere ortalama değil tepki mumunun kendi momentumunu baz alarak çekiç diplerini kaçırmaz.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "ISCTR-KURUS",
    title: "Kuruş Toleranslı İkili Dip / Yatay Mavi Çizgi (%0.25, 5 Kasım 2026)",
    rule: "2. dip fiyatı 1. dibin en fazla +%0.25 üstündeyse (BIST kademe/kuruş farkı) yatay ikili dip olarak PU30 kabul edilir; >%0.25 yüksek dipler reddedilir.",
    examples: "ISCTR 1s: 1. Dip 11.64 TL (RSI 18.7) -> 2. Dip 11.66 TL (+%0.17 / 2 kuruş fark, RSI 36.8 > 30)",
    meaning: "BIST fiyat adımlarındaki 1-2 kademelik sapmalar yüzünden temiz ikili dip fırsatlarını atlamaz.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "ASELS-TRUST",
    title: "Saatlik Güven Tazeleyen Tepe / Güven Kıran Dip (ASELS Örneği)",
    rule: "2. dipten (t0) sonra dibi kıramayan ilk kesinleşmiş saatlik dip (t2) oluştuğunda, aradaki en yüksek saatlik fiyat (t1) Güven Tazeleyen Tepe olur. Üzerinde saatlik kapanış = AL.",
    examples: "ASELS 4s NU70: 450.00 -> 439.50 -> Güven Kıran Dip 423.00 (kapanış 421.25)",
    meaning: "Alt zaman diliminde yapı kırılmadan körü körüne ters yöne işlem açılmasını engeller.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "IMPULSE-FIBTIME",
    title: "1-2 İtki Dalgası & Fibonacci Zaman Sündürme (Testbed)",
    rule: "PU30 dibi = 0 zaman (t0), 1 nolu itki dalgası tepesi = orta referans (t1), 2 nolu düzeltme dibi = zaman startı (t2). Fib Zaman 0.382 / 0.618 / 1.000 / 1.618 hedefleri ve itki kalitesi ölçülür.",
    examples: "VAKBN 1s: W1 +%5.21 (6 bar, hacim 1.45x) -> W2 28.72 (Fib 0.784) -> W3 32.30 (W1'in 2.42 katı)",
    meaning: "Fiyatla birlikte zaman pencerelerini ölçerek 3. dalga ralli ivmesinin ne zaman geleceğini tahminler.",
    status: "TESTBED (Deneysel)",
  },
  {
    id: "NU70-HANGING-MAN",
    title: "Görülen En Yüksek Fiyatta RSI < 70 & Asılan Adam Zirve Kuralı (18 Kasım 2026)",
    rule: "NU70 için 2. tepe görülen en yüksek fiyat olmalı (teyit sonrası yeni yüksek tepe kırılırsa elenir) ve 2. tepe mumunda/teyidinde RSI < 70 oluşmalıdır. Ara bölgede aynı/yüksek fiyatta daha önce RSI >= 70 görülmüşse tekrar sinyal üretilmez. Zirvede Asılan Adam veya Kayan Yıldız dönüş mumu önceliklendirilir; küçük geri çekilmeli adaylar ayrı NU70_ADAY havuzunda izlenir.",
    examples: "PGSUS 1s (158.90 @ 85.8 -> 160.60 @ 59.7 < 70), THYAO 1s (Asılan Adam), SISE 1s (Kayan Yıldız)",
    meaning: "Zirvede momentum düşüşünü dönüş mumuyla teyit eder; yeni zirve yapan hisseleri ise listeden otomatik düşürür.",
    status: "AKTİF (NU70 Lab)",
  },
  {
    id: "MTF-1H-4H-FRACTAL",
    title: "1S NU70 Var / 4S NU70 Yok: Ara Salınım + 1 Zirve Daha & Kâr Hesabı Kuralı (19 Kasım 2026)",
    rule: "Saatlikte (1H) NU70 yakalandığında hemen 4 Saatlik (4H) grafik kontrol edilir. 4 Saatlikte henüz NU70 yoksa hisse önce kesin ara düzeltme (salınım) yapar, ardından 4 Saatlik NU70'i kurmak için en az 1 yeni zirve daha dener; asıl sert satış sonraki zirvede 4S NU70 oluştuğunda gelir.",
    examples: "THYAO 1S NU70 var, 4S NU yok -> Bu salınımda 1R hedefinden kâr al; sonraki yeni zirvede 4S NU doğduğunda sert satış bekle.",
    meaning: "Saatlik zirvede aşırı hırslı short taşıyıp yeni zirve hareketine yakalanmayı önler; 1R kısa kâr + 2R sert satış ayrımı kurar.",
    status: "AKTİF (NU70 Lab)",
  },
];

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<"impulse" | "pytest" | "backtest" | "journal" | "longshort" | "nu70lab">("pytest");
  const [symbolsInput, setSymbolsInput] = useState("VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS");
  const [interval, setIntervalVal] = useState<"1h" | "4h" | "1d">("1h");
  const [impulseData, setImpulseData] = useState<any[]>([]);
  const [loadingImpulse, setLoadingImpulse] = useState(false);
  const impulseRequest = useRef(0);

  const [lsSymbolsInput, setLsSymbolsInput] = useState("TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS");
  const [lsInterval, setLsInterval] = useState<"1h" | "4h" | "1d">("1h");
  const [lsViopOnly, setLsViopOnly] = useState(false);
  const [lsData, setLsData] = useState<any | null>(null);
  const [loadingLs, setLoadingLs] = useState(false);

  const [nu70SymbolsInput, setNu70SymbolsInput] = useState("TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS");
  const [nu70Interval, setNu70Interval] = useState<"1h" | "4h" | "1d">("1h");
  const [nu70ViopOnly, setNu70ViopOnly] = useState(false);
  const [nu70Filter, setNu70Filter] = useState<"all" | "candle" | "triggered">("all");
  const [nu70Data, setNu70Data] = useState<any | null>(null);
  const [loadingNu70, setLoadingNu70] = useState(false);
  const nu70Request = useRef(0);

  const [pytestData, setPytestData] = useState<TestReport | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState("resilience");
  const [executionMode, setExecutionMode] = useState<"local" | "report">("local");
  const [loadingPytest, setLoadingPytest] = useState(false);

  const [journalRows, setJournalRows] = useState<any[]>([]);
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runLongShortScan = async (syms?: string, tf?: string, viop?: boolean) => {
    setLoadingLs(true);
    setError(null);
    try {
      const s = syms ?? lsSymbolsInput;
      const i = tf ?? lsInterval;
      const v = viop ?? lsViopOnly;
      const qs = new URLSearchParams({ mode: "longshort", symbols: s, interval: i, viop_only: String(v) }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Long/Short taraması başarısız");
      setLsData(json);
    } catch (e: any) {
      setError(e?.message || "Long/Short hatası");
    } finally {
      setLoadingLs(false);
    }
  };

  const runNu70LabScan = async (syms?: string, tf?: string, viop?: boolean) => {
    const requestId = ++nu70Request.current;
    setLoadingNu70(true);
    setError(null);
    try {
      const s = syms ?? nu70SymbolsInput;
      const i = tf ?? nu70Interval;
      const v = viop ?? nu70ViopOnly;
      const qs = new URLSearchParams({ mode: "nu70lab", symbols: s, interval: i, viop_only: String(v) }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (requestId !== nu70Request.current) return;
      if (json.status !== "success") throw new Error(json.detail || "NU70 Zirve Lab taraması başarısız");
      setNu70Data(json);
    } catch (e: any) {
      if (requestId === nu70Request.current) setError(e?.message || "NU70 Lab hatası");
    } finally {
      if (requestId === nu70Request.current) setLoadingNu70(false);
    }
  };

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
      else if (["pytest", "impulse", "journal", "longshort", "nu70lab"].includes(tab)) setActiveTab(tab as any);
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
          { id: "longshort", label: "Long / Short Matrisi" },
          { id: "nu70lab", label: "NU70 & Asılan Adam Lab" },
          { id: "impulse", label: "İtki analizi" },
          { id: "backtest", label: "Referans ve kurallar" },
          { id: "journal", label: "Sinyal günlüğü" },
        ] as const).map(tab => <button key={tab.id} id={`lab-tab-${tab.id}`} role="tab"
          aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} aria-controls="lab-panel" className="workspace-tab"
          onClick={() => {
            setActiveTab(tab.id);
            window.history.replaceState(null, "", `#${tab.id === "backtest" ? "reference" : tab.id}`);
            if (tab.id === "journal" && journalRows.length === 0) loadJournal();
            if (tab.id === "longshort" && !lsData) runLongShortScan();
            if (tab.id === "nu70lab" && !nu70Data) runNu70LabScan();
          }}>{tab.label}</button>)}
      </div>
      <section id="lab-panel" role="tabpanel" aria-labelledby={`lab-tab-${activeTab}`}>
      {error && (
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* TAB 0: LONG / SHORT KARAR MATRİSİ */}
      {activeTab === "longshort" && (
        <div className="space-y-6">
          <div className="workspace-panel workspace-panel-body space-y-4">
            <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end justify-between">
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Taranacak Hisseler
                  </label>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        const p = "TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS";
                        setLsSymbolsInput(p);
                        runLongShortScan(p);
                      }}
                      className="text-cyan-400 hover:underline"
                    >
                      BIST13 Popüler
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        setLsSymbolsInput("ALL");
                        runLongShortScan("ALL");
                      }}
                      className="text-cyan-400 hover:underline"
                    >
                      Tüm BIST100
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={lsSymbolsInput}
                  onChange={(e) => setLsSymbolsInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-cyan-500 focus:outline-none"
                  placeholder="Hisseleri virgülle ayırın veya 'ALL' yazın"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Zaman Dilimi
                  </label>
                  <div className="flex gap-1">
                    {(["1h", "4h", "1d"] as const).map((tf) => (
                      <button
                        key={tf}
                        onClick={() => {
                          setLsInterval(tf);
                          runLongShortScan(lsSymbolsInput, tf);
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                          lsInterval === tf
                            ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {tf.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={lsViopOnly}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setLsViopOnly(checked);
                        runLongShortScan(lsSymbolsInput, lsInterval, checked);
                      }}
                      className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                    />
                    <span>Yalnızca VİOP Vadeli</span>
                  </label>
                </div>

                <div className="pt-4">
                  <button
                    onClick={() => runLongShortScan()}
                    disabled={loadingLs}
                    className="w-full lg:w-auto px-5 py-2 rounded-xl border border-cyan-500/50 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-950/50 transition-all disabled:opacity-50"
                  >
                    {loadingLs ? "Taranıyor..." : "⚡ Matrisi Güncelle"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Market Bias & Exposure Header */}
          {lsData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="workspace-panel workspace-panel-body md:col-span-2 border-l-4 border-l-cyan-500 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Piyasa Rejim & Yön Özeti</span>
                    <h3 className="text-base font-extrabold text-white mt-1">
                      {lsData.market_bias}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Onaylı Long (GVT üstü) ve onaylı Short (GKD altı) dengesine göre piyasanın baskın yönünü özetler.
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs font-mono">
                    <span className="text-emerald-400">🟢 Aktif Long: <strong>{lsData.long_active_count}</strong></span>
                    <span className="text-rose-400">🔴 Aktif Short: <strong>{lsData.short_active_count}</strong></span>
                    <span className="text-slate-400">Taranan: {lsData.total_scanned}</span>
                  </div>
                </div>

                <div className="workspace-panel workspace-panel-body border-l-4 border-l-emerald-500">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">Long Sinyalleri</span>
                  <div className="text-2xl font-black text-emerald-400 mt-1">{lsData.long_total}</div>
                  <div className="text-[11px] text-slate-400 mt-1">GVT aşılan: {lsData.long_active_count} onaylı</div>
                  <p className="text-[11px] text-slate-500 mt-1">1. dip RSI &lt; 30 sonrası yükselen RSI dip dönüşleri.</p>
                </div>

                <div className="workspace-panel workspace-panel-body border-l-4 border-l-rose-500">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400">Short / Kâr Al</span>
                  <div className="text-2xl font-black text-rose-400 mt-1">{lsData.short_total}</div>
                  <div className="text-[11px] text-slate-400 mt-1">GKD kırılan: {lsData.short_active_count} teyitli</div>
                  <p className="text-[11px] text-slate-500 mt-1">1. tepe RSI &gt; 70 sonrası düşen RSI zirve yorulmaları.</p>
                </div>
              </div>

              {/* Pair Trading / Hedge Kartı */}
              {lsData.pair_trading && (
                <div className="workspace-panel workspace-panel-body border border-indigo-500/30 bg-indigo-950/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-500/30 text-indigo-300 border border-indigo-500/40">
                      ⚖️ PİYASA-NÖTR ARBİTRAJ / HEDGE
                    </span>
                    <span className="text-xs text-slate-400">Endeks riskinden arındırılmış alfa eşleşmesi</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-2">
                    <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-emerald-400 font-bold">🟢 UZUN (LONG) AYAĞI</span>
                        <div className="text-lg font-black text-white">{lsData.pair_trading.long_symbol} · {lsData.pair_trading.long_price} ₺</div>
                      </div>
                      <span className="text-[11px] text-emerald-300 font-mono">{lsData.pair_trading.long_confluence}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-rose-400 font-bold">🔴 KISA (SHORT / VİOP) AYAĞI</span>
                        <div className="text-lg font-black text-white">{lsData.pair_trading.short_symbol} · {lsData.pair_trading.short_price} ₺</div>
                      </div>
                      <span className="text-[11px] text-rose-300 font-mono">{lsData.pair_trading.short_confluence}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 mt-2">{lsData.pair_trading.thesis}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    📌 Ne Anlama Geliyor? Endeks düşse de çıksa da göreceli getiri (spread) yakalamak için aynı anda güçlü Long + zayıf Short eşleşmesi önerir.
                  </p>
                </div>
              )}

              {/* Two Column Side-by-Side: Long vs Short */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* LONG KANADI */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                        Long Kanadı (Spot Alım & VİOP Uzun)
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{lsData.longs?.length || 0} aday</span>
                  </div>

                  {(!lsData.longs || lsData.longs.length === 0) ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-slate-400 text-xs">
                      Seçili parametrelerde aktif PU30 alım adayı bulunamadı.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {lsData.longs.map((item: any, i: number) => (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border transition-all ${
                            item.triggered
                              ? "bg-slate-900/90 border-emerald-500/40 shadow-sm"
                              : "bg-slate-950/60 border-slate-800/80 opacity-80"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-white">{item.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                                {item.interval.toUpperCase()}
                              </span>
                              {item.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.triggered
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {item.status_text}
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-xs font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Fiyat / Giriş</span>
                              <span className="text-white font-bold">{Number(item.last_close).toFixed(2)} ₺</span>
                              <span className="text-[10px] text-emerald-400/80 block">GVT: {item.entry_level != null ? Number(item.entry_level).toFixed(2) : "—"}</span>
                              <span className="text-[9px] text-slate-500 block">Alım kırılım eşiği</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Stop-Loss</span>
                              <span className="text-rose-400 font-bold">{Number(item.stop_loss).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">Dip altı koruma</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Hedef TP1</span>
                              <span className="text-emerald-400 font-bold">{Number(item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">2x risk kâr hedefi</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">R:R Oranı</span>
                              <span className="text-cyan-300 font-bold">{item.rr_ratio}x</span>
                              <span className="text-[9px] text-slate-500 block">Ödül / Risk katı</span>
                            </div>
                          </div>
                          <p className="mt-2.5 pt-2 border-t border-slate-800/60 text-[11px] text-slate-400 leading-relaxed">
                            <strong className="text-slate-300">📌 Ne Anlama Geliyor?</strong>{" "}
                            {item.triggered
                              ? `${item.entry_level != null ? `${Number(item.entry_level).toFixed(2)} ₺ ` : ""}GVT eşiği yukarı geçilmiş; alım teyitli. ${Number(item.stop_loss).toFixed(2)} ₺ stop altında kapanmadıkça ${Number(item.target_tp1).toFixed(2)} ₺ hedeflenir.`
                              : `PU30 dip dönüşü oluştu; alım teyidi için ${item.entry_level != null ? `${Number(item.entry_level).toFixed(2)} ₺ ` : ""}GVT direnci üzerinde kapanış bekleniyor (Stop: ${Number(item.stop_loss).toFixed(2)} ₺).`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* SHORT KANADI */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-rose-400">
                        Short Kanadı (Spot Kâr Al & VİOP Açığa Satış)
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{lsData.shorts?.length || 0} aday</span>
                  </div>

                  {(!lsData.shorts || lsData.shorts.length === 0) ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-slate-400 text-xs">
                      Seçili parametrelerde aktif NU70 satış / düzeltme adayı bulunamadı.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {lsData.shorts.map((item: any, i: number) => (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border transition-all ${
                            item.triggered
                              ? "bg-slate-900/90 border-rose-500/40 shadow-sm"
                              : "bg-slate-950/60 border-slate-800/80 opacity-80"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-white">{item.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                                {item.interval.toUpperCase()}
                              </span>
                              {item.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              {item.is_hanging_man && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-200 border border-rose-400/40">
                                  🕯️ Asılan Adam
                                </span>
                              )}
                              {!item.is_hanging_man && item.is_shooting_star && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-200 border border-orange-400/40">
                                  ☄️ Kayan Yıldız
                                </span>
                              )}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.triggered
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {item.status_text}
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-xs font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Fiyat / Kırılan</span>
                              <span className="text-white font-bold">{Number(item.last_close).toFixed(2)} ₺</span>
                              <span className="text-[10px] text-rose-400/80 block">
                                GKD: {item.gkd_price != null ? Number(item.gkd_price).toFixed(2) : "Bekleniyor"}
                              </span>
                              <span className="text-[9px] text-slate-500 block">Satış kırılım eşiği</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">İptal Stopu</span>
                              <span className="text-amber-400 font-bold">{Number(item.stop_loss).toFixed(2)} ₺</span>
                              {item.tepe1_rsi != null && item.tepe2_rsi != null && (
                                <span className="text-[10px] text-slate-400 block">RSI {item.tepe1_rsi}→{item.tepe2_rsi}</span>
                              )}
                              <span className="text-[9px] text-slate-500 block">Zirve +%2.5 stop</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Destek Hedef</span>
                              <span className="text-rose-400 font-bold">{Number(item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">2x risk düşüş hedefi</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">R:R Oranı</span>
                              <span className="text-cyan-300 font-bold">{item.rr_ratio}x</span>
                              <span className="text-[9px] text-slate-500 block">Ödül / Risk katı</span>
                            </div>
                          </div>
                          <p className="mt-2.5 pt-2 border-t border-slate-800/60 text-[11px] text-slate-400 leading-relaxed">
                            <strong className="text-slate-300">📌 Ne Anlama Geliyor?</strong>{" "}
                            {item.triggered
                              ? `${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺ ` : ""}GKD desteği aşağı kırılmış (spotta kâr al / VİOP short aktif). Fiyat ${Number(item.stop_loss).toFixed(2)} ₺ üzerine çıkmadıkça ${Number(item.target_tp1).toFixed(2)} ₺ hedefi geçerlidir.`
                              : `Zirvede NU70 yorulması var ancak ${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺ ` : ""}GKD kırılımı henüz gelmedi; erken şort için bu desteğin altında kapanış beklenir (Stop: ${Number(item.stop_loss).toFixed(2)} ₺).`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: NU70 & ASILAN ADAM ZİRVE LABORATUVARI (AYRI BÖLÜM) */}
      {activeTab === "nu70lab" && (() => {
        const matchNu70Filter = (item: any) => {
          if (nu70Filter === "candle") return Boolean(item.is_hanging_man || item.is_shooting_star);
          if (nu70Filter === "triggered") return Boolean(item.triggered ?? item.gkd_broken);
          return true;
        };
        const strictRows = (nu70Data?.strict_signals || []).filter(matchNu70Filter);
        const earlyRows = (nu70Data?.early_candidates || []).filter(matchNu70Filter);
        const invalidatedRows = nu70Data?.invalidated_signals || [];
        return (
          <div className="space-y-6">
            <div className="workspace-panel workspace-panel-body space-y-4 border-l-4 border-l-rose-500">
              <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      NU70 &amp; Asılan Adam Evreni (Ayrıştırılmış Lab)
                    </label>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          const p = "TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS";
                          setNu70SymbolsInput(p);
                          runNu70LabScan(p);
                        }}
                        className="text-cyan-400 hover:underline"
                      >
                        BIST13 Popüler
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          const p = BIST_30.join(",");
                          setNu70SymbolsInput(p);
                          runNu70LabScan(p);
                        }}
                        className="text-cyan-400 hover:underline"
                      >
                        BIST30
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setNu70SymbolsInput("ALL");
                          runNu70LabScan("ALL");
                        }}
                        className="text-cyan-400 hover:underline"
                      >
                        Tüm BIST100
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={nu70SymbolsInput}
                    onChange={(e) => setNu70SymbolsInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-rose-500 focus:outline-none"
                    placeholder="Hisseleri virgülle ayırın veya 'ALL' yazın"
                  />
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Zaman Dilimi
                    </label>
                    <div className="flex gap-1">
                      {(["1h", "4h", "1d"] as const).map((tf) => (
                        <button
                          key={tf}
                          onClick={() => {
                            setNu70Interval(tf);
                            runNu70LabScan(nu70SymbolsInput, tf);
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                            nu70Interval === tf
                              ? "bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {tf.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Filtre
                    </label>
                    <div className="flex gap-1">
                      {([
                        { id: "all", label: "Tümü" },
                        { id: "candle", label: "🕯️ Asılan Adam / Kayan Yıldız" },
                        { id: "triggered", label: "⚡ GKD Kırılanlar" },
                      ] as const).map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setNu70Filter(f.id)}
                          className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                            nu70Filter === f.id
                              ? "bg-amber-500/20 border-amber-500 text-amber-200"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 pb-2 cursor-pointer select-none text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={nu70ViopOnly}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setNu70ViopOnly(checked);
                        runNu70LabScan(nu70SymbolsInput, nu70Interval, checked);
                      }}
                      className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-0"
                    />
                    <span>Sadece VİOP</span>
                  </label>

                  <button
                    onClick={() => runNu70LabScan()}
                    disabled={loadingNu70}
                    className="w-full lg:w-auto px-5 py-2 rounded-xl border border-rose-500/50 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-950/50 transition-all disabled:opacity-50"
                  >
                    {loadingNu70 ? "Taranıyor..." : "NU70 Zirve Taraması Başlat"}
                  </button>
                </div>
              </div>
            </div>

            {!nu70Data && !loadingNu70 && (
              <EmptyState
                title="NU70 & Asılan Adam Zirve Laboratuvarı Hazır"
                description="Görülen en yüksek fiyatta RSI < 70 oluşturan katı NU70 zirvelerini, Asılan Adam / Kayan Yıldız mumlarını, erken izleme adaylarını ve yeni zirve ile iptal edilen eski tepeleri Long / Short Matrisi'nden bağımsız olarak inceleyin."
                action={
                  <button
                    onClick={() => runNu70LabScan()}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                  >
                    NU70 Zirve Taraması Başlat
                  </button>
                }
              />
            )}

            {nu70Data && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="Taranan Evren"
                    value={nu70Data.total_scanned}
                    detail={`${String(nu70Data.interval || nu70Interval).toUpperCase()} · ${nu70Data.triggered_count} GKD kırılımı`}
                  />
                  <MetricCard
                    label="Katı NU70 Zirve (RSI < 70)"
                    value={nu70Data.strict_count}
                    detail="Görülen en yüksek fiyat · >=%3 geri çekilme"
                  />
                  <MetricCard
                    label="Asılan Adam / Kayan Yıldız"
                    value={nu70Data.candle_confirmed_count}
                    detail={`${nu70Data.hanging_man_count} Asılan Adam · ${nu70Data.shooting_star_count} Kayan Yıldız`}
                  />
                  <MetricCard
                    label="Erken Tepe İzleme (NU70_ADAY)"
                    value={nu70Data.early_count}
                    detail={`${nu70Data.invalidated_count} yeni zirvede iptal edilen`}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-slate-400">
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                    <strong className="text-slate-200">1. Tepe → 2. Tepe (NU70):</strong> Fiyat daha yüksek zirve yaparken RSI 70 üstünden 70 altına düşerse alıcı gücü zayıflıyor demektir.
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                    <strong className="text-rose-300">GKD (Güven Kıran Dip):</strong> Alt periyottaki (1H için 15dk, 4H/1D için 1H) kırılım desteği. Altında kapanış gelmeden erken şort açılmaz.
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                    <strong className="text-amber-300">Stop / 2R Hedef / Yaş:</strong> Stop: 2. tepe +%2.5 (aşılırsa düşüş tezi biter). 2R: riskin 2 katı kâr hedefi. Yaş: teyitten beri geçen mum sayısı.
                  </div>
                </div>

                {nu70Data.scan_error_count > 0 && (
                  <div className="workspace-notice workspace-notice-warning text-xs font-mono">
                    <strong>Veri / Tarama Uyarıları ({nu70Data.scan_error_count}):</strong>{" "}
                    {(nu70Data.scan_errors || [])
                      .slice(0, 6)
                      .map((e: any) => `${e.symbol}: ${e.error}`)
                      .join(" | ")}
                  </div>
                )}

                {/* BÖLÜM 1: KATI NU70 ZİRVE & ASILAN ADAM SİNYALLERİ */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-rose-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-rose-300">
                        Bölüm 1 — Katı NU70 Zirve &amp; Asılan Adam Sinyalleri
                      </h3>
                      <p className="text-xs text-slate-400">
                        Görülen en yüksek fiyatta RSI &lt; 70, ara bölgede aynı fiyatta RSI &gt;= 70 tekrarı yok ve teyit sonrası aşılmamış zirveler.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-rose-300">
                      {strictRows.length} aktif sinyal
                    </span>
                  </div>

                  {strictRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs text-slate-400">
                      Seçili filtre ve evrende aktif katı NU70 sinyali bulunamadı.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {strictRows.map((item: any, idx: number) => (
                        <div
                          key={`${item.symbol}-${idx}`}
                          className={`p-4 rounded-xl border bg-slate-950/90 space-y-3 ${
                            item.triggered ? "border-rose-500/60" : "border-slate-800"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-white">{item.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                                {String(item.interval).toUpperCase()}
                              </span>
                              {item.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              {item.is_hanging_man && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/25 text-rose-200 border border-rose-400/50">
                                  🕯️ Asılan Adam
                                </span>
                              )}
                              {!item.is_hanging_man && item.is_shooting_star && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/25 text-orange-200 border border-orange-400/50">
                                  ☄️ Kayan Yıldız
                                </span>
                              )}
                              {!item.is_hanging_man && !item.is_shooting_star && item.candle_label && item.candle_label !== "Yok" && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                                  {item.candle_label}
                                </span>
                              )}
                              {item.fractal_phase_badge && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    item.fractal_phase_code === "SALINIM_SONRA_YENI_ZIRVE"
                                      ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                                      : "bg-rose-500/20 text-rose-200 border-rose-500/40"
                                  }`}
                                >
                                  {item.fractal_phase_badge}
                                </span>
                              )}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.triggered
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {item.status_text}
                            </span>
                          </div>

                          <div className="text-xs font-mono text-slate-300 bg-slate-900/70 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                            <span>
                              1. Tepe <strong className="text-white">{Number(item.tepe1_price).toFixed(2)} ₺</strong> (RSI {item.tepe1_rsi})
                              {" → "}
                              2. Tepe <strong className="text-rose-300">{Number(item.tepe2_price).toFixed(2)} ₺</strong> (RSI {item.tepe2_rsi}
                              {item.rsi_at_peak != null ? `, Mum: ${item.rsi_at_peak}` : ""})
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Çekilme %{item.pullback_pct} · {item.gap_bars} bar
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Son / GKD</span>
                              <span className="text-white font-bold">{Number(item.last_close).toFixed(2)} ₺</span>
                              <span className="text-[10px] text-rose-400/80 block">
                                GKD: {item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺` : "Bekleniyor"}
                              </span>
                              <span className="text-[9px] text-slate-500 block">Satış tetik desteği</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">İptal Stopu</span>
                              <span className="text-amber-400 font-bold">{Number(item.stop_loss).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">Zirve +%2.5 koruma</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">1R Salınım / 2R Sert Satış Hedefi</span>
                              <span className="text-amber-300 font-bold block">1R Salınım: {Number(item.target_1r ?? item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-rose-400 font-bold block text-[11px]">2R Sert Satış: {Number(item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">Ara kâr al / Ana düşüş</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Teyit / Yaş</span>
                              <span className="text-cyan-300 font-bold">{item.rr_ratio}x · {item.bars_since_confirm} bar</span>
                              <span className="text-[9px] text-slate-500 block">R:R · teyit sonrası</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/70 leading-relaxed">
                            <strong className="text-slate-200">📌 Ne Anlama Geliyor?</strong>{" "}
                            Fiyat {Number(item.tepe1_price).toFixed(2)} ₺ → {Number(item.tepe2_price).toFixed(2)} ₺ ile yeni zirve yaparken RSI {item.tepe1_rsi} → {item.tepe2_rsi} (&lt;70) gerilemiş
                            {item.candle_label && item.candle_label !== "Yok" ? ` (${item.candle_label} mumu)` : ""}.{" "}
                            {item.triggered
                              ? `${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺ ` : ""}GKD aşağı kırıldığı için satış/short aktif; ${Number(item.stop_loss).toFixed(2)} ₺ aşılmadıkça ${Number(item.target_tp1).toFixed(2)} ₺ hedeflenir.`
                              : `${item.gkd_price != null ? `Şu an ${Number(item.last_close).toFixed(2)} ₺ fiyattan ${Number(item.gkd_price).toFixed(2)} ₺ GKD desteğinin kırılması bekleniyor.` : "Alt periyotta GKD kırılım desteği henüz oluşuyor."} ${Number(item.stop_loss).toFixed(2)} ₺ üstü iptaldir.`}
                          </p>
                          {item.fractal_profit_plan && (
                            <div
                              className={`rounded-lg px-3 py-2 text-[11px] leading-relaxed border ${
                                item.fractal_phase_code === "SALINIM_SONRA_YENI_ZIRVE"
                                  ? "bg-amber-950/30 border-amber-500/35 text-amber-100"
                                  : "bg-rose-950/30 border-rose-500/35 text-rose-100"
                              }`}
                            >
                              <strong>🎯 Semih Hoca Operasyon &amp; Kâr Hesabı Planı:</strong> {item.fractal_profit_plan}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BÖLÜM 2: ERKEN YÜKSEK TEPE & ASILAN ADAM İZLEME HAVUZU */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-amber-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-amber-300">
                        Bölüm 2 — Erken Yüksek Tepe &amp; Asılan Adam İzleme Havuzu (NU70_ADAY)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Katı NU70&apos;in %3 geri çekilme veya 5 bar aralık kuralını henüz doldurmamış ama görülen en yüksek fiyatta RSI &lt; 70 ve/veya dönüş mumu üreten adaylar.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-amber-300">
                      {earlyRows.length} izleme adayı
                    </span>
                  </div>

                  {earlyRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs text-slate-400">
                      Bu taramada erken izleme adayı (`NU70_ADAY`) bulunamadı.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {earlyRows.map((c: any, idx: number) => (
                        <div key={`${c.symbol}-${idx}`} className="p-3.5 rounded-xl border border-amber-500/30 bg-slate-950/90 space-y-2 text-xs font-mono">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{c.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                                {String(c.interval).toUpperCase()}
                              </span>
                              {c.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-200 border border-amber-500/30">
                                {c.candle_label && c.candle_label !== "Yok" ? c.candle_label : "Erken Tepe"}
                              </span>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.gkd_broken ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-slate-800 text-slate-300"}`}>
                              {c.gkd_broken ? "Ara Dip Altında" : "İzleme"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between text-slate-300 pt-1 border-t border-slate-800/70">
                            <span>
                              1. Tepe {Number(c.tepe1_price).toFixed(2)} (RSI {c.tepe1_rsi}) → 2. Tepe {Number(c.tepe2_price).toFixed(2)} (RSI {c.tepe2_rsi})
                            </span>
                            <span className="text-white font-bold">Son: {Number(c.last_close).toFixed(2)} ₺</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400">
                            <span>Ara Dip: {c.entry_level != null ? `${Number(c.entry_level).toFixed(2)} ₺` : "—"} · Stop: {Number(c.stop_loss).toFixed(2)} ₺</span>
                            <span>Çekilme %{c.pullback_pct} · {c.gap_bars} bar · {c.confirm_date}</span>
                          </div>
                          <p className="font-sans text-[11px] text-slate-400 pt-1.5 border-t border-slate-800/60 leading-relaxed">
                            <strong className="text-amber-200">📌 Ne Anlama Geliyor?</strong>{" "}
                            Görülen en yüksek tepede RSI {c.tepe2_rsi} (&lt;70) oluştu ama ara çekilme (%{c.pullback_pct}) veya {c.gap_bars} bar mesafe nedeniyle henüz erken izleme aşamasında.{" "}
                            {c.entry_level != null ? `${Number(c.entry_level).toFixed(2)} ₺ ara dip aşağı kırılırsa zayıflık hızlanabilir; ` : ""}
                            {Number(c.stop_loss).toFixed(2)} ₺ üstü iptaldir.
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BÖLÜM 3: YENİ ZİRVE İLE İPTAL EDİLEN ESKİ NU70 YAPILARI */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-slate-300">
                        Bölüm 3 — Yeni Zirve ile İptal Edilen Eski NU70 Yapıları (`HIGHER_HIGH_BROKEN`)
                      </h3>
                      <p className="text-xs text-slate-400">
                        NU70 teyidi geldikten sonra fiyat önceki 2. tepenin üzerine çıktığı için (ör. BIMAS örneği) aktif listeden elenen hisseler.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400">
                      {invalidatedRows.length} elenen
                    </span>
                  </div>

                  {invalidatedRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                      Yeni zirve kırılımıyla iptal edilmiş eski NU70 yapısı yok.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {invalidatedRows.map((inv: any, idx: number) => (
                        <div key={`${inv.symbol}-${idx}`} className="p-3 rounded-xl border border-slate-800 bg-slate-950/70 text-xs font-mono space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-200">{inv.symbol} · {String(inv.interval).toUpperCase()}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-rose-300">
                              {inv.invalidation_reason}
                            </span>
                          </div>
                          <div className="text-slate-400">
                            Eski 2. Tepe: {Number(inv.tepe2_price).toFixed(2)} ₺ (RSI {inv.tepe2_rsi}) · Son: <strong className="text-white">{Number(inv.last_close).toFixed(2)} ₺</strong>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Mum: {inv.candle_label} · Teyit: {inv.confirm_date}
                          </div>
                          <p className="font-sans text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                            <strong className="text-slate-300">📌 Neden Elendi?</strong>{" "}
                            Eski {Number(inv.tepe2_price).toFixed(2)} ₺ zirvesi sonradan yukarı kırıldığı için (son fiyat {Number(inv.last_close).toFixed(2)} ₺) önceki düşüş uyumu geçersizleşti.
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
                          <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                            Dönüşün başladığı ana taban ve RSI güçlenmesi.
                          </p>
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
                            <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                              İlk yükseliş dalgasının hızı, alıcı iştahı ve hacim desteği.
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-slate-400">
                            <div>1-2 yapısı henüz kesinleşmedi ({imp.durum})</div>
                            <p className="text-[11px] text-slate-500 mt-1.5">
                              1. tepe sonrası sağlıklı bir 2. dip oluşmadan Dalga 3 ölçülmez.
                            </p>
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
                            <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                              Ana dibi bozmayan geri çekilme derinliği; 0.382-0.786 arası idealdir.
                            </p>
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
                            <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                              W1 tepesi geçildiyse ana ralli fazı başlamış demektir (&gt;1.618x güçlü).
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Fib Time Table */}
                      {imp.fib_zaman_w1_referans && (
                        <div className="space-y-2">
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
                          <p className="text-[11px] text-slate-400 px-1">
                            <strong className="text-slate-200">📌 Tablo Nasıl Okunur?</strong>{" "}
                            Mod A (yalnızca 1. dalga süresi bazlı) ve Mod B (0→2 toplam düzeltme döngüsü bazlı), fiyatın ivme veya dönüş yapabileceği hedef tarih pencerelerini verir; <code className="text-slate-300">Gelecek Bar</code> yazan satırlar henüz gelmemiş ileri tarihli zaman hedefleridir.
                          </p>
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
            <p className="text-[11px] text-slate-400">
              <strong className="text-slate-200">📌 Sütun Rehberi:</strong>{" "}
              <strong>Başarı (Win Rate)</strong> kârlı kapanan işlem yüzdesini, <strong>Ort. / Medyan Getiri</strong> sinyal başına getiriyi (medyan uç değer etkisini ayıklar), <strong>Profit Factor</strong> ise toplam kârın toplam zarara oranını (&gt;1.50 güçlü sistem) gösterir.
            </p>
          </div>

          <div className="workspace-panel workspace-panel-body space-y-4">
            <h2 className="text-lg font-semibold text-white">Kural doğrulama matrisi</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RULE_MATRIX.map((r: any) => (
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
                  {r.meaning && (
                    <p className="text-[11px] text-slate-400 pt-1">
                      <strong className="text-slate-300">📌 Pratik Etkisi:</strong> {r.meaning}
                    </p>
                  )}
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
              <p className="text-[11px] text-slate-400">
                <strong className="text-slate-200">📌 Sonuçlar Ne Anlama Geliyor?</strong>{" "}
                Üretim geçişi için <strong>Başarısız = 0</strong>, <strong>Hata = 0</strong> ve <strong>Atlanan = 0</strong> olmalıdır; geçen her test ilgili matematiksel kuralın ve veri korumasının bozulmadığını doğrular.
              </p>
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
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-200">📌 Tablo Sütunları Ne Anlama Geliyor?</strong>{" "}
            <strong>1./2. Dip/Tepe</strong> uyumsuzluğun iki fiyat ve RSI ucunu, <strong>Saatlik Güven Seviyesi</strong> alt-periyot GVT/GKD kırılım eşik fiyatını, <strong>Durum</strong> eşiğin kırılıp kırılmadığını, <strong>Bilinebilir Zaman (knowable_at)</strong> ise sinyalin mum kapandıktan sonra canlıda ilk görülebildiği anı (gelecekten veri sızıntısı önlemi) gösterir.
          </p>
        </div>
      )}
      </section>
    </WorkspacePage>
  );
}
