export const dynamic = 'force-dynamic';

import { getSniperHistory, DailyHistoryRow } from "@/lib/sniperEngine";

export const metadata = {
  title: "Sistem Geçmişi — BIST Quantum Sniper v2.0",
  description: "Sniper motorunun günlük tahminleri ve gerçekleşen sonuçları.",
};

function formatTR(val: string | number | null | undefined, digits = 2): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className="text-2xl font-black text-white mt-1">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function RowBadge({ row }: { row: DailyHistoryRow }) {
  if (row.resolved !== "True") {
    return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 border border-slate-600 text-slate-400">BEKLİYOR</span>;
  }
  const correct = row.was_correct === "True";
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${correct ? "bg-emerald-950/60 border border-emerald-500/40 text-emerald-400" : "bg-rose-950/60 border border-rose-500/40 text-rose-400"}`}>
      {correct ? "✅ DOĞRU" : "❌ YANLIŞ"}
    </span>
  );
}

const labelColors: Record<string, string> = {
  UP: "text-emerald-400",
  DOWN: "text-rose-400",
  FLAT: "text-slate-400",
};

export default async function HistoryPage() {
  const history = await getSniperHistory(30).catch(() => null);

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-slate-800">
        <p className="text-xs uppercase tracking-widest text-cyan-400">Sniper Motoru Kayıtları</p>
        <h1 className="text-3xl font-black text-white mt-1">Sistem Geçmişi</h1>
        <p className="text-slate-400 text-sm mt-1">
          Sniper motorunun her gün yaptığı tahminler ve 5 gün sonra gerçekleşen fiyatla karşılaştırılan sonuçları — son 30 gün.
        </p>
      </div>

      {!history ? (
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-6 text-amber-300 text-sm">
          Günlük tarama geçmişi bu ortamda yok (yalnızca tam yerel motorda tutulur) ya da henüz hiç kayıt yok.
          Kayıt oluşturmak için <code className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">python_bot/run_daily_scan.py</code> çalıştırılmalı.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Toplam Kayıt" value={String(history.total_rows)} />
            <StatCard label="Çözümlenen" value={String(history.resolved_rows)} />
            <StatCard label="Bekleyen" value={String(history.pending_rows)} sub="5 gün dolmadı" />
            <StatCard
              label="Genel Doğruluk"
              value={history.overall_accuracy_pct != null ? `%${history.overall_accuracy_pct}` : "—"}
              sub="tüm çözümlenen tahminler"
            />
            <StatCard
              label="Onaylı AL Doğruluğu"
              value={history.approved_only_accuracy_pct != null ? `%${history.approved_only_accuracy_pct}` : "—"}
              sub={`${history.approved_only_count} onaylı sinyal`}
            />
          </div>

          {history.total_rows === 0 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-400 text-sm">
              Henüz hiç kayıt yok. Günlük taramayı çalıştırmak için terminalde:
              <pre className="mt-2 p-3 rounded-lg bg-slate-950 text-cyan-300 text-xs overflow-x-auto">python_bot\.venv\Scripts\python.exe run_daily_scan.py</pre>
              Her gün otomatik çalışması için Windows Görev Zamanlayıcı&apos;ya eklenebilir.
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60">
                      <th className="py-2.5 px-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">Tarih</th>
                      <th className="py-2.5 px-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">Sembol</th>
                      <th className="py-2.5 px-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">Tahmin</th>
                      <th className="py-2.5 px-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">Güven</th>
                      <th className="py-2.5 px-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">Onaylı AL</th>
                      <th className="py-2.5 px-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">Giriş Fiyatı</th>
                      <th className="py-2.5 px-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">Gerçekleşen</th>
                      <th className="py-2.5 px-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">Getiri %</th>
                      <th className="py-2.5 px-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">Sonuç</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.rows
                      .slice()
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((row, i) => (
                        <tr key={`${row.date}-${row.symbol}-${i}`} className={`border-b border-slate-800/50 hover:bg-slate-800/40 ${i % 2 === 0 ? "bg-slate-950/30" : ""}`}>
                          <td className="py-2 px-3 text-slate-400 text-xs">{row.date}</td>
                          <td className="py-2 px-3 font-bold text-white">{row.symbol}</td>
                          <td className={`py-2 px-3 text-center font-bold ${labelColors[row.predicted_label] ?? "text-slate-300"}`}>{row.predicted_label}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">%{formatTR(parseFloat(row.probability) * 100, 0)}</td>
                          <td className="py-2 px-3 text-center">{row.sniper_approved === "True" ? "✅" : "—"}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">{formatTR(row.current_price)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">{row.resolved === "True" ? formatTR(row.actual_price) : "—"}</td>
                          <td className={`py-2 px-3 text-right font-mono ${row.resolved === "True" ? (parseFloat(row.actual_return_pct) >= 0 ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}`}>
                            {row.resolved === "True" ? `${parseFloat(row.actual_return_pct) >= 0 ? "+" : ""}${formatTR(row.actual_return_pct, 1)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-center"><RowBadge row={row} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
