// Shared helpers for the browser (end-to-end) suites. See e2e/README.md.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

/** Start the Vite dev server on a free port and wait until it answers. */
async function startServer(port = 5199) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 80; i++) {
    const up = await new Promise((res) => http.get(base, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
    if (up) return { base, stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('the dev server did not start');
}

function launch() {
  // CI installs Chromium with `npx playwright install chromium`; some sandboxes ship one at a fixed path
  const fixed = process.env.E2E_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch(fixed ? { executablePath: fixed } : {});
}

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  narrow: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true },
};

/** A page on a brand-new course, past the start screen. */
async function freshCourse(browser, base, kind) {
  const ctx = await browser.newContext(VIEWPORTS[kind]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start-play', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.start-play').click());
  await page.waitForFunction(() => window.scg && window.scg.game, null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  return { page, ctx, errors, kind };
}

/** Touch events over the Chrome protocol, so the page sees real pointer events with pointerType "touch". */
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const t = {
    start: (...p) => send('touchStart', p),
    move: (...p) => send('touchMove', p),
    end: () => send('touchEnd', []),
    cancel: () => send('touchCancel', []),
    async drag(from, to, n = 12, ms = 16) { for (let i = 1; i <= n; i++) { await t.move({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }); await page.waitForTimeout(ms); } },
    async tap(p) { await t.start(p); await page.waitForTimeout(60); await t.end(); await page.waitForTimeout(300); },
  };
  return t;
}

/** Collects PASS/FAIL lines for one suite. */
function reporter(name) {
  const results = [];
  const ok = (what, cond, extra = '') => {
    results.push({ what, pass: !!cond });
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${what}${extra ? ' :: ' + String(extra).slice(0, 200) : ''}`);
    return !!cond;
  };
  return { name, results, ok };
}

const scg = (page, fn, arg) => page.evaluate(fn, arg);
/** Where a map tile is on the screen, in page coordinates. */
const tileXY = (page, wx, wy) => page.evaluate(([wx, wy]) => { const p = window.scg.renderer.toScreen(wx + 0.5, wy + 0.5); const b = document.getElementById('view').getBoundingClientRect(); return { x: p.x + b.left, y: p.y + b.top }; }, [wx, wy]);
const clickSel = (page, sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, sel);
const coachText = (page) => page.evaluate(() => { const c = document.getElementById('coach'); return c && !c.hidden ? c.querySelector('.coach-short')?.textContent ?? null : null; });
const waitCamera = async (page) => { for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => window.scg.renderer.cameraMoving))) return; await page.waitForTimeout(100); } };

/** Give a fresh course a clubhouse (the tutorial is left in place unless `exitTutorial`). */
async function withClubhouse(page, { exitTutorial = true } = {}) {
  await page.evaluate(async (exit) => {
    const { suggestClubhouse } = await import('/src/wilderness.ts');
    const s = window.scg;
    const c = suggestClubhouse(s.game.world);
    s.game.buildClubhouse({ x: c.x, y: c.y });
    if (exit) s.tutorial.exit();
  }, exitTutorial);
  await page.waitForTimeout(400);
}
const suggestedHole = (page) => page.evaluate(async () => { const { suggestFirstHole } = await import('/src/wilderness.ts'); return suggestFirstHole(window.scg.game.world); });

module.exports = { startServer, launch, freshCourse, touch, reporter, scg, tileXY, clickSel, coachText, waitCamera, withClubhouse, suggestedHole, VIEWPORTS, ROOT };
