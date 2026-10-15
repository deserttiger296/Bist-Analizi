// Opt-in laboratory: no references to classic card/chart objects or scan handlers.
window.initMtfLab = function () {
    const lab = document.getElementById('mtf-lab-container');
    if (!lab || lab.dataset.initialized) return;
    lab.dataset.initialized = 'true';
    const list = lab.querySelector('[data-lab-list]');
    const message = lab.querySelector('[data-lab-status]');
    const filters = lab.querySelectorAll('[data-lab-filter]');
    const scan = lab.querySelector('[data-lab-scan]');
    const detail = lab.querySelector('[data-lab-detail]');
    let rows = [], selected = 'EARLY_REACTION', controller = null;
    const labels = {
        EARLY_REACTION: '🟡 EVRE 1 · Saatlik Tepki / 4S Son Dip Bekleniyor',
        FULL_CONFIRMATION: '🟢 EVRE 2 · Tam Onaylı Ralli / Makro Fibo',
        LOWER_TF_NU_PRESSURE: '🔴 EVRE 3 · Alt Periyot NU Baskısı',
    };
    const money = value => value == null ? '—' : Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    function line(parent, text, tag = 'p') {
        const element = document.createElement(tag);
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }
    function dailySummary(d) {
        const daily = d.daily_structure;
        const pu = value => value == null ? 'bilinmiyor' : value ? 'var' : 'yok';
        return `1S PU: ${pu(d.layer_flags['1S_PU'])} · 4S PU: ${pu(d.layer_flags['4S_PU'])} · Günlük: ${daily.status} (${daily.source || daily.support_source || 'bilinmiyor'}) · Günlük RSI: ${money(daily.current_rsi)} · Önceki dip RSI: ${money(daily.d1_rsi)} · Destek: ${money(daily.support)} ₺ · Son günlük Low: ${money(daily.current_low)} ₺ · Gerekçe: ${daily.reason || 'bilinmiyor'}`;
    }
    function renderDetail(row) {
        detail.replaceChildren();
        const d = row.decision;
        line(detail, `${row.symbol} · ${d.label}`, 'h3');
        line(detail, d.action);
        line(detail, dailySummary(d));
        line(detail, `Ana direnç: ${money(d.resistance)} ₺`);
        const lower = d.lower_timeframes?.timeframes || {};
        for (const tf of ['15m', '1h']) {
            const s = lower[tf], most = s?.most;
            const answer = value => value == null ? 'bilinmiyor' : value ? 'evet' : 'hayır';
            line(detail, `${tf === '15m' ? '15D' : '1S'} · NU: ${answer(s?.nu_pressure)} · RSI düşen trend kırıldı: ${answer(s?.rsi_trend_broken)}`);
            line(detail, `Fiyat EMA(9) üstünde: ${answer(most?.above_ema)} (${money(most?.current_ema)}) · MOST %1,1 üstünde: ${answer(most?.above_most)} (${money(most?.current_most)})`);
            if (s?.latest_bar_time) line(detail, `Son mum: ${s.latest_bar_time} · ${s.latest_bar_closed ? 'kapalı' : 'oluşuyor; MOST değerleri geçici'}`);
        }
        if (d.macro_fibonacci.status === 'AVAILABLE') {
            for (const level of d.macro_fibonacci.levels) line(detail, `${level.label}: ${money(level.price)} ₺`);
        }
        line(detail, `Veri: ${Object.entries(row.data_statuses).map(([tf, status]) => `${tf}: ${status}`).join(' · ')}`);
        detail.hidden = false;
    }
    function render() {
        list.replaceChildren();
        for (const button of filters) {
            const count = rows.filter(r => r.decision.state === button.dataset.labFilter).length;
            button.textContent = `${labels[button.dataset.labFilter]} (${count})`;
            button.setAttribute('aria-pressed', String(button.dataset.labFilter === selected));
        }
        const otherList = lab.querySelector('[data-lab-other-list]');
        if (otherList) {
            otherList.replaceChildren();
            for (const row of rows.filter(r => !labels[r.decision.state])) {
                const card = document.createElement('article');
                card.className = 'lab-card';
                line(card, `${row.symbol} · ${row.decision.label}`, 'h3');
                line(card, dailySummary(row.decision));
                const button = line(card, 'Laboratuvar detayı', 'button');
                button.type = 'button';
                button.addEventListener('click', () => renderDetail(row));
                otherList.appendChild(card);
            }
        }
        const visible = rows.filter(r => r.decision.state === selected);
        if (!visible.length) line(list, 'Bu kategoride hisse yok. Veri eksikliği veya günlük veto durumları alım onayı sayılmaz.');
        for (const row of visible) {
            const card = document.createElement('article');
            card.className = 'lab-card';
            card.dataset.state = selected;
            line(card, `${row.symbol} · ${labels[selected]}`, 'h3');
            line(card, row.decision.action);
            line(card, dailySummary(row.decision));
            if (row.decision.macro_fibonacci.status === 'AVAILABLE') line(card, `İlk ana hedef · Makro Fibo 0.382: ${money(row.decision.macro_fibonacci.target_0382)} ₺`);
            if (selected === 'LOWER_TF_NU_PRESSURE') {
                for (const [tf, s] of Object.entries(row.decision.lower_timeframes?.timeframes || {})) {
                    const above = value => value == null ? 'bilinmiyor' : value ? 'üstünde' : 'üstünde değil';
                    line(card, `${tf} · EMA(9): ${money(s.most?.current_ema)} (${above(s.most?.above_ema)}) · MOST %1,1: ${money(s.most?.current_most)} (${above(s.most?.above_most)}) · RSI trend kırılımı: ${s.rsi_trend_broken == null ? 'bilinmiyor' : s.rsi_trend_broken ? 'var' : 'yok'}`);
                }
            }
            const button = line(card, 'Laboratuvar detayı', 'button');
            button.type = 'button';
            button.addEventListener('click', () => renderDetail(row));
            list.appendChild(card);
        }
    }
    async function request(symbol) {
        controller?.abort();
        const own = new AbortController();
        controller = own;
        message.textContent = 'Laboratuvar verisi hesaplanıyor…';
        scan.disabled = true;
        const timer = setTimeout(() => own.abort(), 280000);
        try {
            const url = symbol ? `/api/mtf-lab/${encodeURIComponent(symbol)}` : '/api/mtf-lab';
            const response = await fetch(url, { cache: 'no-store', signal: own.signal });
            const body = await response.json();
            if (!response.ok || !body.data || body.status === 'error') throw new Error(body.detail || 'Laboratuvar yanıt vermedi');
            if (own !== controller || lab.hidden) return;
            rows = symbol ? [body.data] : body.data.rows;
            if (symbol && labels[body.data.decision.state]) selected = body.data.decision.state;
            render();
            const other = rows.filter(r => !labels[r.decision.state]).length;
            message.textContent = `${rows.length} hisse incelendi · ${other} hisse bekleme / günlük veto / eksik veri durumunda.` + (body.data.errors?.length ? ` ${body.data.errors.length} veri uyarısı var.` : '');
            if (symbol) renderDetail(body.data);
        } catch (error) {
            if (own === controller && !lab.hidden) message.textContent = error.name === 'AbortError' ? 'İstek iptal edildi veya süre sınırına ulaştı. Tek hisseyle tekrar deneyebilirsin.' : error.message;
        } finally {
            clearTimeout(timer);
            if (own === controller) scan.disabled = false;
        }
    }
    for (const button of filters) button.addEventListener('click', () => { selected = button.dataset.labFilter; render(); });
    scan.addEventListener('click', () => request());
    lab.querySelector('[data-lab-symbol-form]').addEventListener('submit', event => {
        event.preventDefault();
        const symbol = lab.querySelector('[data-lab-symbol]').value.trim().toUpperCase();
        if (symbol) request(symbol);
    });
};

document.addEventListener("DOMContentLoaded", () => window.initMtfLab());
