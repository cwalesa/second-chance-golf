// Runs the frame-time profiler over a set of conditions and prints one comparable table:  npm run perf:matrix [-- quick] [--kind phone] [--cpu 4]
const { execFileSync } = require('child_process');
const path = require('path');
const extra = process.argv.slice(2).filter((a) => a !== 'quick');
const quick = process.argv.includes('quick');
const secs = quick ? '8' : '15';
const S = (name, ...a) => ({ name, args: ['--secs', secs, ...a] });
const scenarios = [
  S('fresh 1 hole, running 1x', '--holes', '1', '--speed', '1'),
  S('9 holes, paused', '--holes', '9', '--paused'),
  S('9 holes, running 1x', '--holes', '9', '--speed', '1'),
  S('9 holes, running 8x', '--holes', '9', '--speed', '8'),
  S('9 holes, 1x, panning', '--holes', '9', '--speed', '1', '--mode', 'pan'),
  S('9 holes, 1x, zooming', '--holes', '9', '--speed', '1', '--mode', 'zoom'),
  S('9 holes, 1x, panels opening', '--holes', '9', '--speed', '1', '--mode', 'panel'),
  S('9 holes, 1x, painting terrain', '--holes', '9', '--speed', '1', '--mode', 'edit'),
  S('18 holes, running 1x', '--holes', '18', '--speed', '1'),
  S('18 holes, aged 12 days, 1x', '--holes', '18', '--speed', '1', '--age', quick ? '4' : '12'),
  S('18 holes, aged 12 days, 8x', '--holes', '18', '--speed', '8', '--age', quick ? '4' : '12'),
];
const only = process.env.ONLY ? scenarios.filter((s) => s.name.includes(process.env.ONLY)) : scenarios;
const rows = [];
for (const s of only) {
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(__dirname, 'perf.cjs'), ...s.args, ...extra], { encoding: 'utf8', maxBuffer: 1e8, timeout: 600000 }); } catch (e) { out = String(e.stdout || ''); }
  const at = out.indexOf('{\n "options"');
  if (at < 0) { rows.push({ name: s.name, err: 'no result' }); continue; }
  const j = JSON.parse(out.slice(at));
  const sec = j.sections;
  rows.push({ name: s.name, fps: j.fps, p50: j.frameGap.p50, p95: j.frameGap.p95, p99: j.frameGap.p99, max: j.frameGap.max, o33: j.over33, o50: j.over50, o100: j.over100, render: sec.render?.mean, renderP99: sec.render?.p99, renderMax: sec.render?.max, adv: sec.advance?.mean, advMax: sec.advance?.max, ui: sec['ui.refresh']?.max, long: j.longTasks.worst, golfers: j.growth.golfers ?? '', ser: j.serializeOnce.ms });
}
const cols = [['scenario', 'name', 30], ['fps', 'fps', 5], ['gap p50', 'p50', 7], ['p95', 'p95', 6], ['p99', 'p99', 6], ['max', 'max', 6], ['>33', 'o33', 5], ['>50', 'o50', 5], ['>100', 'o100', 5], ['render mean', 'render', 11], ['rnd p99', 'renderP99', 8], ['rnd max', 'renderMax', 8], ['adv mean', 'adv', 8], ['adv max', 'advMax', 8], ['ui max', 'ui', 7], ['longtask', 'long', 8], ['save ms', 'ser', 7]];
console.log(cols.map(([h, , w]) => h.padEnd(w)).join(' '));
for (const r of rows) console.log(cols.map(([, k, w]) => String(r[k] ?? r.err ?? '').padEnd(w)).join(' '));
