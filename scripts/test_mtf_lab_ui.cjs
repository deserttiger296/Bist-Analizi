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
  const nodes = Object.fromEntries(['list', 'status', 'scan', 'detail', 'symbol-form', 'symbol', 'other-list'].map(name => [name, new Element()]));
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

test('original RSI section is the default and market controls follow the selected section', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/static/app.js'), 'utf8');
  const navigation = source.slice(source.indexOf('    // Navigation'), source.indexOf('    const modals'));
  const sections = ['dashboard', 'rsipu30', 'weights'].map(id => ({ id, classList: { toggle(name, value) { this[name] = value; } } }));
  const controls = { hidden: false }, events = {};
  const context = {
    window: { location: { hash: '' }, addEventListener(name, callback) { events[name] = callback; } },
    document: { querySelectorAll: selector => selector === '.view-section' ? sections : [], getElementById: () => controls },
  };
  vm.runInNewContext(navigation, context);
  assert.equal(sections[1].classList.active, true);
  assert.equal(controls.hidden, true);
  context.window.location.hash = '#dashboard'; events.hashchange();
  assert.equal(sections[0].classList.active, true);
  assert.equal(controls.hidden, false);
  context.window.location.hash = '#rsipu30'; events.hashchange();
  assert.equal(sections[1].classList.active, true);
  assert.equal(controls.hidden, true);
});


test('return to main application points to its control panel', () => {
  for (const name of ['../public/index.html', '../python_bot/static/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, name), 'utf8');
    const sidebar = html.slice(html.indexOf('<ul class="nav-links">'));
    assert.match(sidebar, /<li><a href="\/">/);
    assert.doesNotMatch(sidebar.split('</li>')[0], /href="\/scanner"/);
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


test('classic navigation stays in the original application', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const sidebar = html.slice(html.indexOf('<ul class="nav-links">'), html.indexOf('</ul>'));
  for (const [, href] of sidebar.matchAll(/href="([^"]+)"/g)) {
    assert.ok(href === '/' || href.startsWith('#'), `Unexpected external application link: ${href}`);
  }
  const config = fs.readFileSync(path.join(__dirname, '../next.config.ts'), 'utf8');
  for (const route of ['/news', '/backtest']) {
    assert.ok(config.replaceAll('\r', '').includes(`source: "${route}",\n        destination: "/index.html#rsipu30"`));
  }
});
