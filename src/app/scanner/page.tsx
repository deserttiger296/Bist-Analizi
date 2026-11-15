import BistScanner from "@/components/BistScanner";
import { WorkspacePage } from "@/components/ui/Workspace";

export const metadata = {
  title: "Hisse Tarayıcı | RSI Analizi",
  description: "BIST hisselerini trend, momentum ve hacim göstergeleriyle karşılaştırın.",
};

export default function ScannerPage() {
  return <WorkspacePage title="Hisse Tarayıcı" description="Tarama evrenini ve filtreleri seçin; bulunan hisselerin skorlarını ve göstergelerini karşılaştırın."><BistScanner /></WorkspacePage>;
}
