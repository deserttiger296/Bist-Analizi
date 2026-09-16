"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

interface VerdictDisplayProps {
  ticker: string;
  onDemand?: boolean; // Force refresh instead of waiting for cache
}

interface VerdictResponse {
  verdict: string;
  cached: boolean;
  timestamp: string;
}

export default function VerdictDisplay({ ticker, onDemand = false }: VerdictDisplayProps) {
  const [verdict, setVerdict] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    const fetchVerdict = async () => {
      try {
        setLoading(true);
        setError(null);

        const url = `/api/verdicts/${ticker}?onDemand=${onDemand}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as VerdictResponse;
        setVerdict(data.verdict);
        setCached(data.cached);
      } catch (err: any) {
        console.error(`Failed to fetch verdict for ${ticker}:`, err);
        setError('Verdikt yüklenemedi');
      } finally {
        setLoading(false);
      }
    };

    fetchVerdict();
  }, [ticker, onDemand]);

  if (loading) {
    return (
      <div className="text-xs text-gray-400 italic">
        Habercilik analizi yükleniyor...
      </div>
    );
  }

  if (error || !verdict) {
    return (
      <div className="text-xs text-orange-400">
        {error || 'Verdikt bulunamadı'}
      </div>
    );
  }

  // Detect sentiment from verdict
  const isBullish = verdict.includes('✓') || verdict.includes('Olumlu');
  const isBearish = verdict.includes('✗') || verdict.includes('Olumsuz');
  const sentimentColor = isBullish
    ? 'text-emerald-300'
    : isBearish
      ? 'text-rose-300'
      : 'text-yellow-300';

  return (
    <div
      className={clsx(
        'p-2 rounded border-l-2 text-xs',
        isBullish && 'bg-emerald-900/30 border-emerald-500',
        isBearish && 'bg-rose-900/30 border-rose-500',
        !isBullish && !isBearish && 'bg-yellow-900/30 border-yellow-500',
      )}
    >
      <div className={clsx('font-semibold', sentimentColor)}>
        🔍 Habercilik Verdikti
      </div>
      <div className="text-gray-300 mt-1">
        {verdict}
      </div>
      <div className="text-gray-500 text-xs mt-1">
        {cached ? '(Önbelleğe alındı)' : '(Yeni analiz)'}
      </div>
    </div>
  );
}
