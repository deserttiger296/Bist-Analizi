"""The shared RSI Analizi interface is registered in the Test Center first."""
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def test_all_active_screens_use_one_workspace_layout():
    pages = ['scanner/page.tsx', 'radar/page.tsx', 'agentic-ai/page.tsx',
             '(trading)/signal-terminal/page.tsx', 'analysis/[symbol]/page.tsx',
             'report/page.tsx', 'history/page.tsx', 'lab/page.tsx']
    for page in pages:
        source = (ROOT / 'src/app' / page).read_text(encoding='utf-8')
        assert '<WorkspacePage' in source, page
        assert '<h1' not in source, f'{page}: duplicate page heading'
        assert not re.search(r'Quantum Sniper|QUANTUM SNIPER|AGENTIC AI KUANT', source, re.I), page


def test_shared_workspace_accessibility_and_states():
    result = subprocess.run(['node', '--test', 'scripts/test_workspace_ui.cjs'], cwd=ROOT,
                            capture_output=True, text=True, timeout=25)
    assert result.returncode == 0, result.stdout + result.stderr


def test_legacy_market_screen_is_consolidated_into_the_scanner():
    groups = json.loads((ROOT / 'src/lib/system-navigation.json').read_text(encoding='utf-8'))
    assert '/index.html#dashboard' not in [item['href'] for group in groups for item in group['items']]
    html = (ROOT / 'public/index.html').read_text(encoding='utf-8')
    assert 'id="dashboard"' not in html
    assert 'id="market-radar-controls"' not in html
    assert 'id="chartModal"' not in html


def test_navigation_lists_real_systems_once_and_has_no_dead_routes():
    groups = json.loads((ROOT / 'src/lib/system-navigation.json').read_text(encoding='utf-8'))
    links = [item for group in groups for item in group['items']]
    urls = [item['href'] for item in links]
    assert len(urls) == len(set(urls))
    assert {'/index.html#rsipu30', '/mtf-lab.html', '/lab', '/agentic-ai', '/signal-terminal', '/report', '/history'} <= set(urls)
    for url in urls:
        route = url.split('#')[0]
        if route.endswith('.html'):
            assert (ROOT / 'public' / route.lstrip('/')).exists(), url
        else:
            assert list((ROOT / 'src/app').glob('**/' + route.strip('/') + '/page.tsx')), url


def test_static_pages_share_brand_navigation_and_accessible_mobile_controls():
    groups = json.loads((ROOT / 'src/lib/system-navigation.json').read_text(encoding='utf-8'))
    for name in ('index.html', 'mtf-lab.html'):
        html = (ROOT / 'public' / name).read_text(encoding='utf-8')
        assert 'RSI Analizi' in html
        assert 'QUANTUM SNIPER' not in html
        assert 'id="rsi-menu-toggle"' in html and 'aria-controls="rsi-sidebar"' in html
        assert 'src="/static/app-shell.js' in html
        assert 'href="/static/app-shell.css' in html
        assert 'src="/static/rsi-mark.svg"' in html
        sidebar = html.split('id="rsi-sidebar"', 1)[1].split('</aside>', 1)[0]
        for group in groups:
            for item in group['items']:
                assert f'href="{item["href"]}"' in sidebar
        ids = re.findall(r'\bid="([^"]+)"', html)
        assert len(ids) == len(set(ids))


def test_vector_logo_and_mirrored_static_assets_are_consistent():
    logo = ROOT / 'public/static/rsi-mark.svg'
    svg = ET.fromstring(logo.read_text(encoding='utf-8'))
    assert svg.tag.endswith('svg') and svg.get('viewBox')
    assert (ROOT / 'src/app/icon.svg').read_bytes() == logo.read_bytes()
    for asset in ('index.html', 'mtf-lab.html', 'static/app-shell.css', 'static/app-shell.js', 'static/rsi-mark.svg', 'static/rsi-icons.svg'):
        mirror = asset.removeprefix('static/')
        assert (ROOT / 'public' / asset).read_bytes() == (ROOT / 'python_bot/static' / mirror).read_bytes()
