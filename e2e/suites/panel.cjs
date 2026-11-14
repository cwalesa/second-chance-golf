// The hole panel answers to taps: sections, par, open/close, resize, close; paused and while the course is running.
module.exports = async ({ browser, base, freshCourse, touch, ok, tileXY, withClubhouse, suggestedHole }) => {
  for (const [kind, running] of [['phone', false], ['desktop', false], ['phone', true], ['desktop', true]]) {
    const tag = `${kind}${running ? ' running' : ' paused'}`;
    console.log(` ${tag}`);
    const { page, ctx, errors } = await freshCourse(browser, base, kind);
    await withClubhouse(page);
    const sug = await suggestedHole(page);
    await page.evaluate(async (sug) => {
      const { planNewHole } = await import('/src/editing.ts');
      const s = window.scg, g = s.game;
      g.commitEdit(planNewHole(g.world, g.nextHoleId(), sug.tee, sug.cup, { par: 3 }));
      g.openHole(1); s.editor.setTool('inspect'); g.exitDesign();
      s.editor.selectHole(1); s.ui.tab = 'course'; s.ui.refresh(true);
    }, sug);
    if (running) await page.evaluate(() => { const g = window.scg.game; g.openForBusiness(); g.resume(); g.setSpeed(3); });
    await page.waitForTimeout(running ? 4000 : 1500);
    const t = await touch(page);
    const centre = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const body = document.getElementById('sidebody'); const r0 = e.getBoundingClientRect(), b = body.getBoundingClientRect(); if (e.closest('#sidebody')) body.scrollTop += r0.top - b.top - b.height / 2 + r0.height / 2; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const press = async (sel) => { const c = await centre(sel); if (!c) return false; await page.waitForTimeout(120); await t.tap(c); return true; };
    const isOpen = (sec) => page.evaluate((s) => document.querySelector(`#sidebody details[data-sec="${s}"]`)?.open ?? null, sec);
    const g = (fn, a) => page.evaluate(fn, a);
    ok(`${tag}: the hole panel is open`, (await g(() => window.scg.ui.tab)) === 'course');
    for (const sec of ['edit', 'results', 'design', 'turf']) {
      const sel = `#sidebody details[data-sec="${sec}"] > summary`;
      if (!(await centre(sel))) continue;
      const before = await isOpen(sec);
      await press(sel); await page.waitForTimeout(250);
      ok(`${tag}: ${sec} section toggles on tap`, (await isOpen(sec)) === !before);
    }
    await page.waitForTimeout(2500);
    ok(`${tag}: expanded sections stay open while the game updates`, await g(() => ['edit', 'results', 'design', 'turf'].every((k) => { const d = document.querySelector(`#sidebody details[data-sec="${k}"]`); return !d || d.open; })));
    await press('[data-act="setpar"][data-id="5"]'); await page.waitForTimeout(300);
    ok(`${tag}: a par button changes the par`, (await g(() => window.scg.game.hole(window.scg.game.selectedHole).par)) === 5);
    await press('[data-act="setpar"][data-id="3"]'); await page.waitForTimeout(300);
    const before = await g(() => ({ tool: window.scg.editor.tool, holes: window.scg.game.world.holes.length, tab: window.scg.ui.tab }));
    await g(() => { window.__vh = 0; document.getElementById('view').addEventListener('pointerdown', () => window.__vh++); });
    await press('#sidebody details[data-sec="turf"] > summary'); await page.waitForTimeout(300);
    const after = await g(() => ({ tool: window.scg.editor.tool, holes: window.scg.game.world.holes.length, tab: window.scg.ui.tab }));
    ok(`${tag}: taps on the panel never reach the map`, (await g(() => window.__vh)) === 0 && JSON.stringify(before) === JSON.stringify(after));
    const wasOpen = await g(() => window.scg.game.hole(1).open);
    await press(wasOpen ? '[data-act="close"]' : '[data-act="open"]'); await page.waitForTimeout(400);
    ok(`${tag}: Open/Close hole flips the hole`, (await g(() => window.scg.game.hole(1).open)) !== wasOpen);
    await press(wasOpen ? '[data-act="open"]' : '[data-act="close"]'); await page.waitForTimeout(400);
    ok(`${tag}: and flips it back`, (await g(() => window.scg.game.hole(1).open)) === wasOpen);
    await g(() => { window.scg.ui.tab = 'course'; window.scg.ui.refresh(true); }); await page.waitForTimeout(400);
    await press('#sheetClose'); await page.waitForTimeout(400);
    ok(`${tag}: the close control closes the panel`, (await g(() => window.scg.ui.tab)) === 'none');
    await g(() => document.querySelector('[data-tab="course"]').click()); await page.waitForTimeout(500);
    ok(`${tag}: the panel reopens and sections still work`, (await g(() => window.scg.ui.tab)) === 'course' && (await press('#sidebody details[data-sec="edit"] > summary')) !== false);
    ok(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
};
