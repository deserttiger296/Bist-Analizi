"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReportGeneratorForm() {
  const [symbol, setSymbol] = useState("");
  const router = useRouter();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (symbol.trim()) {
      const cleanSymbol = symbol.trim().toUpperCase().replace(".IS", "");
      router.push(`/analysis/${encodeURIComponent(cleanSymbol)}`);
    }
  };

  return <form onSubmit={handleSubmit} className="space-y-3">
    <label className="workspace-field-label" htmlFor="report-symbol">Hisse sembolü</label>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <input id="report-symbol" name="symbol" type="text" value={symbol}
        onChange={event => setSymbol(event.target.value)} placeholder="Örn. THYAO"
        autoComplete="off" spellCheck={false} aria-describedby="report-symbol-help"
        className="min-w-0 flex-1 uppercase" />
      <button type="submit" disabled={!symbol.trim()} className="rsi-button rsi-button-primary">Analiz raporunu aç</button>
    </div>
    <p id="report-symbol-help" className="text-sm text-slate-400">THYAO, GARAN veya ASELS gibi bir BIST sembolü kullanın.</p>
  </form>;
}
