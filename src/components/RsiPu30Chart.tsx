"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Pu30Bar, Pu30SymbolDetailSignal } from "@/lib/rsiPu30Engine";

interface Props {
  bars: Pu30Bar[];
  signal: Pu30SymbolDetailSignal | null;
}

function fmtPrice(v: number) {
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RsiPu30Chart({ bars, signal }: Props) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<{ price: IChartApi; rsi: IChartApi } | null>(null);

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || bars.length === 0) return;

    const commonOptions = {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "rgba(255,255,255,0.05)" }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      timeScale: { timeVisible: false, borderColor: "rgba(255,255,255,0.1)" },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      crosshair: { mode: 0 as const },
    };

    const priceChart = createChart(priceRef.current, {
      ...commonOptions,
      width: priceRef.current.clientWidth,
      height: 320,
    });
    const rsiChart = createChart(rsiRef.current, {
      ...commonOptions,
      width: rsiRef.current.clientWidth,
      height: 160,
    });
    chartsRef.current = { price: priceChart, rsi: rsiChart };

    // ── Price pane ──────────────────────────────────────────────────
    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#f43f5e", borderVisible: false,
      wickUpColor: "#10b981", wickDownColor: "#f43f5e",
    });
    candleSeries.setData(bars.map((b) => ({ time: b.date as Time, open: b.open, high: b.high, low: b.low, close: b.close })));

    // ── RSI pane ─────────────────────────────────────────────────────
    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: "#a78bfa", lineWidth: 2, crosshairMarkerVisible: true, lastValueVisible: true, priceLineVisible: false,
    });
    const rsiData = bars.filter((b) => b.rsi != null).map((b) => ({ time: b.date as Time, value: b.rsi as number }));
    rsiSeries.setData(rsiData);
    rsiSeries.createPriceLine({ price: 30, color: "#f59e0b", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "RSI 30" });
    // autoScale must stay true for autoscaleInfoProvider to be consulted at
    // all -- setting autoScale:false (as an earlier version of this did)
    // silently ignores the provider and falls back to the chart's own
    // default range, which is what caused the pane to show up to ~130
    // instead of a clean 0-100.
    rsiChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
    rsiSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });

    // ── Divergence markers + connector lines (only if a signal exists) ──
    if (signal) {
      const d1Time = signal.dip1.date as Time;
      const d2Time = signal.dip2.date as Time;

      const priceConnector: ISeriesApi<"Line"> = priceChart.addSeries(LineSeries, {
        color: "#f43f5e", lineWidth: 2, lineStyle: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      });
      priceConnector.setData([
        { time: d1Time, value: signal.dip1.price },
        { time: d2Time, value: signal.dip2.price },
      ]);
      createSeriesMarkers(candleSeries, [
        { time: d1Time, position: "belowBar", color: "#f59e0b", shape: "circle", text: `D1 ${fmtPrice(signal.dip1.price)}` },
        { time: d2Time, position: "belowBar", color: "#f43f5e", shape: "circle", text: `D2 ${fmtPrice(signal.dip2.price)}` },
      ]);

      const rsiConnector: ISeriesApi<"Line"> = rsiChart.addSeries(LineSeries, {
        color: "#34d399", lineWidth: 2, lineStyle: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      });
      rsiConnector.setData([
        { time: d1Time, value: signal.dip1.rsi },
        { time: d2Time, value: signal.dip2.rsi },
      ]);
      createSeriesMarkers(rsiSeries, [
        { time: d1Time, position: "belowBar", color: "#f59e0b", shape: "circle", text: `${signal.dip1.rsi.toFixed(1)}` },
        { time: d2Time, position: "aboveBar", color: "#f43f5e", shape: "circle", text: `${signal.dip2.rsi.toFixed(1)}` },
      ]);
    }

    priceChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();

    // ── Sync zoom/pan between the two panes ─────────────────────────
    let syncing = false;
    const syncFrom = (_source: IChartApi, target: IChartApi) => (range: any) => {
      if (syncing || !range) return;
      syncing = true;
      target.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(priceChart, rsiChart));
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(rsiChart, priceChart));

    // ── Sync crosshair (hover one pane, see the matching point on the other) ──
    // setCrosshairPosition throws "Value is null" when the target series has no
    // point at that time (e.g. RSI warm-up bars), so fall back to clearing it.
    const syncCrosshair = (target: IChartApi, targetSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">) =>
      (param: { time?: unknown }) => {
        try {
          if (param.time) target.setCrosshairPosition(0, param.time as Time, targetSeries);
          else target.clearCrosshairPosition();
        } catch {
          target.clearCrosshairPosition();
        }
      };
    priceChart.subscribeCrosshairMove(syncCrosshair(rsiChart, rsiSeries));
    rsiChart.subscribeCrosshairMove(syncCrosshair(priceChart, candleSeries));

    const handleResize = () => {
      if (priceRef.current) priceChart.applyOptions({ width: priceRef.current.clientWidth });
      if (rsiRef.current) rsiChart.applyOptions({ width: rsiRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      priceChart.remove();
      rsiChart.remove();
      chartsRef.current = null;
    };
  }, [bars, signal]);

  return (
    <div className="space-y-1">
      <div ref={priceRef} className="w-full" />
      <div ref={rsiRef} className="w-full" />
    </div>
  );
}
