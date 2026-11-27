// A new player plays the opening par 4 by following the coach alone, with real taps on a phone and clicks on a desktop:
// orientation, aiming at the highlighted fairway (a wrong aim is caught), the two-tap swing, the approach with the club the
// distance needs, putting, then on into building. A reload mid-round keeps the tutorial going; Skip and Replay work.
module.exports = async ({ browser, base, freshCourse, touch, ok, coachText }) => {
  for (const kind of ['phone', 'desktop']) {
    console.log(` ${kind}`);
    const { page, ctx, errors } = await freshCourse(browser, base, kind);
    const t = kind === 'phone' ? await touch(page) : null;
    const tapAt = async (p) => { if (t) await t.tap(p); else { await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); } };
    const g = (fn, a) => page.evaluate(fn, a);
    const center = (sel) => g((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const world = (x, y) => g(([x, y]) => { const p = window.scg.renderer.toScreen(x, y); const b = document.getElementById('view').getBoundingClientRect(); return { x: p.x + b.left, y: p.y + b.top }; }, [x, y]);
    const ringed = () => g(() => document.querySelector('.coach-target')?.getAttribute('data-owner') || document.querySelector('.coach-target')?.getAttribute('data-club') || document.querySelector('.coach-target')?.getAttribute('data-tool') || null);
    await page.waitForTimeout(1200);
    const first = await coachText(page);
    ok(`${kind}: a new course starts on its opening par 4`, await g(() => { const h = window.scg.game.world.holes[0]; return !!window.scg.game.world.clubhouse && h && h.par === 4 && h.open; }));
    ok(`${kind}: the coach names the hole, its par and the goal`, /par 4/.test(first || '') && /as few shots/.test(first || ''), first);
    ok(`${kind}: Skip tutorial is offered`, !!(await center('#coach [data-coach="exit"]')));
    await tapAt(await center('#coach .coach-next'));
    const verb = kind === 'phone' ? 'Tap' : 'Click';
    ok(`${kind}: aiming is the first action, worded for the device`, new RegExp(`^${verb} the highlighted fairway`).test((await coachText(page)) || ''), await coachText(page));
    ok(`${kind}: the swing button waits for an aim`, await g(() => document.querySelector('#owner-hud [data-owner="hit"]')?.disabled === true));
    const info = await g(async () => {
      const { holePath } = await import('/src/terrain.ts');
      const h = window.scg.game.hole(1), path = holePath(h);
      const tot = path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
      const f = Math.min(23, tot * 0.64) / tot;
      return { zone: { x: path[0].x + (path[path.length - 1].x - path[0].x) * f, y: path[0].y + (path[path.length - 1].y - path[0].y) * f }, cup: { x: h.cup.x + 0.5, y: h.cup.y + 0.5 } };
    });
    await tapAt(await world(info.zone.x, info.zone.y));
    ok(`${kind}: a good aim moves the coach on to the swing, with the button highlighted`, /Start swing/.test((await coachText(page)) || '') && (await ringed()) === 'hit', await coachText(page));
    // a reload mid-round keeps the player in the tutorial
    await g(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload(); await page.waitForTimeout(3000);
    await g(() => { const m = document.getElementById('modal'); if (m && !m.hidden) window.scg.ui.closeModal(); });
    ok(`${kind}: after a reload the coach carries on`, !!(await coachText(page)), await coachText(page));
    // the reload ended the round: the coach starts it again from orientation
    if (await center('#coach .coach-next')) await tapAt(await center('#coach .coach-next'));
    if (/fairway/.test((await coachText(page)) || '')) await tapAt(await world(info.zone.x, info.zone.y));
    const swing = async () => {
      await tapAt(await center('#owner-hud [data-owner="hit"]'));
      await page.waitForTimeout(250);
      await tapAt(await center('#owner-hud [data-owner="hit"]'));
      for (let k = 0; k < 50 && (await g(() => !!window.scg.game.owner.flight)); k++) await page.waitForTimeout(150);
      await page.waitForTimeout(700);
    };
    await swing();
    const after = await coachText(page);
    ok(`${kind}: after the drive the coach says where it landed and which club to pick`, /yd from the pin/.test(after || '') && /Pick the (Iron|Wedge)/.test(after || ''), after);
    ok(`${kind}: the landing spot is marked on the map`, await g(() => !!window.scg.game.owner.landing));
    for (let turn = 0; turn < 10; turn++) {
      const text = (await coachText(page)) || '';
      if (/shots on a par/.test(text) || !(await g(() => window.scg.game.owner.active))) break;
      if (/Pick the/.test(text)) {
        const club = await g(() => window.scg.game.owner.suggestedClub(window.scg.game));
        for (let k = 0; k < 3 && (await g(() => window.scg.game.owner.club)) !== club; k++) { await tapAt(await center(`#owner-hud [data-club="${club}"]`)); await page.waitForTimeout(250); }
        ok(`${kind}: picking the club moves on to aiming at the green`, /the green to aim/.test((await coachText(page)) || ''), await coachText(page));
      }
      await tapAt(await world(info.cup.x, info.cup.y));
      await swing();
    }
    const done = (await coachText(page)) || '';
    ok(`${kind}: holing out completes the hole with the score against par`, /shots on a par 4/.test(done), done);
    const cash = await g(() => window.scg.game.cash);
    await tapAt(await center('#coach .coach-next'));
    await page.waitForTimeout(800);
    ok(`${kind}: finishing pays the first-round gift`, (await g(() => window.scg.game.cash)) === cash + 400);
    await g(() => { document.getElementById('goalpop')?.remove(); window.scg.game.cheers = []; window.scg.game.goalJustDone = null; });
    ok(`${kind}: then the coach moves on to building a second hole`, /second hole/.test((await coachText(page)) || '') && (await ringed()) === 'build', await coachText(page));
    // skip, then replay from the menu
    await g(() => window.scg.tutorial.exit());
    ok(`${kind}: Skip tutorial leaves the course as it is`, await g(() => window.scg.game.tutorial.done && window.scg.game.world.holes.length === 1));
    await g(() => window.scg.ui.openMenu());
    await tapAt(await center('#mdReplay'));
    await page.waitForTimeout(800);
    ok(`${kind}: Replay tutorial starts again on the opening hole`, /This is hole 1/.test((await coachText(page)) || ''), await coachText(page));
    ok(`${kind}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
};
