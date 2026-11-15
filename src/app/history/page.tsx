export const dynamic = "force-dynamic";

import Link from "next/link";
import { getSniperHistory, DailyHistoryRow } from "@/lib/sniperEngine";
import { EmptyState, MetricCard, Panel, StatusBadge, WorkspacePage } from "@/components/ui/Workspace";

export const metadata = {
  title: "Sinyal Geçmişi | RSI Analizi",
  description: "Günlük sinyal kayıtları ve gerçekleşen sonuçlar.",
};

function formatTR(value: string | number | null | undefined, digits = 2): string {
  const number = typeof value === "string" ? parseFloat(value) : value;
  if (number == null || !Number.isFinite(number)) return "—";
  return number.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function RowBadge({ row }: { row: DailyHistoryRow }) {
  if (row.resolved !== "True") return <StatusBadge tone="warning">Bekliyor</StatusBadge>;
  return <StatusBadge tone={row.was_correct === "True" ? "positive" : "negative"}>{row.was_correct === "True" ? "Doğru" : "Yanlış"}</StatusBadge>;
}

const labelColors: Record<string, string> = { UP: "text-emerald-300", DOWN: "text-rose-300", FLAT: "text-slate-400" };

export default async function HistoryPage() {
  const history = await getSniperHistory(30).catch(() => null);

  return <WorkspacePage title="Sinyal geçmişi" eyebrow="RSI ANALİZİ · ARAÇLAR"
    description="Son 30 gündeki günlük tahminleri, değerlendirme durumlarını ve gerçekleşen sonuçlarını karşılaştırın."
    actions={<Link className="rsi-button" href="/index.html#rsipu30">RSI Radarı</Link>}>
    {!history ? <Panel><EmptyState title="Geçmiş verisine erişilemiyor"
      description="Bu ortamda sinyal geçmişi hizmeti kullanılamıyor veya veri alınamadı. Bu durum, hiç kayıt olmadığı anlamına gelmez."
      action={<Link className="rsi-button" href="/lab">Test Merkezi&apos;ni aç</Link>} /></Panel> : <>
      <div className="workspace-metrics">
        <MetricCard label="Toplam kayıt" value={String(history.total_rows)} />
        <MetricCard label="Değerlendirilen" value={String(history.resolved_rows)} />
        <MetricCard label="Bekleyen" value={String(history.pending_rows)} detail="Sonucu henüz değerlendirilmedi" />
        <MetricCard label="Genel doğruluk" value={history.overall_accuracy_pct != null ? `%${formatTR(history.overall_accuracy_pct, 1)}` : "—"} detail="Değerlendirilen tüm tahminler" />
        <MetricCard label="Onaylı sinyal doğruluğu" value={history.approved_only_accuracy_pct != null ? `%${formatTR(history.approved_only_accuracy_pct, 1)}` : "—"} detail={`${history.approved_only_count} onaylı sinyal`} />
      </div>
      <Panel title="Günlük kayıtlar" description="En yeni kayıtlar önce gösterilir. Henüz değerlendirilmeyen sinyaller beklemede kalır.">
        {history.total_rows === 0 ? <EmptyState title="Henüz sinyal kaydı yok"
          description="Geçmiş hizmetine erişildi ancak kayıt bulunamadı. Günlük tarama sonuçları kaydedildiğinde burada listelenecek."
          action={<Link className="rsi-button" href="/index.html#rsipu30">RSI Radarı&apos;na git</Link>} /> :
          <div className="workspace-table-wrap"><table>
            <caption className="sr-only">Son 30 günlük sinyal kayıtları</caption>
            <thead><tr><th>Tarih</th><th>Sembol</th><th>Tahmin</th><th>Güven</th><th>Onaylı sinyal</th><th>Giriş fiyatı</th><th>Gerçekleşen</th><th>Getiri</th><th>Sonuç</th></tr></thead>
            <tbody>{history.rows.slice().sort((a, b) => b.date.localeCompare(a.date)).map((row, index) => <tr key={`${row.date}-${row.symbol}-${index}`}>
              <td>{row.date}</td><td><Link className="font-semibold text-slate-100" href={`/analysis/${encodeURIComponent(row.symbol)}`}>{row.symbol}</Link></td>
              <td className={labelColors[row.predicted_label] ?? "text-slate-300"}>{row.predicted_label}</td>
              <td>%{formatTR(parseFloat(row.probability) * 100, 0)}</td>
              <td>{row.sniper_approved === "True" ? "Evet" : "—"}</td>
              <td>{formatTR(row.current_price)}</td><td>{row.resolved === "True" ? formatTR(row.actual_price) : "—"}</td>
              <td className={row.resolved === "True" ? parseFloat(row.actual_return_pct) >= 0 ? "text-emerald-300" : "text-rose-300" : "text-slate-400"}>
                {row.resolved === "True" ? `${parseFloat(row.actual_return_pct) >= 0 ? "+" : ""}${formatTR(row.actual_return_pct, 1)}%` : "—"}
              </td><td><RowBadge row={row} /></td>
            </tr>)}</tbody>
          </table></div>}
      </Panel>
    </>}
  </WorkspacePage>;
}
