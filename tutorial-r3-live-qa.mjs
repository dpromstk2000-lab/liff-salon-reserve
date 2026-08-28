import { chromium } from 'playwright';

const BASE = process.env.DPRO_BASE || 'https://dpromstk2000-lab.github.io/liff-salon-reserve/';
const EXPECT = 'SALON-TUTORIAL-R3-V1.2-20260828';
const QA_REV = 'SALON-R3-QA-CACHE-FIX-V1.2-20260829';
const VIEWPORTS = [
  { w: 1440, h: 1000, touch: false },
  { w: 1024, h: 768, touch: false },
  { w: 390, h: 844, touch: true },
  { w: 320, h: 720, touch: true },
];
const BAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function bust(tag = '') {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${tag}`;
}

async function verifyPublishedRuntime(page) {
  const url = `${BASE}tutorial-runtime.js?qa_runtime=${encodeURIComponent(EXPECT)}&b=${bust('runtime')}`;
  const res = await page.request.get(url, {
    headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' },
    timeout: 30000,
  });
  assert(res.ok(), `Published runtime HTTP ${res.status()}`);
  const text = await res.text();
  assert(text.includes(`const VERSION='${EXPECT}'`), `Published runtime source is not ${EXPECT}`);
}

async function waitPublished(page) {
  await verifyPublishedRuntime(page);
  let last = null;
  for (let i = 0; i < 24; i++) {
    const pageUrl = `${BASE}tutorial.html?qa=1&qa_v=${encodeURIComponent(EXPECT)}&b=${bust(i)}`;
    const r = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    if (r?.ok()) {
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
      last = await page.evaluate(() => ({
        version: window.DPRO_TUTORIAL_QA?.VERSION || '',
        title: document.title,
        readyState: document.readyState,
        runtimeSrc: document.querySelector('script[src*="tutorial-runtime.js"]')?.src || '',
      })).catch(() => null);
      if (last?.version === EXPECT) return;
      console.log('R3_PUBLISH_WAIT', JSON.stringify({ attempt: i + 1, http: r.status(), last }));
    }
    await sleep(5000);
  }
  throw new Error(`Published tutorial marker not found; last=${JSON.stringify(last)}`);
}

async function snap(page) {
  return page.evaluate(() => window.DPRO_TUTORIAL_QA.snapshot());
}

async function waitTarget(page) {
  for (let i = 0; i < 80; i++) {
    const s = await snap(page);
    if (s.targetResolved && s.highlight.visible) return s;
    await sleep(150);
  }
  throw new Error('Target/highlight not resolved');
}

async function basicViewportQA(browser, v) {
  const context = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    hasTouch: v.touch,
    isMobile: v.touch,
    extraHTTPHeaders: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const unsafe = [];
  const requests = [];

  // Always fetch the deployed Tutorial runtime with a unique URL.
  await page.route('**/tutorial-runtime.js*', async route => {
    const u = new URL(route.request().url());
    if (!u.searchParams.has('qa_asset_bust')) {
      u.searchParams.set('qa_asset_bust', bust(`${v.w}`));
      return route.continue({ url: u.toString() });
    }
    return route.continue();
  });

  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', r => {
    const method = r.method();
    const url = r.url();
    requests.push({ method, url });
    if (BAD_METHODS.has(method) && (/dpro-salon|workers\.dev|\/api\//i.test(url))) unsafe.push({ method, url });
  });

  await waitPublished(page);
  let s = await waitTarget(page);
  assert(s.version === EXPECT, `Runtime marker mismatch: ${s.version}`);
  assert(s.first10Count === 10, 'First10 count != 10');
  assert(s.outer.innerWidth === v.w && s.outer.innerHeight === v.h, 'Outer viewport mismatch');
  assert(s.frame?.innerWidth === v.w && s.frame?.innerHeight === v.h, 'Frame viewport mismatch');

  if (v.w <= 390) {
    assert(s.outer.docScrollWidth <= s.outer.innerWidth, 'Outer html overflow');
    assert(s.outer.bodyScrollWidth <= s.outer.innerWidth, 'Outer body overflow');
    assert(s.frame.docScrollWidth <= s.frame.innerWidth, 'Frame html overflow');
    assert(s.frame.bodyScrollWidth <= s.frame.innerWidth, 'Frame body overflow');
  }
  assert(s.card.left >= 0 && s.card.top >= 0 && s.card.right <= v.w + .5 && s.card.bottom <= v.h + .5, 'Card outside viewport');
  assert(s.highlight.width > 0 && s.highlight.height > 0, 'Highlight geometry missing');

  const productNoDrag = await page.evaluate(() => {
    const qa = window.DPRO_TUTORIAL_QA;
    const before = qa.snapshot().card;
    const fr = document.getElementById('dpro-tutorial-frame');
    const doc = fr.contentDocument;
    const step = qa.STEPS[qa.snapshot().stepIndex];
    const t = doc.querySelector(step.primary) || doc.querySelector(step.fallback);
    if (t) {
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        t.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 88, pointerType: 'touch', clientX: 12, clientY: 12 }));
      }
    }
    const after = qa.snapshot().card;
    return Math.abs(after.left - before.left) < 1 && Math.abs(after.top - before.top) < 1;
  });
  assert(productNoDrag, 'Product control initiated Tutorial drag');

  const handle = page.locator('#dpro-drag-handle');
  const hb = await handle.boundingBox();
  assert(hb, 'Drag handle missing');
  const before = s.card;
  if (v.touch) {
    await page.evaluate(({ w, h }) => {
      const el = document.getElementById('dpro-drag-handle');
      const r = el.getBoundingClientRect();
      const seq = [
        ['pointerdown', r.left + 20, r.top + 20],
        ['pointermove', w + 500, h + 500],
        ['pointerup', w + 500, h + 500],
      ];
      for (const [type, x, y] of seq) {
        el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, pointerId: 77, pointerType: 'touch', isPrimary: true,
          clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
        }));
      }
    }, { w: v.w, h: v.h });
  } else {
    await page.mouse.move(hb.x + 20, hb.y + 20);
    await page.mouse.down();
    await page.mouse.move(v.w + 500, v.h + 500, { steps: 5 });
    await page.mouse.up();
  }
  s = await snap(page);
  assert(Math.abs(s.card.left - before.left) > 2 || Math.abs(s.card.top - before.top) > 2, 'Handle drag did not move card');
  assert(s.card.left >= 0 && s.card.top >= 0 && s.card.right <= v.w + .5 && s.card.bottom <= v.h + .5, 'Drag clamp failed');

  await page.evaluate(() => window.DPRO_TUTORIAL_QA.reset());
  await page.evaluate(() => window.DPRO_TUTORIAL_QA.start());
  await waitTarget(page);
  await page.click('#dpro-next');
  await waitTarget(page);
  assert((await snap(page)).step === 2, 'Next failed');
  await page.click('#dpro-back');
  await waitTarget(page);
  assert((await snap(page)).step === 1, 'Back failed');
  await page.click('#dpro-close');
  assert((await snap(page)).status === 'closed', 'Close failed');
  await page.click('#dpro-dock');
  await waitTarget(page);
  await page.keyboard.press('Escape');
  assert((await snap(page)).status === 'closed', 'Esc failed');

  await page.evaluate(() => window.DPRO_TUTORIAL_QA.replay());
  await waitTarget(page);
  await page.evaluate(() => {
    window.DPRO_TUTORIAL_QA.next();
    window.DPRO_TUTORIAL_QA.next();
    window.DPRO_TUTORIAL_QA.next();
  });
  await waitTarget(page);
  s = await snap(page);
  assert(s.step === 4 && /staff\.html\?embed_demo=1/.test(s.frameRoute), 'Cross-page transition to staff failed');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => window.DPRO_TUTORIAL_QA?.VERSION === expected, EXPECT, { timeout: 30000 });
  await page.evaluate(() => window.DPRO_TUTORIAL_QA.resume());
  await waitTarget(page);
  s = await snap(page);
  assert(s.step === 4 && /staff\.html\?embed_demo=1/.test(s.frameRoute), 'Cross-page Resume failed');

  const fallback = await page.evaluate(() => window.DPRO_TUTORIAL_QA.testResolve('#__definitely_missing__', '.next-card'));
  assert(fallback?.kind === 'fallback', 'Fallback resolution failed');

  await page.evaluate(() => window.DPRO_TUTORIAL_QA.replay());
  await waitTarget(page);
  for (let i = 1; i < 10; i++) {
    await page.keyboard.press('ArrowRight');
    if (i < 9) await waitTarget(page);
  }
  await page.keyboard.press('ArrowRight');
  s = await snap(page);
  assert(s.status === 'complete', 'Keyboard-only completion failed');

  await page.click('#dpro-finish-replay');
  await waitTarget(page);
  assert((await snap(page)).step === 1, 'Replay after complete failed');
  await page.click('#dpro-skip');
  assert((await snap(page)).status === 'skipped', 'Skip failed');
  await page.click('#dpro-finish-replay');
  await waitTarget(page);
  assert((await snap(page)).step === 1, 'Replay after skip failed');

  await page.evaluate(() => window.DPRO_TUTORIAL_QA.focusTarget());
  const targetFocus = await page.evaluate(() => {
    const fr = document.getElementById('dpro-tutorial-frame');
    return !!fr.contentDocument.activeElement && fr.contentDocument.activeElement !== fr.contentDocument.body;
  });
  assert(targetFocus, 'Target focus recovery failed');
  await page.locator('#dpro-next').focus();
  const focus = await page.evaluate(() => ({ id: document.activeElement?.id || '' }));
  assert(focus.id === 'dpro-next', 'Tutorial focus recovery failed');

  assert(pageErrors.length === 0, 'pageerror: ' + pageErrors.join(' | '));
  assert(unsafe.length === 0, 'Unsafe business request: ' + JSON.stringify(unsafe));
  const sameOriginConsole = consoleErrors.filter(x => !/Failed to load resource/i.test(x));
  assert(sameOriginConsole.length === 0, 'Console errors: ' + sameOriginConsole.join(' | '));

  const out = {
    viewport: `${v.w}x${v.h}`, touch: v.touch, first10: 10,
    overflow: v.w <= 390 ? 0 : 'checked', drag: 'PASS', clamp: 'PASS', controls: 'PASS',
    keyboard: 'PASS', resume: 'PASS', replay: 'PASS', fallback: 'PASS',
    pageerror: 0, unsafeWrite: 0, requests: requests.length, status: 'PASS',
  };
  results.push(out);
  console.log('R3_VIEWPORT_PASS', JSON.stringify(out));
  await context.close();
}

const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  for (const v of VIEWPORTS) await basicViewportQA(browser, v);
} catch (e) {
  failed = e;
  console.error('R3_QA_FAIL', e.stack || e);
} finally {
  await browser.close();
}

console.log('R3_QA_RESULT=' + JSON.stringify({
  qaRevision: QA_REV,
  version: EXPECT,
  base: BASE,
  results,
  businessMutation: 0,
  status: failed ? 'HOLD' : 'PASS',
}));
if (failed) process.exit(1);
