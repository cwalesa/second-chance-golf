// Placing a hole: trees fade, Cancel and Undo restore everything, Build charges the previewed cost, bend drags keep the camera still.
module.exports = async ({ browser, base, freshCourse, touch, ok, tileXY, withClubhouse, suggestedHole, waitCamera }) => {
  for (const kind of ['phone', 'desktop']) {
    console.log(` ${kind}`);
    const { page, ctx, errors } = await freshCourse(browser, base, kind);
    const t = await touch(page);
    await withClubhouse(page);
    const sug = await suggestedHole(page);
    const snap = () => page.evaluate(() => ({ cash: window.scg.game.cash, terrain: Array.from(window.scg.game.world.terrain).join(''), tree: Array.from(window.scg.game.world.tree).join(''), holes: window.scg.game.world.holes.length }));
    const fades = () => page.evaluate(() => window.scg.renderer.treeFade.size);
    const place = async () => {
      await page.evaluate(() => window.scg.editor.setTool('build')); await page.waitForTimeout(400);
      await page.evaluate((s) => window.scg.editor.focusPoints([s.tee, s.cup]), sug); await page.waitForTimeout(900); await waitCamera(page);
      await t.tap(await tileXY(page, sug.tee.x, sug.tee.y));
      await t.tap(await tileXY(page, sug.cup.x, sug.cup.y));
      await page.waitForTimeout(600);
    };
    const base0 = await snap();
    await place(); await page.waitForTimeout(1200);
    ok(`${kind}: trees fade while the hole is placed`, (await fades()) > 0, String(await fades()));
    ok(`${kind}: the confirm bar is on screen`, await page.evaluate(() => { const c = document.getElementById('confirm'); return !!c && c.getClientRects().length > 0; }));
    await page.evaluate(() => document.getElementById('cfNo').click()); await page.waitForTimeout(1500);
    let s = await snap();
    ok(`${kind}: Cancel restores the trees and leaves terrain and cash alone`, (await fades()) === 0 && s.cash === base0.cash && s.terrain === base0.terrain && s.tree === base0.tree);
    await place(); await page.waitForTimeout(500);
    const cost = await page.evaluate(() => window.scg.editor.proposal.cost);
    await page.evaluate(() => document.getElementById('cfOk').click()); await page.waitForTimeout(1500);
    s = await snap();
    ok(`${kind}: Build charges exactly the previewed cost`, base0.cash - s.cash === cost && s.holes === 1, `${base0.cash - s.cash} vs ${cost}`);
    ok(`${kind}: no tree is left faded after Build`, (await fades()) === 0);
    await page.evaluate(() => window.scg.editor.undo()); await page.waitForTimeout(500);
    s = await snap();
    ok(`${kind}: Undo restores cash, terrain and trees`, s.cash === base0.cash && s.terrain === base0.terrain && s.tree === base0.tree && s.holes === 0);
    await page.evaluate(() => window.scg.editor.redo()); await page.waitForTimeout(500);
    // bend drag
    await page.evaluate(() => { const s = window.scg; s.editor.selectHole(1); s.editor.setTool('bend'); if (s.ui.mobile) s.ui.tab = 'build'; s.ui.refresh(true); });
    await page.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('cfBend').click()); await page.waitForTimeout(700);
    const pin = await page.evaluate(() => { const ui = window.scg.editor.overlay.bendUi; const g = window.scg.renderer.pinGeom({ x: ui.bends[0].x + 0.5, y: ui.bends[0].y + 0.5 }); const b = document.getElementById('view').getBoundingClientRect(); return { x: g.head.x + b.left, y: g.head.y + b.top }; });
    const camA = await page.evaluate(() => ({ ...window.scg.renderer.cam }));
    await t.start(pin); await page.waitForTimeout(330);
    await t.drag(pin, { x: pin.x + 25, y: pin.y + 30 }, 10, 25);
    const camB = await page.evaluate(() => ({ ...window.scg.renderer.cam }));
    const live = await page.evaluate(() => { const u = window.scg.editor.overlay.bendUi; return { total: u.total }; });
    const bar = await page.evaluate(() => document.getElementById('confirm').innerText);
    await t.end(); await page.waitForTimeout(500);
    ok(`${kind}: the camera stays put during a bend drag`, Math.abs(camA.x - camB.x) < 0.01 && Math.abs(camA.y - camB.y) < 0.01 && camA.zoom === camB.zoom);
    ok(`${kind}: the live yardage on the bar matches the preview`, bar.includes(`${live.total} yd`), `${live.total} / ${bar.replace(/\n/g, ' ')}`);
    ok(`${kind}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
};
