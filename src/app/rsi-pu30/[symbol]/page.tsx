export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import Link from "next/link";
import { getRsiPu30SymbolDetail } from "@/lib/rsiPu30Engine";
import RsiPu30ChartLoader from "@/components/RsiPu30ChartLoader";

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return {
    title: `${symbol.toUpperCase()} RSI PU30 — BIST Quantum Sniper v2.0`,
    description: `${symbol.toUpperCase()} için pozitif uyumsuzluk (RSI divergence) grafiği.`,
  };
}

function formatTR(val: number | null | undefined, digits = 2): string {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function RsiPu30SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const detail = await getRsiPu30SymbolDetail(symbol).catch(() => null);

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-violet-400">RSI PU30 — Ayrı Motor</p>
          <h1 className="text-3xl font-black text-white mt-1">{symbol}</h1>
        </div>
        <Link href="/rsi-pu30" className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:border-violet-500">
          ← Tüm Taramalar
        </Link>
      </div>

      {!detail ? (
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-6 text-amber-300 text-sm">
          {symbol} için veri alınamadı — motor çalışmıyor olabilir veya sembol yetersiz geçmişe sahip.
        </div>
      ) : (
        <>
          {!detail.signal ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-400 text-sm">
              {symbol} için son 1 yılda uyumsuzluk koşullarını sağlayan bir dip çifti bulunamadı.
            </div>
          ) : (
            <div className={`rounded-2xl border p-5 ${detail.signal.is_active ? "border-violet-600/50 bg-violet-950/20" : "border-slate-700 bg-slate-900"}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase ${detail.signal.is_active ? "bg-violet-900/60 border border-violet-500/50 text-violet-300" : "bg-slate-800 border border-slate-600 text-slate-400"}`}>
                  {detail.signal.is_active ? "✓ Aktif Sinyal" : "Geçmiş Sinyal (süresi doldu)"}
                </span>
                <span className="text-slate-500 text-xs">{detail.signal.bars_since_confirm} bar önce onaylandı</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                <div><p className="text-slate-500 text-[10px] uppercase font-bold">Dip 1</p><p className="text-white font-mono">{formatTR(detail.signal.dip1.price)} ₺</p><p className="text-slate-500 text-xs">{detail.signal.dip1.date} · RSI {formatTR(detail.signal.dip1.rsi, 1)}</p></div>
                <div><p className="text-slate-500 text-[10px] uppercase font-bold">Dip 2</p><p className="text-rose-300 font-mono">{formatTR(detail.signal.dip2.price)} ₺</p><p className="text-slate-500 text-xs">{detail.signal.dip2.date} · RSI {formatTR(detail.signal.dip2.rsi, 1)}</p></div>
                <div><p className="text-slate-500 text-[10px] uppercase font-bold">Tepki</p><p className="text-sky-400 font-bold">+%{formatTR(detail.signal.bounce_pct, 1)}</p></div>
                <div><p className="text-slate-500 text-[10px] uppercase font-bold">RSI Uyumsuzluğu</p><p className="text-emerald-400 font-bold">+{formatTR(detail.signal.dip2.rsi - detail.signal.dip1.rsi, 1)}</p></div>
              </div>
            </div>
          )}

          <div className="card p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Fiyat &amp; RSI Uyumsuzluk Grafiği</h2>
              <span className="text-[10px] text-slate-500">{detail.bars.length} günlük mum · yakınlaştırma ve gezinme senkronize</span>
            </div>
            <RsiPu30ChartLoader bars={detail.bars} signal={detail.signal} />
            <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" /> Mum (OHLC)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-400 inline-block" /> RSI (14)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-400 inline-block" /> Uyumsuzluk (RSI yükseliyor)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-rose-400 inline-block" /> Fiyat düşüyor (daha derin dip)</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
