// Runs the browser suites against the dev server:  npm run e2e            (everything)
//                                                    npm run e2e -- panel   (only suites whose name matches)
const lib = require('./lib.cjs');
const SUITES = ['tutorial', 'building', 'panel', 'first-round', 'moments', 'terrain'];

(async () => {
  const want = process.argv.slice(2);
  const run = SUITES.filter((s) => !want.length || want.some((w) => s.includes(w)));
  const server = await lib.startServer();
  const browser = await lib.launch();
  let failed = 0, passed = 0;
  const failures = [];
  try {
    for (const name of run) {
      console.log(`\n== ${name}`);
      const t0 = Date.now();
      const rep = lib.reporter(name);
      try {
        await require(`./suites/${name}.cjs`)({ browser, base: server.base, ...lib, rep, ok: rep.ok });
      } catch (e) {
        rep.ok(`suite ran to the end (${e.message})`, false);
      }
      for (const r of rep.results) { if (r.pass) passed++; else { failed++; failures.push(`${name}: ${r.what}`); } }
      console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  } finally {
    await browser.close();
    server.stop();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  FAILED  ${f}`);
  process.exit(failed ? 1 : 0);
})();
