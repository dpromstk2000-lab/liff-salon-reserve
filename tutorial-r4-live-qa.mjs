import { chromium } from 'playwright';

const BASE = process.env.DPRO_BASE || 'https://dpromstk2000-lab.github.io/liff-salon-reserve/';
const EXPECT = 'SALON-GUIDE-CENTER-R4-V1.0-20260829';
const R3 = 'SALON-TUTORIAL-R3-V1.2-20260828';
const QA_REV = 'SALON-R4-QA-ROUTE-STATE-FIX-V1.4-20260829';
const VIEWPORTS = [
  { w: 1440, h: 1000, touch: false },
  { w: 1024, h: 768, touch: false },
  { w: 390, h: 844, touch: true },
  { w: 320, h: 720, touch: true },
];
const BAD = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m); };
const bust = t => `${Date.now()}-${Math.random().toString(36).slice(2)}-${t}`;

async function waitPublished(page) {
  let last = null;
  for (let i = 0; i < 60; i++) {
    const src = await page.request.get(
      `${BASE}guide-center.js?qa=${encodeURIComponent(EXPECT)}&b=${bust('src')}`,
      { headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' }, timeout: 30000 }
    ).catch(() => null);
    if (src?.ok()) {
      const text = await src.text();
      if (text.includes(`const VERSION='${EXPECT}'`)) {
        const r = await page.goto(`${BASE}guide-center.html?qa=1&b=${bust(i)}`, {
          waitUntil: 'domcontentloaded', timeout: 30000,
        }).catch(() => null);
        if (r?.ok()) {
          await page.waitForFunction(v => window.DPRO_GUIDE_CENTER_QA?.VERSION === v, EXPECT, { timeout: 10000 }).catch(() => {});
          last = await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA?.VERSION || '');
          if (last === EXPECT) return;
        }
      }
    }
    await sleep(5000);
  }
  throw new Error(`Published Guide Center marker not found; last=${last}`);
}

async function frameQA(page) {
  for (let i = 0; i < 100; i++) {
    const v = await page.evaluate(() => document.getElementById('guide-tutorial-frame')?.contentWindow?.DPRO_TUTORIAL_QA?.VERSION || '').catch(() => '');
    if (v === R3) return;
    await sleep(100);
  }
  throw new Error('R3 runtime unavailable in Guide Center');
}

async function frameSnap(page) {
  return page.evaluate(() => document.getElementById('guide-tutorial-frame').contentWindow.DPRO_TUTORIAL_QA.snapshot());
}

async function waitFrameTarget(page, label = '') {
  let last = null;
  for (let i = 0; i < 120; i++) {
    const probe = await page.evaluate(() => {
      const qa = document.getElementById('guide-tutorial-frame')?.contentWindow?.DPRO_TUTORIAL_QA;
      if (!qa) return null;
      const s = qa.snapshot();
      const def = qa.STEPS?.[s.stepIndex] || null;
      return {
        snapshot: s,
        selectorValid: !!def && (s.targetSelector === def.primary || s.targetSelector === def.fallback),
        primary: def?.primary || '',
        fallback: def?.fallback || '',
      };
    }).catch(() => null);
    if (probe?.snapshot) last = probe;
    if (probe?.snapshot?.targetResolved) {
      assert(probe.selectorValid, `Resolved target is outside accepted primary/fallback at ${label || 'step'}: ${JSON.stringify(probe)}`);
      return probe.snapshot;
    }
    await sleep(120);
  }
  throw new Error(`Guide Center Tutorial target unresolved at ${label || 'step'}: ${JSON.stringify(last)}`);
}

async function settle(page) {
  // Product embed pages load public read-only data on entry. Wait for those GETs to
  // settle before changing routes so the QA itself does not abort in-flight reads.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await sleep(300);
}

async function waitStepState(page, expectedStep, label = '') {
  let last = null;
  for (let i = 0; i < 120; i++) {
    const probe = await page.evaluate(step => {
      const frame = document.getElementById('guide-tutorial-frame');
      const qa = frame?.contentWindow?.DPRO_TUTORIAL_QA;
      if (!qa) return null;
      const s = qa.snapshot();
      const def = qa.STEPS?.[step - 1] || null;
      return { snapshot: s, expectedRoute: def?.route || '' };
    }, expectedStep).catch(() => null);
    if (probe?.snapshot) last = probe;
    if (probe?.snapshot?.step === expectedStep &&
        probe.snapshot.first10Count === 10 &&
        probe.snapshot.frameRoute === probe.expectedRoute) {
      return probe.snapshot;
    }
    await sleep(120);
  }
  throw new Error(`Guide Center step/route state unresolved at ${label || `step ${expectedStep}`}: ${JSON.stringify(last)}`);
}

async function nextAndSettle(page) {
  const before = await frameSnap(page);
  await page.evaluate(() => document.getElementById('guide-tutorial-frame').contentWindow.DPRO_TUTORIAL_QA.next());
  let s = await frameSnap(page);
  if (s.status !== 'complete') {
    s = await waitStepState(page, before.step + 1, `step ${before.step} -> ${before.step + 1}`);
    await settle(page);
    s = await waitStepState(page, before.step + 1, `settled step ${before.step + 1}`);
  }
  return s;
}

async function qaViewport(browser, v) {
  const context = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    hasTouch: v.touch,
    isMobile: v.touch,
    extraHTTPHeaders: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const unsafe = [];
  const failedRequests = [];

  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', r => {
    if (BAD.has(r.method()) && (/dpro-salon|workers\.dev|\/api\//i.test(r.url()))) {
      unsafe.push({ method: r.method(), url: r.url() });
    }
  });
  page.on('requestfailed', r => failedRequests.push({ method: r.method(), url: r.url(), failure: r.failure()?.errorText || '' }));

  await waitPublished(page);
  await page.evaluate(() => {
    localStorage.removeItem(window.DPRO_GUIDE_CENTER_QA.KEY);
    window.DPRO_GUIDE_CENTER_QA.refreshState();
  });

  let g = await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA.snapshot());
  assert(g.count === 10, 'Guide count != 10');
  assert(g.docScrollWidth <= g.innerWidth, 'Guide html overflow');
  assert(g.bodyScrollWidth <= g.innerWidth, 'Guide body overflow');
  assert(!g.resumeVisible, 'Resume visible before progress');
  assert(!g.replayVisible, 'Replay visible before completion');

  const cardCount = await page.locator('.guide-card').count();
  assert(cardCount === 10, 'Rendered Guide cards != 10');

  await page.locator('#guide-start').focus();
  const focus = await page.evaluate(() => {
    const e = document.activeElement, s = getComputedStyle(e);
    return { id: e.id, outline: s.outlineStyle, width: s.outlineWidth };
  });
  assert(focus.id === 'guide-start' && focus.outline !== 'none', 'Guide focus not visible');

  await page.keyboard.press('Enter');
  await frameQA(page);
  let s = await waitFrameTarget(page, 'Guide Start step 1');
  await settle(page);
  assert(s.step === 1 && s.first10Count === 10, 'Start alignment failed');
  assert(s.outer.innerWidth === v.w, 'Embedded Tutorial width mismatch');

  const aligned = await page.evaluate(() => {
    const g = window.DPRO_GUIDE_CENTER_QA.GUIDES;
    const t = document.getElementById('guide-tutorial-frame').contentWindow.DPRO_TUTORIAL_QA.STEPS;
    return g.length === 10 && t.length === 10 && g.every((x, i) =>
      x.step === t[i].step && x.role === t[i].role && x.route === t[i].route &&
      x.title === t[i].title && x.primary === t[i].primary && x.fallback === t[i].fallback
    );
  });
  assert(aligned, 'Guide / First10 route-target alignment failed');

  // Move 1 -> 4 one step at a time. R4 verifies step/route state; R3 reconfirm verifies actual target/highlight at every step.
  for (let i = 0; i < 3; i++) s = await nextAndSettle(page);
  assert(s.step === 4 && /staff\.html\?embed_demo=1/.test(s.frameRoute), 'Step 4 transition failed');

  await page.locator('#guide-overlay-close').focus();
  await page.keyboard.press('Escape');
  g = await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA.snapshot());
  assert(!g.overlayOpen, 'Escape did not close Guide overlay');
  await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA.refreshState());
  g = await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA.snapshot());
  assert(g.resumeVisible, 'Resume not exposed for saved progress');

  await page.click('#guide-resume');
  await frameQA(page);
  s = await waitFrameTarget(page, 'Guide Resume step 4');
  await settle(page);
  assert(s.step === 4 && /staff\.html\?embed_demo=1/.test(s.frameRoute), 'Guide Resume alignment failed');

  // Complete 4 -> 10 sequentially, verifying every Guide step/route state. Actual target/highlight is covered by the R3 reconfirm in this same workflow run.
  for (let i = 0; i < 7; i++) s = await nextAndSettle(page);
  assert(s.status === 'complete', 'R3 completion through Guide failed');

  await page.click('#guide-overlay-close');
  await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA.refreshState());
  g = await page.evaluate(() => window.DPRO_GUIDE_CENTER_QA.snapshot());
  assert(g.replayVisible, 'Replay not exposed after complete');

  await page.click('#guide-replay');
  await frameQA(page);
  s = await waitFrameTarget(page, 'Guide Replay step 1');
  await settle(page);
  assert(s.step === 1 && s.status === 'running', 'Guide Replay alignment failed');
  await page.click('#guide-overlay-close');
  await settle(page);

  assert(pageErrors.length === 0, 'pageerror: ' + pageErrors.join(' | ') + '; requestfailed=' + JSON.stringify(failedRequests));
  assert(unsafe.length === 0, 'Unsafe business request: ' + JSON.stringify(unsafe));
  const filtered = consoleErrors.filter(x => !/Failed to load resource/i.test(x));
  assert(filtered.length === 0, 'Console errors: ' + filtered.join(' | '));

  const out = {
    viewport: `${v.w}x${v.h}`,
    touch: v.touch,
    guideCount: 10,
    alignment: 'PASS',
    start: 'PASS',
    resume: 'PASS',
    replay: 'PASS',
    keyboardFocus: 'PASS',
    escapeClose: 'PASS',
    overflow: 0,
    pageerror: 0,
    unsafeWrite: 0,
    requestFailed: failedRequests.length,
    status: 'PASS',
  };
  results.push(out);
  console.log('R4_VIEWPORT_PASS', JSON.stringify(out));
  await context.close();
}

const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  for (const v of VIEWPORTS) await qaViewport(browser, v);
} catch (e) {
  failed = e;
  console.error('R4_QA_FAIL', e.stack || e);
} finally {
  await browser.close();
}

console.log('R4_QA_RESULT=' + JSON.stringify({ qaRevision: QA_REV, version: EXPECT, r3Version: R3, base: BASE, results, businessMutation: 0, status: failed ? 'HOLD' : 'PASS' }));
if (failed) process.exit(1);
