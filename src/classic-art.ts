import type { Game } from './game';
import { hash2, Pt } from './terrain';
import { projectGround } from './isometric';
import type { ToolId } from './editing';
export interface Painter { ctx: CanvasRenderingContext2D; ts: number; toScreen(x: number,y: number): Pt; }
const polygon = (ctx: CanvasRenderingContext2D, points: Pt[], color: string, stroke?: string) => {
  ctx.fillStyle = color; ctx.beginPath();points.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}
};
function point(p: Painter,x:number,y:number,z=0):Pt { const a=p.toScreen(x,y);return{x:a.x,y:a.y-z*p.ts}; }
function wallWindow(p:Painter,x:number,y:number,z:number,axis:'x'|'y',width=.43,height=.61){
  const a=point(p,x,y,z),b=point(p,x+(axis==='x'?width:0),y+(axis==='y'?width:0),z),c=point(p,x+(axis==='x'?width:0),y+(axis==='y'?width:0),z+height),d=point(p,x,y,z+height);
  polygon(p.ctx,[a,b,c,d],'#273f3e','#e7dfb9');
  p.ctx.strokeStyle='#a3b5ad';p.ctx.lineWidth=Math.max(.5,p.ts*.025);p.ctx.beginPath();p.ctx.moveTo((a.x+b.x)/2,(a.y+b.y)/2);p.ctx.lineTo((c.x+d.x)/2,(c.y+d.y)/2);p.ctx.stroke();
}
function house(p:Painter,x:number,y:number,w:number,d:number,h:number,roofHeight:number,colors:{wall:string;side:string;roof:string;near:string},detail=true){
  const A=point(p,x,y),B=point(p,x+w,y),C=point(p,x+w,y+d),D=point(p,x,y+d);
  const a=point(p,x,y,h),b=point(p,x+w,y,h),c=point(p,x+w,y+d,h),dd=point(p,x,y+d,h);
  polygon(p.ctx,[{x:A.x+p.ts*.4,y:A.y+p.ts*.2},{x:B.x+p.ts*.8,y:B.y+p.ts*.2},{x:C.x+p.ts*.8,y:C.y+p.ts*.2},{x:D.x+p.ts*.4,y:D.y+p.ts*.2}],'#1d302d38');
  polygon(p.ctx,[B,C,c,b],colors.side,'#59614a');polygon(p.ctx,[C,D,dd,c],colors.wall,'#59614a');
  // Cream lintels, stone footings and deep window recesses catch the afternoon light.
  const floors=h>3.8?3:h>2.4?2:1;
  if(detail){
    for(let level=0;level<floors;level++){
      const z=.45+level*1.16;
      for(let k=.55;k<w-.4;k+=1.15)wallWindow(p,x+k,y+d+.01,z,'x');
      for(let k=.45;k<d-.3;k+=1.1)wallWindow(p,x+w+.01,y+k,z,'y');
    }
    polygon(p.ctx,[point(p,x,y+d,.05),point(p,x+w,y+d,.05),point(p,x+w,y+d,.22),point(p,x,y+d,.22)],'#a79b7a');
    if(w>4){
      const dx=x+w*.48;polygon(p.ctx,[point(p,dx,y+d+.03,.18),point(p,dx+.65,y+d+.03,.18),point(p,dx+.65,y+d+.03,1.2),point(p,dx,y+d+.03,1.2)],'#4c4c35','#d8c9a5');
    }
  }
  const e=.24,ra=point(p,x-e,y-e,h),rb=point(p,x+w+e,y-e,h),rc=point(p,x+w+e,y+d+e,h),rd=point(p,x-e,y+d+e,h);
  const ridgeA=point(p,x-e,y+d/2,h+roofHeight),ridgeB=point(p,x+w+e,y+d/2,h+roofHeight);
  polygon(p.ctx,[a,dd,ridgeA],colors.wall,'#bcb99b');polygon(p.ctx,[b,c,ridgeB],colors.side,'#9e9b80');
  polygon(p.ctx,[ra,rb,ridgeB,ridgeA],colors.roof,'#303e32');polygon(p.ctx,[ridgeA,ridgeB,rc,rd],colors.near,'#2a372d');
  if(detail){
    const ctx=p.ctx;ctx.strokeStyle='#b3b59b30';ctx.lineWidth=Math.max(.45,p.ts*.022);
    for(let k=.3;k<d/2;k+=.36){
      const z=h+roofHeight*(1-k/(d/2));const l=point(p,x-e,y+d/2+k,z),r=point(p,x+w+e,y+d/2+k,z);ctx.beginPath();ctx.moveTo(l.x,l.y);ctx.lineTo(r.x,r.y);ctx.stroke();
    }
    // Fine staggered slate seams follow the roof slope in world space.
    ctx.strokeStyle='#b3b59b25';ctx.lineWidth=Math.max(.4,p.ts*.018);
    for(let side=-1;side<=1;side+=2)for(let row=.15;row<d/2;row+=.34){
      const rowEnd=Math.min(d/2,row+.34),z1=h+roofHeight*(1-row/(d/2)),z2=h+roofHeight*(1-rowEnd/(d/2));
      for(let k=(Math.round(row/.34)%2)*.24;k<w;k+=.48){
        const a=point(p,x+k,y+d/2+side*row,z1),b=point(p,x+k,y+d/2+side*rowEnd,z2);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
    }
    // Brick chimney with a dark cap.
    const ch=point(p,x+w*.73,y+d*.44,h+roofHeight*.92);
    ctx.fillStyle='#957d63';ctx.fillRect(ch.x-p.ts*.1,ch.y-p.ts*.8,p.ts*.35,p.ts*.8);ctx.fillStyle='#4e5346';ctx.fillRect(ch.x-p.ts*.15,ch.y-p.ts*.84,p.ts*.44,p.ts*.12);
    if(h>2.4){
      const dormer=point(p,x+w*.38,y+d*.77,h+roofHeight*.5);ctx.fillStyle='#ded8b9';ctx.fillRect(dormer.x-p.ts*.3,dormer.y-p.ts*.5,p.ts*.6,p.ts*.6);ctx.fillStyle='#304344';ctx.fillRect(dormer.x-p.ts*.15,dormer.y-p.ts*.35,p.ts*.3,p.ts*.37);polygon(ctx,[{x:dormer.x-p.ts*.43,y:dormer.y-p.ts*.5},{x:dormer.x,y:dormer.y-p.ts*.92},{x:dormer.x+p.ts*.43,y:dormer.y-p.ts*.5}],'#494f3e');
    }
  }
}
function bench(p:Painter,x:number,y:number){
  const c=p.ctx,a=point(p,x,y,.4),b=point(p,x+1.2,y,.4);c.strokeStyle='#5b4b31';c.lineWidth=p.ts*.13;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
  c.lineWidth=p.ts*.05;for(const k of [.1,1.1]){const top=point(p,x+k,y,.48),foot=point(p,x+k,y,0);c.beginPath();c.moveTo(top.x,top.y);c.lineTo(foot.x,foot.y);c.stroke();}
}
export function drawCountryClub(p:Painter,g:Game,time:number){
  const ctx=p.ctx,l=g.clubLevel;
  const colors={wall:'#e9dfb7',side:'#b7b99b',roof:'#65705c',near:'#3c493e'};
  if(l>=1)house(p,3.2,40.9,2.2,4.6,1.45,1.1,colors);
  house(p,l?5:3.2,41,l?5:6.2,4.3,l>=2?3.1:1.65,l>=2?1.7:1.2,colors);
  if(l>=2){
    house(p,9.3,41.4,2.1,3.8,1.8,1.15,colors);
    house(p,5.5,42,1.7,1.6,3.9,.9,colors);
  }
  // A low veranda gives the clubhouse a recognisable little-town silhouette.
  const y=45.6,x=l?5.3:3.6,w=l?4.2:5.2;
  polygon(ctx,[point(p,x,y),point(p,x+w,y),point(p,x+w,y+.8),point(p,x,y+.8)],'#b9b197','#5d634c');
  for(let k=0;k<=w;k+=1){const a=point(p,x+k,y+.75),b=point(p,x+k,y+.75,.88);ctx.strokeStyle='#e3dcb8';ctx.lineWidth=p.ts*.08;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  polygon(ctx,[point(p,x-.15,y,1),point(p,x+w+.15,y,1),point(p,x+w+.15,y+.95,.87),point(p,x-.15,y+.95,.87)],'#78866b');
  const flag=point(p,10.2,46.2),wave=Math.sin(time*2.5)*p.ts*.06;
  ctx.strokeStyle='#e8ddbe';ctx.lineWidth=Math.max(1,p.ts*.04);ctx.beginPath();ctx.moveTo(flag.x,flag.y);ctx.lineTo(flag.x,flag.y-p.ts*2.7);ctx.stroke();
  polygon(ctx,[{x:flag.x,y:flag.y-p.ts*2.7},{x:flag.x+p.ts*.8,y:flag.y-p.ts*2.46+wave},{x:flag.x,y:flag.y-p.ts*2.2}],'#d8c16b');
  const sign=point(p,4.9,47.2,.7);ctx.fillStyle='#4c5b3f';ctx.strokeStyle='#d8cb9f';ctx.lineWidth=.8;ctx.beginPath();ctx.roundRect(sign.x-p.ts*1.6,sign.y-p.ts*.28,p.ts*3.2,p.ts*.53,2);ctx.fill();ctx.stroke();
  ctx.fillStyle='#efe4b8';ctx.font=`bold ${Math.max(6,p.ts*.18)}px Georgia`;ctx.textAlign='center';ctx.fillText(l>=2?'COUNTRY CLUB':'CLUBHOUSE',sign.x,sign.y+p.ts*.08);ctx.textAlign='left';
}
export function drawVillageAmenities(p:Painter,g:Game){
  const c=p.ctx,u=p.ts,colors={wall:'#d9cba7',side:'#9eac89',roof:'#6f8061',near:'#4c604a'};
  if(g.upgrades.snackBar)house(p,11.3,38.5,1.8,1.5,1.1,.7,{...colors,roof:'#bd9c71',near:'#8c795b'});
  if(g.upgrades.proShop)house(p,14.4,39.7,2.4,1.8,1.5,.9,colors);
  if(g.upgrades.crew)house(p,18.5,44.1,2.8,2.2,1.2,.7,{...colors,wall:'#9b9c79',side:'#727f5b'});
  if(g.upgrades.puttingGreen){const pts=Array.from({length:16},(_,i)=>point(p,17+Math.cos(i*Math.PI/8)*2,37.5+Math.sin(i*Math.PI/8)*1.2));polygon(c,pts,'#b2cc7f','#7b9b61');const a=point(p,17,37.5);c.fillStyle='#e9dfba';c.fillRect(a.x,a.y-u*.9,1,u*.9);}
  if(g.upgrades.range){
    polygon(c,[point(p,12,34),point(p,16,34),point(p,16,35.2),point(p,12,35.2)],'#a7b98b');
    for(let i=0;i<4;i++)polygon(c,[point(p,12+i,34),point(p,12.6+i,34),point(p,12.6+i,34.8),point(p,12+i,34.8)],'#49764e','#c2c799');
  }
  if(g.experience.site.terrace){
    polygon(c,[point(p,11.5,42),point(p,15.5,42),point(p,15.5,45),point(p,11.5,45)],'#ccc2a2','#9d9f7b');
    for(const [x,y] of [[12.5,43],[14.5,44]]){
      const a=point(p,x,y),top=point(p,x,y,1.25);c.strokeStyle='#7e7055';c.lineWidth=u*.05;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(top.x,top.y);c.stroke();
      const pts=Array.from({length:8},(_,k)=>({x:top.x+Math.cos(k*Math.PI/4)*u*.75,y:top.y+Math.sin(k*Math.PI/4)*u*.32}));polygon(c,pts,'#e6dbb6','#b7bd92');
    }
  }
  if(g.experience.site.garden){
    polygon(c,[point(p,8.5,37),point(p,11,37),point(p,11,38.3),point(p,8.5,38.3)],'#5c7045','#a1aa7f');
    for(let k=0;k<30;k++){const a=point(p,8.6+hash2(k,1,9)*2.2,37.1+hash2(k,2,9)*1.1,.2);c.fillStyle=k%3===0?'#ded6a1':k%3===1?'#be98b3':'#f1e3be';c.fillRect(a.x,a.y,Math.max(1,u*.09),Math.max(1,u*.1));}bench(p,8.8,38.8);
  }
  // Parked buggies have roofs and wheels, rather than flat map symbols.
  if(g.upgrades.carts)for(let k=0;k<3;k++){
    const x=12+k*1.8,y=47;
    polygon(c,[point(p,x,y,.2),point(p,x+1.1,y,.2),point(p,x+1.1,y+.65,.2),point(p,x,y+.65,.2)],'#d5d6bb','#5b6c56');
    polygon(c,[point(p,x-.1,y-.05,.9),point(p,x+1.2,y-.05,.9),point(p,x+1.2,y+.75,.9),point(p,x-.1,y+.75,.9)],'#ebdfb6','#9d9e7c');
    for(const dx of [.1,.9]){const a=point(p,x+dx,y+.7,.1);c.fillStyle='#3c493e';c.beginPath();c.ellipse(a.x,a.y,u*.1,u*.14,0,0,Math.PI*2);c.fill();}
  }
}
/** Textured upright tree sprites: many small leaf clusters instead of glossy spheres. */
export function makeClassicTree(v:number):HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=104;canvas.height=160;const c=canvas.getContext('2d')!;
  const rnd=(i:number,s=0)=>hash2(i,v,2000+s);
  const bark=v===7?'#746552':'#66563c';c.strokeStyle=bark;c.lineCap='round';c.lineWidth=v===2?5:7;c.beginPath();c.moveTo(51,153);c.bezierCurveTo(50,125,55,108,48,78);c.stroke();
  c.strokeStyle='#aa9570';c.lineWidth=1.7;c.beginPath();c.moveTo(49,150);c.lineTo(49,118);c.stroke();
  for(let k=0;k<7;k++){c.strokeStyle=bark;c.lineWidth=1.5+k%3;c.beginPath();c.moveTo(51,125-k*5);c.lineTo(20+rnd(k,1)*65,40+rnd(k,2)*55);c.stroke();}
  if(v===3)return canvas;
  const palette=v===7?[[180,137,162],[215,174,194],[137,113,137]]:v===4?[[123,134,71],[162,166,93],[85,103,54]]:v===2?[[44,91,57],[87,125,70],[33,72,48]]:v===1?[[53,94,60],[87,126,74],[40,74,48]]:[[66,113,62],[125,155,85],[44,83,48]];
  for(let k=0;k<2400;k++){
    let x:number,y:number,light:number;
    if(v===2){y=12+rnd(k,4)*120;const radius=(y-8)*.3*(.72+.28*Math.sin(y*.28));x=52+(rnd(k,5)*2-1)*radius;light=(1-x/104)*.6+(1-y/160)*.3;}
    else if(v===5){const a=rnd(k,4)*Math.PI*2,r=rnd(k,5)*46;x=52+Math.cos(a)*r;y=47+Math.sin(a)*r*.45+Math.pow(r/46,2)*15;light=(1-x/104)*.7;}
    else {
      const clusters=v===6?[[52,105,29,24]]:[[47,38,24,25],[29,63,23,28],[72,58,23,27],[51,85,32,27],[64,33,20,23]];
      const group=clusters[Math.floor(rnd(k,11)*clusters.length)],a=rnd(k,4)*Math.PI*2,r=Math.sqrt(rnd(k,5));
      x=group[0]+Math.cos(a)*r*group[2];y=group[1]+Math.sin(a)*r*group[3];
      if(rnd(k,6)>.97)continue;light=(1-x/104)*.52+(1-y/160)*.3;
    }
    const base=palette[light>.68?1:light<.4?2:0];const n=(rnd(k,7)-.5)*27;const color=`rgb(${Math.round(base[0]+n)},${Math.round(base[1]+n)},${Math.round(base[2]+n)})`;
    c.fillStyle=color;c.beginPath();c.ellipse(x,y,1.5+rnd(k,8)*2.3,1.1+rnd(k,9)*1.6,0,0,Math.PI*2);c.fill();
  }
  return canvas;
}
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
