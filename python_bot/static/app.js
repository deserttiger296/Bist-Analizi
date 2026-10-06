document.addEventListener('DOMContentLoaded', () => {
    // Gerçek sağlık durumu -- sabit "Online" yazısı yerine /api/health yanıtı.
    function setStatus(id, color, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `<span class="dot ${color}"></span> `;
        el.appendChild(document.createTextNode(text));
    }
    function renderWeights(rf) {
        const box = document.getElementById('weights-chart');
        if (!box) return;
        box.innerHTML = '';
        if (!rf || !rf.present || !rf.feature_importances) {
            const p = document.createElement('p');
            p.className = 'disclaimer';
            p.textContent = rf && rf.note
                ? `RF model ağırlıkları: ${rf.note} (ML modelleri yalnızca tam yerel motorda çalışır).`
                : 'Model ağırlıkları alınamadı (backend erişilemiyor veya model eğitilmemiş).';
            box.appendChild(p);
            return;
        }
        rf.feature_importances.forEach(({ feature, importance }) => {
            const pct = (importance * 100).toFixed(2);
            const row = document.createElement('div');
            row.className = 'weight-bar-container';
            row.innerHTML = `<div class="weight-label"><span></span> <span>%${pct}</span></div>
                <div class="weight-bar"><div class="fill" style="width: ${pct}%; background: #00cc88;"></div></div>`;
            row.querySelector('.weight-label span').textContent = feature;
            box.appendChild(row);
        });
        const note = document.createElement('p');
        note.className = 'disclaimer';
        const acc = rf.validation_results && rf.validation_results.selection_accuracy;
        note.textContent = `* ${rf.model_version}, eğitim ${String(rf.training_start).slice(0, 10)} – ${String(rf.training_end).slice(0, 10)}` +
            (acc != null ? `; seçim dönemi doğruluğu %${(acc * 100).toFixed(1)} (3 sınıf, naif taban ~%33).` : '.');
        box.appendChild(note);
    }

    fetch('/api/health').then(r => r.json()).then(h => {
        if (h.status !== 'ok') throw new Error(h.detail || 'Backend erişilemiyor');
        if (h.deployment === 'vercel-lite') {
            setStatus('status-backend', 'green', 'Sinyal motoru: Çevrimiçi (RSI/MOSTRSI)');
            setStatus('status-rf', 'amber', 'RF: bu dağıtımda yok');
            setStatus('status-lstm', 'amber', 'LSTM: bu dağıtımda yok');
            setStatus('status-sentiment', 'amber', 'Haber Analizi: bu dağıtımda yok');
            renderWeights(h.rf_model);
            return;
        }
        setStatus('status-backend', 'green', 'Backend: Çevrimiçi');
        setStatus('status-rf', h.rf_model.present ? 'green' : 'red',
            h.rf_model.present ? `RF Modeli: ${h.rf_model.model_version}` : 'RF Modeli: EĞİTİLMEMİŞ');
        setStatus('status-lstm', h.lstm.usable ? 'green' : 'amber',
            h.lstm.usable ? 'LSTM: Hazır' : (h.lstm.torch_installed ? 'LSTM: Model eğitilmemiş' : 'LSTM: torch kurulu değil'));
        setStatus('status-sentiment', h.sentiment_engine === 'finbert' ? 'green' : 'amber',
            h.sentiment_engine === 'finbert' ? 'Haber Analizi: FinBERT' : 'Haber Analizi: Sözlük (FinBERT yok)');
        renderWeights(h.rf_model);
    }).catch(err => {
        renderWeights(null);
        setStatus('status-backend', 'red', `Backend: Erişilemiyor`);
        ['status-rf', 'status-lstm', 'status-sentiment'].forEach(id => setStatus(id, '', id.replace('status-', '').toUpperCase() + ': bilinmiyor'));
    });

    // Navigation
    const navLinks = document.querySelectorAll('.nav-links a');
    const sections = document.querySelectorAll('.view-section');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            
            navLinks.forEach(l => l.parentElement.classList.remove('active'));
            link.parentElement.classList.add('active');

            sections.forEach(sec => sec.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Elements
    const scanBtn = document.getElementById('scanBtn');
    const scanAllBtn = document.getElementById('scanAllBtn');
    const symbolInput = document.getElementById('symbolInput');
    const errorMsg = document.getElementById('errorMsg');
    const scanStatus = document.getElementById('scanStatus');
    const radarResults = document.getElementById('radarResults');
    const radarGrid = document.getElementById('radarGrid');
    
    // Chart Modal
    const chartModal = document.getElementById('chartModal');
    const closeModal = document.getElementById('closeModal');
    const chartTitle = document.getElementById('chartTitle');
    const tvchartDiv = document.getElementById('tvchart');
    let chart = null;
    let candleSeries = null;
    let smaSeries = null;
    let emaSeries = null;

    closeModal.addEventListener('click', () => {
        chartModal.classList.add('hidden');
    });

    scanAllBtn.addEventListener('click', async () => {
        errorMsg.classList.add('hidden');
        radarResults.classList.add('hidden');
        scanStatus.classList.remove('hidden');
        scanAllBtn.disabled = true;

        try {
            const response = await fetch('/api/scan_all');
            const json = await response.json();

            // "error" = hiçbir hisse taranamadı (model/veri/backend) -- boş radar "sinyal yok" gibi gösterilmemeli.
            if (!response.ok || json.status === 'error' || json.status === 'backend_unavailable' || json.status === 'timeout') {
                const firstErr = json.errors && json.errors.length ? ` (${json.errors[0].error})` : '';
                throw new Error((json.detail || 'Tarama başarısız: hiçbir hisse taranamadı') + firstErr);
            }
            renderRadar(json.data, json);
            if (json.status === 'partial') {
                errorMsg.textContent = `Kısmi tarama: ${json.scanned}/${json.attempted} hisse tarandı, ${json.errors.length} hisse hata verdi.`;
                errorMsg.classList.remove('hidden');
            }

        } catch (error) {
            errorMsg.textContent = error.message;
            errorMsg.classList.remove('hidden');
        } finally {
            scanStatus.classList.add('hidden');
            scanAllBtn.disabled = false;
        }
    });

    const results = document.getElementById('results');

    async function handleSingleScan() {
        const symbol = (symbolInput.value || '').trim().toUpperCase();
        if (!symbol) return;
        errorMsg.classList.add('hidden');
        if (results) results.classList.add('hidden');
        scanStatus.classList.remove('hidden');
        scanBtn.disabled = true;

        try {
            const res = await fetch(`/api/bist/${symbol}`);
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || `${symbol} verisi alınamadı.`);

            renderSingleStock(data);
        } catch (error) {
            errorMsg.textContent = error.message;
            errorMsg.classList.remove('hidden');
        } finally {
            scanStatus.classList.add('hidden');
            scanBtn.disabled = false;
        }
    }

    function renderSingleStock(stock) {
        if (!results) return;
        results.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'card';
        const changePercent = stock.changePercent != null ? stock.changePercent : ((stock.change && stock.lastClose) ? (stock.change / stock.lastClose * 100) : 0);
        const changeSign = changePercent >= 0 ? '+' : '';
        const changeColor = changePercent >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        
        card.innerHTML = `
            <div class="card-top">
                <div class="card-symbol">${stock.symbol}</div>
                <div class="card-badge" style="color: ${changeColor}; border: 1px solid ${changeColor};">
                    ${changeSign}${changePercent.toFixed(2)}%
                </div>
            </div>
            
            <div class="target-grid">
                <div class="target-item">
                    <div class="target-label">Son Fiyat</div>
                    <div class="target-val">${stock.lastClose ? Number(stock.lastClose).toFixed(2) : '-'} ₺</div>
                </div>
                <div class="target-item">
                    <div class="target-label">Gün İçi En Yüksek</div>
                    <div class="target-val">${stock.high ? Number(stock.high).toFixed(2) : '-'} ₺</div>
                </div>
                <div class="target-item">
                    <div class="target-label">Gün İçi En Düşük</div>
                    <div class="target-val">${stock.low ? Number(stock.low).toFixed(2) : '-'} ₺</div>
                </div>
            </div>

            <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                <button class="btn-chart" data-symbol="${stock.symbol}">📈 GRAFİĞİ GÖSTER</button>
            </div>
        `;

        const chartBtn = card.querySelector('.btn-chart');
        chartBtn.addEventListener('click', () => openChart(stock.symbol));

        results.appendChild(card);
        results.classList.remove('hidden');
    }

    if (scanBtn) scanBtn.addEventListener('click', handleSingleScan);
    if (symbolInput) symbolInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSingleScan();
    });

    function renderRadar(stocks, meta) {
        radarGrid.innerHTML = '';
        if (!stocks || stocks.length === 0) {
            const scannedInfo = meta && meta.scanned != null ? ` (${meta.scanned}/${meta.attempted} hisse tarandı)` : '';
            radarGrid.innerHTML = `<p style="color:var(--text-muted);">Tarama tamamlandı${scannedInfo}: kriterleri karşılayan hisse yok.</p>`;
        } else {
            stocks.forEach(stock => {
                const upProb = (stock.class_probabilities.UP * 100).toFixed(1);
                
                let reasonsHtml = '<ul class="reasons-list">';
                if (stock.explanation) {
                    stock.explanation.forEach(r => { reasonsHtml += `<li>${r}</li>`; });
                }
                reasonsHtml += '</ul>';

                const shadow = stock.decision_mode !== 'decide';
                let badgeHtml = '';
                if (shadow) {
                    badgeHtml = `<div class="card-badge" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b;">GÖLGE · RF %${upProb}${stock.quantum_approved ? ' + LSTM' : ''} (doğrulanmamış)</div>`;
                } else if (stock.quantum_approved) {
                    badgeHtml = `<div class="card-badge" style="background: rgba(16, 185, 129, 0.2); border: 1px solid var(--neon-green);">🚀 KUANTUM ONAYI (RF & LSTM)</div>`;
                } else {
                    badgeHtml = `<div class="card-badge" style="background: rgba(59, 130, 246, 0.1); color: var(--accent);">RF Skor: %${upProb}</div>`;
                }

                const targetUsd = (stock.target_price_usd != null && stock.target_price_usd > 0)
                    ? stock.target_price_usd
                    : ((stock.target_price_tl && stock.usd_rate) ? (stock.target_price_tl / stock.usd_rate) : null);

                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <div class="card-top">
                        <div class="card-symbol">${stock.symbol}</div>
                        ${badgeHtml}
                    </div>
                    
                    <div class="target-grid">
                        <div class="target-item">
                            <div class="target-label">Mevcut Fiyat</div>
                            <div class="target-val">${stock.current_price ? stock.current_price.toFixed(2) : '-'} ₺</div>
                        </div>
                        <div class="target-item">
                            <div class="target-label">Hedef Fiyat (TL)</div>
                            <div class="target-val val-green">🎯 ${stock.target_price_tl ? stock.target_price_tl.toFixed(2) : '-'} ₺</div>
                        </div>
                        <div class="target-item">
                            <div class="target-label">Hedef Fiyat (USD)</div>
                            <div class="target-val val-green">💵 $${targetUsd ? targetUsd.toFixed(2) : '-'}</div>
                        </div>
                    </div>
                    
                    ${reasonsHtml}
                    
                    <button class="btn-chart" data-symbol="${stock.symbol}">📈 GRAFİĞİ GÖSTER</button>
                `;
                
                // Add Chart Listener
                const chartBtn = card.querySelector('.btn-chart');
                chartBtn.addEventListener('click', () => openChart(stock.symbol));

                radarGrid.appendChild(card);
            });
        }
        radarResults.classList.remove('hidden');
    }

    async function openChart(symbol) {
        chartTitle.textContent = `${symbol} - AI Analiz Grafiği (TradingView)`;
        chartModal.classList.remove('hidden');
        
        // Init Chart if not already
        if (!chart) {
            chart = LightweightCharts.createChart(tvchartDiv, {
                layout: { background: { type: 'solid', color: '#18181b' }, textColor: '#d1d4dc' },
                grid: { vertLines: { color: '#27272a' }, horzLines: { color: '#27272a' } },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                timeScale: { borderColor: '#27272a' }
            });
            
            // v5 removed chart.addCandlestickSeries()/addLineSeries() -- the CDN
            // tag has no version pin and now serves 5.2.1, so these calls would
            // throw. v5's replacement is addSeries(SeriesType, options).
            candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, { upColor: '#10b981', downColor: '#ef4444', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444' });
            smaSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#3b82f6', lineWidth: 2, title: 'SMA 50' });
            emaSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 2, title: 'EMA 9' });
        } else {
            // Clear existing data
            candleSeries.setData([]);
            smaSeries.setData([]);
            emaSeries.setData([]);
        }

        try {
            const res = await fetch(`/api/chart/${symbol}`);
            const json = await res.json();

            // Two backends answer /api/chart: the Python engine returns
            // {status:'success', data:[{time,...,sma50,ema9}]}, while on Vercel
            // next.config rewrites it to /api/bist/:symbol/chart, which returns
            // {data:{chartData:[{date,...,sma50}]}} (no status, no ema9).
            const data = json.status === 'success' ? json.data : (json.data && json.data.chartData);
            if (!res.ok || !Array.isArray(data) || data.length === 0) {
                throw new Error(json.detail || json.error || `${symbol} grafik verisi alınamadı.`);
            }
            const rows = data.map(d => ({ ...d, time: d.time || d.date }));
            const cData = rows.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }));
            const sData = rows.filter(d => d.sma50 != null).map(d => ({ time: d.time, value: d.sma50 }));
            const eData = rows.filter(d => d.ema9 != null).map(d => ({ time: d.time, value: d.ema9 }));

            candleSeries.setData(cData);
            smaSeries.setData(sData);
            emaSeries.setData(eData);
            chart.timeScale().fitContent();
        } catch (e) {
            chartTitle.textContent = `${symbol} - ${e.message}`;
            console.error("Chart load failed", e);
        }
    }

    // ───────────────────────── RSI PU30 (Ayrı Motor) ─────────────────────────
    // Deliberately separate from the sniper radar above: own endpoints
    // (/api/scan/rsi-pu30), own cards, own chart modal. No shared state.
    const rsiPu30ScanBtn = document.getElementById('rsiPu30ScanBtn');
    const rsiPu30Status = document.getElementById('rsiPu30Status');
    const rsiPu30ErrorMsg = document.getElementById('rsiPu30ErrorMsg');
    const rsiPu30Results = document.getElementById('rsiPu30Results');
    const rsiPu30Grid = document.getElementById('rsiPu30Grid');
    const rsiPu30Scanned = document.getElementById('rsiPu30Scanned');
    const rsiPu30Matched = document.getElementById('rsiPu30Matched');
    const rsiPu30Skipped = document.getElementById('rsiPu30Skipped');

    const rsiPu30Modal = document.getElementById('rsiPu30Modal');
    const rsiPu30CloseModal = document.getElementById('rsiPu30CloseModal');
    const rsiPu30ChartTitle = document.getElementById('rsiPu30ChartTitle');
    const rsiPu30SignalInfo = document.getElementById('rsiPu30SignalInfo');
    let rsiPu30PriceChartInst = null;
    let rsiPu30RsiChartInst = null;
    let rsiPu30CandleSeries = null;
    let rsiPu30RsiSeries = null;
    let rsiPu30PriceMarkers = null;
    let rsiPu30RsiMarkers = null;
    let rsiPu30PriceConnector = null;
    let rsiPu30RsiConnector = null;
    let rsiPu30Interval = '4h';
    let rsiPu30Type = 'all';
    let rsiPu30LastData = null;
    let rsiPu30OpenSymbol = null;

    function fmtTR(v, digits = 2) {
        return (v == null || isNaN(v)) ? '-' : Number(v).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    if (rsiPu30CloseModal) {
        rsiPu30CloseModal.addEventListener('click', () => rsiPu30Modal.classList.add('hidden'));
    }

    const rsiPu30IntervalToggle = document.getElementById('rsiPu30IntervalToggle');
    if (rsiPu30IntervalToggle) {
        rsiPu30IntervalToggle.querySelectorAll('.interval-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('data-interval');
                if (next === rsiPu30Interval) return;
                rsiPu30Interval = next;
                rsiPu30IntervalToggle.querySelectorAll('.interval-btn').forEach((b) => b.classList.toggle('active', b === btn));
                if (rsiPu30PriceChartInst) {
                    rsiPu30PriceChartInst.remove();
                    rsiPu30RsiChartInst.remove();
                    rsiPu30PriceChartInst = null;
                    rsiPu30RsiChartInst = null;
                    rsiPu30CandleSeries = null;
                    rsiPu30RsiSeries = null;
                    rsiPu30PriceMarkers = null;
                    rsiPu30RsiMarkers = null;
                    rsiPu30PriceConnector = null;
                    rsiPu30RsiConnector = null;
                }
                rsiPu30Results.classList.add('hidden');
            });
        });
    }

    const rsiPu30TypeToggle = document.getElementById('rsiPu30TypeToggle');
    if (rsiPu30TypeToggle) {
        rsiPu30TypeToggle.querySelectorAll('.interval-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('data-type');
                if (next === rsiPu30Type) return;
                rsiPu30Type = next;
                rsiPu30TypeToggle.querySelectorAll('.interval-btn').forEach((b) => b.classList.toggle('active', b === btn));
                if (rsiPu30LastData) {
                    renderRsiPu30(rsiPu30LastData);
                }
            });
        });
    }

    if (rsiPu30ScanBtn) {
        rsiPu30ScanBtn.addEventListener('click', async () => {
            rsiPu30ErrorMsg.classList.add('hidden');
            rsiPu30Results.classList.add('hidden');
            rsiPu30Status.classList.remove('hidden');
            rsiPu30ScanBtn.disabled = true;

            try {
                const response = await fetch(`/api/scan/rsi-pu30?interval=${rsiPu30Interval}&signal_type=${rsiPu30Type}`);
                const text = await response.text();
                let json;
                try {
                    json = JSON.parse(text);
                } catch {
                    throw new Error("Tarama motoru veriyi hazırlıyor veya backend sunucusuna bağlanılamadı.");
                }
                if (!response.ok || json.status === 'error' || !json.data) {
                    const firstErr = json.data && json.data.errors && json.data.errors.length ? ` (${json.data.errors[0].error})` : '';
                    throw new Error((json.detail || 'Tarama başarısız: hiçbir hisse taranamadı') + firstErr);
                }
                renderRsiPu30(json.data);
                if (json.status === 'partial') {
                    rsiPu30ErrorMsg.textContent = `Kısmi tarama: ${json.data.scanned}/${json.data.attempted} hisse tarandı.`;
                    rsiPu30ErrorMsg.classList.remove('hidden');
                }
            } catch (error) {
                rsiPu30ErrorMsg.textContent = error.message;
                rsiPu30ErrorMsg.classList.remove('hidden');
            } finally {
                rsiPu30Status.classList.add('hidden');
                rsiPu30ScanBtn.disabled = false;
            }
        });
    }

    function renderRsiPu30(data) {
        if (!data) return;
        rsiPu30LastData = data;
        let signals = data.signals || [];
        if (rsiPu30Type === 'pu30') {
            signals = signals.filter(s => s.type === 'PU30' || s.trend === 'BULL');
        } else if (rsiPu30Type === 'nu70') {
            signals = signals.filter(s => s.type === 'NU70' || s.trend === 'BEAR');
        }

        rsiPu30Scanned.textContent = data.scanned != null ? data.scanned : '—';
        rsiPu30Matched.textContent = signals.length;
        rsiPu30Skipped.textContent = (!data.errors || data.errors.length === 0) ? '—' : data.errors.map(e => e.symbol).join(', ');

        rsiPu30Grid.innerHTML = '';
        if (signals.length === 0) {
            rsiPu30Grid.innerHTML = `<p style="color:var(--text-muted); padding:2rem; text-align:center;">Seçili zaman diliminde (${rsiPu30Interval.toUpperCase()}) bu filtrede uyumsuzluk sinyali bulunamadı.</p>`;
        } else {
            signals.forEach((s) => {
                const isNU = s.type === 'NU70' || s.trend === 'BEAR';
                const card = document.createElement('div');
                card.className = 'card';
                card.style.border = isNU ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)';

                const badgeBg = isNU ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)';
                const badgeColor = isNU ? '#f43f5e' : '#10b981';
                const badgeText = isNU ? '🔴 NU70 (DÜŞÜŞ)' : '🟢 PU30 (YÜKSELİŞ)';
                const barsText = s.bars_since_confirm === 0 ? "BU BAR" : `${s.bars_since_confirm || 0} BAR ÖNCE`;

                const p1 = s.tepe1 || s.dip1 || {};
                const p2 = s.tepe2 || s.dip2 || {};
                const p1Label = isNU ? "1. Tepe (RSI > 70)" : "1. Dip (RSI < 30)";
                const p2Label = isNU ? "2. Tepe (RSI < 70)" : "2. Dip (RSI > 30)";

                const rsiChange = (p2.rsi || 0) - (p1.rsi || 0);
                const rsiChangeText = (rsiChange >= 0 ? '+' : '') + fmtTR(rsiChange, 1);
                const rsiColor = isNU ? '#f43f5e' : '#10b981';

                const confluenceHtml = s.confluence_badge
                    ? `<div style="font-size:0.75rem; font-weight:800; padding:0.3rem 0.6rem; border-radius:6px; margin-top:0.5rem; display:inline-block; background:${isNU ? 'rgba(244,63,94,0.18)' : 'rgba(16,185,129,0.18)'}; border:1px solid ${isNU ? '#f43f5e' : '#10b981'}; color:${isNU ? '#fda4af' : '#6ee7b7'};">
                         ${s.confluence_badge}
                       </div>`
                    : '';

                let dataStatusHtml = '';
                if (s.data_status) {
                    const st = String(s.data_status).toUpperCase();
                    if (st === 'STALE') {
                        dataStatusHtml = `<div style="font-size:0.7rem; color:#f59e0b; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); border-radius:4px; padding:0.25rem 0.5rem; margin-top:0.4rem;">⚠️ Veri Güncel Değil (STALE) ${s.data_updated_at ? '· ' + s.data_updated_at.substring(0, 16) : ''}</div>`;
                    } else if (st === 'ERROR' || st === 'INSUFFICIENT_HISTORY') {
                        dataStatusHtml = `<div style="font-size:0.7rem; color:#f43f5e; background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.3); border-radius:4px; padding:0.25rem 0.5rem; margin-top:0.4rem;">⚠️ Veri Durumu: ${st}</div>`;
                    } else if (st === 'FRESH' && s.data_updated_at) {
                        dataStatusHtml = `<div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.35rem;">🟢 Güncel: ${s.data_updated_at.substring(0, 16)}</div>`;
                    }
                }

                const strategyHtml = s.strategy_action
                    ? `<div style="font-size:0.75rem; color:#cbd5e1; margin-top:0.5rem; background:rgba(0,0,0,0.3); padding:0.4rem 0.6rem; border-radius:6px; border-left:3px solid ${isNU ? '#f43f5e' : '#10b981'};">
                         💡 <strong>Semih Ersoy Stratejisi:</strong> ${s.strategy_action}
                       </div>`
                    : '';

                card.innerHTML = `
                    <div class="card-top">
                        <div class="card-symbol" style="font-size:1.25rem; font-weight:900;">${s.symbol}</div>
                        <div style="display:flex; gap:0.5rem; align-items:center;">
                            <span class="card-badge" style="background:${badgeBg}; color:${badgeColor}; font-weight:800; border:1px solid ${badgeColor}40;">
                                ${badgeText}
                            </span>
                            <span class="card-badge badge-violet">${barsText}</span>
                        </div>
                    </div>

                    ${confluenceHtml}
                    ${dataStatusHtml}

                    <div class="target-val" style="margin-top:0.75rem; font-size:1.4rem;">${fmtTR(s.last_close)} ₺</div>
                    
                    <div class="dip-grid" style="margin-top:0.75rem;">
                        <div class="target-item">
                            <div class="target-label" style="color:var(--text-muted); font-size:0.75rem;">${p1Label}</div>
                            <div class="target-val" style="font-size:0.95rem;">${fmtTR(p1.price)} ₺ / RSI ${fmtTR(p1.rsi, 1)}</div>
                            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.2rem;">${p1.date || '-'}</div>
                        </div>
                        <div class="target-item">
                            <div class="target-label" style="color:var(--text-muted); font-size:0.75rem;">${p2Label}</div>
                            <div class="target-val" style="font-size:0.95rem; color:${badgeColor};">${fmtTR(p2.price)} ₺ / RSI ${fmtTR(p2.rsi, 1)}</div>
                            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.2rem;">${p2.date || '-'}</div>
                        </div>
                    </div>

                    <div style="display:flex; justify-content:space-between; margin-top:0.75rem; font-size:0.85rem; font-weight:700;">
                        <span style="color:${rsiColor};">RSI: ${rsiChangeText}</span>
                        <span style="color:var(--accent);">${isNU ? 'Düzeltme: -%' + fmtTR(s.pullback_pct, 1) : 'Tepki: +%' + fmtTR(s.bounce_pct, 1)}</span>
                    </div>

                    ${strategyHtml}

                    ${s.explanation ? `<div style="font-size:0.75rem; color:#94a3b8; margin-top:0.6rem; line-height:1.3; background:rgba(0,0,0,0.25); padding:0.4rem; border-radius:6px;">${s.explanation}</div>` : ''}

                    <button class="btn-chart" data-symbol="${s.symbol}" style="margin-top:0.75rem; width:100%;">📈 GRAFİĞİ GÖSTER</button>
                `;

                const chartBtn = card.querySelector('.btn-chart');
                if (chartBtn) {
                    chartBtn.addEventListener('click', () => openRsiPu30Chart(s.symbol));
                }
                rsiPu30Grid.appendChild(card);
            });
        }
        rsiPu30Results.classList.remove('hidden');
    }

    function ensureRsiPu30Charts() {
        if (rsiPu30PriceChartInst) return;

        // Bars now carry a UTCTimestamp "time" (epoch seconds, BIST-local
        // wall clock treated as UTC -- see _epoch_seconds in rsi_pu30.py) so
        // timeVisible can show real hour-of-day on the 1h timeframe, not
        // just a date.
        const timeVisible = rsiPu30Interval === '1h';
        rsiPu30PriceChartInst = LightweightCharts.createChart(document.getElementById('rsiPu30PriceChart'), {
            layout: { background: { type: 'solid', color: '#18181b' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#27272a' }, horzLines: { color: '#27272a' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            timeScale: { borderColor: '#27272a', timeVisible, secondsVisible: false },
            rightPriceScale: { borderColor: '#27272a' },
        });
        rsiPu30CandleSeries = rsiPu30PriceChartInst.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#10b981', downColor: '#f43f5e', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#f43f5e',
        });
        rsiPu30PriceMarkers = LightweightCharts.createSeriesMarkers(rsiPu30CandleSeries, []);

        rsiPu30RsiChartInst = LightweightCharts.createChart(document.getElementById('rsiPu30RsiChart'), {
            layout: { background: { type: 'solid', color: '#18181b' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#27272a' }, horzLines: { color: '#27272a' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            timeScale: { borderColor: '#27272a', timeVisible, secondsVisible: false },
            rightPriceScale: { borderColor: '#27272a' },
        });
        rsiPu30RsiSeries = rsiPu30RsiChartInst.addSeries(LightweightCharts.LineSeries, {
            color: '#a78bfa', lineWidth: 2, lastValueVisible: true, priceLineVisible: false,
        });

        // Sarı RSI Hareketli Ortalaması (SMA 14 - Fotoğraftaki Sarı Sinyal Çizgisi)
        rsiPu30RsiMaSeries = rsiPu30RsiChartInst.addSeries(LightweightCharts.LineSeries, {
            color: '#facc15', lineWidth: 1.5, lastValueVisible: true, priceLineVisible: false,
        });

        // 70, 50, 30 Eşik Çizgileri
        rsiPu30RsiSeries.createPriceLine({ price: 70, color: '#f43f5e', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70 Aşırı Alım' });
        rsiPu30RsiSeries.createPriceLine({ price: 50, color: '#71717a', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '50 Nötr' });
        rsiPu30RsiSeries.createPriceLine({ price: 30, color: '#10b981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30 Aşırı Satım' });

        rsiPu30RsiChartInst.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
        rsiPu30RsiSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
        rsiPu30RsiMarkers = LightweightCharts.createSeriesMarkers(rsiPu30RsiSeries, []);

        let syncing = false;
        const syncFrom = (target) => (range) => {
            if (syncing || !range) return;
            syncing = true;
            target.timeScale().setVisibleLogicalRange(range);
            syncing = false;
        };
        rsiPu30PriceChartInst.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(rsiPu30RsiChartInst));
        rsiPu30RsiChartInst.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(rsiPu30PriceChartInst));

        // Crosshair move fires synchronously inside setData() when the mouse is
        // over a pane. If the other pane has no point at that time yet (still
        // empty while loading, or RSI warm-up bars), setCrosshairPosition throws
        // "Value is null", which would abort openRsiPu30Chart mid-render and
        // leave the RSI pane and all divergence lines undrawn.
        const syncCrosshair = (targetChart, targetSeries) => (param) => {
            try {
                if (param.time) targetChart.setCrosshairPosition(0, param.time, targetSeries);
                else targetChart.clearCrosshairPosition();
            } catch (e) {
                targetChart.clearCrosshairPosition();
            }
        };
        rsiPu30PriceChartInst.subscribeCrosshairMove(syncCrosshair(rsiPu30RsiChartInst, rsiPu30RsiSeries));
        rsiPu30RsiChartInst.subscribeCrosshairMove(syncCrosshair(rsiPu30PriceChartInst, rsiPu30CandleSeries));
    }

    let rsiPu30PriceLines = [];

    async function openRsiPu30Chart(symbol) {
        rsiPu30OpenSymbol = symbol;
        const intervalLabel = rsiPu30Interval === '1h' ? '1 Saatlik (1s)' : (rsiPu30Interval === '4h' ? '4 Saatlik (4s)' : 'Günlük (1g)');
        rsiPu30ChartTitle.textContent = `${symbol} — Semih Ersoy Uyumsuzluk & Formasyon Çizgileri (${intervalLabel})`;
        rsiPu30SignalInfo.innerHTML = '<p style="color:var(--text-muted);">Yükleniyor...</p>';
        rsiPu30Modal.classList.remove('hidden');
        ensureRsiPu30Charts();

        // Önceki yatay seviye çizgilerini temizle
        if (rsiPu30PriceLines.length > 0) {
            rsiPu30PriceLines.forEach(pl => {
                try { rsiPu30CandleSeries.removePriceLine(pl); } catch (e) {}
            });
            rsiPu30PriceLines = [];
        }

        if (rsiPu30PriceConnector) { rsiPu30PriceChartInst.removeSeries(rsiPu30PriceConnector); rsiPu30PriceConnector = null; }
        if (rsiPu30RsiConnector) { rsiPu30RsiChartInst.removeSeries(rsiPu30RsiConnector); rsiPu30RsiConnector = null; }
        rsiPu30PriceMarkers.setMarkers([]);
        rsiPu30RsiMarkers.setMarkers([]);

        try {
            const res = await fetch(`/api/scan/rsi-pu30/${symbol}?interval=${rsiPu30Interval}`);
            const json = await res.json();
            if (json.status !== 'success' || !json.data) throw new Error(json.detail || 'Veri alınamadı');
            const detail = json.data;

            const cData = detail.bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
            const rData = detail.bars.filter(b => b.rsi != null).map(b => ({ time: b.time, value: b.rsi }));
            const rMaData = detail.bars.filter(b => b.rsi_sma != null).map(b => ({ time: b.time, value: b.rsi_sma }));

            rsiPu30CandleSeries.setData(cData);
            rsiPu30RsiSeries.setData(rData);
            if (rsiPu30RsiMaSeries) rsiPu30RsiMaSeries.setData(rMaData);

            if (detail.signal && detail.signal.dip1 && detail.signal.dip2) {
                const sig = detail.signal;
                const isNU = sig.type === 'NU70' || sig.trend === 'BEAR';
                const actionColor = isNU ? '#f43f5e' : '#10b981';
                const actionLabel = isNU ? '🔴 NU70 Zirve Düşüşü' : '🟢 PU30 Dip Yükselişi';
                const changeVal = isNU ? `-%${fmtTR(sig.pullback_pct, 1)}` : `+%${fmtTR(sig.bounce_pct, 1)}`;

                let extraInfoHtml = '';
                const lvl = sig.saatlik_seviye || {};
                const waitText = {
                    bekleniyor_yapi: isNU ? 'Zirveyi geçemeyen saatlik tepe bekleniyor' : 'Dibi kıramayan saatlik dip bekleniyor',
                    gecersiz: isNU ? 'Zirve aşıldı: saatlik yapı bozuldu' : '2. dibin altına inildi: saatlik yapı bozuldu',
                    veri_yok: 'Saatlik veri alınamadı',
                }[lvl.durum];
                if (isNU && sig.guven_kiran_dip) {
                    extraInfoHtml = `
                        <div class="target-item" style="border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.12);">
                            <div class="target-label" style="color:#fca5a5;">⚠️ Saatlik Güven Kıran Dip</div>
                            <div class="target-val" style="font-size:1.1rem; color:#ef4444; font-weight:800;">${fmtTR(sig.guven_kiran_dip.price)} ₺</div>
                            <div style="font-size:0.75rem; color:#fca5a5; margin-top:0.3rem;">${lvl.kirildi ? (lvl.fiyat_seviyenin === 'ustunde' ? 'Kırıldı, fiyat şu an yeniden üstünde' : 'KIRILDI: satış / stop') : 'Altında saatlik kapanışta sat / stop'}</div>
                        </div>
                    `;
                } else if (!isNU && sig.guven_tazeleyen_tepe) {
                    extraInfoHtml = `
                        <div class="target-item" style="border: 1px solid #10b981; background: rgba(16, 185, 129, 0.12);">
                            <div class="target-label" style="color:#6ee7b7;">🎯 Saatlik Güven Tazeleyen Tepe</div>
                            <div class="target-val" style="font-size:1.1rem; color:#10b981; font-weight:800;">${fmtTR(sig.guven_tazeleyen_tepe.price)} ₺</div>
                            <div style="font-size:0.75rem; color:#6ee7b7; margin-top:0.3rem;">${lvl.kirildi ? (lvl.fiyat_seviyenin === 'altinda' ? 'Aşıldı, fiyat şu an yeniden altında' : 'AŞILDI: alış teyidi') : 'Üzerinde saatlik kapanışta alış'}</div>
                        </div>
                    `;
                } else if (waitText) {
                    extraInfoHtml = `
                        <div class="target-item" style="border: 1px dashed #64748b;">
                            <div class="target-label">${isNU ? '⚠️ Saatlik Güven Kıran Dip' : '🎯 Saatlik Güven Tazeleyen Tepe'}</div>
                            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.3rem;">${waitText}</div>
                        </div>
                    `;
                }

                rsiPu30SignalInfo.innerHTML = `
                    <div class="target-item">
                        <div class="target-label">${isNU ? '🟣 1. Zirve (RSI > 70)' : '🔵 1. Dip (RSI < 30)'}</div>
                        <div class="target-val" style="font-size:1rem;">${fmtTR(sig.dip1.price)} ₺ / RSI ${fmtTR(sig.dip1.rsi, 1)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${sig.dip1.date || '-'}</div>
                    </div>
                    <div class="target-item">
                        <div class="target-label">${isNU ? '🟣 2. Zirve (RSI < 70)' : '🟢 2. Dip (RSI > 30)'}</div>
                        <div class="target-val" style="font-size:1rem; color:${actionColor};">${fmtTR(sig.dip2.price)} ₺ / RSI ${fmtTR(sig.dip2.rsi, 1)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${sig.dip2.date || '-'}</div>
                    </div>
                    ${extraInfoHtml}
                    <div class="target-item">
                        <div class="target-label">${actionLabel}</div>
                        <div class="target-val" style="font-size:1rem; color:${actionColor};">${sig.bars_since_confirm || 0} bar önce</div>
                        <div style="font-size:0.75rem; color:var(--accent); margin-top:0.3rem;">${isNU ? 'Düzeltme: ' : 'Tepki: '}${changeVal}</div>
                    </div>
                `;

                const d1Time = sig.dip1.time;
                const d2Time = sig.dip2.time;

                if (d1Time && d2Time) {
                    const lineColor = isNU ? '#f43f5e' : '#10b981';
                    const markerShape = isNU ? 'arrowDown' : 'arrowUp';
                    const markerPos = isNU ? 'aboveBar' : 'belowBar';
                    const markerText = isNU ? `NU70 Satış (${fmtTR(sig.dip2.price)} ₺)` : `PU30 Alış (${fmtTR(sig.dip2.price)} ₺)`;

                    // 1. Fiyat Uyumsuzluk Trend Çizgisi (Semih Ersoy TradingView Mavi Trend Çizgisi)
                    // Fiyatta 1. Dip/Tepe ile 2. Dip/Tepe arasına çekilen net doğrusal trend
                    const trendColor = '#3b82f6'; // Semih Ersoy'un TradingView Akbank grafiğindeki canlı mavi trend rengi
                    rsiPu30PriceConnector = rsiPu30PriceChartInst.addSeries(LightweightCharts.LineSeries, {
                        color: trendColor, lineWidth: 3, lineStyle: LightweightCharts.LineStyle.Solid,
                        crosshairMarkerVisible: true, lastValueVisible: false, priceLineVisible: false,
                    });
                    rsiPu30PriceConnector.setData([{ time: d1Time, value: sig.dip1.price }, { time: d2Time, value: sig.dip2.price }]);

                    // 2. Fiyat İşaretçileri (Fotoğraftaki Baloncuklar)
                    rsiPu30PriceMarkers.setMarkers([
                        { time: d1Time, position: markerPos, color: '#a855f7', shape: 'circle', text: `${isNU ? 'Zirve' : '1. Dip'}: ${fmtTR(sig.dip1.price)} ₺` },
                        { time: d2Time, position: markerPos, color: lineColor, shape: markerShape, text: markerText },
                    ]);

                    // 3. Fiyatta Semih Ersoy Yatay Çizgileri (Fotoğraftaki Mor ve Kırmızı Çizgiler)
                    if (isNU) {
                        // Mor Zirve Çizgisi
                        rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                            price: sig.dip1.price,
                            color: '#a855f7',
                            lineWidth: 2,
                            lineStyle: LightweightCharts.LineStyle.Solid,
                            axisLabelVisible: true,
                            title: `🟣 Zirve: ${fmtTR(sig.dip1.price)} ₺`
                        }));
                        // Zirveyi Geçemeyen Tepe Çizgisi
                        rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                            price: sig.dip2.price,
                            color: '#c084fc',
                            lineWidth: 2,
                            lineStyle: LightweightCharts.LineStyle.Dashed,
                            axisLabelVisible: true,
                            title: `🟣 Zirveyi Geçemeyen Tepe: ${fmtTR(sig.dip2.price)} ₺`
                        }));
                        // Kırmızı Güven Kıran Dip Çizgisi!
                        if (sig.guven_kiran_dip) {
                            rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                                price: sig.guven_kiran_dip.price,
                                color: '#ef4444',
                                lineWidth: 3,
                                lineStyle: LightweightCharts.LineStyle.Solid,
                                axisLabelVisible: true,
                                title: `🔴 Güven Kıran Dip: ${fmtTR(sig.guven_kiran_dip.price)} ₺ [SAT/STOP]`
                            }));
                        }
                    } else {
                        // PU30: 1. Dip ve 2. Dip Yatay Çizgileri
                        rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                            price: sig.dip1.price,
                            color: '#06b6d4',
                            lineWidth: 2,
                            lineStyle: LightweightCharts.LineStyle.Solid,
                            axisLabelVisible: true,
                            title: `🔵 1. Dip: ${fmtTR(sig.dip1.price)} ₺`
                        }));
                        rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                            price: sig.dip2.price,
                            color: '#10b981',
                            lineWidth: 2,
                            lineStyle: LightweightCharts.LineStyle.Dashed,
                            axisLabelVisible: true,
                            title: `🟢 2. Dip: ${fmtTR(sig.dip2.price)} ₺`
                        }));
                        // Yeşil Güven Tazeleyen Tepe / Direnç
                        if (sig.guven_tazeleyen_tepe) {
                            rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                                price: sig.guven_tazeleyen_tepe.price,
                                color: '#10b981',
                                lineWidth: 3,
                                lineStyle: LightweightCharts.LineStyle.Solid,
                                axisLabelVisible: true,
                                title: `🎯 Güven Tazeleyen Direnç: ${fmtTR(sig.guven_tazeleyen_tepe.price)} ₺ [ALIŞ]`
                            }));
                        }
                    }

                    // 4. Fibonacci Seviyeleri (Fotoğraftaki Bordo/Kırmızı Çizgiler)
                    if (sig.fibonacci_levels && sig.fibonacci_levels.length > 0) {
                        sig.fibonacci_levels.forEach(fibo => {
                            rsiPu30PriceLines.push(rsiPu30CandleSeries.createPriceLine({
                                price: fibo.price,
                                color: fibo.color || (isNU ? 'rgba(244,63,94,0.65)' : 'rgba(16,185,129,0.65)'),
                                lineWidth: 1,
                                lineStyle: LightweightCharts.LineStyle.SparseDotted,
                                axisLabelVisible: true,
                                title: `${fibo.label}: ${fmtTR(fibo.price)} ₺`
                            }));
                        });
                    }

                    // 5. RSI Uyumsuzluk Trend Çizgisi (Semih Ersoy TradingView Mavi Trend Çizgisi)
                    // RSI penceresinde 1. Dip/Tepe RSI ile 2. Dip/Tepe RSI arasına çekilen net doğrusal trend
                    rsiPu30RsiConnector = rsiPu30RsiChartInst.addSeries(LightweightCharts.LineSeries, {
                        color: trendColor, lineWidth: 3, lineStyle: LightweightCharts.LineStyle.Solid,
                        crosshairMarkerVisible: true, lastValueVisible: false, priceLineVisible: false,
                    });
                    rsiPu30RsiConnector.setData([{ time: d1Time, value: sig.dip1.rsi }, { time: d2Time, value: sig.dip2.rsi }]);
                    rsiPu30RsiMarkers.setMarkers([
                        { time: d1Time, position: isNU ? 'above' : 'below', color: '#a855f7', shape: 'circle', text: `RSI ${fmtTR(sig.dip1.rsi, 1)}` },
                        { time: d2Time, position: isNU ? 'above' : 'below', color: trendColor, shape: 'circle', text: `RSI ${fmtTR(sig.dip2.rsi, 1)}` },
                    ]);
                }
            } else if (detail.last_bull) {
                const b = detail.last_bull;
                rsiPu30SignalInfo.innerHTML = `
                    <div class="target-item">
                        <div class="target-label">Son Kırılım</div>
                        <div class="target-val" style="font-size:1rem; color:var(--neon-green);">${fmtTR(b.price)} ₺</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${b.date || '-'}</div>
                    </div>
                    <div class="target-item">
                        <div class="target-label">MOSTRSI Seviyeleri</div>
                        <div class="target-val" style="font-size:1rem; color:#a78bfa;">VAR ${fmtTR(b.exmov, 1)} / ${fmtTR(b.most, 1)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">RSI: ${fmtTR(b.rsi, 1)}</div>
                    </div>
                    <div class="target-item">
                        <div class="target-label">Durum</div>
                        <div class="target-val" style="font-size:1rem; color:var(--neon-green);">BULL AL</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${b.bars_ago || 0} bar önce</div>
                    </div>
                `;
            } else {
                rsiPu30SignalInfo.innerHTML = '<p style="color:var(--text-muted);">Seçili zaman diliminde sinyal detayı bulunamadı.</p>';
            }

            rsiPu30PriceChartInst.timeScale().fitContent();
            rsiPu30RsiChartInst.timeScale().fitContent();
        } catch (e) {
            rsiPu30SignalInfo.innerHTML = `<p style="color:var(--neon-red);">${e.message}</p>`;
            console.error("RSI PU30 chart load failed", e);
        }
    }
});
