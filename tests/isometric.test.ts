import { describe, it, expect } from 'vitest';
import { projectGround, unprojectGround } from '../src/isometric';
import { Renderer } from '../src/render';
import { createTestCourse } from './fixtures/classic-course';

const camera = () => {
  // Projection and camera methods do not require a drawing surface.
  const r = Object.create(Renderer.prototype) as Renderer;
  r.cam = { x: 0, y: 0, zoom: .7 }; r.cw = 1440; r.ch = 960;
  r.insets = { l: 12, r: 350, t: 70, b: 115 };
  return r;
};
describe('isometric camera and picking', () => {
  it('projects both ground axes down the screen and reverses exact tile positions', () => {
    const a=projectGround(1,0),b=projectGround(0,1);
    expect(a.x).toBeGreaterThan(0);expect(b.x).toBeLessThan(0);expect(a.y).toBe(b.y);
    for(const [x,y] of [[0,0],[1,1],[-23,56],[120,80],[12.5,37.75]]){
      const p=projectGround(x,y),q=unprojectGround(p.x,p.y);
      expect(q.x).toBeCloseTo(x,10);expect(q.y).toBeCloseTo(y,10);
    }
  });
  it('centers a requested world point in the area left by the interface', () => {
    const r=camera(),w=createTestCourse();r.focus(100,70,.7,w,true);
    const p=r.toScreen(100,70);
    expect(p.x).toBeCloseTo((r.insets.l+r.cw-r.insets.r)/2);
    expect(p.y).toBeCloseTo((r.insets.t+r.ch-r.insets.b)/2);
    const q=r.toWorld(p.x,p.y);expect(q.x).toBeCloseTo(100);expect(q.y).toBeCloseTo(70);
  });
  it('keeps the ground point beneath the cursor fixed while zooming', () => {
    const r=camera(),w=createTestCourse();r.focus(40,35,.7,w,true);
    const point=r.toWorld(620,370);r.zoomAt(620,370,1.5,w);
    expect(r.cam.zoom).toBeCloseTo(1.05);
    const after=r.toWorld(620,370);expect(after.x).toBeCloseTo(point.x);expect(after.y).toBeCloseTo(point.y);
  });
  it('clamps the projected camera to the world and can fit the owned property', () => {
    const r=camera(),w=createTestCourse();r.cam.x=-1e6;r.cam.y=1e6;r.clampCam(w);
    const center=r.toWorld(r.cw/2,r.ch/2);expect(center.x).toBeGreaterThanOrEqual(1.99);expect(center.y).toBeLessThan(w.h);
    r.fit(w);expect(r.cam.zoom).toBeGreaterThan(0);expect(Number.isFinite(r.cam.x)).toBe(true);
  });
});

describe('camera motion', () => {
  it('eases toward a focus target and lands exactly on it, then stops', () => {
    const r = camera(), w = createTestCourse();
    r.focus(40, 35, .7, w, true);
    const start = { ...r.cam };
    r.focus(60, 40, .9, w);
    expect(r.cam).toEqual(start); // nothing jumps on the call itself
    const t0 = performance.now();
    r.stepCamera(t0 + 60);
    const mid = { ...r.cam };
    expect(mid.x).not.toBe(start.x);
    r.stepCamera(t0 + 2000);
    const p = r.toScreen(60, 40);
    expect(p.x).toBeCloseTo((r.insets.l + r.cw - r.insets.r) / 2, 3);
    expect(p.y).toBeCloseTo((r.insets.t + r.ch - r.insets.b) / 2, 3);
    expect(r.cam.zoom).toBeCloseTo(.9);
    const settled = { ...r.cam };
    r.stepCamera(t0 + 3000);
    expect(r.cam).toEqual(settled);
  });
  it('stops an automatic move the moment the player takes over', () => {
    const r = camera(), w = createTestCourse();
    r.focus(40, 35, .7, w, true);
    r.focus(70, 50, .7, w);
    r.stepCamera(performance.now() + 50);
    r.cancelCamera();
    const held = { ...r.cam };
    r.stepCamera(performance.now() + 5000);
    expect(r.cam).toEqual(held);
  });
  it('follows a golfer softly instead of snapping', () => {
    const r = camera(), w = createTestCourse();
    r.focus(40, 35, .7, w, true);
    const before = { ...r.cam };
    r.follow(60, 40, 1 / 60, w);
    const moved = Math.hypot(r.cam.x - before.x, r.cam.y - before.y);
    expect(moved).toBeGreaterThan(0);
    r.focus(60, 40, .7, w, true);
    const target = { ...r.cam };
    r.cam = { ...before };
    r.follow(60, 40, 1 / 60, w);
    expect(Math.hypot(r.cam.x - before.x, r.cam.y - before.y)).toBeLessThan(Math.hypot(target.x - before.x, target.y - before.y) * 0.2);
  });
  it('keeps the view on the map: the centre stays far enough from every edge that no screen corner shows much beyond it', () => {
    const r = camera(), w = createTestCourse();
    for (const [x, y] of [[0, 0], [w.w, 0], [0, w.h], [w.w, w.h], [-50, 300]]) {
      r.focus(x, y, .7, w, true);
      const c = r.toWorld(r.cw / 2, r.ch / 2);
      expect(c.x).toBeGreaterThan(2); expect(c.y).toBeGreaterThan(2);
      expect(c.x).toBeLessThan(w.w - 2); expect(c.y).toBeLessThan(w.h - 2);
      // the four screen corners land within a few tiles of the map
      for (const [sx, sy] of [[0, 0], [r.cw, 0], [0, r.ch], [r.cw, r.ch]]) {
        const q = r.toWorld(sx, sy);
        expect(q.x).toBeGreaterThan(-w.w * 0.2); expect(q.y).toBeGreaterThan(-w.h * 0.2);
        expect(q.x).toBeLessThan(w.w * 1.2); expect(q.y).toBeLessThan(w.h * 1.2);
      }
    }
  });
});
