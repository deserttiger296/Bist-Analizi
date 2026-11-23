export const BIST_STOCK_FUTURES_MULTIPLIER = 100;
export const TAKASBANK_MAINTENANCE_MARGIN_RATIO = 1.0;

/**
 * Exact 41 BIST Pay Vadeli (VİOP) symbols matching
 * `python_bot/engine/signals/long_short_matrix.py` (`VIOP_SYMBOLS`).
 */
export const BIST_VIOP_SYMBOLS: ReadonlySet<string> = new Set([
  "AEFES",
  "AKBNK",
  "ARCLK",
  "ASELS",
  "ASTOR",
  "BIMAS",
  "CCOLA",
  "DOHOL",
  "EKGYO",
  "ENKAI",
  "EREGL",
  "FROTO",
  "GARAN",
  "GUBRF",
  "HALKB",
  "HEKTS",
  "ISCTR",
  "KCHOL",
  "KRDMD",
  "MGROS",
  "OYAKC",
  "PETKM",
  "PGSUS",
  "SAHOL",
  "SASA",
  "SISE",
  "SOKM",
  "TAVHL",
  "TCELL",
  "THYAO",
  "TOASO",
  "TRALT",
  "TRMET",
  "TSKB",
  "TTKOM",
  "TTRAK",
  "TUPRS",
  "ULKER",
  "VAKBN",
  "VESTL",
  "YKBNK",
]);

export type ViopDirection = "LONG" | "SHORT";
export type LeverageWarningLevel = "SAFE" | "MODERATE" | "HIGH";

export interface ViopContractCodeInfo {
  nearCode: string;
  nextCode: string;
  inRolloverWindow: boolean;
}

export interface ViopPlanInput {
  symbol?: string;
  direction: ViopDirection;
  capitalTry: number;
  riskPct: number;
  entryPrice: number;
  stopPrice: number;
  target1r?: number;
  target2r?: number;
  marginRatePct?: number;
  commissionPct?: number;
  maintenanceMarginRatio?: number;
  referenceDate?: Date;
}

export interface ViopPlanResult {
  isValid: boolean;
  validationError: string | null;
  direction: ViopDirection;
  multiplier: number;
  stopDistanceTry: number;
  stopDistancePct: number;
  contractNotionalTry: number;
  initialMarginPerContractTry: number;
  maintenanceMarginPerContractTry: number;
  intradayWarning75PerContractTry: number;
  riskPerContractTry: number;
  maxRiskBudgetTry: number;
  recommendedContractsByRisk: number;
  maxContractsByMargin: number;
  suggestedContracts: number;
  marginCapped: boolean;
  totalPositionTry: number;
  requiredMarginTry: number;
  maintenanceMarginTotalTry: number;
  freeMarginBufferTry: number;
  effectiveLeverage: number;
  leverageWarning: LeverageWarningLevel;
  riskLossTry: number;
  profit1rTry: number;
  profit2rTry: number;
  estCommissionTry: number;
  resolvedTarget1r: number;
  resolvedTarget2r: number;
  suggestedContractCode: string;
  nextContractCode: string;
  inRolloverWindow: boolean;
  isStandardViopSymbol: boolean;
}

export interface ViopOrderStep {
  step: number;
  title: string;
  detail: string;
}

export interface ViopOrderContext {
  symbol?: string;
  direction: ViopDirection;
  entryPrice: number;
  stopPrice: number;
  capitalTry?: number;
  riskPct?: number;
  target1r?: number;
  target2r?: number;
  marginRatePct?: number;
  commissionPct?: number;
  maintenanceMarginRatio?: number;
  referenceDate?: Date;
  triggered?: boolean;
  fractalPhaseCode?: string | null;
  hasReaction?: boolean;
  gvtOrGkdLevel?: number;
}

function normalizeSymbol(symbol: string | undefined): string {
  return (symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.IS$/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

function getIstanbulCalendarParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();

  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }

  return { year, month, day };
}

function formatMonthYear(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}${String(year % 100).padStart(2, "0")}`;
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₺`;
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Builds the near-month and next-month BIST Pay Vadeli contract codes
 * (`F_<SYMBOL>MMYY`) using `Europe/Istanbul` calendar dates and flags the
 * last 3 weekday business days of the month as the rollover window.
 */
export function formatViopContractCode(
  symbol: string,
  referenceDate?: Date
): ViopContractCodeInfo {
  const clean = normalizeSymbol(symbol) || "HISSE";
  const resolvedDate =
    referenceDate instanceof Date && Number.isFinite(referenceDate.getTime())
      ? referenceDate
      : new Date();

  const { year, month, day } = getIstanbulCalendarParts(resolvedDate);
  const nearCode = `F_${clean}${formatMonthYear(month, year)}`;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextCode = `F_${clean}${formatMonthYear(nextMonth, nextYear)}`;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const businessDays: number[] = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      businessDays.push(d);
    }
  }

  const rolloverStartDay =
    businessDays.length > 0
      ? businessDays[Math.max(0, businessDays.length - 3)]
      : daysInMonth;

  return {
    nearCode,
    nextCode,
    inRolloverWindow: day >= rolloverStartDay,
  };
}

function buildInvalidResult(
  direction: ViopDirection,
  contractInfo: ViopContractCodeInfo,
  isStandardViopSymbol: boolean,
  validationError: string
): ViopPlanResult {
  return {
    isValid: false,
    validationError,
    direction,
    multiplier: BIST_STOCK_FUTURES_MULTIPLIER,
    stopDistanceTry: 0,
    stopDistancePct: 0,
    contractNotionalTry: 0,
    initialMarginPerContractTry: 0,
    maintenanceMarginPerContractTry: 0,
    intradayWarning75PerContractTry: 0,
    riskPerContractTry: 0,
    maxRiskBudgetTry: 0,
    recommendedContractsByRisk: 0,
    maxContractsByMargin: 0,
    suggestedContracts: 0,
    marginCapped: false,
    totalPositionTry: 0,
    requiredMarginTry: 0,
    maintenanceMarginTotalTry: 0,
    freeMarginBufferTry: 0,
    effectiveLeverage: 0,
    leverageWarning: "SAFE",
    riskLossTry: 0,
    profit1rTry: 0,
    profit2rTry: 0,
    estCommissionTry: 0,
    resolvedTarget1r: 0,
    resolvedTarget2r: 0,
    suggestedContractCode: contractInfo.nearCode,
    nextContractCode: contractInfo.nextCode,
    inRolloverWindow: contractInfo.inRolloverWindow,
    isStandardViopSymbol,
  };
}

export function computeViopPlan(input: ViopPlanInput): ViopPlanResult {
  const direction: ViopDirection =
    input.direction === "SHORT" ? "SHORT" : "LONG";
  const cleanSym = normalizeSymbol(input.symbol);
  const isStandardViopSymbol = BIST_VIOP_SYMBOLS.has(cleanSym);
  const contractInfo = formatViopContractCode(cleanSym, input.referenceDate);

  if (input.direction !== "LONG" && input.direction !== "SHORT") {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "İşlem yönü LONG veya SHORT olmalıdır."
    );
  }

  const marginRatePct = input.marginRatePct ?? 20;
  const commissionPct = input.commissionPct ?? 0.05;
  const maintenanceMarginRatio =
    input.maintenanceMarginRatio ?? TAKASBANK_MAINTENANCE_MARGIN_RATIO;

  if (!Number.isFinite(input.capitalTry) || input.capitalTry <= 0) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Sermaye tutarı 0'dan büyük geçerli bir sayı olmalıdır."
    );
  }
  if (
    !Number.isFinite(input.riskPct) ||
    input.riskPct <= 0 ||
    input.riskPct > 100
  ) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "İşlem başı risk yüzdesi %0 ile %100 arasında olmalıdır."
    );
  }
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Giriş fiyatı 0'dan büyük geçerli bir sayı olmalıdır."
    );
  }
  if (!Number.isFinite(input.stopPrice) || input.stopPrice <= 0) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "İptal stop fiyatı 0'dan büyük geçerli bir sayı olmalıdır."
    );
  }
  if (
    !Number.isFinite(marginRatePct) ||
    marginRatePct <= 0 ||
    marginRatePct > 100
  ) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Başlangıç teminat oranı %0 ile %100 arasında olmalıdır."
    );
  }
  if (
    !Number.isFinite(commissionPct) ||
    commissionPct < 0 ||
    commissionPct >= 100
  ) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Gidiş-dönüş komisyon oranı %0 veya daha büyük (100'den küçük) olmalıdır."
    );
  }
  if (
    !Number.isFinite(maintenanceMarginRatio) ||
    maintenanceMarginRatio <= 0 ||
    maintenanceMarginRatio > 1.5
  ) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Sürdürme teminat oranı 0 ile 1.5 arasında geçerli bir değer olmalıdır."
    );
  }
  if (direction === "LONG" && input.stopPrice >= input.entryPrice) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "LONG işlemde stop fiyatı giriş fiyatından düşük olmalıdır."
    );
  }
  if (direction === "SHORT" && input.stopPrice <= input.entryPrice) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "SHORT işlemde stop fiyatı giriş fiyatından yüksek olmalıdır."
    );
  }
  if (
    input.target1r !== undefined &&
    (!Number.isFinite(input.target1r) || input.target1r <= 0)
  ) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Hedef 1 (1R) fiyatı 0'dan büyük geçerli bir sayı olmalıdır."
    );
  }
  if (
    input.target2r !== undefined &&
    (!Number.isFinite(input.target2r) || input.target2r <= 0)
  ) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Hedef 2 (2R) fiyatı 0'dan büyük geçerli bir sayı olmalıdır."
    );
  }

  const sign = direction === "LONG" ? 1 : -1;
  const stopDistanceTry =
    direction === "LONG"
      ? input.entryPrice - input.stopPrice
      : input.stopPrice - input.entryPrice;
  const stopDistancePct = (stopDistanceTry / input.entryPrice) * 100;

  const contractNotionalTry = input.entryPrice * BIST_STOCK_FUTURES_MULTIPLIER;
  const initialMarginPerContractTry =
    contractNotionalTry * (marginRatePct / 100);
  const maintenanceMarginPerContractTry =
    initialMarginPerContractTry * maintenanceMarginRatio;
  const intradayWarning75PerContractTry = initialMarginPerContractTry * 0.75;

  const riskPerContractTry = stopDistanceTry * BIST_STOCK_FUTURES_MULTIPLIER;
  const maxRiskBudgetTry = input.capitalTry * (input.riskPct / 100);

  const recommendedContractsByRisk = Math.floor(
    maxRiskBudgetTry / riskPerContractTry
  );
  const maxContractsByMargin = Math.floor(
    input.capitalTry / initialMarginPerContractTry
  );
  const suggestedContracts = Math.min(
    recommendedContractsByRisk,
    maxContractsByMargin
  );
  const marginCapped = recommendedContractsByRisk > maxContractsByMargin;

  const totalPositionTry = suggestedContracts * contractNotionalTry;
  const requiredMarginTry = suggestedContracts * initialMarginPerContractTry;
  const maintenanceMarginTotalTry =
    suggestedContracts * maintenanceMarginPerContractTry;
  const freeMarginBufferTry = input.capitalTry - requiredMarginTry;

  const effectiveLeverage = totalPositionTry / input.capitalTry;
  const leverageWarning: LeverageWarningLevel =
    effectiveLeverage <= 2.5
      ? "SAFE"
      : effectiveLeverage <= 4.0
        ? "MODERATE"
        : "HIGH";

  const resolvedTarget1r =
    input.target1r ?? input.entryPrice + sign * stopDistanceTry;
  const resolvedTarget2r =
    input.target2r ?? input.entryPrice + sign * 2 * stopDistanceTry;

  const estCommissionTry = totalPositionTry * (commissionPct / 100);
  const riskLossTry = suggestedContracts * riskPerContractTry;

  const profit1rTry =
    suggestedContracts > 0
      ? sign *
          (resolvedTarget1r - input.entryPrice) *
          BIST_STOCK_FUTURES_MULTIPLIER *
          suggestedContracts -
        estCommissionTry
      : 0;

  const profit2rTry =
    suggestedContracts > 0
      ? sign *
          (resolvedTarget2r - input.entryPrice) *
          BIST_STOCK_FUTURES_MULTIPLIER *
          suggestedContracts -
        estCommissionTry
      : 0;

  const numericOutputs = [
    stopDistanceTry,
    stopDistancePct,
    contractNotionalTry,
    initialMarginPerContractTry,
    maintenanceMarginPerContractTry,
    intradayWarning75PerContractTry,
    riskPerContractTry,
    maxRiskBudgetTry,
    recommendedContractsByRisk,
    maxContractsByMargin,
    suggestedContracts,
    totalPositionTry,
    requiredMarginTry,
    maintenanceMarginTotalTry,
    freeMarginBufferTry,
    effectiveLeverage,
    riskLossTry,
    profit1rTry,
    profit2rTry,
    estCommissionTry,
    resolvedTarget1r,
    resolvedTarget2r,
  ];
  if (numericOutputs.some((value) => !Number.isFinite(value))) {
    return buildInvalidResult(
      direction,
      contractInfo,
      isStandardViopSymbol,
      "Hesaplanan değerler sayısal taşma (overflow) sınırını aştı; lütfen daha makul fiyat/sermaye değerleri girin."
    );
  }

  return {
    isValid: true,
    validationError: null,
    direction,
    multiplier: BIST_STOCK_FUTURES_MULTIPLIER,
    stopDistanceTry,
    stopDistancePct,
    contractNotionalTry,
    initialMarginPerContractTry,
    maintenanceMarginPerContractTry,
    intradayWarning75PerContractTry,
    riskPerContractTry,
    maxRiskBudgetTry,
    recommendedContractsByRisk,
    maxContractsByMargin,
    suggestedContracts,
    marginCapped,
    totalPositionTry,
    requiredMarginTry,
    maintenanceMarginTotalTry,
    freeMarginBufferTry,
    effectiveLeverage,
    leverageWarning,
    riskLossTry,
    profit1rTry,
    profit2rTry,
    estCommissionTry,
    resolvedTarget1r,
    resolvedTarget2r,
    suggestedContractCode: contractInfo.nearCode,
    nextContractCode: contractInfo.nextCode,
    inRolloverWindow: contractInfo.inRolloverWindow,
    isStandardViopSymbol,
  };
}

export function buildViopOrderSteps(
  plan: ViopPlanResult,
  input: ViopOrderContext
): ViopOrderStep[] {
  if (!plan.isValid) {
    return [
      {
        step: 1,
        title: "Geçersiz İşlem Parametresi",
        detail:
          plan.validationError ??
          "Sermaye, giriş, stop ve risk değerlerini kontrol edip geçerli pozitif değerler girin.",
      },
    ];
  }

  const cleanSym = normalizeSymbol(input.symbol) || "HISSE";
  const isTrap = input.fractalPhaseCode === "TUZAK_15DK_YENI_ZIRVE_BEKLENIR";
  const noReaction = input.hasReaction === false;
  const notTriggered = input.triggered === false;

  if (plan.suggestedContracts === 0) {
    const reason =
      plan.recommendedContractsByRisk === 0
        ? `1 kontrat stop riski (${formatMoney(plan.riskPerContractTry)}) belirlenen risk bütçenizi (${formatMoney(plan.maxRiskBudgetTry)}) aşıyor.`
        : `1 kontrat başlangıç teminatı (${formatMoney(plan.initialMarginPerContractTry)}) toplam sermayenizi aşıyor.`;

    return [
      {
        step: 1,
        title: "0 Kontrat — Emir Gönderme",
        detail: `${reason} Sistem sermaye koruması için zorla 1 kontrata yuvarlama yapmaz.`,
      },
      {
        step: 2,
        title: "İzleme veya Plan Güncelleme",
        detail: `${cleanSym} için stop mesafesini daraltan daha net bir alt periyot teyidi bekleyin veya yalnızca spot izleme ile yetinin.`,
      },
    ];
  }

  const directionAction =
    plan.direction === "LONG" ? "AL (LONG)" : "SAT (SHORT)";

  const step1Detail = [
    `Aracı kurum terminalinde ${plan.suggestedContractCode} yakın vade Pay Vadeli sözleşmesini seçin (1 kontrat = ${plan.multiplier} hisse = ${formatMoney(plan.contractNotionalTry)} pozisyon büyüklüğü).`,
    "Pay Vadeli normal seansı hafta içi 09:30–18:10 arasındadır; akşam seansı yoktur.",
    plan.inRolloverWindow
      ? `Vade sonu yaklaştığı için yeni işlemlerde ${plan.nextContractCode} vadesini tercih edin.`
      : "",
    !plan.isStandardViopSymbol
      ? `${cleanSym} standart 41 BIST Pay Vadeli hissesi listesinde yer almamaktadır; hesaplama 100x standart çarpan ile simüle edilmiştir.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let step2Detail: string;
  if (isTrap) {
    step2Detail =
      "İŞLEM AÇMA — 15dk NU70 tek başına tuzaktır (1S NU70 onayı henüz yok). Öğleden sonra yeni zirve ihtimaline karşı Saatlik (1S) kapanış teyidini bekleyin.";
  } else if (noReaction) {
    step2Detail =
      "İŞLEM AÇMA — RSI 30 altında henüz tepki alımı oluşmadı. Tepkisiz şelale düşüşünde kaldıraçlı LONG açmadan tepki + 2. dip + GVT kırılımını bekleyin.";
  } else if (notTriggered) {
    const levelNote =
      input.gvtOrGkdLevel !== undefined && Number.isFinite(input.gvtOrGkdLevel)
        ? `${formatNumber(input.gvtOrGkdLevel)} ₺ kırılım eşiği `
        : "GVT/GKD onay seviyesi ";
    step2Detail = `İŞLEM AÇMA — Teyit bekle. ${levelNote}mum kapanışıyla kırılmadan kaldıraçlı emir göndermek erken stop riskini artırır.`;
  } else {
    step2Detail = `${formatNumber(input.entryPrice)} ₺ giriş seviyesinin alt periyot mum kapanışıyla onaylandığını ve derinlik/makasın uygun olduğunu doğrulayın.`;
  }

  const step3Detail = `${plan.suggestedContracts} kontrat ${directionAction} limit emri planlayın. Bloke başlangıç teminatı ${formatMoney(plan.requiredMarginTry)}, Takasbank %100 gün sonu sürdürme sınırı ${formatMoney(plan.maintenanceMarginTotalTry)} (%75 gün içi uyarı ${formatMoney(plan.intradayWarning75PerContractTry * plan.suggestedContracts)}), serbest teminat yedeği ${formatMoney(plan.freeMarginBufferTry)}, efektif kaldıraç ${formatNumber(plan.effectiveLeverage, 2)}x (${plan.leverageWarning}).`;

  const step4Detail = `Pozisyon açılır açılmaz ${formatNumber(input.stopPrice)} ₺ seviyesine şartlı iptal stopu (Stop-Loss) tanımlayın. Stop tetiklenirse tahmini brüt kayıp ${formatMoney(plan.riskLossTry)} (komisyon ≈ ${formatMoney(plan.estCommissionTry)}) ile risk bütçesi içinde kalır.`;

  const step5Detail =
    plan.suggestedContracts >= 2
      ? `${formatNumber(plan.resolvedTarget1r)} ₺ (Hedef 1) seviyesinde ${Math.floor(plan.suggestedContracts / 2)} kontratı kapatıp stopu giriş maliyetine çekin; kalan kontratları ${formatNumber(plan.resolvedTarget2r)} ₺ (Hedef 2, tam kapanışta net ≈ ${formatMoney(plan.profit2rTry)}) hedefinde takip edin.`
      : `${formatNumber(plan.resolvedTarget1r)} ₺ (Hedef 1, net ≈ ${formatMoney(plan.profit1rTry)}) bölgesinde kâr almayı veya stopu giriş maliyetine çekerek ${formatNumber(plan.resolvedTarget2r)} ₺ (Hedef 2, net ≈ ${formatMoney(plan.profit2rTry)}) hedefini izlemeyi planlayın.`;

  const step6Detail = `Pay Vadeli sözleşmeler ayın son iş günü fiziki hisse teslimatına gider (LONG nakit, SHORT hisse temerrüt riski). Pozisyon taşınıyorsa son 2–3 iş günü içinde ${plan.suggestedContractCode} kapatılıp ${plan.nextContractCode} vadesine taşınmalıdır; gün sonu uzlaşması son 10 dk AOF üzerinden yapılır ve olası Margin Call T+1 15:00'e kadar kapatılmalıdır.`;

  return [
    { step: 1, title: "Kontrat Seçimi", detail: step1Detail },
    { step: 2, title: "Teyit ve Zamanlama Kontrolü", detail: step2Detail },
    { step: 3, title: "Pozisyon ve Teminat Emri", detail: step3Detail },
    { step: 4, title: "İptal Stopu Tanımlama", detail: step4Detail },
    { step: 5, title: "Kademeli Kâr Al (1R / 2R)", detail: step5Detail },
    { step: 6, title: "Vade Sonu ve Fiziki Teslimat Takibi", detail: step6Detail },
  ];
}
