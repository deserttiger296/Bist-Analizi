"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TrackerResult } from "@/lib/bist";
import Link from "next/link";
import SettingsDock, { ConfluenceWeights } from "./SettingsDock";
import { EmptyState, MetricCard, Panel, StatusBadge } from "@/components/ui/Workspace";

// ─── Index badge ────────────────────────────────────────────────────────────
const getIndexBadge = (tag?: string) => tag ? <StatusBadge>{tag}</StatusBadge> : null;

const POLL_INTERVAL_MS    = 60_000;
const fmt = (v?: number | null, d = 1) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(d));

// ─── Score Ring ─────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const dash = (pct / 100) * circ;
  const color = pct >= 70 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={4} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text
        x={size/2} y={size/2}
        textAnchor="middle" dominantBaseline="central"
        className="rotate-90" style={{ transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px` }}
        fill={color} fontSize={11} fontWeight={900}
      >
        {pct}
      </text>
    </svg>
  );
}

// ─── Mini Spark Bar ──────────────────────────────────────────────────────────
function SparkBars({ trend, momentum, volume }: { trend: number; momentum: number; volume: number }) {
  const bars = [
    { label: "T", val: trend,    color: trend >= 60    ? "#10b981" : "#475569" },
    { label: "M", val: momentum, color: momentum >= 60 ? "#f59e0b" : "#475569" },
    { label: "V", val: volume,   color: volume >= 60   ? "#06b6d4" : "#475569" },
  ];
  return (
    <div className="flex items-end gap-1 h-8">
      {bars.map(({ label, val, color }) => (
        <div key={label} className="flex flex-col items-center gap-0.5">
          <div
            className="w-3 rounded-t-sm transition-all duration-700"
            style={{ height: `${Math.max(4, (val / 100) * 28)}px`, backgroundColor: color }}
          />
          <span style={{ color, fontSize: 8, fontWeight: 900 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Status config map ───────────────────────────────────────────────────────
const STATUS_CONFIG = {
  STOP_KIRILDI: { label: "Stop kırıldı", tone: "negative" },
  ALARM_DIV: { label: "Uyumsuzluk", tone: "warning" },
  AL: { label: "Al sinyali", tone: "positive" },
  POTANSİYEL: { label: "Potansiyel", tone: "warning" },
  TUZAK: { label: "Boğa tuzağı", tone: "negative" },
  IZLE: { label: "İzle", tone: "neutral" },
  ZAYIF: { label: "Zayıf", tone: "neutral" },
} as const;

function getStatusConfig(item: TrackerResult) {
  if (item.quote?.stopLossBroken) return STATUS_CONFIG.STOP_KIRILDI;
  const hasDivergence = item.quote?.rsiDivBullish || item.quote?.macdDivBullish;
  const isTuzak = item.status === "TUZAK" || item.quote?.isFakeout;
  const isAl = item.status === "AL" || item.status === "ALARM";

  if (isTuzak) return STATUS_CONFIG.TUZAK;
  if (isAl && hasDivergence) return STATUS_CONFIG.ALARM_DIV;
  if (isAl) return STATUS_CONFIG.AL;
  if (item.status === "POTANSİYEL") return STATUS_CONFIG.POTANSİYEL;
  if (item.status === "İZLE" || item.status === "IZLE") return STATUS_CONFIG.IZLE;
  return STATUS_CONFIG.ZAYIF;
}

// ─── Stock Card ──────────────────────────────────────────────────────────────
function StockCard({ item }: { item: TrackerResult }) {
  const cfg = getStatusConfig(item);
  const change = item.quote?.change;
  const hasChange = change != null && Number.isFinite(change);
  const score = item.confluenceScore;
  return <Link href={`/analysis/${item.symbol}`} className="block workspace-panel hover:border-[#4c796b] transition-colors">
    <article className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-lg font-semibold text-slate-100">{item.symbol}</h3><p className="text-xs text-slate-400 truncate">{item.quote?.name || item.symbol}</p></div>
        <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>
      </div>
      <div className="flex flex-wrap gap-2">{getIndexBadge(item.quote?.indexTag)}</div>
      <div className="flex items-center justify-between gap-3">
        <div><strong className="text-2xl font-semibold text-slate-100">{fmt(item.quote?.lastClose, 2)} <span className="text-sm text-slate-400">₺</span></strong><p className={`text-xs mt-1 ${hasChange && change < 0 ? "text-[#f38b9e]" : "text-[#7ae3bf]"}`}>{hasChange ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}</p></div>
        {score != null && Number.isFinite(score) ? <ScoreRing score={score} size={52} /> : <span className="text-slate-500 text-xs">Skor yok</span>}
      </div>
      <div className="flex items-end justify-between border-t border-[#29384b] pt-4 gap-4">
        <SparkBars trend={item.quote?.trendScore ?? 0} momentum={item.quote?.momentumScore ?? 0} volume={item.quote?.volumeScore ?? 0} />
        <dl className="text-xs text-slate-400 text-right space-y-1"><div><dt className="inline">RSI </dt><dd className="inline text-slate-200">{fmt(item.quote?.rsi)}</dd></div><div><dt className="inline">CMF </dt><dd className="inline text-slate-200">{fmt(item.quote?.cmf20, 2)}</dd></div></dl>
      </div>
      <div className="flex flex-wrap gap-2">
        {item.quote?.stopLossBroken && <StatusBadge tone="negative">Stop seviyesi kırıldı</StatusBadge>}
        {item.quote?.sniper?.sniper_approved && <StatusBadge tone="positive">Motor onayı</StatusBadge>}
        {(item.quote?.volumeMultiple ?? 0) > 2 && <StatusBadge tone="warning">Hacim {fmt(item.quote?.volumeMultiple)}×</StatusBadge>}
      </div>
      {item.reasons?.[0] && <p className="border-t border-[#29384b] pt-3 text-xs text-slate-400 leading-6">{item.reasons[0]}</p>}
    </article>
  </Link>;
}

// ─── Filter Tab ──────────────────────────────────────────────────────────────
type FilterKey = "ALL" | "ALARM_UYUMSUZLUK" | "AL" | "POTANSİYEL" | "TUZAK" | "IZLE" | "ZAYIF";

// Smart Relative Date/Time Formatter
const formatScanTime = (ts?: number | null | string) => {
  if (!ts) return "—";
  const date = new Date(ts);
  const today = new Date();
  
  const isToday = date.getDate() === today.getDate() &&
                  date.getMonth() === today.getMonth() &&
                  date.getFullYear() === today.getFullYear();
                  
  const timeStr = date.toLocaleTimeString("tr-TR", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (isToday) {
    return timeStr;
  } else {
    const dateStr = date.toLocaleDateString("tr-TR", { day: '2-digit', month: '2-digit' });
    return `${dateStr} ${timeStr}`;
  }
};

// ─── Main Component ──────────────────────────────────────────────────────────
export default function BistScanner() {
  const [opportunities, setOpportunities] = useState<TrackerResult[]>([]);
  const [searchQuery, setSearchQuery]     = useState("");
  const [scanTarget, setScanTarget]       = useState<"bist30" | "bist100" | "all">("all");
  const [lastRun, setLastRun]             = useState<string | null>(null);
  const [statusMsg, setStatusMsg]         = useState("Veriler yükleniyor...");
  const [isLive, setIsLive]               = useState<boolean | null>(null);
  const [sortOrder, setSortOrder]         = useState<"desc" | "asc">("desc");
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [pageLoadedAt, setPageLoadedAt]   = useState("");
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("ALARM_UYUMSUZLUK");
  const [weights, setWeights]             = useState<ConfluenceWeights>({ trend: 30, momentum: 30, volume: 20, structure: 20 });

  useEffect(() => { setPageLoadedAt(new Date().toLocaleString("tr-TR")); }, []);

  // Graceful initial tab fallback UX: if Alarm & Div has 0 items on load, switch to active tabs
  useEffect(() => {
    if (opportunities.length > 0 && selectedFilter === "ALARM_UYUMSUZLUK") {
      const alarmCount = opportunities.filter(o => o.status === "AL" || o.status === "ALARM" || o.alert || o.quote?.rsiDivBullish || o.quote?.macdDivBullish).length;
      if (alarmCount === 0) {
        const potentialCount = opportunities.filter(o => o.status === "POTANSİYEL").length;
        if (potentialCount > 0) {
          setSelectedFilter("POTANSİYEL");
        } else {
          setSelectedFilter("ALL");
        }
      }
    }
  }, [opportunities, selectedFilter]);

  const lastRunRef     = useRef<number | null>(null);
  const lastWeightsRef = useRef<string>("");
  const lastRunMsRef   = useRef<number>(0);
  const scanTargetRef  = useRef(scanTarget);
  const isFirestoreLoadedRef = useRef(false);
  
  useEffect(() => { scanTargetRef.current = scanTarget; }, [scanTarget]);

  // ─── Fallback REST poll ─────────────────────────────────────────────────
  const fetchBackground = useCallback(async () => {
    if (isFirestoreLoadedRef.current) return;
    try {
      const res  = await fetch(`/api/bist/background?trendW=${weights.trend}&momentumW=${weights.momentum}&volumeW=${weights.volume}&structureW=${weights.structure}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (isFirestoreLoadedRef.current) return;
      const { results, lastRun: runTime } = data;
      const weightsStr = JSON.stringify(weights);
      if (lastRunRef.current === runTime && lastWeightsRef.current === weightsStr) return;
      lastRunRef.current     = runTime;
      lastWeightsRef.current = weightsStr;
      setLastRun(formatScanTime(runTime));
      setOpportunities(results);
      const alerts = (results as TrackerResult[]).filter(r => r.status === "ALARM" || r.status === "POTANSİYEL" || r.alert);
      setStatusMsg(alerts.length > 0 ? "Fırsatlar bulundu!" : "Alarm seviyesinde fırsat yok.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      setStatusMsg(`REST Hata: ${msg}`);
    }
  }, [weights]);

  // ─── Initial mount fetch ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (isFirestoreLoadedRef.current) return;
      try {
        const res  = await fetch(`/api/bist/background?trendW=${weights.trend}&momentumW=${weights.momentum}&volumeW=${weights.volume}&structureW=${weights.structure}`);
        const data = await res.json();
        if (isFirestoreLoadedRef.current) return;
        if (res.ok && data.results?.length > 0) {
          setOpportunities(data.results);
          if (data.lastRun) setLastRun(formatScanTime(data.lastRun));
          setStatusMsg("Son tarama sonuçları yüklendi.");
        }
      } catch (err) { console.error("[BistScanner] Mount fetch error:", err); }
    })();
  }, [weights]);

  // ─── Local REST Polling ───────────────────────────────────────────────────
  useEffect(() => {
    setIsLive(false);
    fetchBackground();
    const restPollingInterval = setInterval(fetchBackground, POLL_INTERVAL_MS);

    return () => {
      clearInterval(restPollingInterval);
    };
  }, [fetchBackground]);

  // ─── Auto-scan scheduler ───────────────────────────────────────────────
  // Her 1 dakikada bir kontrol: son tarama 5 dakikadan eskiyse otomatik olarak taramayı başlatır
  useEffect(() => {
    const triggerIfStale = async () => {
      const now = Date.now();
      const elapsed = now - lastRunMsRef.current;
      const FIVE_MINUTES_MS = 5 * 60 * 1000;
      
      // If we have a valid last run time and it is fresh, skip trigger
      if (lastRunMsRef.current > 0 && elapsed < FIVE_MINUTES_MS) return;
      
      console.log(`[AutoScan] Son tarama ${lastRunMsRef.current > 0 ? Math.round(elapsed / 60000) + ' dk' : 'hiç yapılmamış'} önce — otomatik tarama başlatılıyor...`);
      try {
        setIsRefreshing(true);
        setStatusMsg(`Otomatik tarama başlatıldı (${scanTargetRef.current}) — arka planda taranıyor...`);
        const res = await fetch(`/api/bist/background?index=${scanTargetRef.current}`, { method: "POST" });
        const data = await res.json();
        if (data.status === "scanning" || data.status === "started") {
          setStatusMsg(`Tarama devam ediyor (${scanTargetRef.current}) — arka planda çalışıyor`);
        } else {
          setIsRefreshing(false);
        }
      } catch (e) {
        console.error("[AutoScan] Tetiklenemedi:", e);
        setIsRefreshing(false);
      }
    };

    // Sayfa açıldıktan 5 saniye sonra ilk kontrolü yap (Firestore bağlantısına zaman tanımak için)
    const initial = setTimeout(triggerIfStale, 5000);
    // Sonra her 1 dakikada bir kontrol et
    const interval = setInterval(triggerIfStale, 60_000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, []);

  // ─── Manual refresh ────────────────────────────────────────────────────
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setStatusMsg(`Tarama başlatıldı (${scanTarget}) — önceki sonuçlar gösteriliyor...`);
    try {
      const res  = await fetch(`/api/bist/background?index=${scanTarget}`, { method: "POST" });
      const data = await res.json();
      if (data.status === "scanning" || data.status === "started") {
        setStatusMsg(`Tarama devam ediyor (${scanTarget}) — arka planda çalışıyor`);
      }
    } catch (e) {
      console.error(e);
      setStatusMsg("Tarama başlatılamadı.");
      setIsRefreshing(false);
    }
  };

  // ─── Filter / sort ─────────────────────────────────────────────────────
  const filtered = opportunities.filter(item => {
    // 1. Dataset Segmentation
    if (scanTarget === "bist30" && item.quote?.indexTag !== "BIST 30") return false;
    if (scanTarget === "bist100" && (item.quote?.indexTag !== "BIST 30" && item.quote?.indexTag !== "BIST 50" && item.quote?.indexTag !== "BIST 100")) return false;

    // 2. Search
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      if (!item.symbol.toUpperCase().includes(q) && !item.quote?.name?.toUpperCase().includes(q)) return false;
    }
    if (selectedFilter === "ALL") return true;
    if (selectedFilter === "ALARM_UYUMSUZLUK") return item.status === "AL" || item.status === "ALARM" || item.alert || item.quote?.rsiDivBullish || item.quote?.macdDivBullish;
    if (selectedFilter === "AL")          return item.status === "AL" || item.status === "ALARM";
    if (selectedFilter === "POTANSİYEL") return item.status === "POTANSİYEL";
    if (selectedFilter === "TUZAK")      return item.status === "TUZAK";
    if (selectedFilter === "IZLE")       return item.status === "İZLE" || item.status === "IZLE";
    if (selectedFilter === "ZAYIF")      return item.status === "ZAYIF";
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const diff = (b.confluenceScore ?? 0) - (a.confluenceScore ?? 0);
    return sortOrder === "desc" ? diff : -diff;
  });

  // ─── Tab counts ─────────────────────────────────────────────────────────
  const counts = {
    ALL:              opportunities.length,
    ALARM_UYUMSUZLUK: opportunities.filter(o => o.status === "AL" || o.status === "ALARM" || o.alert || o.quote?.rsiDivBullish || o.quote?.macdDivBullish).length,
    AL:               opportunities.filter(o => o.status === "AL" || o.status === "ALARM").length,
    POTANSİYEL:       opportunities.filter(o => o.status === "POTANSİYEL").length,
    TUZAK:            opportunities.filter(o => o.status === "TUZAK").length,
    IZLE:             opportunities.filter(o => o.status === "İZLE" || o.status === "IZLE").length,
    ZAYIF:            opportunities.filter(o => o.status === "ZAYIF").length,
  };

  const TABS: { key: FilterKey; label: string; count: number }[] = [
    { key: "ALARM_UYUMSUZLUK", label: "Alarm ve uyumsuzluk", count: counts.ALARM_UYUMSUZLUK },
    { key: "AL", label: "Al sinyali", count: counts.AL },
    { key: "POTANSİYEL", label: "Potansiyel", count: counts.POTANSİYEL },
    { key: "TUZAK", label: "Boğa tuzağı", count: counts.TUZAK },
    { key: "IZLE", label: "İzle", count: counts.IZLE },
    { key: "ZAYIF", label: "Zayıf", count: counts.ZAYIF },
    { key: "ALL", label: "Tümü", count: counts.ALL },
  ];

  return <div className="space-y-[18px]">
    <div className="workspace-metrics">
      <MetricCard label="Toplam sonuç" value={counts.ALL} />
      <MetricCard label="Alarm ve uyumsuzluk" value={counts.ALARM_UYUMSUZLUK} tone="warning" />
      <MetricCard label="Al sinyali" value={counts.AL} tone="positive" />
      <MetricCard label="Potansiyel" value={counts.POTANSİYEL} />
    </div>
    <Panel title="Tarama ve filtreler" description="Tarama evrenini, sonuç kategorisini ve sıralamayı belirleyin." actions={<StatusBadge>{isLive === true ? "Veri akışı bağlı" : isLive === false ? "Periyodik veri kontrolü" : "Bağlantı kontrolü"}</StatusBadge>}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-4 items-end">
          <div><span className="workspace-field-label">Tarama evreni</span><div className="workspace-tabs" role="group" aria-label="Tarama evreni">
            {([{ id: "bist30", label: "BIST30" }, { id: "bist100", label: "BIST100" }, { id: "all", label: "Tüm hisseler" }] as const).map(target => <button key={target.id} type="button" aria-pressed={scanTarget === target.id} onClick={() => setScanTarget(target.id)} className="workspace-tab">{target.label}</button>)}
          </div></div>
          <button type="button" onClick={handleManualRefresh} disabled={isRefreshing} className="rsi-button rsi-button-primary">{isRefreshing ? "Taranıyor…" : "Şimdi tara"}</button>
          <button type="button" onClick={() => setSortOrder(order => order === "desc" ? "asc" : "desc")} className="rsi-button" aria-label="Skor sıralamasını değiştir">Skor: {sortOrder === "desc" ? "yüksekten düşüğe" : "düşükten yükseğe"}</button>
        </div>
        <div><label htmlFor="scanner-search" className="workspace-field-label">Hisse veya şirket adı</label><div className="flex gap-2"><input id="scanner-search" placeholder="Örn. THYAO, Erdemir" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="w-full min-w-0" />{searchQuery && <button type="button" className="rsi-button" onClick={() => setSearchQuery("")}>Temizle</button>}</div></div>
        <div className="workspace-tabs" role="group" aria-label="Sonuç kategorisi">
          {TABS.map(tab => <button type="button" key={tab.key} aria-pressed={selectedFilter === tab.key} onClick={() => setSelectedFilter(tab.key)} className="workspace-tab">{tab.label} <span className="ml-1 text-slate-400">{tab.count}</span></button>)}
        </div>
        <div className="workspace-notice" role="status">{statusMsg}{lastRun && <span className="block text-xs mt-1">Son tarama: {lastRun}</span>}</div>
      </div>
    </Panel>
    <Panel title="Tarama sonuçları" description={`${sorted.length} sonuç gösteriliyor. Bir hisse kartını açarak ayrıntılı analize geçin.`}>
      {isRefreshing && opportunities.length > 0 && <p className="workspace-notice mb-5" role="status">Tarama sürüyor; tamamlanana kadar önceki {opportunities.length} sonuç gösteriliyor.</p>}
      {opportunities.length === 0 ? <EmptyState title={isRefreshing ? "Tarama devam ediyor" : "Henüz sonuç yok"} description={isRefreshing ? "Veri motoru taramayı tamamladığında sonuçlar burada görünecek." : "Tarama başlatın veya veri durumunu kontrol edin. Kaynak henüz bir sonuç döndürmedi."} /> : sorted.length ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{sorted.map(item => <StockCard key={item.symbol} item={item} />)}</div> : <EmptyState title="Bu filtrede sonuç yok" description="Farklı bir kategori seçin veya hisse aramasını temizleyin." action={<button type="button" className="rsi-button" onClick={() => { setSearchQuery(""); setSelectedFilter("ALL"); }}>Tüm sonuçları göster</button>} />}
      <p className="text-xs text-slate-500 mt-6">Sayfa açılışı: {pageLoadedAt || "—"} · {opportunities.length} kayıt · Veriler arka planda periyodik olarak kontrol edilir.</p>
    </Panel>
    <SettingsDock weights={weights} onChange={setWeights} />
  </div>;
}
