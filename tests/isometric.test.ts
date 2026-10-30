import { describe, it, expect } from 'vitest';
import { projectGround, unprojectGround } from '../src/isometric';
import { Renderer } from '../src/render';
import { createStartingWorld } from '../src/terrain';

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
    const r=camera(),w=createStartingWorld();r.focus(40,35,.7,w);
    const p=r.toScreen(40,35);
    expect(p.x).toBeCloseTo((r.insets.l+r.cw-r.insets.r)/2);
    expect(p.y).toBeCloseTo((r.insets.t+r.ch-r.insets.b)/2);
    const q=r.toWorld(p.x,p.y);expect(q.x).toBeCloseTo(40);expect(q.y).toBeCloseTo(35);
  });
  it('keeps the ground point beneath the cursor fixed while zooming', () => {
    const r=camera(),w=createStartingWorld();r.focus(40,35,.7,w);
    const point=r.toWorld(620,370);r.zoomAt(620,370,1.5,w);
    expect(r.cam.zoom).toBeCloseTo(1.05);
    const after=r.toWorld(620,370);expect(after.x).toBeCloseTo(point.x);expect(after.y).toBeCloseTo(point.y);
  });
  it('clamps the projected camera to the world and can fit the owned property', () => {
    const r=camera(),w=createStartingWorld();r.cam.x=-1e6;r.cam.y=1e6;r.clampCam(w);
    const center=r.toWorld(r.cw/2,r.ch/2);expect(center.x).toBeGreaterThanOrEqual(1.99);expect(center.y).toBeLessThan(w.h);
    r.fit(w);expect(r.cam.zoom).toBeGreaterThan(0);expect(Number.isFinite(r.cam.x)).toBe(true);
  });
});
