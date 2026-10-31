import type { Pt } from './terrain';
import { projectGround } from './isometric';
import type { ToolId } from './editing';
import { makeTree } from './art/trees';
import type { Painter } from './art/buildings';
export type { Painter } from './art/buildings';
export { drawCountryClub, drawVillageAmenities, drawClubGround } from './art/buildings';

const polygon = (ctx: CanvasRenderingContext2D, points: Pt[], color: string, stroke?: string) => {
  ctx.fillStyle = color; ctx.beginPath();points.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}
};
function point(p: Painter,x:number,y:number,z=0):Pt { const a=p.toScreen(x,y);return{x:a.x,y:a.y-z*p.ts}; }

/** Upright tree sprite for variant `v` (see art/trees.ts for the list of species). */
export function makeClassicTree(v:number):HTMLCanvasElement{ return makeTree(v); }

export function paintToolTile(canvas:HTMLCanvasElement,id:ToolId){
  const c=canvas.getContext('2d')!;c.clearRect(0,0,canvas.width,canvas.height);
  const p:Painter={ctx:c,ts:18,toScreen:(x,y)=>{const a=projectGround(x*18,y*18);return{x:56+a.x,y:20+a.y};}};
  const color=id==='water'?'#6f9fa5':id==='bunker'?'#ddcf9c':id==='green'||id==='cup'?'#b8d480':id==='fairway'?'#97bd6e':id==='path'?'#c6be9f':id==='repair'?'#9bb47a':'#829b62';
  polygon(c,[point(p,0,0),point(p,1.9,0),point(p,1.9,1.9),point(p,0,1.9)],'#4b6744');
  polygon(c,[point(p,0,0,.2),point(p,1.9,0,.2),point(p,1.9,1.9,.2),point(p,0,1.9,.2)],color,'#536d48');
  if(id==='treeAdd'||id==='treeDel'){const tree=makeClassicTree(id==='treeDel'?3:0);c.drawImage(tree,37,0,39,60);}
  if(id==='cup'||id==='build'||id==='tee'){const a=point(p,.9,.9,.2);c.strokeStyle='#f6efcf';c.lineWidth=2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(a.x,a.y-29);c.stroke();polygon(c,[{x:a.x,y:a.y-29},{x:a.x+17,y:a.y-24},{x:a.x,y:a.y-18}],'#cf845e');}
  if(id==='land'){c.strokeStyle='#ece6c5';c.setLineDash([3,2]);c.strokeRect(35,18,42,25);c.setLineDash([]);}
}
