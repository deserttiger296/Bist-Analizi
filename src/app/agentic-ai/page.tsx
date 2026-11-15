"use client";

import { useState } from "react";
import Link from "next/link";
import { WorkspacePage, Panel, MetricCard, EmptyState, StatusBadge } from "@/components/ui/Workspace";

export default function AgenticAiPage() {
  const [symbolsInput, setSymbolsInput] = useState("VAKBN,ISCTR,GARAN,THYAO,ASELS");
  const [interval, setIntervalVal] = useState<"1h" | "4h" | "1d">("1h");
  const [useLlm, setUseLlm] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCouncil = async (customSyms?: string, customTf?: "1h" | "4h" | "1d", customLlm?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const syms = customSyms ?? symbolsInput;
      const tf = customTf ?? interval;
      const llm = customLlm ?? useLlm;
      const qs = new URLSearchParams({
        mode: "council",
        symbols: syms,
        interval: tf,
        suite: llm ? "llm" : "deterministic",
      }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Konsey çalıştırılamadı");
      setItems(json.items || []);
    } catch (e: any) {
      setError(e?.message || "Agentic AI hatası");
    } finally {
      setLoading(false);
    }
  };

  return (
    <WorkspacePage title="AI Konseyi" eyebrow="RSI ANALİZİ · DENEYSEL ARAŞTIRMA" description="Yapı, itki, zaman ve risk değerlendirmelerini tek bir incelemede karşılaştırın. Sonuçlar deneysel araştırma çıktılarıdır; doğrulanmış tahmin veya işlem onayı değildir." actions={<Link href="/lab" className="rsi-button">Test Merkezi</Link>}>
      <div className="workspace-notice-warning"><StatusBadge tone="warning">Deneysel</StatusBadge><p>Analiz yalnızca başlattığınızda çalışır. LLM sentezi seçilirse yapılandırılmış sağlayıcı kullanılır; deterministik değerlendirme ayrı olarak korunur.</p></div>
      <Panel title="İnceleme ayarları" description="Hisseleri virgülle ayırın; zaman dilimini ve sentez yöntemini seçin.">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div><label htmlFor="council-symbols" className="workspace-field-label">Hisseler</label><input id="council-symbols" value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} placeholder="VAKBN,ISCTR,THYAO" disabled={loading} className="w-full" /></div>
          <div><span className="workspace-field-label">Zaman dilimi</span><div className="workspace-tabs" role="group" aria-label="Konsey zaman dilimi">{(["1h", "4h", "1d"] as const).map(tf => <button type="button" key={tf} disabled={loading} aria-pressed={interval === tf} className="workspace-tab" onClick={() => setIntervalVal(tf)}>{tf === "1h" ? "1 saat" : tf === "4h" ? "4 saat" : "Günlük"}</button>)}</div></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-5"><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={useLlm} disabled={loading} onChange={e => setUseLlm(e.target.checked)} />LLM sentezini kullan</label><button type="button" className="rsi-button rsi-button-primary" disabled={loading || !symbolsInput.trim()} onClick={() => runCouncil()}>{loading ? "İnceleniyor…" : "Konsey analizini başlat"}</button></div>
      </Panel>
      {error && <div role="alert" className="workspace-notice-error">{error}</div>}
      {loading && <div role="status" className="workspace-notice">Seçilen hisselerin yapısı, itki ve risk verileri inceleniyor…</div>}
      {!loading && items.length === 0 && !error && <EmptyState title="Henüz konsey analizi yok" description="İncelemek istediğiniz hisseleri seçip analizi başlatın. Her hissenin verisi ve ajan gerekçeleri burada gösterilir." />}
      <div className="space-y-5" aria-busy={loading}>
        {items.map(item => <Panel key={item.symbol} title={item.symbol} description="Ajan gerekçeleri ve deneysel sentez" actions={<><StatusBadge>{item.interval}</StatusBadge><StatusBadge tone="warning">{item.verdict || "Değerlendirme yok"}</StatusBadge></>}>
          <div className="workspace-metrics">
            <MetricCard label="Son kapanış" value={item.last_close != null ? `${item.last_close} ₺` : "—"} />
            <MetricCard label="Konsey güven puanı" value={item.confidence != null ? `%${item.confidence}` : "—"} detail="Deneysel model çıktısı" />
            <MetricCard label="İtki kalitesi" value={item.impulse_score != null ? `${item.impulse_score}/100` : "—"} detail={item.impulse_grade} />
          </div>
          <div className="workspace-grid mt-4">{(item.agents || []).map((ag: any, index: number) => <Panel key={index} title={ag.role} actions={<StatusBadge>{ag.badge}</StatusBadge>}>
            <p className="text-sm leading-relaxed text-slate-300">{ag.summary}</p>
            {ag.notes?.length > 0 && <ul className="list-disc pl-5 mt-3 space-y-1 text-sm text-slate-400">{ag.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}</ul>}
            {ag.llm_synthesis && <div className="workspace-notice mt-4"><strong>LLM sentezi</strong><p>{ag.llm_synthesis}</p></div>}
          </Panel>)}</div>
        </Panel>)}
      </div>
    </WorkspacePage>
  );
}
