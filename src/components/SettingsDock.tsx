"use client";

import { useState } from "react";

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

export default function SettingsDock({ weights, onChange }: SettingsDockProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSliderChange = (key: keyof ConfluenceWeights, val: number) => {
    const updated = { ...weights, [key]: val };
    onChange(updated);
  };

  const resetWeights = () => {
    onChange({
      trend: 30,
      momentum: 30,
      volume: 20,
      structure: 20
    });
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Floating Gear Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-gradient-to-tr from-cyan-500/80 to-purple-600/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/40 hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer text-slate-100 font-bold text-2xl group"
        title="Sinyal Ağırlık Ayarları"
      >
        <span className="group-hover:rotate-45 transition-transform duration-300">⚙️</span>
      </button>

      {/* Floating Settings Panel */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 w-80 bg-slate-950/95 backdrop-blur-2xl border border-slate-800/80 rounded-3xl p-6 space-y-4 shadow-2xl shadow-cyan-500/5 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
              <span>⚙️</span> Sinyal Ağırlık Motoru
            </h3>
            <button
              onClick={resetWeights}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition uppercase font-black tracking-wider"
            >
              Sıfırla
            </button>
          </div>
          
          <p className="text-slate-400 text-[10px] leading-relaxed">
            Confluence (Kesişim) skorunu etkileyecek indikatör kategorilerinin ağırlıklarını dinamik olarak kaydırın.
          </p>
          
          <div className="space-y-4 pt-2">
            {/* Trend Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-slate-300">📈 Trend & Hareketli Ort.</span>
                <span className="text-cyan-400 font-mono">%{weights.trend}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={weights.trend}
                onChange={(e) => handleSliderChange("trend", parseInt(e.target.value))}
                className="w-full h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Momentum Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-slate-300">⚡ Osilatör & Momentum</span>
                <span className="text-purple-400 font-mono">%{weights.momentum}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={weights.momentum}
                onChange={(e) => handleSliderChange("momentum", parseInt(e.target.value))}
                className="w-full h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-purple-400"
              />
            </div>

            {/* Volume Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-slate-300">📊 Hacim & Para Akışı</span>
                <span className="text-emerald-400 font-mono">%{weights.volume}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={weights.volume}
                onChange={(e) => handleSliderChange("volume", parseInt(e.target.value))}
                className="w-full h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
            </div>

            {/* Structure Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-slate-300">🛡️ Volatilite & Yapı</span>
                <span className="text-yellow-500 font-mono">%{weights.structure}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={weights.structure}
                onChange={(e) => handleSliderChange("structure", parseInt(e.target.value))}
                className="w-full h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
            </div>
          </div>
          
          <div className="text-[9px] text-slate-500 pt-2 border-t border-slate-900 leading-normal">
            * Ağırlıkların değiştirilmesi, BIST tarama motorunun hisselere verdiği Confluence (Kesişim) güven skorlarını anlık olarak yeniden ölçeklendirir.
          </div>
        </div>
      )}
    </div>
  );
}
