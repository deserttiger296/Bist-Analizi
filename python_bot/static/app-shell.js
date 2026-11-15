document.addEventListener('DOMContentLoaded', () => {
    const root = document.body;
    const toggle = document.getElementById('rsi-menu-toggle');
    const overlay = document.getElementById('rsi-menu-overlay');
    const sidebar = document.getElementById('rsi-sidebar');
    function closeMenu() {
        root.dataset.menuOpen = 'false';
        toggle?.setAttribute('aria-expanded', 'false');
    }
    toggle?.addEventListener('click', () => {
        const open = root.dataset.menuOpen !== 'true';
        root.dataset.menuOpen = String(open);
        toggle.setAttribute('aria-expanded', String(open));
    });
    overlay?.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && root.dataset.menuOpen === 'true') {
            closeMenu(); toggle?.focus();
        }
    });
    sidebar?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    function markCurrentPage() {
        const current = window.location.pathname + (window.location.hash || (window.location.pathname.endsWith('index.html') ? '#rsipu30' : ''));
        sidebar?.querySelectorAll('a[data-system-link]').forEach(link => {
            const active = link.getAttribute('href') === current;
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
            const breadcrumb = document.querySelector?.('[data-page-name]');
            if (active && breadcrumb) breadcrumb.textContent = link.querySelector('span').textContent;
        });
    }
    window.addEventListener('hashchange', markCurrentPage);
    markCurrentPage();
    // The strategy page has its own engine and does not load the classic radar script.
    if (document.getElementById('mtf-lab-container')) {
        const status = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
        fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
            .then(async response => { if (!response.ok) throw new Error('Engine unavailable'); return response.json(); })
            .then(health => {
                if (health.status !== 'ok') throw new Error('Engine unavailable');
                status('status-backend', 'Sinyal motoru çevrimiçi');
                status('status-rf', health.rf_model?.present ? 'RF modeli hazır' : 'RF modeli bu motorda kullanılamıyor');
                status('status-lstm', health.lstm?.usable ? 'LSTM hazır' : 'LSTM bu motorda kullanılamıyor');
                status('status-sentiment', `Haber motoru: ${health.sentiment_engine === 'finbert' ? 'FinBERT' : health.sentiment_engine === 'none' ? 'kullanılamıyor' : 'sözlük tabanlı'}`);
            }).catch(() => status('status-backend', 'Sinyal motoruna erişilemiyor'));
    }
});
