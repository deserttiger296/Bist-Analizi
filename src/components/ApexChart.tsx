"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { ApexOptions } from "apexcharts";

// ApexCharts must be dynamic to avoid SSR issues
const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ApexChartProps {
  symbol: string;
}

export default function ApexChart({ symbol }: ApexChartProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/bist/${symbol}/chart`);
        if (!res.ok) throw new Error("Fetch failed");
        const json = await res.json();
        setData(json.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [symbol]);

  if (loading || !data) {
    return (
      <div className="flex h-[450px] w-full items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent" />
          <p className="text-sm font-medium text-slate-400">Kurumsal Veriler Hazırlanıyor...</p>
        </div>
      </div>
    );
  }

  const candleSeries = data.chartData.map((d: any) => ({
    x: new Date(d.date).getTime(),
    y: [d.open, d.high, d.low, d.close]
  }));

  const sma20Series = data.chartData.map((d: any) => ({
    x: new Date(d.date).getTime(),
    y: d.sma20
  }));

  const rsiSeries = data.chartData.map((d: any) => ({
    x: new Date(d.date).getTime(),
    y: d.rsi
  }));

  const tsiSeries = data.chartData.map((d: any) => ({
    x: new Date(d.date).getTime(),
    y: d.tsi
  }));

  const prices = data.chartData.map((d: any) => d.close);
  const allValues = [
    ...prices, 
    data.fibTarget2d, 
    data.fibTarget3d
  ].filter(v => v != null && !isNaN(v));

  const yMin = Math.min(...allValues) * 0.98;
  const yMax = Math.max(...allValues) * 1.02;

  const options: ApexOptions = {
    chart: {
      type: 'candlestick',
      height: 450,
      background: 'transparent',
      toolbar: { show: true, tools: { selection: true, zoom: true, zoomin: true, zoomout: true, pan: true } },
      animations: { enabled: false }
    },
    theme: { mode: 'dark' },
    xaxis: {
      type: 'datetime',
      labels: { style: { colors: '#64748b', fontSize: '10px' } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: [
      {
        seriesName: 'Fiyat',
        min: yMin,
        max: yMax,
        tooltip: { enabled: true },
        labels: { 
          style: { colors: '#64748b', fontSize: '10px' },
          formatter: (val) => val.toFixed(2) + ' ₺'
        }
      },
      {
        seriesName: 'RSI',
        opposite: true,
        show: false, // Hidden but used for scaling
        min: 0,
        max: 100
      }
    ],
    grid: {
      borderColor: '#1e293b',
      strokeDashArray: 4,
      xaxis: { lines: { show: true } }
    },
    tooltip: {
      theme: 'dark',
      shared: true
    },
    stroke: {
      width: [1, 2, 2, 2], // candle, sma20, rsi, tsi
      curve: 'smooth',
      dashArray: [0, 5, 0, 0] // sma20 is dashed
    },
    responsive: [
      {
        breakpoint: 640,
        options: {
          chart: {
            height: 300
          },
          xaxis: {
            labels: { show: false }
          },
          yaxis: {
            labels: { show: false }
          }
        }
      }
    ],
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#94a3b8' }
    },
    plotOptions: {
      candlestick: {
        colors: {
          upward: '#10b981',
          downward: '#f43f5e'
        }
      }
    },
    annotations: {
      yaxis: [
        {
          y: data.fibTarget2d,
          borderColor: '#10b981',
          strokeDashArray: 0,
          borderWidth: 3,
          label: {
            borderColor: '#10b981',
            style: { color: '#fff', background: '#10b981', fontWeight: 'bold' },
            text: 'FIBO TARGET (2D)',
            position: 'left',
            offsetY: -10
          }
        },
        {
          y: data.fibTarget3d,
          borderColor: '#d946ef',
          strokeDashArray: 0,
          borderWidth: 3,
          label: {
            borderColor: '#d946ef',
            style: { color: '#fff', background: '#d946ef', fontWeight: 'bold' },
            text: 'MASTER TARGET (3D)',
            position: 'left',
            offsetY: 10
          }
        }
      ]
    }
  };

  const series = [
    {
      name: 'Fiyat',
      type: 'candlestick',
      data: candleSeries
    },
    {
      name: 'SMA20',
      type: 'line',
      data: sma20Series
    },
    {
      name: 'RSI',
      type: 'line',
      data: rsiSeries
    },
    {
      name: 'TSI',
      type: 'line',
      data: tsiSeries
    }
  ];

  return (
    <div className="relative rounded-3xl border border-slate-800 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between px-2">
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Kurumsal Analiz Grafiği</h3>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Multi-Indicator Alpha Engine</p>
        </div>
        <div className="flex gap-2">
           <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] font-bold text-emerald-400 uppercase">Fibo 2D</span>
           </div>
           <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 animate-pulse"></div>
              <span className="text-[10px] font-bold text-fuchsia-400 uppercase">Master 3D</span>
           </div>
        </div>
      </div>
      <Chart
        options={options}
        series={series}
        type="line" // Changed to line to support mixed types
        height={450}
      />
    </div>
  );
}
