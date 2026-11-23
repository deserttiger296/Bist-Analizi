const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadViopModule() {
  const filename = path.join(__dirname, "../src/lib/viop.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  }).outputText;

  const mod = { exports: {} };
  const context = {
    exports: mod.exports,
    module: mod,
    Intl,
    Math,
    Number,
    Date,
    Set,
    String,
    Array,
  };
  vm.runInNewContext(output, context, { filename });
  return mod.exports;
}

const viop = loadViopModule();

test("1. Universe and constants match BIST Pay Vadeli specification", () => {
  assert.equal(viop.BIST_STOCK_FUTURES_MULTIPLIER, 100);
  assert.equal(viop.TAKASBANK_MAINTENANCE_MARGIN_RATIO, 1.0);
  assert.equal(viop.BIST_VIOP_SYMBOLS.size, 41);

  for (const ticker of ["THYAO", "VAKBN", "ASELS", "TRALT", "TRMET"]) {
    assert.equal(
      viop.BIST_VIOP_SYMBOLS.has(ticker),
      true,
      `Expected ${ticker} in BIST_VIOP_SYMBOLS`
    );
  }
  for (const excluded of ["KOZAL", "KOZAA", "IPEKE", "CWCME"]) {
    assert.equal(
      viop.BIST_VIOP_SYMBOLS.has(excluded),
      false,
      `Did not expect ${excluded} in BIST_VIOP_SYMBOLS`
    );
  }
});

test("2. LONG contract sizing and net 1R/2R P&L", () => {
  const plan = viop.computeViopPlan({
    symbol: "VAKBN",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 50,
    stopPrice: 48,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: new Date("2026-11-10T12:00:00Z"),
  });

  assert.equal(plan.isValid, true);
  assert.equal(plan.validationError, null);
  assert.equal(plan.stopDistanceTry, 2);
  assert.equal(plan.stopDistancePct, 4);
  assert.equal(plan.contractNotionalTry, 5_000);
  assert.equal(plan.initialMarginPerContractTry, 1_000);
  assert.equal(plan.riskPerContractTry, 200);
  assert.equal(plan.maxRiskBudgetTry, 2_000);
  assert.equal(plan.recommendedContractsByRisk, 10);
  assert.equal(plan.maxContractsByMargin, 100);
  assert.equal(plan.suggestedContracts, 10);
  assert.equal(plan.marginCapped, false);
  assert.equal(plan.totalPositionTry, 50_000);
  assert.equal(plan.requiredMarginTry, 10_000);
  assert.equal(plan.freeMarginBufferTry, 90_000);
  assert.equal(plan.effectiveLeverage, 0.5);
  assert.equal(plan.leverageWarning, "SAFE");
  assert.equal(plan.estCommissionTry, 25);
  assert.equal(plan.riskLossTry, 2_000);
  assert.equal(plan.resolvedTarget1r, 52);
  assert.equal(plan.resolvedTarget2r, 54);
  assert.equal(plan.profit1rTry, 1_975);
  assert.equal(plan.profit2rTry, 3_975);
  assert.equal(plan.isStandardViopSymbol, true);
});

test("3. SHORT contract sizing with explicit targets", () => {
  const plan = viop.computeViopPlan({
    symbol: "THYAO",
    direction: "SHORT",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 310,
    target1r: 290,
    target2r: 280,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: new Date("2026-11-10T12:00:00Z"),
  });

  assert.equal(plan.isValid, true);
  assert.equal(plan.stopDistanceTry, 10);
  assert.equal(plan.recommendedContractsByRisk, 2);
  assert.equal(plan.maxContractsByMargin, 16);
  assert.equal(plan.suggestedContracts, 2);
  assert.equal(plan.marginCapped, false);
  assert.equal(plan.totalPositionTry, 60_000);
  assert.equal(plan.requiredMarginTry, 12_000);
  assert.equal(plan.freeMarginBufferTry, 88_000);
  assert.equal(plan.effectiveLeverage, 0.6);
  assert.equal(plan.leverageWarning, "SAFE");
  assert.equal(plan.estCommissionTry, 30);
  assert.equal(plan.riskLossTry, 2_000);
  assert.equal(plan.profit1rTry, 1_970);
  assert.equal(plan.profit2rTry, 3_970);
});

test("4. Margin cap restricts contracts below risk-based suggestion", () => {
  const plan = viop.computeViopPlan({
    symbol: "THYAO",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 299,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: new Date("2026-11-10T12:00:00Z"),
  });

  assert.equal(plan.isValid, true);
  assert.equal(plan.recommendedContractsByRisk, 20);
  assert.equal(plan.maxContractsByMargin, 16);
  assert.equal(plan.suggestedContracts, 16);
  assert.equal(plan.marginCapped, true);
  assert.equal(plan.totalPositionTry, 480_000);
  assert.equal(plan.effectiveLeverage, 4.8);
  assert.equal(plan.leverageWarning, "HIGH");
});

test("5. Wide stop yields 0 contracts without rounding up to 1", () => {
  const plan = viop.computeViopPlan({
    symbol: "THYAO",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 270,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: new Date("2026-11-10T12:00:00Z"),
  });

  assert.equal(plan.isValid, true);
  assert.equal(plan.recommendedContractsByRisk, 0);
  assert.equal(plan.suggestedContracts, 0);
  assert.equal(plan.marginCapped, false);
  assert.equal(plan.totalPositionTry, 0);
  assert.equal(plan.requiredMarginTry, 0);
  assert.equal(plan.freeMarginBufferTry, 100_000);
  assert.equal(plan.effectiveLeverage, 0);
  assert.equal(plan.leverageWarning, "SAFE");
  assert.equal(plan.estCommissionTry, 0);
  assert.equal(plan.riskLossTry, 0);
  assert.equal(plan.profit1rTry, 0);
  assert.equal(plan.profit2rTry, 0);
});

test("6. Leverage thresholds enforce exact SAFE / MODERATE / HIGH boundaries", () => {
  const safe25 = viop.computeViopPlan({
    symbol: "AKBNK",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 5,
    entryPrice: 50,
    stopPrice: 49,
    marginRatePct: 10,
  });
  assert.equal(safe25.effectiveLeverage, 2.5);
  assert.equal(safe25.leverageWarning, "SAFE");

  const mod26 = viop.computeViopPlan({
    symbol: "AKBNK",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 10,
    entryPrice: 26,
    stopPrice: 25,
    marginRatePct: 5,
  });
  assert.equal(mod26.suggestedContracts, 100);
  assert.equal(mod26.effectiveLeverage, 2.6);
  assert.equal(mod26.leverageWarning, "MODERATE");

  const mod40 = viop.computeViopPlan({
    symbol: "AKBNK",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 10,
    entryPrice: 40,
    stopPrice: 39,
    marginRatePct: 10,
  });
  assert.equal(mod40.suggestedContracts, 100);
  assert.equal(mod40.effectiveLeverage, 4.0);
  assert.equal(mod40.leverageWarning, "MODERATE");

  const high41 = viop.computeViopPlan({
    symbol: "AKBNK",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 10,
    entryPrice: 41,
    stopPrice: 40,
    marginRatePct: 10,
  });
  assert.equal(high41.suggestedContracts, 100);
  assert.equal(high41.effectiveLeverage, 4.1);
  assert.equal(high41.leverageWarning, "HIGH");
});

test("7. Maintenance margin ratio defaults to Takasbank 1.0 and supports 0.75 override", () => {
  const defaultPlan = viop.computeViopPlan({
    symbol: "GARAN",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 100,
    stopPrice: 98,
    marginRatePct: 20,
  });
  assert.equal(
    defaultPlan.maintenanceMarginPerContractTry,
    defaultPlan.initialMarginPerContractTry
  );
  assert.equal(
    defaultPlan.intradayWarning75PerContractTry,
    defaultPlan.initialMarginPerContractTry * 0.75
  );
  assert.equal(defaultPlan.maintenanceMarginTotalTry, defaultPlan.requiredMarginTry);

  const classicalPlan = viop.computeViopPlan({
    symbol: "GARAN",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 100,
    stopPrice: 98,
    marginRatePct: 20,
    maintenanceMarginRatio: 0.75,
  });
  assert.equal(
    classicalPlan.maintenanceMarginPerContractTry,
    classicalPlan.initialMarginPerContractTry * 0.75
  );
  assert.equal(
    classicalPlan.maintenanceMarginTotalTry,
    classicalPlan.requiredMarginTry * 0.75
  );
});

test("8. Invalid, zero, NaN, Infinity, and directional stop inputs are rejected cleanly", () => {
  const base = {
    symbol: "THYAO",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 100,
    stopPrice: 95,
    marginRatePct: 20,
    commissionPct: 0.05,
  };

  const invalidCases = [
    { ...base, capitalTry: 0 },
    { ...base, capitalTry: -500 },
    { ...base, capitalTry: Number.NaN },
    { ...base, capitalTry: Number.POSITIVE_INFINITY },
    { ...base, entryPrice: 0 },
    { ...base, entryPrice: Number.NaN },
    { ...base, stopPrice: 0 },
    { ...base, stopPrice: Number.POSITIVE_INFINITY },
    { ...base, riskPct: 0 },
    { ...base, riskPct: 101 },
    { ...base, riskPct: Number.NaN },
    { ...base, marginRatePct: 0 },
    { ...base, marginRatePct: 105 },
    { ...base, marginRatePct: Number.NaN },
    { ...base, commissionPct: -0.1 },
    { ...base, commissionPct: Number.NaN },
    { ...base, maintenanceMarginRatio: 0 },
    { ...base, maintenanceMarginRatio: Number.NaN },
    { ...base, direction: "LONG", stopPrice: 100 },
    { ...base, direction: "LONG", stopPrice: 105 },
    { ...base, direction: "SHORT", stopPrice: 100 },
    { ...base, direction: "SHORT", stopPrice: 95 },
    { ...base, target1r: Number.NaN },
    { ...base, target2r: -10 },
  ];

  for (const input of invalidCases) {
    const res = viop.computeViopPlan(input);
    assert.equal(res.isValid, false);
    assert.equal(res.suggestedContracts, 0);
    assert.ok(typeof res.validationError === "string" && res.validationError.length > 0);
    for (const [k, v] of Object.entries(res)) {
      if (typeof v === "number") {
        assert.equal(Number.isFinite(v), true, `Field ${k} leaked non-finite value: ${v}`);
      }
    }
  }
});

test("9. Near-month contract code and Istanbul rollover calendar", () => {
  const midNov = viop.formatViopContractCode("thyao.is", new Date("2026-11-23T12:00:00Z"));
  assert.equal(midNov.nearCode, "F_THYAO1126");
  assert.equal(midNov.nextCode, "F_THYAO1226");
  assert.equal(midNov.inRolloverWindow, false);

  const nonRolloverNov25 = viop.formatViopContractCode("THYAO", new Date("2026-11-25T10:00:00Z"));
  assert.equal(nonRolloverNov25.inRolloverWindow, false);

  const rolloverNov26 = viop.formatViopContractCode("THYAO", new Date("2026-11-26T10:00:00Z"));
  assert.equal(rolloverNov26.inRolloverWindow, true);

  const rolloverNov30 = viop.formatViopContractCode("THYAO", new Date("2026-11-30T10:00:00Z"));
  assert.equal(rolloverNov30.inRolloverWindow, true);

  // Dec -> Jan year rollover (2026-12-30)
  const decRollover = viop.formatViopContractCode("ASELS", new Date("2026-12-30T12:00:00Z"));
  assert.equal(decRollover.nearCode, "F_ASELS1226");
  assert.equal(decRollover.nextCode, "F_ASELS0127");
  assert.equal(decRollover.inRolloverWindow, true);

  // Istanbul UTC+3 midnight boundary: 2026-11-30T21:30:00Z === 2026-12-01 00:30 TRT
  const istanbulMidnight = viop.formatViopContractCode(
    "VAKBN",
    new Date("2026-11-30T21:30:00Z")
  );
  assert.equal(istanbulMidnight.nearCode, "F_VAKBN1226");
  assert.equal(istanbulMidnight.nextCode, "F_VAKBN0127");
  assert.equal(istanbulMidnight.inRolloverWindow, false);

  // Empty & non-VIOP symbol handling
  const emptyCode = viop.formatViopContractCode("", new Date("2026-11-10T12:00:00Z"));
  assert.equal(emptyCode.nearCode, "F_HISSE1126");

  const nonViopPlan = viop.computeViopPlan({
    symbol: "SMRVA",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 50,
    stopPrice: 48,
    referenceDate: new Date("2026-11-10T12:00:00Z"),
  });
  assert.equal(nonViopPlan.isValid, true);
  assert.equal(nonViopPlan.isStandardViopSymbol, false);
  assert.equal(nonViopPlan.suggestedContractCode, "F_SMRVA1126");
});

test("10. buildViopOrderSteps produces structured Turkish steps across scenarios", () => {
  const normalInput = {
    symbol: "THYAO",
    direction: "SHORT",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 310,
    triggered: true,
    referenceDate: new Date("2026-11-27T10:00:00Z"),
  };
  const normalPlan = viop.computeViopPlan(normalInput);
  const rolloverSteps = viop.buildViopOrderSteps(normalPlan, normalInput);
  assert.equal(rolloverSteps.length, 6);
  assert.equal(rolloverSteps[0].step, 1);
  assert.match(rolloverSteps[0].detail, /F_THYAO1226/);
  assert.match(rolloverSteps[2].detail, /SAT \(SHORT\)/);

  const trapSteps = viop.buildViopOrderSteps(normalPlan, {
    ...normalInput,
    triggered: false,
    fractalPhaseCode: "TUZAK_15DK_YENI_ZIRVE_BEKLENIR",
  });
  assert.match(trapSteps[1].detail, /İŞLEM AÇMA/);
  assert.match(trapSteps[1].detail, /15dk NU70/);

  const widePlan = viop.computeViopPlan({
    symbol: "THYAO",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 270,
  });
  const wideSteps = viop.buildViopOrderSteps(widePlan, {
    symbol: "THYAO",
    direction: "LONG",
    entryPrice: 300,
    stopPrice: 270,
  });
  assert.equal(wideSteps.length, 2);
  assert.match(wideSteps[0].title, /0 Kontrat/);

  const invalidPlan = viop.computeViopPlan({
    symbol: "THYAO",
    direction: "LONG",
    capitalTry: 100_000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 310,
  });
  const invalidSteps = viop.buildViopOrderSteps(invalidPlan, {
    symbol: "THYAO",
    direction: "LONG",
    entryPrice: 300,
    stopPrice: 310,
  });
  assert.equal(invalidSteps.length, 1);
  assert.match(invalidSteps[0].detail, /LONG işlemde stop fiyatı/);
});

test("11. Extreme IEEE-754 float inputs reject overflow cleanly without NaN or Infinity", () => {
  const extremeCases = [
    {
      symbol: "THYAO",
      direction: "LONG",
      capitalTry: 1e307,
      riskPct: 2,
      entryPrice: 1e307,
      stopPrice: 0.9e307,
      marginRatePct: 20,
      commissionPct: 0.05,
    },
    {
      symbol: "THYAO",
      direction: "LONG",
      capitalTry: 1e10,
      riskPct: 100,
      entryPrice: 1e-305,
      stopPrice: 0.5e-305,
      marginRatePct: 20,
      commissionPct: 0.05,
    },
    {
      symbol: "THYAO",
      direction: "LONG",
      capitalTry: 100_000,
      riskPct: 2,
      entryPrice: 100,
      stopPrice: 95,
      target1r: 1e307,
      marginRatePct: 20,
      commissionPct: 0.05,
    },
  ];

  for (const input of extremeCases) {
    const res = viop.computeViopPlan(input);
    assert.equal(res.isValid, false);
    assert.equal(res.suggestedContracts, 0);
    assert.ok(typeof res.validationError === "string" && res.validationError.length > 0);
    for (const [k, v] of Object.entries(res)) {
      if (typeof v === "number") {
        assert.equal(Number.isFinite(v), true, `Field ${k} leaked non-finite value: ${v}`);
        if (k !== "multiplier") {
          assert.equal(v, 0, `Expected invalid output field ${k} to be 0, got ${v}`);
        }
      }
    }
  }
});
