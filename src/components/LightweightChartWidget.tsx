"use client";

import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';

interface ChartDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  bollUpper?: number;
  bollMid?: number;
  bollLower?: number;
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  stochK?: number;
  stochD?: number;
  cci?: number;
}

// Indicator math helpers (fallback RSI if server-side is missing)
function calculateRSI(data: ChartDataPoint[], period = 14) {
  // Prefer server-side RSI
  const serverRsi = data.filter(d => d.rsi != null).map(d => ({ time: d.date.split('T')[0], value: d.rsi as number }));
  if (serverRsi.length > 0) return serverRsi;

  let gains = 0;
  let losses = 0;
  const rsi = [];
  
  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i-1].close;
    if (i <= period) {
      if (diff > 0) gains += diff;
      else losses -= diff;
      if (i === period) {
        let rs = (gains / period) / (losses / period === 0 ? 1 : losses / period);
        rsi.push({ time: data[i].date.split('T')[0], value: 100 - (100 / (1 + rs)) });
      }
    } else {
      const avgGain = ((gains * (period - 1)) + (diff > 0 ? diff : 0)) / period;
      const avgLoss = ((losses * (period - 1)) + (diff < 0 ? -diff : 0)) / period;
      gains = avgGain;
      losses = avgLoss;
      let rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
      rsi.push({ time: data[i].date.split('T')[0], value: 100 - (100 / (1 + rs)) });
    }
  }
  return rsi;
}

export function LightweightChartWidget({ 
  symbol, 
  height = 500,
  currency: externalCurrency
}: { 
  symbol: string;
  height?: number;
  currency?: 'try' | 'usd';
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);

  // Currency selection: uses external currency if passed, else falls back to local state
  const [localCurrency, setLocalCurrency] = useState<'try' | 'usd'>('try');
  const currency = externalCurrency ?? localCurrency;

  // Fullscreen & Line Drawing States
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingStart, setDrawingStart] = useState<{ time: any; price: number } | null>(null);
  const [drawnLines, setDrawnLines] = useState<any[]>([]);

  // Refs to avoid stale closures in Chart click callbacks
  const isDrawingModeRef = useRef(false);
  const drawingStartRef = useRef<{ time: any; price: number } | null>(null);
  const drawnLinesRef = useRef<any[]>([]);

  // Toolbar state
  const [showSMA, setShowSMA] = useState(true);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showSMA200, setShowSMA200] = useState(false);
  const [showBoll, setShowBoll] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showFibo, setShowFibo] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showMACD, setShowMACD] = useState(false);

  // Refs for series
  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const smaSeriesRef = useRef<any>(null);
  const sma50SeriesRef = useRef<any>(null);
  const sma200SeriesRef = useRef<any>(null);
  const bollUpperRef = useRef<any>(null);
  const bollLowerRef = useRef<any>(null);
  const bollMidRef = useRef<any>(null);
  const rsiSeriesRef = useRef<any>(null);
  const volSeriesRef = useRef<any>(null);
  const macdLineRef = useRef<any>(null);
  const macdSignalRef = useRef<any>(null);
  const macdHistRef = useRef<any>(null);
  const fiboLinesRef = useRef<any[]>([]);

  // Parameter tracking refs to manage dynamic updates
  const prevSymbolRef = useRef<string>('');
  const prevCurrencyRef = useRef<'try' | 'usd'>('try');
  const prevHeightRef = useRef<number>(0);

  useEffect(() => {
    async function fetchData(isBackground = false) {
      try {
        if (!isBackground) setLoading(true);
        const res = await fetch(`/api/bist/${symbol}/chart?currency=${currency}`);
        if (!res.ok) throw new Error("Failed to fetch chart data");
        const json = await res.json();
        
        let fetchedData = json.data?.chartData || [];
        fetchedData.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setData(fetchedData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        if (!isBackground) setLoading(false);
      }
    }
    fetchData();

    // Setup a 5-second interval to automatically poll and update the chart in the background
    const interval = setInterval(() => {
      console.log(`[LightweightChartWidget] Polling live chart data for ${symbol}...`);
      fetchData(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [symbol, currency]);

  // Main Chart Initialization
  useEffect(() => {
    if (loading || data.length === 0 || !chartContainerRef.current) return;

    // ── 1. FAST UPDATE PATH: If chart already exists for the same parameters, update data in place ──
    if (
      chartRef.current && 
      prevSymbolRef.current === symbol && 
      prevCurrencyRef.current === currency &&
      prevHeightRef.current === height
    ) {
      console.log(`[LightweightChartWidget] Updating existing series for ${symbol}...`);
      
      const formattedData = data.map(d => ({
        time: d.date.split('T')[0], open: d.open, high: d.high, low: d.low, close: d.close,
      }));
      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData(formattedData);
      }

      const smaData = data.filter(d => d.sma20 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma20 as number }));
      if (smaSeriesRef.current) {
        smaSeriesRef.current.setData(smaData);
      }

      const sma50Data = data.filter(d => d.sma50 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma50 as number }));
      if (sma50SeriesRef.current) {
        sma50SeriesRef.current.setData(sma50Data);
      }

      const sma200Data = data.filter(d => d.sma200 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma200 as number }));
      if (sma200SeriesRef.current) {
        sma200SeriesRef.current.setData(sma200Data);
      }

      const bollUpperData = data.filter(d => d.bollUpper != null).map(d => ({ time: d.date.split('T')[0], value: d.bollUpper as number }));
      if (bollUpperRef.current) {
        bollUpperRef.current.setData(bollUpperData);
      }

      const bollMidData = data.filter(d => d.bollMid != null).map(d => ({ time: d.date.split('T')[0], value: d.bollMid as number }));
      if (bollMidRef.current) {
        bollMidRef.current.setData(bollMidData);
      }

      const bollLowerData = data.filter(d => d.bollLower != null).map(d => ({ time: d.date.split('T')[0], value: d.bollLower as number }));
      if (bollLowerRef.current) {
        bollLowerRef.current.setData(bollLowerData);
      }

      const volData = data.filter(d => d.volume != null).map(d => ({
        time: d.date.split('T')[0], value: d.volume as number, color: d.close >= d.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)',
      }));
      if (volSeriesRef.current) {
        volSeriesRef.current.setData(volData);
      }

      const rsiData = calculateRSI(data);
      if (rsiSeriesRef.current) {
        rsiSeriesRef.current.setData(rsiData);
      }

      const macdLineData = data.filter(d => d.macd != null).map(d => ({ time: d.date.split('T')[0], value: d.macd as number }));
      if (macdLineRef.current) {
        macdLineRef.current.setData(macdLineData);
      }

      const macdSignalData = data.filter(d => d.macdSignal != null).map(d => ({ time: d.date.split('T')[0], value: d.macdSignal as number }));
      if (macdSignalRef.current) {
        macdSignalRef.current.setData(macdSignalData);
      }

      const macdHistData = data.filter(d => d.macdHist != null).map(d => ({
        time: d.date.split('T')[0], value: d.macdHist as number,
        color: (d.macdHist as number) >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)',
      }));
      if (macdHistRef.current) {
        macdHistRef.current.setData(macdHistData);
      }

      // Update Fibonacci price levels dynamically if showFibo is enabled
      if (showFibo && fiboLinesRef.current && fiboLinesRef.current.length > 0) {
        let max = Math.max(...data.map(d => d.high));
        let min = Math.min(...data.map(d => d.low));
        let diff = max - min;
        const fibLevels = [
          { l: 0, v: max },
          { l: 0.236, v: max - 0.236 * diff },
          { l: 0.382, v: max - 0.382 * diff },
          { l: 0.5, v: max - 0.5 * diff },
          { l: 0.618, v: max - 0.618 * diff },
          { l: 0.786, v: max - 0.786 * diff },
          { l: 1, v: min }
        ];

        fiboLinesRef.current.forEach((f, idx) => {
          if (f.lineObj) {
            try {
              f.lineObj.applyOptions({ price: fibLevels[idx].v });
            } catch (e) {}
          }
        });
      }

      return;
    }

    // ── 2. RECREATION PATH: If parameters changed or chart doesn't exist, dispose old and build new ──
    console.log(`[LightweightChartWidget] Recreating chart for ${symbol}...`);
    prevSymbolRef.current = symbol;
    prevCurrencyRef.current = currency;
    prevHeightRef.current = height;

    // Safely remove any legacy chart
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch (e) {}
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      timeScale: {
        timeVisible: true,
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        autoScale: true,
      },
      crosshair: { mode: 0 }
    });
    
    chartRef.current = chart;
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#f43f5e', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#f43f5e',
    });
    candlestickSeriesRef.current = candlestickSeries;

    const formattedData = data.map(d => ({
      time: d.date.split('T')[0], open: d.open, high: d.high, low: d.low, close: d.close,
    }));
    candlestickSeries.setData(formattedData);
    chart.timeScale().fitContent();

    // Click listener for trendline drawing mode
    chart.subscribeClick((param) => {
      if (!isDrawingModeRef.current || !param.time || !param.point) return;
      const priceData = param.seriesData.get(candlestickSeries) as any;
      const price = priceData?.close ?? priceData?.value;
      if (price == null) return;

      if (!drawingStartRef.current) {
        const start = { time: param.time, price };
        drawingStartRef.current = start;
        setDrawingStart(start);
      } else {
        const end = { time: param.time, price };
        const start = drawingStartRef.current;

        const lineSeries = chart.addSeries(LineSeries, {
          color: '#38bdf8',
          lineWidth: 2,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false
        });

        lineSeries.setData([
          { time: start.time, value: start.price },
          { time: end.time, value: end.price }
        ]);

        const newDrawnLines = [...drawnLinesRef.current, lineSeries];
        drawnLinesRef.current = newDrawnLines;
        setDrawnLines(newDrawnLines);

        drawingStartRef.current = null;
        setDrawingStart(null);
        isDrawingModeRef.current = false;
        setIsDrawingMode(false);
      }
    });

    // ── SMA 20 ──
    const smaSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: showSMA,
    });
    smaSeriesRef.current = smaSeries;
    const smaData = data.filter(d => d.sma20 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma20 as number }));
    if (smaData.length > 0) smaSeries.setData(smaData);

    // ── SMA 50 ──
    const sma50Series = chart.addSeries(LineSeries, {
      color: '#34d399', lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: showSMA50,
    });
    sma50SeriesRef.current = sma50Series;
    const sma50Data = data.filter(d => d.sma50 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma50 as number }));
    if (sma50Data.length > 0) sma50Series.setData(sma50Data);

    // ── SMA 200 ──
    const sma200Series = chart.addSeries(LineSeries, {
      color: '#60a5fa', lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: showSMA200,
    });
    sma200SeriesRef.current = sma200Series;
    const sma200Data = data.filter(d => d.sma200 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma200 as number }));
    if (sma200Data.length > 0) sma200Series.setData(sma200Data);

    // ── Bollinger Bands (Upper / Mid / Lower) ──
    const bollUpper = chart.addSeries(LineSeries, {
      color: 'rgba(168, 85, 247, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: showBoll,
      lineStyle: 2,
    });
    bollUpperRef.current = bollUpper;
    const bollUpperData = data.filter(d => d.bollUpper != null).map(d => ({ time: d.date.split('T')[0], value: d.bollUpper as number }));
    if (bollUpperData.length > 0) bollUpper.setData(bollUpperData);

    const bollMid = chart.addSeries(LineSeries, {
      color: 'rgba(168, 85, 247, 0.3)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: showBoll,
      lineStyle: 1,
    });
    bollMidRef.current = bollMid;
    const bollMidData = data.filter(d => d.bollMid != null).map(d => ({ time: d.date.split('T')[0], value: d.bollMid as number }));
    if (bollMidData.length > 0) bollMid.setData(bollMidData);

    const bollLower = chart.addSeries(LineSeries, {
      color: 'rgba(168, 85, 247, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: showBoll,
      lineStyle: 2,
    });
    bollLowerRef.current = bollLower;
    const bollLowerData = data.filter(d => d.bollLower != null).map(d => ({ time: d.date.split('T')[0], value: d.bollLower as number }));
    if (bollLowerData.length > 0) bollLower.setData(bollLowerData);

    // ── Volume ──
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: '', visible: showVolume,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }});
    volSeriesRef.current = volumeSeries;
    
    const volData = data.filter(d => d.volume != null).map(d => ({
      time: d.date.split('T')[0], value: d.volume as number, color: d.close >= d.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)',
    }));
    if (volData.length > 0) volumeSeries.setData(volData);

    // ── RSI (separate scale) ──
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#a855f7', lineWidth: 2, priceScaleId: 'rsi', visible: showRSI,
    });
    rsiSeries.priceScale().applyOptions({ visible: showRSI, scaleMargins: { top: 0.7, bottom: 0 } });
    rsiSeriesRef.current = rsiSeries;
    const rsiData = calculateRSI(data);
    if (rsiData.length > 0) rsiSeries.setData(rsiData);

    // ── MACD (separate scale) ──
    const macdLine = chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 2, priceScaleId: 'macd', visible: showMACD,
    });
    macdLine.priceScale().applyOptions({ visible: showMACD, scaleMargins: { top: 0.75, bottom: 0 } });
    macdLineRef.current = macdLine;
    const macdLineData = data.filter(d => d.macd != null).map(d => ({ time: d.date.split('T')[0], value: d.macd as number }));
    if (macdLineData.length > 0) macdLine.setData(macdLineData);

    const macdSignal = chart.addSeries(LineSeries, {
      color: '#f97316', lineWidth: 1, priceScaleId: 'macd', visible: showMACD,
    });
    macdSignalRef.current = macdSignal;
    const macdSignalData = data.filter(d => d.macdSignal != null).map(d => ({ time: d.date.split('T')[0], value: d.macdSignal as number }));
    if (macdSignalData.length > 0) macdSignal.setData(macdSignalData);

    const macdHist = chart.addSeries(HistogramSeries, {
      priceScaleId: 'macd', visible: showMACD,
    });
    macdHistRef.current = macdHist;
    const macdHistData = data.filter(d => d.macdHist != null).map(d => ({
      time: d.date.split('T')[0], value: d.macdHist as number,
      color: (d.macdHist as number) >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)',
    }));
    if (macdHistData.length > 0) macdHist.setData(macdHistData);

    // ── Fibo Pre-calculation ──
    let max = Math.max(...data.map(d => d.high));
    let min = Math.min(...data.map(d => d.low));
    let diff = max - min;
    const fibLevels = [
      { l: 0, v: max, c: '#ef4444' },
      { l: 0.236, v: max - 0.236 * diff, c: '#3b82f6' },
      { l: 0.382, v: max - 0.382 * diff, c: '#10b981' },
      { l: 0.5, v: max - 0.5 * diff, c: '#f59e0b' },
      { l: 0.618, v: max - 0.618 * diff, c: '#8b5cf6' },
      { l: 0.786, v: max - 0.786 * diff, c: '#ec4899' },
      { l: 1, v: min, c: '#ef4444' }
    ];
    
    fiboLinesRef.current = fibLevels.map(level => {
      const creator = {
        create: () => candlestickSeries.createPriceLine({
          price: level.v,
          color: level.c,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `Fib ${level.l}`,
        }),
        c: level.c,
        lineObj: null as any
      };
      if (showFibo) {
        creator.lineObj = creator.create();
      }
      return creator;
    });

    const handleResize = () => chart.applyOptions({ width: chartContainerRef.current?.clientWidth || 0 });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, height, symbol, currency]);


  // Handle Toggles
  useEffect(() => { smaSeriesRef.current?.applyOptions({ visible: showSMA }); }, [showSMA]);
  useEffect(() => { sma50SeriesRef.current?.applyOptions({ visible: showSMA50 }); }, [showSMA50]);
  useEffect(() => { sma200SeriesRef.current?.applyOptions({ visible: showSMA200 }); }, [showSMA200]);
  useEffect(() => { volSeriesRef.current?.applyOptions({ visible: showVolume }); }, [showVolume]);

  // Bollinger toggle
  useEffect(() => {
    bollUpperRef.current?.applyOptions({ visible: showBoll });
    bollMidRef.current?.applyOptions({ visible: showBoll });
    bollLowerRef.current?.applyOptions({ visible: showBoll });
  }, [showBoll]);

  // RSI toggle
  useEffect(() => {
    if (!rsiSeriesRef.current) return;
    rsiSeriesRef.current.applyOptions({ visible: showRSI });
    if (chartRef.current) {
       if (showRSI) {
         rsiSeriesRef.current.priceScale().applyOptions({ visible: true, scaleMargins: { top: 0.7, bottom: 0 } });
       } else {
         rsiSeriesRef.current.priceScale().applyOptions({ visible: false });
       }
    }
  }, [showRSI]);

  // MACD toggle
  useEffect(() => {
    if (!macdLineRef.current) return;
    const vis = showMACD;
    macdLineRef.current.applyOptions({ visible: vis });
    macdSignalRef.current?.applyOptions({ visible: vis });
    macdHistRef.current?.applyOptions({ visible: vis });
    if (chartRef.current) {
      macdLineRef.current.priceScale().applyOptions({
        visible: vis,
        scaleMargins: { top: 0.75, bottom: 0 }
      });
    }
  }, [showMACD]);

  // Fibo toggle
  useEffect(() => {
    fiboLinesRef.current.forEach(f => {
      if (showFibo && !f.lineObj) {
        f.lineObj = f.create();
      } else if (!showFibo && f.lineObj) {
        try {
          f.lineObj.applyOptions({ color: 'transparent', title: '', axisLabelVisible: false });
        } catch (e) {}
      } else if (showFibo && f.lineObj) {
        f.lineObj.applyOptions({ color: f.c, axisLabelVisible: true });
      }
    });
  }, [showFibo]);

  // Handle fullscreen resize
  useEffect(() => {
    if (!chartRef.current || !chartContainerRef.current) return;
    setTimeout(() => {
      chartRef.current.applyOptions({
        width: chartContainerRef.current?.clientWidth || 0,
        height: isFullScreen ? window.innerHeight - 100 : height - 50
      });
      chartRef.current.timeScale().fitContent();
    }, 100);
  }, [isFullScreen, height]);

  const toggleDrawingMode = () => {
    const next = !isDrawingMode;
    setIsDrawingMode(next);
    isDrawingModeRef.current = next;
    if (!next) {
      setDrawingStart(null);
      drawingStartRef.current = null;
    }
  };

  const clearDrawings = () => {
    if (drawnLinesRef.current.length === 0) return;
    if (!confirm("Tüm çizimleri temizlemek istiyor musunuz?")) return;
    
    drawnLinesRef.current.forEach(series => {
      try {
        chartRef.current?.removeSeries(series);
      } catch (e) {}
    });
    drawnLinesRef.current = [];
    setDrawnLines([]);
    setDrawingStart(null);
    drawingStartRef.current = null;
    isDrawingModeRef.current = false;
    setIsDrawingMode(false);
  };


  if (loading) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center rounded-2xl bg-[#0b0f19] border border-slate-800" style={{ minHeight: height }}>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent" />
        <p className="text-sm font-medium text-slate-400 mt-4">Analiz Yükleniyor...</p>
      </div>
    );
  }

  const ToolbarButton = ({ active, onClick, color, label }: { active: boolean; onClick: () => void; color: string; label: string }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-bold rounded border transition-all ${
        active 
          ? `bg-[${color}]/20 border-[${color}]/50 text-[${color}]` 
          : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
      }`}
      style={active ? { backgroundColor: `${color}20`, borderColor: `${color}80`, color: color } : {}}
    >
      {label}
    </button>
  );

  return (
    <div className={isFullScreen ? "fixed inset-0 z-[99999] bg-[#0b0f19] p-4 flex flex-col w-screen h-screen" : "flex flex-col w-full h-full rounded-2xl overflow-hidden bg-[#0b0f19] border border-slate-800 shadow-inner"}>
       
       <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-900/50 border-b border-white/5 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
             <span className="text-sm font-black text-white tracking-widest">
               {symbol} / {currency.toUpperCase()}
             </span>
             
             {/* Currency Toggle (only visible if not controlled by parent) */}
             {!externalCurrency && symbol !== 'USDTRY=X' && (
               <div className="flex bg-slate-950/80 rounded-lg p-0.5 border border-white/5 ml-2">
                 <button
                   onClick={() => setLocalCurrency('try')}
                   className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                     localCurrency === 'try'
                       ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                       : 'text-slate-500 hover:text-slate-300 border border-transparent'
                   }`}
                 >
                   ₺ TRY
                 </button>
                 <button
                   onClick={() => setLocalCurrency('usd')}
                   className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                     localCurrency === 'usd'
                       ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                       : 'text-slate-500 hover:text-slate-300 border border-transparent'
                   }`}
                 >
                   $ USD
                 </button>
               </div>
             )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
             <ToolbarButton active={showSMA} onClick={() => setShowSMA(!showSMA)} color="#f59e0b" label="SMA 20" />
             <ToolbarButton active={showSMA50} onClick={() => setShowSMA50(!showSMA50)} color="#34d399" label="SMA 50" />
             <ToolbarButton active={showSMA200} onClick={() => setShowSMA200(!showSMA200)} color="#60a5fa" label="SMA 200" />
             <ToolbarButton active={showBoll} onClick={() => setShowBoll(!showBoll)} color="#a855f7" label="Bollinger" />
             <ToolbarButton active={showRSI} onClick={() => setShowRSI(!showRSI)} color="#c084fc" label="RSI (14)" />
             <ToolbarButton active={showMACD} onClick={() => setShowMACD(!showMACD)} color="#3b82f6" label="MACD" />
             <ToolbarButton active={showFibo} onClick={() => setShowFibo(!showFibo)} color="#06b6d4" label="Fibonacci" />
             <ToolbarButton active={showVolume} onClick={() => setShowVolume(!showVolume)} color="#10b981" label="Hacim" />
             
             {/* Divider */}
             <div className="h-4 w-[1px] bg-slate-700/50 mx-1"></div>

             {/* Line Drawing Tool */}
             <button
               onClick={toggleDrawingMode}
               className={`px-2.5 py-1 text-xs font-bold rounded border transition-all cursor-pointer flex items-center gap-1.5 ${
                 isDrawingMode
                   ? 'bg-sky-500/20 border-sky-500 text-sky-400 font-extrabold animate-pulse'
                   : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
               }`}
             >
               ✏️ {isDrawingMode ? "Nokta Seçin..." : "Çizgi Çek"}
             </button>

             {drawnLines.length > 0 && (
               <button
                 onClick={clearDrawings}
                 className="px-2.5 py-1 text-xs font-bold rounded border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
               >
                 ❌ Temizle
               </button>
             )}

             {/* Zoom Controls */}
             <button
               onClick={() => chartRef.current?.timeScale().zoomIn()}
               className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition cursor-pointer text-xs font-black"
               title="Yakınlaştır"
             >
               🔍+
             </button>
             <button
               onClick={() => chartRef.current?.timeScale().zoomOut()}
               className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition cursor-pointer text-xs font-black"
               title="Uzaklaştır"
             >
               🔍-
             </button>
             <button
               onClick={() => chartRef.current?.timeScale().fitContent()}
               className="p-2 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition cursor-pointer text-[10px]"
               title="Sıfırla"
             >
               ⟲
             </button>

             {/* Full Screen Control */}
             <button
               onClick={() => setIsFullScreen(!isFullScreen)}
               className={`p-2 rounded border transition-all cursor-pointer text-xs ${
                 isFullScreen
                   ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 font-bold'
                   : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
               }`}
               title={isFullScreen ? "Tam Ekrandan Çık" : "Tam Ekran Yap"}
             >
               {isFullScreen ? "🗖 Çık" : "🖥️ Tam Ekran"}
             </button>
          </div>
       </div>
 
       {/* Chart Area */}
       <div className="relative flex-1 w-full min-h-[300px]" style={{ height: isFullScreen ? 'calc(100vh - 80px)' : (height ? height - 50 : '100%') }}>
         {/* Drawing Mode Help Banner */}
         {(isDrawingMode || drawingStart) && (
           <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-sky-950/95 border border-sky-500/50 backdrop-blur-md rounded-xl px-4 py-2 text-xs text-sky-400 font-black shadow-2xl flex items-center gap-2">
             <span>✏️</span>
             <span>
               {drawingStart 
                 ? "Bitiş noktasını seçmek için grafikte bir yere tıklayın..." 
                 : "Trend çizgisi çekmek için başlangıç noktasına tıklayın..."}
             </span>
             <button 
               onClick={toggleDrawingMode}
               className="ml-3 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-[10px] font-black cursor-pointer transition"
             >
               İptal Et
             </button>
           </div>
         )}
         
         <div ref={chartContainerRef} className="absolute inset-0" />
       </div>
    </div>
  );
}
