export const dynamic = 'force-dynamic';

import Link from "next/link";
import { getMostRsiScan } from "@/lib/rsiPu30Engine";

export const metadata = {
  title: "MOSTRSI (14, VAR 5, 9) — BIST Quantum Sniper v2.0",
  description: "TradingView MOSTRSI 14 close VAR 5 9 indikatörüne dayalı trend ve Bull kırılım tarama motoru.",
};

function formatTR(val: number | null | undefined, digits = 2): string {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function RsiPu30Page() {
  const result = await getMostRsiScan("1h").catch(() => null);

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-widest text-violet-400 font-bold">TradingView Motoru</p>
          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-950/60 border border-emerald-500/40 text-emerald-400">
            1s (1 Saatlik Mumlar)
          </span>
        </div>
        <h1 className="text-3xl font-black text-white mt-1">MOSTRSI 14 close VAR 5 9</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          Kıvanç Özbilgiç / Anıl Özekşi TradingView indikatörü: RSI(14) üzerine 5 periyotluk dinamik adaptif hareketli ortalama (VAR/VIDYA) 
          ve %9 takip eden stop (MOST) uygulanır. ExMOV çizgisinin MOST stop çizgisini yukarı kestiği an yeşil 
          <span className="text-emerald-400 font-bold mx-1">Bull</span> al sinyali üretilir.
        </p>
      </div>

      {!result ? (
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-6 text-amber-300 text-sm">
          MOSTRSI motoruna ulaşılamadı (main_api.py port 8001&apos;de çalışmıyor olabilir).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Taranan</p>
              <p className="text-2xl font-black text-white mt-1">{result.scanned}</p>
            </div>
            <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Bull Sinyalleri</p>
              <p className="text-2xl font-black text-emerald-400 mt-1">{result.matched}</p>
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
              <div className="text-4xl mb-3 opacity-40">📊</div>
              <p className="text-slate-300 font-semibold">Son 30 bar içinde aktif MOSTRSI Bull sinyali bulunamadı</p>
              <p className="text-slate-500 text-sm mt-1">Koşullar piyasa saatlerinde her saat yeniden güncellenir.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.signals.map((s) => {
                const changePct = ((s.last_close - s.signal_price) / s.signal_price) * 100;
                return (
                  <Link
                    key={s.symbol}
                    href={`/rsi-pu30/${s.symbol}`}
                    className="block rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4 hover:border-emerald-500/60 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-white">{s.symbol}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                          BULL
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-800 border border-slate-700 text-slate-300">
                        {s.bars_since_signal === 0 ? "BU SAAT" : `${s.bars_since_signal} BAR ÖNCE`}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between mt-2">
                      <div className="text-xl font-bold text-white">{formatTR(s.last_close)} ₺</div>
                      <div className={`text-xs font-bold ${changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {changePct >= 0 ? "+" : ""}{formatTR(changePct, 2)}%
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
                        <p className="text-slate-500 text-[9px] uppercase font-bold">Kırılım Anı</p>
                        <p className="text-slate-300 font-mono mt-0.5">{formatTR(s.signal_price)} ₺</p>
                        <p className="text-slate-600 text-[10px] mt-0.5">{s.signal_date}</p>
                      </div>
                      <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
                        <p className="text-slate-500 text-[9px] uppercase font-bold">MOSTRSI Seviyeleri</p>
                        <p className="text-violet-300 font-mono mt-0.5">VAR {formatTR(s.exmov, 1)} / {formatTR(s.most, 1)}</p>
                        <p className="text-slate-600 text-[10px] mt-0.5">RSI {formatTR(s.rsi, 1)}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800/80 text-xs">
                      <span className="text-violet-400 font-bold">Anlık RSI: {formatTR(s.current_rsi, 1)}</span>
                      <span className={`font-bold ${s.current_trend === "BULL" ? "text-emerald-400" : "text-rose-400"}`}>
                        Trend: {s.current_trend}
                      </span>
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
