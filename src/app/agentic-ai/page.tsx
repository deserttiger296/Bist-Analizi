"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

  useEffect(() => {
    runCouncil();
  }, []);

  return (
    <div className="space-y-6 pb-16">
      {/* Hero */}
      <div className="rounded-3xl border border-fuchsia-500/30 bg-gradient-to-br from-[#140d26] via-[#0f172a] to-[#09111e] p-6 sm:p-8 shadow-[0_0_50px_rgba(217,70,239,0.1)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-fuchsia-950/80 border border-fuchsia-500/40 text-fuchsia-300 mb-2 uppercase tracking-wider">
              <span>🤖 Otonom Çoklu-Ajan Kuant Masası (0 Token / Ücretsiz)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              AGENTIC AI KUANT KONSEYİ
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-3xl">
              Her hisse için <strong>4 uzman ajan</strong> sırasıyla çalışır: (1) <em>PU30 &amp; Saatlik Yapı Avcısı</em>,
              (2) <em>1-2 İtki &amp; Fib Zaman Analisti</em>, (3) <em>Şeytanın Avukatı &amp; Risk Denetçisi</em> ve
              (4) <em>Baş Stratejist (OpenRouter Ücretsiz LLM / Deterministik Sentez)</em>.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/lab"
              className="px-4 py-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 font-bold text-xs hover:bg-emerald-900/50"
            >
              🧪 İtki &amp; Fib Zaman Testbed (/lab)
            </Link>
          </div>
        </div>

        {/* Agent Roles Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800/80 text-xs">
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3">
            <div className="font-black text-cyan-300">🕵️ Ajan 1: Yapı Avcısı</div>
            <p className="text-slate-400 mt-1">
              Katı PU30, kuruş toleranslı ikili dip, dönüş mumu RSI ve Saatlik Güven Tazeleyen Tepe kırılımını denetler.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3">
            <div className="font-black text-emerald-300">🌊 Ajan 2: İtki &amp; Zaman Analisti</div>
            <p className="text-slate-400 mt-1">
              1 nolu itki dalgasını (hacim çarpanı, yeşil mum, RSI patlaması) 100 üzerinden puanlar ve Fib Zaman hedeflerini çıkarır.
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3">
            <div className="font-black text-amber-300">🛡️ Ajan 3: Şeytanın Avukatı</div>
            <p className="text-slate-400 mt-1">
              Zayıf hacim, aşırı derin 2. dalga, eksik 4s teyidi veya uzak stop mesafesi gibi tuzakları yakalar.
            </p>
          </div>
          <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-950/15 p-3">
            <div className="font-black text-fuchsia-300">🧠 Ajan 4: Baş Stratejist</div>
            <p className="text-slate-400 mt-1">
              3 ajanın raporunu birleştirip net tetik fiyatı, yapısal stop ve Fibo 1.618 ana hedefiyle nihai kararı verir.
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-slate-800 bg-[#0f1626] p-5">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end justify-between">
          <div className="flex-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Konseye Sunulacak Hisseler
            </label>
            <input
              type="text"
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Periyot
            </label>
            <div className="flex gap-1.5">
              {(["1h", "4h", "1d"] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => {
                    setIntervalVal(tf);
                    runCouncil(symbolsInput, tf, useLlm);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black border ${
                    interval === tf
                      ? "bg-fuchsia-500/20 border-fuchsia-500/50 text-fuchsia-300"
                      : "bg-slate-900 border-slate-800 text-slate-400"
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={useLlm}
              onChange={(e) => setUseLlm(e.target.checked)}
              className="accent-fuchsia-500"
            />
            <span>OpenRouter Free LLM Sentezi (Opsiyonel)</span>
          </label>
          <button
            onClick={() => runCouncil()}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white font-black text-xs hover:from-fuchsia-500 hover:to-indigo-500 disabled:opacity-50"
          >
            {loading ? "Ajanlar Tartışıyor..." : "🤖 KONSEYİ TOPLA"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Council Cards */}
      <div className="space-y-5">
        {items.map((item) => (
          <div key={item.symbol} className="rounded-2xl border border-slate-800 bg-[#0f1626] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-black text-white">{item.symbol}</span>
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-slate-800 text-slate-300">
                  {item.interval}
                </span>
                <span className="px-3 py-1 rounded-lg text-xs font-black bg-fuchsia-950/80 border border-fuchsia-500/40 text-fuchsia-200">
                  {item.verdict}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {item.impulse_score !== undefined && (
                  <span className="text-emerald-300 font-mono font-bold">
                    İtki Kalitesi: {item.impulse_score}/100 ({item.impulse_grade})
                  </span>
                )}
                <span className="text-cyan-300 font-mono font-bold">
                  Konsey Güveni: %{item.confidence ?? 0}
                </span>
                <span className="text-slate-400">
                  Son Kapanış: <strong className="text-white font-mono">{item.last_close ?? "—"} ₺</strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(item.agents || []).map((ag: any, idx: number) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-white">{ag.role}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-slate-800 text-cyan-300 font-mono">
                      {ag.badge}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{ag.summary}</p>
                  {ag.notes && ag.notes.length > 0 && (
                    <ul className="text-[11px] text-emerald-300/90 space-y-0.5 list-disc list-inside pt-1">
                      {ag.notes.map((n: string, i: number) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  )}
                  {ag.llm_synthesis && (
                    <div className="mt-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-950/20 p-2.5 text-xs text-fuchsia-200">
                      <strong>LLM Sentezi:</strong> {ag.llm_synthesis}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
