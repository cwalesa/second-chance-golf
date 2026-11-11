/**
 * Background music, generated live with Web Audio: no audio files to download or license.
 *
 * A gentle, sunny loop for a day on the course: soft pad chords, a light bass and a plucked
 * melody that wanders over a major pentatonic scale, through a little echo. Each pass through
 * the chord cycle is slightly different, so it does not grate after an hour of building.
 *
 * iOS only lets audio start after a tap, so the player is started from the first touch, and it
 * pauses while the app is in the background.
 */
const BPM = 84;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Two progressions in C major that alternate: I vi IV V, then I iii IV V. Roots as MIDI notes. */
const PROGS = [
  [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]],
  [[48, 52, 55, 59], [40, 43, 47, 50], [41, 45, 48, 52], [43, 47, 50, 55]],
];
/** C major pentatonic across two octaves, for the melody. */
const SCALE = [72, 74, 76, 79, 81, 84, 86, 88];

export class Music {
  private master: GainNode | null = null;
  private echo: DelayNode | null = null;
  private timer: number | null = null;
  private nextBar = 0;
  private bar = 0;
  private melodyAt = 3; // index into SCALE: the melody walks from here
  private seed = 7;

  constructor(private ctx: AudioContext) {}

  get playing() { return this.timer !== null; }

  start() {
    if (this.timer !== null) return;
    const c = this.ctx;
    if (!this.master) {
      this.master = c.createGain();
      this.master.gain.value = 0;
      const lowpass = c.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 5200;
      this.master.connect(lowpass);
      lowpass.connect(c.destination);
      // a soft echo gives the plucks some air
      this.echo = c.createDelay(1);
      this.echo.delayTime.value = BEAT * 0.75;
      const fb = c.createGain();
      fb.gain.value = 0.28;
      const wet = c.createGain();
      wet.gain.value = 0.35;
      this.echo.connect(fb);
      fb.connect(this.echo);
      this.echo.connect(wet);
      wet.connect(this.master);
    }
    const now = c.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.55, now + 2.5); // fade in
    this.nextBar = now + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  stop() {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.master?.gain.cancelScheduledValues(now);
    this.master?.gain.setValueAtTime(this.master.gain.value, now);
    this.master?.gain.linearRampToValueAtTime(0, now + 0.6);
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed % 10000) / 10000;
  }

  /** Keep about one bar of music queued ahead of the clock. */
  private schedule() {
    const c = this.ctx;
    while (this.nextBar < c.currentTime + BAR) {
      this.playBar(this.nextBar);
      this.nextBar += BAR;
      this.bar++;
    }
  }

  private playBar(t: number) {
    const prog = PROGS[Math.floor(this.bar / 4) % 2];
    const chord = prog[this.bar % 4];
    // pad: the chord, held for the bar
    for (const n of chord.slice(1)) this.pad(midi(n + 12), t, BAR);
    // bass: root on beats one and three
    this.bass(midi(chord[0] - 12), t, BEAT * 1.6);
    this.bass(midi(chord[0] - 12 + (this.bar % 2 ? 7 : 0)), t + BEAT * 2, BEAT * 1.6);
    // melody: eighth notes with rests, stepping mostly by one scale degree; quieter every fourth bar
    const busy = this.bar % 4 === 3 ? 0.3 : 0.62;
    for (let i = 0; i < 8; i++) {
      if (this.rand() > busy) continue;
      const step = this.rand() < 0.7 ? (this.rand() < 0.5 ? -1 : 1) : this.rand() < 0.5 ? -2 : 2;
      this.melodyAt = Math.max(0, Math.min(SCALE.length - 1, this.melodyAt + step));
      // lean towards chord tones on the beat
      let n = SCALE[this.melodyAt];
      if (i % 2 === 0 && !chord.some((cn) => (n - cn) % 12 === 0)) n = SCALE[Math.max(0, this.melodyAt - 1)];
      this.pluck(midi(n), t + i * (BEAT / 2), i % 2 ? 0.05 : 0.07);
    }
    // a few birds now and then, quietly
    if (this.rand() < 0.18) this.bird(t + this.rand() * BAR);
  }

  private pad(hz: number, t: number, len: number) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + 0.9);
    g.gain.linearRampToValueAtTime(0.018, t + len - 0.4);
    g.gain.linearRampToValueAtTime(0, t + len + 0.6);
    g.connect(this.master!);
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + len + 0.7);
    }
  }

  private bass(hz: number, t: number, len: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private pluck(hz: number, t: number, vol: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = hz;
    o2.frequency.value = hz * 2;
    const g2 = c.createGain();
    g2.gain.value = 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(this.master!);
    g.connect(this.echo!);
    o.start(t);
    o2.start(t);
    o.stop(t + 1);
    o2.stop(t + 1);
  }

  private bird(t: number) {
    const c = this.ctx;
    for (let k = 0; k < 2; k++) {
      const s = t + k * 0.16;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(2600 + this.rand() * 600, s);
      o.frequency.exponentialRampToValueAtTime(3600 + this.rand() * 500, s + 0.08);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.12);
      o.connect(g);
      g.connect(this.master!);
      o.start(s);
      o.stop(s + 0.14);
    }
  }
}
