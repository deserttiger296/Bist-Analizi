import ReportGeneratorForm from "@/components/ReportGeneratorForm";

// Unused import removed

export const metadata = {
  title: "Rapor Oluştur — Kazananlar Kulübü",
  description: "BIST hisseleri için detaylı teknik analiz raporu oluşturun.",
};

export default function ReportPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black p-6 flex flex-col items-center justify-center">
      <div className="max-w-2xl w-full space-y-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-700/50 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-cyan-500/10 rounded-2xl mb-4">
            <span className="text-4xl">📊</span>
          </div>
          <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400 tracking-tight">
            Kurumsal Rapor Oluştur
          </h1>
          <p className="text-slate-400 text-lg max-w-lg mx-auto">
            İstediğiniz hissenin sembolünü girerek 12 farklı indikatör ve Smart Money algoritmalarıyla detaylı bir analiz raporu oluşturun.
          </p>
        </div>

        <div className="mt-8">
          <div className="bg-slate-950/50 p-6 rounded-2xl border border-slate-800 shadow-inner">
            <label className="block text-sm font-semibold text-slate-300 mb-3 ml-1 uppercase tracking-wider">
              Hisse Sembolü (Örn: THYAO)
            </label>
            {/* The client component TickerSearch natively handles routing or searching. We'll pass a special flag or just use standard routing */}
            <ReportGeneratorForm />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 mt-6 border-t border-slate-800">
          <div className="text-center p-3 bg-slate-800/30 rounded-xl">
            <div className="text-cyan-400 font-bold text-xl mb-1">EMA</div>
            <div className="text-xs text-slate-500">Trend & Momentum</div>
          </div>
          <div className="text-center p-3 bg-slate-800/30 rounded-xl">
            <div className="text-emerald-400 font-bold text-xl mb-1">CMF</div>
            <div className="text-xs text-slate-500">Para Akışı</div>
          </div>
          <div className="text-center p-3 bg-slate-800/30 rounded-xl">
            <div className="text-purple-400 font-bold text-xl mb-1">OBV</div>
            <div className="text-xs text-slate-500">Gizli Toplama</div>
          </div>
          <div className="text-center p-3 bg-slate-800/30 rounded-xl">
            <div className="text-rose-400 font-bold text-xl mb-1">ATR</div>
            <div className="text-xs text-slate-500">Risk Yönetimi</div>
          </div>
        </div>
      </div>
    </div>
  );
}
