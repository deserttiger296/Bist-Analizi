"use client";

import { useState } from "react";

interface TickerSearchProps {
  onSearch: (symbol: string) => void;
}

const defaultSymbols = ["GARAN", "AKBNK", "ARCLK", "TCELL", "DGATE", "KRDMD", "THYAO"];

export default function TickerSearch({ onSearch }: TickerSearchProps) {
  const [symbol, setSymbol] = useState("");

  return (
    <div className="card p-4">
      <h3 className="text-lg font-semibold text-white mb-3">Hızlı Sembol Arama</h3>
      <div className="flex gap-2">
        <input
          type="text"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value.toUpperCase())}
          placeholder="Örnek: DGATE"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white outline-none focus:border-blue-400"
        />
        <button
          onClick={() => {
            const trimmed = symbol.trim();
            if (trimmed) {
              onSearch(trimmed);
              setSymbol("");
            }
          }}
          className="rounded-lg bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400"
        >
          Git
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {defaultSymbols.map((item) => (
          <button
            key={item}
            onClick={() => onSearch(item)}
            className="rounded-full border border-gray-700 px-3 py-1 text-sm text-gray-200 transition hover:bg-gray-800"
          >
            {item}
          </button>
        ))}
        <button
          onClick={() => onSearch("USDTRY=X")}
          className="rounded-full border border-gray-700 px-3 py-1 text-sm text-gray-200 transition hover:bg-gray-800"
        >
          USDT/TRY
        </button>
      </div>
    </div>
  );
}
