import type { Game } from './game';
import { Music } from './music';
export type Feedback = 'reward' | 'level' | 'build' | 'swing' | 'cup';
/** Synthesized UI/impact cues, unlocked by a gesture. No network or audio downloads. */
export class FeedbackPlayer {
  context: AudioContext | null = null;
  music: Music | null = null;
  constructor(private game: Game) {
    // iOS only allows audio to start inside a tap (touchend / click), so try on each of those.
    const unlock = () => {
      if (!game.preferences.sound && !game.preferences.music) return;
      try {
        this.context ??= new AudioContext();
        if (this.context.state === 'suspended' && !document.hidden) void this.context.resume();
        this.sync();
      } catch { /* Audio is optional. */ }
    };
    for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, { passive: true });
    // the app in the background is silent
    document.addEventListener('visibilitychange', () => {
      if (!this.context) return;
      if (document.hidden) void this.context.suspend();
      else void this.context.resume();
    });
    // follow the Music setting
    window.setInterval(() => this.sync(), 500);
    game.onFeedback = type => this.play(type);
  }
  private sync() {
    const c = this.context;
    if (!c || c.state !== 'running') return;
    this.music ??= new Music(c);
    if (this.game.preferences.music && !this.music.playing) this.music.start();
    else if (!this.game.preferences.music && this.music.playing) this.music.stop();
  }
  play(type: Feedback) {
    const game = this.game;
    if (game.preferences.haptics && typeof navigator.vibrate === 'function') navigator.vibrate(type === 'level' ? [20, 30, 20] : 10);
    if (!game.preferences.sound || !this.context || this.context.state !== 'running') return;
    const c = this.context, notes = type === 'level' ? [392, 494, 587, 784] : type === 'reward' ? [523, 659, 784] : type === 'cup' ? [784, 1046] : type === 'build' ? [330, 440] : [180];
    notes.forEach((hz, i) => {
      const start = c.currentTime + i * .075, osc = c.createOscillator(), gain = c.createGain();
      osc.type = type === 'swing' ? 'triangle' : 'sine'; osc.frequency.setValueAtTime(hz, start);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.035, start + .008); gain.gain.exponentialRampToValueAtTime(.0001, start + .16);
      osc.connect(gain); gain.connect(c.destination); osc.start(start); osc.stop(start + .17);
    });
  }
}
