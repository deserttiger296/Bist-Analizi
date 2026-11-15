const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(dataset = {}) { this.dataset = dataset; this.events = {}; this.children = []; this.attributes = {}; this.hidden = false; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  trigger(name, event = {}) { return this.events[name]?.(event); }
}

function row(symbol, state) {
  return { symbol, data_statuses: { '1h': 'FRESH' }, decision: {
    state, label: state, action: 'Lab action', daily_structure: { status: 'INTACT', current_rsi: 33.1, d1_rsi: 23.3, support: 21.12, reason: 'Daily reason' },
    layer_flags: { '1S_PU': true, '4S_PU': false }, resistance: 21.34,
    macro_fibonacci: { status: 'NOT_CONFIRMED', levels: [] },
    lower_timeframes: { timeframes: {} },
  } };
}

function setup() {
  const classic = new Element(), lab = new Element();
  classic.textContent = 'Classic content and chart state'; lab.hidden = false;
  const tabs = [new Element({ strategyTab: 'classic' }), new Element({ strategyTab: 'lab' })];
  const filters = ['EARLY_REACTION', 'FULL_CONFIRMATION', 'LOWER_TF_NU_PRESSURE'].map(state => new Element({ labFilter: state }));
  const nodes = Object.fromEntries(['list', 'status', 'scan', 'detail', 'symbol-form', 'symbol', 'other-list', 'summary', 'errors', 'cancel'].map(name => [name, new Element()]));
  nodes.symbol.value = 'ISCTR';
  lab.querySelector = selector => nodes[selector.slice(10, -1)];
  lab.querySelectorAll = () => filters;
  const calls = [], rows = [row('ONE', 'EARLY_REACTION'), row('TWO', 'FULL_CONFIRMATION'), row('THREE', 'LOWER_TF_NU_PRESSURE'), row('VETO', 'DAILY_VETO')];
  const sidebar = new Element();
  const windowEvents = {};
  const context = {
    window: { location: { hash: '' }, addEventListener(name, callback) { windowEvents[name] = callback; }, dispatchEvent(event) { windowEvents[event.type]?.(event); } }, Event, AbortController, setTimeout: () => 1, clearTimeout() {},
    document: {
      getElementById: id => id === 'mtf-lab-container' ? lab : classic,
      addEventListener() {}, querySelectorAll: selector => selector.startsWith('.nav-links') ? [sidebar] : tabs, createElement: () => new Element(),
    },
    fetch: async url => { calls.push(url); return { ok: true, json: async () => ({
      status: 'success', data: url.endsWith('/ISCTR') ? row('ISCTR', 'LOWER_TF_NU_PRESSURE') : { rows, errors: [] },
    }) }; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/static/mtf-lab.js'), 'utf8'), context);
  context.window.initMtfLab();
  return { classic, lab, tabs, filters, nodes, calls, context, sidebar };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('scan summary distinguishes full confirmation from pending data states', async () => {
  const ui = setup();
  ui.nodes.scan.trigger('click');
  await flush();
  assert.equal(ui.nodes.summary.children[0].children[1].textContent, '4');
  assert.equal(ui.nodes.summary.children[1].children[1].textContent, '1');
  assert.equal(ui.nodes.summary.children[2].children[1].textContent, '1');
  assert.equal(ui.lab.attributes['aria-busy'], 'false');
  assert.equal(ui.nodes.cancel.hidden, true);
});

test('cancel stops the request and restores controls', async () => {
  const ui = setup();
  ui.context.fetch = async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
  });
  ui.nodes.scan.trigger('click');
  assert.equal(ui.lab.attributes['aria-busy'], 'true');
  assert.equal(ui.nodes.cancel.hidden, false);
  ui.nodes.cancel.trigger('click');
  await flush();
  assert.equal(ui.nodes.scan.disabled, false);
  assert.match(ui.nodes.status.textContent, /iptal/);
});

test('partial data warnings are visible with the affected symbol', async () => {
  const ui = setup();
  ui.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'partial', data: { rows: [], errors: [{ symbol: 'THYAO', error: 'timeout' }] } }) });
  ui.nodes.scan.trigger('click');
  await flush();
  assert.equal(ui.nodes.errors.hidden, false);
  assert.match(ui.nodes.errors.children[1].textContent, /THYAO: timeout/);
});

test('separate lab starts idle and uses only its own endpoint on scan', async () => {
  const ui = setup();
  assert.equal(ui.calls.length, 0);
  ui.nodes.scan.trigger('click');
  await flush();
  assert.deepEqual(ui.calls, ['/api/mtf-lab']);
  assert.equal(ui.filters[2].textContent.includes('(1)'), true);
  assert.match(ui.nodes['other-list'].children[0].children[0].textContent, /VETO/);
  assert.match(ui.nodes['other-list'].children[0].children[1].textContent, /Daily reason/);
  ui.filters[2].trigger('click');
  assert.equal(ui.nodes.list.children[0].dataset.state, 'LOWER_TF_NU_PRESSURE');
  assert.match(ui.nodes.list.children[0].children[2].textContent, /1S PU: var.*33,1.*21,12.*Daily reason/);
  ui.context.window.initMtfLab();
  assert.equal(ui.calls.length, 1);
  ui.nodes['symbol-form'].trigger('submit', { preventDefault() {} });
  await flush();
  assert.deepEqual(ui.calls, ['/api/mtf-lab', '/api/mtf-lab/ISCTR']);
  assert.match(ui.nodes.detail.children[0].textContent, /ISCTR/);
});

test('classic and laboratory pages load separate scripts and containers', () => {
  const classic = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const lab = fs.readFileSync(path.join(__dirname, '../public/mtf-lab.html'), 'utf8');
  assert.match(classic, /id="rsipu30"/);
  assert.match(classic, /src="\/static\/app.js/);
  assert.doesNotMatch(classic, /src="\/static\/mtf-lab.js|id="mtf-lab-container"|data-strategy-tab/);
  assert.match(lab, /id="mtf-lab-container"/);
  assert.match(lab, /src="\/static\/mtf-lab.js/);
  assert.doesNotMatch(lab, /src="\/static\/app.js|id="rsipu30"|data-strategy-tab/);
  assert.match(classic, /href="\/mtf-lab.html"/);
  assert.match(lab, /href="\/index.html#rsipu30"/);
});

test('RSI is the default and old market hashes route to the canonical scanner', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/static/app.js'), 'utf8');
  const navigation = source.slice(source.indexOf('    // Navigation'), source.indexOf('    const modals'));
  const sections = ['dashboard', 'rsipu30', 'weights'].map(id => ({ id, classList: { toggle(name, value) { this[name] = value; } } }));
  const controls = { hidden: false }, events = {}, redirects = [];
  const context = {
    window: { location: { hash: '', replace(url) { redirects.push(url); } }, addEventListener(name, callback) { events[name] = callback; } },
    document: { querySelectorAll: selector => selector === '.view-section' ? sections : [], getElementById: () => controls },
  };
  vm.runInNewContext(navigation, context);
  assert.equal(sections[1].classList.active, true);
  context.window.location.hash = '#dashboard'; events.hashchange();
  assert.deepEqual(redirects, ['/scanner']);
  context.window.location.hash = '#rsipu30'; events.hashchange();
  assert.equal(sections[1].classList.active, true);
});

require('./test_workspace_ui.cjs');


test('brand returns to the actual RSI workspace', () => {
  for (const name of ['../public/index.html', '../python_bot/static/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.match(html, /class="rsi-brand" href="\/index.html"/);
    assert.match(html, /id="rsipu30" class="view-section active"/);
  }
});


test('legacy RSI URLs redirect to the original UI rather than MOSTRSI cards', () => {
  const config = fs.readFileSync(path.join(__dirname, '../next.config.ts'), 'utf8');
  assert.match(config, /source: "\/rsi-pu30",\s*destination: "\/index.html#rsipu30"/);
  assert.match(config, /source: "\/rsi-pu30\/:symbol",\s*destination: "\/index.html\?symbol=:symbol#rsipu30"/);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.doesNotMatch(html, /href="\/rsi-pu30"/);
});


test('shared navigation exposes registered systems without obsolete routes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const sidebar = html.slice(html.indexOf('<ul class="nav-links">'), html.indexOf('</ul>'));
  const groups = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/lib/system-navigation.json'), 'utf8'));
  const registered = groups.flatMap(group => group.items.map(item => item.href));
  for (const [, href] of sidebar.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    assert.ok(registered.includes(href), `Unregistered system link: ${href}`);
  }
  for (const href of ['/lab', '/mtf-lab.html', '/agentic-ai', '/signal-terminal']) assert.ok(sidebar.includes(`href="${href}"`));
  const config = fs.readFileSync(path.join(__dirname, '../next.config.ts'), 'utf8');
  for (const route of ['/news', '/backtest']) {
    assert.ok(config.replaceAll('\r', '').includes(`source: "${route}",\n        destination: "/index.html#rsipu30"`));
  }
});

test('shared mobile menu opens, closes with Escape and marks the selected section', () => {
  const events = {}, toggle = new Element(), overlay = new Element();
  toggle.focus = () => { toggle.focused = true; };
  const links = ['/index.html#rsipu30', '/index.html#weights', '/lab'].map(href => {
    const link = new Element();
    link.getAttribute = () => href;
    link.removeAttribute = name => { delete link.attributes[name]; };
    return link;
  });
  const root = { dataset: {} }, sidebar = { querySelectorAll: () => links };
  const context = {
    window: { location: { pathname: '/index.html', hash: '' }, addEventListener: (name, fn) => { events[name] = fn; } },
    document: { body: root, addEventListener: (name, fn) => { events[name] = fn; }, getElementById: id => ({'rsi-menu-toggle': toggle, 'rsi-menu-overlay': overlay, 'rsi-sidebar': sidebar})[id] },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/static/app-shell.js'), 'utf8'), context);
  events.DOMContentLoaded();
  assert.equal(links[0].attributes['aria-current'], 'page');
  toggle.trigger('click');
  assert.equal(root.dataset.menuOpen, 'true');
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  events.keydown({ key: 'Escape' });
  assert.equal(root.dataset.menuOpen, 'false');
  assert.equal(toggle.focused, true);
  context.window.location.hash = '#weights'; events.hashchange();
  assert.equal(links[0].attributes['aria-current'], undefined);
  assert.equal(links[1].attributes['aria-current'], 'page');
  toggle.trigger('click'); links[2].trigger('click');
  assert.equal(root.dataset.menuOpen, 'false');
});
