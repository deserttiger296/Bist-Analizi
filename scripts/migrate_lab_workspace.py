"""One-time targeted migration of the Lab presentation; keeps handlers intact."""
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'src/app/lab/page.tsx'
text = path.read_text(encoding='utf-8')
text = text.replace('import Link from "next/link";', 'import Link from "next/link";\nimport { WorkspacePage, MetricCard, EmptyState } from "@/components/ui/Workspace";')
start = text.index('    <div className="space-y-6 pb-16">')
end = text.index('      {error && (', start)
text = text[:start] + '''    <WorkspacePage title="Test Merkezi" eyebrow="ARAŞTIRMA VE DOĞRULAMA"
      description="Veri güvenilirliğini, RSI kurallarını ve sistem uyumunu doğrulayın. Testler yalnızca başlattığınızda çalışır."
      actions={<><Link href="/mtf-lab.html" className="rsi-button">MTF Strateji Lab</Link><Link href="/index.html#rsipu30" className="rsi-button">RSI Radarı</Link></>}>
      <div className="workspace-notice workspace-notice-warning">Yeni özellik → Test Merkezi → Regresyon → Uyumluluk kapısı → Üretime geçiş. Başarısız veya eksik kontrol geçişi durdurur.</div>
      <div className="workspace-tabs" role="tablist" aria-label="Test Merkezi bölümleri">
        {([
          { id: "pytest", label: "Test paketleri" },
          { id: "impulse", label: "İtki analizi" },
          { id: "backtest", label: "Referans ve kurallar" },
          { id: "journal", label: "Sinyal günlüğü" },
        ] as const).map(tab => <button key={tab.id} id={`lab-tab-${tab.id}`} role="tab"
          aria-selected={activeTab === tab.id} aria-controls="lab-panel" className="workspace-tab"
          onClick={() => {
            setActiveTab(tab.id);
            window.history.replaceState(null, "", `#${tab.id === "backtest" ? "reference" : tab.id}`);
            if (tab.id === "journal" && journalRows.length === 0) loadJournal();
          }}>{tab.label}</button>)}
      </div>
      <section id="lab-panel" role="tabpanel" aria-labelledby={`lab-tab-${activeTab}`}>
''' + text[end:]
tail = text.rindex('    </div>\n  );')
text = text[:tail] + '      </section>\n    </WorkspacePage>\n  );' + text[tail + len('    </div>\n  );'):]
insert = text.index('  return (', text.index('export default function'))
text = text[:insert] + '''  useEffect(() => {
    const syncTab = () => {
      const tab = window.location.hash.slice(1);
      if (tab === "reference") setActiveTab("backtest");
      else if (["pytest", "impulse", "journal"].includes(tab)) setActiveTab(tab as "pytest" | "impulse" | "journal");
    };
    syncTab();
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

''' + text[insert:]
text = text.replace('font-black', 'font-semibold').replace('bg-[#0f1626]', 'bg-[#111b28]')
text = text.replace('rounded-2xl border border-slate-800 bg-[#111b28] p-5', 'workspace-panel workspace-panel-body')
for old, new in {
    '🎯 Semih Hoca (VAKBN + ISCTR)': 'VAKBN ve ISCTR örneği',
    '🔬 İTKİ ANALİZİNİ ÇALIŞTIR': 'İtki analizini başlat',
    '📈 BIST100 (99 Hisse) PU30 Backtest: Ham Sinyal vs Saatlik Güven Tazeleyen Tepe Kırılımı': 'Kayıtlı BIST100 karşılaştırması',
    '📜 Semih Hoca Karar Ağacı &amp; Kural Doğrulama Matrisi': 'Kural doğrulama matrisi',
    '📓 Canlı PU30 / NU70 Sinyal Günlüğü (pu30_signal_log.csv)': 'Sinyal günlüğü',
    '🔄 Günlüğü Yenile': 'Günlüğü yenile',
    '✅ Paket geçti': 'Paket geçti',
    '❌ Paket başarısız': 'Paket başarısız',
}.items():
    text = text.replace(old, new)
old = '''<div className="grid grid-cols-2 sm:grid-cols-5 gap-3" aria-live="polite">'''
text = text.replace(old, '<div className="workspace-metrics" aria-live="polite">')
text = text.replace('''<div key={label} className="rounded-xl border border-slate-800 p-3"><p className="text-xs text-slate-400">{label}</p><strong className="text-xl text-white">{count}</strong></div>''', '''<MetricCard key={label} label={label} value={count} />''')
text = text.replace('''<p className="text-sm text-slate-400">Henüz test sonucu yok. Bir paket seçip çalıştırın.</p>''', '''<EmptyState title="Henüz test sonucu yok" description="Bir test paketi seçip doğrulamayı başlatın. Geçen ve başarısız kontroller burada gösterilecek." />''')
path.write_text(text, encoding='utf-8')
