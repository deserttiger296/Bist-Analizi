"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  LineStyle,
  CrosshairMode,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
  type CandlestickData,
  type WhitespaceData,
} from "lightweight-charts";

export type ChartInterval = "15m" | "1h" | "4h" | "1d";

interface BarPoint {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  rsi: number | null;
  rsi_sma: number | null;
}

interface PivotPoint {
  price: number;
  rsi: number;
  date?: string;
  time: number;
}

interface FibLevel {
  label: string;
  level: number;
  price: number;
  color?: string;
}

interface DivergenceSignal {
  type?: string;
  trend?: string;
  is_early_candidate?: boolean;
  candidate_kind?: string;
  dip1?: PivotPoint;
  dip2?: PivotPoint;
  tepe1?: PivotPoint;
  tepe2?: PivotPoint;
  pullback_pct?: number;
  bounce_pct?: number;
  bars_since_confirm?: number;
  saatlik_seviye?: {
    price?: number | null;
    durum?: string;
    kirildi?: boolean;
    alt_periyot?: string;
    fiyat_seviyenin?: string;
  };
  guven_kiran_dip?: { price: number };
  guven_tazeleyen_tepe?: { price: number };
  fibonacci_levels?: FibLevel[];
  explanation?: string;
  gkd_price?: number | null;
  triggered?: boolean;
  status_text?: string;
  stop_loss?: number;
  target_1r?: number;
  target_tp1?: number;
  rr_ratio?: number;
  candle_label?: string;
  is_hanging_man?: boolean;
  is_shooting_star?: boolean;
  fractal_phase_code?: string;
  fractal_phase_badge?: string;
  recommended_tp_label?: string;
  recommended_tp_price?: number;
  fractal_profit_plan?: string;
}

interface MtfTfSummary {
  interval: string;
  last_close: number;
  rsi: number | null;
  has_nu70: boolean;
  has_early_nu70: boolean;
  nu70_candle: string;
  nu70_tepe2: number | null;
  nu70_rsi2: number | null;
  has_pu30: boolean;
  pu30_dip2: number | null;
  has_pre_pu30: boolean;
  pre_pu30_price: number | null;
  invalidated_nu70: boolean;
}

interface PrePu30Info {
  has_oversold_dip1?: boolean;
  oversold_rsi?: number;
  oversold_price?: number;
  oversold_date?: string;
  current_rsi?: number;
  has_reaction?: boolean;
  reaction_label?: string;
  badge?: string;
  explanation?: string;
}

interface ChartDetailPayload {
  symbol: string;
  interval: string;
  bars: BarPoint[];
  signal: DivergenceSignal | null;
  pu30_signal: DivergenceSignal | null;
  nu70_signal: DivergenceSignal | null;
  pre_pu30?: PrePu30Info | null;
  invalidated_nu70?: {
    tepe2?: PivotPoint;
    dip2?: PivotPoint;
    confirm_date?: string;
    invalidation_reason?: string;
  } | null;
  mtf_nu_pu_summary?: Record<string, MtfTfSummary>;
}

interface ImpulsePoint {
  index: number;
  time: number;
  date: string;
  price: number;
  rsi: number;
}

interface ImpulsePriceTarget {
  ratio: string;
  pct_label: string;
  target_from_w2: number;
  target_from_w0: number;
  target_log: number;
  zone_low: number;
  zone_high: number;
  reached: boolean;
  reached_log?: boolean;
}

interface ImpulseFibTimeEntry {
  offset_bars: number;
  target_index: number;
  target_date: string;
  target_time: number;
  is_future: boolean;
  close_at_target: number | null;
}

interface ImpulseOverlayData {
  direction: "BULL" | "BEAR";
  durum: string;
  quality_grade?: string;
  quality_label?: string;
  ideal_retrace?: boolean;
  gvt_gkd_aligned?: boolean;
  points?: {
    p0: ImpulsePoint;
    p1: ImpulsePoint;
    p2: ImpulsePoint;
  };
  dalga1?: { move_pct: number; duration_bars: number; rsi_delta: number; vol_ratio: number };
  dalga2?: { price_retracement_fib: number; duration_bars: number };
  fib_fiyat_hedefleri?: Record<string, ImpulsePriceTarget>;
  fib_zaman_w1_referans?: Record<string, ImpulseFibTimeEntry>;
  fib_zaman_02_sundurme?: Record<string, ImpulseFibTimeEntry>;
}

interface ImpulseOverlayResponse {
  status: string;
  symbol: string;
  interval: string;
  scale: string;
  impulse: ImpulseOverlayData | null;
  bull_impulse: ImpulseOverlayData | null;
  bear_impulse: ImpulseOverlayData | null;
}

interface Props {
  symbol: string;
  defaultInterval?: ChartInterval;
  defaultSignalPref?: "auto" | "pu30" | "nu70";
  defaultShowImpulse?: boolean;
  defaultFibTimeMode?: "modA" | "modB";
  defaultScaleMode?: "linear" | "log";
  onClose?: () => void;
}

function fmtTR(val: number | null | undefined, digits = 2): string {
  if (val == null || !Number.isFinite(Number(val))) return "—";
  return Number(val).toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const INTERVAL_LABELS: Record<ChartInterval, string> = {
  "15m": "15 Dakikalık (15dk)",
  "1h": "1 Saatlik (1s)",
  "4h": "4 Saatlik (4s)",
  "1d": "Günlük (1g)",
};

export default function SemihDivergenceChart({
  symbol,
  defaultInterval = "1h",
  defaultSignalPref = "auto",
  defaultShowImpulse = false,
  defaultFibTimeMode = "modA",
  defaultScaleMode = "linear",
  onClose,
}: Props) {
  const [interval, setIntervalVal] = useState<ChartInterval>(defaultInterval);
  const [signalPref, setSignalPref] = useState<"auto" | "pu30" | "nu70">(defaultSignalPref);
  const [showImpulse, setShowImpulse] = useState<boolean>(defaultShowImpulse);
  const [fibTimeMode, setFibTimeMode] = useState<"modA" | "modB">(defaultFibTimeMode);
  const [scaleMode, setScaleMode] = useState<"linear" | "log">(defaultScaleMode);
  const [impulseOverlay, setImpulseOverlay] = useState<ImpulseOverlayResponse | null>(null);
  const [loadingImpulse, setLoadingImpulse] = useState<boolean>(false);
  const [detail, setDetail] = useState<ChartDetailPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIntervalVal(defaultInterval);
    setSignalPref(defaultSignalPref);
    setShowImpulse(defaultShowImpulse);
    setFibTimeMode(defaultFibTimeMode);
    setScaleMode(defaultScaleMode);
  }, [symbol, defaultInterval, defaultSignalPref, defaultShowImpulse, defaultFibTimeMode, defaultScaleMode]);

  useEffect(() => {
    if (!showImpulse) {
      setImpulseOverlay(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoadingImpulse(true);
    const dirParam = signalPref === "pu30" ? "bull" : signalPref === "nu70" ? "bear" : "auto";
    fetch(
      `/api/impulse-lab?mode=chart&symbol=${encodeURIComponent(symbol)}&interval=${interval}&direction=${dirParam}&scale=${scaleMode}`,
      { signal: controller.signal, cache: "no-store" }
    )
      .then(async (res) => {
        const json = await res.json();
        if (active && res.ok && json.status === "success") {
          setImpulseOverlay(json);
        } else if (active) {
          setImpulseOverlay(null);
        }
      })
      .catch(() => {
        if (active) setImpulseOverlay(null);
      })
      .finally(() => {
        if (active) setLoadingImpulse(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [showImpulse, symbol, interval, signalPref, scaleMode]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setErrorMsg(null);

    fetch(`/api/scan/rsi-pu30/${encodeURIComponent(symbol)}?interval=${interval}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || json.status !== "success" || !json.data) {
          throw new Error(json.detail || "Grafik verisi alınamadı");
        }
        if (active) setDetail(json.data);
      })
      .catch((err: any) => {
        if (active && err?.name !== "AbortError") {
          setErrorMsg(err?.message || "Veri yüklenemedi");
          setDetail(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [symbol, interval]);

  const activeSignal: DivergenceSignal | null = (() => {
    if (!detail) return null;
    if (signalPref === "pu30" && detail.pu30_signal) return detail.pu30_signal;
    if (signalPref === "nu70" && detail.nu70_signal) return detail.nu70_signal;
    return detail.signal || detail.pu30_signal || detail.nu70_signal || null;
  })();

  useEffect(() => {
    const priceEl = priceContainerRef.current;
    const rsiEl = rsiContainerRef.current;
    if (!priceEl || !rsiEl || !detail?.bars?.length) return;

    const timeVisible = interval !== "1d";
    const priceChart = createChart(priceEl, {
      width: priceEl.clientWidth || 720,
      height: 350,
      layout: { background: { color: "#111b28" }, textColor: "#d1d4dc" },
      grid: { vertLines: { color: "#27384b" }, horzLines: { color: "#27384b" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: "#27384b", timeVisible, secondsVisible: false },
      rightPriceScale: { borderColor: "#27384b" },
    });

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    const rsiChart = createChart(rsiEl, {
      width: rsiEl.clientWidth || 720,
      height: 180,
      layout: { background: { color: "#111b28" }, textColor: "#d1d4dc" },
      grid: { vertLines: { color: "#27384b" }, horzLines: { color: "#27384b" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: "#27384b", timeVisible, secondsVisible: false },
      rightPriceScale: {
        borderColor: "#27384b",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: "#a78bfa",
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });

    const rsiMaSeries = rsiChart.addSeries(LineSeries, {
      color: "#facc15",
      lineWidth: 1,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    rsiSeries.createPriceLine({
      price: 70,
      color: "#f43f5e",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "70 Aşırı Alım",
    });
    rsiSeries.createPriceLine({
      price: 50,
      color: "#71717a",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "50 Nötr",
    });
    rsiSeries.createPriceLine({
      price: 30,
      color: "#10b981",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "30 Aşırı Satım",
    });

    const cData: (CandlestickData<Time> | WhitespaceData<Time>)[] = detail.bars.map((b) => ({
      time: b.time as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    const rData: ({ time: Time; value: number } | WhitespaceData<Time>)[] = detail.bars
      .filter((b) => b.rsi != null && Number.isFinite(b.rsi))
      .map((b) => ({ time: b.time as UTCTimestamp, value: b.rsi as number }));
    const rMaData = detail.bars
      .filter((b) => b.rsi_sma != null && Number.isFinite(b.rsi_sma))
      .map((b) => ({ time: b.time as UTCTimestamp, value: b.rsi_sma as number }));

    const activeImpulse =
      showImpulse && impulseOverlay?.impulse?.durum === "1_2_yapisi_hazir"
        ? impulseOverlay.impulse
        : null;
    const fibTimeMap =
      activeImpulse
        ? fibTimeMode === "modB"
          ? activeImpulse.fib_zaman_02_sundurme
          : activeImpulse.fib_zaman_w1_referans
        : undefined;

    if (fibTimeMap && detail.bars.length > 0) {
      const lastBarTime = detail.bars[detail.bars.length - 1].time;
      const futureTimes = Array.from(
        new Set(
          Object.values(fibTimeMap)
            .map((entry) => Number(entry.target_time))
            .filter((t) => Number.isFinite(t) && t > lastBarTime)
        )
      ).sort((a, b) => a - b);
      for (const ft of futureTimes) {
        cData.push({ time: ft as UTCTimestamp });
        rData.push({ time: ft as UTCTimestamp });
      }
    }

    candleSeries.setData(cData);
    rsiSeries.setData(rData);
    rsiMaSeries.setData(rMaData);

    const priceMarkersApi = createSeriesMarkers(candleSeries, []);
    const rsiMarkersApi = createSeriesMarkers(rsiSeries, []);

    if (activeSignal?.dip1 && activeSignal?.dip2) {
      const sig = activeSignal;
      const d1 = sig.dip1!;
      const d2 = sig.dip2!;
      const isNU = sig.type === "NU70" || sig.trend === "BEAR";
      const lineColor = isNU ? "#f43f5e" : "#10b981";
      const trendColor = "#3b82f6";

      if (d1.time && d2.time && d1.time < d2.time) {
        const priceTrend = priceChart.addSeries(LineSeries, {
          color: trendColor,
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        priceTrend.setData([
          { time: d1.time as UTCTimestamp, value: d1.price },
          { time: d2.time as UTCTimestamp, value: d2.price },
        ]);

        const rsiTrend = rsiChart.addSeries(LineSeries, {
          color: trendColor,
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        rsiTrend.setData([
          { time: d1.time as UTCTimestamp, value: d1.rsi },
          { time: d2.time as UTCTimestamp, value: d2.rsi },
        ]);

        const candleTag =
          isNU && sig.candle_label && sig.candle_label !== "Yok" ? ` · ${sig.candle_label}` : "";
        const priceMarkers: SeriesMarker<Time>[] = [
          {
            time: d1.time as UTCTimestamp,
            position: isNU ? "aboveBar" : "belowBar",
            color: "#a855f7",
            shape: "circle",
            text: `${isNU ? "Zirve" : "1. Dip"}: ${fmtTR(d1.price)} ₺`,
          },
          {
            time: d2.time as UTCTimestamp,
            position: isNU ? "aboveBar" : "belowBar",
            color: lineColor,
            shape: isNU ? "arrowDown" : "arrowUp",
            text: isNU
              ? `${sig.is_early_candidate ? "NU70_ADAY" : "NU70 Satış"} (${fmtTR(d2.price)} ₺${candleTag})`
              : `PU30 Alış (${fmtTR(d2.price)} ₺)`,
          },
        ];
        priceMarkersApi.setMarkers(priceMarkers);

        rsiMarkersApi.setMarkers([
          {
            time: d1.time as UTCTimestamp,
            position: isNU ? "aboveBar" : "belowBar",
            color: "#a855f7",
            shape: "circle",
            text: `RSI ${fmtTR(d1.rsi, 1)}`,
          },
          {
            time: d2.time as UTCTimestamp,
            position: isNU ? "aboveBar" : "belowBar",
            color: trendColor,
            shape: "circle",
            text: `RSI ${fmtTR(d2.rsi, 1)}`,
          },
        ]);
      }

      if (isNU) {
        candleSeries.createPriceLine({
          price: d1.price,
          color: "#a855f7",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `Zirve: ${fmtTR(d1.price)} ₺`,
        });
        candleSeries.createPriceLine({
          price: d2.price,
          color: "#c084fc",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Zirveyi Geçemeyen Tepe: ${fmtTR(d2.price)} ₺`,
        });
        if (sig.guven_kiran_dip?.price != null) {
          candleSeries.createPriceLine({
            price: sig.guven_kiran_dip.price,
            color: "#ef4444",
            lineWidth: 3,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `Güven Kıran Dip: ${fmtTR(sig.guven_kiran_dip.price)} ₺ [SAT/STOP]`,
          });
        }
        if (sig.stop_loss != null && Number.isFinite(sig.stop_loss)) {
          candleSeries.createPriceLine({
            price: sig.stop_loss,
            color: "#fb7185",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `İptal Stopu (+%2.5): ${fmtTR(sig.stop_loss)} ₺`,
          });
        }
        if (sig.target_1r != null && Number.isFinite(sig.target_1r)) {
          candleSeries.createPriceLine({
            price: sig.target_1r,
            color: "#f59e0b",
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `1R Salınım Hedefi: ${fmtTR(sig.target_1r)} ₺`,
          });
        }
        if (sig.target_tp1 != null && Number.isFinite(sig.target_tp1)) {
          candleSeries.createPriceLine({
            price: sig.target_tp1,
            color: "#f43f5e",
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `2R Sert Satış Hedefi: ${fmtTR(sig.target_tp1)} ₺`,
          });
        }
      } else {
        candleSeries.createPriceLine({
          price: d1.price,
          color: "#06b6d4",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `1. Dip: ${fmtTR(d1.price)} ₺`,
        });
        candleSeries.createPriceLine({
          price: d2.price,
          color: "#10b981",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `2. Dip: ${fmtTR(d2.price)} ₺`,
        });
        if (sig.guven_tazeleyen_tepe?.price != null) {
          candleSeries.createPriceLine({
            price: sig.guven_tazeleyen_tepe.price,
            color: "#10b981",
            lineWidth: 3,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `Güven Tazeleyen Direnç: ${fmtTR(sig.guven_tazeleyen_tepe.price)} ₺ [ALIŞ]`,
          });
        }
      }

      if (sig.fibonacci_levels?.length) {
        sig.fibonacci_levels.forEach((fibo) => {
          candleSeries.createPriceLine({
            price: fibo.price,
            color: fibo.color || (isNU ? "rgba(244,63,94,0.65)" : "rgba(16,185,129,0.65)"),
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            axisLabelVisible: true,
            title: `${fibo.label}: ${fmtTR(fibo.price)} ₺`,
          });
        });
      }
    }

    if (
      detail?.pre_pu30?.has_oversold_dip1 &&
      detail.pre_pu30.oversold_price != null &&
      Number.isFinite(Number(detail.pre_pu30.oversold_price))
    ) {
      const dipPrice = Number(detail.pre_pu30.oversold_price);
      candleSeries.createPriceLine({
        price: dipPrice,
        color: "#f59e0b",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `⚠️ 1. Aşırı Satım Dibi (En Az 1 Dip Daha): ${fmtTR(dipPrice)} ₺`,
      });
    }

    if (activeImpulse?.points) {
      const { p0, p1, p2 } = activeImpulse.points;
      const impBull = activeImpulse.direction === "BULL";
      const zigzagColor = impBull ? "#facc15" : "#fb7185";
      if (p0.time && p1.time && p2.time && p0.time < p1.time && p1.time < p2.time) {
        const zigzagSeries = priceChart.addSeries(LineSeries, {
          color: zigzagColor,
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        zigzagSeries.setData([
          { time: p0.time as UTCTimestamp, value: p0.price },
          { time: p1.time as UTCTimestamp, value: p1.price },
          { time: p2.time as UTCTimestamp, value: p2.price },
        ]);
        createSeriesMarkers(zigzagSeries, [
          {
            time: p0.time as UTCTimestamp,
            position: impBull ? "belowBar" : "aboveBar",
            color: zigzagColor,
            shape: "circle",
            text: `0 (${fmtTR(p0.price)})`,
          },
          {
            time: p1.time as UTCTimestamp,
            position: impBull ? "aboveBar" : "belowBar",
            color: zigzagColor,
            shape: "circle",
            text: `1 (${fmtTR(p1.price)})`,
          },
          {
            time: p2.time as UTCTimestamp,
            position: impBull ? "belowBar" : "aboveBar",
            color: zigzagColor,
            shape: "circle",
            text: `2 (${fmtTR(p2.price)})`,
          },
        ]);
      }

      if (activeImpulse.fib_fiyat_hedefleri) {
        const targetColors: Record<string, string> = {
          "1.000": "#38bdf8",
          "1.618": "#22c55e",
          "2.618": "#a855f7",
          "3.618": "#f59e0b",
        };
        for (const rk of ["1.000", "1.618", "2.618", "3.618"]) {
          const tgt = activeImpulse.fib_fiyat_hedefleri[rk];
          if (!tgt) continue;
          const priceVal = scaleMode === "log" ? tgt.target_log : tgt.target_from_w2;
          if (!Number.isFinite(priceVal)) continue;
          const zoneTxt =
            scaleMode === "log"
              ? "Log"
              : `Bölge: ${fmtTR(tgt.zone_low)}–${fmtTR(tgt.zone_high)}`;
          candleSeries.createPriceLine({
            price: priceVal,
            color: targetColors[rk] || "#f59e0b",
            lineWidth: rk === "3.618" || rk === "1.618" ? 2 : 1,
            lineStyle: rk === "3.618" ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: `⚡ ${tgt.pct_label} İtki: ${fmtTR(priceVal)} ₺ (${zoneTxt})`,
          });
        }
      }

      if (fibTimeMap) {
        const fibTimeSeries = priceChart.addSeries(HistogramSeries, {
          priceScaleId: "fibtime",
          color: "rgba(167, 139, 250, 0.25)",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        priceChart.priceScale("fibtime").applyOptions({
          visible: false,
          scaleMargins: { top: 0.02, bottom: 0.0 },
        });

        const byTime = new Map<number, string[]>();
        for (const rk of ["0.382", "0.618", "1.000", "1.618", "2.618", "3.618"]) {
          const entry = fibTimeMap[rk];
          if (!entry || !Number.isFinite(entry.target_time)) continue;
          const t = Number(entry.target_time);
          const list = byTime.get(t) || [];
          list.push(rk.replace(/0+$/, "").replace(/\.$/, ""));
          byTime.set(t, list);
        }

        const sortedTimes = Array.from(byTime.keys()).sort((a, b) => a - b);
        fibTimeSeries.setData(
          sortedTimes.map((t) => ({
            time: t as UTCTimestamp,
            value: 1,
            color: (byTime.get(t) || []).includes("3.618")
              ? "rgba(245, 158, 11, 0.35)"
              : "rgba(167, 139, 250, 0.24)",
          }))
        );
        createSeriesMarkers(
          fibTimeSeries,
          sortedTimes.map((t) => ({
            time: t as UTCTimestamp,
            position: "aboveBar" as const,
            color: (byTime.get(t) || []).includes("3.618") ? "#f59e0b" : "#a78bfa",
            shape: "circle" as const,
            text: `FT ${(byTime.get(t) || []).join("/")}`,
          }))
        );
      }
    }

    let syncing = false;
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

    priceChart.subscribeCrosshairMove((param) => {
      try {
        if (param.time) rsiChart.setCrosshairPosition(0, param.time, rsiSeries);
        else rsiChart.clearCrosshairPosition();
      } catch {
        rsiChart.clearCrosshairPosition();
      }
    });
    rsiChart.subscribeCrosshairMove((param) => {
      try {
        if (param.time) priceChart.setCrosshairPosition(0, param.time, candleSeries);
        else priceChart.clearCrosshairPosition();
      } catch {
        priceChart.clearCrosshairPosition();
      }
    });

    priceChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (priceEl.clientWidth > 0) priceChart.applyOptions({ width: priceEl.clientWidth });
            if (rsiEl.clientWidth > 0) rsiChart.applyOptions({ width: rsiEl.clientWidth });
          })
        : null;
    observer?.observe(priceEl);

    return () => {
      observer?.disconnect();
      priceChart.remove();
      rsiChart.remove();
    };
  }, [detail, activeSignal, interval, showImpulse, impulseOverlay, fibTimeMode, scaleMode]);

  const isNU = activeSignal?.type === "NU70" || activeSignal?.trend === "BEAR";
  const lvl = activeSignal?.saatlik_seviye || {};
  const trustLabel =
    lvl.alt_periyot === "15dk" || interval === "1h" ? "15dk" : "Saatlik";

  return (
    <div className="rounded-2xl border border-slate-700/80 bg-[#0d1520] p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm sm:text-base font-extrabold text-white">
            {symbol} — Semih Ersoy Uyumsuzluk &amp; Formasyon Çizgileri ({INTERVAL_LABELS[interval]})
          </h3>
          <p className="text-[11px] text-slate-400">
            Fiyattaki mavi uyumsuzluk çizgisi, Güven Kıran Dip / Güven Tazeleyen Direnç ve RSI(14) + Sarı SMA(14).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImpulse((prev) => !prev)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
              showImpulse
                ? "bg-amber-500/20 border-amber-400 text-amber-200 shadow-sm"
                : "bg-slate-900 border-slate-700 text-slate-300 hover:text-amber-200"
            }`}
          >
            ⚡ İtki 1-2-3 &amp; Fib Zaman {loadingImpulse ? "…" : showImpulse ? "AÇIK" : ""}
          </button>

          {showImpulse && (
            <div className="flex items-center gap-1 text-[10px]">
              <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setFibTimeMode("modA")}
                  className={`px-2 py-0.5 rounded font-bold ${
                    fibTimeMode === "modA" ? "bg-violet-500/25 text-violet-200" : "text-slate-400"
                  }`}
                >
                  Mod A (W1)
                </button>
                <button
                  type="button"
                  onClick={() => setFibTimeMode("modB")}
                  className={`px-2 py-0.5 rounded font-bold ${
                    fibTimeMode === "modB" ? "bg-violet-500/25 text-violet-200" : "text-slate-400"
                  }`}
                >
                  Mod B (0-2)
                </button>
              </div>
              <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setScaleMode("linear")}
                  className={`px-2 py-0.5 rounded font-bold ${
                    scaleMode === "linear" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400"
                  }`}
                >
                  Lineer
                </button>
                <button
                  type="button"
                  onClick={() => setScaleMode("log")}
                  className={`px-2 py-0.5 rounded font-bold ${
                    scaleMode === "log" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400"
                  }`}
                >
                  Log
                </button>
              </div>
            </div>
          )}

          {(detail?.pu30_signal || detail?.nu70_signal) && (
            <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSignalPref("auto")}
                className={`px-2 py-1 rounded-md font-bold ${
                  signalPref === "auto" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white"
                }`}
              >
                Otomatik
              </button>
              <button
                type="button"
                disabled={!detail?.pu30_signal}
                onClick={() => setSignalPref("pu30")}
                title={detail?.pu30_signal ? "PU30 (Dip Dönüşü) çizgilerini göster" : "Bu periyotta PU30 yok"}
                className={`px-2 py-1 rounded-md font-bold transition-all ${
                  !detail?.pu30_signal
                    ? "text-slate-600 cursor-not-allowed"
                    : signalPref === "pu30"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-slate-300 hover:text-emerald-300"
                }`}
              >
                🟢 PU30
              </button>
              <button
                type="button"
                disabled={!detail?.nu70_signal}
                onClick={() => setSignalPref("nu70")}
                title={detail?.nu70_signal ? "NU70 (Zirve Yorulması) çizgilerini göster" : "Bu periyotta NU70 yok"}
                className={`px-2 py-1 rounded-md font-bold transition-all ${
                  !detail?.nu70_signal
                    ? "text-slate-600 cursor-not-allowed"
                    : signalPref === "nu70"
                    ? "bg-rose-500/20 text-rose-300"
                    : "text-slate-300 hover:text-rose-300"
                }`}
              >
                🔴 {detail?.nu70_signal?.is_early_candidate ? "NU70_ADAY" : "NU70"}
              </button>
            </div>
          )}

          <div className="flex gap-1">
            {(["15m", "1h", "4h", "1d"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setSignalPref("auto");
                  setIntervalVal(tf);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  interval === tf
                    ? "bg-cyan-500/20 border-cyan-500 text-cyan-200"
                    : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                {tf === "15m" ? "15DK" : tf === "1d" ? "1G" : tf.toUpperCase()}
              </button>
            ))}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Grafiği kapat"
              className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {detail?.mtf_nu_pu_summary && Object.keys(detail.mtf_nu_pu_summary).length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
          {(["15m", "1h", "4h", "1d"] as const).map((tf) => {
            const s = detail.mtf_nu_pu_summary?.[tf];
            const isActiveTf = interval === tf;
            const tfTitle = tf === "15m" ? "15 Dakikalık" : tf === "1h" ? "1 Saatlik" : tf === "4h" ? "4 Saatlik" : "Günlük";
            return (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setSignalPref("auto");
                  setIntervalVal(tf);
                }}
                className={`text-left rounded-xl border p-2.5 transition-all ${
                  isActiveTf
                    ? "border-cyan-500/70 bg-cyan-950/25 shadow-sm"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-slate-200">{tfTitle}</span>
                  <span className="font-mono text-[10px] text-slate-400">
                    RSI {s?.rsi != null ? fmtTR(s.rsi, 1) : "—"}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s?.has_nu70 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                      🔴 NU70 {s.nu70_tepe2 != null ? `(${fmtTR(s.nu70_tepe2)})` : ""}
                    </span>
                  )}
                  {!s?.has_nu70 && s?.has_early_nu70 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                      🟡 NU70_ADAY
                    </span>
                  )}
                  {s?.nu70_candle && s.nu70_candle !== "Yok" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/15 text-orange-200 border border-orange-500/30">
                      🕯️ {s.nu70_candle}
                    </span>
                  )}
                  {s?.has_pu30 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      🟢 PU30 {s.pu30_dip2 != null ? `(${fmtTR(s.pu30_dip2)})` : ""}
                    </span>
                  )}
                  {s?.has_pre_pu30 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                      ⚠️ 1 Dip Daha ({s.pre_pu30_price != null ? fmtTR(s.pre_pu30_price) : "—"})
                    </span>
                  )}
                  {!s?.has_nu70 && !s?.has_early_nu70 && s?.invalidated_nu70 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                      Eski NU70 Yeni Zirvede İptal
                    </span>
                  )}
                  {s &&
                    !s.has_nu70 &&
                    !s.has_early_nu70 &&
                    !s.has_pu30 &&
                    !s.has_pre_pu30 &&
                    !s.invalidated_nu70 && (
                      <span className="text-[10px] text-slate-500">Aktif NU/PU yok</span>
                    )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {activeSignal?.dip1 && activeSignal?.dip2 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-[10px] font-bold text-violet-300 uppercase">
              {isNU ? "1. ZİRVE (RSI > 70)" : "1. DİP (RSI < 30)"}
            </div>
            <div className="text-sm font-mono font-black text-white mt-1">
              {fmtTR(activeSignal.dip1.price)} ₺ / RSI {fmtTR(activeSignal.dip1.rsi, 1)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{activeSignal.dip1.date || "—"}</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-[10px] font-bold text-slate-300 uppercase">
              {isNU
                ? `2. ZİRVE (${activeSignal.is_early_candidate ? "ERKEN ADAY · " : ""}RSI < 70)`
                : "2. DİP (RSI > 30)"}
            </div>
            <div className={`text-sm font-mono font-black mt-1 ${isNU ? "text-rose-400" : "text-emerald-400"}`}>
              {fmtTR(activeSignal.dip2.price)} ₺ / RSI {fmtTR(activeSignal.dip2.rsi, 1)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{activeSignal.dip2.date || "—"}</div>
          </div>

          <div
            className={`rounded-xl border p-3 ${
              isNU
                ? "border-rose-500/40 bg-rose-950/20"
                : "border-emerald-500/40 bg-emerald-950/20"
            }`}
          >
            <div className={`text-[10px] font-bold uppercase ${isNU ? "text-rose-300" : "text-emerald-300"}`}>
              {isNU ? `${trustLabel} Güven Kıran Dip` : `${trustLabel} Güven Tazeleyen Direnç`}
            </div>
            <div className={`text-sm font-mono font-black mt-1 ${isNU ? "text-rose-400" : "text-emerald-400"}`}>
              {isNU
                ? activeSignal.guven_kiran_dip
                  ? `${fmtTR(activeSignal.guven_kiran_dip.price)} ₺`
                  : "Yapı bekleniyor"
                : activeSignal.guven_tazeleyen_tepe
                ? `${fmtTR(activeSignal.guven_tazeleyen_tepe.price)} ₺`
                : "Yapı bekleniyor"}
            </div>
            <div className="text-[11px] text-slate-300 mt-0.5">
              {isNU
                ? lvl.kirildi
                  ? lvl.fiyat_seviyenin === "ustunde"
                    ? "Kırıldı, fiyat şu an yeniden üstünde"
                    : "KIRILDI: satış / stop"
                  : "Altında kapanışta sat / stop"
                : lvl.kirildi
                ? lvl.fiyat_seviyenin === "altinda"
                  ? "Aşıldı, fiyat şu an yeniden altında"
                  : "AŞILDI: alış teyidi"
                : "Üzerinde kapanışta alış"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className={`text-[10px] font-bold uppercase ${isNU ? "text-rose-300" : "text-emerald-300"}`}>
              {isNU ? "NU70 ZİRVE DÜŞÜŞÜ" : "PU30 DİP YÜKSELİŞİ"}
            </div>
            <div className={`text-sm font-mono font-black mt-1 ${isNU ? "text-rose-400" : "text-emerald-400"}`}>
              {activeSignal.bars_since_confirm ?? 0} bar önce
            </div>
            <div className="text-[11px] text-cyan-300 mt-0.5">
              {isNU
                ? `Düzeltme: -%${fmtTR(activeSignal.pullback_pct, 1)}`
                : `Tepki: +%${fmtTR(activeSignal.bounce_pct, 1)}`}
            </div>
          </div>
        </div>
      ) : (
        !loading &&
        !errorMsg && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs text-slate-400">
            Bu zaman diliminde katı PU30/NU70 çizgisi oluşmadı; ham mum + RSI(14) ve aşırı satım/alım bantları (30 / 70) görüntüleniyor.
          </div>
        )
      )}

      {detail?.nu70_signal && (
        <div
          className={`rounded-xl border p-3.5 space-y-2 text-xs ${
            detail.nu70_signal.fractal_phase_code === "SALINIM_SONRA_YENI_ZIRVE" ||
            detail.nu70_signal.fractal_phase_code === "TUZAK_15DK_YENI_ZIRVE_BEKLENIR"
              ? "border-amber-500/40 bg-amber-950/20"
              : "border-rose-500/40 bg-rose-950/20"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded font-bold bg-rose-500/20 text-rose-200 border border-rose-500/40">
                {detail.nu70_signal.is_early_candidate ? "🟡 NU70_ADAY (Erken Yüksek Tepe)" : "🔴 NU70 Zirve Uyarısı"}
              </span>
              {detail.nu70_signal.fractal_phase_badge && (
                <span className="px-2 py-0.5 rounded font-bold bg-slate-900/90 text-amber-200 border border-amber-500/35">
                  {detail.nu70_signal.fractal_phase_badge}
                </span>
              )}
              {detail.nu70_signal.candle_label && detail.nu70_signal.candle_label !== "Yok" && (
                <span className="px-2 py-0.5 rounded font-bold bg-orange-500/20 text-orange-200 border border-orange-500/40">
                  {detail.nu70_signal.is_hanging_man ? "🕯️ " : detail.nu70_signal.is_shooting_star ? "☄️ " : ""}
                  {detail.nu70_signal.candle_label}
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] flex flex-wrap gap-3 text-slate-200">
              <span>1R Salınım: <strong className="text-amber-300">{fmtTR(detail.nu70_signal.target_1r)} ₺</strong></span>
              <span>2R Sert Satış: <strong className="text-rose-300">{fmtTR(detail.nu70_signal.target_tp1)} ₺</strong></span>
              <span>İptal Stopu: <strong className="text-rose-200">{fmtTR(detail.nu70_signal.stop_loss)} ₺</strong></span>
              {detail.nu70_signal.gkd_price != null && (
                <span>GKD: <strong className="text-white">{fmtTR(detail.nu70_signal.gkd_price)} ₺</strong> ({detail.nu70_signal.triggered ? "Kırıldı" : "Bekleniyor"})</span>
              )}
            </div>
          </div>
          {detail.nu70_signal.fractal_profit_plan && (
            <p className="text-slate-200 leading-relaxed">
              <strong>🎯 Semih Hoca NU70 &amp; Fraktal Kâr Planı:</strong> {detail.nu70_signal.fractal_profit_plan}
            </p>
          )}
        </div>
      )}

      {detail?.pre_pu30?.has_oversold_dip1 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-3.5 space-y-1.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-amber-200">
            <span>
              ⚠️ 1. Aşırı Satım Dibi: <strong>{fmtTR(detail.pre_pu30.oversold_price)} ₺</strong> (RSI{" "}
              {fmtTR(detail.pre_pu30.oversold_rsi, 1)} &lt; 30 · {detail.pre_pu30.oversold_date})
            </span>
            <span>
              Güncel RSI: <strong>{fmtTR(detail.pre_pu30.current_rsi, 1)}</strong> ·{" "}
              <span className={detail.pre_pu30.has_reaction ? "text-emerald-300" : "text-rose-300"}>
                {detail.pre_pu30.reaction_label || (detail.pre_pu30.has_reaction ? "Tepki Geldi → 2. Dip Bekleniyor" : "Tepkisiz → Şelale Riski")}
              </span>
            </span>
          </div>
          {detail.pre_pu30.explanation && (
            <p className="text-amber-100/90 leading-relaxed">
              <strong>📌 Semih Hoca Kuralı (En Az 1 Dip Daha):</strong> {detail.pre_pu30.explanation}
            </p>
          )}
        </div>
      )}

      {!detail?.nu70_signal && detail?.invalidated_nu70 && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-xs text-slate-300">
          ℹ️ Eski NU70 yapısı ({fmtTR((detail.invalidated_nu70.tepe2 || detail.invalidated_nu70.dip2)?.price)} ₺ · teyit:{" "}
          {detail.invalidated_nu70.confirm_date || "—"}) daha yüksek yeni zirve yapıldığı için (
          <code>{detail.invalidated_nu70.invalidation_reason || "HIGHER_HIGH_BROKEN"}</code>) geçerliliğini yitirdi.
        </div>
      )}

      {showImpulse && impulseOverlay?.impulse && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 space-y-1.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded font-bold border ${
                  impulseOverlay.impulse.direction === "BULL"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                }`}
              >
                {impulseOverlay.impulse.direction === "BULL" ? "🟢 Yükseliş İtkisi (1-2-3)" : "🔴 Düşüş İtkisi (1-2-3)"}
              </span>
              {impulseOverlay.impulse.quality_label && (
                <span className="px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                  {impulseOverlay.impulse.quality_label}
                </span>
              )}
              {impulseOverlay.impulse.gvt_gkd_aligned && (
                <span className="px-2 py-0.5 rounded font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-500/40">
                  ✓ GVT/GKD Hizalı
                </span>
              )}
            </div>
            {impulseOverlay.impulse.durum === "1_2_yapisi_hazir" && impulseOverlay.impulse.fib_fiyat_hedefleri && (
              <div className="font-mono text-[11px] flex flex-wrap gap-3 text-slate-200">
                <span>
                  W2 Fibo: <strong>{impulseOverlay.impulse.dalga2?.price_retracement_fib}</strong>
                </span>
                <span>
                  %161.8:{" "}
                  <strong className="text-emerald-300">
                    {fmtTR(
                      scaleMode === "log"
                        ? impulseOverlay.impulse.fib_fiyat_hedefleri["1.618"]?.target_log
                        : impulseOverlay.impulse.fib_fiyat_hedefleri["1.618"]?.target_from_w2
                    )}{" "}
                    ₺
                  </strong>
                </span>
                <span>
                  %361.8:{" "}
                  <strong className="text-amber-300">
                    {fmtTR(
                      scaleMode === "log"
                        ? impulseOverlay.impulse.fib_fiyat_hedefleri["3.618"]?.target_log
                        : impulseOverlay.impulse.fib_fiyat_hedefleri["3.618"]?.target_from_w2
                    )}{" "}
                    ₺
                  </strong>
                </span>
              </div>
            )}
          </div>
          {impulseOverlay.impulse.durum !== "1_2_yapisi_hazir" && (
            <p className="text-slate-300 text-[11px]">
              Bu periyotta henüz tamamlanmış geçerli 1-2 itki yapısı yok (durum: <code>{impulseOverlay.impulse.durum}</code>).
            </p>
          )}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-6 text-center text-xs text-cyan-300">
          {symbol} ({INTERVAL_LABELS[interval]}) grafiği yükleniyor…
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-300">
          Grafik yüklenemedi: {errorMsg}
        </div>
      )}

      <div className={loading || errorMsg ? "hidden" : "space-y-2"}>
        <div ref={priceContainerRef} className="w-full overflow-hidden rounded-xl border border-slate-800" />
        <div ref={rsiContainerRef} className="w-full overflow-hidden rounded-xl border border-slate-800" />
      </div>
    </div>
  );
}
