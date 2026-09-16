import BistScanner from "@/components/BistScanner";

export const metadata = {
  title: "Tarayıcı — Kazananlar Kulübü",
  description: "BIST geneli trend/momentum/hacim confluans tarayıcısı",
};

export default function ScannerPage() {
  return (
    <div className="space-y-2">
      <div className="pb-2 border-b border-slate-800">
        <p className="text-xs uppercase tracking-widest text-cyan-400">Canlı Fırsat Tarayıcısı</p>
        <h1 className="text-3xl font-black text-white mt-1">BIST Tarayıcı</h1>
        <p className="text-slate-400 text-sm mt-1">
          Tüm BIST hisselerini trend, momentum ve hacim sinyalleriyle tarayarak yüksek confluanslı fırsatları tespit eder.
        </p>
      </div>

      <div className="pt-4">
        <BistScanner />
      </div>
    </div>
  );
}
