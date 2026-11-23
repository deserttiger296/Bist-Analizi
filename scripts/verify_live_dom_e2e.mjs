import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PREEXISTING_NAV_GROUPS = new Set(['ANALİZ', 'ARAŞTIRMA VE TEST', 'ARAÇLAR']);
const CONTRACT_CODE_RE = /F_[A-Z0-9]{3,6}(0[1-9]|1[0-2])\d{2}/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function buildApiFixtures() {
  const nowSec = Math.floor(Date.UTC(2026, 10, 23, 10, 0, 0) / 1000);
  const bars = Array.from({ length: 40 }, (_, i) => {
    const base = 292 + Math.sin(i / 4) * 8 + i * 0.25;
    return {
      time: nowSec - (40 - i) * 3600,
      open: Number((base - 0.8).toFixed(2)),
      high: Number((base + 1.9).toFixed(2)),
      low: Number((base - 2.1).toFixed(2)),
      close: Number(base.toFixed(2)),
      rsi: Number((45 + Math.sin(i / 3) * 22).toFixed(2)),
      rsi_sma: Number((47 + Math.sin(i / 4) * 14).toFixed(2)),
    };
  });

  const thyaoImpulse = {
    durum: '1_2_yapisi_hazir',
    quality_grade: 'A+',
    quality_label: 'A+ İdeal 1-2',
    quality_score: 92,
    gvt_gkd_aligned: true,
    p0_price: 280.0,
    t0_date: '2026-11-10',
    dalga1: { p1_price: 310.0, move_pct: 10.7, duration_bars: 12, rsi_delta: 28, vol_ratio: 1.6 },
    dalga2: { p2_price: 292.0, price_retracement_fib: '0.600', duration_bars: 7, t2_date: '2026-11-18' },
    dalga3_takip: {
      extreme_price_after_w2: 312.0,
      w3_vs_w1_pct: 66.7,
      w1_tepesi_kirildi: true,
      extreme_date_after_w2: '2026-11-22',
    },
    fib_fiyat_hedefleri: {
      '1.000': { pct_label: '%100', target_from_w2: 322.0, target_log: 323.3, zone_low: 320, zone_high: 324, reached: false, reached_log: false },
      '1.618': { pct_label: '%161.8', target_from_w2: 340.5, target_log: 344.2, zone_low: 339, zone_high: 342, reached: false, reached_log: false },
      '2.618': { pct_label: '%261.8', target_from_w2: 370.5, target_log: 381.0, zone_low: 368, zone_high: 373, reached: false, reached_log: false },
      '3.618': { pct_label: '%361.8', target_from_w2: 400.5, target_log: 421.8, zone_low: 398, zone_high: 403, reached: false, reached_log: false },
    },
    fib_zaman_w1_referans: {},
    fib_zaman_02_sundurme: {},
  };

  return {
    health: {
      status: 'ok',
      rf_model: { present: true, weights: { rsi: 0.35, trend: 0.35, volume: 0.3 } },
      lstm: { usable: true },
      sentiment_engine: 'lexicon',
    },
    longshort: {
      status: 'success',
      longs: [
        {
          symbol: 'VAKBN',
          interval: '1h',
          is_viop: true,
          triggered: true,
          status_text: 'GVT Üstü Onaylı',
          last_close: 25.0,
          entry_level: 25.0,
          gvt_price: 25.0,
          stop_loss: 23.0,
          target_tp1: 29.0,
          rr_ratio: 2.0,
        },
        {
          symbol: 'ENERY',
          interval: '1h',
          is_viop: false,
          triggered: true,
          status_text: 'Spot Onaylı',
          last_close: 19.5,
          entry_level: 19.5,
          gvt_price: 19.5,
          stop_loss: 18.0,
          target_tp1: 22.5,
          rr_ratio: 2.0,
        },
      ],
      shorts: [
        {
          symbol: 'THYAO',
          interval: '1h',
          is_viop: true,
          triggered: false,
          status_text: 'GKD Bekleniyor',
          last_close: 302.0,
          entry_level: 300.0,
          gkd_price: 300.0,
          stop_loss: 310.0,
          target_tp1: 280.0,
          rr_ratio: 2.0,
          tepe1_rsi: 74.2,
          tepe2_rsi: 65.1,
        },
      ],
    },
    nu70lab: {
      status: 'success',
      strict_signals: [
        {
          symbol: 'THYAO',
          interval: '15m',
          is_viop: true,
          triggered: false,
          status_text: '15dk Tuzak Riski',
          last_close: 300.0,
          gkd_price: 298.0,
          stop_loss: 310.0,
          target_1r: 288.0,
          target_tp1: 276.0,
          rr_ratio: 2.0,
          tepe1_price: 305,
          tepe1_rsi: 75,
          tepe2_price: 308,
          tepe2_rsi: 64,
          candle_label: 'Asılan Adam',
          is_hanging_man: true,
          fractal_phase_code: 'TUZAK_15DK_YENI_ZIRVE_BEKLENIR',
          fractal_phase_badge: '⚠️ 15dk Tuzak',
          bars_since_confirm: 2,
        },
      ],
      early_candidates: [
        {
          symbol: 'AKBNK',
          interval: '1h',
          is_viop: true,
          gkd_broken: false,
          last_close: 60.0,
          entry_level: 59.0,
          stop_loss: 62.0,
          tepe1_price: 61,
          tepe1_rsi: 73,
          tepe2_price: 61.5,
          tepe2_rsi: 66,
          candle_label: 'Erken Tepe',
        },
      ],
      oversold_dip_watch: [
        {
          symbol: 'VAKBN',
          interval: '15m',
          is_viop: true,
          has_reaction: false,
          oversold_price: 24.0,
          oversold_rsi: 26.4,
          oversold_date: '2026-11-23',
          last_close: 23.8,
          current_rsi: 25.1,
          explanation: 'Tepkisiz aşırı satım; şelale riski.',
        },
      ],
    },
    impulseScan: {
      status: 'success',
      items: [
        {
          symbol: 'THYAO',
          interval: '1h',
          direction: 'BULL',
          last_close: 305.0,
          impulse: thyaoImpulse,
        },
      ],
    },
    impulseChart: {
      status: 'success',
      symbol: 'THYAO',
      impulse: thyaoImpulse,
    },
    rsiScan: {
      status: 'success',
      data: {
        scanned: 30,
        attempted: 30,
        signals: [
          {
            symbol: 'THYAO',
            type: 'PU30',
            trend: 'BULL',
            last_close: 302.5,
            dip1: { price: 290, rsi: 27.1, date: '2026-11-12' },
            dip2: { price: 288, rsi: 34.8, date: '2026-11-19' },
            bounce_pct: 5.0,
          },
        ],
      },
    },
    rsiDetail: {
      status: 'success',
      data: {
        symbol: 'THYAO',
        interval: '1h',
        bars,
        signal: {
          type: 'PU30',
          trend: 'BULL',
          bounce_pct: 5.0,
          dip1: { price: 290, rsi: 27.1, time: bars[8].time },
          dip2: { price: 288, rsi: 34.8, time: bars[22].time },
          guven_tazeleyen_tepe: { price: 300.0 },
          saatlik_seviye: { price: 300.0, durum: 'onayli', kirildi: true },
        },
      },
    },
  };
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws.removeEventListener('error', onErr);
        resolve();
      };
      const onErr = (err) => {
        this.ws.removeEventListener('open', onOpen);
        reject(err instanceof Error ? err : new Error(String(err?.message || err)));
      };
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', onErr, { once: true });
    });

    this.ws.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data));
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(`CDP error (${msg.error.code}): ${msg.error.message}`));
        } else {
          resolve(msg.result || {});
        }
        return;
      }
      if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) {
          Promise.resolve(fn(msg.params || {})).catch(() => {});
        }
      }
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) {
      this.listeners.set(method, []);
    }
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket not open for ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    for (const { reject } of this.pending.values()) {
      reject(new Error('CDP session closed'));
    }
    this.pending.clear();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

async function launchHeadlessChrome(chromePath) {
  assert.ok(fs.existsSync(chromePath), `Chrome binary not found at ${chromePath}`);
  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bist-e2e-chrome-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
    '--mute-audio',
    'about:blank',
  ];

  const proc = spawn(chromePath, args, {
    stdio: 'ignore',
    windowsHide: true,
  });

  let pageTarget = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) break;
      }
    } catch {
      // Chrome still booting
    }
    await sleep(120);
  }

  const killProcessAndDir = () => {
    try {
      proc.kill();
    } catch {}
    if (process.platform === 'win32' && proc.pid) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
      } catch {}
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  };

  if (!pageTarget) {
    killProcessAndDir();
    throw new Error('Timed out waiting for headless Chrome DevTools target');
  }

  const cdp = new CdpSession(pageTarget.webSocketDebuggerUrl);
  try {
    await cdp.connect();
  } catch (err) {
    cdp.close();
    killProcessAndDir();
    throw err;
  }

  const cleanup = async () => {
    try {
      await Promise.race([cdp.send('Browser.close'), sleep(600)]);
    } catch {}
    cdp.close();
    await sleep(150);
    killProcessAndDir();
  };

  return { proc, port, userDataDir, cdp, cleanup };
}

async function evalJs(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    const desc =
      res.exceptionDetails.exception?.description ||
      res.exceptionDetails.text ||
      'Runtime.evaluate exception';
    throw new Error(desc);
  }
  return res.result ? res.result.value : undefined;
}

async function waitFor(cdp, predicateExpr, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evalJs(cdp, predicateExpr);
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(100);
  }
  throw new Error(
    `Timed out waiting for [${label}] after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`
  );
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await sleep(60);
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitFor(
    cdp,
    `(() => document.readyState === 'complete' && Boolean(document.body))()`,
    `document ready for ${url}`,
    25000
  );
  await sleep(250);
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await sleep(100);
}

const VIOP_MODAL_FINDER_JS = `(() => {
  const isVis = (el) => {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-viop-modal]'));
  const calcDialog = dialogs.find((d) => isVis(d) && (
    d.hasAttribute('data-viop-modal') ||
    /F_[A-Z0-9]+|SPK|Sermaye|Kontrat/i.test(d.textContent || '')
  ));
  if (calcDialog) return calcDialog;
  const fixedOverlays = Array.from(document.querySelectorAll('div.fixed.inset-0, div.fixed'));
  return fixedOverlays.find((el) => {
    if (!isVis(el)) return false;
    const t = el.textContent || '';
    return (el.querySelectorAll('input').length >= 3 || /SPK/i.test(t)) && /F_[A-Z0-9]+|Kontrat/i.test(t);
  }) || null;
})()`;

const SAFETY_BANNER_CHECK_JS = `(rootEl) => {
  const scope = rootEl || document;
  const isVisible = (el) => {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return el.offsetParent !== null && r.width > 0 && r.height > 0;
  };
  const nonButtonText = (el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button').forEach((b) => b.remove());
    return (clone.innerText || clone.textContent || '').trim();
  };
  const candidates = Array.from(
    scope.querySelectorAll(
      '[role="alert"], [role="status"], [data-safety-banner], .workspace-notice'
    )
  );
  const matched = [];
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const txt = nonButtonText(el);
    if (!txt) continue;
    if (/^Yasal Uyarı\\s*\\(SPK/i.test(txt)) continue;
    if (/(erken pozisyon açma|teyit bekle|teyit bekleniyor|işlem açma|dip avlama|tuzak|kırılımı gelmedi|1s onayını bekle|tepkisiz düşüş|\\buyar[ıi]\\b)/i.test(txt)) {
      matched.push(txt);
    }
  }
  return matched;
}`;

async function assertNoHorizontalOverflow(cdp, label, expectedWidth) {
  const dims = await evalJs(
    cdp,
    `(() => ({
      scrollWidth: Math.max(
        document.documentElement.scrollWidth || 0,
        document.body ? document.body.scrollWidth : 0
      ),
      clientWidth: document.documentElement.clientWidth || 0,
      innerWidth: window.innerWidth || 0,
      path: window.location.pathname + window.location.hash
    }))()`
  );
  const boundWidth = expectedWidth
    ? Math.min(dims.clientWidth || expectedWidth, expectedWidth)
    : (dims.clientWidth || dims.innerWidth);
  assert.ok(
    dims.scrollWidth <= boundWidth + 1,
    `Horizontal overflow on ${label} (${dims.path}): scrollWidth=${dims.scrollWidth} > boundWidth=${boundWidth} (clientWidth=${dims.clientWidth}, innerWidth=${dims.innerWidth})`
  );
}

async function assertSidebarNewGroupAndLink(cdp, label, { isMobile = false } = {}) {
  if (isMobile) {
    await evalJs(
      cdp,
      `(() => {
        const btn = document.getElementById('rsi-menu-toggle');
        if (btn) btn.click();
        return Boolean(btn);
      })()`
    );
    await sleep(120);
  }

  const navCheck = await evalJs(
    cdp,
    `(() => {
      const aside = document.getElementById('rsi-sidebar') || document.querySelector('aside, nav');
      if (!aside) return { ok: false, reason: 'missing sidebar' };
      const link = aside.querySelector('a[href="/viop-rehber"]');
      if (!link) return { ok: false, reason: 'missing /viop-rehber link' };
      const linkText = (link.textContent || '').trim();
      let groupLabel = '';

      // 1. ClientNavigation.tsx nested <ul> structure:
      // <li><div class="rsi-nav-group">GROUP</div><ul class="nav-links"><li><a href="/viop-rehber">...</a></li></ul></li>
      const parentUl = link.closest('ul');
      const prevOfUl = parentUl?.previousElementSibling;
      if (
        prevOfUl &&
        (prevOfUl.classList?.contains('rsi-nav-group') ||
          /group|heading|title|label/i.test(String(prevOfUl.className || '')))
      ) {
        groupLabel = (prevOfUl.textContent || '').trim();
      }
      if (!groupLabel && parentUl?.parentElement) {
        const directGroup = parentUl.parentElement.querySelector(':scope > .rsi-nav-group');
        if (directGroup) {
          groupLabel = (directGroup.textContent || '').trim();
        }
      }

      // 2. Flat <ul class="nav-links"> preceding <li> sibling (index.html / mtf-lab.html)
      if (!groupLabel) {
        const el = link.closest('li') || link;
        let cur = el.previousElementSibling;
        while (cur) {
          const cls = String(cur.className || '');
          if (/group|heading|title|label/i.test(cls) || (cur.tagName === 'LI' && !cur.querySelector('a'))) {
            groupLabel = (cur.textContent || '').trim();
            break;
          }
          cur = cur.previousElementSibling;
        }
      }

      // 3. Explicit [data-nav-group] only (never fall back to .rsi-app / .rsi-brand)
      if (!groupLabel) {
        const groupWrap = link.closest('[data-nav-group]');
        if (groupWrap) {
          const header = groupWrap.querySelector('.rsi-nav-group, h2, h3, [data-nav-group-label]');
          if (header && !header.contains(link)) {
            groupLabel = (header.textContent || '').trim();
          }
        }
      }

      const hasPrivacy = Boolean(aside.querySelector('a[href="/privacy"]'));
      return { ok: true, linkText, groupLabel, hasPrivacy };
    })()`
  );

  assert.ok(navCheck.ok, `${label}: ${navCheck.reason}`);
  assert.ok(
    navCheck.linkText.includes('VİOP & Strateji Rehberi'),
    `${label}: /viop-rehber label mismatch: "${navCheck.linkText}"`
  );
  // C1: never hardcode exact title; ensure non-empty & NOT in pre-existing 3 groups
  assert.ok(
    navCheck.groupLabel.length > 0 && !PREEXISTING_NAV_GROUPS.has(navCheck.groupLabel),
    `${label}: C1 violation — group "${navCheck.groupLabel}" must be a brand-new group outside ${[...PREEXISTING_NAV_GROUPS].join(', ')}`
  );

  if (isMobile) {
    await pressEscape(cdp);
  }
  return navCheck;
}

async function assertTermHintPopoverAndBounds(cdp, label, expectedWidth) {
  const opened = await evalJs(
    cdp,
    `(() => {
      document.querySelectorAll('[data-e2e-active-term-hint]').forEach((el) => {
        delete el.dataset.e2eActiveTermHint;
      });
      const btns = Array.from(document.querySelectorAll('button')).filter(b => {
        const txt = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        return (txt === '?' || /terim|ipucu|açıklama|sözlük/i.test(aria)) && b.offsetParent !== null;
      });
      if (btns.length === 0) return { found: false };
      const btn = btns[0];
      btn.dataset.e2eActiveTermHint = '1';
      btn.scrollIntoView({ block: 'center', inline: 'center' });
      btn.click();
      return {
        found: true,
        expanded: btn.getAttribute('aria-expanded'),
        ariaLabel: btn.getAttribute('aria-label') || '',
        ctrlId: btn.getAttribute('aria-controls') || '',
      };
    })()`
  );
  assert.ok(opened.found, `${label}: expected at least one visible ? <TermHint> button`);
  assert.equal(opened.expanded, 'true', `${label}: ? button must set aria-expanded="true" on click`);
  assert.ok(opened.ariaLabel.length > 0, `${label}: ? button must have non-empty aria-label`);

  await sleep(120);

  const bounds = await evalJs(
    cdp,
    `(() => {
      const btn = document.querySelector('[data-e2e-active-term-hint="1"]');
      const ctrlId = btn ? btn.getAttribute('aria-controls') : ${JSON.stringify(opened.ctrlId || '')};
      const pop =
        (ctrlId && document.getElementById(ctrlId)) ||
        document.querySelector('[role="tooltip"], [data-term-popover], [data-glossary-popover]') ||
        btn?.nextElementSibling;
      if (!pop) return { found: false, ctrlId };
      const r = pop.getBoundingClientRect();
      return {
        found: true,
        ctrlId: ctrlId || pop.id || '',
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        clientWidth: document.documentElement.clientWidth || 0,
        innerWidth: window.innerWidth || 0,
        text: (pop.textContent || '').trim(),
      };
    })()`
  );
  assert.ok(bounds.found && bounds.width > 0 && bounds.height > 0, `${label}: opened ? popover not visible`);
  const boundWidth = expectedWidth
    ? Math.min(bounds.clientWidth || expectedWidth, expectedWidth)
    : (bounds.clientWidth || bounds.innerWidth);
  assert.ok(
    bounds.left >= -1 && bounds.right <= boundWidth + 1,
    `${label}: ? tooltip overflows viewport [${bounds.left}, ${bounds.right}] vs [0, ${boundWidth}] (clientWidth=${bounds.clientWidth}, innerWidth=${bounds.innerWidth})`
  );

  await pressEscape(cdp);
  const closedState = await evalJs(
    cdp,
    `(() => {
      const btn = document.querySelector('[data-e2e-active-term-hint="1"]');
      const expanded = btn ? btn.getAttribute('aria-expanded') : null;
      const ctrlId = ${JSON.stringify(bounds.ctrlId || '')};
      const popEl = ctrlId ? document.getElementById(ctrlId) : null;
      const popVisible = Boolean(
        popEl &&
        window.getComputedStyle(popEl).display !== 'none' &&
        window.getComputedStyle(popEl).visibility !== 'hidden' &&
        popEl.getBoundingClientRect().width > 0
      );
      if (btn) delete btn.dataset.e2eActiveTermHint;
      return { expanded, popVisible };
    })()`
  );
  assert.equal(closedState.expanded, 'false', `${label}: Escape must set clicked ? button aria-expanded="false"`);
  assert.equal(closedState.popVisible, false, `${label}: Escape must remove/hide opened ? popover`);
}

async function verifyViopRehberRoute(cdp, baseUrl) {
  await setViewport(cdp, 1440, 900);
  await navigate(cdp, `${baseUrl}/viop-rehber`);

  await assertSidebarNewGroupAndLink(cdp, '/viop-rehber desktop');
  await assertNoHorizontalOverflow(cdp, '/viop-rehber desktop', 1440);

  const structure = await evalJs(
    cdp,
    `(() => {
      const h1s = document.querySelectorAll('h1');
      const bodyText = document.body.innerText || '';
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        value: i.value,
        type: i.type,
        aria: i.getAttribute('aria-label') || '',
        placeholder: i.getAttribute('placeholder') || ''
      }));
      return {
        h1Count: h1s.length,
        hasSpotVsViop: /Spot/i.test(bodyText) && /VİOP/i.test(bodyText),
        hasCalculator: inputs.some(i => i.value === '100000' || i.value === '100.000'),
        hasPlaybooks: /Strateji|Plan/i.test(bodyText),
        hasMistakes: /Hata|Kontrol/i.test(bodyText),
        hasGlossary: /Sözlük/i.test(bodyText),
        hasSpk: /SPK/i.test(bodyText),
        inputs,
      };
    })()`
  );
  assert.equal(structure.h1Count, 1, '/viop-rehber must render exactly one <h1>');
  assert.ok(structure.hasSpotVsViop, '/viop-rehber missing Spot vs VİOP section');
  assert.ok(structure.hasCalculator, '/viop-rehber calculator default 100000 missing');
  assert.ok(structure.hasPlaybooks, '/viop-rehber playbooks section missing');
  assert.ok(structure.hasMistakes, '/viop-rehber 5 mistakes/checklist section missing');
  assert.ok(structure.hasGlossary, '/viop-rehber glossary section missing');
  assert.ok(structure.hasSpk, '/viop-rehber SPK disclaimer missing');

  // Test the 3 presets: THYAO Short, VAKBN Long, ASELS Bekle/Tuzak
  for (const preset of [
    { name: 'THYAO Short', pattern: 'THYAO', expectSafety: false, assertNoSafety: false },
    { name: 'VAKBN Long', pattern: 'VAKBN', expectSafety: false, assertNoSafety: true },
    { name: 'ASELS Bekle/Tuzak', pattern: 'ASELS', expectSafety: true, assertNoSafety: false },
  ]) {
    const clicked = await evalJs(
      cdp,
      `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => (b.textContent || '').includes(${JSON.stringify(preset.pattern)}));
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    assert.ok(clicked, `/viop-rehber preset button missing for ${preset.name}`);
    await sleep(120);

    const calcState = await evalJs(
      cdp,
      `(() => {
        const text = document.body.innerText || '';
        const checkSafety = ${SAFETY_BANNER_CHECK_JS};
        const visibleSafetyBanners = checkSafety(document);
        return { text, visibleSafetyBanners };
      })()`
    );
    assert.match(
      calcState.text,
      CONTRACT_CODE_RE,
      `/viop-rehber preset ${preset.name} must display F_<SYM>MMYY contract code`
    );
    if (preset.expectSafety) {
      assert.ok(
        calcState.visibleSafetyBanners.length > 0,
        `/viop-rehber preset ${preset.name} must display a visible non-button safety warning banner`
      );
    }
    if (preset.assertNoSafety) {
      assert.equal(
        calcState.visibleSafetyBanners.length,
        0,
        `/viop-rehber preset ${preset.name} must NOT display safety warning banner, found: ${calcState.visibleSafetyBanners.join(' | ')}`
      );
    }
  }

  // Glossary Turkish character search
  const searchResult = await evalJs(
    cdp,
    `(() => {
      const search = document.querySelector('input[type="search"], input[placeholder*="Ara" i], input[aria-label*="Sözlük" i]');
      if (!search) return { found: false };
      const initialCards = document.querySelectorAll('[data-glossary-card], [data-term-id]').length;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(search, 'Kaldıraç');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, initialCards };
    })()`
  );
  assert.ok(searchResult.found, '/viop-rehber missing glossary search input');
  await sleep(100);
  const filteredText = await evalJs(cdp, `document.body.innerText || ''`);
  assert.match(filteredText, /Kaldıraç/i, 'Glossary search must retain matching Turkish term');

  await assertTermHintPopoverAndBounds(cdp, '/viop-rehber desktop', 1440);

  // Mobile 375x812 check
  await setViewport(cdp, 375, 812);
  await assertNoHorizontalOverflow(cdp, '/viop-rehber mobile', 375);
  await assertSidebarNewGroupAndLink(cdp, '/viop-rehber mobile', { isMobile: true });
  await assertTermHintPopoverAndBounds(cdp, '/viop-rehber mobile', 375);
}

async function verifyLabRoute(cdp, baseUrl) {
  await setViewport(cdp, 1440, 900);
  await navigate(cdp, `${baseUrl}/lab#longshort`);

  // Check <PlainGuideBanner> + localStorage persistence across Page.reload (no silent skip!)
  const bannerInitial = await evalJs(
    cdp,
    `(() => {
      const text = document.body.innerText || '';
      const hasLink = Boolean(document.querySelector('a[href="/viop-rehber"]'));
      const hasBanner = Boolean(
        document.querySelector('[data-plain-guide-banner], [data-guide-banner]') ||
        /sade türkçe rehber|adım/i.test(text)
      );
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /^(gizle|kapat|anladım)$/i.test((b.textContent || '').trim()) ||
        b.getAttribute('aria-label')?.match(/rehber|kapat|gizle/i)
      );
      if (btn) btn.click();
      return { hasLink, hasBanner, dismissedClicked: Boolean(btn) };
    })()`
  );
  assert.ok(bannerInitial.hasLink, '/lab#longshort missing /viop-rehber link');
  assert.ok(bannerInitial.hasBanner, '/lab#longshort missing <PlainGuideBanner>');
  assert.ok(bannerInitial.dismissedClicked, '/lab#longshort missing <PlainGuideBanner> Gizle button');

  await sleep(80);
  const keysBeforeReload = await evalJs(cdp, `JSON.stringify(Object.keys(localStorage))`);
  assert.notEqual(keysBeforeReload, '[]', '/lab PlainGuideBanner dismiss must persist to localStorage');

  await cdp.send('Page.reload');
  await waitFor(
    cdp,
    `(() => document.readyState === 'complete' && Boolean(document.body))()`,
    '/lab reload ready',
    25000
  );
  await sleep(250);

  const afterReloadState = await evalJs(
    cdp,
    `(() => {
      const storageValues = Object.values(localStorage);
      const hasShowBtn = Array.from(document.querySelectorAll('button')).some(
        (b) => /rehberi göster/i.test((b.textContent || '').trim())
      );
      const hasVisibleGizle = Array.from(document.querySelectorAll('button')).some(
        (b) => /^gizle$/i.test((b.textContent || '').trim()) && b.offsetParent !== null
      );
      const collapsedAttr = Boolean(document.querySelector('[data-plain-guide-banner][data-collapsed="1"]'));
      return {
        hasDismissedStorage: storageValues.includes('1') || Object.keys(localStorage).length > 0,
        staysCollapsedInDom: hasShowBtn || collapsedAttr || !hasVisibleGizle,
      };
    })()`
  );
  assert.ok(afterReloadState.hasDismissedStorage, 'localStorage banner dismissal must persist across Page.reload');
  assert.ok(afterReloadState.staysCollapsedInDom, '<PlainGuideBanner> must remain collapsed in DOM after Page.reload');

  // Click "⚡ Matrisi Güncelle"
  const scanClicked = await evalJs(
    cdp,
    `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        (b.textContent || '').includes('Matrisi Güncelle')
      );
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  );
  assert.ok(scanClicked, '/lab#longshort missing "⚡ Matrisi Güncelle" button');

  await waitFor(
    cdp,
    `(() => {
      const txt = document.body.innerText || '';
      return txt.includes('THYAO') && txt.includes('VAKBN') && txt.includes('ENERY');
    })()`,
    '/lab longshort cards rendered'
  );

  // Verify non-VIOP ENERY leaf card omits VİOP Planı, while VIOP THYAO leaf card has it
  const cardChecks = await evalJs(
    cdp,
    `(() => {
      const allNodes = Array.from(document.querySelectorAll('[data-symbol], article, .workspace-panel, li, div'));
      const findLeafCard = (sym) => {
        const matches = allNodes.filter((c) => {
          const t = c.textContent || '';
          if (!t.includes(sym) || !t.includes('Grafiği Aç')) return false;
          if (sym === 'ENERY' && (t.includes('THYAO') || t.includes('VAKBN'))) return false;
          if (sym === 'THYAO' && (t.includes('ENERY') || t.includes('VAKBN'))) return false;
          return true;
        });
        return matches.find((c) => !matches.some((other) => other !== c && c.contains(other))) || null;
      };
      const eneryCard = findLeafCard('ENERY');
      const thyaoCard = findLeafCard('THYAO');
      const eneryHasBtn = eneryCard ? (eneryCard.textContent || '').includes('VİOP Planı') : null;
      const thyaoBtn = thyaoCard
        ? Array.from(thyaoCard.querySelectorAll('button')).find((b) => (b.textContent || '').includes('VİOP Planı'))
        : null;
      if (thyaoBtn) thyaoBtn.click();
      return { eneryFound: Boolean(eneryCard), eneryHasBtn, thyaoHasBtn: Boolean(thyaoBtn) };
    })()`
  );
  assert.ok(cardChecks.eneryFound, 'ENERY leaf card must be found in /lab#longshort');
  assert.equal(cardChecks.eneryHasBtn, false, 'Non-VIOP ENERY card in /lab must NOT render VİOP Planı button');
  assert.ok(cardChecks.thyaoHasBtn, 'VIOP THYAO card in /lab must render VİOP Planı button');

  await waitFor(
    cdp,
    `(() => {
      const modal = ${VIOP_MODAL_FINDER_JS};
      return Boolean(modal && /F_THYAO/i.test(modal.textContent || ''));
    })()`,
    '/lab THYAO VİOP Planı modal'
  );
  const thyaoSafety = await evalJs(
    cdp,
    `(() => {
      const modal = ${VIOP_MODAL_FINDER_JS};
      const checkSafety = ${SAFETY_BANNER_CHECK_JS};
      return checkSafety(modal);
    })()`
  );
  assert.ok(thyaoSafety.length > 0, 'Unconfirmed THYAO Short in /lab must show visible safety banner');
  await pressEscape(cdp);
  await waitFor(cdp, `!Boolean(${VIOP_MODAL_FINDER_JS})`, '/lab THYAO modal closed');

  // Switch to #nu70lab and test NU70 scan + trap (THYAO) & no-reaction (VAKBN oversold_dip_watch) safety banners
  await evalJs(cdp, `document.getElementById('lab-tab-nu70lab')?.click()`);
  await sleep(120);
  const nu70ScanClicked = await evalJs(
    cdp,
    `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        (b.textContent || '').includes('NU70 Zirve Taraması Başlat')
      );
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  );
  assert.ok(nu70ScanClicked, '/lab#nu70lab missing "NU70 Zirve Taraması Başlat" button');

  await waitFor(
    cdp,
    `(() => (document.body.innerText || '').includes('THYAO') && (document.body.innerText || '').includes('VAKBN'))()`,
    '/lab nu70lab cards rendered'
  );

  const clickNu70CardModal = async (sym) => {
    const clicked = await evalJs(
      cdp,
      `(() => {
        const allNodes = Array.from(document.querySelectorAll('[data-symbol], article, .workspace-panel, li, div'));
        const matches = allNodes.filter((c) => {
          const t = c.textContent || '';
          if (!t.includes(${JSON.stringify(sym)}) || !t.includes('VİOP Planı')) return false;
          const otherSym = ${JSON.stringify(sym)} === 'THYAO' ? 'VAKBN' : 'THYAO';
          if (t.includes(otherSym)) return false;
          return true;
        });
        const card = matches.find((c) => !matches.some((other) => other !== c && c.contains(other)));
        const btn = card
          ? Array.from(card.querySelectorAll('button')).find((b) => (b.textContent || '').includes('VİOP Planı'))
          : null;
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    assert.ok(clicked, `/lab#nu70lab missing VİOP Planı button for ${sym}`);
    await waitFor(
      cdp,
      `(() => {
        const modal = ${VIOP_MODAL_FINDER_JS};
        return Boolean(modal && new RegExp('F_' + ${JSON.stringify(sym)}, 'i').test(modal.textContent || ''));
      })()`,
      `/lab#nu70lab ${sym} VİOP modal`
    );
    const safetyBanners = await evalJs(
      cdp,
      `(() => {
        const modal = ${VIOP_MODAL_FINDER_JS};
        const checkSafety = ${SAFETY_BANNER_CHECK_JS};
        return {
          text: (modal?.textContent || ''),
          banners: checkSafety(modal),
        };
      })()`
    );
    assert.ok(
      safetyBanners.banners.length > 0,
      `/lab#nu70lab ${sym} modal must show visible safety warning banner`
    );
    await pressEscape(cdp);
    await waitFor(cdp, `!Boolean(${VIOP_MODAL_FINDER_JS})`, `/lab#nu70lab ${sym} modal closed`);
    return safetyBanners;
  };

  await clickNu70CardModal('THYAO');
  await clickNu70CardModal('VAKBN');

  // Switch to #impulse and #journal (NEVER click journal scan!)
  for (const tabId of ['lab-tab-impulse', 'lab-tab-journal']) {
    await evalJs(cdp, `document.getElementById(${JSON.stringify(tabId)})?.click()`);
    await sleep(100);
    const hasGuide = await evalJs(
      cdp,
      `Boolean(
        document.querySelector('[data-plain-guide-banner], [data-guide-banner]') ||
        /sade türkçe rehber|3 adımlı rehber|adım/i.test(document.body.innerText || '') ||
        Array.from(document.querySelectorAll('button')).some((b) => /^(gizle|rehberi göster)$/i.test((b.textContent || '').trim()))
      )`
    );
    assert.ok(hasGuide, `/lab tab #${tabId} must display <PlainGuideBanner>`);
  }

  await setViewport(cdp, 375, 812);
  await assertNoHorizontalOverflow(cdp, '/lab mobile', 375);
}

async function verifyImpulseLabRoute(cdp, baseUrl) {
  await setViewport(cdp, 1440, 900);
  await navigate(cdp, `${baseUrl}/impulse-lab`);
  await assertNoHorizontalOverflow(cdp, '/impulse-lab desktop', 1440);
  await assertTermHintPopoverAndBounds(cdp, '/impulse-lab desktop', 1440);

  const scanClicked = await evalJs(
    cdp,
    `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        (b.textContent || '').includes('Canlı 1-2-3 İtki Tara')
      );
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  );
  assert.ok(scanClicked, '/impulse-lab missing "⚡ Canlı 1-2-3 İtki Tara" button');

  await waitFor(
    cdp,
    `(() => (document.body.innerText || '').includes('THYAO') && (document.body.innerText || '').includes('VİOP Planı'))()`,
    '/impulse-lab ready THYAO card'
  );

  // Linear scale check (scoped to Section 2 liveScale controls)
  const linSetup = await evalJs(
    cdp,
    `(() => {
      const scanBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('Canlı 1-2-3 İtki Tara')
      );
      const section = scanBtn?.closest('section') || document;
      const linBtns = Array.from(section.querySelectorAll('button')).filter(
        (b) => (b.textContent || '').trim() === 'Lineer'
      );
      const linBtn = linBtns.length > 0 ? linBtns[linBtns.length - 1] : null;
      if (!linBtn) return { linClicked: false, vClicked: false };
      linBtn.click();
      const vBtn = Array.from(section.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('VİOP Planı')
      );
      if (!vBtn) return { linClicked: true, vClicked: false };
      vBtn.click();
      return { linClicked: true, vClicked: true };
    })()`
  );
  assert.ok(linSetup.linClicked, '/impulse-lab Section 2 liveScale Lineer button missing');
  assert.ok(linSetup.vClicked, '/impulse-lab VİOP Planı button missing');
  await waitFor(
    cdp,
    `Boolean(${VIOP_MODAL_FINDER_JS})`,
    '/impulse-lab linear modal'
  );
  const linearVals = await evalJs(
    cdp,
    `(() => {
      const m = ${VIOP_MODAL_FINDER_JS};
      const vals = Array.from(m.querySelectorAll('input')).map(i => i.value);
      return { vals, text: m.textContent || '' };
    })()`
  );
  assert.ok(
    linearVals.vals.some((v) => v.includes('340.5')) || linearVals.text.includes('340.5'),
    'Linear mode VİOP Planı must pre-fill target_from_w2 (340.5)'
  );
  await pressEscape(cdp);
  await waitFor(cdp, `!Boolean(${VIOP_MODAL_FINDER_JS})`, '/impulse-lab linear modal closed');

  // Log scale check (scoped to Section 2 liveScale controls)
  const logSetup = await evalJs(
    cdp,
    `(() => {
      const scanBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('Canlı 1-2-3 İtki Tara')
      );
      const section = scanBtn?.closest('section') || document;
      const logBtns = Array.from(section.querySelectorAll('button')).filter(
        (b) => (b.textContent || '').trim() === 'Log'
      );
      const logBtn = logBtns.length > 0 ? logBtns[logBtns.length - 1] : null;
      if (!logBtn) return { logClicked: false, vClicked: false };
      logBtn.click();
      const vBtn = Array.from(section.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('VİOP Planı')
      );
      if (!vBtn) return { logClicked: true, vClicked: false };
      vBtn.click();
      return { logClicked: true, vClicked: true };
    })()`
  );
  assert.ok(logSetup.logClicked, '/impulse-lab Section 2 liveScale Log button missing');
  assert.ok(logSetup.vClicked, '/impulse-lab VİOP Planı button missing after Log toggle');
  await waitFor(
    cdp,
    `Boolean(${VIOP_MODAL_FINDER_JS})`,
    '/impulse-lab log modal'
  );
  const logVals = await evalJs(
    cdp,
    `(() => {
      const m = ${VIOP_MODAL_FINDER_JS};
      const vals = Array.from(m.querySelectorAll('input')).map(i => i.value);
      return { vals, text: m.textContent || '' };
    })()`
  );
  assert.ok(
    logVals.vals.some((v) => v.includes('344.2')) || logVals.text.includes('344.2'),
    'Log mode VİOP Planı must update to target_log (344.2)'
  );
  await pressEscape(cdp);
  await waitFor(cdp, `!Boolean(${VIOP_MODAL_FINDER_JS})`, '/impulse-lab log modal closed');

  await setViewport(cdp, 375, 812);
  await assertNoHorizontalOverflow(cdp, '/impulse-lab mobile', 375);
  await assertTermHintPopoverAndBounds(cdp, '/impulse-lab mobile', 375);
}

async function verifyAnalysisSymbolRoute(cdp, baseUrl) {
  await setViewport(cdp, 1440, 900);
  await navigate(cdp, `${baseUrl}/analysis/THYAO`);
  await assertNoHorizontalOverflow(cdp, '/analysis/THYAO desktop', 1440);

  await waitFor(
    cdp,
    `(() => Array.from(document.querySelectorAll('canvas')).some(c => c.width > 0 && c.height > 0))()`,
    '/analysis/THYAO chart canvas'
  );

  const check = await evalJs(
    cdp,
    `(() => {
      const link = document.querySelector('a[href="/viop-rehber"]');
      const canvas = document.querySelector('canvas');
      const linkTop = link ? link.getBoundingClientRect().top : Infinity;
      const canvasTop = canvas ? canvas.getBoundingClientRect().top : 0;
      const legend = document.querySelector('[data-chart-legend]') ||
        Array.from(document.querySelectorAll('div, p, span')).find(el => {
          const t = el.textContent || '';
          return el.getBoundingClientRect().top >= canvasTop && /(GVT|GKD|PU30|Fib)/i.test(t) && t.length < 350;
        });
      return {
        h1Count: document.querySelectorAll('h1').length,
        hasLinkAboveChart: Boolean(link && linkTop < canvasTop),
        hasLegendBelowChart: Boolean(legend),
      };
    })()`
  );
  assert.equal(check.h1Count, 1, '/analysis/THYAO must have 1 <h1>');
  assert.ok(check.hasLinkAboveChart, '/analysis/THYAO must render /viop-rehber link & summary above chart');
  assert.ok(check.hasLegendBelowChart, '/analysis/THYAO SemihDivergenceChart must render 1-line color legend below chart');

  await assertTermHintPopoverAndBounds(cdp, '/analysis/THYAO desktop', 1440);

  await setViewport(cdp, 375, 812);
  await assertNoHorizontalOverflow(cdp, '/analysis/THYAO mobile', 375);
  await assertTermHintPopoverAndBounds(cdp, '/analysis/THYAO mobile', 375);
}

async function verifyClassicIndexRoute(cdp, baseUrl) {
  await setViewport(cdp, 1440, 900);
  await navigate(cdp, `${baseUrl}/index.html`);

  const navInfo = await assertSidebarNewGroupAndLink(cdp, '/index.html desktop');
  assert.ok(navInfo.hasPrivacy, '/index.html sidebar footer must preserve /privacy link');

  await evalJs(cdp, `document.getElementById('rsiPu30ScanBtn')?.click()`);
  await waitFor(
    cdp,
    `Boolean(document.querySelector('#rsiPu30Grid .btn-chart'))`,
    '#rsiPu30Grid .btn-chart'
  );

  const checkModalLegend = async () => {
    await evalJs(cdp, `document.querySelector('#rsiPu30Grid .btn-chart')?.click()`);
    await waitFor(
      cdp,
      `(() => {
        const m = document.getElementById('rsiPu30Modal');
        return m && !m.classList.contains('hidden');
      })()`,
      '#rsiPu30Modal visible'
    );
    await waitFor(
      cdp,
      `(() => {
        const p = document.querySelector('#rsiPu30PriceChart canvas');
        const r = document.querySelector('#rsiPu30RsiChart canvas');
        return p && r && p.width > 0 && r.width > 0;
      })()`,
      '#rsiPu30Modal chart canvases'
    );
    return evalJs(
      cdp,
      `(() => {
        const m = document.getElementById('rsiPu30Modal');
        const viopLinks = m.querySelectorAll('a[href="/viop-rehber"]').length;
        const legends = m.querySelectorAll('[data-rsi-legend], .rsi-chart-legend').length ||
          ((m.textContent || '').match(/GVT|GKD/g) ? 1 : 0);
        return { viopLinks, legends };
      })()`
    );
  };

  const first = await checkModalLegend();
  assert.equal(first.viopLinks, 1, '#rsiPu30Modal must contain 1 /viop-rehber link');
  assert.ok(first.legends >= 1, '#rsiPu30Modal must render 1-line color legend');

  await evalJs(cdp, `document.getElementById('rsiPu30CloseModal')?.click()`);
  await sleep(100);
  const second = await checkModalLegend();
  assert.equal(second.viopLinks, 1, '#rsiPu30Modal must NOT duplicate /viop-rehber link on reopen');
  assert.equal(second.legends, first.legends, '#rsiPu30Modal must NOT duplicate legend on reopen');

  await setViewport(cdp, 375, 812);
  await assertNoHorizontalOverflow(cdp, '/index.html mobile', 375);
}

// ============================================================================
// Self-Test Synthetic HTTP Server (ONLY used when E2E_SELF_TEST === '1')
// ============================================================================

function startSyntheticSelfTestServer() {
  const layoutShell = (activePath, bodyHtml, extraScript = '', { flatNav = false } = {}) => {
    const navHtml = flatNav
      ? `<ul class="nav-links">
          <li class="rsi-nav-group">ANALİZ</li>
          <li><a data-system-link href="/index.html#rsipu30">RSI Radarı</a></li>
          <li class="rsi-nav-group">ARAŞTIRMA VE TEST</li>
          <li><a data-system-link href="/lab">Test Merkezi</a></li>
          <li><a data-system-link href="/impulse-lab">İtki &amp; WFO Lab</a></li>
          <li class="rsi-nav-group">VİOP REHBERİ</li>
          <li><a data-system-link href="/viop-rehber" ${activePath === '/viop-rehber' ? 'aria-current="page"' : ''}>VİOP &amp; Strateji Rehberi</a></li>
        </ul>`
      : `<ul class="nav-links">
          <li>
            <div class="rsi-nav-group">ANALİZ</div>
            <ul class="nav-links"><li><a data-system-link href="/index.html#rsipu30">RSI Radarı</a></li></ul>
          </li>
          <li>
            <div class="rsi-nav-group">ARAŞTIRMA VE TEST</div>
            <ul class="nav-links">
              <li><a data-system-link href="/lab">Test Merkezi</a></li>
              <li><a data-system-link href="/impulse-lab">İtki &amp; WFO Lab</a></li>
            </ul>
          </li>
          <li>
            <div class="rsi-nav-group">VİOP REHBERİ</div>
            <ul class="nav-links">
              <li><a data-system-link href="/viop-rehber" ${activePath === '/viop-rehber' ? 'aria-current="page"' : ''}>VİOP &amp; Strateji Rehberi</a></li>
            </ul>
          </li>
        </ul>`;

    return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>E2E Self-Test</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: sans-serif; background: #0f172a; color: #f8fafc; overflow-x: hidden; }
    .rsi-app { display: flex; min-height: 100vh; }
    aside { width: 240px; flex-shrink: 0; padding: 12px; background: #1e293b; }
    main { flex: 1; min-width: 0; padding: 16px; }
    .hidden { display: none !important; }
    .workspace-table-wrap { overflow-x: auto; max-width: 100%; }
    .term-portal-dialog { position: fixed; left: 12px; top: 80px; width: min(300px, calc(100vw - 24px)); background: #0f1926; padding: 12px; border: 1px solid #2f455e; z-index: 120; }
    [data-viop-modal] { position: fixed; inset: 10% 8%; background: #1e293b; border: 1px solid #64748b; padding: 16px; z-index: 50; }
    @media (max-width: 767px) { aside { display: none; } body[data-menu-open="true"] aside { display: block; position: fixed; z-index: 60; height: 100vh; } }
  </style>
</head>
<body>
  <button id="rsi-menu-toggle" aria-controls="rsi-sidebar" aria-expanded="false">Menü</button>
  <div class="rsi-app rsi-react">
    <aside id="rsi-sidebar">
      <a class="rsi-brand" href="/index.html"><div><strong>RSI Analizi</strong><span>TEKNİK ANALİZ PLATFORMU</span></div></a>
      <nav aria-label="Tüm sistemler">${navHtml}</nav>
      <div class="rsi-sidebar-footer"><a href="/privacy">Gizlilik</a></div>
    </aside>
    <main>${bodyHtml}</main>
  </div>
  <script>
    const menuBtn = document.getElementById('rsi-menu-toggle');
    menuBtn.addEventListener('click', () => {
      const open = document.body.dataset.menuOpen === 'true';
      document.body.dataset.menuOpen = open ? 'false' : 'true';
      menuBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    let termCounter = 0;
    const closeAllTermPopovers = () => {
      document.querySelectorAll('button[data-term-btn]').forEach(b => {
        const cid = b.getAttribute('aria-controls');
        if (cid) {
          const el = document.getElementById(cid);
          if (el) el.remove();
          b.removeAttribute('aria-controls');
        }
        b.setAttribute('aria-expanded', 'false');
      });
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.body.dataset.menuOpen = 'false';
        menuBtn.setAttribute('aria-expanded', 'false');
        closeAllTermPopovers();
        document.querySelectorAll('[data-viop-modal]').forEach(d => d.remove());
        const m = document.getElementById('rsiPu30Modal');
        if (m) m.classList.add('hidden');
      }
    });
    window.__wireTermHints = function() {
      document.querySelectorAll('button[data-term-btn]').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => {
          const wasOpen = btn.getAttribute('aria-expanded') === 'true';
          closeAllTermPopovers();
          if (wasOpen) return;
          const popId = 'term-pop-' + (++termCounter);
          const pop = document.createElement('div');
          pop.id = popId;
          pop.setAttribute('role', 'dialog');
          pop.className = 'term-portal-dialog';
          pop.textContent = btn.dataset.termText || 'Terim açıklaması';
          document.body.appendChild(pop);
          btn.setAttribute('aria-expanded', 'true');
          btn.setAttribute('aria-controls', popId);
        });
      });
    };
    window.__wireTermHints();
  </script>
  ${extraScript}
</body>
</html>`;
  };

  const pages = {
    '/viop-rehber': layoutShell(
      '/viop-rehber',
      `<h1>VİOP &amp; Strateji Rehberi</h1>
      <section><h2>Spot vs VİOP</h2><div class="workspace-table-wrap"><table><tr><th>Özellik</th><th>Spot</th><th>VİOP</th></tr><tr><td>Çarpan</td><td>1</td><td>100</td></tr></table></div></section>
      <section>
        <h2>VİOP Hesaplayıcı</h2>
        <button type="button" onclick="selectPreset('THYAO','SHORT',300,310,true)">THYAO Short</button>
        <button type="button" onclick="selectPreset('VAKBN','LONG',25,24,true)">VAKBN Long</button>
        <button type="button" onclick="selectPreset('ASELS','SHORT',80,83,false)">ASELS Bekle/Tuzak</button>
        <div id="safety" role="alert" class="hidden">15dk Tuzak Uyarısı — VİOP'ta İşlem Açma!</div>
        <input aria-label="Sermaye" value="100000" />
        <input aria-label="Risk" value="2" />
        <input aria-label="Teminat" value="20" />
        <input aria-label="Komisyon" value="0.05" />
        <div id="contract-out">F_THYAO1126</div>
        <button type="button" data-term-btn data-term-text="Başlangıç teminatı açıklaması" aria-label="Teminat terimi" aria-expanded="false">?</button>
        <div class="workspace-notice"><strong>Yasal Uyarı (SPK &amp; Kaldıraç Riski):</strong> Eğitim amaçlıdır, yatırım tavsiyesi değildir.</div>
      </section>
      <section><h2>5 Strateji</h2></section>
      <section><h2>5 Hata ve Kontrol Listesi</h2></section>
      <section><h2>Sözlük</h2><input type="search" placeholder="Terim ara" oninput="filterGlossary(this.value)" /><div id="glossary-list"><div data-glossary-card>Kaldıraç</div><div data-glossary-card>Teminat</div></div></section>`,
      `<script>
        window.selectPreset = function(sym, dir, entry, stop, ok) {
          document.getElementById('contract-out').textContent = 'F_' + sym + '1126 (' + dir + ')';
          document.getElementById('safety').classList.toggle('hidden', ok);
        };
        window.filterGlossary = function(q) {
          const ql = q.toLocaleLowerCase('tr-TR');
          document.querySelectorAll('[data-glossary-card]').forEach(el => {
            el.classList.toggle('hidden', !el.textContent.toLocaleLowerCase('tr-TR').includes(ql));
          });
        };
      </script>`
    ),
    '/lab': layoutShell(
      '/lab',
      `<h1>Test Merkezi</h1>
      <div role="tablist">
        <button id="lab-tab-longshort" role="tab" aria-selected="true" onclick="switchTab('longshort')">Long / Short Matrisi</button>
        <button id="lab-tab-nu70lab" role="tab" aria-selected="false" onclick="switchTab('nu70lab')">NU70 &amp; Asılan Adam Lab</button>
        <button id="lab-tab-impulse" role="tab" aria-selected="false" onclick="switchTab('impulse')">İtki analizi</button>
        <button id="lab-tab-journal" role="tab" aria-selected="false" onclick="switchTab('journal')">Sinyal günlüğü</button>
      </div>
      <div id="lab-guide-banner"></div>
      <div id="tab-content">
        <button type="button" onclick="runLs()">⚡ Matrisi Güncelle</button>
        <button type="button" onclick="runNu70()">NU70 Zirve Taraması Başlat</button>
        <div id="cards"></div>
      </div>`,
      `<script>
        let currentTab = 'longshort';
        const renderGuideBanner = () => {
          const key = 'rsi_guide_lab_' + currentTab;
          const collapsed = localStorage.getItem(key) === '1';
          const box = document.getElementById('lab-guide-banner');
          if (collapsed) {
            box.innerHTML = '<div><span>3 Adımlı Rehber gizli</span> <a href="/viop-rehber">VİOP Rehberi</a> <button type="button" aria-expanded="false" onclick="toggleGuide(false)">Rehberi Göster</button></div>';
          } else {
            box.innerHTML = '<section><span>SADE TÜRKÇE REHBER · 3 ADIM</span> <a href="/viop-rehber">VİOP Rehberi</a> <button type="button" aria-expanded="true" onclick="toggleGuide(true)">Gizle</button><div>1. Adım 2. Adım 3. Adım</div></section>';
          }
        };
        window.toggleGuide = function(hide) {
          localStorage.setItem('rsi_guide_lab_' + currentTab, hide ? '1' : '0');
          renderGuideBanner();
        };
        window.switchTab = function(tab) {
          currentTab = tab;
          document.querySelectorAll('[role="tab"]').forEach(b => b.setAttribute('aria-selected', b.id === 'lab-tab-' + tab ? 'true' : 'false'));
          renderGuideBanner();
        };
        renderGuideBanner();
        window.openViopModal = function(sym, warn) {
          const dlg = document.createElement('div');
          dlg.setAttribute('role', 'dialog');
          dlg.setAttribute('data-viop-modal', '1');
          dlg.innerHTML = '<h3>F_' + sym + '1126</h3>' + (warn ? '<div role="alert">Dikkat: Teyit bekleniyor / 15dk tuzak — VİOP\\'ta İşlem Açma!</div>' : '') + '<p>Yasal Uyarı (SPK)</p>';
          document.body.appendChild(dlg);
        };
        window.runLs = async function() {
          const res = await fetch('/api/lab?mode=longshort');
          const data = await res.json();
          const renderCard = (it) =>
            '<div class="card-item"><strong>' + it.symbol + '</strong> <button>Grafiği Aç</button>' +
            (it.is_viop ? ' <button onclick="openViopModal(\\'' + it.symbol + '\\',' + (!it.triggered) + ')">🧮 VİOP Planı</button>' : '') +
            '</div>';
          document.getElementById('cards').innerHTML =
            '<div class="grid"><div class="space-y-3">' + data.longs.map(renderCard).join('') + '</div>' +
            '<div class="space-y-3">' + data.shorts.map(renderCard).join('') + '</div></div>';
        };
        window.runNu70 = async function() {
          const res = await fetch('/api/lab?mode=nu70lab');
          const data = await res.json();
          document.getElementById('cards').innerHTML = data.strict_signals.map(it =>
            '<article data-symbol="' + it.symbol + '"><strong>' + it.symbol + '</strong> <button onclick="openViopModal(\\'' + it.symbol + '\\', true)">🧮 VİOP Planı</button></article>'
          ).join('') + data.oversold_dip_watch.map(it =>
            '<article data-symbol="' + it.symbol + '"><strong>' + it.symbol + '</strong> <button onclick="openViopModal(\\'' + it.symbol + '\\', true)">🧮 VİOP Planı</button></article>'
          ).join('');
        };
      </script>`
    ),
    '/impulse-lab': layoutShell(
      '/impulse-lab',
      `<h1>İtki &amp; WFO Lab</h1>
      <section>
        <span>SADE TÜRKÇE REHBER · 3 ADIM</span>
        <a href="/viop-rehber">VİOP Rehberi</a>
        <button type="button" aria-expanded="true">Gizle</button>
        <button type="button" data-term-btn data-term-text="Walk-Forward Optimization" aria-label="WFO terimi" aria-expanded="false">?</button>
      </section>
      <section>
        <h2>Bölüm 1: Yayınlanmış WFO Raporu</h2>
        <button type="button" onclick="setReportScale('linear')">Lineer</button>
        <button type="button" onclick="setReportScale('log')">Log</button>
      </section>
      <section>
        <h2>Bölüm 2: Canlı 1-2-3 İtki</h2>
        <button type="button" onclick="setLiveScale('linear')">Lineer</button>
        <button type="button" onclick="setLiveScale('log')">Log</button>
        <button type="button" onclick="runImpulse()">⚡ Canlı 1-2-3 İtki Tara</button>
        <div id="imp-cards"></div>
      </section>`,
      `<script>
        let reportScale = 'linear';
        let liveScale = 'linear';
        let lastItems = [];
        window.setReportScale = function(s) { reportScale = s; };
        window.setLiveScale = function(s) { liveScale = s; };
        window.openImpModal = function() {
          const t = lastItems[0].impulse.fib_fiyat_hedefleri;
          const v1 = liveScale === 'log' ? t['1.618'].target_log : t['1.618'].target_from_w2;
          const v2 = liveScale === 'log' ? t['3.618'].target_log : t['3.618'].target_from_w2;
          const dlg = document.createElement('div');
          dlg.setAttribute('role', 'dialog');
          dlg.setAttribute('data-viop-modal', '1');
          dlg.innerHTML = '<h3>F_THYAO1126</h3><input value="' + v1 + '" /><input value="' + v2 + '" />';
          document.body.appendChild(dlg);
        };
        window.runImpulse = async function() {
          const res = await fetch('/api/impulse-lab?mode=scan');
          const data = await res.json();
          lastItems = data.items;
          document.getElementById('imp-cards').innerHTML = data.items.map(it =>
            '<article><strong>' + it.symbol + '</strong> <button onclick="openImpModal()">🧮 VİOP Planı</button></article>'
          ).join('');
        };
      </script>`
    ),
    '/analysis/THYAO': layoutShell(
      '/analysis/THYAO',
      `<h1>THYAO</h1>
      <div><p>1. Trende bak 2. GVT/GKD teyidi bekle 3. VİOP planı kur.</p><a href="/viop-rehber">VİOP Rehberi</a></div>
      <button type="button" data-term-btn data-term-text="Güven Tazeleyen Tepe" aria-label="GVT terimi" aria-expanded="false">?</button>
      <canvas id="semih-canvas" width="320" height="160"></canvas>
      <div data-chart-legend>Yeşil: GVT | Kırmızı: GKD | Turuncu: PU30</div>`,
      `<script>
        fetch('/api/scan/rsi-pu30/THYAO?interval=1h').then(r => r.json()).then(json => {
          const detail = json.data;
          if (!detail || !Array.isArray(detail.bars) || !detail.bars.length || !detail.signal?.saatlik_seviye) {
            throw new Error('Invalid rsiDetail payload');
          }
          const c = document.getElementById('semih-canvas');
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#22c55e';
          ctx.fillRect(10, 10, Math.min(200, detail.bars.length * 3), 50);
        });
      </script>`
    ),
    '/index.html': layoutShell(
      '/index.html',
      `<h1>RSI Radarı</h1>
      <button id="rsiPu30ScanBtn" type="button" onclick="scanClassic()">Tara</button>
      <div id="rsiPu30Grid"></div>
      <div id="rsiPu30Modal" class="modal hidden">
        <button id="rsiPu30CloseModal" type="button" onclick="document.getElementById('rsiPu30Modal').classList.add('hidden')">Kapat</button>
        <div id="rsiPu30SignalInfo"></div>
        <div id="rsiPu30PriceChart"></div>
        <div id="rsiPu30RsiChart"></div>
      </div>`,
      `<script>
        window.scanClassic = async function() {
          const res = await fetch('/api/scan/rsi-pu30');
          const payload = await res.json();
          document.getElementById('rsiPu30Grid').innerHTML = payload.data.signals.map(s =>
            '<div>' + s.symbol + ' <button class="btn-chart" onclick="openClassicChart(\\'' + s.symbol + '\\')">Grafik</button></div>'
          ).join('');
        };
        window.openClassicChart = async function(sym) {
          const res = await fetch('/api/scan/rsi-pu30/' + sym + '?interval=1h');
          const json = await res.json();
          const detail = json.data;
          const prices = detail.bars.map(b => b.close);
          if (!prices.length || !detail.signal?.saatlik_seviye) throw new Error('Invalid classic detail');
          const modal = document.getElementById('rsiPu30Modal');
          modal.classList.remove('hidden');
          document.getElementById('rsiPu30PriceChart').innerHTML = '<canvas width="300" height="120"></canvas>';
          document.getElementById('rsiPu30RsiChart').innerHTML = '<canvas width="300" height="80"></canvas>';
          const info = document.getElementById('rsiPu30SignalInfo');
          info.innerHTML = '<div data-rsi-legend>GVT / GKD Renk Lejantı</div><a href="/viop-rehber">VİOP Rehberi</a>';
        };
      </script>`,
      { flatNav: true }
    ),
  };

  const server = http.createServer((req, res) => {
    const urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (Object.hasOwn(pages, urlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pages[urlPath]);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function run() {
  const selfTest = process.env.E2E_SELF_TEST === '1';
  const liveApi = process.env.E2E_LIVE_API === '1';
  const chromePath = process.env.E2E_CHROME_PATH || DEFAULT_CHROME_PATH;

  let syntheticSrv = null;
  let baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

  if (selfTest) {
    syntheticSrv = await startSyntheticSelfTestServer();
    baseUrl = syntheticSrv.baseUrl;
    console.log(`[E2E_SELF_TEST] Synthetic server listening at ${baseUrl}`);
  } else {
    try {
      const probe = await fetch(`${baseUrl}/viop-rehber`, { signal: AbortSignal.timeout(5000) });
      if (!probe.ok) {
        throw new Error(`HTTP ${probe.status}`);
      }
    } catch (err) {
      throw new Error(
        `Target server unreachable at ${baseUrl}/viop-rehber (${err.message}). Start Next.js server or set E2E_BASE_URL.`
      );
    }
  }

  const fixtures = buildApiFixtures();
  const chrome = await launchHeadlessChrome(chromePath);
  const runtimeErrors = [];

  try {
    const { cdp } = chrome;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    cdp.on('Runtime.exceptionThrown', (params) => {
      const msg =
        params.exceptionDetails?.exception?.description ||
        params.exceptionDetails?.text ||
        'Uncaught browser exception';
      runtimeErrors.push(msg);
    });

    if (!liveApi) {
      await cdp.send('Fetch.enable', {
        patterns: [{ urlPattern: `${baseUrl}/api/*`, requestStage: 'Request' }],
      });

      cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
        try {
          const u = new URL(request.url);
          let payload = null;
          if (u.pathname === '/api/health') {
            payload = fixtures.health;
          } else if (u.pathname === '/api/lab') {
            const mode = u.searchParams.get('mode');
            if (mode === 'longshort') payload = fixtures.longshort;
            else if (mode === 'nu70lab') payload = fixtures.nu70lab;
          } else if (u.pathname === '/api/impulse-lab') {
            const mode = u.searchParams.get('mode');
            if (mode === 'scan') payload = fixtures.impulseScan;
            else if (mode === 'chart') payload = fixtures.impulseChart;
          } else if (u.pathname === '/api/scan/rsi-pu30') {
            payload = fixtures.rsiScan;
          } else if (u.pathname.startsWith('/api/scan/rsi-pu30/')) {
            payload = fixtures.rsiDetail;
          }

          if (payload !== null) {
            const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
            await cdp.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: 200,
              responseHeaders: [
                { name: 'Content-Type', value: 'application/json; charset=utf-8' },
                { name: 'Access-Control-Allow-Origin', value: '*' },
              ],
              body,
            });
          } else {
            await cdp.send('Fetch.continueRequest', { requestId });
          }
        } catch {
          // Ignore teardown races
        }
      });
    }

    await verifyViopRehberRoute(cdp, baseUrl);
    console.log('PASS: /viop-rehber (Desktop 1440x900 & Mobile 375x812)');

    await verifyLabRoute(cdp, baseUrl);
    console.log('PASS: /lab (#longshort, #nu70lab, #impulse, #journal)');

    await verifyImpulseLabRoute(cdp, baseUrl);
    console.log('PASS: /impulse-lab (Lineer vs Log scale -> VİOP Planı)');

    await verifyAnalysisSymbolRoute(cdp, baseUrl);
    console.log('PASS: /analysis/THYAO (summary + chart legend + tooltips)');

    await verifyClassicIndexRoute(cdp, baseUrl);
    console.log('PASS: /index.html (sidebar parity + #rsiPu30Modal legend & non-duplication)');

    assert.deepEqual(
      runtimeErrors,
      [],
      `Uncaught browser Runtime.exceptionThrown errors: ${runtimeErrors.join(' | ')}`
    );
    console.log('ALL LIVE DOM E2E CHECKS PASSED');
  } finally {
    await chrome.cleanup();
    if (syntheticSrv) {
      await syntheticSrv.close();
    }
  }
}

run().catch((err) => {
  console.error('LIVE DOM E2E FAILED:', err);
  process.exit(1);
});
