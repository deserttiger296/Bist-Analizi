"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TrackerResult } from "@/lib/bist";
import Link from "next/link";
import SettingsDock, { ConfluenceWeights } from "./SettingsDock";

// ─── Index badge ────────────────────────────────────────────────────────────
const getIndexBadge = (tag?: string) => {
  if (!tag) return null;
  const map: Record<string, React.ReactNode> = {
    "BIST 30":  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[8px] font-black uppercase tracking-wider">30</span>,
    "BIST 50":  <span className="px-1.5 py-0.5 rounded-md bg-slate-400/20 border border-slate-400/40 text-slate-300 text-[8px] font-black uppercase tracking-wider">50</span>,
    "BIST 100": <span className="px-1.5 py-0.5 rounded-md bg-orange-600/20 border border-orange-500/40 text-orange-300 text-[8px] font-black uppercase tracking-wider">100</span>,
  };
  return map[tag] ?? null;
};

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
  STOP_KIRILDI: {
    label: "🚨 STOP KIRILDI",
    bg: "from-rose-950/75 to-red-950/50",
    border: "border-red-600/60",
    glow: "hover:shadow-red-500/20",
    badge: "bg-red-900/90 text-red-100 border-red-700/80 animate-pulse",
    dot: "bg-red-500",
  },
  ALARM_DIV: {
    label: "🚨 UYUMSUZLUK",
    bg: "from-yellow-950/60 to-amber-950/40",
    border: "border-yellow-600/60",
    glow: "hover:shadow-yellow-500/20",
    badge: "bg-yellow-900/80 text-yellow-300 border-yellow-700/60",
    dot: "bg-yellow-400",
  },
  AL: {
    label: "✅ ONAYLI AL",
    bg: "from-emerald-950/60 to-green-950/40",
    border: "border-emerald-600/40",
    glow: "hover:shadow-emerald-500/15",
    badge: "bg-emerald-900/80 text-emerald-300 border-emerald-700/60",
    dot: "bg-emerald-400",
  },
  POTANSİYEL: {
    label: "⭐ POTANSİYEL",
    bg: "from-cyan-950/50 to-sky-950/40",
    border: "border-cyan-700/40",
    glow: "hover:shadow-cyan-500/15",
    badge: "bg-cyan-900/80 text-cyan-300 border-cyan-700/60",
    dot: "bg-cyan-400",
  },
  TUZAK: {
    label: "⚠️ BOĞA TUZAĞI",
    bg: "from-rose-950/60 to-red-950/40",
    border: "border-rose-700/50",
    glow: "hover:shadow-rose-500/15",
    badge: "bg-rose-900/80 text-rose-300 border-rose-700/60 animate-pulse",
    dot: "bg-rose-400",
  },
  IZLE: {
    label: "🔍 İZLE",
    bg: "from-slate-900/80 to-slate-900/60",
    border: "border-slate-700/40",
    glow: "hover:shadow-slate-500/10",
    badge: "bg-slate-800/80 text-slate-300 border-slate-700/60",
    dot: "bg-slate-400",
  },
  ZAYIF: {
    label: "📉 ZAYIF",
    bg: "from-stone-950/70 to-slate-950/60",
    border: "border-stone-800/40",
    glow: "hover:shadow-stone-500/10",
    badge: "bg-stone-900/80 text-stone-400 border-stone-800/60",
    dot: "bg-stone-500",
  },
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
  const change = item.quote?.change ?? 0;
  const isPositive = change >= 0;
  const score = item.confluenceScore ?? 0;

  return (
    <Link href={`/analysis/${item.symbol}`} className="block group">
      <div className={`
        relative overflow-hidden rounded-2xl border bg-gradient-to-br backdrop-blur-sm
        transition-all duration-300 hover:scale-[1.025] hover:shadow-2xl cursor-pointer
        ${cfg.bg} ${cfg.border} ${cfg.glow}
      `}>
        {/* Animated top accent line */}
        <div className={`absolute top-0 left-0 right-0 h-[2px] ${cfg.dot} opacity-60 group-hover:opacity-100 transition-opacity`} />

        <div className="p-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-lg font-black text-white tracking-wide group-hover:text-sky-300 transition-colors">
                  {item.symbol}
                </span>
                {getIndexBadge(item.quote?.indexTag)}
              </div>
              <div className="text-[10px] text-slate-500 truncate mt-0.5 max-w-[140px]">
                {item.quote?.name || item.symbol}
              </div>
            </div>
            <span className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[9px] font-black tracking-wider border ${cfg.badge}`}>
              {cfg.label}
            </span>
          </div>

          {/* Price + Score row */}
          <div className="flex items-center justify-between mt-3">
            <div>
              <div className="text-2xl font-black text-white leading-none">
                {fmt(item.quote?.lastClose, 2)}
                <span className="text-sm font-bold text-slate-500 ml-0.5">₺</span>
              </div>
              <div className={`text-xs font-bold mt-0.5 ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                {isPositive ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </div>
            </div>
            <ScoreRing score={score} size={52} />
          </div>

          {/* Spark bars + indicators */}
          <div className="flex items-end justify-between mt-3 pt-3 border-t border-white/5">
            <SparkBars
              trend={item.quote?.trendScore ?? 0}
              momentum={item.quote?.momentumScore ?? 0}
              volume={item.quote?.volumeScore ?? 0}
            />
            <div className="text-right space-y-0.5">
              <div className="text-[9px] text-slate-500">
                RSI <span className={`font-bold ${(item.quote?.rsi ?? 50) > 70 ? "text-rose-400" : (item.quote?.rsi ?? 50) < 30 ? "text-emerald-400" : "text-slate-300"}`}>
                  {fmt(item.quote?.rsi, 0)}
                </span>
              </div>
              <div className="text-[9px] text-slate-500">
                CMF <span className={`font-bold ${(item.quote?.cmf20 ?? 0) > 0 ? "text-emerald-400" : "text-slate-400"}`}>
                  {fmt(item.quote?.cmf20, 2)}
                </span>
              </div>
              <div className="text-[9px] text-slate-500">
                ADX <span className="font-bold text-slate-300">{fmt(item.quote?.adxValue, 0)}</span>
              </div>
            </div>
          </div>

          {/* Signal chips */}
          <div className="flex flex-wrap gap-1 mt-3">
            {item.quote?.stopLossBroken && (
              <span className="px-1.5 py-0.5 rounded bg-red-900/50 border border-red-700/45 text-[8px] text-red-200 font-bold animate-pulse">STOP↑</span>
            )}
            {item.quote?.supertrendUp && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/30 text-[8px] text-emerald-400 font-bold">ST↑</span>
            )}
            {item.quote?.sarBullish && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-900/40 border border-cyan-700/30 text-[8px] text-cyan-400 font-bold">SAR↑</span>
            )}
            {item.quote?.isWeeklyEma26Bullish && (
              <span className="px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-700/30 text-[8px] text-blue-400 font-bold">W-EMA↑</span>
            )}
            {item.quote?.rsiDivBullish && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-900/40 border border-yellow-700/30 text-[8px] text-yellow-400 font-bold animate-pulse">RSI DIV</span>
            )}
            {item.quote?.macdDivBullish && (
              <span className="px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/30 text-[8px] text-amber-400 font-bold animate-pulse">MACD DIV</span>
            )}
            {item.quote?.inSqueeze && (
              <span className="px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-700/30 text-[8px] text-purple-400 font-bold">SQUEEZE</span>
            )}
            {(item.quote?.volumeMultiple ?? 0) > 2 && (
              <span className="px-1.5 py-0.5 rounded bg-orange-900/40 border border-orange-700/30 text-[8px] text-orange-400 font-bold">
                {fmt(item.quote?.volumeMultiple, 1)}x VOL
              </span>
            )}
          </div>

          {/* Top reason */}
          {item.reasons?.[0] && (
            <div className="mt-2 text-[9px] text-slate-500 truncate border-t border-white/5 pt-2 leading-relaxed">
              {item.reasons[0]}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
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

  const TABS: { key: FilterKey; label: string; accent: string; count: number }[] = [
    { key: "ALARM_UYUMSUZLUK", label: "🚨 Alarm & Div",    accent: "text-yellow-400 border-yellow-500/50 bg-yellow-950/60",  count: counts.ALARM_UYUMSUZLUK },
    { key: "AL",               label: "✅ Onaylı AL",       accent: "text-emerald-400 border-emerald-500/50 bg-emerald-950/60", count: counts.AL },
    { key: "POTANSİYEL",      label: "⭐ Potansiyel",     accent: "text-cyan-400 border-cyan-500/50 bg-cyan-950/60",          count: counts.POTANSİYEL },
    { key: "TUZAK",           label: "⚠️ Boğa Tuzağı",    accent: "text-rose-400 border-rose-500/50 bg-rose-950/60",          count: counts.TUZAK },
    { key: "IZLE",            label: "🔍 İzle",            accent: "text-slate-300 border-slate-600/50 bg-slate-900/60",        count: counts.IZLE },
    { key: "ZAYIF",           label: "📉 Zayıf",           accent: "text-stone-400 border-stone-600/50 bg-stone-900/60",        count: counts.ZAYIF },
    { key: "ALL",             label: "⊞ Tümü",             accent: "text-sky-400 border-sky-500/50 bg-sky-950/60",             count: counts.ALL },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080c14] text-white">

      {/* ── TOP HERO HEADER ── */}
      <div className="relative border-b border-white/5 bg-gradient-to-r from-[#0a0f1e] via-[#0d1628] to-[#0a0f1e] px-6 py-6 overflow-hidden">
        {/* Background grid decoration */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
          backgroundSize: "40px 40px"
        }} />

        <div className="relative flex flex-col md:flex-row md:items-center gap-5 justify-between">
          {/* Left: Title + Status */}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/30 text-lg">
                📡
              </div>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight">BIST Tarayıcı</h1>
                <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">Canlı Teknik Analiz & Fırsat Motoru</div>
              </div>
            </div>
            {/* Live status pill */}
            <div className="flex items-center gap-2.5 mt-3">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-black tracking-widest transition-all ${
                isLive === true  ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-400" :
                isLive === false ? "bg-amber-950/60 border-amber-500/40 text-amber-400" :
                                   "bg-slate-900/60 border-slate-700/40 text-slate-400"
              }`}>
                <span className="relative flex h-2 w-2">
                  {isLive === true && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isLive === true ? "bg-emerald-500" : isLive === false ? "bg-amber-500" : "bg-slate-600 animate-pulse"}`} />
                </span>
                {isLive === true ? "FİRESTORE CANLI" : isLive === false ? "REST POLLING" : "BAĞLANIYOR..."}
              </div>
              <span className="text-xs text-slate-500">{statusMsg}</span>
              {lastRun && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/5 shadow-inner">
                  <span className="text-[10px] text-slate-400 font-bold tracking-wide">Son Tarama: {lastRun}</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] text-emerald-400 font-black tracking-widest uppercase shadow-sm animate-pulse">Canlı Veri</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Stats + Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Stat pills */}
            <div className="hidden lg:flex gap-2">
              {[
                { label: "Toplam", val: counts.ALL, color: "text-white" },
                { label: "Alarm+Div", val: counts.ALARM_UYUMSUZLUK, color: "text-yellow-400" },
                { label: "AL", val: counts.AL, color: "text-emerald-400" },
                { label: "Potansiyel", val: counts.POTANSİYEL, color: "text-cyan-400" },
              ].map(({ label, val, color }) => (
                <div key={label} className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-white/4 border border-white/5 min-w-[56px]">
                  <span className={`text-lg font-black leading-none ${color}`}>{val}</span>
                  <span className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wider">{label}</span>
                </div>
              ))}
            </div>

            {/* Segment Controls */}
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 shadow-inner">
              {[
                { id: "bist30", label: "BIST 30" },
                { id: "bist100", label: "BIST 100" },
                { id: "all", label: "TÜMÜ" },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setScanTarget(t.id as any)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-black tracking-wider transition-all ${
                    scanTarget === t.id 
                      ? "bg-sky-500/20 text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.2)]" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm transition-all border ${
                isRefreshing
                  ? "bg-sky-900/40 border-sky-700/40 text-sky-400 cursor-wait"
                  : "bg-gradient-to-r from-sky-500 to-blue-600 border-sky-400/30 text-white hover:from-sky-400 hover:to-blue-500 hover:shadow-lg hover:shadow-sky-500/30 active:scale-95"
              }`}
            >
              {isRefreshing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                  Taranıyor...
                </>
              ) : (
                <>🔄 Şimdi Tara</>
              )}
            </button>

            <button
              onClick={() => setSortOrder(p => p === "desc" ? "asc" : "desc")}
              className="px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/8 text-slate-400 hover:text-white hover:bg-white/10 text-sm font-bold transition-all"
              title="Sıralama değiştir"
            >
              {sortOrder === "desc" ? "↓ Skor" : "↑ Skor"}
            </button>
          </div>
        </div>

        {/* Scanning progress bar */}
        {isRefreshing && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500 via-blue-400 to-sky-500 animate-pulse" style={{
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite linear",
            }} />
          </div>
        )}
      </div>

      {/* ── SEARCH + FILTER BAR ── */}
      <div className="sticky top-0 z-10 bg-[#080c14]/90 backdrop-blur-xl border-b border-white/5 px-6 py-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {/* Search */}
          <div className="relative flex-shrink-0 sm:w-64">
            <span className="absolute inset-y-0 left-3 flex items-center text-slate-500 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              placeholder="Hisse ara... THYAO, EREGL"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/8 text-white rounded-xl py-2 pl-9 pr-8 text-sm focus:outline-none focus:border-sky-500/60 focus:bg-white/8 transition-all font-semibold tracking-wider uppercase placeholder:text-slate-600 placeholder:normal-case placeholder:tracking-normal"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute inset-y-0 right-2.5 flex items-center text-slate-500 hover:text-white text-xs">✕</button>
            )}
          </div>

          {/* Filter tabs scroll */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 flex-1 scrollbar-none">
            {TABS.map(({ key, label, accent, count }) => (
              <button
                key={key}
                onClick={() => setSelectedFilter(key)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black tracking-wide border transition-all whitespace-nowrap cursor-pointer ${
                  selectedFilter === key
                    ? `${accent} shadow-sm`
                    : "bg-transparent border-white/6 text-slate-500 hover:text-slate-300 hover:border-white/10"
                }`}
              >
                {label}
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black ${selectedFilter === key ? "bg-white/15" : "bg-white/5 text-slate-600"}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CALIBRATION (REMOVED) ── */}
      <div className="px-6 pt-4">
      </div>

      {/* ── GRID ── */}
      <div className="p-6">

        {/* Scanning overlay banner — önceki sonuçları kapatmaz */}
        {isRefreshing && opportunities.length > 0 && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-950/60 border border-sky-700/30 text-sky-300">
            <span className="flex-shrink-0 w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-black uppercase tracking-widest">Tarama devam ediyor</span>
              <span className="text-[10px] text-sky-500 ml-2">— tamamlandığında otomatik güncellenecek</span>
            </div>
            <span className="flex-shrink-0 text-[9px] text-sky-600 font-bold">{opportunities.length} önceki sonuç gösteriliyor</span>
          </div>
        )}

        {/* Skeleton — sadece hiç veri yoksa (ilk yükleme) */}
        {opportunities.length === 0 && !isRefreshing && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/5 bg-white/3 p-4 animate-pulse space-y-4">
                <div className="flex justify-between">
                  <div className="space-y-1.5">
                    <div className="h-5 w-20 bg-white/8 rounded" />
                    <div className="h-3 w-14 bg-white/5 rounded" />
                  </div>
                  <div className="h-6 w-24 bg-white/5 rounded-md" />
                </div>
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <div className="h-7 w-24 bg-white/8 rounded" />
                    <div className="h-3 w-12 bg-white/5 rounded" />
                  </div>
                  <div className="w-12 h-12 rounded-full bg-white/5" />
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex gap-1">
                  {[1,2,3].map(j => <div key={j} className="h-4 w-10 bg-white/5 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* İlk yükleme scan beklerken spinner */}
        {opportunities.length === 0 && isRefreshing && (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-4 border-sky-900" />
              <div className="absolute inset-0 rounded-full border-4 border-t-sky-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
            </div>
            <div className="text-center">
              <div className="text-base font-black text-slate-300">Tarama devam ediyor...</div>
              <div className="text-sm text-slate-500 mt-1">Sonuçlar tamamlanınca burada görünecek</div>
            </div>
          </div>
        )}

        {/* Results */}
        {opportunities.length > 0 && (
          <>
            {sorted.length > 0 ? (
              <>
                <div className="text-[10px] text-slate-600 mb-4 flex items-center gap-2">
                  <span>{sorted.length} sonuç gösteriliyor</span>
                  {searchQuery && <span className="px-2 py-0.5 rounded bg-sky-900/30 border border-sky-700/30 text-sky-400">&quot;{searchQuery}&quot; araması</span>}
                  {isRefreshing && <span className="px-2 py-0.5 rounded bg-sky-900/20 border border-sky-800/30 text-sky-600 text-[9px] animate-pulse">Güncelleniyor...</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {sorted.map(item => <StockCard key={item.symbol} item={item} />)}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="text-5xl mb-4 opacity-30">🔍</div>
                <div className="text-lg font-bold text-slate-400">Bu kategoride sonuç bulunamadı</div>
                <div className="text-sm text-slate-600 mt-1">Başka bir filtre seçin veya &quot;Şimdi Tara&quot;ya basın</div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between text-[10px] text-slate-700 border-t border-white/4 pt-4">
          <span>{isLive ? "🔴 Firestore Realtime — sayfa yenilemesiz canlı akış" : `Sayfa yüklendi: ${pageLoadedAt}`}</span>
          <div className="flex items-center gap-3">
            {lastRun && (
              <span className="text-slate-700">
                Son tarama: {lastRun}
                {!isRefreshing && <span className="ml-1 text-slate-800">• 15 dk’da bir otomatik taranır</span>}
              </span>
            )}
            <span>{opportunities.length} hisse tarandı</span>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .scrollbar-none { scrollbar-width: none; }
        .scrollbar-none::-webkit-scrollbar { display: none; }
      `}</style>

      <SettingsDock weights={weights} onChange={setWeights} />
    </div>
  );
}
