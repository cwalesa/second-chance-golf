// Moving a building or object, turning and moving the clubhouse, and a zoomed-out map that keeps its detail.
module.exports = async ({ browser, base, freshCourse, touch, ok, tileXY, withClubhouse, waitCamera }) => {
  const { page, ctx, errors } = await freshCourse(browser, base, 'desktop');
  const t = await touch(page);
  await withClubhouse(page);
  const g = (fn, a) => page.evaluate(fn, a);
  // a meadow beside the clubhouse for a building and a bench
  const spots = await g(() => {
    const s = window.scg, w = s.game.world, c = w.clubhouse;
    s.game.cash = 100000;
    const clear = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w.w + x; if (w.terrain[i] === 1 || w.terrain[i] === 0) w.terrain[i] = 0; w.tree[i] = 0; w.dirty.add(i); } };
    const a = { x: c.x + 2, y: c.y + 14 }, b = { x: c.x + 12, y: c.y + 14 };
    clear(a.x - 2, a.y - 2, a.x + 20, a.y + 8); w.version++;
    return { a, b, club: { ...c } };
  });
  await g(async (sp) => { const { toggleItem } = await import('/src/items.ts'); const s = window.scg; toggleItem(s.game, sp.a, 'grill'); toggleItem(s.game, sp.b, 'bench'); }, spots);
  await g(() => { const s = window.scg; s.editor.setTool('decor'); s.ui.refresh(true); });
  await g((sp) => window.scg.editor.focusPoints([sp.a, sp.b]), spots); await page.waitForTimeout(1000); await waitCamera(page);

  // ---- move the grill room by tapping it, then a new tile
  const grillAt = await tileXY(page, spots.a.x + 1, spots.a.y + 1);
  await t.tap(grillAt); await page.waitForTimeout(400);
  ok('tapping a building picks it up', await g(() => { const b = window.scg.editor.bGhost; return !!b && b.k === 'grill' && b.move !== undefined; }));
  ok('the card offers Move here, Sell and Cancel', await g(() => !!document.getElementById('bgOk') && !!document.getElementById('bgSell') && !!document.getElementById('bgNo')));
  ok('Move here waits until it has been taken somewhere new', await g(() => document.getElementById('bgOk').disabled));
  const cash0 = await g(() => window.scg.game.cash);
  const dest = { x: spots.a.x + 4, y: spots.a.y + 5 };
  await t.tap(await tileXY(page, dest.x, dest.y)); await page.waitForTimeout(400);
  const gh = await g(() => window.scg.editor.bGhost);
  ok('tapping another tile carries the ghost there', gh && Math.abs(gh.x - (dest.x - 1)) <= 1 && Math.abs(gh.y - (dest.y - 1)) <= 1, JSON.stringify(gh));
  ok('Move here is then available', await g(() => !document.getElementById('bgOk').disabled));
  await g(() => document.getElementById('bgOk').click()); await page.waitForTimeout(500);
  const grill = await g(() => window.scg.game.world.items.find((i) => i.k === 'grill'));
  ok('the building stands at its new spot', grill && (grill.x !== spots.a.x || grill.y !== spots.a.y), JSON.stringify(grill));
  ok('moving it cost nothing', (await g(() => window.scg.game.cash)) === cash0);
  ok('and the card is gone', await g(() => !window.scg.editor.bGhost));

  // ---- a small object: pick up and sell
  await t.tap(await tileXY(page, spots.b.x, spots.b.y)); await page.waitForTimeout(400);
  ok('tapping a bench picks it up too', await g(() => { const b = window.scg.editor.bGhost; return !!b && b.k === 'bench' && b.move !== undefined; }));
  await g(() => document.getElementById('bgNo').click()); await page.waitForTimeout(300);
  ok('Cancel leaves the bench where it was', await g((sp) => window.scg.game.world.items.some((i) => i.k === 'bench' && i.x === sp.b.x && i.y === sp.b.y), spots));
  await t.tap(await tileXY(page, spots.b.x, spots.b.y)); await page.waitForTimeout(300);
  const cash1 = await g(() => window.scg.game.cash);
  await g(() => document.getElementById('bgSell').click()); await page.waitForTimeout(400);
  ok('Sell gives the price back', (await g(() => window.scg.game.cash)) > cash1 && !(await g(() => window.scg.game.world.items.some((i) => i.k === 'bench'))));

  // ---- the clubhouse: lift, turn, put down
  await g((c) => window.scg.editor.focusPoints([{ x: c.x, y: c.y }, { x: c.x + 8, y: c.y + 8 }]), spots.club); await page.waitForTimeout(900); await waitCamera(page);
  await t.tap(await tileXY(page, spots.club.x + 3, spots.club.y + 2)); await page.waitForTimeout(500);
  ok('tapping the clubhouse picks it up', await g(() => window.scg.editor.relocClub && !!document.getElementById('clubRot')));
  await g(() => document.getElementById('clubRot').click()); await page.waitForTimeout(400);
  ok('Rotate turns the ghost', await g(() => window.scg.editor.overlay.club && window.scg.editor.overlay.club.flip === true));
  ok('and says why when it cannot go there (the grill room stands in the turned grounds)', await g(() => { const p = window.scg.editor.clubSpot.problem; return p === null || /Move it first|in the way/.test(p); }));
  // move the grill room out of the way if it blocks the turn
  await g(async () => { const s = window.scg; const { moveItem } = await import('/src/items.ts'); const i = s.game.world.items.findIndex((x) => x.k === 'grill'); if (s.editor.clubSpot.problem) { moveItem(s.game, i, { x: s.game.world.clubhouse.x + 30, y: s.game.world.clubhouse.y + 14 }); s.editor.rotateClub(); s.editor.rotateClub(); } });
  await page.waitForTimeout(300);
  await g(() => document.getElementById('clubOk').click()); await page.waitForTimeout(600);
  ok('the clubhouse is turned', await g(() => window.scg.game.world.clubFlip === true && !window.scg.editor.relocClub), await g(() => window.scg.editor.clubSpot && window.scg.editor.clubSpot.problem));
  ok('its door and road follow', await g(() => { const w = window.scg.game.world; return w.gate.y === 0.5 || w.gate.y === w.h - 0.5; }));
  await g(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload(); await page.waitForTimeout(2500);
  await g(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Collect'))?.click());
  ok('the turn survives a reload', await g(() => window.scg.game.world.clubFlip === true));

  // ---- zoomed right out the forest keeps its detail and the clubhouse does not dominate
  await g(() => { const s = window.scg, w = s.game.world, c = w.clubhouse; s.renderer.focus(c.x + 3, c.y + 3, s.renderer.minZoom(w), w, true); });
  await page.waitForTimeout(1500);
  const stats = await g(() => {
    const cv = document.getElementById('view'), c2 = cv.getContext('2d');
    const d = c2.getImageData(0, 0, cv.width, cv.height).data;
    const bins = new Set(); let n = 0;
    for (let y = 0; y < cv.height; y += 6) for (let x = 0; x < cv.width; x += 6) { const i = (y * cv.width + x) * 4; bins.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); n++; }
    return { colours: bins.size, zoom: window.scg.renderer.cam.zoom };
  });
  ok('the far map keeps its colour and detail (trees are drawn, not a flat wash)', stats.colours > 120, JSON.stringify(stats));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
};
