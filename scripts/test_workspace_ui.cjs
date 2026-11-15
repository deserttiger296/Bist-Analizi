const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function components() {
  const filename = path.join(__dirname, '../src/components/ui/Workspace.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, module, module.exports);
  return module.exports;
}

test('workspace has one page heading and keeps functional actions and content', () => {
  const { WorkspacePage, Panel } = components();
  const result = renderToStaticMarkup(React.createElement(WorkspacePage, { title: 'Hisse analizi', description: 'Açıklama', actions: React.createElement('button', null, 'Yenile') }, React.createElement(Panel, { title: 'Veri' }, 'Gerçek içerik')));
  assert.equal((result.match(/<h1\b/g) || []).length, 1);
  assert.match(result, /<h1[^>]*>Hisse analizi/);
  assert.match(result, /<h2[^>]*>Veri/);
  assert.match(result, /<button>Yenile<\/button>/);
  assert.match(result, /Gerçek içerik/);
  const descriptionOnly = renderToStaticMarkup(React.createElement(Panel, { description: 'Kaynak açıklaması' }, 'Veri'));
  assert.match(descriptionOnly, /Kaynak açıklaması/);
});

test('unknown metrics and empty states stay explicit without fabricating success', () => {
  const { MetricCard, EmptyState } = components();
  const metric = renderToStaticMarkup(React.createElement(MetricCard, { label: 'Başarı', value: null, detail: 'Henüz ölçülmedi' }));
  assert.match(metric, /—/);
  assert.match(metric, /Henüz ölçülmedi/);
  assert.doesNotMatch(metric, /0%|100%/);
  const empty = renderToStaticMarkup(React.createElement(EmptyState, { title: 'Veri alınamadı', description: 'Yeniden deneyin', action: React.createElement('button', null, 'Tekrar dene') }));
  assert.match(empty, /Veri alınamadı/);
  assert.match(empty, /Tekrar dene/);
});
