import type { Pt } from './terrain';
export const ISO_X = Math.sqrt(3) / 2;
export const ISO_Y = .5;
/** Ground coordinates to projected coordinates; vertical objects remain upright. */
export function projectGround(x: number, y: number): Pt { return { x: (x - y) * ISO_X, y: (x + y) * ISO_Y }; }
export function unprojectGround(x: number, y: number): Pt { return { x: (x / ISO_X + y / ISO_Y) / 2, y: (y / ISO_Y - x / ISO_X) / 2 }; }
