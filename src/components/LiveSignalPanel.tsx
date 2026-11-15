"use client";

import { useEffect, useState } from "react";
import type { BistLiveQuote } from "@/lib/bist";
import { EmptyState, MetricCard, Panel, StatusBadge } from "@/components/ui/Workspace";

interface LiveSignalPanelProps { symbol: string; }

const formatNumber = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function LiveSignalPanel({ symbol }: LiveSignalPanelProps) {
  const [quote, setQuote] = useState<BistLiveQuote | null>(null);
  const [loading, setLoading] = useState(!!symbol);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setQuote(null);
    setError(null);
    async function poll() {
      if (!symbol || !active) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/bist/${encodeURIComponent(symbol)}`, { signal: controller.signal, cache: "no-store" });
        const raw = await response.text();
        let data;
        try { data = JSON.parse(raw); } catch { throw new Error(`Veri yanıtı okunamadı (${response.status})`); }
        if (!response.ok || data?.error) throw new Error(data?.error || `Veri alınamadı (${response.status})`);
        if (active) { setQuote(data); setError(null); }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Hisse verisi alınamadı");
      } finally {
        if (active) { setLoading(false); timer = setTimeout(poll, 30000); }
      }
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [symbol]);

  if (!symbol) return <Panel><EmptyState title="Bir hisse seçin" description="Analizi başlatmak için arama alanını veya hızlı seçim listesini kullanın." /></Panel>;
  if (loading && !quote) return <Panel title={`${symbol} · Analiz`}><p role="status" className="workspace-notice">Hisse göstergeleri yükleniyor…</p></Panel>;
  if (error || !quote) return <Panel title={`${symbol} · Analiz`}><div role="alert" className="workspace-notice workspace-notice-error">{error || "Hisse verisi alınamadı"}</div></Panel>;

  return <Panel title={`${quote.ticker} · Momentum görünümü`} description="Veri motorunun son yanıtındaki fiyat ve teknik göstergeler." actions={<StatusBadge>{loading ? "Güncelleniyor…" : `Birleşik skor ${formatNumber(quote.score, 0)}/100`}</StatusBadge>}>
    <div className="space-y-6">
      <div className="workspace-metrics">
        <MetricCard label="Son fiyat" value={`${formatNumber(quote.lastClose, 2)} ₺`} detail={`Günlük değişim: %${formatNumber(quote.change, 2)}`} />
        <MetricCard label="Fiyat yapısı" value={formatNumber(quote.breakout, 0)} />
        <MetricCard label="Hacim skoru" value={formatNumber(quote.volumeScore, 0)} />
        <MetricCard label="Trend skoru" value={formatNumber(quote.trendScore, 0)} />
        <MetricCard label="Momentum skoru" value={formatNumber(quote.momentumScore, 0)} />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div><dt className="workspace-field-label">Fiyat yapısı teyidi</dt><dd className="text-slate-200">{quote.higherHighs && quote.higherLows ? "Yükselen tepe ve dipler mevcut" : "Birlikte teyit edilmedi"}</dd></div>
        <div><dt className="workspace-field-label">RSI</dt><dd className="text-slate-200">{formatNumber(quote.rsi)}</dd></div>
        <div><dt className="workspace-field-label">Ortalamaya göre hacim</dt><dd className="text-slate-200">{formatNumber(quote.volumeMultiple)}×</dd></div>
        <div><dt className="workspace-field-label">SMA20&apos;ye uzaklık</dt><dd className="text-slate-200">%{formatNumber(quote.sma20Distance)}</dd></div>
      </dl>
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Zaman dilimleri · TSI (9 · 3 · 2 · 10)</h3>
        {quote.timeframes?.length ? <div className="workspace-table-wrap"><table><caption className="sr-only">Zaman dilimi teknik göstergeleri</caption><thead><tr><th>Periyot</th><th>TSI</th><th>Sinyal</th><th>Histogram</th><th>RSI</th><th>Trend</th></tr></thead><tbody>
          {quote.timeframes.map(frame => <tr key={frame.timeframe}><td>{frame.timeframe}</td><td>{formatNumber(frame.tsi)}</td><td>{formatNumber(frame.signal)}</td><td>{formatNumber(frame.histogram)}</td><td>{formatNumber(frame.rsi)}</td><td>{frame.trend || "—"}</td></tr>)}
        </tbody></table></div> : <EmptyState title="Alt periyot verisi yok" description="Bu yanıt zaman dilimi göstergesi içermiyor." />}
      </div>
      <div className="workspace-notice">ATR stop referansı: <strong>{formatNumber(quote.stopLoss, 2)} ₺</strong>. Bu görünüm gösterge değerlerini sunar; yön teyidi veya işlem sonucu varsaymaz.</div>
    </div>
  </Panel>;
}
