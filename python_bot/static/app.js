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
            
            candleSeries = chart.addCandlestickSeries({ upColor: '#10b981', downColor: '#ef4444', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444' });
            smaSeries = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'SMA 50' });
            emaSeries = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'EMA 9' });
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
});
