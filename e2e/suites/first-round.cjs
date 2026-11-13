// The first paying round raises one result card, held back behind panels and edits, never repeated, and survives a reload.
module.exports = async ({ browser, base, freshCourse, ok, withClubhouse, suggestedHole }) => {
  const { page, ctx, errors } = await freshCourse(browser, base, 'phone');
  await withClubhouse(page);
  const sug = await suggestedHole(page);
  await page.evaluate(async (sug) => {
    const { planNewHole } = await import('/src/editing.ts');
    const s = window.scg, g = s.game;
    g.commitEdit(planNewHole(g.world, g.nextHoleId(), sug.tee, sug.cup, { par: 3 }));
    g.openHole(1); s.editor.setTool('inspect'); g.exitDesign(); g.openForBusiness();
    s.ui.tab = 'money'; s.ui.refresh(true); g.setSpeed(8); g.resume();
  }, sug);
  const card = () => page.evaluate(() => { const c = document.getElementById('roundcard'); return c && !c.hidden ? c.innerText.replace(/\n/g, ' | ') : null; });
  let waited = 0;
  while (!(await page.evaluate(() => window.scg.game.firstRound.done)) && waited < 240) { await page.waitForTimeout(2000); waited += 2; }
  const fr = await page.evaluate(() => JSON.parse(JSON.stringify(window.scg.game.firstRound)));
  ok('the first paying round is recorded', fr.done && !!fr.result, `after ${waited}s`);
  ok('it waits while a panel is open', (await card()) === null && fr.shown === false);
  await page.evaluate(() => { const s = window.scg; s.ui.tab = 'none'; s.ui.refresh(true); s.editor.setTool('build'); });
  await page.waitForTimeout(1200);
  ok('and while an edit is in progress', (await card()) === null);
  await page.evaluate(() => { const s = window.scg; s.editor.setTool('inspect'); s.game.exitDesign(); s.game.resume(); s.game.setSpeed(1); });
  let text = null;
  for (let i = 0; i < 14 && !text; i++) {
    await page.evaluate(() => { const p = document.getElementById('goalpop'); (p?.querySelector('[data-gp="collect"], .gp-go') || p)?.click(); const m = document.getElementById('modal'); if (m && !m.hidden) (m.querySelector('button.primary') ?? [...m.querySelectorAll('button')].find((b) => /Continue|Close|Collect|OK|Done/i.test(b.textContent)))?.click(); });
    await page.waitForTimeout(800); text = await card();
  }
  ok('the card appears once nothing else needs attention', !!text);
  ok('it names the golfer, score, fee and a next step', !!text && text.includes(fr.result.name) && /par/i.test(text) && /already collected/.test(text) && text.includes('$' + fr.result.fee) && /Build your second hole/.test(text), text);
  await page.waitForTimeout(2200);
  ok('it is recorded as shown once seen', await page.evaluate(() => window.scg.game.firstRound.shown));
  await page.evaluate(() => document.querySelector('[data-rc="x"]')?.click()); await page.waitForTimeout(500);
  ok('dismissing hides it and play continues', (await card()) === null && !(await page.evaluate(() => window.scg.game.settings.paused)));
  const rounds = await page.evaluate(() => window.scg.game.stats.rounds);
  await page.evaluate(() => window.scg.game.setSpeed(8));
  let seen = 0;
  for (let i = 0; i < 150 && (i < 14 || (await page.evaluate(() => window.scg.game.stats.rounds)) <= rounds); i++) { await page.waitForTimeout(1000); if (await card()) seen++; await page.evaluate(() => { const p = document.getElementById('goalpop'); (p?.querySelector('[data-gp="collect"], .gp-go') || p)?.click(); const m = document.getElementById('modal'); if (m && !m.hidden) (m.querySelector('button.primary') ?? [...m.querySelectorAll('button')].find((b) => /Continue|Close|Collect|OK|Done/i.test(b.textContent)))?.click(); }); }
  console.log('  state', JSON.stringify(await page.evaluate(() => ({ paused: window.scg.game.settings.paused, speed: window.scg.game.settings.speed, modal: !document.getElementById('modal').hidden, pop: !!document.getElementById('goalpop'), open: window.scg.game.openHoles.length, golfers: window.scg.game.golfers?.length }))));
  ok('later rounds never raise a second card', seen === 0 && (await page.evaluate(() => window.scg.game.stats.rounds)) > rounds, `cards ${seen}, rounds ${rounds} -> ${await page.evaluate(() => window.scg.game.stats.rounds)}`);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload(); await page.waitForTimeout(2500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Collect'))?.click());
  await page.waitForTimeout(1500);
  ok('after a reload the card does not come back', (await card()) === null && (await page.evaluate(() => window.scg.game.firstRound.shown && window.scg.game.firstRound.done)));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
};
