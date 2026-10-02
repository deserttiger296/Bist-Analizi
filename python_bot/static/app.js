document.addEventListener('DOMContentLoaded', () => {
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
            
            if (!response.ok) throw new Error(json.detail || "API Error");
            renderRadar(json.data);
            
        } catch (error) {
            errorMsg.textContent = error.message;
            errorMsg.classList.remove('hidden');
        } finally {
            scanStatus.classList.add('hidden');
            scanAllBtn.disabled = false;
        }
    });

    function renderRadar(stocks) {
        radarGrid.innerHTML = '';
        if (!stocks || stocks.length === 0) {
            radarGrid.innerHTML = '<p style="color:var(--text-muted);">Gereken kriterleri karşılayan hisse bulunamadı.</p>';
        } else {
            stocks.forEach(stock => {
                const upProb = (stock.class_probabilities.UP * 100).toFixed(1);
                
                let reasonsHtml = '<ul class="reasons-list">';
                if (stock.explanation) {
                    stock.explanation.forEach(r => { reasonsHtml += `<li>${r}</li>`; });
                }
                reasonsHtml += '</ul>';

                let badgeHtml = '';
                if (stock.quantum_approved) {
                    badgeHtml = `<div class="card-badge" style="background: rgba(16, 185, 129, 0.2); border: 1px solid var(--neon-green);">🚀 KUANTUM ONAYI (RF & LSTM)</div>`;
                } else {
                    badgeHtml = `<div class="card-badge" style="background: rgba(59, 130, 246, 0.1); color: var(--accent);">RF Skor: %${upProb}</div>`;
                }

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
                            <div class="target-val val-green">💵 $${stock.target_price_usd ? stock.target_price_usd.toFixed(2) : '-'}</div>
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
            
            if (json.status === 'success') {
                const data = json.data;
                const cData = data.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }));
                const sData = data.filter(d => d.sma50 !== null).map(d => ({ time: d.time, value: d.sma50 }));
                const eData = data.filter(d => d.ema9 !== null).map(d => ({ time: d.time, value: d.ema9 }));
                
                candleSeries.setData(cData);
                smaSeries.setData(sData);
                emaSeries.setData(eData);
                chart.timeScale().fitContent();
            }
        } catch (e) {
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
    let rsiPu30Interval = '1d';
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
                // Chart timeVisible/formatting depends on interval, so tear
                // down and let ensureRsiPu30Charts() rebuild on next open
                // rather than mutate options on a chart mid-life.
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

    if (rsiPu30ScanBtn) {
        rsiPu30ScanBtn.addEventListener('click', async () => {
            rsiPu30ErrorMsg.classList.add('hidden');
            rsiPu30Results.classList.add('hidden');
            rsiPu30Status.classList.remove('hidden');
            rsiPu30ScanBtn.disabled = true;

            try {
                const response = await fetch(`/api/scan/rsi-pu30?interval=${rsiPu30Interval}`);
                const json = await response.json();
                if (!response.ok) throw new Error(json.detail || "API Error");
                renderRsiPu30(json.data);
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
        rsiPu30Scanned.textContent = data.scanned;
        rsiPu30Matched.textContent = data.matched;
        rsiPu30Skipped.textContent = (!data.errors || data.errors.length === 0) ? '—' : data.errors.map(e => e.symbol).join(', ');

        rsiPu30Grid.innerHTML = '';
        if (!data.signals || data.signals.length === 0) {
            rsiPu30Grid.innerHTML = '<p style="color:var(--text-muted);">Şu anda aktif pozitif uyumsuzluk sinyali yok. Sinyal ömrü 5 bar — koşullar her gün yeniden değerlendirilir.</p>';
        } else {
            data.signals.forEach((s) => {
                const rsiGap = s.dip2.rsi - s.dip1.rsi;
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <div class="card-top">
                        <div class="card-symbol">${s.symbol}</div>
                        <div class="card-badge badge-violet">${s.bars_since_confirm} BAR ÖNCE</div>
                    </div>
                    <div class="target-val" style="margin-top:1rem;">${fmtTR(s.last_close)} ₺</div>
                    <div class="dip-grid">
                        <div class="target-item">
                            <div class="target-label">Dip 1</div>
                            <div class="target-val" style="font-size:1rem;">${fmtTR(s.dip1.price)} / RSI ${fmtTR(s.dip1.rsi, 1)}</div>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${s.dip1.date}</div>
                        </div>
                        <div class="target-item">
                            <div class="target-label">Dip 2</div>
                            <div class="target-val" style="font-size:1rem; color:var(--neon-red);">${fmtTR(s.dip2.price)} / RSI ${fmtTR(s.dip2.rsi, 1)}</div>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${s.dip2.date}</div>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:1rem; font-size:0.85rem;">
                        <span style="color: var(--neon-green); font-weight:700;">↗ RSI +${fmtTR(rsiGap, 1)}</span>
                        <span style="color: var(--accent); font-weight:700;">Tepki +%${fmtTR(s.bounce_pct, 1)}</span>
                    </div>
                    <button class="btn-chart" data-symbol="${s.symbol}">📈 GRAFİĞİ GÖSTER</button>
                `;
                const chartBtn = card.querySelector('.btn-chart');
                chartBtn.addEventListener('click', () => openRsiPu30Chart(s.symbol));
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
        rsiPu30RsiSeries.createPriceLine({ price: 30, color: '#f59e0b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'RSI 30' });
        // autoScale must stay true (the default) for autoscaleInfoProvider to be
        // consulted -- setting autoScale:false silently falls back to the
        // chart's own range instead of the fixed 0-100 window.
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

        rsiPu30PriceChartInst.subscribeCrosshairMove((param) => {
            if (param.time) rsiPu30RsiChartInst.setCrosshairPosition(0, param.time, rsiPu30RsiSeries);
            else rsiPu30RsiChartInst.clearCrosshairPosition();
        });
        rsiPu30RsiChartInst.subscribeCrosshairMove((param) => {
            if (param.time) rsiPu30PriceChartInst.setCrosshairPosition(0, param.time, rsiPu30CandleSeries);
            else rsiPu30PriceChartInst.clearCrosshairPosition();
        });
    }

    async function openRsiPu30Chart(symbol) {
        rsiPu30OpenSymbol = symbol;
        rsiPu30ChartTitle.textContent = `${symbol} — RSI PU30 Uyumsuzluk Grafiği (${rsiPu30Interval === '1h' ? 'Saatlik' : 'Günlük'})`;
        rsiPu30SignalInfo.innerHTML = '<p style="color:var(--text-muted);">Yükleniyor...</p>';
        rsiPu30Modal.classList.remove('hidden');
        ensureRsiPu30Charts();

        if (rsiPu30PriceConnector) { rsiPu30PriceChartInst.removeSeries(rsiPu30PriceConnector); rsiPu30PriceConnector = null; }
        if (rsiPu30RsiConnector) { rsiPu30RsiChartInst.removeSeries(rsiPu30RsiConnector); rsiPu30RsiConnector = null; }
        rsiPu30PriceMarkers.setMarkers([]);
        rsiPu30RsiMarkers.setMarkers([]);

        try {
            const res = await fetch(`/api/scan/rsi-pu30/${symbol}?interval=${rsiPu30Interval}`);
            const json = await res.json();
            if (json.status !== 'success' || !json.data) throw new Error(json.detail || 'Veri alınamadı');
            const detail = json.data;

            // "time" is the UTCTimestamp (epoch seconds) rsi_pu30.py emits;
            // using it instead of the display "date" string is what lets
            // the hourly timeframe show actual hour-of-day on the x-axis.
            const cData = detail.bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
            const rData = detail.bars.filter(b => b.rsi != null).map(b => ({ time: b.time, value: b.rsi }));
            rsiPu30CandleSeries.setData(cData);
            rsiPu30RsiSeries.setData(rData);

            if (detail.signal) {
                const sig = detail.signal;
                rsiPu30SignalInfo.innerHTML = `
                    <div class="target-item">
                        <div class="target-label">Dip 1</div>
                        <div class="target-val" style="font-size:1rem;">${fmtTR(sig.dip1.price)} ₺ / RSI ${fmtTR(sig.dip1.rsi, 1)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${sig.dip1.date}</div>
                    </div>
                    <div class="target-item">
                        <div class="target-label">Dip 2</div>
                        <div class="target-val" style="font-size:1rem; color:var(--neon-red);">${fmtTR(sig.dip2.price)} ₺ / RSI ${fmtTR(sig.dip2.rsi, 1)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${sig.dip2.date}</div>
                    </div>
                    <div class="target-item">
                        <div class="target-label">Tepki</div>
                        <div class="target-val" style="font-size:1rem; color:var(--accent);">+%${fmtTR(sig.bounce_pct, 1)}</div>
                    </div>
                    <div class="target-item">
                        <div class="target-label">${sig.is_active ? '✓ Aktif Sinyal' : 'Geçmiş Sinyal (süresi doldu)'}</div>
                        <div class="target-val" style="font-size:1rem; color: ${sig.is_active ? 'var(--neon-green)' : 'var(--text-muted)'};">${sig.bars_since_confirm} bar önce</div>
                    </div>
                `;

                const d1Time = sig.dip1.time;
                const d2Time = sig.dip2.time;

                rsiPu30PriceConnector = rsiPu30PriceChartInst.addSeries(LightweightCharts.LineSeries, {
                    color: '#f43f5e', lineWidth: 2, lineStyle: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
                });
                rsiPu30PriceConnector.setData([{ time: d1Time, value: sig.dip1.price }, { time: d2Time, value: sig.dip2.price }]);
                rsiPu30PriceMarkers.setMarkers([
                    { time: d1Time, position: 'belowBar', color: '#f59e0b', shape: 'circle', text: `D1 ${fmtTR(sig.dip1.price)}` },
                    { time: d2Time, position: 'belowBar', color: '#f43f5e', shape: 'circle', text: `D2 ${fmtTR(sig.dip2.price)}` },
                ]);

                rsiPu30RsiConnector = rsiPu30RsiChartInst.addSeries(LightweightCharts.LineSeries, {
                    color: '#34d399', lineWidth: 2, lineStyle: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
                });
                rsiPu30RsiConnector.setData([{ time: d1Time, value: sig.dip1.rsi }, { time: d2Time, value: sig.dip2.rsi }]);
                rsiPu30RsiMarkers.setMarkers([
                    { time: d1Time, position: 'below', color: '#f59e0b', shape: 'circle', text: `${fmtTR(sig.dip1.rsi, 1)}` },
                    { time: d2Time, position: 'aboveBar', color: '#10b981', shape: 'arrowUp', text: 'Bull' },
                    { time: d2Time, position: 'above', color: '#f43f5e', shape: 'circle', text: `${fmtTR(sig.dip2.rsi, 1)}` },
                ]);
            } else {
                rsiPu30SignalInfo.innerHTML = '<p style="color:var(--text-muted);">Seçili zaman diliminde uyumsuzluk koşullarını sağlayan bir dip çifti bulunamadı.</p>';
            }

            rsiPu30PriceChartInst.timeScale().fitContent();
            rsiPu30RsiChartInst.timeScale().fitContent();
        } catch (e) {
            rsiPu30SignalInfo.innerHTML = `<p style="color:var(--neon-red);">${e.message}</p>`;
            console.error("RSI PU30 chart load failed", e);
        }
    }
});
