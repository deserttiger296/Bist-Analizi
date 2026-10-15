// Exercise the real scanner with offline market/backend dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

for (const mode of ['shadow', 'decide', undefined, 'invalid']) {
  test(`scanner only upgrades explicit decide mode (${mode})`, async () => {
    const result = { symbol: 'THYAO', status: 'IZLE', confluenceScore: 50, quote: {}, reasons: [] };
    const modules = {
      '@/lib/bist': { scanBistSymbols: async () => [result] },
      '@/lib/bist100': { BIST_SYMBOLS: ['THYAO'] },
      './cache': { Cache: { get: async () => null, set: async () => {} } },
      '@/lib/db': { isPostgresAvailable: () => false },
      '@/lib/sniperEngine': { getSniperScanAll: async () => ({ data: [{
        symbol: 'THYAO', decision_mode: mode, sniper_approved: true,
        sniper_label: 'RF', confluence_label: 'RF',
      }] }) },
    };
    const filename = path.join(__dirname, '../src/lib/backgroundScanner.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const context = {
      exports: {}, global: {}, console: { log() {}, warn() {}, error() {} },
      setInterval: () => 1,
      require: (id) => {
        assert.ok(Object.hasOwn(modules, id), `Unexpected dependency ${id}`);
        return modules[id];
      },
    };
    vm.runInNewContext(code, context, { filename });
    await context.exports.runBackgroundScan();
    assert.equal(result.status, mode === 'decide' ? 'AL' : 'IZLE');
    assert.equal(Boolean(result.alert), mode === 'decide');
    assert.ok(result.quote.sniper, 'shadow scores remain attached for inspection');
  });
}
