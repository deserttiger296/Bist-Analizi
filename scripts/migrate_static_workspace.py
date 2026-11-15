from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'public/index.html'
text = path.read_text(encoding='utf-8')
start = text.index('        <div id="market-radar-controls"')
end = text.index('        <!-- SYSTEM ARCHITECTURE -->', start)
text = text[:start] + text[end:]
start = text.index('        <!-- SYSTEM ARCHITECTURE -->')
end = text.index('        <!-- AI WEIGHTS -->', start)
cards = [
    ('RSI uyumsuzluk motoru', 'PU30 ve NU70 koşulları, fiyat pivotları ve kapanmış mum teyidiyle birlikte değerlendirilir. Sonuçlar zaman dilimine göre ayrı incelenir.', '/index.html#rsipu30', 'RSI Radarı'),
    ('Çoklu zaman dilimi', 'Saatlik, dört saatlik ve günlük yapıyı karşılaştırın. Alt periyot baskısını ve eksik veri gerekçelerini MTF Lab üzerinden inceleyin.', '/mtf-lab.html', 'MTF Strateji Lab'),
    ('Veri kalitesi', 'Veri durumu, geçmiş mum sayısı ve kapanış kontrolleri analizden önce değerlendirilir. Kullanılamayan veri onay olarak gösterilmez.', '/lab', 'Veri güvenilirliği testleri'),
    ('Test ve uyumluluk', 'Yeni davranışlar önce Test Merkezi’nde denenir. Regresyonlar, API sözleşmeleri ve arayüz uyumu doğrulanmadan geçiş tamamlanmış sayılmaz.', '/lab', 'Test Merkezi'),
    ('Model değerlendirmesi', 'Model ve haber analizi yalnızca ilgili motor kullanılabiliyorsa sonuç üretir. Kullanılabilirlik, motor durumunda ve analiz ekranında gösterilir.', '/agentic-ai', 'AI Konseyi'),
    ('Sinyal ve sanal portföy', 'Raporlar, sinyal koşulları ve sanal pozisyonlar ayrı takip edilir. Sanal portföy işlemleri gerçek bir borsa emri oluşturmaz.', '/signal-terminal', 'Sinyal Terminali'),
]
content = ''.join(f'<article class="workspace-panel"><div class="workspace-panel-body"><h2 class="static-panel-title">{title}</h2><p class="static-panel-description">{description}</p><a class="rsi-button" href="{url}">{label}</a></div></article>' for title, description, url, label in cards)
text = text[:start] + '<section id="architecture" class="view-section"><header class="workspace-header"><div><span class="rsi-eyebrow">RSI ANALİZİ · SİSTEMLER</span><h1>Sistem mimarisi</h1><div class="workspace-description">Analiz, veri kontrolü ve doğrulama katmanlarının birlikte nasıl çalıştığını inceleyin.</div></div></header><div class="workspace-grid">' + content + '</div></section>\n' + text[end:]
start = text.index('    <!-- Chart Modal -->')
end = text.index('    <!-- RSI PU30 Chart Modal -->', start)
text = text[:start] + text[end:]
text = text.replace('⚖️ Yapay Zeka Karar Ağırlıkları (Feature Importances)', 'Model ağırlıkları').replace('Diskteki RF modelinin gerçek <code>feature_importances_</code> değerleri. GÖLGE MOD: modelin karar katkısı doğrulanmadı.', 'Bağlı motorun sağladığı gerçek özellik ağırlıkları. Model kullanılamıyorsa değer üretilmez.')
text = text.replace('<div class="rsi-content">', '<div class="rsi-content rsi-workspace">')
path.write_text(text, encoding='utf-8')
path = root / 'public/static/app.js'
text = path.read_text(encoding='utf-8')
start = text.index('    // Elements\n')
end = text.index('    // ───────────────────────── RSI PU30', start)
text = text[:start] + text[end:]
text = text.replace("        const targetId = window.location.hash.slice(1) || 'rsipu30';", "        const targetId = window.location.hash.slice(1) || 'rsipu30';\n        if (targetId === 'dashboard') { window.location.replace('/scanner'); return; }")
text = text.replace("        const marketControls = document.getElementById('market-radar-controls');\n        if (marketControls) marketControls.hidden = targetId !== 'dashboard';\n", '')
text = text.replace("'#18181b'", "'#111b28'").replace("'#27272a'", "'#27384b'").replace('📈 GRAFİĞİ GÖSTER', 'Grafiği incele')
text = text.replace('Deliberately separate from the sniper radar above: own endpoints', 'The canonical RSI interface uses its own endpoints')
path.write_text(text, encoding='utf-8')
path = root / 'public/mtf-lab.html'
text = path.read_text(encoding='utf-8')
start = text.index('        <nav class="strategy-pages"')
end = text.index('        <section id="mtf-lab-container"', start)
text = text[:start] + text[end:]
start = text.index('            <div class="lab-heading">')
end = text.index('            <div class="lab-guide">', start)
text = text[:start] + '<header class="workspace-header"><div><span class="rsi-eyebrow">ARAŞTIRMA · ÇOKLU ZAMAN DİLİMİ</span><h1>MTF Strateji Lab</h1><div class="workspace-description">Zaman dilimlerini, strateji evresini ve kararın gerekçesini birlikte inceleyin.</div></div></header>\n' + text[end:]
text = text.replace('<div class="rsi-content">', '<div class="rsi-content rsi-workspace">')
for old, new in [('🟡 EVRE 1 · Saatlik Tepki', 'Evre 1 · Saatlik tepki'), ('🟢 EVRE 2 · Tam Onaylı Ralli', 'Evre 2 · Tam onay'), ('🔴 EVRE 3 · Alt Periyot NU Baskısı', 'Evre 3 · Alt periyot baskısı')]:
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
path = root / 'public/static/mtf-lab.js'
text = path.read_text(encoding='utf-8').replace('🟡 EVRE 1 · Saatlik Tepki / 4S Son Dip Bekleniyor', 'Evre 1 · Saatlik tepki / 4s son dip bekleniyor').replace('🟢 EVRE 2 · Tam Onaylı Ralli / Makro Fibo', 'Evre 2 · Tam onay / Makro Fibo').replace('🔴 EVRE 3 · Alt Periyot NU Baskısı', 'Evre 3 · Alt periyot NU baskısı')
path.write_text(text, encoding='utf-8')
