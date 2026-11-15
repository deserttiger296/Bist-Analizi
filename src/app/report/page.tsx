import Link from "next/link";
import ReportGeneratorForm from "@/components/ReportGeneratorForm";
import { Panel, WorkspacePage } from "@/components/ui/Workspace";

export const metadata = {
  title: "Rapor Oluştur | RSI Analizi",
  description: "BIST hisselerinin teknik göstergelerini ve analiz raporunu inceleyin.",
};

export default function ReportPage() {
  return <WorkspacePage title="Rapor oluştur" eyebrow="RSI ANALİZİ · ARAÇLAR"
    description="Bir hisse seçin; fiyat grafiğini, teknik göstergeleri ve mevcut analiz sonuçlarını tek raporda inceleyin."
    actions={<Link className="rsi-button" href="/index.html#rsipu30">RSI Radarı</Link>}>
    <Panel title="Hisse seçimi" description="BIST sembolünü girerek hisseye ait analiz raporuna geçin.">
      <ReportGeneratorForm />
    </Panel>
    <div className="workspace-grid">
      <Panel title="Trend ve momentum" description="Fiyat hareketlerini birlikte değerlendirin."><p>Hareketli ortalamalar ve RSI gibi göstergeler, raporda verileri mevcut olduğunda gösterilir.</p></Panel>
      <Panel title="Hacim ve risk" description="Fiyatın yanında işlem yapısını da inceleyin."><p>Hacim, para akışı ve volatilite ölçümleri kendi veri durumlarıyla birlikte sunulur.</p></Panel>
    </div>
  </WorkspacePage>;
}
