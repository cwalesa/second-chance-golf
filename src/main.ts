import './style.css';
import { CFG } from './config';
import { Game } from './game';
import { Renderer } from './render';
import { Editor } from './input';
import { UI } from './ui';
import { clearSave, loadGame, saveGame } from './save';

const canvas = document.getElementById('view') as HTMLCanvasElement;
let game = loadGame();
const resumed = !!game;
if (!game) game = new Game();
const renderer = new Renderer(canvas);
renderer.resize();
renderer.focus(35, 31, 0.78, game.world);
const editor = new Editor(canvas, game, renderer);
const ui = new UI(game, editor);
let resetting = false;

function persist() {
  if (resetting) return;
  if (saveGame(game!)) ui.markSaved();
}

ui.onReset = () => {
  resetting = true;
  clearSave();
  location.reload();
};
window.addEventListener('resize', () => {
  renderer.resize();
  renderer.clampCam(game!.world);
});
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
});
window.setInterval(persist, 6000);

if (resumed) game.notify('info', `Welcome back. Day ${game.day}, ${game.clockText}. Golfers who were out on the course have gone home.`);

editor.onChange = () => {};
const STEP = CFG.sim.dt;
let last = performance.now();
let acc = 0;
let uiClock = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const g = game!;
  const speed = g.settings.speed;
  acc += dt * speed;
  let steps = 0;
  while (acc >= STEP && steps < CFG.sim.maxStepsPerFrame) {
    g.step(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps >= CFG.sim.maxStepsPerFrame) acc = 0;
  renderer.render(g, editor.overlay, now / 1000);
  uiClock += dt;
  if (uiClock > 0.12) {
    uiClock = 0;
    ui.refresh();
  }
  requestAnimationFrame(frame);
}
ui.refresh(true);
requestAnimationFrame(frame);
(window as unknown as { scg: unknown }).scg = { game, renderer, editor };
