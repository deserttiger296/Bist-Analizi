"""Keep the two static entry points aligned with the React system navigation."""
import html
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
GROUPS = json.loads((ROOT / 'src/lib/system-navigation.json').read_text(encoding='utf-8'))


def icon(name):
    return f'<svg class="rsi-icon" aria-hidden="true"><use href="/static/rsi-icons.svg#{name}"></use></svg>'


def sidebar():
    nav = []
    for group in GROUPS:
        nav.append(f'<li class="rsi-nav-group">{group["label"]}</li>')
        for item in group['items']:
            badge = f'<small class="rsi-nav-badge">{item["badge"]}</small>' if 'badge' in item else ''
            nav.append(f'<li><a data-system-link href="{html.escape(item["href"])}">{icon(item["icon"])}<span>{item["label"]}</span>{badge}</a></li>')
    return '''<aside class="sidebar rsi-sidebar" id="rsi-sidebar" aria-label="Ana menü">
        <a class="rsi-brand" href="/index.html"><img src="/static/rsi-mark.svg" alt="" width="42" height="42"><div><strong>RSI Analizi</strong><span>TEKNİK ANALİZ PLATFORMU</span></div></a>
        <nav aria-label="Tüm sistemler"><ul class="nav-links">''' + '\n'.join(nav) + '''</ul></nav>
        <div class="rsi-sidebar-footer"><details class="rsi-engine-details"><summary>Motor ve model durumu</summary><div class="system-status"><div class="status-item" id="status-backend"><span class="dot"></span>Motor kontrol ediliyor…</div><div class="status-item" id="status-rf">RF: —</div><div class="status-item" id="status-lstm">LSTM: —</div><div class="status-item" id="status-sentiment">Haber analizi: —</div></div></details><strong>Araştırın. Karşılaştırın. Doğrulayın.</strong><p>Yeni özellikler önce Test Merkezi'nde.</p></div>
    </aside>'''


def header(lab):
    return f'''<button class="rsi-menu-overlay" id="rsi-menu-overlay" aria-label="Menüyü kapat" type="button"></button>
        <header class="rsi-topbar">
            <button class="rsi-menu-button" id="rsi-menu-toggle" aria-label="Menüyü aç" aria-controls="rsi-sidebar" aria-expanded="false" type="button">{icon('menu')}</button>
            <div class="rsi-breadcrumb"><span>Çalışma alanı</span><span>/</span><strong data-page-name>{'MTF Strateji Lab' if lab else 'RSI Radarı'}</strong></div>
            <div class="rsi-header-actions"><span class="rsi-environment">BIST · ARAŞTIRMA</span><a class="rsi-help-link" href="/lab">{icon('shield')}Test Merkezi</a></div>
        </header>'''


def sync():
    for name in ('index.html', 'mtf-lab.html'):
        path = ROOT / 'public' / name
        text = path.read_text(encoding='utf-8')
        text = re.sub(r'<title>.*?</title>', f'<title>RSI Analizi | {"MTF Strateji Lab" if name.startswith("mtf") else "RSI Radarı"}</title>', text)
        text = re.sub(r'<body[^>]*>', '<body class="rsi-app rsi-static" data-menu-open="false">', text, count=1)
        text = re.sub(r'<aside class="sidebar[^\"]*"[^>]*>.*?</aside>|<nav class="sidebar[^\"]*"[^>]*>.*?</nav>', lambda _: sidebar(), text, count=1, flags=re.S)
        if 'id="rsi-menu-toggle"' not in text:
            text = text.replace('<main class="main-content">', '<main class="main-content">\n' + header(name.startswith('mtf')) + '\n<div class="rsi-content">')
            text = text.replace('</main>', '</div>\n</main>', 1)
        if '/static/app-shell.css' not in text:
            text = text.replace('</head>', '<link rel="icon" href="/static/rsi-mark.svg" type="image/svg+xml">\n<link rel="stylesheet" href="/static/app-shell.css?v=20261115-brand1">\n</head>')
        if '/static/app-shell.js' not in text:
            text = text.replace('</body>', '<script src="/static/app-shell.js?v=20261115-brand1"></script>\n</body>')
        if '/static/workspace.css' not in text:
            text = text.replace('</head>', '<link rel="stylesheet" href="/static/workspace.css?v=20261115-workspace2">\n</head>')
        text = text.replace('🎯 Klasik RSI Radarı (Ana Sistem)', 'RSI Radarı').replace('🧪 MTF Strateji Laboratuvarı (Test)', 'MTF Strateji Lab').replace('🔬 Test ve Doğrulama Merkezi', 'Test Merkezi')
        text = text.replace('v=20261015-pages2', 'v=20261115-brand1').replace('v=20261015-pages3', 'v=20261115-brand1')
        text = text.replace('<strong>RSI Radarı</strong></div>', '<strong data-page-name>RSI Radarı</strong></div>').replace('<strong>MTF Strateji Lab</strong></div>', '<strong data-page-name>MTF Strateji Lab</strong></div>')
        path.write_text(text, encoding='utf-8', newline='\n')
        shutil.copyfile(path, ROOT / 'python_bot/static' / name)
    for asset in ('app-shell.css', 'workspace.css', 'app-shell.js', 'app.js', 'mtf-lab.js', 'mtf-lab.css', 'rsi-mark.svg', 'rsi-icons.svg'):
        shutil.copyfile(ROOT / 'public/static' / asset, ROOT / 'python_bot/static' / asset)
    shutil.copyfile(ROOT / 'public/static/rsi-mark.svg', ROOT / 'src/app/icon.svg')


if __name__ == '__main__':
    sync()
