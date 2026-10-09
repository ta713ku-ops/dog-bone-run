// All ground marks stay inside the projected physical footprint, including strokes.
// Their colors and fixed silhouettes identify the three effects before contact.
const SHORE = [[-.98,-.05],[-.82,-.6],[-.5,-.87],[-.12,-.73],[.17,-.96],[.56,-.83],[.89,-.5],[.97,.12],[.76,.63],[.37,.85],[.04,.73],[-.36,.94],[-.77,.65]];
export function drawPuddle(r, lane, distance) {
  const c = r.ctx, {p,width,height} = r.obstacleFootprint(lane,distance);
  const rx = Math.max(.3,width/2-1.5), ry = Math.max(.3,height/2-1.5);
  const shape = scale => SHORE.map(([x,y])=>[p.x+rx*x*scale,p.y+ry*y*scale]);
  r.path(shape(1), '#8d8560');
  r.path(shape(.94), '#748a75');
  const water = c.createLinearGradient(p.x,p.y-ry,p.x,p.y+ry);
  water.addColorStop(0,'#a4d4d5'); water.addColorStop(.45,'#5dabbc'); water.addColorStop(1,'#387c9d');
  r.path(shape(.84),water);
  c.save();
  c.beginPath();shape(.84).forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();
  // Reflections are calm, stationary bands; no shimmer obscures the lane.
  c.beginPath();c.moveTo(p.x-rx*.72,p.y-ry*.26);c.bezierCurveTo(p.x-rx*.15,p.y-ry*.5,p.x+rx*.12,p.y-ry*.14,p.x+rx*.56,p.y-ry*.38);
  c.strokeStyle='#e3f4e8';c.lineWidth=Math.max(.7,p.scale*1.4);c.stroke();
  c.beginPath();c.ellipse(p.x+rx*.25,p.y+ry*.22,rx*.34,ry*.22,0,0,Math.PI*1.5);c.strokeStyle='#9fd1d5';c.lineWidth=Math.max(.7,p.scale);c.stroke();
  r.ellipse(p.x-rx*.42,p.y+ry*.18,rx*.17,ry*.1,'#c0e7e4');
  c.restore();
  for (const [x,y] of [[-.65,.48],[.5,-.6]]) r.ellipse(p.x+rx*x,p.y+ry*y,Math.max(.5,rx*.06),Math.max(.3,ry*.08),'#a9a080');
}

export function drawTrashBin(r,lane,distance) {
  const c=r.ctx,{p,width}=r.obstacleFootprint(lane,distance), scale=p.scale*r.width/390;
  const stroke=Math.max(.8,scale*1.3),w=Math.max(1,Math.min(48*scale,width-2*stroke));
  const h=Math.max(2,58*scale), top=p.y-h, base=p.y-3*scale;
  c.save();c.lineJoin='round';c.lineCap='round';
  r.ellipse(p.x,p.y,w*.46,Math.max(1,scale*3),'#65543624');
  for(const side of [-1,1]){
    const wx=p.x+side*w*.28;
    r.ellipse(wx,p.y-2.5*scale,Math.max(.5,2.4*scale),Math.max(.5,2.4*scale),'#343d39');
    r.ellipse(wx-.3*scale,p.y-2.7*scale,Math.max(.2,.75*scale),Math.max(.2,.75*scale),'#808578');
  }
  const front=c.createLinearGradient(p.x-w*.38,0,p.x+w*.3,0);
  front.addColorStop(0,'#91b789');front.addColorStop(.35,'#78a477');front.addColorStop(1,'#538161');
  r.path([[p.x-w*.42,top+h*.2],[p.x+w*.3,top+h*.22],[p.x+w*.26,base],[p.x-w*.32,base]],front,'#3c5d48',stroke);
  r.path([[p.x+w*.3,top+h*.22],[p.x+w*.43,top+h*.13],[p.x+w*.38,base-3*scale],[p.x+w*.26,base]],'#426c51','#3c5d48',stroke);
  for(const x of [-.23,-.07,.1]){
    c.beginPath();c.moveTo(p.x+w*x,top+h*.35);c.lineTo(p.x+w*x*.8,base-5*scale);
    c.strokeStyle='#a1bc90';c.lineWidth=Math.max(.7,scale*1.2);c.stroke();
  }
  // A distinct raised handle, hinged lid and side plane read at small sizes.
  r.path([[p.x-w*.48,top+h*.12],[p.x-w*.35,top+h*.04],[p.x+w*.43,top+h*.04],[p.x+w*.48,top+h*.12],[p.x+w*.31,top+h*.21],[p.x-w*.43,top+h*.19]],'#aac696','#3c5d48',stroke);
  r.path([[p.x-w*.43,top+h*.19],[p.x+w*.31,top+h*.21],[p.x+w*.31,top+h*.25],[p.x-w*.42,top+h*.23]],'#4c7854');
  c.beginPath();c.moveTo(p.x-w*.13,top+h*.09);c.lineTo(p.x-w*.12,top);c.lineTo(p.x+w*.12,top);c.lineTo(p.x+w*.13,top+h*.09);c.strokeStyle='#3c5d48';c.lineWidth=stroke;c.stroke();
  // Small pale enamel plate, rather than text that becomes illegible in preview.
  r.path([[p.x-w*.12,top+h*.43],[p.x+w*.11,top+h*.43],[p.x+w*.1,top+h*.56],[p.x-w*.11,top+h*.56]],'#dbe4be');
  c.restore();
}
