// Terrain stays drawn while the camera jumps around, even when the renderer may only build one chunk a frame (a slow device).
module.exports = async ({ browser, base, freshCourse, withClubhouse, ok }) => {
  const { page, ctx, errors } = await freshCourse(browser, base, 'phone');
  await withClubhouse(page);
  const r = await page.evaluate(async () => {
    const s = window.scg, r = s.renderer, w = s.game.world;
    r.frameBudget = 1;
    const canvas = document.getElementById('view');
    const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
    // dark = pixels near the sea-of-nothing colour the canvas shows before a chunk exists
    const dark = () => {
      const cw = canvas.width, ch = canvas.height, step = 8, ctx2 = canvas.getContext('2d');
      let bad = 0, n = 0;
      const img = ctx2.getImageData(0, 0, cw, ch).data;
      for (let y = 0; y < ch; y += step) for (let x = 0; x < cw; x += step) { const i = (y * cw + x) * 4; const l = img[i] + img[i + 1] + img[i + 2]; n++; if (img[i + 3] === 0 || l < 60) bad++; }
      return bad / n;
    };
    let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = 0, worstAt = '';
    for (let k = 0; k < 24; k++) {
      const x = 20 + rnd() * (w.w - 40), y = 20 + rnd() * (w.h - 40), z = [0.9, 1.2, 1.6][Math.floor(rnd() * 3)];
      r.focus(x, y, z, w, true);
      await raf(); await raf(); await raf();
      const f = dark(); if (f > worst) { worst = f; worstAt = `${x.toFixed(0)},${y.toFixed(0)} z${z}`; }
    }
    return { worst, worstAt, size: [canvas.width, canvas.height] };
  });
  console.log('  worst dark fraction', JSON.stringify(r));
  ok('no large dark patches after a camera jump on a slow renderer', r.worst < 0.1, JSON.stringify(r));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
};
