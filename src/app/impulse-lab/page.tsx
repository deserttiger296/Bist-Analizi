"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspacePage, MetricCard, EmptyState } from "@/components/ui/Workspace";
import SemihDivergenceChart, { type ChartInterval } from "@/components/SemihDivergenceChart";

type DirectionFilter = "all" | "BULL" | "BEAR";
type ScaleMode = "linear" | "log";

interface WfoStats {
  count: number;
  win_rate_pct: number;
  hit_100_pct: number;
  hit_161_pct: number;
  hit_261_pct: number;
  hit_361_pct: number;
  avg_bars_to_161: number | null;
  avg_bars_to_361: number | null;
  fib_time_hit_mod_a_pct: number;
  fib_time_hit_mod_b_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  profit_factor: number;
  gross_ev_pct: number;
  net_ev_pct: number;
  net_rr_ratio: number;
  ev_status: string;
  ideal_a_plus_count: number;
  ideal_a_plus_hit_161_pct: number;
  ideal_a_plus_hit_361_pct: number;
}

interface WfoFold {
  fold: number;
  train_events: number;
  oos_start: string;
  oos_end: string;
  t2_confirm: WfoStats;
  w1_breakout: WfoStats;
}

interface WfoSlice {
  t2_confirm: WfoStats;
  w1_breakout: WfoStats;
  folds: WfoFold[];
}

function fmtTR(val: number | null | undefined, digits = 2): string {
  if (val == null || !Number.isFinite(Number(val))) return "—";
  return Number(val).toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function WfoComparisonPanel({
  title,
  subtitle,
  slice,
  costPct,
}: {
  title: string;
  subtitle: string;
  slice: WfoSlice | null | undefined;
  costPct: number;
}) {
  if (!slice) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs text-slate-400">
        Bu filtre kombinasyonu için WFO istatistiği bulunamadı.
      </div>
    );
  }

  const renderCard = (label: string, badge: string, accent: string, s: WfoStats) => (
    <div className={`rounded-2xl border bg-slate-950/80 p-4 space-y-3 ${accent}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-white">{label}</h3>
          <p className="text-[11px] text-slate-400">{badge}</p>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-cyan-300">
          n = {s.count} işlem
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
        <div className="rounded-xl bg-slate-900/70 p-2.5">
          <span className="text-[10px] text-slate-400 block">%100 İsabet</span>
          <strong className="text-sky-300 text-sm">%{s.hit_100_pct}</strong>
        </div>
        <div className="rounded-xl bg-slate-900/70 p-2.5">
          <span className="text-[10px] text-slate-400 block">%161.8 İsabet</span>
          <strong className="text-emerald-300 text-sm">%{s.hit_161_pct}</strong>
          <span className="text-[10px] text-slate-500 block">Ort: {s.avg_bars_to_161 ?? "—"} bar</span>
        </div>
        <div className="rounded-xl bg-slate-900/70 p-2.5">
          <span className="text-[10px] text-slate-400 block">%261.8 İsabet</span>
          <strong className="text-violet-300 text-sm">%{s.hit_261_pct}</strong>
        </div>
        <div className="rounded-xl bg-slate-900/70 p-2.5">
          <span className="text-[10px] text-slate-400 block">%361.8 İsabet</span>
          <strong className="text-amber-300 text-sm">%{s.hit_361_pct}</strong>
          <span className="text-[10px] text-slate-500 block">Ort: {s.avg_bars_to_361 ?? "—"} bar</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono pt-1 border-t border-slate-800/70">
        <div>
          <span className="text-[10px] text-slate-500 block">Profit Factor</span>
          <strong className={s.profit_factor >= 1.2 ? "text-emerald-300" : s.profit_factor >= 1 ? "text-amber-300" : "text-rose-400"}>
            {s.profit_factor}
          </strong>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 block">Net EV (-%{costPct})</span>
          <strong className={s.net_ev_pct > 0 ? "text-emerald-300" : "text-rose-400"}>
            {s.net_ev_pct > 0 ? "+" : ""}%{s.net_ev_pct}
          </strong>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 block">Fib Zaman (±1 bar)</span>
          <strong className="text-violet-300">A: %{s.fib_time_hit_mod_a_pct} · B: %{s.fib_time_hit_mod_b_pct}</strong>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 block">A+ İdeal 1-2 ({s.ideal_a_plus_count})</span>
          <strong className="text-amber-200">%161: {s.ideal_a_plus_hit_161_pct}% · %361: {s.ideal_a_plus_hit_361_pct}%</strong>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
        <span>Kazanma: %{s.win_rate_pct} · Ort Kazanç: +%{s.avg_win_pct} · Ort Kayıp: -%{s.avg_loss_pct}</span>
        <span className={s.ev_status === "AUTHORIZED" ? "text-emerald-400 font-bold" : "text-amber-300 font-bold"}>
          {s.ev_status === "AUTHORIZED" ? "✓ Pozitif Beklenti (EV > 0)" : "⚠ Dikkat (EV ≤ 0)"}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-white">{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {renderCard(
          "1) t2 Teyidi (Erken Giriş)",
          "Dalga 2 pivotu sağ 2 mumla kesinleştiği an giriş · Stop: P0",
          "border-cyan-500/35",
          slice.t2_confirm
        )}
        {renderCard(
          "2) W1 / GVT-GKD Kırılımı (Onaylı Giriş)",
          "P0 kırılmadan Dalga 1 ucu kapanışla aşıldığında giriş · Stop: P0",
          "border-emerald-500/40",
          slice.w1_breakout
        )}
      </div>

      {slice.folds && slice.folds.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="py-2 px-3">OOS Fold</th>
                <th className="py-2 px-3">Önceki Eğitim</th>
                <th className="py-2 px-3">Test Dönemi (Sıfır Sızıntı)</th>
                <th className="py-2 px-3">t2 Erken (n / %161 / %361 / Net EV)</th>
                <th className="py-2 px-3">W1 Onaylı (n / %161 / %361 / Net EV)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {slice.folds.map((f) => (
                <tr key={f.fold} className="hover:bg-slate-900/40">
                  <td className="py-2 px-3 font-bold text-white">Fold {f.fold}</td>
                  <td className="py-2 px-3 text-slate-400">{f.train_events} olay</td>
                  <td className="py-2 px-3 text-slate-300">
                    {f.oos_start} → {f.oos_end}
                  </td>
                  <td className="py-2 px-3 text-cyan-200">
                    n={f.t2_confirm.count} · %{f.t2_confirm.hit_161_pct} · %{f.t2_confirm.hit_361_pct} ·{" "}
                    <span className={f.t2_confirm.net_ev_pct > 0 ? "text-emerald-300" : "text-rose-400"}>
                      {f.t2_confirm.net_ev_pct > 0 ? "+" : ""}%{f.t2_confirm.net_ev_pct}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-emerald-200">
                    n={f.w1_breakout.count} · %{f.w1_breakout.hit_161_pct} · %{f.w1_breakout.hit_361_pct} ·{" "}
                    <span className={f.w1_breakout.net_ev_pct > 0 ? "text-emerald-300" : "text-rose-400"}>
                      {f.w1_breakout.net_ev_pct > 0 ? "+" : ""}%{f.w1_breakout.net_ev_pct}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ImpulseWfoLabPage() {
  // Published BIST100 WFO snapshot state
  const [report, setReport] = useState<any | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportTf, setReportTf] = useState<"1h" | "4h" | "1d">("1h");
  const [reportDir, setReportDir] = useState<DirectionFilter>("all");
  const [reportScale, setReportScale] = useState<ScaleMode>("linear");

  // Live custom scan + live WFO state
  const [symbolsInput, setSymbolsInput] = useState(
    "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS,PGSUS,SISE,KCHOL,SAHOL,BIMAS"
  );
  const [liveTf, setLiveTf] = useState<ChartInterval>("1h");
  const [liveDir, setLiveDir] = useState<"all" | "bull" | "bear">("all");
  const [liveScale, setLiveScale] = useState<ScaleMode>("linear");
  const [scanData, setScanData] = useState<any | null>(null);
  const [loadingScan, setLoadingScan] = useState(false);
  const [liveWfoData, setLiveWfoData] = useState<any | null>(null);
  const [loadingLiveWfo, setLoadingLiveWfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const [chartModal, setChartModal] = useState<{
    symbol: string;
    interval: ChartInterval;
    signalPref: "pu30" | "nu70";
    scaleMode: ScaleMode;
  } | null>(null);

  useEffect(() => {
    setLoadingReport(true);
    fetch("/api/impulse-lab?mode=report", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (res.ok && json.status === "success") {
          setReport(json);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingReport(false));
  }, []);

  const runLiveScan = async (customSyms?: string, customTf?: ChartInterval, customDir?: "all" | "bull" | "bear") => {
    const rid = ++reqRef.current;
    setLoadingScan(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        mode: "scan",
        symbols: customSyms ?? symbolsInput,
        interval: customTf ?? liveTf,
        direction: customDir ?? liveDir,
        scale: liveScale,
      }).toString();
      const res = await fetch(`/api/impulse-lab?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (rid !== reqRef.current) return;
      if (!res.ok || json.status !== "success") throw new Error(json.detail || "İtki taraması başarısız");
      setScanData(json);
    } catch (e: any) {
      if (rid === reqRef.current) setError(e?.message || "Tarama hatası");
    } finally {
      if (rid === reqRef.current) setLoadingScan(false);
    }
  };

  const runLiveWfo = async () => {
    setLoadingLiveWfo(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        mode: "wfo",
        symbols: symbolsInput,
        interval: liveTf,
        direction: liveDir,
        scale: liveScale,
      }).toString();
      const res = await fetch(`/api/impulse-lab?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.status !== "success") throw new Error(json.detail || "Canlı WFO hesaplanamadı");
      setLiveWfoData(json);
    } catch (e: any) {
      setError(e?.message || "Canlı WFO hatası");
    } finally {
      setLoadingLiveWfo(false);
    }
  };

  const activeReportInterval = report?.scales?.[reportScale]?.[reportTf];
  const activeReportSlice: WfoSlice | null = activeReportInterval?.[reportDir] ?? null;

  const liveWfoInterval = liveWfoData?.by_interval?.[liveTf];
  const liveWfoDirKey: DirectionFilter = liveDir === "bull" ? "BULL" : liveDir === "bear" ? "BEAR" : "all";
  const activeLiveWfoSlice: WfoSlice | null = liveWfoInterval?.[liveWfoDirKey] ?? null;

  return (
    <WorkspacePage
      title="İtki & WFO Test Modu"
      eyebrow="İZOLASYONLU ARAŞTIRMA · ÇİFT YÖNLÜ 1-2-3 & %361.8"
      description="PU30 Yükseliş ve NU70 Düşüş 1-2-3 itki yapıları, Fibonacci Zaman çizgileri ve sıfır veri sızıntılı Walk-Forward (WFO) istatistikleri. Üretim motorlarından tamamen ayrı çalışır."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/lab" className="rsi-button">
            Test Merkezi (/lab)
          </Link>
          <Link href="/index.html#rsipu30" className="rsi-button">
            RSI Radarı
          </Link>
        </div>
      }
    >
      <div className="space-y-8">
        <div className="rounded-2xl border border-amber-500/35 bg-amber-950/20 px-4 py-3 text-xs text-amber-100 leading-relaxed">
          <strong>🧪 İzole Test Modu:</strong> Bu ekran kendi bağımsız motorunu (<code>/api/impulse-lab</code>) kullanır; klasik tarayıcıları veya Test Merkezi sekmelerini etkilemez. Dalga 2 geri çekilmesi <code>%23.6–%88.6</code> filtrelenir (<code>%38.2–%78.6</code> = <strong>A+ İdeal 1-2</strong>), stop her zaman <code>P0</code>&apos;dır ve BIST gidiş-dönüş maliyeti (<code>%0.25</code>) Net EV hesabından düşülür.
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {/* BÖLÜM 1: BIST100 YAYINLI WALK-FORWARD (WFO) RAPORU */}
        <section className="workspace-panel workspace-panel-body space-y-5 border-t-2 border-t-cyan-500">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">BIST100 Yayınlı Walk-Forward (WFO) Raporu</h2>
              <p className="text-xs text-slate-400">
                {report
                  ? `${report.universe} (${report.universe_count} hisse) · Güncelleme: ${String(report.generated_at).slice(0, 16).replace("T", " ")} UTC · BIST Maliyet: %${report.roundtrip_cost_pct}`
                  : "Yayınlanmış BIST100 WFO anlık görüntüsü yükleniyor…"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
                {(["1h", "4h", "1d"] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setReportTf(tf)}
                    className={`px-2.5 py-1 rounded-lg font-bold ${
                      reportTf === tf ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tf === "1h" ? "1S" : tf === "4h" ? "4S" : "1G"}
                  </button>
                ))}
              </div>

              <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
                {([
                  { id: "all", label: "Tümü" },
                  { id: "BULL", label: "🟢 Yükseliş (PU30)" },
                  { id: "BEAR", label: "🔴 Düşüş (NU70)" },
                ] as const).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setReportDir(d.id)}
                    className={`px-2.5 py-1 rounded-lg font-bold ${
                      reportDir === d.id ? "bg-emerald-500/20 text-emerald-200" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
                {(["linear", "log"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setReportScale(sc)}
                    className={`px-2.5 py-1 rounded-lg font-bold ${
                      reportScale === sc ? "bg-amber-500/20 text-amber-200" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {sc === "linear" ? "Lineer" : "Log"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loadingReport ? (
            <p className="text-xs text-cyan-300">Yayınlanmış BIST100 WFO raporu okunuyor…</p>
          ) : report ? (
            <WfoComparisonPanel
              title={`${reportTf.toUpperCase()} · ${reportDir === "all" ? "Yükseliş + Düşüş" : reportDir === "BULL" ? "Yükseliş (PU30)" : "Düşüş (NU70)"} · ${reportScale === "linear" ? "Lineer" : "Log Ölçek"}`}
              subtitle="Sıfır geleceğe bakış: her işlem yalnızca t2 teyidi (t2+2 kapanış) veya W1 kapanış kırılımı sonrası açılır; aynı mumda stop ve hedef temas ederse muhafazakâr olarak stop önce sayılır."
              slice={activeReportSlice}
              costPct={Number(report.roundtrip_cost_pct ?? 0.25)}
            />
          ) : (
            <EmptyState
              title="Yayınlanmış WFO raporu henüz oluşturulmamış"
              description="Aşağıdan seçili hisselerde canlı WFO çalıştırabilir veya scripts/generate_impulse_wfo_report.py ile BIST100 raporunu üretebilirsiniz."
            />
          )}
        </section>

        {/* BÖLÜM 2: CANLI ÇİFT YÖNLÜ 1-2-3 İTKİ & ÖZEL HİSSE WFO */}
        <section className="workspace-panel workspace-panel-body space-y-5 border-t-2 border-t-amber-500">
          <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end justify-between">
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Canlı 1-2-3 İtki &amp; Özel WFO Hisseleri
                </label>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const p = "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS,PGSUS,SISE,KCHOL,SAHOL,BIMAS";
                      setSymbolsInput(p);
                      runLiveScan(p);
                    }}
                    className="text-cyan-400 hover:underline"
                  >
                    BIST13 Popüler
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      const p = "VAKBN,ISCTR,GARAN,AKBNK,YKBNK";
                      setSymbolsInput(p);
                      runLiveScan(p);
                    }}
                    className="text-cyan-400 hover:underline"
                  >
                    Bankalar
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      const p = "ASELS,THYAO,VAKBN,ISCTR,TUPRS";
                      setSymbolsInput(p);
                      runLiveScan(p);
                    }}
                    className="text-amber-300 hover:underline"
                  >
                    Semih Hoca Örnekleri
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={symbolsInput}
                onChange={(e) => setSymbolsInput(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-amber-500 focus:outline-none"
                placeholder="Hisseleri virgülle ayırın (örn. VAKBN,ISCTR,THYAO,ASELS)"
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Periyot</label>
                <div className="flex gap-1">
                  {(["15m", "1h", "4h", "1d"] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setLiveTf(tf)}
                      className={`px-2.5 py-2 rounded-xl text-xs font-bold border ${
                        liveTf === tf
                          ? "bg-amber-500/20 border-amber-400 text-amber-200"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {tf === "15m" ? "15DK" : tf === "1d" ? "1G" : tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Yön</label>
                <div className="flex gap-1">
                  {([
                    { id: "all", label: "Tümü" },
                    { id: "bull", label: "🟢 Yükseliş" },
                    { id: "bear", label: "🔴 Düşüş" },
                  ] as const).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setLiveDir(d.id)}
                      className={`px-2.5 py-2 rounded-xl text-xs font-bold border ${
                        liveDir === d.id
                          ? "bg-cyan-500/20 border-cyan-500 text-cyan-200"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Ölçek</label>
                <div className="flex gap-1">
                  {(["linear", "log"] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setLiveScale(sc)}
                      className={`px-2.5 py-2 rounded-xl text-xs font-bold border ${
                        liveScale === sc
                          ? "bg-violet-500/20 border-violet-400 text-violet-200"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {sc === "linear" ? "Lineer" : "Log"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => runLiveScan()}
              disabled={loadingScan}
              className="px-4 py-2.5 rounded-xl border border-amber-500/50 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-bold text-xs disabled:opacity-50"
            >
              {loadingScan ? "İtki Yapıları Taranıyor…" : "⚡ Canlı 1-2-3 İtki Tara"}
            </button>
            <button
              type="button"
              onClick={runLiveWfo}
              disabled={loadingLiveWfo}
              className="px-4 py-2.5 rounded-xl border border-cyan-500/50 bg-cyan-600/25 hover:bg-cyan-600/35 text-cyan-100 font-bold text-xs disabled:opacity-50"
            >
              {loadingLiveWfo ? "Canlı WFO Hesaplanıyor…" : "📊 Seçili Hisselerde Canlı WFO Hesapla"}
            </button>
          </div>

          {liveWfoData && (
            <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/60 p-4">
              <WfoComparisonPanel
                title={`Canlı Özel WFO Sonucu (${liveWfoData.universe_count} Hisse · ${liveTf.toUpperCase()} · ${liveScale === "linear" ? "Lineer" : "Log"})`}
                subtitle="Seçili hisselerin tüm tarihsel PU30/NU70 itki olayları üzerinde sıfır geleceğe bakışla hesaplandı."
                slice={activeLiveWfoSlice}
                costPct={Number(liveWfoData.roundtrip_cost_pct ?? 0.25)}
              />
            </div>
          )}

          {scanData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Taranan Hisse" value={scanData.total_scanned} detail={`${String(scanData.interval).toUpperCase()} · ${scanData.items?.length || 0} aday`} />
                <MetricCard label="Hazır 1-2 Yapısı" value={scanData.ready_count} detail={`${scanData.a_plus_count} adet A+ İdeal 1-2`} />
                <MetricCard label="Yükseliş İtkisi (PU30)" value={scanData.bull_count} detail="Yukarı +%100..+%361.8" />
                <MetricCard label="Düşüş İtkisi (NU70)" value={scanData.bear_count} detail="Aşağı -%100..-%361.8" />
              </div>

              {(!scanData.items || scanData.items.length === 0) ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs text-slate-400">
                  Seçili parametrelerde aktif PU30/NU70 itki yapısı bulunamadı.
                </div>
              ) : (
                <div className="space-y-4">
                  {scanData.items.map((item: any, idx: number) => {
                    const imp = item.impulse;
                    const isBull = item.direction === "BULL";
                    const isReady = imp?.durum === "1_2_yapisi_hazir";
                    const targets = imp?.fib_fiyat_hedefleri || {};
                    const modA = imp?.fib_zaman_w1_referans || {};
                    const modB = imp?.fib_zaman_02_sundurme || {};

                    return (
                      <div key={`${item.symbol}-${item.direction}-${idx}`} className="rounded-2xl border border-slate-800 bg-slate-950/85 p-4 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-black text-white">{item.symbol}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                              {item.interval === "15m" ? "15DK" : String(item.interval).toUpperCase()}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-bold border ${
                                isBull
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                  : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                              }`}
                            >
                              {isBull ? "🟢 Yükseliş İtkisi (PU30)" : "🔴 Düşüş İtkisi (NU70)"}
                            </span>
                            {imp?.quality_label && (
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-bold border ${
                                  imp.quality_grade === "A+"
                                    ? "bg-amber-500/20 text-amber-200 border-amber-400/50"
                                    : "bg-slate-800 text-slate-300 border-slate-700"
                                }`}
                              >
                                {imp.quality_label} ({imp.quality_score}/100)
                              </span>
                            )}
                            {imp?.gvt_gkd_aligned && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-500/40">
                                ✓ GVT/GKD Hizalı
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-400">
                              Son: <strong className="text-white font-mono">{fmtTR(item.last_close)} ₺</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setChartModal({
                                  symbol: item.symbol,
                                  interval: item.interval as ChartInterval,
                                  signalPref: isBull ? "pu30" : "nu70",
                                  scaleMode: liveScale,
                                })
                              }
                              className="px-3 py-1.5 rounded-lg border border-amber-400/50 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-bold text-xs"
                            >
                              📈 İtki &amp; Fib Zaman Grafiğini Aç
                            </button>
                          </div>
                        </div>

                        {!isReady ? (
                          <p className="text-xs text-slate-400">
                            0 noktası ({fmtTR(imp?.p0_price)} ₺ · {imp?.t0_date}) tespit edildi; geçerli 1-2 düzeltmesi henüz tamamlanmadı (<code>{imp?.durum}</code>).
                          </p>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                                <span className="text-[10px] text-slate-400 block">0 → 1 Dalga Boyu (W1)</span>
                                <strong className="text-white text-sm">
                                  {fmtTR(imp.p0_price)} ₺ → {fmtTR(imp.dalga1.p1_price)} ₺ ({isBull ? "+" : "-"}%{imp.dalga1.move_pct})
                                </strong>
                                <span className="text-[11px] text-slate-400 block mt-0.5">
                                  {imp.dalga1.duration_bars} bar · RSI Δ{imp.dalga1.rsi_delta} · Hacim {imp.dalga1.vol_ratio}x
                                </span>
                              </div>
                              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                                <span className="text-[10px] text-slate-400 block">2 Nolu Düzeltme (W2)</span>
                                <strong className="text-amber-300 text-sm">
                                  {fmtTR(imp.dalga2.p2_price)} ₺ (Fibo {imp.dalga2.price_retracement_fib})
                                </strong>
                                <span className="text-[11px] text-slate-400 block mt-0.5">
                                  {imp.dalga2.duration_bars} bar · Tarih: {imp.dalga2.t2_date}
                                </span>
                              </div>
                              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                                <span className="text-[10px] text-slate-400 block">3 Nolu Dalga Gerçekleşen</span>
                                <strong className={imp.dalga3_takip?.hedef_361_goruldu ? "text-amber-300 text-sm" : "text-emerald-300 text-sm"}>
                                  {fmtTR(imp.dalga3_takip?.extreme_price_after_w2)} ₺ (W1&apos;in %{imp.dalga3_takip?.w3_vs_w1_pct ?? 0}&apos;i)
                                </strong>
                                <span className="text-[11px] text-slate-400 block mt-0.5">
                                  {imp.dalga3_takip?.w1_tepesi_kirildi ? "✓ W1 kırıldı" : "W1 kırılımı bekleniyor"} · {imp.dalga3_takip?.extreme_date_after_w2 || "—"}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs font-mono">
                              {(["1.000", "1.618", "2.618", "3.618"] as const).map((rk) => {
                                const t = targets[rk];
                                if (!t) return null;
                                const mainVal = liveScale === "log" ? t.target_log : t.target_from_w2;
                                const hit = liveScale === "log" ? t.reached_log : t.reached;
                                return (
                                  <div
                                    key={rk}
                                    className={`rounded-xl border p-2.5 ${
                                      rk === "3.618"
                                        ? "border-amber-500/40 bg-amber-950/20"
                                        : "border-slate-800 bg-slate-900/50"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                                      <span>{t.pct_label} ({liveScale === "log" ? "Log" : "Lineer"})</span>
                                      {hit && <span className="text-emerald-300 font-bold">✓ Görüldü</span>}
                                    </div>
                                    <div className="text-sm font-black text-white mt-0.5">{fmtTR(mainVal)} ₺</div>
                                    <div className="text-[10px] text-slate-500">
                                      Bölge: {fmtTR(t.zone_low)}–{fmtTR(t.zone_high)} ₺
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-slate-800">
                              <table className="w-full text-left text-[11px] font-mono">
                                <thead className="bg-slate-900 text-slate-400 uppercase text-[10px]">
                                  <tr>
                                    <th className="py-2 px-3">Fib Zaman</th>
                                    <th className="py-2 px-3">Mod A (W1-Bazlı · ΔT1 × Oran)</th>
                                    <th className="py-2 px-3">Mod B (0–2 Sündürme · ΔT02 × Oran)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                  {(["0.382", "0.618", "1.000", "1.618", "2.618", "3.618"] as const).map((rk) => {
                                    const a = modA[rk];
                                    const b = modB[rk];
                                    if (!a && !b) return null;
                                    return (
                                      <tr key={rk} className={rk === "3.618" ? "bg-amber-950/15" : ""}>
                                        <td className="py-1.5 px-3 font-bold text-violet-300">Fib {rk}</td>
                                        <td className="py-1.5 px-3 text-slate-200">
                                          {a ? `+${a.offset_bars} bar → ${a.target_date}${a.is_future ? " (Gelecek)" : ` (${fmtTR(a.close_at_target)} ₺)`}` : "—"}
                                        </td>
                                        <td className="py-1.5 px-3 text-slate-200">
                                          {b ? `+${b.offset_bars} bar → ${b.target_date}${b.is_future ? " (Gelecek)" : ` (${fmtTR(b.close_at_target)} ₺)`}` : "—"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {chartModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 overflow-y-auto"
          onClick={() => setChartModal(null)}
        >
          <div className="w-full max-w-5xl my-auto" onClick={(e) => e.stopPropagation()}>
            <SemihDivergenceChart
              symbol={chartModal.symbol}
              defaultInterval={chartModal.interval}
              defaultSignalPref={chartModal.signalPref}
              defaultShowImpulse={true}
              defaultFibTimeMode="modA"
              defaultScaleMode={chartModal.scaleMode}
              onClose={() => setChartModal(null)}
            />
          </div>
        </div>
      )}
    </WorkspacePage>
  );
}
