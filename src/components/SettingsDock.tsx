"use client";

import { useRef, useState } from "react";
import { Panel } from "@/components/ui/Workspace";

export interface ConfluenceWeights {
  trend: number;
  momentum: number;
  volume: number;
  structure: number;
}

interface SettingsDockProps {
  weights: ConfluenceWeights;
  onChange: (newWeights: ConfluenceWeights) => void;
}

const WEIGHT_FIELDS: { key: keyof ConfluenceWeights; label: string }[] = [
  { key: "trend", label: "Trend ve hareketli ortalamalar" },
  { key: "momentum", label: "Osilatör ve momentum" },
  { key: "volume", label: "Hacim ve para akışı" },
  { key: "structure", label: "Volatilite ve fiyat yapısı" },
];

export default function SettingsDock({ weights, onChange }: SettingsDockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const resetWeights = () => onChange({ trend: 30, momentum: 30, volume: 20, structure: 20 });

  return <div onKeyDown={event => {
    if (event.key === "Escape" && isOpen) { setIsOpen(false); toggle.current?.focus(); }
  }}>
    <Panel title="Skor ağırlıkları" description="Tarama sonuçlarındaki birleşik skorun gösterge ağırlıklarını düzenleyin." actions={<button ref={toggle} type="button" className="rsi-button" aria-expanded={isOpen} aria-controls="scanner-weight-fields" onClick={() => setIsOpen(open => !open)}>{isOpen ? "Ayarları kapat" : "Ağırlıkları düzenle"}</button>}>
      {isOpen ? <div id="scanner-weight-fields" className="space-y-5">
        <div className="workspace-grid">
          {WEIGHT_FIELDS.map(field => <div key={field.key}>
            <div className="flex justify-between gap-3 mb-2"><label htmlFor={`weight-${field.key}`} className="workspace-field-label">{field.label}</label><output htmlFor={`weight-${field.key}`} className="text-sm tabular-nums text-[#8be5c5]">%{weights[field.key]}</output></div>
            <input id={`weight-${field.key}`} type="range" min="0" max="50" value={weights[field.key]} onChange={event => onChange({ ...weights, [field.key]: parseInt(event.target.value, 10) })} className="w-full accent-[#6ae0bd] cursor-pointer" />
          </div>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#29384b] pt-4"><p className="text-xs text-slate-400">Varsayılanlar: trend %30, momentum %30, hacim %20, fiyat yapısı %20.</p><button type="button" onClick={resetWeights} className="rsi-button">Varsayılana dön</button></div>
      </div> : <p className="text-xs text-slate-400">Geçerli ağırlıklar: trend %{weights.trend} · momentum %{weights.momentum} · hacim %{weights.volume} · yapı %{weights.structure}.</p>}
    </Panel>
  </div>;
}
