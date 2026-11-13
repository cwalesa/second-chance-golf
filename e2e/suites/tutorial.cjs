// A new player gets from the first screen to a built, open hole by following the coach, without Skip, on a phone and on a desktop.
module.exports = async ({ browser, base, freshCourse, touch, ok, coachText, clickSel, tileXY, suggestedHole, waitCamera }) => {
  for (const kind of ['phone', 'desktop']) {
    console.log(` ${kind}`);
    const { page, ctx, errors } = await freshCourse(browser, base, kind);
    const t = await touch(page);
    ok(`${kind}: the coach is on screen at the start`, !!(await coachText(page)), await coachText(page));
    ok(`${kind}: no Skip button on a required step`, !(await page.evaluate(() => [...document.querySelectorAll('#coach [data-coach="skip"]')].some((e) => e.getClientRects().length))));
    await clickSel(page, '#clubSuggest'); await page.waitForTimeout(500);
    await clickSel(page, '#clubOk'); await page.waitForTimeout(700);
    ok(`${kind}: the clubhouse is built through the coach`, await page.evaluate(() => !!window.scg.game.world.clubhouse));
    await page.waitForTimeout(1200); await waitCamera(page);
    // the coach asks for New hole in the tray first
    await clickSel(page, '[data-tool="build"]'); await page.waitForTimeout(900); await waitCamera(page);
    const s = await suggestedHole(page);
    await t.tap(await tileXY(page, s.tee.x, s.tee.y));
    await t.tap(await tileXY(page, s.cup.x, s.cup.y));
    await page.waitForTimeout(500);
    ok(`${kind}: tee and green are down`, await page.evaluate(() => !!window.scg.editor.proposal), await coachText(page));
    // a reload in the middle of a step keeps the player in the tutorial
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload(); await page.waitForTimeout(2500);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Collect'))?.click());
    await page.waitForTimeout(800);
    ok(`${kind}: after a reload the clubhouse is still there`, await page.evaluate(() => !!window.scg.game.world.clubhouse));
    ok(`${kind}: and the coach carries on`, !!(await coachText(page)), await coachText(page));
    ok(`${kind}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
};
