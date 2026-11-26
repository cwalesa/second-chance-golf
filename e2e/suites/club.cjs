// The club update: hole report and overlays, facilities, regulars, calendar and a full tournament, decisions,
// new-hole placement feedback, the return summary and accessible dialogs, on a phone and on a narrow touch screen.
module.exports = async ({ browser, base, freshCourse, ok, withClubhouse, touch }) => {
  for (const kind of ['phone', 'narrow']) {
    console.log(` ${kind}`);
    const { page, ctx, errors } = await freshCourse(browser, base, kind);
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await withClubhouse(page);
    const g = (fn, a) => page.evaluate(fn, a);
    await g(async () => {
      const { autoCourse, placeNear } = await import('/tests/autocourse.ts');
      const s = window.scg, game = s.game;
      game.clubLevel = 1;
      autoCourse(game, [4, 3, 4, 5, 4, 3], 3);
      placeNear(game, 'puttingGreen'); placeNear(game, 'academy'); placeNear(game, 'restaurant'); placeNear(game, 'tourney');
      game.cash = 40000;
      game.preferences.dailyReports = false;
      for (let i = 0; i < 3 * 12600; i++) game.step(1 / 30);
      s.ui.refresh(true);
    });
    const noOverflow = () => g(() => { const b = document.getElementById('sidebody'); return !b || b.scrollWidth <= b.clientWidth + 1; });

    // hole report and overlays
    await g(() => { const s = window.scg; s.editor.selectHole(1); s.ui.tab = 'course'; s.ui.sheet = 'full'; s.ui.refresh(true); });
    await page.waitForTimeout(400);
    ok(`${kind}: the hole report shows each kind of golfer, a weakness and a suggestion`, await g(() => { const r = document.querySelector('.hole-report'); return !!r && r.querySelectorAll('.seg').length === 4 && /Weakness/.test(r.textContent) && /Try this/.test(r.textContent) && /recent plays/.test(r.textContent); }));
    ok(`${kind}: the hole report fits the screen`, await noOverflow());
    await g(() => document.querySelector('[data-act="overlay"][data-id="queues"]').click());
    await page.waitForTimeout(300);
    ok(`${kind}: the queue overlay turns on from the report`, (await g(() => window.scg.game.overlay)) === 'queues');
    await g(() => { window.scg.game.overlay = 'off'; });

    // regulars, facilities, identity
    await g(() => { const s = window.scg; s.ui.tab = 'guests'; s.ui.refresh(true); });
    await page.waitForTimeout(300);
    ok(`${kind}: regulars appear by name with a goal`, await g(() => document.querySelectorAll('.reg-card').length > 0 && !!document.querySelector('.reg-goal')));
    ok(`${kind}: membership shows prospects and how they join`, await g(() => /join/.test(document.getElementById('sidebody').textContent)));
    await g(() => { const s = window.scg; s.ui.tab = 'club'; s.ui.refresh(true); });
    await page.waitForTimeout(300);
    ok(`${kind}: the three facilities have cards with upgrades`, await g(() => document.querySelectorAll('[data-fac]').length === 3 && document.querySelectorAll('[data-act="facup"]').length === 3));
    const before = await g(() => window.scg.game.fac.academy.coaches);
    await g(() => document.querySelector('[data-act="coach"][data-id="1"]').click());
    ok(`${kind}: a coach can be hired from the academy card`, (await g(() => window.scg.game.fac.academy.coaches)) === before + 1);
    await g(() => document.querySelector('[data-act="facup"][data-id="restaurant"]').click());
    ok(`${kind}: the restaurant upgrades`, (await g(() => window.scg.game.fac.restaurant.level)) === 2);
    ok(`${kind}: club identity is shown`, await g(() => !!document.querySelector('.identity')));
    ok(`${kind}: the club panel fits the screen`, await noOverflow());

    // a tapped facility on the map opens its card
    const tapped = await g(() => { const s = window.scg, it = s.game.world.items.find((i) => i.k === 'academy'); s.ui.tab = 'none'; s.ui.refresh(true); s.renderer.focus(it.x + 2.5, it.y + 1.5, 1, s.game.world, true); s.game.sim.golfers = []; s.game.firstRound.shown = true; s.game.goalJustDone = null; s.game.cheers = []; document.getElementById('goalpop')?.remove(); const rc = document.getElementById('roundcard'); if (rc) rc.hidden = true; return { x: it.x + 2, y: it.y + 1 }; });
    await page.waitForTimeout(600);
    const pt = await g((t) => { const p = window.scg.renderer.toScreen(t.x + 0.5, t.y + 0.5); const b = document.getElementById('view').getBoundingClientRect(); return { x: p.x + b.left, y: p.y + b.top }; }, tapped);
    const hit = await g((p) => { const e = document.elementFromPoint(p.x, p.y); return e ? (e.id || e.className || e.tagName) : 'none'; }, pt);
    if (hit !== 'view') console.log('    tap point is covered by', hit, JSON.stringify(pt));
    const t = await touch(page);
    await t.tap(pt);
    await page.waitForTimeout(500);
    const tab = await g(() => window.scg.ui.tab);
    ok(`${kind}: tapping the academy on the map opens the Clubhouse panel`, tab === 'club', tab);

    // calendar: commit to a championship, set it up, play it, read the report
    await g(() => { const s = window.scg; s.ui.tab = 'events'; s.ui.refresh(true); });
    await page.waitForTimeout(300);
    ok(`${kind}: the calendar shows ten days with a forecast`, await g(() => document.querySelectorAll('.cal-day').length === 10));
    const day = await g(async () => {
      const { commit } = await import('/src/calendar.ts');
      const game = window.scg.game, d = game.day + 1;
      game.calendar.offers = game.calendar.offers.filter((o) => o.day !== d);
      commit(game, 'championship', d, {});
      window.scg.ui.refresh(true);
      return d;
    });
    await g((d) => { document.querySelector(`[data-act="touredit"][data-id="${d}"]`).click(); }, day);
    await page.waitForTimeout(300);
    ok(`${kind}: a committed tournament offers route, preparation and access`, await g(() => document.querySelectorAll('[data-act="tourhole"]').length >= 4 && !!document.querySelector('[data-act="tourprep"]') && !!document.querySelector('[data-act="touraccess"]')));
    await g((d) => { document.querySelector(`[data-act="tourprep"][data-id="championship"][data-day="${d}"]`).click(); }, day);
    await g((d) => { document.querySelector(`[data-act="tourhole"][data-day="${d}"]`).click(); }, day); // leave the first hole out
    const b = await g((d) => window.scg.game.bookings.find((x) => x.day === d), day);
    ok(`${kind}: route and preparation choices are kept`, b.prep === 'championship' && b.route && b.route.length >= 3);
    ok(`${kind}: the calendar fits the screen`, await noOverflow());
    await g((d) => { const game = window.scg.game; while (game.day < d || game.clock < 300) game.step(1 / 30); window.scg.ui.tab = 'events'; window.scg.ui.refresh(true); }, day);
    await page.waitForTimeout(400);
    ok(`${kind}: the leaderboard fills while the field plays`, await g(() => document.querySelectorAll('.board tr').length > 3));
    await g(() => { const game = window.scg.game, d = game.day; while (game.day === d) game.step(1 / 30); window.scg.ui.refresh(true); });
    await page.waitForTimeout(400);
    ok(`${kind}: the tournament report names a winner and the toughest hole`, await g(() => { const h = window.scg.game.calendar.history; const r = h[h.length - 1]; return !!r && r.top.length > 0 && /Last tournament/.test(document.getElementById('sidebody').textContent); }));

    // decisions in Goals
    await g(() => {
      const game = window.scg.game;
      game.decisions.open.push({ id: 999, kind: 'setup', title: 'How should the course play?', text: 'test', day: game.day + 1, until: game.day + 1, options: [{ id: 'forgiving', label: 'Forgiving setup', detail: 'x' }, { id: 'standard', label: 'Standard setup', detail: 'y' }], fallback: 'standard' });
      window.scg.ui.tab = 'journey'; window.scg.ui.refresh(true);
    });
    await page.waitForTimeout(300);
    await g(() => document.querySelector('[data-act="decide"][data-id="999"][data-opt="forgiving"]').click());
    ok(`${kind}: a decision is taken from Goals and applied`, (await g(() => window.scg.game.setup)) === 'forgiving');
    ok(`${kind}: Goals shows active goals`, await g(() => /Active goals/.test(document.getElementById('sidebody').textContent)));

    // new hole: exclusion rings, a refused tee, then Move tee / Move green
    await g(() => { const s = window.scg; s.ui.tab = 'build'; s.editor.setTool('build'); s.ui.refresh(true); });
    ok(`${kind}: placing a hole shows the rings to keep clear of`, (await g(() => (window.scg.editor.overlay.exclude || []).length)) > 0);
    const res = await g(async () => {
      const s = window.scg, h = s.game.world.holes[0];
      const { endpointProblem } = await import('/src/editing.ts');
      return endpointProblem(s.game.world, h.tee, 'tee');
    });
    ok(`${kind}: a tee on another hole is refused at once`, /runs into hole/.test(res || ''));
    await g(() => { const s = window.scg; s.editor.setTool('inspect'); s.ui.tab = 'none'; s.game.exitDesign(); s.ui.refresh(true); });

    // return summary dialog: focus moves in, background is inert, Escape closes
    await g(async () => {
      const { snapshotFor, returnSummary } = await import('/src/returns.ts');
      const game = window.scg.game, snap = snapshotFor(game);
      snap.day -= 2; snap.rounds -= 10;
      window.scg.ui.showReturn(returnSummary(game, snap, { days: 2, net: 500 }));
    });
    await page.waitForTimeout(300);
    ok(`${kind}: the return summary opens as a dialog`, await g(() => { const m = document.getElementById('modal'); return !m.hidden && /Welcome back/.test(m.textContent) && !!m.querySelector('[aria-modal="true"]'); }));
    ok(`${kind}: focus is inside the dialog and the rest is inert`, await g(() => document.getElementById('modal').contains(document.activeElement) && document.getElementById('top').inert === true));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok(`${kind}: Escape closes it and the page is usable again`, await g(() => document.getElementById('modal').hidden && document.getElementById('top').inert === false));
    ok(`${kind}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
};
