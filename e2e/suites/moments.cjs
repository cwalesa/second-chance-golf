// The moment queue: one celebration at a time, never over an edit, a panel or the tutorial.
module.exports = async ({ browser, base, freshCourse, ok, withClubhouse, suggestedHole }) => {
  const { page, ctx, errors } = await freshCourse(browser, base, 'phone');
  await withClubhouse(page);
  const sug = await suggestedHole(page);
  await page.evaluate(async (sug) => {
    const { planNewHole } = await import('/src/editing.ts');
    const s = window.scg, g = s.game;
    g.commitEdit(planNewHole(g.world, g.nextHoleId(), sug.tee, sug.cup, { par: 3 }));
    g.openHole(1); s.editor.setTool('inspect'); g.exitDesign(); g.openForBusiness(); g.setSpeed(8); g.resume();
  }, sug);
  // sample the screen for a while: at most one of round card / goal pop-up / recap dialog is ever up, and none while editing or in a panel
  const sample = () => page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
    const s = window.scg;
    return { round: vis('roundcard'), goal: !!document.getElementById('goalpop'), modal: vis('modal'), tab: s.ui.tab, editing: !!s.editor.proposal || !!s.editor.isPlacement };
  });
  let prevUp = 0, prevEditing = false, overlap = 0, whileEditing = 0, inPanel = 0, seenAny = 0, n = 0;
  for (let i = 0; i < 70; i++) {
    if (i === 25) await page.evaluate(() => { const s = window.scg; s.ui.tab = 'money'; s.ui.refresh(true); });
    if (i === 40) await page.evaluate(() => { const s = window.scg; s.ui.tab = 'none'; s.ui.refresh(true); s.editor.setTool('build'); });
    if (i === 55) await page.evaluate(() => { const s = window.scg; s.editor.setTool('inspect'); s.game.exitDesign(); });
    const v = await sample(); n++;
    const up = [v.round, v.goal].filter(Boolean).length;
    if (up > 1) overlap++;
    if (up && !prevUp && v.editing && prevEditing) { whileEditing++; console.log('  at sample', i, JSON.stringify(v)); }
    if (up && !prevUp && v.tab !== 'none' && v.tab !== 'build') inPanel++;
    prevUp = up; prevEditing = v.editing;
    if (up || v.modal) seenAny++;
    await page.waitForTimeout(500);
  }
  ok('a round card and a goal pop-up are never on screen together', overlap === 0, `${overlap}/${n}`);
  ok('no celebration newly appears over an edit preview or placement', whileEditing === 0, String(whileEditing));
  ok('no celebration newly appears over an open panel', inPanel === 0, String(inPanel));
  ok('something did come up during the run', seenAny > 0, String(seenAny));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
};
