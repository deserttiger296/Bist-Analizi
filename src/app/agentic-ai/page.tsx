"use client";

import { useState } from "react";
import Link from "next/link";
import { WorkspacePage, Panel, MetricCard, EmptyState, StatusBadge } from "@/components/ui/Workspace";

export default function AgenticAiPage() {
  const [symbolsInput, setSymbolsInput] = useState("VAKBN,ISCTR,GARAN,THYAO,ASELS");
  const [interval, setIntervalVal] = useState<"15m" | "1h" | "4h" | "1d">("1h");
  const [useLlm, setUseLlm] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCouncil = async (customSyms?: string, customTf?: "15m" | "1h" | "4h" | "1d", customLlm?: boolean) => {
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
          <div><span className="workspace-field-label">Zaman dilimi</span><div className="workspace-tabs" role="group" aria-label="Konsey zaman dilimi">{(["15m", "1h", "4h", "1d"] as const).map(tf => <button type="button" key={tf} disabled={loading} aria-pressed={interval === tf} className="workspace-tab" onClick={() => setIntervalVal(tf)}>{tf === "15m" ? "15 dakika (NU15/PU15)" : tf === "1h" ? "1 saat" : tf === "4h" ? "4 saat" : "Günlük"}</button>)}</div></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-5"><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={useLlm} disabled={loading} onChange={e => setUseLlm(e.target.checked)} />LLM sentezini kullan</label><button type="button" className="rsi-button rsi-button-primary" disabled={loading || !symbolsInput.trim()} onClick={() => runCouncil()}>{loading ? "İnceleniyor…" : "Konsey analizini başlat"}</button></div>
      </Panel>
      {error && <div role="alert" className="workspace-notice-error">{error}</div>}
      {loading && <div role="status" className="workspace-notice">Seçilen hisselerin yapısı, itki ve risk verileri inceleniyor…</div>}
      {!loading && items.length === 0 && !error && <EmptyState title="Henüz konsey analizi yok" description="İncelemek istediğiniz hisseleri seçip analizi başlatın. Her hissenin verisi ve ajan gerekçeleri burada gösterilir." />}
      <div className="space-y-5" aria-busy={loading}>
        {items.map(item => {
          const verdictStr = String(item.verdict || "Değerlendirme yok");
          const verdictUpper = verdictStr.toUpperCase();
          const isBuy = verdictUpper.includes("AL") || verdictUpper.includes("LONG") || verdictUpper.includes("BOĞA") || verdictUpper.includes("PU30");
          const isSell = verdictUpper.includes("SAT") || verdictUpper.includes("SHORT") || verdictUpper.includes("AYI") || verdictUpper.includes("NU70");
          const confNum = Number(item.confidence ?? 0);
          const impNum = Number(item.impulse_score ?? 0);
          const tfLabel = item.interval === "15m" ? "15 Dakikalık (NU15/PU15)" : item.interval === "1h" ? "1 Saatlik" : item.interval === "4h" ? "4 Saatlik" : "Günlük";

          return (
            <Panel key={item.symbol} title={item.symbol} description="Ajan gerekçeleri ve deneysel sentez" actions={<><StatusBadge>{item.interval}</StatusBadge><StatusBadge tone="warning">{item.verdict || "Değerlendirme yok"}</StatusBadge></>}>
              <div className="workspace-metrics">
                <MetricCard label="Son kapanış" value={item.last_close != null ? `${item.last_close} ₺` : "—"} />
                <MetricCard label="Konsey güven puanı" value={item.confidence != null ? `%${item.confidence}` : "—"} detail="Deneysel model çıktısı" />
                <MetricCard label="İtki kalitesi" value={item.impulse_score != null ? `${item.impulse_score}/100` : "—"} detail={item.impulse_grade} />
              </div>

              <div className="mt-4 rounded-2xl border border-cyan-500/35 bg-cyan-950/20 p-4 space-y-2 text-xs text-slate-200 leading-relaxed">
                <div className="text-sm font-bold text-cyan-200">
                  📌 Normal İnsan İçin Konsey Özeti (Ne Yapmalı?)
                </div>
                <p>
                  <strong>1) Konsey Kararı ({verdictStr}):</strong> {item.symbol} hissesi şu an{" "}
                  <strong className="text-white font-mono">{item.last_close != null ? `${item.last_close} ₺` : "—"}</strong>{" "}
                  fiyatında ve <strong>{tfLabel}</strong> periyotta incelendi.{" "}
                  {isBuy
                    ? "Konsey yukarı yönlü (PU30 / Alım-Long) yapıların ağırlıkta olduğunu görüyor; ancak işleme girmeden önce GVT (onay çizgisi) veya 1. dalga zirvesi kırılımı beklenmeli."
                    : isSell
                    ? "Konsey aşağı yönlü (NU70 / Satış-Short veya spotta kâr al / korunma) baskının ağır bastığını görüyor; GKD desteği kırılırsa düşüş hızlanabilir."
                    : "Konsey şu an net bir kırılım veya güçlü bir yön üstünlüğü görmüyor; erken işlem açmak yerine kenarda beklemek (izleme modu) daha güvenli."}
                </p>
                <p>
                  <strong>2) Güven (%{confNum}) &amp; İtki Kalitesi ({impNum}/100 {item.impulse_grade ? `· ${item.impulse_grade}` : ""}):</strong>{" "}
                  {confNum >= 70 && impNum >= 65
                    ? "Konsey güven puanı ve 1-2 dalga itki kalitesi yüksek; dalga boyu, hacim ve düzeltme oranları sağlıklı bir trend yapısına işaret ediyor."
                    : confNum >= 50
                    ? "Orta düzeyde güven var; yapının güçlenmesi için üst zaman dilimi onayı ve hacimli kırılım şart."
                    : "Güven puanı veya itki kalitesi düşük (%50 altı); bu hissede acele işlem açmak testere/stop riski taşır."}
                </p>
                {item.interval === "15m" && (
                  <p className="text-amber-300 font-semibold">
                    ⚠️ 15 Dakikalık (NU15/PU15) Tuzak Kuralı: 15 dakikalık sinyaller tek başına 1 saatlik (1s) grafikle desteklenmiyorsa öğlene kadar kısa bir tepki/satış olarak kalıp öğleden sonra ters yönde tuzak kurabilir!
                  </p>
                )}
              </div>

              <div className="workspace-grid mt-4">{(item.agents || []).map((ag: any, index: number) => <Panel key={index} title={ag.role} actions={<StatusBadge>{ag.badge}</StatusBadge>}>
                <p className="text-sm leading-relaxed text-slate-300">{ag.summary}</p>
                {ag.notes?.length > 0 && <ul className="list-disc pl-5 mt-3 space-y-1 text-sm text-slate-400">{ag.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}</ul>}
                {ag.llm_synthesis && <div className="workspace-notice mt-4"><strong>LLM sentezi</strong><p>{ag.llm_synthesis}</p></div>}
              </Panel>)}</div>
            </Panel>
          );
        })}
      </div>
    </WorkspacePage>
  );
}
