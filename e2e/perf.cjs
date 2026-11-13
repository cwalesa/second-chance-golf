// Frame-time profiler: npm run perf -- [--kind desktop|phone] [--holes 9] [--speed 1|3|8] [--secs 20] [--mode idle|pan|zoom|panel|edit] [--age 0] [--paused] [--cpu 1] [--json out.json]
// It builds a course on the real game in Chromium, optionally ages it (simulated days run without drawing), then records every frame for a while:
// the gap between frames, how long drawing, simulating and the interface each took, long tasks, saves and what is growing.
// Chromium here is headless and software-drawn, so absolute milliseconds differ from a phone; compare runs of the same machine with each other.
const lib = require('./lib.cjs');
const fs = require('fs');

function args() {
  const a = process.argv.slice(2), o = { kind: 'desktop', holes: 9, speed: 1, secs: 20, mode: 'idle', age: 0, paused: false, cpu: 1, json: '', prof: false, methods: false, load: '', save: '' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, '');
    if (k === 'paused') o.paused = true;
    else if (k === 'prof') o.prof = true;
    else if (k === 'methods') o.methods = true;
    else if (k in o) o[k] = typeof o[k] === 'number' ? Number(a[++i]) : a[++i];
  }
  return o;
}

/** Runs inside the page: builds holes on a fresh course. */
async function buildCourse(want) {
  const { planNewHole } = await import('/src/editing.ts');
  const { suggestClubhouse } = await import('/src/wilderness.ts');
  const s = window.scg, g = s.game, w = g.world;
  if (!w.clubhouse) { const c = suggestClubhouse(w); g.buildClubhouse(c); }
  s.tutorial.exit();
  g.cash = 5e6;
  if ('clubLevel' in g) { try { g.clubLevel = 4; } catch { /* getter only */ } }
  const c = w.clubhouse;
  let made = 0, tries = 0, seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (made < want && tries < 4000) {
    tries++;
    const ang = rnd() * Math.PI * 2, r = 22 + rnd() * 60, len = 22 + rnd() * 24, a2 = ang + (rnd() - 0.5) * 1.4;
    const tee = { x: Math.round(c.x + 3 + Math.cos(ang) * r), y: Math.round(c.y + 3 + Math.sin(ang) * r) };
    const cup = { x: Math.round(tee.x + Math.cos(a2) * len), y: Math.round(tee.y + Math.sin(a2) * len) };
    const plan = planNewHole(w, g.nextHoleId(), tee, cup, { par: 4 });
    if (typeof plan === 'string') continue;
    if (g.commitEdit(plan).ok) made++;
  }
  for (const h of w.holes) g.openHole(h.id);
  s.editor.setTool('inspect'); g.exitDesign();
  return { holes: w.holes.length, open: w.holes.filter((h) => h.open).length, size: [w.w, w.h], tries };
}

/** Runs inside the page: install the probes. */
function install() {
  const s = window.scg, P = (window.__perf = { frames: [], marks: {}, long: [], saves: [], t0: performance.now(), gc: [] });
  const wrap = (obj, name, key) => {
    const f = obj[name];
    obj[name] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { (P.marks[key] ??= []).push(performance.now() - t); } };
  };
  wrap(s.renderer, 'render', 'render');
  if (window.__methods) {
    const proto = Object.getPrototypeOf(s.renderer), skip = new Set(['constructor', 'render', 'toScreen', 'toWorld', 'drawTree', 'drawGolfer', 'treeVariant', 'treeSpecies', 'shaded', 'nearScreen', 'withRise', 'faintIf', 'farScale', 'withClubFlip', 'clubPainter', 'facilityPainter', 'hash2', 'groundPolygon', 'drawBall', 'drawBubble', 'drawChips', 'golferLook', 'aimSide', 'puttingSpot']);
    for (const name of Object.getOwnPropertyNames(proto)) { const d = Object.getOwnPropertyDescriptor(proto, name); if (typeof d.value === 'function' && !skip.has(name)) wrap(s.renderer, name, 'r.' + name); }
  }
  wrap(s.game, 'advance', 'advance');
  wrap(s.ui, 'refresh', 'ui.refresh');
  wrap(s.tutorial, 'update', 'tutorial.update');
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { const t = performance.now(); try { return set.call(this, k, v); } finally { P.saves.push({ at: performance.now() - P.t0, ms: performance.now() - t, bytes: v.length }); } };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ at: e.startTime - P.t0, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no long task API */ }
  let last = performance.now();
  const tick = (now) => { P.frames.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function pct(a, p) { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor((p / 100) * b.length))]; }
const round = (x) => Math.round(x * 100) / 100;
function stats(a) {
  if (!a.length) return null;
  const sum = a.reduce((x, y) => x + y, 0);
  return { n: a.length, mean: round(sum / a.length), p50: round(pct(a, 50)), p95: round(pct(a, 95)), p99: round(pct(a, 99)), max: round(a.reduce((m, x) => (x > m ? x : m), 0)), total: round(sum) };
}

function growth(page) {
  return page.evaluate(() => {
    const s = window.scg, g = s.game, r = s.renderer;
    const size = (o) => (o == null ? 0 : o.size ?? o.length ?? (typeof o === 'object' ? Object.keys(o).length : 0));
    const out = { golfers: g.sim.golfers.length, dom: document.getElementsByTagName('*').length, day: g.day };
    for (const [k, o] of [['sim', g.sim], ['game', g], ['renderer', r], ['ui', s.ui], ['editor', s.editor]]) {
      for (const key of Object.keys(o)) { const v = o[key]; if (Array.isArray(v) || v instanceof Map || v instanceof Set) out[`${k}.${key}`] = size(v); }
    }
    if (performance.memory) out.heapMB = Math.round(performance.memory.usedJSHeapSize / 1e5) / 10;
    return out;
  });
}

(async () => {
  const o = args();
  const server = await lib.startServer(5210 + Math.floor(Math.random() * 50));
  const browser = await lib.launch();
  const { page, ctx, errors } = await lib.freshCourse(browser, server.base, o.kind);
  const cdp = await ctx.newCDPSession(page);
  if (o.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
  let built;
  if (o.load) {
    // a course aged earlier (see --save): put it in storage and reload, as a returning player would
    await page.addInitScript((txt) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('second-chance-golf.save.v2', txt); } }, fs.readFileSync(o.load, 'utf8'));
    await page.reload(); await page.waitForTimeout(3000);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Collect|Continue|Close/.test(b.textContent.trim()))?.click());
    await page.waitForFunction(() => window.scg && window.scg.game, null, { timeout: 15000 });
    built = await page.evaluate(() => { const w = window.scg.game.world; window.scg.tutorial.exit(); return { holes: w.holes.length, open: w.holes.filter((h) => h.open).length, size: [w.w, w.h], loaded: true }; });
  } else built = await page.evaluate(buildCourse, o.holes);
  console.log('course', JSON.stringify(built));
  if (o.age > 0) {
    // an extended session: simulated days played without drawing, at normal rules (open, running)
    const r = await page.evaluate(async (days) => {
      const s = window.scg, g = s.game, STEP = 1 / 30;
      g.openForBusiness(); g.resume(); g.setSpeed(1);
      const t = performance.now(); let steps = 0;
      const target = g.day + days;
      while (g.day < target && steps < 3e6) { g.advance(STEP); steps++; if (g.pendingRecap) g.dismissRecap?.(); if (steps % 60000 === 0) await new Promise((r) => setTimeout(r, 0)); }
      return { steps, ms: Math.round(performance.now() - t), day: g.day, golfers: g.sim.golfers.length };
    }, o.age);
    console.log('aged', JSON.stringify(r));
  }
  if (o.save) { const txt = await page.evaluate(async () => { const { serialize } = await import('/src/save.ts'); return serialize(window.scg.game); }); fs.writeFileSync(o.save, txt); console.log('saved', o.save, txt.length); }
  const before = await growth(page);
  await page.evaluate(({ paused, speed }) => {
    const g = window.scg.game;
    if (paused) { g.pause?.(); g.setSpeed(0); return; }
    g.openForBusiness(); g.resume(); g.setSpeed(speed);
  }, { paused: o.paused, speed: o.speed });
  // let the ground finish building after a load or a camera jump, so the numbers are for steady play
  await page.waitForFunction(() => window.scg.renderer.queue.length === 0, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (o.methods) await page.evaluate(() => { window.__methods = true; });
  await page.evaluate(install);
  const mode = o.mode;
  if (o.prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const driver = page.evaluate(async ({ mode, ms }) => {
    const s = window.scg, r = s.renderer, w = s.game.world, c = w.clubhouse;
    const end = performance.now() + ms;
    let k = 0;
    while (performance.now() < end) {
      k++;
      if (mode === 'pan') r.focus(c.x + 40 * Math.cos(k / 40), c.y + 30 * Math.sin(k / 55), r.cam.zoom, w, true);
      else if (mode === 'zoom') r.focus(c.x, c.y, 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(k / 60)), w, true);
      else if (mode === 'panel') { s.ui.tab = ['money', 'course', 'none', 'build'][Math.floor(k / 30) % 4]; s.ui.refresh(true); }
      else if (mode === 'edit') {
        const { planPaint } = await import('/src/editing.ts');
        if (k % 20 === 0) { const t = []; const x0 = c.x + 20 + (k % 60), y0 = c.y + 20; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) t.push((y0 + dy) * w.w + x0 + dx); const p = planPaint(w, k % 40 ? 'fairway' : 'rough', t); if (typeof p !== 'string') s.game.commitEdit(p); }
      }
      await new Promise((res) => requestAnimationFrame(() => res()));
    }
  }, { mode, ms: o.secs * 1000 });
  await driver;
  if (o.prof) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas; let tot = 0;
    profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + dt[i]); tot += dt[i]; });
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28);
    console.log('--- top self time (ms of ' + Math.round(tot / 1000) + ')');
    for (const [k, v] of top) console.log(String(Math.round(v / 1000)).padStart(6), k);
  }
  const res = await page.evaluate(() => { const P = window.__perf; return { frames: P.frames, marks: P.marks, long: P.long, saves: P.saves }; });
  const after = await growth(page);
  const ser = await page.evaluate(async () => { const { serialize } = await import('/src/save.ts'); const t = performance.now(); const x = serialize(window.scg.game); return { ms: performance.now() - t, bytes: x.length }; });
  const fr = res.frames.slice(5);
  const out = {
    options: o, course: built,
    frameGap: stats(fr), over33: fr.filter((x) => x > 33.4).length, over50: fr.filter((x) => x > 50).length, over100: fr.filter((x) => x > 100).length,
    fps: round(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)),
    sections: Object.fromEntries(Object.entries(res.marks).map(([k, v]) => [k, stats(v)])),
    longTasks: { n: res.long.length, over100: res.long.filter((l) => l.ms > 100).length, worst: round(res.long.reduce((m, l) => (l.ms > m ? l.ms : m), 0)) },
    saves: { n: res.saves.length, worstMs: round(res.saves.reduce((m, x) => (x.ms > m ? x.ms : m), 0)), bytes: res.saves.at(-1)?.bytes ?? 0 },
    serializeOnce: { ms: round(ser.ms), bytes: ser.bytes },
    growth: Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => [k, `${before[k]} -> ${after[k]}`])),
    errors,
  };
  console.log(JSON.stringify(out, null, 1));
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ ...out, frames: fr }));
  await browser.close();
  server.stop();
})();
