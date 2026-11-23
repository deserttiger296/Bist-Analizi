'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.resolve(__dirname, '..');

const BLOCKED_MODULES = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'child_process',
  'node:child_process',
  'http',
  'node:http',
  'https',
  'node:https',
  'net',
  'node:net',
  'dgram',
  'node:dgram',
  'vm',
  'node:vm',
]);

const ALLOWED_PACKAGES = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/server',
  'lucide-react',
  'next/link',
]);

const PREEXISTING_NAV_GROUPS = new Set(['ANALİZ', 'ARAŞTIRMA VE TEST', 'ARAÇLAR']);

function normalizePathKey(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function readVirtualOrDisk(filePath, virtualFiles) {
  const resolved = path.resolve(filePath);
  if (virtualFiles) {
    const norm = normalizePathKey(resolved);
    for (const [k, v] of Object.entries(virtualFiles)) {
      if (normalizePathKey(k) === norm) {
        return v;
      }
    }
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return fs.readFileSync(resolved, 'utf8');
  }
  return null;
}

function resolveModuleFile(baseTarget, virtualFiles) {
  const candidates = [
    baseTarget,
    `${baseTarget}.ts`,
    `${baseTarget}.tsx`,
    `${baseTarget}.js`,
    `${baseTarget}.jsx`,
    `${baseTarget}.json`,
    path.join(baseTarget, 'index.ts'),
    path.join(baseTarget, 'index.tsx'),
    path.join(baseTarget, 'index.js'),
  ];
  for (const candidate of candidates) {
    const content = readVirtualOrDisk(candidate, virtualFiles);
    if (content !== null) {
      return { resolvedPath: path.resolve(candidate), content };
    }
  }
  return null;
}

function createNextNavigationStub() {
  return {
    usePathname: () => '/viop-rehber',
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
      prefetch: async () => {},
    }),
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
    redirect: (url) => {
      throw new Error(`Unexpected redirect in SSR test: ${url}`);
    },
    notFound: () => {
      throw new Error('Unexpected notFound in SSR test');
    },
  };
}

/**
 * Offline CommonJS/VM loader for TypeScript & React TSX modules using `@/*` path mapping.
 * Blocks fs/child_process/http/net inside loaded modules to guarantee zero side effects.
 */
function loadTsModule(entryFilePath, opts = {}) {
  const rootDir = path.resolve(opts.rootDir || ROOT);
  const virtualFiles = opts.virtualFiles || null;
  const cache = opts.cache || new Map();

  function loadInternal(targetPath) {
    const resolvedInfo = resolveModuleFile(targetPath, virtualFiles);
    if (!resolvedInfo) {
      throw new Error(`Module not found: ${targetPath}`);
    }
    const { resolvedPath, content } = resolvedInfo;
    const cacheKey = normalizePathKey(resolvedPath);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey).exports;
    }

    if (resolvedPath.endsWith('.json')) {
      const parsed = JSON.parse(content);
      cache.set(cacheKey, { exports: parsed });
      return parsed;
    }

    const transpiled = ts.transpileModule(content, {
      fileName: resolvedPath,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        allowJs: true,
        resolveJsonModule: true,
      },
    });

    if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
      const errors = transpiled.diagnostics.filter(
        (d) => d.category === ts.DiagnosticCategory.Error
      );
      if (errors.length > 0) {
        const msg = errors
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
          .join('; ');
        throw new Error(`TypeScript transpile error in ${resolvedPath}: ${msg}`);
      }
    }

    const mod = { exports: {} };
    cache.set(cacheKey, mod);

    const localDir = path.dirname(resolvedPath);
    function customRequire(specifier) {
      if (BLOCKED_MODULES.has(specifier)) {
        throw new Error(
          `Security/offline violation: module "${resolvedPath}" attempted to require blocked module "${specifier}"`
        );
      }
      if (/\.css$|\.scss$|\.sass$|\.less$/i.test(specifier)) {
        return {};
      }
      if (specifier === 'next/navigation') {
        return createNextNavigationStub();
      }
      if (ALLOWED_PACKAGES.has(specifier)) {
        return require(specifier);
      }
      if (specifier.startsWith('@/')) {
        const sub = specifier.slice(2);
        return loadInternal(path.join(rootDir, 'src', sub));
      }
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return loadInternal(path.resolve(localDir, specifier));
      }
      throw new Error(
        `Disallowed external require "${specifier}" from "${resolvedPath}"`
      );
    }

    const sandbox = {
      require: customRequire,
      module: mod,
      exports: mod.exports,
      __filename: resolvedPath,
      __dirname: localDir,
      console,
      URLSearchParams,
      URL,
      Intl,
      Date,
      Math,
      JSON,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Set,
      Map,
      RegExp,
      Error,
      TypeError,
      Promise,
      setTimeout,
      clearTimeout,
      process: { env: { NODE_ENV: 'test' } },
    };

    try {
      vm.runInNewContext(transpiled.outputText, sandbox, {
        filename: resolvedPath,
      });
    } catch (err) {
      cache.delete(cacheKey);
      throw err;
    }

    return mod.exports;
  }

  return loadInternal(path.resolve(entryFilePath));
}

function parseExpectedViopSymbols(pythonSource) {
  const match = pythonSource.match(/VIOP_SYMBOLS(?:\s*:\s*[^=]+)?\s*=\s*\{([\s\S]*?)\}/);
  assert.ok(match, 'Could not locate VIOP_SYMBOLS set in long_short_matrix.py');
  const symbols = new Set();
  for (const [, sym] of match[1].matchAll(/["']([A-Z0-9]+)["']/g)) {
    symbols.add(sym);
  }
  assert.equal(
    symbols.size,
    41,
    `Expected 41 tickers in long_short_matrix.py VIOP_SYMBOLS, got ${symbols.size}`
  );
  return symbols;
}

function assertApprox(actual, expected, tol = 0.02, label = 'value') {
  assert.ok(
    typeof actual === 'number' && Number.isFinite(actual),
    `${label}: expected finite number, got ${actual}`
  );
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected} ± ${tol}, got ${actual}`
  );
}

function verifyReferenceSpec(specText) {
  assert.equal(typeof specText, 'string', 'Spec must be a string');
  assert.ok(specText.trim().length > 400, 'docs/viop_reference_spec.md is unexpectedly short');

  const lower = specText.toLocaleLowerCase('tr-TR');

  // R1: 100x multiplier
  assert.match(specText, /\b100\b/, 'Spec must state 100-share Pay Vadeli multiplier');
  assert.ok(
    /100\s*(adet|pay|hisse)/i.test(specText) || /çarpan[^\n]*100/i.test(specText),
    'Spec must tie 100 multiplier to Pay Vadeli shares'
  );

  // C2: Initial & maintenance margin (both 100% Takasbank EOD AND 75% intraday alert/textbook)
  assert.ok(
    /(%\s*100\b|\b100\s*%)/.test(specText) && /(sürdürme|maintenance|takasbank)/i.test(specText),
    'Spec must document Takasbank 100% maintenance margin rule'
  );
  assert.ok(
    /(%\s*75\b|\b75\s*%)/.test(specText),
    'Spec must document 75% intraday early-alert / classical textbook maintenance margin ratio'
  );

  // R1: Daily mark-to-market last-10-min VWAP & T+1 15:00 margin call
  assert.ok(
    /(vwap|ağ[ıi]rl[ıi]kl[ıi] ortalama|aof)/i.test(specText) && /(10\s*dakika|son\s*10)/i.test(specText),
    'Spec must document daily mark-to-market using last-10-minute VWAP'
  );
  assert.ok(
    /t\+1/i.test(specText) && /15[:.]00/.test(specText),
    'Spec must document T+1 15:00 margin call deadline'
  );

  // R1: Near-month code, rollover 2-3 business days, physical settlement
  assert.ok(
    /F_[A-Z<].*MMYY|F_<.*>MMYY|F_THYAO/i.test(specText),
    'Spec must document F_<SYMBOL>MMYY contract code convention'
  );
  assert.ok(
    /(2\s*[-–]\s*3|2\s*ila\s*3|son\s*2|son\s*3)/i.test(specText) &&
      /(rollover|vade\s*(ta[şs][ıi]ma|ge[çc]i[şs]))/i.test(specText),
    'Spec must document 2-3 business days rollover rule'
  );
  assert.ok(
    /fiziki\s*teslimat/i.test(specText),
    'Spec must document physical settlement (fiziki teslimat)'
  );

  // R1 + T2-F01-4: 09:30-18:10 and NO evening session for Pay Vadeli
  assert.ok(
    /09[:.]30/.test(specText) && /18[:.]10/.test(specText),
    'Spec must document 09:30–18:10 Pay Vadeli trading hours'
  );
  assert.ok(
    /ak[şs]am\s*seans[ıi]/i.test(specText) &&
      /(yok|kapal[ıi]|hari[çc]|yap[ıi]lmaz|dahil\s*de[ğg]il|bulunmamaktad[ıi]r)/i.test(lower),
    'Spec must explicitly note Pay Vadeli is closed in the evening session (19:00-23:00)'
  );

  // R1: 0.05% round-trip commission + fee structure + stop-risk sizing
  assert.ok(
    /0[.,]05\s*%|%\s*0[.,]05/.test(specText),
    'Spec must document 0.05% default round-trip commission'
  );
  assert.ok(
    /(bsmv|borsa\s*pay[ıi]|komisyon)/i.test(specText),
    'Spec must document fee components (brokerage/Borsa Payı/BSMV)'
  );
  assert.ok(
    /(stop|risk\s*b[üu]t[çc]esi)/i.test(specText) && /(floor|a[şs]a[ğg][ıi]\s*yuvarla)/i.test(lower),
    'Spec must document stop-risk-first contract sizing with floor rounding'
  );

  // C3 + T2-F01-5: Leverage bands 2.5x / 4.0x and NO stale 3x/5x table
  assert.ok(
    /2[.,]5\s*x?/i.test(specText) && /4[.,]0\s*x?/i.test(specText),
    'Spec must document 2.5x and 4.0x leverage band thresholds'
  );
  assert.ok(
    /SAFE/i.test(specText) && /MODERATE/i.test(specText) && /HIGH/i.test(specText),
    'Spec must document SAFE / MODERATE / HIGH leverage bands'
  );
  assert.doesNotMatch(
    specText,
    /(?:MODERATE|ORTA)[^\n\r]{0,12}(?:<=|≤|<|:|\|)\s*3(?:[.,]0)?x|(?:HIGH|Y[ÜU]KSEK)[^\n\r]{0,12}(?:>=|≥|>|:|\|)\s*5(?:[.,]0)?x/i,
    'Spec must not contain stale >3x / >5x leverage thresholds conflicting with R3 (<=2.5x / <=4.0x / >4.0x)'
  );

  // SPK disclaimer + T2-F01-1..3 corporate actions, holiday, illiquid fallback
  assert.ok(/SPK/i.test(specText), 'Spec must include SPK risk disclaimer');
  assert.ok(
    /(bedelli|bedelsiz|temett[üu]|sermaye)/i.test(lower),
    'Spec must note corporate action adjustments to 100x multiplier (T2-F01-1)'
  );
  assert.ok(
    /(yar[ıi]m\s*g[üu]n|resmi\s*tatil|tatil)/i.test(lower),
    'Spec must note half-day/holiday expiry adjustments (T2-F01-2)'
  );
  assert.ok(
    /(likidite|i[şs]lem\s*olmamas[ıi]|yetersiz\s*i[şs]lem|[öo]nceki\s*uzla[şs]ma|en\s*az\s*10\s*i[şs]lem|sıfır\s*hacim|hacimsiz)/i.test(
      lower
    ),
    'Spec must note illiquid / zero-volume EOD settlement fallback (T2-F01-3)'
  );
}

function verifyViopMathEngine(viopExports, expectedSymbols) {
  assert.equal(
    viopExports.BIST_STOCK_FUTURES_MULTIPLIER,
    100,
    'BIST_STOCK_FUTURES_MULTIPLIER must be 100'
  );
  assert.equal(typeof viopExports.computeViopPlan, 'function', 'computeViopPlan must be a function');
  assert.equal(
    typeof viopExports.formatViopContractCode,
    'function',
    'formatViopContractCode must be a function'
  );

  if (viopExports.TAKASBANK_MAINTENANCE_MARGIN_RATIO !== undefined) {
    assert.equal(
      viopExports.TAKASBANK_MAINTENANCE_MARGIN_RATIO,
      1.0,
      'TAKASBANK_MAINTENANCE_MARGIN_RATIO must be 1.0'
    );
  }

  // Exact 41-ticker parity check
  const actualSet =
    viopExports.BIST_VIOP_SYMBOLS instanceof Set
      ? viopExports.BIST_VIOP_SYMBOLS
      : new Set(viopExports.BIST_VIOP_SYMBOLS || []);
  assert.equal(
    actualSet.size,
    expectedSymbols.size,
    `BIST_VIOP_SYMBOLS size mismatch: expected ${expectedSymbols.size}, got ${actualSet.size}`
  );
  for (const sym of expectedSymbols) {
    assert.ok(actualSet.has(sym), `BIST_VIOP_SYMBOLS missing ticker ${sym}`);
  }
  for (const excluded of ['ENERY', 'TRGYO', 'AKSEN']) {
    assert.ok(!actualSet.has(excluded), `BIST_VIOP_SYMBOLS must NOT include non-VIOP ${excluded}`);
  }

  // T1-F02-1: Standard SHORT (THYAO)
  const refNov = new Date('2026-11-10T10:00:00Z');
  const shortPlan = viopExports.computeViopPlan({
    symbol: 'THYAO',
    direction: 'SHORT',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 325.75,
    stopPrice: 340.04,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: refNov,
  });
  assert.equal(shortPlan.isValid, true);
  assert.equal(shortPlan.validationError, null);
  assert.equal(shortPlan.direction, 'SHORT');
  assert.equal(shortPlan.multiplier, 100);
  assertApprox(shortPlan.stopDistanceTry, 14.29, 0.01, 'short stopDistanceTry');
  assertApprox(shortPlan.riskPerContractTry, 1429, 0.5, 'short riskPerContractTry');
  assert.equal(shortPlan.recommendedContractsByRisk, 1);
  assert.equal(shortPlan.suggestedContracts, 1);
  assert.equal(shortPlan.marginCapped, false);
  assertApprox(shortPlan.requiredMarginTry, 6515, 0.5, 'short requiredMarginTry');
  assertApprox(shortPlan.maintenanceMarginPerContractTry, shortPlan.initialMarginPerContractTry, 0.01, 'default 1.0 maintenance');
  assertApprox(shortPlan.intradayWarning75PerContractTry, shortPlan.initialMarginPerContractTry * 0.75, 0.01, 'intraday 75% warning');
  assertApprox(shortPlan.effectiveLeverage, 0.32575, 0.005, 'short effectiveLeverage');
  assert.equal(shortPlan.leverageWarning, 'SAFE');
  const shortExpectedComm = 325.75 * 100 * 1 * 0.0005;
  assertApprox(shortPlan.estCommissionTry, shortExpectedComm, 0.05, 'short estCommissionTry');
  assertApprox(shortPlan.profit1rTry, 1429 - shortPlan.estCommissionTry, 0.1, 'short profit1rTry net');
  assertApprox(shortPlan.profit2rTry, 2858 - shortPlan.estCommissionTry, 0.1, 'short profit2rTry net');
  assert.ok(
    shortPlan.riskLossTry >= 1429 - 0.01 &&
      shortPlan.riskLossTry <= 1429 + shortPlan.estCommissionTry + 0.01,
    `C7: riskLossTry ${shortPlan.riskLossTry} outside [gross 1429, gross + comm]`
  );
  assert.equal(shortPlan.suggestedContractCode, 'F_THYAO1126');
  assert.equal(shortPlan.nextContractCode, 'F_THYAO1226');
  assert.equal(shortPlan.inRolloverWindow, false);
  assert.equal(shortPlan.isStandardViopSymbol, true);

  // T1-F02-2: Standard LONG (VAKBN)
  const longPlan = viopExports.computeViopPlan({
    symbol: 'VAKBN',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 25.0,
    stopPrice: 24.0,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: refNov,
  });
  assert.equal(longPlan.isValid, true);
  assert.equal(longPlan.riskPerContractTry, 100);
  assert.equal(longPlan.recommendedContractsByRisk, 20);
  assert.equal(longPlan.maxContractsByMargin, 200);
  assert.equal(longPlan.suggestedContracts, 20);
  assert.equal(longPlan.marginCapped, false);
  assertApprox(longPlan.totalPositionTry, 50000, 0.01, 'long totalPositionTry');
  assertApprox(longPlan.effectiveLeverage, 0.5, 0.001, 'long effectiveLeverage');
  assert.equal(longPlan.leverageWarning, 'SAFE');
  assertApprox(longPlan.resolvedTarget1r, 26.0, 0.01, 'long resolvedTarget1r');
  assertApprox(longPlan.resolvedTarget2r, 27.0, 0.01, 'long resolvedTarget2r');
  assertApprox(longPlan.profit1rTry, 2000 - longPlan.estCommissionTry, 0.05, 'long profit1rTry net');
  assertApprox(longPlan.profit2rTry, 4000 - longPlan.estCommissionTry, 0.05, 'long profit2rTry net');

  // T1-F02-4: Custom Fib targets & commission wipeout check (T2-F03-5)
  const customTargetPlan = viopExports.computeViopPlan({
    symbol: 'THYAO',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 100,
    stopPrice: 98,
    target1r: 100.01, // 10 * 100 * 0.01 = 10 TRY gross vs ~50 TRY comm => net < 0
    target2r: 110,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: refNov,
  });
  assert.equal(customTargetPlan.isValid, true);
  assertApprox(customTargetPlan.resolvedTarget1r, 100.01, 0.001);
  assertApprox(customTargetPlan.resolvedTarget2r, 110, 0.001);
  assert.ok(
    customTargetPlan.profit1rTry < 0,
    `Commission wipeout should yield negative profit1rTry, got ${customTargetPlan.profit1rTry}`
  );
  assertApprox(
    customTargetPlan.profit2rTry,
    10 * 100 * 10 - customTargetPlan.estCommissionTry,
    0.05
  );

  // C2: Maintenance margin 0.75 override
  const maint75 = viopExports.computeViopPlan({
    symbol: 'THYAO',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 100,
    stopPrice: 98,
    marginRatePct: 20,
    commissionPct: 0.05,
    maintenanceMarginRatio: 0.75,
    referenceDate: refNov,
  });
  assertApprox(
    maint75.maintenanceMarginPerContractTry,
    maint75.initialMarginPerContractTry * 0.75,
    0.01,
    'maintenanceMarginRatio=0.75 per contract'
  );
  assertApprox(
    maint75.maintenanceMarginTotalTry,
    maint75.requiredMarginTry * 0.75,
    0.05,
    'maintenanceMarginRatio=0.75 total'
  );

  // T2-F02-3: Margin cap binding
  const capped = viopExports.computeViopPlan({
    symbol: 'THYAO',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 299,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: refNov,
  });
  assert.equal(capped.isValid, true);
  assert.equal(capped.recommendedContractsByRisk, 20);
  assert.equal(capped.maxContractsByMargin, 16);
  assert.equal(capped.suggestedContracts, 16);
  assert.equal(capped.marginCapped, true);
  assertApprox(capped.effectiveLeverage, 4.8, 0.01);
  assert.equal(capped.leverageWarning, 'HIGH');

  // T2-F02-4: Sub-1 contract wide stop
  const subOne = viopExports.computeViopPlan({
    symbol: 'THYAO',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 300,
    stopPrice: 270,
    marginRatePct: 20,
    commissionPct: 0.05,
    referenceDate: refNov,
  });
  assert.equal(subOne.isValid, true);
  assert.equal(subOne.recommendedContractsByRisk, 0);
  assert.equal(subOne.suggestedContracts, 0);
  assert.equal(subOne.effectiveLeverage, 0);
  assert.equal(subOne.leverageWarning, 'SAFE');

  // C3: Exact leverage boundaries (2.50 -> SAFE, 2.75 -> MODERATE, 4.00 -> MODERATE, 4.25 -> HIGH)
  const boundaryCases = [
    { riskPct: 2.5, expectedLev: 2.5, expectedWarn: 'SAFE' },
    { riskPct: 2.75, expectedLev: 2.75, expectedWarn: 'MODERATE' },
    { riskPct: 4.0, expectedLev: 4.0, expectedWarn: 'MODERATE' },
    { riskPct: 4.25, expectedLev: 4.25, expectedWarn: 'HIGH' },
  ];
  for (const bc of boundaryCases) {
    const res = viopExports.computeViopPlan({
      symbol: 'ASELS',
      direction: 'LONG',
      capitalTry: 40000,
      riskPct: bc.riskPct,
      entryPrice: 100,
      stopPrice: 99,
      marginRatePct: 10,
      commissionPct: 0.05,
      referenceDate: refNov,
    });
    assert.equal(res.isValid, true);
    assertApprox(res.effectiveLeverage, bc.expectedLev, 0.001, `boundary ${bc.expectedLev}x`);
    assert.equal(
      res.leverageWarning,
      bc.expectedWarn,
      `leverage ${bc.expectedLev}x must be ${bc.expectedWarn}, got ${res.leverageWarning}`
    );
  }

  // T2-F02-1: NaN, Infinity, 0, negative, >100 riskPct guards
  const invalidInputs = [
    { capitalTry: NaN, riskPct: 2, entryPrice: 100, stopPrice: 95 },
    { capitalTry: Infinity, riskPct: 2, entryPrice: 100, stopPrice: 95 },
    { capitalTry: 0, riskPct: 2, entryPrice: 100, stopPrice: 95 },
    { capitalTry: -50000, riskPct: 2, entryPrice: 100, stopPrice: 95 },
    { capitalTry: 100000, riskPct: 0, entryPrice: 100, stopPrice: 95 },
    { capitalTry: 100000, riskPct: 101, entryPrice: 100, stopPrice: 95 },
    { capitalTry: 100000, riskPct: 2, entryPrice: 0, stopPrice: 95 },
    { capitalTry: 100000, riskPct: 2, entryPrice: 100, stopPrice: -5 },
    { capitalTry: 100000, riskPct: 2, entryPrice: 100, stopPrice: 95, marginRatePct: 0 },
    { capitalTry: 100000, riskPct: 2, entryPrice: 100, stopPrice: 95, marginRatePct: 150 },
    { capitalTry: 100000, riskPct: 2, entryPrice: 100, stopPrice: 95, commissionPct: -0.1 },
  ];
  for (const inv of invalidInputs) {
    const bad = viopExports.computeViopPlan({
      symbol: 'THYAO',
      direction: 'LONG',
      ...inv,
    });
    assert.equal(bad.isValid, false, `Expected invalid for ${JSON.stringify(inv)}`);
    assert.equal(bad.suggestedContracts, 0);
    assert.ok(
      typeof bad.validationError === 'string' && bad.validationError.trim().length > 0,
      'Invalid result must provide Turkish validationError'
    );
    assert.ok(Number.isFinite(bad.requiredMarginTry) && bad.requiredMarginTry === 0);
    assert.ok(Number.isFinite(bad.profit1rTry) && bad.profit1rTry === 0);
    assert.ok(Number.isFinite(bad.effectiveLeverage) && bad.effectiveLeverage === 0);
  }

  // T2-F02-2: Wrong-side stops
  const wrongStops = [
    { direction: 'LONG', entryPrice: 300, stopPrice: 300 },
    { direction: 'LONG', entryPrice: 300, stopPrice: 305 },
    { direction: 'SHORT', entryPrice: 300, stopPrice: 300 },
    { direction: 'SHORT', entryPrice: 300, stopPrice: 295 },
  ];
  for (const ws of wrongStops) {
    const bad = viopExports.computeViopPlan({
      symbol: 'THYAO',
      capitalTry: 100000,
      riskPct: 2,
      ...ws,
    });
    assert.equal(bad.isValid, false, `Expected wrong-side stop invalid for ${JSON.stringify(ws)}`);
    assert.equal(bad.suggestedContracts, 0);
    assert.ok(typeof bad.validationError === 'string' && bad.validationError.length > 0);
  }

  // T1-F02-5 & T2-F02-5 & T2-F03-2/3: Contract codes, Dec->Jan rollover, .IS, empty, non-VIOP
  const novCode = viopExports.formatViopContractCode('THYAO.IS', new Date('2026-11-10T10:00:00Z'));
  assert.equal(novCode.nearCode, 'F_THYAO1126');
  assert.equal(novCode.nextCode, 'F_THYAO1226');
  assert.equal(novCode.inRolloverWindow, false);

  const decRoll = viopExports.formatViopContractCode('THYAO', new Date('2026-12-30T10:00:00Z'));
  assert.equal(decRoll.nearCode, 'F_THYAO1226');
  assert.equal(decRoll.nextCode, 'F_THYAO0127');
  assert.equal(decRoll.inRolloverWindow, true);

  const lowerIs = viopExports.computeViopPlan({
    symbol: 'akbnk.is',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 60,
    stopPrice: 58,
    referenceDate: refNov,
  });
  assert.equal(lowerIs.isStandardViopSymbol, true);
  assert.equal(lowerIs.suggestedContractCode, 'F_AKBNK1126');

  const nonViop = viopExports.computeViopPlan({
    symbol: 'ENERY',
    direction: 'LONG',
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: 20,
    stopPrice: 19,
    referenceDate: refNov,
  });
  assert.equal(nonViop.isStandardViopSymbol, false);

  const emptyCode = viopExports.formatViopContractCode('   ', refNov);
  assert.ok(
    typeof emptyCode.nearCode === 'string' && /^F_[A-Z0-9]+1126$/.test(emptyCode.nearCode),
    `Empty symbol fallback must produce valid F_<TOKEN>1126 code, got ${emptyCode.nearCode}`
  );

  if (typeof viopExports.buildViopOrderSteps === 'function') {
    const shortInput = {
      symbol: 'THYAO',
      direction: 'SHORT',
      capitalTry: 100000,
      riskPct: 2,
      entryPrice: 325.75,
      stopPrice: 340.04,
      referenceDate: refNov,
    };
    let steps = viopExports.buildViopOrderSteps(shortPlan, shortInput);
    let stepTexts = Array.isArray(steps)
      ? steps.map((s) => (typeof s === 'string' ? s : `${s?.title ?? ''} ${s?.detail ?? ''}`))
      : [];
    if (stepTexts.length < 3 || !stepTexts.some((s) => s.includes('F_THYAO1126'))) {
      steps = viopExports.buildViopOrderSteps(shortInput, shortPlan);
      stepTexts = Array.isArray(steps)
        ? steps.map((s) => (typeof s === 'string' ? s : `${s?.title ?? ''} ${s?.detail ?? ''}`))
        : [];
    }
    assert.ok(Array.isArray(steps) && steps.length >= 3, 'buildViopOrderSteps must return >=3 steps');
    assert.ok(
      stepTexts.some((s) => s.includes('F_THYAO1126')),
      'Order steps must reference suggested contract code'
    );
  }
}

function verifyViopUnitTestsFile(testFilePath, testSource, opts = {}) {
  assert.ok(typeof testSource === 'string' && testSource.length > 100, 'test_viop_calculator.cjs missing/empty');
  assert.match(testSource, /LONG/, 'Unit test must cover LONG');
  assert.match(testSource, /SHORT/, 'Unit test must cover SHORT');
  assert.match(testSource, /marginCapped/, 'Unit test must cover marginCapped');
  assert.match(testSource, /SAFE[\s\S]*MODERATE[\s\S]*HIGH|leverageWarning/, 'Unit test must cover leverage bands');
  assert.match(testSource, /NaN/, 'Unit test must cover NaN guard');
  assert.match(testSource, /0127|rollover/i, 'Unit test must cover Dec->Jan rollover');

  if (opts.runChild !== false) {
    execFileSync(process.execPath, ['--test', testFilePath], {
      cwd: opts.cwd || ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }
}

function verifyGlossaryData(glossaryExports) {
  assert.ok(
    glossaryExports && typeof glossaryExports.GLOSSARY_TERMS === 'object' && glossaryExports.GLOSSARY_TERMS !== null,
    'GLOSSARY_TERMS object must be exported'
  );
  assert.equal(typeof glossaryExports.getGlossaryEntry, 'function', 'getGlossaryEntry must be a function');

  const entries = Object.values(glossaryExports.GLOSSARY_TERMS);
  assert.ok(entries.length >= 25, `Expected >= 25 glossary entries, got ${entries.length}`);

  const seenIds = new Set();
  for (const [key, entry] of Object.entries(glossaryExports.GLOSSARY_TERMS)) {
    assert.ok(entry && typeof entry === 'object', `Entry ${key} must be an object`);
    assert.ok(typeof entry.id === 'string' && entry.id.trim().length > 0, `Entry ${key} missing id`);
    assert.ok(typeof entry.title === 'string' && entry.title.trim().length > 0, `Entry ${key} missing title`);
    assert.ok(typeof entry.plain === 'string' && entry.plain.trim().length >= 10, `Entry ${key} plain text too short`);
    assert.ok(typeof entry.example === 'string' && entry.example.trim().length >= 8, `Entry ${key} example too short`);
    assert.ok(!/undefined|null/i.test(entry.plain), `Entry ${key} contains undefined/null literal`);
    assert.ok(!seenIds.has(entry.id), `Duplicate glossary id: ${entry.id}`);
    seenIds.add(entry.id);

    const found = glossaryExports.getGlossaryEntry(entry.id);
    assert.ok(found && found.id === entry.id, `getGlossaryEntry(${entry.id}) must return entry`);
  }

  assert.equal(
    glossaryExports.getGlossaryEntry('__DEFINITELY_MISSING_TERM__'),
    undefined,
    'Unknown glossary id must return undefined'
  );

  // Core R2 concepts must exist (checked flexibly by id/title/plain)
  const corpus = entries.map((e) => `${e.id} ${e.title} ${e.plain}`).join('\n').toLocaleLowerCase('tr-TR');
  for (const conceptRe of [
    /pu30/,
    /nu70/,
    /gvt/,
    /gkd/,
    /1r|2r/,
    /viop|v[iİ]op|pay\s*vadeli/,
    /kald[ıi]ra[çc]/,
    /teminat|margin\s*call/,
    /rollover|vade\s*(ta[şs][ıi]ma|sonu)/,
    /wfo|oos/,
  ]) {
    assert.match(corpus, conceptRe, `Glossary missing core concept matching ${conceptRe}`);
  }
}

function verifyDanglingTermHints(srcFilesMap, glossaryExports) {
  const dangling = [];
  for (const [filePath, source] of Object.entries(srcFilesMap)) {
    for (const m of source.matchAll(/<TermHint\b[^>]*\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*["']([^"']+)["']\s*\})/g)) {
      const id = m[1] || m[2] || m[3];
      const resolved =
        (typeof glossaryExports.getGlossaryEntry === 'function' && glossaryExports.getGlossaryEntry(id)) ||
        glossaryExports.GLOSSARY_TERMS[id];
      if (!resolved) {
        dangling.push(`${filePath}: <TermHint id="${id}" />`);
      }
    }
  }
  assert.deepEqual(dangling, [], `Dangling TermHint IDs found: ${dangling.join(', ')}`);
}

function verifyComponentsSsr({ glossaryTooltipExports, plainGuideBannerExports, viopCalculatorExports }) {
  // 1. GlossaryTooltip (<TermHint>)
  const TermHint = glossaryTooltipExports.TermHint || glossaryTooltipExports.default;
  assert.equal(typeof TermHint, 'function', 'TermHint component must be exported');

  const hintHtml = renderToStaticMarkup(React.createElement(TermHint, { id: 'GVT' }));
  assert.match(hintHtml, /<button\b/, 'TermHint must render a <button>');
  assert.match(hintHtml, /\baria-label="[^"]+"/, 'TermHint button must have non-empty aria-label');
  assert.match(hintHtml, /\baria-expanded="false"/, 'TermHint button must initialize aria-expanded="false"');
  assert.ok(hintHtml.includes('?'), 'TermHint must show ? trigger indicator');

  const unknownHintHtml = renderToStaticMarkup(React.createElement(TermHint, { id: '__NON_EXISTENT_ID__' }));
  assert.equal(typeof unknownHintHtml, 'string', 'Unknown TermHint id must not throw');

  // 2. PlainGuideBanner
  const PlainGuideBanner = plainGuideBannerExports.PlainGuideBanner || plainGuideBannerExports.default;
  assert.equal(typeof PlainGuideBanner, 'function', 'PlainGuideBanner component must be exported');

  const bannerHtml = renderToStaticMarkup(
    React.createElement(PlainGuideBanner, {
      storageKey: 'e2e_test_banner_key',
      title: 'Bu Sayfayı Nasıl Okursun?',
      steps: ['1. Adım özet', '2. Adım teyit', '3. Adım plan'],
      ctaHref: '/viop-rehber',
      ctaLabel: 'VİOP Rehberi',
    })
  );
  assert.ok(bannerHtml.includes('Bu Sayfayı Nasıl Okursun?'));
  assert.ok(bannerHtml.includes('1. Adım özet'));
  assert.ok(bannerHtml.includes('2. Adım teyit'));
  assert.ok(bannerHtml.includes('3. Adım plan'));
  assert.ok(bannerHtml.includes('href="/viop-rehber"'));

  // 3. ViopCalculator
  const ViopCalculator = viopCalculatorExports.ViopCalculator || viopCalculatorExports.default;
  assert.equal(typeof ViopCalculator, 'function', 'ViopCalculator component must be exported');

  const defaultCalcHtml = renderToStaticMarkup(React.createElement(ViopCalculator, {}));
  assert.ok(/100000|100[.,]000/.test(defaultCalcHtml), 'ViopCalculator must default capital to 100.000');
  assert.ok(/value="2"/.test(defaultCalcHtml) || /%\s*2/.test(defaultCalcHtml), 'ViopCalculator must default risk to 2%');
  assert.ok(/value="20"/.test(defaultCalcHtml) || /%\s*20/.test(defaultCalcHtml), 'ViopCalculator must default margin to 20%');
  assert.ok(/0[.,]05/.test(defaultCalcHtml), 'ViopCalculator must default commission to 0.05%');
  assert.ok(/SPK/i.test(defaultCalcHtml), 'ViopCalculator must render SPK risk disclaimer');
  assert.ok(/F_[A-Z0-9]+/.test(defaultCalcHtml), 'ViopCalculator must render suggested contract code');

  // Safety banner cases
  const unconfirmedHtml = renderToStaticMarkup(
    React.createElement(ViopCalculator, {
      initialPreset: {
        symbol: 'THYAO',
        direction: 'SHORT',
        entryPrice: 300,
        stopPrice: 310,
        target1r: 290,
        target2r: 280,
        triggered: false,
      },
    })
  );
  assert.match(
    unconfirmedHtml,
    /(teyit|dikkat|bekle|işlem açma|uyar[ıi])/i,
    'Unconfirmed preset (triggered: false) must render safety banner'
  );

  const trapHtml = renderToStaticMarkup(
    React.createElement(ViopCalculator, {
      initialPreset: {
        symbol: 'ASELS',
        direction: 'SHORT',
        entryPrice: 80,
        stopPrice: 83,
        triggered: true,
        fractalPhaseCode: 'TUZAK_15DK_YENI_ZIRVE_BEKLENIR',
      },
    })
  );
  assert.match(
    trapHtml,
    /(tuzak|15\s*dk|teyit|bekle|dikkat|uyar[ıi])/i,
    '15m trap preset must render safety banner'
  );

  const noReactionHtml = renderToStaticMarkup(
    React.createElement(ViopCalculator, {
      initialPreset: {
        symbol: 'VAKBN',
        direction: 'LONG',
        entryPrice: 23.8,
        stopPrice: 23.4,
        triggered: false,
        hasReaction: false,
      },
    })
  );
  assert.match(
    noReactionHtml,
    /(tepki|[şs]elale|bekle|dikkat|uyar[ıi])/i,
    'No-reaction preset (hasReaction: false) must render safety banner'
  );

  // Wrong-side / zero stop UI guard (no NaN)
  const wrongStopHtml = renderToStaticMarkup(
    React.createElement(ViopCalculator, {
      initialPreset: {
        symbol: 'VAKBN',
        direction: 'LONG',
        entryPrice: 25,
        stopPrice: 26,
        triggered: true,
      },
    })
  );
  assert.ok(!/\bNaN\b/.test(wrongStopHtml), 'ViopCalculator must never render literal NaN');
}

function verifyViopRehberPage(pageSource) {
  assert.equal(typeof pageSource, 'string', 'src/app/viop-rehber/page.tsx missing');
  assert.ok(pageSource.includes('<WorkspacePage'), '/viop-rehber must use <WorkspacePage>');
  assert.doesNotMatch(pageSource, /<h1\b/, '/viop-rehber must NOT contain raw <h1> (WorkspacePage owns h1)');
  assert.doesNotMatch(
    pageSource,
    /Quantum Sniper|QUANTUM SNIPER|AGENTIC AI KUANT/i,
    '/viop-rehber must not contain legacy branding'
  );
  assert.ok(pageSource.includes('<ViopCalculator'), '/viop-rehber must embed <ViopCalculator />');
  assert.ok(pageSource.includes('THYAO') && pageSource.includes('VAKBN') && pageSource.includes('ASELS'), '/viop-rehber must include THYAO, VAKBN, ASELS presets');
  assert.ok(/Spot/i.test(pageSource) && /VİOP/i.test(pageSource), '/viop-rehber must include Spot vs VİOP section');
  assert.ok(/(5\s*Hata|Hata|Kontrol Listesi)/i.test(pageSource), '/viop-rehber must include common mistakes / checklist');
  assert.ok(/(Sözlük|GLOSSARY)/i.test(pageSource), '/viop-rehber must include searchable glossary');
  assert.doesNotMatch(
    pageSource,
    /new\s+RegExp\s*\(\s*(?:query|search|term|filter)/i,
    '/viop-rehber glossary search must not pass unescaped user query to new RegExp()'
  );
}

function verifyNavigationAndMirrors({
  navJsonText,
  rsiIconsSvg,
  publicIndexHtml,
  pythonIndexHtml,
  publicMtfHtml,
  pythonMtfHtml,
  viopRehberPageExists,
}) {
  assert.equal(viopRehberPageExists, true, 'src/app/viop-rehber/page.tsx must exist on disk');

  const groups = JSON.parse(navJsonText);
  assert.ok(Array.isArray(groups) && groups.length >= 4, 'system-navigation.json must contain >=4 groups');

  const iconIds = new Set();
  for (const [, id] of rsiIconsSvg.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)) {
    iconIds.add(id);
  }

  const allHrefs = [];
  let viopItem = null;
  let viopGroup = null;

  for (const group of groups) {
    assert.ok(typeof group.label === 'string' && group.label.trim().length > 0, 'Nav group label must be non-empty');
    assert.ok(Array.isArray(group.items), 'Nav group items must be an array');
    for (const item of group.items) {
      allHrefs.push(item.href);
      assert.ok(
        iconIds.has(item.icon),
        `Icon "${item.icon}" for "${item.href}" not found in rsi-icons.svg`
      );
      if (item.href === '/viop-rehber') {
        viopItem = item;
        viopGroup = group;
      }
    }
  }

  assert.equal(allHrefs.length, new Set(allHrefs).size, 'Duplicate href in system-navigation.json');
  assert.ok(viopItem, '/viop-rehber must be registered in system-navigation.json');
  assert.equal(
    viopItem.label,
    'VİOP & Strateji Rehberi',
    'Menu item label for /viop-rehber must be "VİOP & Strateji Rehberi"'
  );
  // C1: brand-new menu group NOT in the 3 pre-existing groups
  assert.ok(
    !PREEXISTING_NAV_GROUPS.has(viopGroup.label),
    `C1: /viop-rehber must belong to a brand-new group, not pre-existing "${viopGroup.label}"`
  );

  // Byte-for-byte mirror parity
  assert.equal(publicIndexHtml, pythonIndexHtml, 'public/index.html != python_bot/static/index.html');
  assert.equal(publicMtfHtml, pythonMtfHtml, 'public/mtf-lab.html != python_bot/static/mtf-lab.html');

  const registered = new Set(allHrefs);
  for (const [name, html] of [
    ['public/index.html', publicIndexHtml],
    ['public/mtf-lab.html', publicMtfHtml],
  ]) {
    const startIdx = html.indexOf('<ul class="nav-links">');
    assert.ok(startIdx !== -1, `${name} missing <ul class="nav-links">`);
    const afterStart = startIdx + '<ul class="nav-links">'.length;
    const endIdx = html.indexOf('</ul>', afterStart);
    assert.ok(endIdx !== -1, `${name} missing closing </ul> for nav-links`);

    const sidebarListSlice = html.slice(afterStart, endIdx);
    // C9 + test_mtf_lab_ui.cjs:161: NO nested <ul> before first </ul>
    assert.doesNotMatch(
      sidebarListSlice,
      /<ul\b/i,
      `${name}: <ul class="nav-links"> must stay flat (no nested <ul> before first </ul>)`
    );
    assert.ok(
      sidebarListSlice.includes('href="/viop-rehber"'),
      `${name}: sidebar <ul class="nav-links"> must include href="/viop-rehber"`
    );
    for (const [, href] of sidebarListSlice.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      assert.ok(registered.has(href), `${name}: unregistered sidebar link ${href}`);
    }

    // Check every registered link exists in <aside id="rsi-sidebar">
    const asideMatch = html.match(/id="rsi-sidebar"[\s\S]*?<\/aside>/);
    assert.ok(asideMatch, `${name} missing <aside id="rsi-sidebar">`);
    for (const href of registered) {
      assert.ok(asideMatch[0].includes(`href="${href}"`), `${name} sidebar missing ${href}`);
    }

    // C9: /privacy footer link preserved
    assert.match(
      asideMatch[0],
      /class="rsi-sidebar-footer"[\s\S]*href="\/privacy"/,
      `${name}: .rsi-sidebar-footer must preserve /privacy link`
    );

    // Unique id attributes
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${name} contains duplicate DOM id attributes`);
  }
}

const EXPECTED_APP_JS_NAV_SLICE_SHA256 =
  '6e669177e85bb2eaa11ae7e58c06b976d88981ffde26b04b8010aee70e81c48a';

function verifyAppJsNavigationSlice(appJsSource) {
  const startMarker = '    // Navigation';
  const endMarker = '    const modals';
  const startIdx = appJsSource.indexOf(startMarker);
  const endIdx = appJsSource.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx > startIdx, 'app.js missing intact // Navigation .. const modals slice');

  const navigation = appJsSource.slice(startIdx, endIdx);
  const normalizedNavigation = navigation.replace(/\r\n/g, '\n');
  const sliceDigest = crypto
    .createHash('sha256')
    .update(normalizedNavigation, 'utf8')
    .digest('hex');
  assert.equal(
    sliceDigest,
    EXPECTED_APP_JS_NAV_SLICE_SHA256,
    `app.js // Navigation .. const modals slice must remain untouched (sha256 ${sliceDigest} !== ${EXPECTED_APP_JS_NAV_SLICE_SHA256})`
  );

  const makeToggleList = () => ({
    toggle(name, value) {
      this[name] = value;
    },
  });
  const sections = ['dashboard', 'rsipu30', 'weights'].map((id) => ({
    id,
    classList: makeToggleList(),
  }));
  const navLinks = ['#rsipu30', '#weights', '#dashboard'].map((href) => ({
    getAttribute(attr) {
      return attr === 'href' ? href : null;
    },
    parentElement: {
      classList: makeToggleList(),
    },
  }));
  const controls = { hidden: false };
  const events = {};
  const redirects = [];
  const context = {
    window: {
      location: {
        hash: '',
        replace(url) {
          redirects.push(url);
        },
      },
      addEventListener(name, callback) {
        events[name] = callback;
      },
    },
    document: {
      querySelectorAll: (selector) => {
        if (selector === '.view-section') return sections;
        if (selector === '.nav-links a[href^="#"]') return navLinks;
        return [];
      },
      getElementById: () => controls,
    },
  };
  vm.runInNewContext(navigation, context);
  assert.equal(sections[1].classList.active, true, 'Default active section in app.js must be rsipu30');
  assert.equal(navLinks[0].parentElement.classList.active, true, 'Default active navLink in app.js must be #rsipu30');
  assert.equal(navLinks[1].parentElement.classList.active, false, 'Inactive navLink #weights must have active=false');

  context.window.location.hash = '#weights';
  events.hashchange();
  assert.equal(sections[2].classList.active, true, '#weights hashchange must activate weights section');
  assert.equal(navLinks[1].parentElement.classList.active, true, '#weights hashchange must activate #weights navLink');
  assert.equal(navLinks[0].parentElement.classList.active, false, '#weights hashchange must deactivate #rsipu30 navLink');

  context.window.location.hash = '#dashboard';
  events.hashchange();
  assert.deepEqual(redirects, ['/scanner'], '#dashboard must redirect to /scanner');

  context.window.location.hash = '#rsipu30';
  events.hashchange();
  assert.equal(sections[1].classList.active, true);
  assert.equal(navLinks[0].parentElement.classList.active, true);
  assert.equal(navLinks[1].parentElement.classList.active, false);

  // R2: Classic modal color legend + /viop-rehber link
  assert.ok(appJsSource.includes('/viop-rehber'), 'app.js must wire /viop-rehber link in #rsiPu30Modal');
  assert.match(appJsSource, /rsiPu30Modal|rsiPu30SignalInfo|rsiPu30PriceChart/, 'app.js modal references missing');
  assert.ok(
    /(legend|lejant|renk|GVT|GKD)/i.test(appJsSource),
    'app.js must inject 1-line color legend inside #rsiPu30Modal'
  );
}

function verifyScreenIntegrations({
  semihChartSource,
  labPageSource,
  impulseLabPageSource,
  analysisPageSource,
}) {
  // F10: SemihDivergenceChart.tsx
  assert.ok(semihChartSource.includes('<TermHint'), 'SemihDivergenceChart.tsx must use <TermHint>');
  assert.match(
    semihChartSource,
    /(legend|lejant|GVT|GKD|PU30|Fib)/i,
    'SemihDivergenceChart.tsx must render 1-line color legend'
  );

  // F11: src/app/lab/page.tsx
  assert.ok(labPageSource.includes('<PlainGuideBanner'), 'lab/page.tsx must render <PlainGuideBanner>');
  assert.ok(labPageSource.includes('/viop-rehber'), 'lab/page.tsx must link to /viop-rehber');
  assert.ok(labPageSource.includes('<TermHint'), 'lab/page.tsx must use <TermHint>');
  assert.ok(labPageSource.includes('<ViopCalculator'), 'lab/page.tsx must render <ViopCalculator>');
  assert.ok(labPageSource.includes('VİOP Planı'), 'lab/page.tsx must include 🧮 VİOP Planı button');
  assert.ok(
    labPageSource.includes('is_viop'),
    'lab/page.tsx must gate VİOP Planı on is_viop cards'
  );

  // F12: src/app/impulse-lab/page.tsx
  assert.ok(impulseLabPageSource.includes('<PlainGuideBanner'), 'impulse-lab/page.tsx must render <PlainGuideBanner>');
  assert.ok(impulseLabPageSource.includes('<TermHint'), 'impulse-lab/page.tsx must use <TermHint>');
  assert.ok(impulseLabPageSource.includes('<ViopCalculator'), 'impulse-lab/page.tsx must render <ViopCalculator>');
  assert.ok(impulseLabPageSource.includes('VİOP Planı'), 'impulse-lab/page.tsx must include 🧮 VİOP Planı button');
  assert.ok(
    impulseLabPageSource.includes('1_2_yapisi_hazir') &&
      impulseLabPageSource.includes('target_log') &&
      impulseLabPageSource.includes('target_from_w2'),
    'impulse-lab/page.tsx must wire ready 1_2_yapisi_hazir cards across Linear/Log scales'
  );

  // F13: src/app/analysis/[symbol]/page.tsx
  assert.ok(analysisPageSource.includes('/viop-rehber'), 'analysis/[symbol]/page.tsx must link to /viop-rehber');
  assert.ok(
    analysisPageSource.includes('<InteractiveChartWrapper'),
    'analysis/[symbol]/page.tsx must preserve <InteractiveChartWrapper>'
  );
  const viopIdx = analysisPageSource.indexOf('/viop-rehber');
  const chartIdx = analysisPageSource.indexOf('<InteractiveChartWrapper');
  assert.ok(
    viopIdx !== -1 && chartIdx !== -1 && viopIdx < chartIdx,
    'analysis/[symbol]/page.tsx 3-step summary & /viop-rehber link must appear above <InteractiveChartWrapper>'
  );
}

// ============================================================================
// Self-Test Fixtures (ONLY executed when process.env.E2E_SELF_TEST === '1')
// ============================================================================

function buildSelfTestVirtualWorkspace(rootDir) {
  const longShortPy = fs.readFileSync(
    path.join(rootDir, 'python_bot/engine/signals/long_short_matrix.py'),
    'utf8'
  );
  const expectedSymbols = parseExpectedViopSymbols(longShortPy);

  const specText = `
# VİOP Pay Vadeli Referans Şartnamesi
1 Pay Vadeli kontratı = 100 adet hisse senedi (çarpan 100). Bedelli/bedelsiz sermaye artırımı ve olağanüstü temettü gibi kurumsal işlemlerde çarpan uyarlanabilir.
Başlangıç teminatı Takasbank SPAN parametrelerine göre belirlenir. Sürdürme teminatı Takasbank 2017 sonrası kuralına göre gün sonunda başlangıç teminatının %100'üdür; gün içi erken uyarı ve klasik literatür eşiği olarak %75 oranı da izlenir.
Günlük uzlaşma (MTM) son 10 dakika ağırlıklı ortalama fiyatı (VWAP) üzerinden hesaplanır; işlem olmaması veya yetersiz işlem (likidite) halinde önceki uzlaşma fiyatı esas alınır.
Teminat tamamlama çağrısı (Margin Call) T+1 günü saat 15:00'e kadar (aracı kurumda genellikle 14:30) tamamlanmazsa resen kapatma uygulanır.
Yakın vade kontrat kodu F_<SEMBOL>MMYY biçimindedir. Vade sonunda fiziki teslimat uygulanır; bu nedenle vade bitiminden 2-3 iş günü önce rollover (vade taşıma) önerilir. Yarım gün resmi tatil günlerinde vade sonu bir önceki iş gününe çekilebilir.
Pay Vadeli işlem saatleri 09:30–18:10 arasıdır; Pay Vadeli kontratlarında akşam seansı (19:00–23:00) yoktur.
Varsayılan gidiş-dönüş komisyon %0.05 olarak hesaplanır (aracı kurum komisyonu + Borsa Payı + Takasbank + %5 BSMV).
Stop-risk öncelikli kontrat boyutu = aşağı yuvarlama floor(Risk Bütçesi / (|Giriş - Stop| * 100)).
Efektif Kaldıraç Eşikleri: SAFE <= 2.5x, MODERATE <= 4.0x, HIGH > 4.0x.
SPK Uyarısı: Burada yer alan hesaplamalar eğitim amaçlıdır, yatırım tavsiyesi değildir.
`;

  const viopTs = `
export const BIST_STOCK_FUTURES_MULTIPLIER = 100;
export const TAKASBANK_MAINTENANCE_MARGIN_RATIO = 1.0;
export const BIST_VIOP_SYMBOLS: ReadonlySet<string> = new Set(${JSON.stringify([...expectedSymbols])});

export type ViopDirection = "LONG" | "SHORT";
export type LeverageWarningLevel = "SAFE" | "MODERATE" | "HIGH";

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

export function formatViopContractCode(symbol: string, referenceDate: Date = new Date()) {
  const clean = String(symbol || "").toUpperCase().replace(/\\.IS$/i, "").replace(/[^A-Z0-9]/g, "");
  const ticker = clean.length >= 2 ? clean : "HISSE";
  const y = referenceDate.getUTCFullYear();
  const m = referenceDate.getUTCMonth() + 1;
  const d = referenceDate.getUTCDate();
  const mm = String(m).padStart(2, "0");
  const yy = String(y).slice(-2);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const nmm = String(nextM).padStart(2, "0");
  const nyy = String(nextY).slice(-2);
  return {
    nearCode: "F_" + ticker + mm + yy,
    nextCode: "F_" + ticker + nmm + nyy,
    inRolloverWindow: d >= 27,
  };
}

function invalidResult(direction: ViopDirection, error: string, symbol: string, refDate?: Date) {
  const code = formatViopContractCode(symbol, refDate);
  const clean = String(symbol || "").toUpperCase().replace(/\\.IS$/i, "").replace(/[^A-Z0-9]/g, "");
  return {
    isValid: false,
    validationError: error,
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
    leverageWarning: "SAFE" as LeverageWarningLevel,
    riskLossTry: 0,
    profit1rTry: 0,
    profit2rTry: 0,
    estCommissionTry: 0,
    resolvedTarget1r: 0,
    resolvedTarget2r: 0,
    suggestedContractCode: code.nearCode,
    nextContractCode: code.nextCode,
    inRolloverWindow: code.inRolloverWindow,
    isStandardViopSymbol: BIST_VIOP_SYMBOLS.has(clean),
  };
}

export function computeViopPlan(input: ViopPlanInput) {
  const symbol = input.symbol || "THYAO";
  const direction = input.direction;
  const capitalTry = input.capitalTry;
  const riskPct = input.riskPct;
  const entryPrice = input.entryPrice;
  const stopPrice = input.stopPrice;
  const marginRatePct = input.marginRatePct ?? 20;
  const commissionPct = input.commissionPct ?? 0.05;
  const maintRatio = input.maintenanceMarginRatio ?? 1.0;

  const nums = [capitalTry, riskPct, entryPrice, stopPrice, marginRatePct, commissionPct, maintRatio];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return invalidResult(direction, "Tüm sayısal değerler geçerli olmalıdır.", symbol, input.referenceDate);
  }
  if (capitalTry <= 0 || riskPct <= 0 || riskPct > 100 || entryPrice <= 0 || stopPrice <= 0 || marginRatePct <= 0 || marginRatePct > 100 || commissionPct < 0 || maintRatio <= 0) {
    return invalidResult(direction, "Sermaye, risk, fiyat ve teminat oranları pozitif sınırlar içinde olmalıdır.", symbol, input.referenceDate);
  }
  if (direction === "LONG" && stopPrice >= entryPrice) {
    return invalidResult(direction, "LONG işlemde stop giriş fiyatının altında olmalıdır.", symbol, input.referenceDate);
  }
  if (direction === "SHORT" && stopPrice <= entryPrice) {
    return invalidResult(direction, "SHORT işlemde stop giriş fiyatının üstünde olmalıdır.", symbol, input.referenceDate);
  }

  const stopDistanceTry = Math.abs(entryPrice - stopPrice);
  const stopDistancePct = (stopDistanceTry / entryPrice) * 100;
  const contractNotionalTry = entryPrice * BIST_STOCK_FUTURES_MULTIPLIER;
  const initialMarginPerContractTry = contractNotionalTry * (marginRatePct / 100);
  const maintenanceMarginPerContractTry = initialMarginPerContractTry * maintRatio;
  const intradayWarning75PerContractTry = initialMarginPerContractTry * 0.75;
  const riskPerContractTry = stopDistanceTry * BIST_STOCK_FUTURES_MULTIPLIER;
  const maxRiskBudgetTry = capitalTry * (riskPct / 100);
  const recommendedContractsByRisk = Math.floor(maxRiskBudgetTry / riskPerContractTry);
  const maxContractsByMargin = Math.floor(capitalTry / initialMarginPerContractTry);
  const suggestedContracts = Math.min(recommendedContractsByRisk, maxContractsByMargin);
  const marginCapped = recommendedContractsByRisk > maxContractsByMargin;

  const totalPositionTry = suggestedContracts * contractNotionalTry;
  const requiredMarginTry = suggestedContracts * initialMarginPerContractTry;
  const maintenanceMarginTotalTry = suggestedContracts * maintenanceMarginPerContractTry;
  const freeMarginBufferTry = capitalTry - requiredMarginTry;
  const effectiveLeverage = totalPositionTry / capitalTry;
  const leverageWarning: LeverageWarningLevel =
    effectiveLeverage <= 2.5 ? "SAFE" : effectiveLeverage <= 4.0 ? "MODERATE" : "HIGH";

  const resolvedTarget1r = input.target1r !== undefined && Number.isFinite(input.target1r)
    ? input.target1r
    : direction === "LONG" ? entryPrice + stopDistanceTry : entryPrice - stopDistanceTry;
  const resolvedTarget2r = input.target2r !== undefined && Number.isFinite(input.target2r)
    ? input.target2r
    : direction === "LONG" ? entryPrice + 2 * stopDistanceTry : entryPrice - 2 * stopDistanceTry;

  const estCommissionTry = totalPositionTry * (commissionPct / 100);
  const sign = direction === "LONG" ? 1 : -1;
  const profit1rTry = sign * (resolvedTarget1r - entryPrice) * BIST_STOCK_FUTURES_MULTIPLIER * suggestedContracts - estCommissionTry;
  const profit2rTry = sign * (resolvedTarget2r - entryPrice) * BIST_STOCK_FUTURES_MULTIPLIER * suggestedContracts - estCommissionTry;
  const riskLossTry = suggestedContracts * riskPerContractTry + estCommissionTry;

  const code = formatViopContractCode(symbol, input.referenceDate);
  const clean = String(symbol || "").toUpperCase().replace(/\\.IS$/i, "").replace(/[^A-Z0-9]/g, "");

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
    suggestedContractCode: code.nearCode,
    nextContractCode: code.nextCode,
    inRolloverWindow: code.inRolloverWindow,
    isStandardViopSymbol: BIST_VIOP_SYMBOLS.has(clean),
  };
}

export function buildViopOrderSteps(res: ReturnType<typeof computeViopPlan>, input: ViopPlanInput) {
  return [
    { step: 1, title: "Kontrat Seç", detail: "Kontrat: " + res.suggestedContractCode },
    { step: 2, title: "Adet", detail: res.suggestedContracts + " kontrat" },
    { step: 3, title: "Stop", detail: input.stopPrice + " TL" },
    { step: 4, title: "1R Hedef", detail: res.resolvedTarget1r + " TL" },
  ];
}
`;

  const termIds = [
    ['PU30', 'Pozitif Uyumsuzluk (RSI < 30)', 'Fiyat daha düşük dip yaparken RSI daha yüksek dip yapar.', 'THYAO 288 TL dip yaparken RSI 27 -> 34 çıkar.'],
    ['NU70', 'Negatif Uyumsuzluk (RSI > 70)', 'Fiyat yeni tepe yaparken RSI daha düşük tepe yapar.', 'ASELS 85 TL tepe yaparken RSI 75 -> 66 düşer.'],
    ['NU70_ADAY', 'Erken NU70 Adayı', 'Henüz kırılım teyidi almamış olası negatif uyumsuzluk adayı.', 'AKBNK tepe bölgesinde ama GKD kırılmamış.'],
    ['GVT', 'Güven Tazeleyen Tepe', 'PU30 sonrası yükseliş teyidi için aşılması gereken direnç.', 'VAKBN 25 TL GVT üstünde Long teyidi alır.'],
    ['GKD', 'Güven Kıran Dip', 'NU70 sonrası düşüş teyidi için aşağı kırılması gereken destek.', 'THYAO 300 TL GKD kırılınca Short teyidi alır.'],
    ['1R_2R', '1R / 2R Risk-Ödül', 'Stop mesafesinin 1 katı ve 2 katı kazanç hedefleri.', '10 TL riskte 1R=10 TL, 2R=20 TL kâr hedefidir.'],
    ['FIB_3618', 'Fib 3.618 Uzatma', '3. itki dalgasının ileri Fibonacci fiyat hedefi.', '1. dalga boyunun %361.8 uzamasıdır.'],
    ['NET_EV', 'Net Beklenen Değer (Net EV)', 'Komisyon sonrası işlem başına ortalama beklenen getiri.', '+0.45R Net EV pozitif istatistik avantajdır.'],
    ['OOS_FOLD', 'OOS Fold (İleriye Dönük Test)', 'Eğitim dışı veride yapılan strateji testi.', 'Walk-forward 5 fold OOS doğrulaması.'],
    ['MARGIN_CALL', 'Teminat Tamamlama Çağrısı', 'Sürdürme teminatının altına düşülünce T+1 15:00 çağrısı.', 'Ek teminat yatırılmazsa resen kapama olur.'],
    ['VIOP_PAY_VADELI', 'VİOP Pay Vadeli', '1 kontratı 100 adet hisseye denk gelen vadeli sözleşme.', 'F_THYAO1126 1 kontrat = 100 THYAO hissesi.'],
    ['ROLLOVER', 'Rollover (Vade Taşıma)', 'Vade bitiminden 2-3 iş günü önce sonraki aya geçiş.', 'F_THYAO1226 kapatılıp F_THYAO0127 açılır.'],
    ['KALDIRAC', 'Efektif Kaldıraç', 'Toplam pozisyon büyüklüğünün sermayeye oranı.', '300.000 TL pozisyon / 100.000 TL = 3.0x kaldıraç.'],
    ['TEMINAT', 'Başlangıç Teminatı', 'Her kontratı açmak için gereken asgari blokaj tutarı.', '%20 teminatta 30.000 TL pozisyon için 6.000 TL.'],
    ['MOD_A', 'Mod A (W1 Zaman Projeksiyonu)', '1. dalga süresine göre 3. dalga zaman hedefi.', '12 barlık W1 sonrası Fib zaman bölgesi.'],
    ['MOD_B', 'Mod B (0-2 Süresinden Sündürme)', 'P0-P2 toplam süresinden Fibonacci zaman projeksiyonu.', 'P0->P2 20 barsa 1.618 uzatma barı.'],
    ['ASILAN_ADAM', 'Asılan Adam Mumu', 'Yükseliş tepesinde uzun alt fitilli uyarı mumu.', 'NU70 ile birleşince satış baskısı uyarısı verir.'],
    ['WFO', 'Walk-Forward Optimization (WFO)', 'Zaman sırasını bozmadan kayan pencerede doğrulama.', 'Gelecek verisi sızıntısını engeller.'],
    ['PROFIT_FACTOR', 'Profit Factor', 'Toplam brüt kârın toplam brüt zarara oranı.', '2.10 değeri kârın zararın 2.1 katı olduğunu gösterir.'],
    ['ITKI_123', '1-2-3 İtki Yapısı', 'Dip-tepe-düzeltme sonrası güçlü 3. dalga başlangıcı.', 'P0->P1->P2 ardından W1 tepesi kırılımı.'],
    ['TUZAK_15DK', '15dk Tuzak Uyarısı', 'Saatlik uyumsuzluk yokken 15dk uyumsuzluğun yanıltması.', 'Öğleden sonra yeni tepe riskine karşı bekleme kuralı.'],
    ['SELALE_RISKI', 'Tepkisiz Şelale Düşüşü', 'Aşırı satımda tepki alımı olmadan süren sert düşüş.', 'has_reaction=false iken dip yakalamaya çalışma.'],
    ['PAIR_TRADING', 'Pair Trading (Eşbütünleşme)', 'Aynı sektör iki hisse arasında Long+Short spread işlemi.', 'GARAN Long + AKBNK Short eşanlı denge.'],
    ['MTM', 'Günlük Uzlaşma (MTM)', 'Gün sonu kâr/zararın hesaba günlük yansıtılması.', 'Son 10 dakika VWAP uzlaşma fiyatıyla hesaplanır.'],
    ['FIZIKI_TESLIMAT', 'Fiziki Teslimat', 'Vade sonunda kontratın gerçek hisse alım/satımına dönmesi.', 'Vade sonu öncesi rollover ile önlenir.'],
  ];

  const glossaryMapObj = Object.fromEntries(
    termIds.map(([id, title, plain, example]) => [id, { id, title, plain, example }])
  );

  const glossaryTs = `
export interface GlossaryEntry { id: string; title: string; plain: string; example: string; }
export const GLOSSARY_TERMS: Record<string, GlossaryEntry> = ${JSON.stringify(glossaryMapObj, null, 2)};
export function getGlossaryEntry(id: string): GlossaryEntry | undefined {
  return GLOSSARY_TERMS[id];
}
`;

  const tooltipTsx = `
import React from "react";
import { getGlossaryEntry } from "@/lib/glossary";

export function TermHint({ id }: { id: string }) {
  const entry = getGlossaryEntry(id);
  if (!entry) return null;
  return (
    <button type="button" aria-label={entry.title} aria-expanded="false">
      ?
    </button>
  );
}
`;

  const bannerTsx = `
import React from "react";

export function PlainGuideBanner({
  title,
  steps,
  ctaHref,
  ctaLabel,
}: {
  storageKey: string;
  title: string;
  steps: [string, string, string];
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <ol>
        {steps.map((s, idx) => <li key={idx}>{s}</li>)}
      </ol>
      {ctaHref && <a href={ctaHref}>{ctaLabel || "Detay"}</a>}
    </section>
  );
}
`;

  const calcTsx = `
import React from "react";
import { computeViopPlan } from "@/lib/viop";

export function ViopCalculator({ initialPreset }: { initialPreset?: any }) {
  const preset = initialPreset || {
    symbol: "THYAO",
    direction: "LONG",
    entryPrice: 300,
    stopPrice: 290,
    triggered: true,
  };
  const plan = computeViopPlan({
    symbol: preset.symbol,
    direction: preset.direction,
    capitalTry: 100000,
    riskPct: 2,
    entryPrice: preset.entryPrice,
    stopPrice: preset.stopPrice,
    target1r: preset.target1r,
    target2r: preset.target2r,
    marginRatePct: 20,
    commissionPct: 0.05,
  });
  const showSafety =
    preset.triggered === false ||
    preset.fractalPhaseCode === "TUZAK_15DK_YENI_ZIRVE_BEKLENIR" ||
    preset.hasReaction === false;

  return (
    <div>
      {showSafety && <div role="alert">Dikkat: Teyit bekleniyor / 15dk tuzak / tepki yok — VİOP işlem açma!</div>}
      <input aria-label="Sermaye" defaultValue="100000" />
      <input aria-label="Risk" defaultValue="2" />
      <input aria-label="Teminat" defaultValue="20" />
      <input aria-label="Komisyon" defaultValue="0.05" />
      <div>{plan.isValid ? plan.suggestedContractCode : plan.validationError}</div>
      <div>SPK Risk Uyarısı: Yatırım tavsiyesi değildir.</div>
    </div>
  );
}
`;

  const viopRehberPage = `
import { WorkspacePage } from "@/components/ui/Workspace";
import { ViopCalculator } from "@/components/ViopCalculator";
import { GLOSSARY_TERMS } from "@/lib/glossary";

export default function ViopRehberPage() {
  const presets = ["THYAO", "VAKBN", "ASELS"];
  return (
    <WorkspacePage title="VİOP & Strateji Rehberi">
      <section>Spot vs VİOP Karşılaştırma</section>
      <section><ViopCalculator /> {presets.join(", ")}</section>
      <section>5 Strateji</section>
      <section>5 Hata ve Kontrol Listesi</section>
      <section>Sözlük {Object.keys(GLOSSARY_TERMS).length}</section>
    </WorkspacePage>
  );
}
`;

  const virtualFiles = {
    [path.join(rootDir, 'src/lib/viop.ts')]: viopTs,
    [path.join(rootDir, 'src/lib/glossary.ts')]: glossaryTs,
    [path.join(rootDir, 'src/components/GlossaryTooltip.tsx')]: tooltipTsx,
    [path.join(rootDir, 'src/components/PlainGuideBanner.tsx')]: bannerTsx,
    [path.join(rootDir, 'src/components/ViopCalculator.tsx')]: calcTsx,
    [path.join(rootDir, 'src/app/viop-rehber/page.tsx')]: viopRehberPage,
  };

  const baseNav = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'src/lib/system-navigation.json'), 'utf8')
  );
  const navWithGuide = [
    ...baseNav,
    {
      label: 'VİOP REHBERİ',
      items: [{ href: '/viop-rehber', label: 'VİOP & Strateji Rehberi', icon: 'shield' }],
    },
  ];

  const injectSidebarItem = (html) =>
    html.replace(
      '</ul>',
      '<li class="rsi-nav-group">VİOP REHBERİ</li>\n<li><a data-system-link href="/viop-rehber">VİOP &amp; Strateji Rehberi</a></li>\n</ul>'
    );

  const publicIndexHtml = injectSidebarItem(
    fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8')
  );
  const publicMtfHtml = injectSidebarItem(
    fs.readFileSync(path.join(rootDir, 'public/mtf-lab.html'), 'utf8')
  );
  const appJs =
    fs.readFileSync(path.join(rootDir, 'public/static/app.js'), 'utf8') +
    '\n// legend: Renk Lejantı + /viop-rehber\n';

  return {
    expectedSymbols,
    specText,
    viopRehberPage,
    virtualFiles,
    navJsonText: JSON.stringify(navWithGuide),
    rsiIconsSvg: fs.readFileSync(path.join(rootDir, 'public/static/rsi-icons.svg'), 'utf8'),
    publicIndexHtml,
    pythonIndexHtml: publicIndexHtml,
    publicMtfHtml,
    pythonMtfHtml: publicMtfHtml,
    appJs,
    screenSources: {
      semihChartSource: '<TermHint id="PU30" /><TermHint id="GVT" /><div>Renk Lejantı</div>',
      labPageSource:
        '<PlainGuideBanner /><PlainGuideBanner /><PlainGuideBanner /><PlainGuideBanner /><TermHint id="GKD" /><ViopCalculator /><a href="/viop-rehber">VİOP Rehberi</a>{is_viop && <button>🧮 VİOP Planı</button>}',
      impulseLabPageSource:
        '<PlainGuideBanner /><TermHint id="WFO" /><ViopCalculator />{imp?.durum === "1_2_yapisi_hazir" && <button>🧮 VİOP Planı</button>} /* target_log target_from_w2 */',
      analysisPageSource:
        '<WorkspacePage title="Analiz"><a href="/viop-rehber">VİOP Rehberi</a><InteractiveChartWrapper /></WorkspacePage>',
    },
    unitTestSource:
      '// Synthetic unit test suite covering LONG, SHORT, marginCapped, leverageWarning SAFE MODERATE HIGH, NaN Infinity guards, F_THYAO1226 -> F_THYAO0127 rollover',
  };
}

// ============================================================================
// Test Runner Registration
// ============================================================================

if (require.main === module) {
  if (process.env.E2E_SELF_TEST === '1') {
    describe('E2E Harness Self-Test (Positive Fixtures + Negative Mutation Detection)', () => {
    const fx = buildSelfTestVirtualWorkspace(ROOT);

    test('Self-Test Positive: all verifiers pass on compliant synthetic fixtures', () => {
      verifyReferenceSpec(fx.specText);

      const viopExports = loadTsModule(path.join(ROOT, 'src/lib/viop.ts'), {
        rootDir: ROOT,
        virtualFiles: fx.virtualFiles,
      });
      verifyViopMathEngine(viopExports, fx.expectedSymbols);

      verifyViopUnitTestsFile('synthetic', fx.unitTestSource, { runChild: false });

      const glossaryExports = loadTsModule(path.join(ROOT, 'src/lib/glossary.ts'), {
        rootDir: ROOT,
        virtualFiles: fx.virtualFiles,
      });
      verifyGlossaryData(glossaryExports);
      verifyDanglingTermHints(
        {
          ...fx.screenSources,
          viopRehber: fx.viopRehberPage,
        },
        glossaryExports
      );

      const glossaryTooltipExports = loadTsModule(
        path.join(ROOT, 'src/components/GlossaryTooltip.tsx'),
        { rootDir: ROOT, virtualFiles: fx.virtualFiles }
      );
      const plainGuideBannerExports = loadTsModule(
        path.join(ROOT, 'src/components/PlainGuideBanner.tsx'),
        { rootDir: ROOT, virtualFiles: fx.virtualFiles }
      );
      const viopCalculatorExports = loadTsModule(
        path.join(ROOT, 'src/components/ViopCalculator.tsx'),
        { rootDir: ROOT, virtualFiles: fx.virtualFiles }
      );
      verifyComponentsSsr({
        glossaryTooltipExports,
        plainGuideBannerExports,
        viopCalculatorExports,
      });

      verifyViopRehberPage(fx.viopRehberPage);
      verifyNavigationAndMirrors({
        navJsonText: fx.navJsonText,
        rsiIconsSvg: fx.rsiIconsSvg,
        publicIndexHtml: fx.publicIndexHtml,
        pythonIndexHtml: fx.pythonIndexHtml,
        publicMtfHtml: fx.publicMtfHtml,
        pythonMtfHtml: fx.pythonMtfHtml,
        viopRehberPageExists: true,
      });
      verifyAppJsNavigationSlice(fx.appJs);
      verifyScreenIntegrations(fx.screenSources);
    });

    test('Self-Test Negative: mutated fixtures trigger assertion failures in every verifier', () => {
      // 1. Spec missing 75% warning or having stale >3x/>5x thresholds
      assert.throws(() => verifyReferenceSpec(fx.specText.replace(/%75/g, '')));
      assert.throws(() =>
        verifyReferenceSpec(fx.specText + '\nMODERATE: <=3x, HIGH: >5x\n')
      );

      // 2. Viop math wrong multiplier / wrong-side stop bug
      const baseViop = loadTsModule(path.join(ROOT, 'src/lib/viop.ts'), {
        rootDir: ROOT,
        virtualFiles: fx.virtualFiles,
      });
      assert.throws(() =>
        verifyViopMathEngine(
          { ...baseViop, BIST_STOCK_FUTURES_MULTIPLIER: 50 },
          fx.expectedSymbols
        )
      );
      assert.throws(() =>
        verifyViopMathEngine(
          {
            ...baseViop,
            BIST_VIOP_SYMBOLS: new Set([...fx.expectedSymbols].slice(0, 40)),
          },
          fx.expectedSymbols
        )
      );

      // 3. Glossary < 25 entries & dangling TermHint id
      const glossaryExports = loadTsModule(path.join(ROOT, 'src/lib/glossary.ts'), {
        rootDir: ROOT,
        virtualFiles: fx.virtualFiles,
      });
      const smallGlossary = Object.fromEntries(
        Object.entries(glossaryExports.GLOSSARY_TERMS).slice(0, 10)
      );
      assert.throws(() =>
        verifyGlossaryData({
          GLOSSARY_TERMS: smallGlossary,
          getGlossaryEntry: (id) => smallGlossary[id],
        })
      );
      assert.throws(() =>
        verifyDanglingTermHints(
          { 'src/app/lab/page.tsx': '<TermHint id="NON_EXISTENT_KEY" />' },
          glossaryExports
        )
      );

      // 4. ViopCalculator missing SPK or safety banner
      assert.throws(() =>
        verifyComponentsSsr({
          glossaryTooltipExports: loadTsModule(
            path.join(ROOT, 'src/components/GlossaryTooltip.tsx'),
            { rootDir: ROOT, virtualFiles: fx.virtualFiles }
          ),
          plainGuideBannerExports: loadTsModule(
            path.join(ROOT, 'src/components/PlainGuideBanner.tsx'),
            { rootDir: ROOT, virtualFiles: fx.virtualFiles }
          ),
          viopCalculatorExports: {
            ViopCalculator: () => React.createElement('div', null, 'no-disclaimer-no-defaults'),
          },
        })
      );

      // 5. /viop-rehber raw <h1> rejection
      assert.throws(() =>
        verifyViopRehberPage(fx.viopRehberPage + '<h1>Duplicate</h1>')
      );

      // 6. C1 pre-existing menu group rejection + nested <ul> rejection + mirror mismatch + missing /privacy
      const badNav = JSON.parse(fx.navJsonText);
      badNav[2].items.push(badNav[3].items[0]);
      badNav.pop();
      assert.throws(() =>
        verifyNavigationAndMirrors({
          navJsonText: JSON.stringify(badNav),
          rsiIconsSvg: fx.rsiIconsSvg,
          publicIndexHtml: fx.publicIndexHtml,
          pythonIndexHtml: fx.pythonIndexHtml,
          publicMtfHtml: fx.publicMtfHtml,
          pythonMtfHtml: fx.pythonMtfHtml,
          viopRehberPageExists: true,
        })
      );
      assert.throws(() =>
        verifyNavigationAndMirrors({
          navJsonText: fx.navJsonText,
          rsiIconsSvg: fx.rsiIconsSvg,
          publicIndexHtml: fx.publicIndexHtml.replace('</ul>', '<ul><li>nested</li></ul></ul>'),
          pythonIndexHtml: fx.pythonIndexHtml,
          publicMtfHtml: fx.publicMtfHtml,
          pythonMtfHtml: fx.pythonMtfHtml,
          viopRehberPageExists: true,
        })
      );
      assert.throws(() =>
        verifyNavigationAndMirrors({
          navJsonText: fx.navJsonText,
          rsiIconsSvg: fx.rsiIconsSvg,
          publicIndexHtml: fx.publicIndexHtml,
          pythonIndexHtml: fx.pythonIndexHtml + '<!-- drift -->',
          publicMtfHtml: fx.publicMtfHtml,
          pythonMtfHtml: fx.pythonMtfHtml,
          viopRehberPageExists: true,
        })
      );
      assert.throws(() =>
        verifyNavigationAndMirrors({
          navJsonText: fx.navJsonText,
          rsiIconsSvg: fx.rsiIconsSvg,
          publicIndexHtml: fx.publicIndexHtml.replace('href="/privacy"', 'href="/removed"'),
          pythonIndexHtml: fx.pythonIndexHtml.replace('href="/privacy"', 'href="/removed"'),
          publicMtfHtml: fx.publicMtfHtml,
          pythonMtfHtml: fx.pythonMtfHtml,
          viopRehberPageExists: true,
        })
      );

      // 7. app.js altered navigation slice rejection (including 1-char BUG-5c, BUG-5d, BUG-5e mutations)
      assert.throws(() => verifyAppJsNavigationSlice('const x = 1;'));
      assert.throws(
        () =>
          verifyAppJsNavigationSlice(
            fx.appJs.replace('.nav-links a[href^="#"]', '.nav-linkx a[href^="#"]')
          ),
        'BUG-5c: 1-char mutation in .nav-links selector must throw'
      );
      assert.throws(
        () =>
          verifyAppJsNavigationSlice(
            fx.appJs.replace("'active', link.getAttribute", "'xctive', link.getAttribute")
          ),
        'BUG-5d: 1-char mutation in active class toggle must throw'
      );
      assert.throws(
        () => verifyAppJsNavigationSlice(fx.appJs.replace('working.', 'workinx.')),
        'BUG-5e: 1-char mutation in slice comment must throw'
      );

      // 8. Screen integration missing /viop-rehber
      assert.throws(() =>
        verifyScreenIntegrations({
          ...fx.screenSources,
          analysisPageSource: '<WorkspacePage><InteractiveChartWrapper /></WorkspacePage>',
        })
      );

      // 9. VM loader blocks fs/child_process
      assert.throws(() =>
        loadTsModule(path.join(ROOT, 'src/lib/evil.ts'), {
          rootDir: ROOT,
          virtualFiles: {
            [path.join(ROOT, 'src/lib/evil.ts')]:
              'const fs = require("fs"); export const x = fs;',
          },
        })
      );
    });
  });
} else {
  describe('E2E Offline Opaque-Box Contract & SSR Suite (R1–R4)', () => {
    const readRepoFile = (relPath) => {
      const fullPath = path.join(ROOT, relPath);
      assert.ok(fs.existsSync(fullPath), `Required file missing: ${relPath}`);
      return fs.readFileSync(fullPath, 'utf8');
    };

    test('R1: docs/viop_reference_spec.md aligns with Takasbank/BIST rules & R3 thresholds', () => {
      const specText = readRepoFile('docs/viop_reference_spec.md');
      verifyReferenceSpec(specText);
    });

    test('R3: src/lib/viop.ts math engine, 41-symbol parity, leverage bands, and rollover', () => {
      const longShortPy = readRepoFile('python_bot/engine/signals/long_short_matrix.py');
      const expectedSymbols = parseExpectedViopSymbols(longShortPy);
      const viopPath = path.join(ROOT, 'src/lib/viop.ts');
      assert.ok(fs.existsSync(viopPath), 'Required file missing: src/lib/viop.ts');
      const viopExports = loadTsModule(viopPath, { rootDir: ROOT });
      verifyViopMathEngine(viopExports, expectedSymbols);
    });

    test('R3: scripts/test_viop_calculator.cjs exists, covers contracts, and exits 0', () => {
      const testRel = 'scripts/test_viop_calculator.cjs';
      const testSource = readRepoFile(testRel);
      verifyViopUnitTestsFile(path.join(ROOT, testRel), testSource, {
        runChild: true,
        cwd: ROOT,
      });
    });

    test('R2: src/lib/glossary.ts has >=25 unique entries and zero dangling <TermHint id> across src/', () => {
      const glossaryPath = path.join(ROOT, 'src/lib/glossary.ts');
      assert.ok(fs.existsSync(glossaryPath), 'Required file missing: src/lib/glossary.ts');
      const glossaryExports = loadTsModule(glossaryPath, { rootDir: ROOT });
      verifyGlossaryData(glossaryExports);

      const srcFilesMap = {};
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (/\.(ts|tsx)$/.test(entry.name)) {
            srcFilesMap[path.relative(ROOT, full)] = fs.readFileSync(full, 'utf8');
          }
        }
      };
      walk(path.join(ROOT, 'src'));
      verifyDanglingTermHints(srcFilesMap, glossaryExports);
    });

    test('R2/R3: SSR render of GlossaryTooltip, PlainGuideBanner, and ViopCalculator', () => {
      const tooltipPath = path.join(ROOT, 'src/components/GlossaryTooltip.tsx');
      const bannerPath = path.join(ROOT, 'src/components/PlainGuideBanner.tsx');
      const calcPath = path.join(ROOT, 'src/components/ViopCalculator.tsx');
      for (const p of [tooltipPath, bannerPath, calcPath]) {
        assert.ok(fs.existsSync(p), `Required file missing: ${path.relative(ROOT, p)}`);
      }
      const cache = new Map();
      const glossaryTooltipExports = loadTsModule(tooltipPath, { rootDir: ROOT, cache });
      const plainGuideBannerExports = loadTsModule(bannerPath, { rootDir: ROOT, cache });
      const viopCalculatorExports = loadTsModule(calcPath, { rootDir: ROOT, cache });
      verifyComponentsSsr({
        glossaryTooltipExports,
        plainGuideBannerExports,
        viopCalculatorExports,
      });
    });

    test('R4: src/app/viop-rehber/page.tsx uses <WorkspacePage>, no raw <h1>, 5 sections & 3 presets', () => {
      const pageSource = readRepoFile('src/app/viop-rehber/page.tsx');
      verifyViopRehberPage(pageSource);
    });

    test('R4: Brand-new navigation group, flat HTML sidebars, /privacy footer, and byte-for-byte static mirrors', () => {
      verifyNavigationAndMirrors({
        navJsonText: readRepoFile('src/lib/system-navigation.json'),
        rsiIconsSvg: readRepoFile('public/static/rsi-icons.svg'),
        publicIndexHtml: readRepoFile('public/index.html'),
        pythonIndexHtml: readRepoFile('python_bot/static/index.html'),
        publicMtfHtml: readRepoFile('public/mtf-lab.html'),
        pythonMtfHtml: readRepoFile('python_bot/static/mtf-lab.html'),
        viopRehberPageExists: fs.existsSync(path.join(ROOT, 'src/app/viop-rehber/page.tsx')),
      });
    });

    test('R2: public/static/app.js preserves Navigation slice (lines 63-80) and wires legend + /viop-rehber', () => {
      verifyAppJsNavigationSlice(readRepoFile('public/static/app.js'));
    });

    test('R2/R4: Existing screens integrate <PlainGuideBanner>, <TermHint>, legend, and 🧮 VİOP Planı', () => {
      verifyScreenIntegrations({
        semihChartSource: readRepoFile('src/components/SemihDivergenceChart.tsx'),
        labPageSource: readRepoFile('src/app/lab/page.tsx'),
        impulseLabPageSource: readRepoFile('src/app/impulse-lab/page.tsx'),
        analysisPageSource: readRepoFile('src/app/analysis/[symbol]/page.tsx'),
      });
    });
  });
  }
}

module.exports = {
  loadTsModule,
  parseExpectedViopSymbols,
  verifyReferenceSpec,
  verifyViopMathEngine,
  verifyViopUnitTestsFile,
  verifyGlossaryData,
  verifyDanglingTermHints,
  verifyComponentsSsr,
  verifyViopRehberPage,
  verifyNavigationAndMirrors,
  verifyAppJsNavigationSlice,
  verifyScreenIntegrations,
};
