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

    // Google Auth Navigation Button
    const headerActions = typeof document.querySelector === 'function'
        ? document.querySelector('.rsi-header-actions')
        : (typeof document.getElementsByClassName === 'function' ? document.getElementsByClassName('rsi-header-actions')[0] : null);
    if (headerActions && !document.getElementById('rsi-auth-btn-wrap') && typeof document.createElement === 'function') {
        const wrap = document.createElement('div');
        wrap.id = 'rsi-auth-btn-wrap';
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        wrap.style.marginLeft = '0.5rem';
        headerActions.appendChild(wrap);

        if (typeof fetch === 'function') {
            fetch('/api/auth/me')
                .then(r => r.json())
                .then(data => {
                    if (data.authenticated && data.user) {
                        const u = data.user;
                        const avatar = u.picture
                            ? `<img src="${u.picture}" alt="${u.name}" style="width:20px;height:20px;border-radius:50%;border:1px solid rgba(6,182,212,0.5);margin-right:6px;" referrerpolicy="no-referrer">`
                            : `<span style="width:20px;height:20px;border-radius:50%;background:#0891b2;color:#fff;font-weight:bold;font-size:10px;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;">${(u.name||'U').charAt(0).toUpperCase()}</span>`;
                        wrap.innerHTML = `
                            <div style="display:flex;align-items:center;background:rgba(15,23,42,0.85);border:1px solid rgba(51,65,85,0.8);padding:3px 10px;border-radius:10px;font-size:12px;color:#e2e8f0;">
                                ${avatar}
                                <span style="font-weight:600;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${u.email}">${u.name}</span>
                                <a href="/api/auth/logout" style="color:#94a3b8;font-weight:700;margin-left:8px;font-size:11px;text-decoration:none;" title="Çıkış Yap">Çıkış</a>
                            </div>
                        `;
                    } else {
                        if (typeof window !== 'undefined' && window.location && typeof window.location.replace === 'function' && !window.location.pathname.startsWith('/login')) {
                            window.location.replace('/login');
                            return;
                        }
                        wrap.innerHTML = `
                            <a href="/api/auth/google" style="display:inline-flex;align-items:center;gap:6px;background:rgba(15,23,42,0.85);border:1px solid rgba(51,65,85,0.8);padding:5px 12px;border-radius:10px;font-size:12px;font-weight:600;color:#e2e8f0;text-decoration:none;transition:all 0.2s;" title="Google Hesabınızla Giriş Yapın">
                                <svg style="width:14px;height:14px;" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                                </svg>
                                <span>Google ile Giriş</span>
                            </a>
                        `;
                    }
                })
                .catch(() => {});
        }
    }
});
