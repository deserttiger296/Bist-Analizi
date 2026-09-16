"use client";

import { useEffect, useState } from "react";
import type { BistLiveQuote } from "@/lib/bist";

interface LiveSignalPanelProps {
  symbol: string;
}

export default function LiveSignalPanel({ symbol }: LiveSignalPanelProps) {
  const [quote, setQuote] = useState<BistLiveQuote | null>(null);
  const [loading, setLoading] = useState(!!symbol);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadQuote() {
      if (!symbol) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/bist/${symbol}`);
        
        if (!response.ok) {
           // Handle HTTP errors gracefully without trying to parse JSON immediately
           const text = await response.text();
           let data;
           try { data = JSON.parse(text); } catch(e) {}
           throw new Error(data?.error || `Quote fetch failed (${response.status})`);
        }

        const data = await response.json();
        if (data?.error) {
          throw new Error(data.error);
        }
        setQuote(data);
      } catch (err: any) {
        setError(err?.message || "Failed to fetch live quote");
      } finally {
        setLoading(false);
      }
    }

    let isActive = true;
    let timerId: NodeJS.Timeout;

    async function poll() {
      if (!isActive) return;
      await loadQuote();
      if (isActive) {
        timerId = setTimeout(poll, 30000); // 30s delay between requests
      }
    }

    poll();
    return () => {
      isActive = false;
      clearTimeout(timerId);
    };
  }, [symbol]);

  if (!symbol) {
    return <div className="card text-gray-500 p-6 text-center">Analiz için sol taraftan bir hisse seçin veya arama yapın.</div>;
  }

  if (loading) {
    return <div className="card text-gray-400 p-6 text-center">Canlı BIST verisi yükleniyor...</div>;
  }

  if (error || !quote) {
    return <div className="card text-red-400 p-6 text-center">{error ?? "Canlı veri alınamadı"}</div>;
  }

  const formatNumber = (value: number | null | undefined, digits = 1) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "-";
    }
    return value.toFixed(digits);
  };

  const formatPercent = (value: number | null | undefined, digits = 1) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "-";
    }
    return `${value.toFixed(digits)}%`;
  };

  return (
    <div className="card">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-gray-400">{quote.ticker} · MOMENTUM</p>
            <h2 className="text-3xl font-bold text-white">{formatNumber(quote.lastClose, 2)}</h2>
          </div>
          <div className="rounded-full bg-gray-800 px-4 py-2 text-sm font-semibold text-yellow-300">
            Score {formatNumber(quote.score, 0)}/100
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Breakout" value={`${quote.breakout}/30`} />
          <Stat label="Volume" value={`${quote.volumeScore}/25`} />
          <Stat label="Trend" value={`${quote.trendScore}/25`} />
          <Stat label="Momentum" value={`${quote.momentumScore}/20`} />
        </div>

        <div className="border-t border-gray-700 pt-4 space-y-3 text-sm text-gray-300">
          <SignalRow label="Higher highs + higher lows" value={quote.higherHighs && quote.higherLows ? "confirmed over last 10 bars" : "review"} />
          <SignalRow label="RSI" value={`${formatNumber(quote.rsi, 1)} — momentum running`} />
          <SignalRow label="Volume" value={`still elevated at ${formatNumber(quote.volumeMultiple, 1)}× average`} />
          <SignalRow label="Price" value={`${formatNumber(quote.sma20Distance, 1)}% above SMA20 — strong trend`} />
        </div>

        <div className="border-t border-gray-700 pt-4">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Multi-timeframe (Linear TSI 9·3·2·10)</p>
          <div className="mt-4 space-y-3">
            {quote.timeframes.map((frame) => (
              <div key={frame.timeframe} className="grid grid-cols-1 gap-3 sm:grid-cols-3 items-center border border-gray-800 rounded-lg p-3 bg-slate-950/40">
                <div className="font-semibold text-white">{frame.timeframe}</div>
                <div className="text-sm text-gray-200">
                  TSI {formatNumber(frame.tsi)} sig {formatNumber(frame.signal)} hist {formatNumber(frame.histogram)}
                </div>
                <div className="text-sm text-gray-300">RSI {formatNumber(frame.rsi, 0)} · ▲ {frame.trend}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4 text-sm text-gray-300">
          <p className="font-semibold text-white">Senaryo: Strong Bullish (+3/3)</p>
          <p>Stop Loss (1.5×ATR): {formatNumber(quote.stopLoss, 2)} ({formatPercent(quote.change, 1)})</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-semibold text-gray-200">✓</span>
      <span>
        <span className="font-medium text-white">{label}</span> {value}
      </span>
    </div>
  );
}
