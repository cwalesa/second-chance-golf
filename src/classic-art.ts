import type { Pt } from './terrain';
import { projectGround } from './isometric';
import type { ToolId } from './editing';
import { makeTree } from './art/trees';
import type { Painter } from './art/buildings';
export type { Painter } from './art/buildings';
export { drawCountryClub, drawVillageAmenities, drawClubGround } from './art/buildings';

const polygon = (ctx: CanvasRenderingContext2D, points: Pt[], color: string, _stroke?: string) => {
  ctx.fillStyle = color; ctx.beginPath();points.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(28,26,46,0.9)';ctx.lineWidth=1.5;ctx.lineJoin='round';ctx.stroke();
};
function point(p: Painter,x:number,y:number,z=0):Pt { const a=p.toScreen(x,y);return{x:a.x,y:a.y-z*p.ts}; }

/** Upright tree sprite for variant `v` (see art/trees.ts for the list of species). */
export function makeClassicTree(v:number):HTMLCanvasElement{ return makeTree(v); }

export function paintToolTile(canvas:HTMLCanvasElement,id:ToolId){
  const c=canvas.getContext('2d')!;c.clearRect(0,0,canvas.width,canvas.height);
  const p:Painter={ctx:c,ts:18,toScreen:(x,y)=>{const a=projectGround(x*18,y*18);return{x:56+a.x,y:20+a.y};}};
  const color=id==='water'?'#5aa9c6':id==='bunker'?'#eddcaa':id==='green'||id==='cup'?'#a8dc7c':id==='fairway'?'#8fc66a':id==='path'?'#d0c5a8':id==='repair'?'#a3c284':'#74a35c';
  // one family of tiles: light from the upper left, so the left face is lit, the right face shaded, and a pale edge catches the light
  const shade=(hex:string,f:number)=>'#'+[1,3,5].map((i)=>Math.round(Math.min(255,parseInt(hex.slice(i,i+2),16)*f)).toString(16).padStart(2,'0')).join('');
  c.fillStyle='rgba(34,64,43,.22)';c.beginPath();c.ellipse(56,point(p,.95,.95,0).y+7,30,7,0,0,Math.PI*2);c.fill();
  const edge='#2f4a33';
  polygon(c,[point(p,0,1.9,.2),point(p,1.9,1.9,.2),point(p,1.9,1.9,0),point(p,0,1.9,0)],shade(color,.74),edge);
  polygon(c,[point(p,1.9,0,.2),point(p,1.9,1.9,.2),point(p,1.9,1.9,0),point(p,1.9,0,0)],shade(color,.56),edge);
  polygon(c,[point(p,0,0,.2),point(p,1.9,0,.2),point(p,1.9,1.9,.2),point(p,0,1.9,.2)],color,edge);
  c.strokeStyle='rgba(255,255,240,.7)';c.lineWidth=1.4;c.beginPath();c.moveTo(point(p,0,1.9,.2).x,point(p,0,1.9,.2).y);c.lineTo(point(p,0,0,.2).x,point(p,0,0,.2).y);c.lineTo(point(p,1.9,0,.2).x,point(p,1.9,0,.2).y);c.stroke();
  if(id==='treeAdd'||id==='treeDel'){const tree=makeClassicTree(id==='treeDel'?3:0);c.drawImage(tree,37,0,39,60);}
  if(id==='cup'||id==='build'||id==='tee'){const a=point(p,.9,.9,.2);c.strokeStyle='#f6efcf';c.lineWidth=2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(a.x,a.y-29);c.stroke();polygon(c,[{x:a.x,y:a.y-29},{x:a.x+17,y:a.y-24},{x:a.x,y:a.y-18}],'#cf845e');}
  if(id==='land'){c.strokeStyle='#ece6c5';c.setLineDash([3,2]);c.strokeRect(35,18,42,25);c.setLineDash([]);}
}
