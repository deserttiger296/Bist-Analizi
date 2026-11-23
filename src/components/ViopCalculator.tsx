"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BIST_STOCK_FUTURES_MULTIPLIER,
  buildViopOrderSteps,
  computeViopPlan,
  type LeverageWarningLevel,
  type ViopDirection,
  type ViopPlanResult,
} from "@/lib/viop";
import { formatTR, formatTRY } from "@/lib/format";
import { TermHint } from "@/components/GlossaryTooltip";

export interface ViopSignalPreset {
  symbol: string;
  direction: ViopDirection;
  entryPrice: number;
  stopPrice: number;
  target1r?: number;
  target2r?: number;
  triggered?: boolean;
  fractalPhaseCode?: string | null;
  hasReaction?: boolean;
  signalLabel?: string;
  gvtOrGkdLevel?: number;
}

export interface ViopCalculatorProps {
  /** Signal card preset passed from /lab or /impulse-lab modal */
  signalPreset?: ViopSignalPreset | null;
  /** Initial preset passed from /viop-rehber preset buttons */
  initialPreset?: ViopSignalPreset | null;
  /** Compact modal spacing mode */
  compact?: boolean;
  /** When provided, renders modal close button & Escape-key listener */
  onClose?: () => void;
}

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(2)));
}

function parseDecimal(raw: string): number {
  const cleaned = raw.trim().replace(/\s+/g, "");
  if (!cleaned) return Number.NaN;
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : Number.NaN;
}

function safeFormatTR(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return formatTR(value, digits);
}

function safeFormatTRY(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return formatTRY(value);
}

const LEVERAGE_BADGE_MAP: Record<
  LeverageWarningLevel,
  { label: string; toneClass: string }
> = {
  SAFE: {
    label: "GÜVENLİ (≤2.5x)",
    toneClass: "workspace-badge workspace-tone-positive",
  },
  MODERATE: {
    label: "ORTA RİSK (≤4.0x)",
    toneClass: "workspace-badge workspace-tone-warning",
  },
  HIGH: {
    label: "YÜKSEK RİSK (>4.0x)",
    toneClass: "workspace-badge workspace-tone-negative",
  },
};

export function ViopCalculator({
  signalPreset = null,
  initialPreset = null,
  compact = false,
  onClose,
}: ViopCalculatorProps) {
  const activePreset = signalPreset ?? initialPreset ?? null;

  // Account & risk defaults (preserved across signal/preset switches)
  const [capitalInput, setCapitalInput] = useState("100000");
  const [riskPctInput, setRiskPctInput] = useState("2");
  const [marginRatePctInput, setMarginRatePctInput] = useState("20");
  const [commissionPctInput, setCommissionPctInput] = useState("0.05");

  // Trade parameters
  const [symbol, setSymbol] = useState(() =>
    (activePreset?.symbol ?? "THYAO").replace(/\.IS$/i, "").toUpperCase()
  );
  const [direction, setDirection] = useState<ViopDirection>(
    () => activePreset?.direction ?? "SHORT"
  );
  const [entryPriceInput, setEntryPriceInput] = useState(() =>
    activePreset ? formatInputNumber(activePreset.entryPrice) : "325.75"
  );
  const [stopPriceInput, setStopPriceInput] = useState(() =>
    activePreset ? formatInputNumber(activePreset.stopPrice) : "340.04"
  );
  const [target1rInput, setTarget1rInput] = useState(() =>
    activePreset?.target1r != null && Number.isFinite(activePreset.target1r)
      ? formatInputNumber(activePreset.target1r)
      : ""
  );
  const [target2rInput, setTarget2rInput] = useState(() =>
    activePreset?.target2r != null && Number.isFinite(activePreset.target2r)
      ? formatInputNumber(activePreset.target2r)
      : ""
  );

  const syncFromPreset = useCallback((preset: ViopSignalPreset) => {
    setSymbol(preset.symbol.replace(/\.IS$/i, "").toUpperCase());
    setDirection(preset.direction);
    setEntryPriceInput(formatInputNumber(preset.entryPrice));
    setStopPriceInput(formatInputNumber(preset.stopPrice));
    setTarget1rInput(
      preset.target1r != null && Number.isFinite(preset.target1r)
        ? formatInputNumber(preset.target1r)
        : ""
    );
    setTarget2rInput(
      preset.target2r != null && Number.isFinite(preset.target2r)
        ? formatInputNumber(preset.target2r)
        : ""
    );
  }, []);

  const presetSymbol = activePreset?.symbol;
  const presetDirection = activePreset?.direction;
  const presetEntryPrice = activePreset?.entryPrice;
  const presetStopPrice = activePreset?.stopPrice;
  const presetTarget1r = activePreset?.target1r;
  const presetTarget2r = activePreset?.target2r;

  useEffect(() => {
    if (
      presetSymbol === undefined ||
      presetDirection === undefined ||
      presetEntryPrice === undefined ||
      presetStopPrice === undefined
    ) {
      return;
    }
    syncFromPreset({
      symbol: presetSymbol,
      direction: presetDirection,
      entryPrice: presetEntryPrice,
      stopPrice: presetStopPrice,
      target1r: presetTarget1r,
      target2r: presetTarget2r,
    });
  }, [
    presetSymbol,
    presetDirection,
    presetEntryPrice,
    presetStopPrice,
    presetTarget1r,
    presetTarget2r,
    syncFromPreset,
  ]);

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const cleanSymbol = symbol
    .trim()
    .toUpperCase()
    .replace(/\.IS$/i, "")
    .replace(/[^A-Z0-9]/g, "");

  const parsedCapital = parseDecimal(capitalInput);
  const parsedRiskPct = parseDecimal(riskPctInput);
  const parsedMarginRatePct = parseDecimal(marginRatePctInput);
  const parsedCommissionPct = parseDecimal(commissionPctInput);
  const parsedEntry = parseDecimal(entryPriceInput);
  const parsedStop = parseDecimal(stopPriceInput);
  const parsedTarget1r = target1rInput.trim()
    ? parseDecimal(target1rInput)
    : undefined;
  const parsedTarget2r = target2rInput.trim()
    ? parseDecimal(target2rInput)
    : undefined;

  const result: ViopPlanResult = useMemo(
    () =>
      computeViopPlan({
        symbol: cleanSymbol,
        direction,
        capitalTry: parsedCapital,
        riskPct: parsedRiskPct,
        entryPrice: parsedEntry,
        stopPrice: parsedStop,
        target1r: parsedTarget1r,
        target2r: parsedTarget2r,
        marginRatePct: parsedMarginRatePct,
        commissionPct: parsedCommissionPct,
      }),
    [
      cleanSymbol,
      direction,
      parsedCapital,
      parsedRiskPct,
      parsedEntry,
      parsedStop,
      parsedTarget1r,
      parsedTarget2r,
      parsedMarginRatePct,
      parsedCommissionPct,
    ]
  );

  const orderSteps = useMemo(
    () =>
      buildViopOrderSteps(result, {
        symbol: cleanSymbol,
        direction,
        entryPrice: parsedEntry,
        stopPrice: parsedStop,
        triggered: activePreset?.triggered,
        fractalPhaseCode: activePreset?.fractalPhaseCode,
        hasReaction: activePreset?.hasReaction,
        gvtOrGkdLevel: activePreset?.gvtOrGkdLevel,
      }),
    [
      result,
      cleanSymbol,
      direction,
      parsedEntry,
      parsedStop,
      activePreset?.triggered,
      activePreset?.fractalPhaseCode,
      activePreset?.hasReaction,
      activePreset?.gvtOrGkdLevel,
    ]
  );

  const isTrap15m =
    activePreset?.fractalPhaseCode === "TUZAK_15DK_YENI_ZIRVE_BEKLENIR";
  const hasNoReaction = activePreset?.hasReaction === false;
  const isUntriggered = activePreset?.triggered === false;
  const showCriticalRed = isTrap15m || hasNoReaction;
  const showAmberUntriggered = !showCriticalRed && isUntriggered;
  const isImpulsePreset = Boolean(
    activePreset?.signalLabel?.toLowerCase().includes("itki")
  );

  const leverageBadge = LEVERAGE_BADGE_MAP[result.leverageWarning];
  const intraday75Total =
    result.intradayWarning75PerContractTry * result.suggestedContracts;

  const inputClassName =
    "w-full rounded-lg border border-[#34475e] bg-[#0b1420] px-3 py-2 text-sm text-[#dbe6f3] tabular-nums focus:border-[#69ddbb] focus:outline-none";

  return (
    <div
      className={`rounded-[13px] border border-[#29384b] bg-[#111b28] text-[#eaf0f6] shadow-2xl ${
        compact ? "p-4 sm:p-5 max-h-[90vh] overflow-y-auto" : "p-5 sm:p-6"
      }`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243246] pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="text-base font-bold tracking-tight text-[#eaf0f6]">
            🧮 VİOP Kontrat, Teminat & Risk Planlayıcısı
          </span>
          <TermHint id="VIOP_PAY_VADELI" />
          <span className="rounded-md border border-[#324861] bg-[#0b1018] px-2.5 py-0.5 font-mono text-xs font-semibold text-[#7de4c7]">
            {result.suggestedContractCode}
          </span>
          {activePreset?.signalLabel && (
            <span className="rounded-md border border-[#2f4259] bg-[#152233] px-2 py-0.5 text-[11px] font-medium text-[#b5cde3]">
              {activePreset.signalLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activePreset && (
            <button
              type="button"
              onClick={() => syncFromPreset(activePreset)}
              className="rounded-lg border border-[#34475e] bg-[#0b1018] px-2.5 py-1 text-xs font-semibold text-[#9dc4db] transition-colors hover:border-[#69ddbb] hover:text-white"
            >
              Sinyale Sıfırla
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="VİOP planlayıcıyı kapat"
              className="rounded-lg border border-[#34475e] bg-[#0b1018] px-2.5 py-1 text-xs font-bold text-slate-300 transition-colors hover:border-[#69ddbb] hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Priority-ordered Safety Banners (always rendered even if result.isValid === false) */}
      <div className="mt-3.5 space-y-2.5">
        {showCriticalRed && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-4 py-3 text-xs leading-relaxed text-rose-100"
          >
            {isTrap15m && (
              <div>
                <p className="font-bold text-rose-200">
                  ☠️ 15dk NU70 Tuzak Uyarısı — VİOP&apos;ta İşlem Açma!
                </p>
                <p className="mt-1">
                  15 dakikalıkta NU70 var ancak Saatlikte (1S) henüz NU70 onayı
                  YOK. &ldquo;Öğlene kadar düşüp öğleden sonra dönüp yeni zirve
                  yapabilir&rdquo; — kaldıraçlı SHORT için tuzaktır; 1S onayını
                  bekle.
                </p>
              </div>
            )}
            {hasNoReaction && (
              <div className={isTrap15m ? "mt-2 border-t border-rose-500/30 pt-2" : ""}>
                <p className="font-bold text-rose-200">
                  ⚠️ Tepkisiz Düşüş / Şelale Riski — VİOP&apos;ta Dip Avlama!
                </p>
                <p className="mt-1">
                  RSI 30 altına indikten sonra henüz tepki alımı veya 2. dip
                  (PU30) oluşmadı. Tepkisiz basışta kaldıraçlı LONG pozisyon
                  açma; tepki + yeni dip + GVT kırılımını bekle.
                </p>
              </div>
            )}
            {isUntriggered && (
              <p className="mt-2 border-t border-rose-500/30 pt-2 text-rose-200/95">
                ⏳ Ek olarak GVT/GKD kırılım teyidi henüz gelmedi
                {activePreset?.gvtOrGkdLevel != null &&
                Number.isFinite(activePreset.gvtOrGkdLevel)
                  ? ` (eşik: ${safeFormatTR(activePreset.gvtOrGkdLevel)} ₺)`
                  : ""}
                .
              </p>
            )}
          </div>
        )}

        {showAmberUntriggered && (
          <div
            role="status"
            className="rounded-xl border border-amber-500/55 bg-amber-950/45 px-4 py-3 text-xs leading-relaxed text-amber-100"
          >
            <p className="font-bold text-amber-200">
              ⏳ Henüz GVT/GKD Kırılımı Gelmedi — VİOP&apos;ta Erken Pozisyon Açma!
            </p>
            <p className="mt-1">
              Sinyal şu an pusu/izleme aşamasında.{" "}
              {activePreset?.gvtOrGkdLevel != null &&
              Number.isFinite(activePreset.gvtOrGkdLevel)
                ? `Kırılım eşiği (${safeFormatTR(activePreset.gvtOrGkdLevel)} ₺) `
                : "Onay seviyesi "}
              kırılmadan kaldıraçlı işlem açmak erken stop riskini artırır.
            </p>
          </div>
        )}

        {result.inRolloverWindow && (
          <div
            role="status"
            className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-2.5 text-xs leading-relaxed text-amber-100"
          >
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-amber-200">
              <span>📅 Vade Sonu / Rollover Penceresi</span>
              <TermHint id="ROLLOVER" />
            </div>
            <p className="mt-0.5">
              <code>{result.suggestedContractCode}</code> vadesinin son iş
              günlerine yaklaşıldı. Fiziki teslimat ve temerrüt riskinden
              kaçınmak için yeni işlemlerde{" "}
              <code>{result.nextContractCode}</code> vadesini veya zamanında
              vade taşımayı değerlendirin.
            </p>
          </div>
        )}

        {cleanSymbol.length > 0 && !result.isStandardViopSymbol && (
          <div
            role="status"
            className="rounded-xl border border-sky-500/40 bg-sky-950/35 px-4 py-2.5 text-xs leading-relaxed text-sky-100"
          >
            <span className="font-semibold text-sky-200">
              ℹ️ Pay Vadeli Evreni Dışı Sembol:{" "}
            </span>
            <code>{cleanSymbol}</code> standart 41 BIST Pay Vadeli hissesi
            listesinde yer almıyor (veya likiditesi düşük olabilir). Hesaplama{" "}
            {BIST_STOCK_FUTURES_MULTIPLIER}x standart çarpan ile simülasyon
            amaçlı gösterilmektedir.
          </div>
        )}
      </div>

      {/* Main Responsive Grid */}
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Column: Inputs */}
        <div className="space-y-4 rounded-xl border border-[#243246] bg-[#0b1018] p-4 lg:col-span-5">
          {/* Direction Segmented Toggle */}
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#93a2b7]">
              İşlem Yönü
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={direction === "LONG"}
                onClick={() => setDirection("LONG")}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                  direction === "LONG"
                    ? "border-[#2e7c64] bg-[#18372f] text-[#7ae3bf]"
                    : "border-[#29384b] bg-[#0e1622] text-slate-400 hover:text-slate-200"
                }`}
              >
                LONG (Alış)
              </button>
              <button
                type="button"
                aria-pressed={direction === "SHORT"}
                onClick={() => setDirection("SHORT")}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                  direction === "SHORT"
                    ? "border-[#7d3c4e] bg-[#35232d] text-[#f38b9e]"
                    : "border-[#29384b] bg-[#0e1622] text-slate-400 hover:text-slate-200"
                }`}
              >
                SHORT (Satış)
              </button>
            </div>
          </div>

          {/* Symbol */}
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#93a2b7]">
              <label htmlFor="viop-symbol">Hisse Sembolü</label>
              <TermHint id="KONTRAT_100" />
            </div>
            <input
              id="viop-symbol"
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Örn. THYAO"
              className={`${inputClassName} uppercase`}
            />
          </div>

          {/* 2-Column Numeric Grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="viop-capital"
                className="mb-1 block text-[11px] font-semibold text-[#93a2b7]"
              >
                Sermaye (₺)
              </label>
              <input
                id="viop-capital"
                type="text"
                inputMode="decimal"
                value={capitalInput}
                onChange={(e) => setCapitalInput(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="viop-risk"
                className="mb-1 block text-[11px] font-semibold text-[#93a2b7]"
              >
                İşlem Başı Risk (%)
              </label>
              <input
                id="viop-risk"
                type="text"
                inputMode="decimal"
                value={riskPctInput}
                onChange={(e) => setRiskPctInput(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#93a2b7]">
                <label htmlFor="viop-margin">Başlangıç Teminatı (%)</label>
                <TermHint id="BASLANGIC_SURDURME_TEMINAT" />
              </div>
              <input
                id="viop-margin"
                type="text"
                inputMode="decimal"
                value={marginRatePctInput}
                onChange={(e) => setMarginRatePctInput(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="viop-commission"
                className="mb-1 block text-[11px] font-semibold text-[#93a2b7]"
              >
                Gidiş-Dönüş Komisyon (%)
              </label>
              <input
                id="viop-commission"
                type="text"
                inputMode="decimal"
                value={commissionPctInput}
                onChange={(e) => setCommissionPctInput(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="viop-entry"
                className="mb-1 block text-[11px] font-semibold text-[#93a2b7]"
              >
                Giriş Fiyatı (₺)
              </label>
              <input
                id="viop-entry"
                type="text"
                inputMode="decimal"
                value={entryPriceInput}
                onChange={(e) => setEntryPriceInput(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#93a2b7]">
                <label htmlFor="viop-stop">İptal Stopu (₺)</label>
                <TermHint id="STOP_LOSS" />
              </div>
              <input
                id="viop-stop"
                type="text"
                inputMode="decimal"
                value={stopPriceInput}
                onChange={(e) => setStopPriceInput(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#93a2b7]">
                <label htmlFor="viop-target1r">
                  {isImpulsePreset ? "Hedef 1 (Fib 1.618)" : "Hedef 1 (1R / Fib)"}
                </label>
                <TermHint id="1R" />
              </div>
              <input
                id="viop-target1r"
                type="text"
                inputMode="decimal"
                value={target1rInput}
                onChange={(e) => setTarget1rInput(e.target.value)}
                placeholder={
                  result.isValid ? safeFormatTR(result.resolvedTarget1r) : "Otomatik"
                }
                className={inputClassName}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#93a2b7]">
                <label htmlFor="viop-target2r">
                  {isImpulsePreset ? "Hedef 2 (Fib 3.618)" : "Hedef 2 (2R / Fib)"}
                </label>
                <TermHint id="2R" />
              </div>
              <input
                id="viop-target2r"
                type="text"
                inputMode="decimal"
                value={target2rInput}
                onChange={(e) => setTarget2rInput(e.target.value)}
                placeholder={
                  result.isValid ? safeFormatTR(result.resolvedTarget2r) : "Otomatik"
                }
                className={inputClassName}
              />
            </div>
          </div>
        </div>

        {/* Right Column: KPI Results & Step-by-step Order Plan */}
        <div className="space-y-4 lg:col-span-7">
          {!result.isValid && (
            <div
              role="alert"
              className="workspace-notice workspace-notice-error rounded-xl px-4 py-3 text-xs font-medium"
            >
              ⚠️ {result.validationError}
            </div>
          )}

          {result.isValid && result.suggestedContracts === 0 && (
            <div
              role="status"
              className="workspace-notice workspace-notice-warning rounded-xl px-4 py-3 text-xs leading-relaxed"
            >
              <strong>0 Kontrat Önerildi:</strong>{" "}
              {result.recommendedContractsByRisk === 0
                ? `1 kontratlık stop riski (${safeFormatTRY(result.riskPerContractTry)}), belirlediğiniz maksimum işlem risk bütçesini (${safeFormatTRY(result.maxRiskBudgetTry)}) aşıyor.`
                : `1 kontratlık başlangıç teminatı (${safeFormatTRY(result.initialMarginPerContractTry)}), sermayenizi (${safeFormatTRY(parsedCapital)}) aşıyor.`}{" "}
              Sermaye koruması için <strong>0 kontrat — zorla 1&apos;e yuvarlama yapılmaz.</strong>
            </div>
          )}

          {/* 6 KPI Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="workspace-metric workspace-tone-neutral">
              <span className="flex items-center gap-1">
                <span>Önerilen Kontrat</span>
                <TermHint id="KONTRAT_100" />
              </span>
              <strong>
                {result.isValid ? `${result.suggestedContracts} Kontrat` : "—"}
              </strong>
              <p>
                {result.isValid
                  ? result.marginCapped
                    ? `Teminat sınırı aktif (Risk: ${result.recommendedContractsByRisk}, Tavan: ${result.maxContractsByMargin})`
                    : `Risk limiti: ${result.recommendedContractsByRisk} · Teminat tavanı: ${result.maxContractsByMargin}`
                  : "Geçerli girdi bekleniyor"}
              </p>
            </div>

            <div className="workspace-metric workspace-tone-neutral">
              <span>Pozisyon Büyüklüğü</span>
              <strong>
                {result.isValid ? safeFormatTRY(result.totalPositionTry) : "—"}
              </strong>
              <p>
                {result.isValid
                  ? `1 kontrat (${result.multiplier} hisse): ${safeFormatTRY(result.contractNotionalTry)}`
                  : "—"}
              </p>
            </div>

            <div className="workspace-metric workspace-tone-neutral">
              <span className="flex items-center gap-1">
                <span>Gerekli Teminat & Yedek</span>
                <TermHint id="MARGIN_CALL" />
              </span>
              <strong>
                {result.isValid ? safeFormatTRY(result.requiredMarginTry) : "—"}
              </strong>
              <p>
                {result.isValid
                  ? `Yedek: ${safeFormatTRY(result.freeMarginBufferTry)} · Takasbank %100: ${safeFormatTRY(result.maintenanceMarginTotalTry)} (%75 uyarı: ${safeFormatTRY(intraday75Total)})`
                  : "—"}
              </p>
            </div>

            <div
              className={`workspace-metric ${
                !result.isValid
                  ? "workspace-tone-neutral"
                  : result.leverageWarning === "SAFE"
                    ? "workspace-tone-positive"
                    : result.leverageWarning === "MODERATE"
                      ? "workspace-tone-warning"
                      : "workspace-tone-negative"
              }`}
            >
              <span className="flex items-center gap-1">
                <span>Efektif Kaldıraç</span>
                <TermHint id="EFEKTIF_KALDIRAC" />
              </span>
              <strong>
                {result.isValid
                  ? `${safeFormatTR(result.effectiveLeverage, 2)}x`
                  : "—"}
              </strong>
              <p>
                {result.isValid ? (
                  <span className={leverageBadge.toneClass}>
                    {leverageBadge.label}
                  </span>
                ) : (
                  "—"
                )}
              </p>
            </div>

            <div className="workspace-metric workspace-tone-negative">
              <span>Stopta Tahmini Kayıp</span>
              <strong>
                {result.isValid
                  ? `-${safeFormatTRY(result.riskLossTry)}`
                  : "—"}
              </strong>
              <p>
                {result.isValid
                  ? `Stop mesafesi: ${safeFormatTR(result.stopDistanceTry)} ₺ (%${safeFormatTR(result.stopDistancePct, 2)}) · Komisyon: ${safeFormatTRY(result.estCommissionTry)}`
                  : "—"}
              </p>
            </div>

            <div className="workspace-metric workspace-tone-positive">
              <span>1R / 2R Net Kâr</span>
              <strong>
                {result.isValid
                  ? `+${safeFormatTRY(result.profit2rTry)}`
                  : "—"}
              </strong>
              <p>
                {result.isValid
                  ? `1R (${safeFormatTR(result.resolvedTarget1r)} ₺): +${safeFormatTRY(result.profit1rTry)} · 2R (${safeFormatTR(result.resolvedTarget2r)} ₺)`
                  : "—"}
              </p>
            </div>
          </div>

          {/* Step-by-step Order Plan */}
          <div className="rounded-xl border border-[#243246] bg-[#0b1018] p-4">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-[#7de4c7]">
                Adım Adım VİOP Emir Planı
              </span>
              <span className="text-[11px] text-[#93a2b7]">
                Seans: 09:30–18:10 · Gün sonu uzlaşma: Son 10 dk AOF
              </span>
            </div>
            <ol className="space-y-2 text-xs text-slate-300">
              {orderSteps.map((item) => (
                <li
                  key={item.step}
                  className="flex items-start gap-2.5 rounded-lg border border-[#1d2a3b] bg-[#101824] px-3 py-2 leading-relaxed"
                >
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#344963] bg-[#152435] text-[11px] font-bold text-[#7de4c7]">
                    {item.step}
                  </span>
                  <div className="min-w-0">
                    <span className="font-semibold text-[#eaf0f6]">
                      {item.title}:{" "}
                    </span>
                    <span className="text-slate-300">{item.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* SPK & Leverage Risk Disclaimer */}
      <div className="workspace-notice mt-4 rounded-lg border border-[#2a394c] bg-[#0b1018]/90 p-3.5 text-[11px] leading-relaxed text-[#93a2b7]">
        <strong className="text-slate-200">
          Yasal Uyarı (SPK &amp; Kaldıraç Riski):{" "}
        </strong>
        Bu hesaplayıcı ve adım adım emir planı yalnızca eğitim ve risk yönetimi
        simülasyonu amaçlıdır; Sermaye Piyasası Kurulu (SPK) düzenlemeleri
        kapsamında yatırım danışmanlığı veya al-sat tavsiyesi değildir. VİOP Pay
        Vadeli işlemler kaldıraçlıdır; fiyatın ters yönde hareket etmesi halinde
        yatırdığınız teminatın tamamını veya fazlasını kaybedebilir, gün sonu
        değerleme (son 10 dk AOF) sonrası <strong>T+1 15:00</strong>&apos;e
        kadar teminat tamamlama çağrısı (<strong>Margin Call</strong>) ve{" "}
        <strong>resen pozisyon kapatma</strong> riskiyle karşılaşabilirsiniz.
        Gerçek Takasbank SPAN teminat oranları, komisyon/BSMV tutarları ve vade
        sonu fiziki teslimat kuralları aracı kurumunuza göre değişebilir.
      </div>
    </div>
  );
}

export default ViopCalculator;
