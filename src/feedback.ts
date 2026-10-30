import type { Game } from './game';
export type Feedback = 'reward' | 'level' | 'build' | 'swing' | 'cup';
/** Synthesized UI/impact cues, unlocked by a gesture. No network or audio downloads. */
export class FeedbackPlayer {
  private context: AudioContext | null = null;
  constructor(private game: Game) {
    const unlock = () => {
      if (!game.preferences.sound) return;
      try { this.context ??= new AudioContext(); if (this.context.state === 'suspended') void this.context.resume(); } catch { /* Audio is optional. */ }
    };
    document.addEventListener('pointerdown', unlock);
    game.onFeedback = type => this.play(type);
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
