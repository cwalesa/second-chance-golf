import './style.css';
import { CFG } from './config';
import { Game } from './game';
import { Renderer } from './render';
import { Editor } from './input';
import { UI } from './ui';
import { clearSave, loadGame, saveGame } from './save';
import { startScreen } from './start';

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const loaded = loadGame();
  let game: Game;
  let away: { days: number; net: number } | null = null;
  if (loaded) {
    game = loaded.game;
    away = game.applyAway((Date.now() - loaded.savedAt) / 1000);
  } else {
    const opts = await startScreen();
    game = new Game(undefined, Math.floor(Math.random() * 1e9), opts);
  }
  game.applyRegion();

  const renderer = new Renderer(canvas);
  renderer.resize();
  const editor = new Editor(canvas, game, renderer);
  const ui = new UI(game, editor);
  let resetting = false;
  const persist = () => {
    if (resetting) return;
    if (saveGame(game)) ui.markSaved();
  };
  ui.onReset = () => {
    resetting = true;
    clearSave();
    location.reload();
  };
  ui.onSaveNow = persist;
  const place = () => {
    renderer.resize();
    renderer.insets = ui.insets();
    renderer.clampCam(game.world);
  };
  ui.onInsets = place;
  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', () => setTimeout(place, 200));
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persist();
  });
  window.setInterval(persist, 6000);

  ui.refresh(true);
  renderer.resize();
  renderer.insets = ui.insets();
  const h1 = game.world.holes[0];
  renderer.focus(h1 ? Math.min(h1.cup.x + 6, 44) : 40, h1 ? h1.tee.y : 34, ui.mobile ? 0.55 : 0.7, game.world);

  if (away) {
    ui.toast(`While you were away (${away.days} day${away.days === 1 ? '' : 's'}) your course earned ${away.net >= 0 ? '+' : ''}$${Math.round(away.net).toLocaleString('en-US')}.`, away.net >= 0 ? 'good' : 'bad');
  } else if (loaded) game.notify('info', `Welcome back. Day ${game.day}, ${game.clockText}.`);

  const STEP = CFG.sim.dt;
  let last = performance.now();
  let acc = 0;
  let uiClock = 0;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const speed = game.settings.speed;
    acc += dt * speed;
    let steps = 0;
    while (acc >= STEP && steps < CFG.sim.maxStepsPerFrame) {
      game.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps >= CFG.sim.maxStepsPerFrame) acc = 0;
    // render between the last two simulation steps so motion is smooth at any refresh rate
    renderer.render(game, editor.overlay, now / 1000, speed === 0 ? 1 : Math.min(1, acc / STEP));
    uiClock += dt;
    if (uiClock > 0.12) {
      uiClock = 0;
      ui.refresh();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  (window as unknown as { scg: unknown }).scg = { game, renderer, editor, ui };

  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot();
