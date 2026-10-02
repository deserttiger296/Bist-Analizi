export const dynamic = 'force-dynamic';

import Link from "next/link";
import { getRsiPu30Scan } from "@/lib/rsiPu30Engine";

export const metadata = {
  title: "RSI PU30 — BIST Quantum Sniper v2.0",
  description: "Pozitif uyumsuzluk (bullish RSI divergence) tarama motoru — sniper motorundan bağımsız, kural tabanlı ayrı bir sistem.",
};

function formatTR(val: number | null | undefined, digits = 2): string {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function RsiPu30Page() {
  const result = await getRsiPu30Scan().catch(() => null);

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-slate-800">
        <p className="text-xs uppercase tracking-widest text-violet-400">Ayrı Motor — Kural Tabanlı</p>
        <h1 className="text-3xl font-black text-white mt-1">RSI PU30 Tarayıcı</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          Pozitif uyumsuzluk (bullish divergence) taraması: fiyat daha düşük bir dip yaparken RSI daha yüksek bir dip yapıyorsa,
          satış baskısının zayıfladığı kabul edilir. Sniper motorunun RF/LSTM/sentiment hattından tamamen bağımsız,
          saf RSI tabanlı bir sistemdir — skorlama veya onaya katılmaz.
        </p>
      </div>

      {!result ? (
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-6 text-amber-300 text-sm">
          RSI PU30 motoruna ulaşılamadı (main_api.py port 8001&apos;de çalışmıyor olabilir).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Taranan</p>
              <p className="text-2xl font-black text-white mt-1">{result.scanned}</p>
            </div>
            <div className="rounded-2xl border border-violet-700/40 bg-violet-950/20 p-4">
              <p className="text-[10px] uppercase tracking-widest text-violet-400 font-bold">Aktif Sinyal</p>
              <p className="text-2xl font-black text-white mt-1">{result.matched}</p>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 col-span-2 md:col-span-2">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Atlanan</p>
              <p className="text-sm text-slate-400 mt-1.5">
                {result.errors.length === 0 ? "—" : result.errors.map(e => e.symbol).join(", ")}
              </p>
            </div>
          </div>

          {result.signals.length === 0 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
              <div className="text-4xl mb-3 opacity-40">📉</div>
              <p className="text-slate-300 font-semibold">Şu anda aktif pozitif uyumsuzluk sinyali yok</p>
              <p className="text-slate-500 text-sm mt-1">Sinyal ömrü 5 bar — koşullar her gün yeniden değerlendirilir.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.signals.map((s) => {
                const rsiGap = s.dip2.rsi - s.dip1.rsi;
                return (
                  <Link
                    key={s.symbol}
                    href={`/rsi-pu30/${s.symbol}`}
                    className="block rounded-2xl border border-violet-700/40 bg-gradient-to-br from-violet-950/30 to-slate-900 p-4 hover:border-violet-500/60 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-black text-white">{s.symbol}</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-violet-900/50 border border-violet-600/40 text-violet-300">
                        {s.bars_since_confirm} BAR ÖNCE
                      </span>
                    </div>
                    <div className="text-xl font-bold text-white mt-2">{formatTR(s.last_close)} ₺</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
                        <p className="text-slate-500 text-[9px] uppercase font-bold">Dip 1</p>
                        <p className="text-slate-300 font-mono mt-0.5">{formatTR(s.dip1.price)} / RSI {formatTR(s.dip1.rsi, 1)}</p>
                        <p className="text-slate-600 text-[10px] mt-0.5">{s.dip1.date}</p>
                      </div>
                      <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
                        <p className="text-slate-500 text-[9px] uppercase font-bold">Dip 2</p>
                        <p className="text-rose-300 font-mono mt-0.5">{formatTR(s.dip2.price)} / RSI {formatTR(s.dip2.rsi, 1)}</p>
                        <p className="text-slate-600 text-[10px] mt-0.5">{s.dip2.date}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800/80 text-xs">
                      <span className="text-emerald-400 font-bold">↗ RSI +{formatTR(rsiGap, 1)}</span>
                      <span className="text-sky-400 font-bold">Tepki +%{formatTR(s.bounce_pct, 1)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
