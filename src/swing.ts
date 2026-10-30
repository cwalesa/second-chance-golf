/** Real-time swing timing, separate from the management simulation clock. */
export class SwingMeter {
  active = false;
  elapsed = 0;
  start() { this.active = true; this.elapsed = 0; }
  update(dt: number) { if (this.active) this.elapsed += Math.max(0, dt); }
  get offset() { return -Math.cos(this.elapsed * Math.PI / .8); }
  get quality() { return Math.max(0, 1 - Math.abs(this.offset)); }
  strike(): number { const offset = this.offset; this.active = false; return offset; }
  cancel() { this.active = false; }
}
