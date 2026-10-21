import { projectStreet } from './street-camera.js';
import { drawParkProp } from './park-level2-art.js';

const NEAR = -.82, FAR = 60, EDGE = 1.56;
const mod = (n, m) => ((n % m) + m) % m;
const hash = n => mod(Math.sin(n * 127.1 + 311.7) * 43758.5453, 1);

// All dimensions are world units, including the height of equipment. These
// objects use the same camera and travelled distance as the dog and pickups.
export const PARK_WORLD = Object.freeze([
  ...Array.from({ length: 7 }, (_, i) => ({ id: `play-${i}`, kind: 'playground', at: 5.5 + i * 12,
    lane: (i % 2 ? 1 : -1) * 5.2, width: 5.3, depth: 4.5, height: 3.8 })),
  ...Array.from({ length: 7 }, (_, i) => ({ id: `swing-${i}`, kind: 'swings', at: 8 + i * 12,
    lane: (i % 2 ? -1 : 1) * 5.0, width: 4.9, depth: 3.3, height: 3.0 })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `shelter-${i}`, kind: 'pergola', at: 15 + i * 20,
    lane: (i % 2 ? 1 : -1) * 5.4, width: 4.4, depth: 3.6, height: 3.3 })),
  ...Array.from({ length: 15 }, (_, i) => ({ id: `bench-${i}`, kind: 'bench', at: 2.5 + i * 5.5,
    lane: (i % 2 ? 1 : -1) * 3.1, width: 1.9, depth: .65, height: 1.15 })),
  ...Array.from({ length: 18 }, (_, i) => ({ id: `garden-${i}`, kind: 'garden', at: 1 + i * 4.5,
    lane: (i % 2 ? -1 : 1) * 2.75, width: 1.8, depth: 1.6, height: .6 })),
  ...Array.from({ length: 36 }, (_, i) => ({ id: `tree-${i}`, kind: 'tree', at: .6 + i * 3.5 - (i%2 ? 1.3 : 0),
    lane: (i % 2 ? 1 : -1) * (6.2 + hash(i) * .3), width: 9.1, depth: .5, height: 11.56 })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `lamp-${i}`, kind: 'lamp', at: 4 + i * 10,
    lane: (i % 2 ? -1 : 1) * 2.55, width: .46, depth: .42, height: 3.1 })),
].map(Object.freeze));

export function parkPoint(renderer, lane, distance, elevation = 0) {
  return projectStreet(renderer.width, renderer.height, lane, distance, elevation, 0);
}

function poly(r, vertices, fill, stroke = null, width = .6) {
  const p = vertices.map(v => parkPoint(r, ...v));
  r.path(p.map(v => [v.x, v.y]), fill, stroke, width);
  return p;
}

function line(r, a, b, color, width = 1) {
  const p = parkPoint(r, ...a), q = parkPoint(r, ...b), c = r.ctx;
  c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y);
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.stroke();
}

function box(r, x, z, w, d, base, top, colors = ['#bc9162', '#8f6947', '#d6b88b']) {
  const a = x - w / 2, b = x + w / 2, n = z - d / 2, f = z + d / 2;
  poly(r, [[a,n,base],[b,n,base],[b,n,top],[a,n,top]], colors[0], '#533f3033');
  poly(r, [[x < 0 ? b : a,n,base],[x < 0 ? b : a,f,base],
    [x < 0 ? b : a,f,top],[x < 0 ? b : a,n,top]], colors[1], '#533f3029');
  poly(r, [[a,n,top],[b,n,top],[b,f,top],[a,f,top]], colors[2], '#72563c44');
  const scale=parkPoint(r,x,z).scale;
  if(w*r.width*.235*scale>9 && w>.4) {
    // Grain follows each timber face in world coordinates, so it cannot swim
    // across the planks when the camera approaches.
    for(let k=1;k<4;k++) {
      const e=base+(top-base)*k/4;
      line(r,[a+w*.04,n-.002,e],[b-w*.06,n-.002,e],k%2?'#634b3526':'#f5ddae47',.45);
    }
    for(let k=1;k<3;k++) line(r,[a+w*.03,n+d*k/3,top+.002],
      [b-w*.03,n+d*k/3,top+.002],'#7d603426',.45);
  }
}

function beam(r, a, b, color, size = .07) {
  const p = parkPoint(r, ...a), q = parkPoint(r, ...b);
  const width = Math.max(.55, r.width * .235 * ((p.scale + q.scale) / 2) * size);
  line(r, a, b, '#644e3c', width + Math.max(.3, width * .15));
  line(r, a, b, color, width);
  if (width > 1.5) line(r, [a[0] - .012,a[1] - .005,a[2]],
    [b[0] - .012,b[1] - .005,b[2]], '#ead3a27a', width * .23);
}

function disk(r, x, z, rx, rz, fill, height = 0, stroke = null, count = 28) {
  return poly(r, Array.from({ length: count }, (_, i) => {
    const a = i / count * Math.PI * 2;
    return [x + Math.cos(a) * rx, z + Math.sin(a) * rz, height];
  }), fill, stroke, .75);
}

function sky(r) {
  const { ctx: c, width: w, height: h } = r;
  const g = c.createLinearGradient(0, 0, 0, h * .38);
  g.addColorStop(0, '#a8ccdb'); g.addColorStop(.7, '#dce9e1'); g.addColorStop(1, '#eff0d9');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Clouds and the horizon are stable: forward flow comes from world objects.
  for (const [x,y,size] of [[.18,.11,.11],[.67,.08,.13],[.89,.20,.08]]) {
    r.ellipse(w*x,h*y,w*size,w*size*.12,'#fffbeb65');
    r.ellipse(w*(x-.025),h*y-w*.008,w*size*.44,w*size*.12,'#fffced65');
  }
  const lawn = c.createLinearGradient(0,h*.28,0,h);
  lawn.addColorStop(0,'#afbd8d'); lawn.addColorStop(.4,'#8da36d'); lawn.addColorStop(1,'#718c55');
  c.fillStyle = lawn; c.fillRect(0,h*.28,w,h*.72);
}

export function drawParkGround(r, art, travel) {
  // Each short patch has a fixed world ID. Its texture and all four corners
  // advance with exactly the same projection as the surrounding equipment.
  const step = .45, first = Math.floor((travel + NEAR) / step), last = Math.ceil((travel + FAR) / step);
  const pathGradient = r.ctx.createLinearGradient(0,r.height*.28,0,r.height);
  pathGradient.addColorStop(0,'#d5c6a2'); pathGradient.addColorStop(.5,'#d9c49b'); pathGradient.addColorStop(1,'#e4cda3');
  poly(r,[[-EDGE,NEAR,0],[EDGE,NEAR,0],[EDGE,FAR,0],[-EDGE,FAR,0]],pathGradient);
  for(const side of [-1,1]) poly(r,[[side*EDGE,NEAR,0],[side*(EDGE+.11),NEAR,0],
    [side*(EDGE+.11),FAR,0],[side*EDGE,FAR,0]],'#c8bea0');
  const gpuGround = art.drawGroundGPU?.(r, travel) === true;
  for (let i = last; i >= first; i--) {
    const a = Math.max(NEAR, i * step - travel), b = Math.min(FAR, (i+1) * step - travel);
    if (b <= a) continue;
    if(a>16)continue; // subpixel distant grain stays quiet instead of aliasing
    if (!gpuGround) art.drawProjectedGround?.(r, -EDGE, EDGE, a, b, travel, 'path', .30);
    for (const side of [-1,1]) {
      if(!gpuGround && a<10)art.drawProjectedGround?.(r, side < 0 ? -14 : EDGE+.1, side < 0 ? -EDGE-.1 : 14,
        a,b,travel,'grass',.22);
      const inner = side * EDGE, outer = side * (EDGE + .11);
      const tone = i % 3 ? '#c8bea0' : '#d0c5a7';
      poly(r,[[inner,a,0],[outer,a,0],[outer,b,0],[inner,b,0]],tone);
      // Individual low edge stones move with the ground; no central grid.
      if (a < 8) line(r,[inner,a,.012],[outer,a,.012],'#8c8c704d',.5);
    }
  }
  // Small, low-contrast mineral grains are world-anchored as well.
  for (let i = Math.floor((travel+NEAR)*7); i < (travel+18)*7; i++) {
    const z = i / 7 - travel;
    if (z < NEAR) continue;
    const x = (hash(i+100)-.5)*2.9, p = parkPoint(r,x,z);
    r.ellipse(p.x,p.y,Math.max(.25,p.scale*.8),Math.max(.15,p.scale*.22),
      i%3 ? '#806a4930' : '#fff2d438');
  }
}

function branchPaths(r, travel) {
  for (const at of [4,12,20,28,36,44,52,60,68,76,84]) {
    const d = at-travel;
    if (d < NEAR-.9 || d > FAR) continue;
    for (const side of [at % 16 === 4 ? -1 : 1]) {
      const a = Math.max(NEAR,d-.36), b = Math.max(NEAR,d+.36);
      poly(r,[[side*1.67,a,0],[side*12,a,0],[side*12,b,0],[side*1.67,b,0]],'#ccb994');
      line(r,[side*1.67,a,.01],[side*12,a,.01],'#a6a08088',.7);
      line(r,[side*1.67,b,.01],[side*12,b,.01],'#eee0b880',.7);
    }
  }
}

function leafShadows(r, travel) {
  for(let i=Math.floor((travel-2)/4);i<(travel+12)/4;i++) {
    const center=i*4+1-travel;
    for(let k=0;k<12;k++) {
      const x=(hash(i*31+k)-.5)*3.0, z=center+(hash(i*53+k)-.5)*2.2;
      if(z<NEAR||z>12)continue;
      disk(r,x,z,.12+hash(k)*.14,.05+hash(k+9)*.08,'#3b542d0b',.003,null,8);
    }
  }
}

function bench(r, x, d, side = Math.sign(x)) {
  const wood = ['#b28a59','#7c5e3f','#dbb889'];
  for (const dx of [-.7,.7]) {
    box(r,x+dx,d,.09,.49,0,.5,['#545b4c','#41483e','#7b806b']);
    beam(r,[x+dx,d+.19,.4],[x+dx,d+.28,1.08],'#575e4e',.07);
  }
  for (let slat = 0; slat < 3; slat++) box(r,x,d-.22+slat*.19,1.9,.16,.45,.52,wood);
  for (let slat = 0; slat < 3; slat++) box(r,x,d+.28,1.9,.07,.64+slat*.17,.77+slat*.17,wood);
  for (const dx of [-.82,.82]) beam(r,[x+dx,d-.25,.72],[x+dx,d+.26,.72],'#72775b',.06);
}

function playground(r, o, d) {
  const x=o.lane, side=Math.sign(x), near=d-1.05, far=d+1.1;
  disk(r,x,d,2.6,2.25,'#caa57c');
  disk(r,x,d,2.48,2.12,'#d6b38a');
  // Two timber towers connected by a bridge, with a real floor and posts.
  for (const tx of [x-side*.95,x+side*.95]) {
    for (const dx of [-.48,.48]) for (const dz of [-.48,.48])
      box(r,tx+dx,far+dz,.1,.1,0,2.9,['#b28b5b','#8c6746','#dab781']);
    box(r,tx,far,1.12,1.16,1.35,1.49);
    const roof=3.35, eaves=2.73;
    poly(r,[[tx-.8,far-.8,eaves],[tx+.8,far-.8,eaves],[tx,far,roof]],'#bf7858','#76533f');
    poly(r,[[tx+.8,far-.8,eaves],[tx+.8,far+.8,eaves],[tx,far,roof]],'#9e654c','#76533f');
    poly(r,[[tx-.8,far-.8,eaves],[tx-.8,far+.8,eaves],[tx,far,roof]],'#d49a70','#76533f');
    for (let k=-2;k<=2;k++) beam(r,[tx+k*.18,far-.5,1.5],[tx+k*.18,far-.5,2.15],'#bb9766',.045);
    beam(r,[tx-.52,far-.5,2.18],[tx+.52,far-.5,2.18],'#caa778',.08);
  }
  box(r,x,far,.95,.74,1.36,1.45,['#c6a16d','#8c704b','#e2c290']);
  for (const dz of [-.4,.4]) {
    beam(r,[x-side*.6,far+dz,2.05],[x+side*.6,far+dz,2.05],'#6c8d8c',.07);
    for (let k=-2;k<=2;k++) beam(r,[x+k*.22,far+dz,1.48],[x+k*.22,far+dz,2.05],'#759995',.035);
  }
  // A curved slide runs towards the viewer, wholly within the play lawn.
  const tx=x-side*.95, slide=[];
  for(let k=0;k<=14;k++) {
    const t=k/14, z=far-.52-t*2.65, height=1.4*(1-t)**2+.10;
    slide.push({ z, height });
  }
  for(let k=0;k<slide.length-1;k++) {
    const a=slide[k],b=slide[k+1];
    poly(r,[[tx-.34,a.z,a.height],[tx+.34,a.z,a.height],[tx+.34,b.z,b.height],[tx-.34,b.z,b.height]],
      side<0?'#649aa2':'#be7754');
    for(const dx of [-.37,.37]) poly(r,[[tx+dx,a.z,a.height],[tx+dx,b.z,b.height],
      [tx+dx,b.z,b.height+.14],[tx+dx,a.z,a.height+.14]],side<0?'#86bac0':'#dca07a');
  }
  const ladder=x+side*.95;
  for(const dx of [-.34,.34]) beam(r,[ladder+dx,near-.35,0],[ladder+dx,far-.5,1.4],'#ad8961',.07);
  for(let k=0;k<7;k++) {
    const t=k/7;
    beam(r,[ladder-.34,near-.35+t*(far-.5-(near-.35)),t*1.4],
      [ladder+.34,near-.35+t*(far-.5-(near-.35)),t*1.4],'#d8b77f',.055);
  }
}

function swings(r, o, d) {
  const x=o.lane;
  disk(r,x,d,2.45,1.65,'#d5b58e');
  for(const dx of [-1.9,1.9]) {
    beam(r,[x+dx,d-.9,0],[x+dx,d,2.75],'#718f83',.105);
    beam(r,[x+dx,d+.9,0],[x+dx,d,2.75],'#688779',.105);
  }
  beam(r,[x-2.0,d,2.75],[x+2.0,d,2.75],'#9f7750',.14);
  for(const seat of [-.8,.8]) {
    for(const dx of [-.29,.29]) beam(r,[x+seat+dx,d,2.7],[x+seat+dx,d,.45],'#777b68',.018);
    box(r,x+seat,d,.73,.3,.40,.47,['#796249','#5d503e','#b8a080']);
  }
}

function pergola(r, o, d) {
  const x=o.lane;
  box(r,x,d,4.4,3.2,0,.045,['#bfb499','#a79f85','#cec5aa']);
  for(const dx of [-1.85,1.85]) for(const dz of [-1.3,1.3])
    box(r,x+dx,d+dz,.16,.16,.04,2.6,['#b38e63','#826647','#dcc096']);
  for(const dz of [-1.38,1.38]) box(r,x,d+dz,4.3,.16,2.53,2.72);
  for(let i=0;i<9;i++) box(r,x-2+i*.5,d,.10,3.55,2.72,2.84,['#a68659','#7d6745','#d2bb87']);
  bench(r,x,d+.9);
  // Climbing leaves stay on the same beams, without independent sway.
  for(let i=0;i<17;i++) {
    const p=parkPoint(r,x-2+hash(i)*4,d-1.5+hash(i+40)*3,2.83);
    const s=r.width*.235*p.scale;
    r.ellipse(p.x,p.y,s*.22,s*.10,['#73894e','#8d9f63','#5a7649'][i%3],null,i*.7);
  }
}

function garden(r, art, o, d) {
  disk(r,o.lane,d,.92,.8,'#c5bea2',.035,'#999579');
  disk(r,o.lane,d,.83,.70,'#68764d',.04);
  const items=Array.from({length:6},(_,i)=>({
    x:o.lane+(i%2?-.39:.39),z:d+.48-Math.floor(i/2)*.46,i,
  }));
  for(const plant of items) {
    const p=parkPoint(r,plant.x,plant.z),width=1.05*r.width*.235*p.scale;
    drawParkProp(r,art,'gardenBorder',p.x,p.y,width,width*82/240,plant.i+o.at);
  }
}

function lamp(r, o, d) {
  const x=o.lane;
  beam(r,[x,d,0],[x,d,2.9],'#56644d',.065);
  box(r,x,d,.32,.30,2.65,2.95,['#e2d7ac','#b0b18c','#f4e9c6']);
  box(r,x,d,.43,.4,2.96,3.04,['#5e6d55','#475543','#829071']);
}

export function parkObjectBounds(r, o, travel) {
  const d=o.at-travel, points=[];
  for(const x of [o.lane-o.width/2,o.lane+o.width/2])
    for(const z of [d-o.depth/2,d+o.depth/2])
      for(const up of [0,o.height])points.push(parkPoint(r,x,z,up));
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
    top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
}

function drawObject(r, art, o, travel) {
  const d=o.at-travel, p=parkPoint(r,o.lane,d);
  const bounds=parkObjectBounds(r,o,travel);
  if(bounds.right<0||bounds.left>r.width||bounds.bottom<0||bounds.top>r.height) return null;
  r.ctx.save();
  // Only the far entry is softened by atmospheric distance. There is no near
  // fade: a landmark leaves the viewport naturally as the walker passes it.
  r.ctx.globalAlpha *= Math.min(1,Math.max(0,(FAR-d)/12));
  if(o.kind==='tree') {
    const width=o.width*r.width*.235*p.scale;
    r.ellipse(p.x,p.y,width*.3,Math.max(1,width*.045),'#3c512829');
    drawParkProp(r,art,'treeOak',p.x,p.y,width,o.height*r.width*.235*p.scale,Math.round(o.at));
  } else {
    if(o.kind!=='garden') disk(r,o.lane,d,o.width*.48,o.depth*.35,'#4653371a');
    if(o.kind==='bench') bench(r,o.lane,d);
    else if(o.kind==='garden') garden(r,art,o,d);
    else if(o.kind==='playground') playground(r,o,d);
    else if(o.kind==='swings') swings(r,o,d);
    else if(o.kind==='pergola') pergola(r,o,d);
    else if(o.kind==='lamp') lamp(r,o,d);
  }
  r.ctx.restore();
  const anchorAt=o.at+o.depth/2,anchor=parkPoint(r,o.lane,anchorAt-travel);
  return {id:o.id,kind:o.kind,at:o.at,lane:o.lane,width:o.width,depth:o.depth,height:o.height,
    distance:d,x:p.x,y:p.y,scale:p.scale,bounds,
    anchor:{at:anchorAt,distance:anchorAt-travel,...anchor}};
}

export function drawParkLandscape(renderer, art, travel) {
  sky(renderer);
  drawParkGround(renderer,art,travel);
  branchPaths(renderer,travel);
  leafShadows(renderer,travel);
  const visible=PARK_WORLD.filter(o=>o.at-travel+o.depth/2>=NEAR&&o.at-travel<FAR)
    .sort((a,b)=>b.at-a.at);
  const landmarks=[];
  for(const o of visible) { const result=drawObject(renderer,art,o,travel); if(result)landmarks.push(result); }
  return Object.freeze(landmarks);
}
