import { projectStreet } from './street-camera.js';
import { MountainNatureArt } from './mountain-nature-art.js';
import { MOUNTAIN_WILDLIFE, drawMountainWildlife } from './mountain-wildlife.js';

const NEAR = -.82;
const FAR = 52;
const ROAD_EDGE = 1.66;
const WILDLIFE_KINDS = new Set(['deer','fox','rabbit','squirrel','bird','butterfly','frog','dragonfly']);
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));
const mod = (n, m) => ((n % m) + m) % m;
const hash = n => mod(Math.sin(n * 127.1 + 311.7) * 43758.5453, 1);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const makeLandmark = (id, kind, lane, at, width, depth, height, extra = {}) =>
  Object.freeze({ id, kind, lane, at, width, depth, height, ...extra });

function makeWorld() {
  const world = [
    makeLandmark('trailhead-sign', 'entrance-sign', -4.15, 5.6, 3.2, .55, 2.55),
    makeLandmark('trailhead-post-left', 'trail-post', -2.55, 2.4, .32, .32, 1.05),
    makeLandmark('trailhead-post-right', 'trail-post', 2.75, 8.1, .32, .32, 1.05),
    makeLandmark('forest-stump', 'stump', -3.75, 13.3, 1.12, .82, .72),
    makeLandmark('forest-fallen-log', 'fallen-log', 4.45, 11.5, 2.9, .62, .69),
    makeLandmark('forest-boulder-a', 'moss-rock', -4.0, 9.7, 1.48, 1.14, 1.02),
    makeLandmark('forest-boulder-b', 'moss-rock', 4.75, 15.7, 1.24, 1.02, .88),
    makeLandmark('stream-pool', 'stream', 3.78, 25.9, 2.45, 5.6, .12),
    makeLandmark('stream-cascade', 'cascade', 4.9, 28.7, .78, 1.28, .72),
    makeLandmark('stream-log-bridge', 'log-bridge', 3.55, 26.2, 1.32, 1.02, .34),
    makeLandmark('stream-rock-a', 'moss-rock', 2.45, 24.5, .94, .75, .57),
    makeLandmark('stream-rock-b', 'moss-rock', 5.18, 29.7, 1.2, .93, .75),
    makeLandmark('ridge-arrival-sign', 'arrival-sign', 3.0, 35.25, 2.35, .48, 2.05),
    makeLandmark('ridge-post', 'trail-post', -2.65, 31.8, .32, .32, 1.05),
  ];

  // Tree stands grow in irregular groups on both banks, with a broken tree
  // line opening toward the ridge. Independent seeded offsets avoid the old
  // alternating-row pattern while keeping the course repeatable.
  const tree = (id, at, side, seed, region) => {
    const species = hash(seed + 517);
    const artKey = species < .24 ? 'treeBeech' : species < .47 ? 'treeWoodland'
      : species < .77 ? 'treePine' : 'treeCedar';
    const shape = artKey === 'treeBeech' || artKey === 'treeWoodland' ? 'broadleaf' : 'conifer';
    const lane = side * (region === 'ridge' ? 5.9 + hash(seed + 93) * 4.7 : 5.7 + hash(seed + 93) * 4.5);
    world.push(makeLandmark(id, 'pine', lane, at,
      4.35 + hash(seed + 19) * 2.25, .72 + hash(seed + 51) * .72,
      7.7 + hash(seed + 7) * 5.2, { variant: seed, shape, artKey, region }));
  };
  for (let i = 0; i < 4; i++) {
    const at = [1.35, 3.9, 5.55, 7.45][i] + (hash(i + 711) - .5) * .65;
    tree(`trail-tree-${i}`, at, hash(i + 71) > .53 ? 1 : -1, i + 11, 'trailhead');
  }
  for (let i = 0; i < 20; i++) {
    const at = 7.4 + i * 1.02 + (hash(i + 411) - .5) * 1.18;
    tree(`forest-tree-${i}`, at, hash(i + 303) > .53 ? 1 : -1, i + 37, 'forest');
  }
  for (let i = 0; i < 9; i++) {
    const at = 29.2 + i * 2.18 + (hash(i + 811) - .5) * 1.05;
    tree(`ridge-tree-${i}`, at, hash(i + 703) > .53 ? 1 : -1, i + 83, 'ridge');
  }

  // Ferns and flowering plants gather in small off-trail patches rather than
  // appearing as evenly spaced rows. Their width still clears the full path.
  for (let i = 0; i < 30; i++) {
    const side = hash(i + 130) > .51 ? 1 : -1;
    const at = 2.35 + i * .91 + hash(i + 230) * .62;
    const lane = side * (2.52 + hash(i + 330) * 1.8);
    world.push(makeLandmark(`fern-${i}`, 'fern', lane, at,
      .72 + hash(i + 77) * .43, .58 + hash(i + 17) * .48, .48 + hash(i + 101) * .39, { variant: i }));
  }
  for (let i = 0; i < 16; i++) {
    const side = hash(i + 633) > .48 ? 1 : -1;
    const at = 1.8 + i * 1.92 + hash(i + 333) * 1.2;
    world.push(makeLandmark(`trail-blossom-${i}`, 'wildflowers', side * (2.45 + hash(i + 733) * 1.45), at,
      .52 + hash(i + 833) * .34, .42 + hash(i + 933) * .35, .25 + hash(i + 1033) * .14, { variant: i }));
  }
  for (let i = 0; i < 22; i++) {
    const side = hash(i + 1201) > .52 ? 1 : -1;
    const at = 3.2 + i * 1.82 + hash(i + 1301) * 1.35;
    const lane = side * (2.8 + hash(i + 1401) * 1.85);
    world.push(makeLandmark(`understory-shrub-${i}`, 'shrub', lane, at,
      .72 + hash(i + 1501) * .48, .62 + hash(i + 1601) * .55, .58 + hash(i + 1701) * .76,
      { variant: i, growth: hash(i + 1801) }));
  }
  for (let i = 0; i < 8; i++) {
    const side = hash(i + 401) > .5 ? 1 : -1;
    const at = 7.6 + i * 4.62 + hash(i + 501) * 1.8;
    world.push(makeLandmark(`moss-stone-${i}`, 'moss-rock', side * (3.05 + hash(i + 601) * 1.65), at,
      .78 + hash(i + 411) * .78, .65 + hash(i + 414) * .48, .45 + hash(i + 413) * .53));
  }
  for (const animal of MOUNTAIN_WILDLIFE) world.push(animal);
  return Object.freeze(world.sort((a, b) => b.at - a.at));
}

export const MOUNTAIN_WORLD = makeWorld();

export function mountainStageAt(timeMs = 0) {
  const seconds = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0) / 1000;
  if (seconds < 7) return 'trailhead';
  if (seconds < 16) return 'deep-forest';
  if (seconds < 24) return 'stream';
  return 'ridge';
}

export function mountainStageWeights(timeMs = 0) {
  const seconds=Math.max(0,Number.isFinite(timeMs)?timeMs:0)/1000;
  const forest=smooth(6.5,7.5,seconds);
  const stream=smooth(15.5,16.5,seconds);
  const ridge=smooth(23.5,24.5,seconds);
  return Object.freeze({entrance:1-forest,forest:forest*(1-stream),
    stream:stream*(1-ridge),ridge});
}

function point(r, lane, distance, elevation = 0) {
  return projectStreet(r.width, r.height, lane, distance, elevation, r.trailBend ?? 0);
}

function polygon(r, vertices, fill, stroke = null, lineWidth = .8) {
  const projected = vertices.map(v => point(r, v[0], v[1], v[2] ?? 0));
  r.path(projected.map(p => [p.x, p.y]), fill, stroke, lineWidth);
  return projected;
}

function roundedWorldPolygon(r, vertices, fill, stroke = null, lineWidth = .8) {
  const projected=vertices.map(v=>point(r,v[0],v[1],v[2]??0));
  const c=r.ctx;
  c.beginPath();
  const first=projected[0],last=projected.at(-1);
  c.moveTo((first.x+last.x)*.5,(first.y+last.y)*.5);
  for(let i=0;i<projected.length;i++) {
    const current=projected[i],next=projected[(i+1)%projected.length];
    c.quadraticCurveTo(current.x,current.y,(current.x+next.x)*.5,(current.y+next.y)*.5);
  }
  c.closePath();c.fillStyle=fill;c.fill();
  if(stroke){c.strokeStyle=stroke;c.lineWidth=lineWidth;c.stroke();}
  return projected;
}

function worldLine(r, a, b, color, width = 1) {
  const from = point(r, a[0], a[1], a[2] ?? 0);
  const to = point(r, b[0], b[1], b[2] ?? 0);
  const c = r.ctx;
  c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y);
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.stroke();
  return [from, to];
}

function disk(r, lane, distance, radiusX, radiusZ, elevation, fill, stroke = null, count = 18) {
  return polygon(r, Array.from({ length: count }, (_, i) => {
    const a = i / count * Math.PI * 2;
    return [lane + Math.cos(a) * radiusX, distance + Math.sin(a) * radiusZ, elevation];
  }), fill, stroke, .7);
}

function weightedColor(entries, weights) {
  const channels=[0,0,0];
  let total=0;
  for(const [key,color] of Object.entries(entries)) {
    const weight=weights[key]??0;
    total+=weight;
    for(let i=0;i<3;i++) channels[i]+=parseInt(color.slice(1+i*2,3+i*2),16)*weight;
  }
  return `#${channels.map(value=>Math.round(value/Math.max(.0001,total)).toString(16).padStart(2,'0')).join('')}`;
}

function blendHex(from,to,amount) {
  const t=clamp(amount,0,1);
  const channels=[0,1,2].map(i=>Math.round(parseInt(from.slice(1+i*2,3+i*2),16)*(1-t)+
    parseInt(to.slice(1+i*2,3+i*2),16)*t));
  return `#${channels.map(value=>value.toString(16).padStart(2,'0')).join('')}`;
}

function mountainHorizonY(height) {
  return height*(.28+.52/(1+.65*FAR));
}

function curvedRidge(c,w,h,anchors,fill) {
  const pts=anchors.map(([x,y])=>[x*w,y*h]);
  c.beginPath();c.moveTo(pts[0][0],h);c.lineTo(...pts[0]);
  for(let i=1;i<pts.length-1;i++) {
    const [x,y]=pts[i], [nx,ny]=pts[i+1];
    c.quadraticCurveTo(x,y,(x+nx)*.5,(y+ny)*.5);
  }
  c.lineTo(...pts.at(-1));c.lineTo(w*1.06,h);c.closePath();c.fillStyle=fill;c.fill();
}

function drawDistantTreeLine(c,w,h,horizon,amount) {
  if(amount<=.005)return;
  c.save();
  c.globalAlpha*=amount*.48;
  const haze=c.createLinearGradient(0,horizon-h*.045,0,horizon+h*.075);
  haze.addColorStop(0,'rgba(193,207,181,0)');
  haze.addColorStop(.5,'rgba(178,196,166,.25)');
  haze.addColorStop(1,'rgba(153,173,141,0)');
  c.fillStyle=haze;c.fillRect(0,horizon-h*.045,w,h*.12);
  // Broken, low crowns meet the distant ground at slightly different heights
  // so the forest edge fades into the mountain haze instead of making a bar.
  for(let i=0;i<34;i++) {
    const seed=i+641;
    const x=w*(i/33+(hash(seed+7)-.5)*.024);
    const baseY=horizon+h*(hash(seed+19)*.014-.003);
    const width=w*(.018+hash(seed+29)*.025),height=h*(.025+hash(seed+39)*.045);
    const lean=(hash(seed+49)-.5)*width*.34;
    c.beginPath();c.moveTo(x-width*.52,baseY+height*.12);
    c.bezierCurveTo(x-width*.62,baseY-height*.08,x-width*.27,baseY-height*.51,x+lean,baseY-height*.57);
    c.bezierCurveTo(x+width*.29,baseY-height*.45,x+width*.59,baseY-height*.13,x+width*.48,baseY+height*.1);
    c.quadraticCurveTo(x,baseY+height*.18,x-width*.52,baseY+height*.12);
    c.closePath();c.fillStyle=i%4===0?'#4b6749':'#59744e';c.fill();
    c.beginPath();
    c.ellipse(x-width*.25,baseY-height*.20,width*.31,height*.20,-.16,0,Math.PI*2);
    c.ellipse(x+width*.20,baseY-height*.23,width*.34,height*.22,.12,0,Math.PI*2);
    c.fillStyle=i%3===0?'#6f8555':'#617c51';c.fill();
  }
  c.restore();
}

function drawRidgeMountains(c,w,h,amount) {
  if(amount<=.005)return;
  // Broad, overlapping profiles rise out of the low woodland horizon as the
  // trail reaches the lookout. Their rounded control points describe distant
  // Japanese ranges rather than isolated alpine peaks.
  c.save();c.globalAlpha*=amount*.76;
  curvedRidge(c,w,h,[[-.06,.29],[.06,.235],[.16,.205],[.26,.23],[.37,.155],
    [.48,.195],[.59,.115],[.70,.17],[.81,.135],[.91,.21],[1.06,.25]],'#9aafa0');
  c.restore();
  c.save();c.globalAlpha*=amount*.84;
  curvedRidge(c,w,h,[[-.06,.34],[.07,.30],[.18,.265],[.29,.30],[.40,.225],
    [.52,.27],[.63,.205],[.75,.25],[.86,.22],[.96,.29],[1.06,.30]],'#748d79');
  c.restore();
}

function skyAndHorizon(r, timeMs) {
  const { ctx: c, width: w, height: h } = r;
  const weights=mountainStageWeights(timeMs);
  const forest=weights.forest+weights.stream*.58;
  const open=weights.entrance*.62+weights.ridge;
  const seconds=Math.max(0,timeMs)/1000;
  const horizon=mountainHorizonY(h,weights);
  const sky = c.createLinearGradient(0, 0, 0, horizon + h * .09);
  sky.addColorStop(0,weightedColor({entrance:'#abc7c8',forest:'#9eb5b0',stream:'#a9c4bd',ridge:'#a9c9d0'},weights));
  sky.addColorStop(.57,weightedColor({entrance:'#e5e0c5',forest:'#cad4bd',stream:'#d3dfc7',ridge:'#dae5cd'},weights));
  sky.addColorStop(1, '#f2e6c6');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);

  // Broad, overlapping green ridges keep the mountain range low and hazy;
  // rounded crests avoid sharp alpine peaks that feel out of place here.
  curvedRidge(c,w,h,[[-.05,.35],[.06,.32],[.17,.28],[.25,.235],[.34,.25],[.43,.30],
    [.52,.22],[.61,.255],[.70,.185],[.80,.22],[.90,.29],[1.04,.27]],
    weightedColor({entrance:'#94aa90',forest:'#829886',stream:'#879e91',ridge:'#789589'},weights));
  curvedRidge(c,w,h,[[-.06,.40],[.08,.365],[.18,.34],[.28,.355],[.39,.30],[.49,.34],
    [.60,.285],[.70,.33],[.82,.29],[.92,.35],[1.05,.32]],
    weightedColor({entrance:'#718c6c',forest:'#68836c',stream:'#6f896f',ridge:'#617f70'},weights));
  drawRidgeMountains(c,w,h,weights.ridge);
  // Soft stone seams follow the rounded slopes, shaded sage rather than snow.
  c.save();c.globalAlpha*=.24;
  for(const [x,y,wide] of [[.25,.24,.055],[.51,.225,.06],[.80,.22,.05]]) {
    c.beginPath();c.moveTo(w*x,h*y);c.quadraticCurveTo(w*(x-.012),h*(y+.06),w*(x+wide),h*(y+.13));
    c.quadraticCurveTo(w*(x+wide*.58),h*(y+.105),w*x,h*y);c.closePath();
    c.fillStyle='#d9d6b6';c.fill();
  }
  c.restore();

  const hillside = c.createLinearGradient(0, horizon, 0, h);
  hillside.addColorStop(0,weightedColor({entrance:'#69885b',forest:'#526f50',stream:'#5b7954',ridge:'#738c5b'},weights));
  hillside.addColorStop(.48,weightedColor({entrance:'#789358',forest:'#6c8853',stream:'#718f5a',ridge:'#80965d'},weights));
  hillside.addColorStop(1,'#566f49');
  c.fillStyle = hillside; c.fillRect(0, horizon, w, h - horizon);
  if (open > .01) {
    const light = c.createRadialGradient(w*.52,horizon+h*.06,1,w*.52,horizon+h*.06,w*.46);
    light.addColorStop(0, `rgba(245,229,176,${.19*open})`);
    light.addColorStop(1, 'rgba(245,229,176,0)');
    c.fillStyle = light; c.fillRect(0,horizon-h*.18,w,h*.42);
  }
  const sunX = w * (.83-forest*.05), sunY = horizon * .42;
  r.ellipse(sunX,sunY,Math.max(8,w*.045),Math.max(8,w*.045),'#fff1cb72');
  r.ellipse(sunX,sunY,Math.max(4,w*.026),Math.max(4,w*.026),'#fff4d4');
  if (forest < .95) {
    // Fixed dappled light spots echo leaf gaps; reduced motion does not
    // change any world geometry or camera motion.
    for (let i = 0; i < 5; i++) {
      const x = w * (.14 + i * .19), y = horizon + h * (.12 + hash(i) * .19);
      r.ellipse(x,y,w*.045,h*.018,`rgba(245,231,185,${.10*(1-forest)})`);
    }
  }
  return {horizon,forest,open,seconds,weights};
}

function trailGround(r, travel, timeMs, art=null) {
  const { ctx: c, width: w, height: h } = r;
  const weights=mountainStageWeights(timeMs);
  const far = FAR, near = NEAR;
  const groundTop=point(r,0,far).y;
  const horizon=mountainHorizonY(h,weights);
  const hillsideTop=weightedColor({entrance:'#69885b',forest:'#526f50',stream:'#5b7954',ridge:'#738c5b'},weights);
  const hillsideMid=weightedColor({entrance:'#789358',forest:'#6c8853',stream:'#718f5a',ridge:'#80965d'},weights);
  const horizonOffset=clamp((groundTop-horizon)/(h-horizon),0,1);
  const groundAtHorizon=horizonOffset<.48
    ?blendHex(hillsideTop,hillsideMid,horizonOffset/.48)
    :blendHex(hillsideMid,'#566f49',(horizonOffset-.48)/.52);
  const base = c.createLinearGradient(0,groundTop,0,h);
  base.addColorStop(0,groundAtHorizon);
  base.addColorStop(.35,weightedColor({entrance:'#7e965b',forest:'#718653',stream:'#6f8956',ridge:'#87975a'},weights));
  base.addColorStop(1,'#566f48');
  c.fillStyle = base; c.fillRect(0,groundTop,w,h-groundTop);

  const path = c.createLinearGradient(0,h*.29,0,h);
  path.addColorStop(0,'#ab9671'); path.addColorStop(.36,'#b89c71'); path.addColorStop(1,'#c5a677');
  polygon(r,[[-ROAD_EDGE,near,0],[ROAD_EDGE,near,0],[ROAD_EDGE,far,0],[-ROAD_EDGE,far,0]],path);

  // A broken margin of moss, leaf litter, and dark soil eases the trail into
  // the forest floor. The patches are irregular in both sides and shape, and
  // stay clear of the three-lane walking surface.
  const firstPatch=Math.floor((travel+NEAR)/.43);
  const patchColors=['#536c4559','#7e805348','#8a694451','#b49a5c50','#415d3e60'];
  for(let i=0;i<36;i++) {
    const worldIndex=firstPatch+i;
    const at=worldIndex*.43+hash(worldIndex+2041)*.22;
    const d=at-travel;
    if(d<near||d>12)continue;
    const side=hash(worldIndex+2101)>.52?1:-1;
    const lane=side*(2.32+hash(worldIndex+2141)*5.8);
    const radiusX=.14+hash(worldIndex+2201)*.28;
    const radiusZ=.12+hash(worldIndex+2301)*.33;
    const vertices=Array.from({length:8},(_,k)=>{
      const angle=k/8*Math.PI*2;
      const rough=.72+hash(worldIndex*17+k+2401)*.53;
      return [lane+Math.cos(angle)*radiusX*rough,at+Math.sin(angle)*radiusZ*rough,.006];
    });
    roundedWorldPolygon(r,vertices,patchColors[mod(worldIndex,patchColors.length)]);
    const p=point(r,lane,d,.012);
    const fleck=Math.max(.45,Math.min(3.6,w*.235*p.scale*.045));
    if(worldIndex%3===0) {
      r.ellipse(p.x+fleck*.7,p.y-fleck*.3,fleck*.82,fleck*.22,
        worldIndex%2?'#ceb66a88':'#a5a16485',null,(hash(worldIndex+2501)-.5)*.65);
    } else if(worldIndex%4===0) {
      worldLine(r,[lane-.055,at+.045,.013],[lane+.075,at-.035,.014],'#453e2e75',Math.max(.45,p.scale*.45));
    }
  }

  // Low-contrast gravel flecks are anchored to short world intervals.
  const first = Math.floor((travel + .82) * 2.2);
  for (let i = first; i < first + 50; i++) {
    const at = i / 2.2, d = at - travel;
    if (d < near || d > 15) continue;
    const lane = (hash(i + 105) - .5) * 2.78;
    const p = point(r,lane,d), s = Math.max(.3,Math.min(4,w*.235*p.scale));
    const angle = (hash(i+12)-.5)*.5;
    r.ellipse(p.x,p.y,s*(.55+hash(i+17)*.5),s*.17,i%4 ? '#69573e36' : '#f1dfb469',null,angle);
  }

  // Fern banks and grasses sit beyond the dirt path's contact edge. They are
  // simple ground marks here; larger individual fronds live in world space.
  for (const side of [-1,1]) {
    const firstClump = Math.floor((travel - .82) / .58);
    for (let i = 0; i < 74; i++) {
      const worldIndex = firstClump + i;
      const at = worldIndex * .58 + hash(worldIndex + side * 53) * .18;
      const d = at - travel;
      if (d < near || d > 10) continue;
      const lane = side * (1.85 + hash(worldIndex + side * 19) * 1.25);
      const p = point(r,lane,d), s = Math.max(.5,Math.min(9,w*.235*p.scale));
      const sway = !r.reducedMotion ? Math.sin((r.motionTimeMs ?? 0)/1250 + worldIndex) * s * .055 : 0;
      const c = r.ctx;
      c.beginPath(); c.moveTo(p.x-s*.42,p.y+s*.12); c.quadraticCurveTo(p.x-s*.15+sway,p.y-s*.3,p.x-s*.14,p.y-s*.62);
      c.moveTo(p.x-s*.05,p.y+s*.13); c.quadraticCurveTo(p.x+sway,p.y-s*.38,p.x+s*.08,p.y-s*.72);
      c.moveTo(p.x+s*.26,p.y+s*.1); c.quadraticCurveTo(p.x+s*.2+sway,p.y-s*.23,p.x+s*.43,p.y-s*.49);
      c.strokeStyle = worldIndex%3 ? '#365e3c9a' : '#a0a35d99'; c.lineWidth = Math.max(.55,s*.11); c.lineCap='round'; c.stroke();
    }
  }
  // Sample the decoded ground material through the shared world camera.
  art?.drawTerrain?.(r,travel,ROAD_EDGE);
}

function pine(r, o, d) {
  const x=o.lane,height=o.height,spread=o.width*.5;
  const base=point(r,x,d);
  r.ellipse(base.x,base.y+Math.max(1,base.scale*2),
    Math.max(1,r.width*.235*base.scale*.34),Math.max(1,r.width*.235*base.scale*.075),'#263b2c47');
  // Exposed roots widen into the soil and keep the tree visibly grounded.
  roundedWorldPolygon(r,[[x-.44,d-.17,0],[x-.19,d-.13,.16],[x-.13,d-.03,.37],
    [x+.04,d-.09,.25],[x+.18,d-.02,.39],[x+.39,d-.14,0],[x+.13,d+.04,.18],
    [x-.13,d+.035,.19]],'#77573a','#493b2b',.7);
  polygon(r,[[x-.19,d,0],[x-.14,d,height*.72],[x-.055,d,height*.84],[x+.09,d,height*.82],
    [x+.14,d,height*.72],[x+.25,d,0]],'#8a6441','#4d3d2e',.8);
  // Bark planes and slim grooves taper with height.
  for(let i=0;i<3;i++) {
    const lane=x-.14+i*.12;
    worldLine(r,[lane,d-.025,.09],[lane+.015,d-.026,height*(.43+(i%2)*.13)],
      i%2?'#dfb87b72':'#49392d73',Math.max(.45,r.width*.001*base.scale));
  }
  if(o.shape==='broadleaf') {
    worldLine(r,[x,d-.025,height*.36],[x-.56,d-.03,height*.74],'#775436',Math.max(.8,base.scale*1.2));
    worldLine(r,[x+.025,d-.03,height*.43],[x+.60,d-.045,height*.77],'#6c4e35',Math.max(.8,base.scale*1.1));
    const shades=['#3b6445','#4b744c','#5c8050','#355d42','#6c8955','#436d47'];
    for(let i=0;i<8;i++) {
      const a=i/8*Math.PI*2+(hash(i+(o.variant??0)*13)-.5)*.38;
      const centerLane=x+Math.cos(a)*spread*(.17+hash(i+71)*.10);
      const centerElev=height*(.67+(i%4)*.045+hash(i+82)*.025);
      const rx=spread*(.29+hash(i+93)*.12), ry=height*(.125+hash(i+104)*.07);
      const vertices=Array.from({length:15},(_,k)=>{
        const angle=k/15*Math.PI*2, rough=.74+hash(i*23+k+(o.variant??0)*9)*.48;
        return [centerLane+Math.cos(angle)*rx*rough,d-.035,centerElev+Math.sin(angle)*ry*rough];
      });
      roundedWorldPolygon(r,vertices,shades[(i+(o.variant??0))%shades.length],'#2846348f',.45);
    }
  } else {
    // Rounded, overlapping bough shelves keep the evergreen shape recognizable
    // without repeating the same sharp triangular silhouette on every tree.
    const shades=['#315840','#3e6947','#4b754b','#365f43','#547a4b'];
    for(let i=0;i<4;i++) {
      const t=i/3,center=height*(.39+t*.48)+(hash(i+(o.variant??0)*11)-.5)*height*.035;
      const width=spread*(1-t*.77)*(.78+hash(i+(o.variant??0)*13)*.27);
      const thick=height*(.30-t*.09);
      const leftWidth=width*(.88+hash(i+30)*.12),rightWidth=width*(.9+hash(i+52)*.1);
      const centerLane=x+(hash(i+(o.variant??0)*17)-.5)*spread*.12;
      const vertices=[[centerLane,d,center+thick*.52],
        [centerLane-leftWidth*.34,d,center+thick*.35],[centerLane-leftWidth*.70,d,center+thick*.31],
        [centerLane-leftWidth,d,center+thick*.05],[centerLane-leftWidth*.82,d,center-thick*.12],
        [centerLane-leftWidth*.43,d,center-thick*.19],[centerLane,d,center-thick*.35],
        [centerLane+rightWidth*.48,d,center-thick*.18],[centerLane+rightWidth*.87,d,center-thick*.11],
        [centerLane+rightWidth,d,center+thick*.06],[centerLane+rightWidth*.65,d,center+thick*.29],
        [centerLane+rightWidth*.31,d,center+thick*.36]];
      roundedWorldPolygon(r,vertices,shades[(i+(o.variant??0))%shades.length],'#294834a3',.5);
      worldLine(r,[x-.03,d,center+thick*.08],[x-width*.70,d-.012,center-thick*.06],
        '#9aaf6a66',Math.max(.65,base.scale*1.05));
      worldLine(r,[x+.025,d,center+thick*.08],[x+width*.68,d-.012,center-thick*.07],
        '#203f32a0',Math.max(.7,base.scale*1.1));
    }
  }
  // Small upper bark highlights make the trunk read between bough layers.
  if(base.scale>.22) worldLine(r,[x+.035,d-.03,.18],[x+.035,d-.03,height*.58],'#e0bd816d',Math.max(.5,base.scale));
}

function drawRock(r,o,d) {
  const x=o.lane,w=o.width,depth=o.depth,h=o.height;
  const base=point(r,x,d);
  r.ellipse(base.x,base.y+Math.max(1,base.scale*2),
    Math.max(1,r.width*.235*base.scale*w*.55),Math.max(1,r.width*.235*base.scale*depth*.23),'#28382c55');
  const sides=10, angles=Array.from({length:sides},(_,i)=>i/sides*Math.PI*2);
  const bottom=angles.map((a,i)=>[x+Math.cos(a)*w*.49,d+Math.sin(a)*depth*.45,0]);
  const top=angles.map((a,i)=>{
    const jitter=.87+hash(i+Math.round(o.at)*13)*.2;
    return [x+Math.cos(a)*w*.42*jitter,d+Math.sin(a)*depth*.39*jitter,h*(.76+hash(i+o.at)*.22)];
  });
  polygon(r,bottom,'#594f3b','#393b2e',.8);
  const stoneColors=['#69725b','#788064','#606e59','#85836a','#53634f'];
  for(let i=0;i<sides;i++) {
    const j=(i+1)%sides;
    polygon(r,[bottom[i],bottom[j],top[j],top[i]],stoneColors[i%stoneColors.length],'#38443688',.55);
  }
  const peak=[x-w*.03,d-depth*.025,h*1.06];
  for(let i=0;i<sides;i++) {
    const j=(i+1)%sides;
    polygon(r,[top[i],top[j],peak],i%3===0?'#9a9879':'#81866b','#4b5948a0',.5);
  }
  // Moss grows along the cool upper face and into one or two fissures.
  const mossLane=x-w*.12, mossD=d-depth*.18;
  polygon(r,[[mossLane-w*.20,mossD,.66*h],[mossLane-w*.12,mossD-.08,.88*h],
    [mossLane+w*.09,mossD-.05,.94*h],[mossLane+w*.22,mossD+.035,.78*h],
    [mossLane+w*.08,mossD+.1,.67*h]],'#7f9860a9','#b5b27c64',.45);
  worldLine(r,[x+w*.1,d-depth*.2,h*.81],[x+w*.18,d-depth*.19,h*.53],'#414d3b9c',.7);
}

function drawStump(r,o,d) {
  const x=o.lane,h=o.height,w=o.width,depth=o.depth;
  const base=point(r,x,d);
  r.ellipse(base.x,base.y+Math.max(1,base.scale*2),w*r.width*.235*base.scale*.62,
    depth*r.width*.235*base.scale*.35,'#332e2452');
  const far=Array.from({length:16},(_,i)=>{
    const a=i/16*Math.PI*2;
    return [x+Math.cos(a)*w*.43,d+Math.sin(a)*depth*.39,h];
  });
  const near=Array.from({length:16},(_,i)=>{
    const a=i/16*Math.PI*2;
    return [x+Math.cos(a)*w*.5,d+Math.sin(a)*depth*.47,.04];
  });
  for(let i=0;i<16;i++) polygon(r,[near[i],near[(i+1)%16],far[(i+1)%16],far[i]],
    i%4===0?'#755538':'#805e3d','#4f402d',.6);
  polygon(r,far,'#c09a68','#5d4934',.8);
  disk(r,x,d-depth*.025,w*.35,depth*.30,h+.008,'#d3b47b','#765c3c',18);
  disk(r,x-.04,d-depth*.045,w*.19,depth*.15,h+.012,'#b79161','#987448',16);
  disk(r,x-.04,d-depth*.045,w*.075,depth*.06,h+.016,'#d8bd89','#92704a',12);
  for(let i=0;i<3;i++) worldLine(r,[x-w*.29+i*.17,d-depth*.39,.12],[x-w*.25+i*.2,d-depth*.4,h*.77],
    i===1?'#b18a5a':'#543f2d9e',.65);
  // A leafy sprig rooted in the back corner keeps the stump from looking cut
  // like a polished post.
  const spore=point(r,x+w*.25,d-depth*.15,h*.78);
  r.ellipse(spore.x,spore.y,Math.max(.4,base.scale*2.4),Math.max(.25,base.scale*.85),'#6f8757',null,-.35);
}

function drawLog(r,o,d) {
  const x=o.lane,w=o.width,depth=o.depth,h=o.height;
  const base=point(r,x,d);
  r.ellipse(base.x,base.y+Math.max(1,base.scale*2),w*r.width*.235*base.scale*.52,
    depth*r.width*.235*base.scale*.36,'#2d30264f');
  polygon(r,[[x-w*.5,d-depth*.38,.08],[x+w*.5,d-depth*.38,.08],
    [x+w*.45,d-depth*.30,h*.83],[x-w*.43,d-depth*.30,h]],'#8a633f','#503d2d',.8);
  polygon(r,[[x-w*.5,d-depth*.38,.08],[x-w*.5,d+depth*.45,.06],
    [x-w*.42,d+depth*.42,h*.62],[x-w*.43,d-depth*.30,h]],'#61492f','#433a2c',.7);
  polygon(r,[[x-w*.5,d+depth*.45,.06],[x+w*.5,d+depth*.45,.06],
    [x+w*.45,d-depth*.30,h*.83],[x-w*.42,d+depth*.42,h*.62]],'#735338','#493c2b',.7);
  for(let i=0;i<6;i++) {
    const lane=x-w*.4+i*w*.16;
    worldLine(r,[lane,d-depth*.29,h*.97],[lane+w*.01,d+depth*.40,h*.65],
      i%2?'#c097604e':'#3f382a64',Math.max(.45,base.scale*1.1));
  }
  for(const side of [-1,1]) {
    disk(r,x+side*w*.49,d-depth*.30,Math.min(.17,w*.07),depth*.27,h*.84,'#c09a66','#5c4631',14);
    disk(r,x+side*w*.49,d-depth*.30,Math.min(.10,w*.045),depth*.15,h*.842,'#a77f52','#795b3b',12);
  }
  for(let i=0;i<3;i++) {
    const lane=x-w*.28+i*w*.28;
    polygon(r,[[lane,d-depth*.2,h*.81],[lane+w*.08,d-depth*.16,h*.96],
      [lane+w*.22,d+depth*.02,h*.78],[lane+w*.12,d+depth*.13,h*.57]],i%2?'#64804e':'#768958','#4e6847',.4);
  }
}

function drawFern(r,o,d,timeMs) {
  const base=point(r,o.lane,d), size=r.width*.235*base.scale*o.width;
  const c=r.ctx, sway=!r.reducedMotion ? Math.sin(timeMs/1080+(o.variant??0))*size*.045 : 0;
  r.ellipse(base.x,base.y+Math.max(.4,base.scale),size*.38,Math.max(.5,size*.085),'#273d3152');
  const shades=['#3f7148','#56804c','#77925a','#355d42'];
  for(let colorIndex=0;colorIndex<shades.length;colorIndex++) {
    c.beginPath();
    for(let i=colorIndex;i<9;i+=shades.length) {
      const t=i/8,angle=-1.22+t*2.44;
      const tipX=base.x+Math.sin(angle)*size*.53+sway;
      const tipY=base.y-size*(.40+Math.sin(t*Math.PI)*.16);
      const midX=(base.x+tipX)*.5,midY=(base.y+tipY)*.5-size*.03;
      c.moveTo(base.x,base.y);c.quadraticCurveTo(midX,midY,tipX,tipY);
      for(let leaflet=1;leaflet<=4;leaflet++) {
        const f=leaflet/5,lx=base.x+(tipX-base.x)*f,ly=base.y+(tipY-base.y)*f;
        const leaf=size*(.095*(1-f*.52));
        for(const side of [-1,1]) {
          c.moveTo(lx,ly);c.quadraticCurveTo(lx+side*leaf*.45,ly-leaf*.25,
            lx+side*leaf,ly-leaf*.73);
        }
      }
    }
    c.strokeStyle=shades[colorIndex];c.lineWidth=Math.max(.6,size*.047);c.lineCap='round';c.stroke();
  }
  const curled=point(r,o.lane+o.width*.18,d-.03,o.height*.53);
  r.ellipse(curled.x,curled.y,Math.max(.4,size*.1),Math.max(.35,size*.045),'#9da66a',null,-.45);
}

function drawFlowers(r,o,d) {
  const base=point(r,o.lane,d), s=r.width*.235*base.scale*o.width;
  r.ellipse(base.x,base.y+Math.max(.4,base.scale),s*.43,Math.max(.5,s*.12),'#2c432e42');
  for(let i=0;i<7;i++) {
    const dx=(hash(i+(o.variant??0)*29)-.5)*s*.72;
    const dy=(hash(i+32+(o.variant??0))*-.27-.05)*s;
    const colors=['#fff1d6','#e8c56c','#dca9a0','#e8eee0'];
    const color=colors[(i+(o.variant??0))%colors.length];
    r.ellipse(base.x+dx,base.y+dy,Math.max(.75,s*.055),Math.max(.65,s*.038),color,null,(i%3-.8)*.3);
    r.ellipse(base.x+dx,base.y+dy,Math.max(.4,s*.016),Math.max(.4,s*.014),'#c58b4c');
    const c=r.ctx;c.beginPath();c.moveTo(base.x+dx,base.y+dy+1);c.lineTo(base.x+dx*.8,base.y+2);
    c.strokeStyle='#517249c9';c.lineWidth=Math.max(.55,s*.019);c.stroke();
  }
}

function drawShrub(r,o,d,timeMs) {
  const x=o.lane, base=point(r,x,d), size=r.width*.235*base.scale;
  const c=r.ctx, phase=(o.variant??0)*1.71;
  const sway=!r.reducedMotion?Math.sin(timeMs/1570+phase)*.018:0;
  r.ellipse(base.x,base.y+Math.max(.6,base.scale*1.4),Math.max(1,size*o.width*.35),
    Math.max(.6,size*o.depth*.16),'#283d305b');
  const shades=['#375f40','#456d43','#547848','#65824b','#748b51'];
  const branches=5;
  for(let i=0;i<branches;i++) {
    const t=i/(branches-1);
    const offset=(hash(i+phase*19)-.5)*o.width*.66;
    const height=o.height*(.44+hash(i+phase*23)*.36);
    const lean=(t-.5)*o.width*.42+sway;
    worldLine(r,[x+offset*.45,d+.012,.06],[x+offset+lean,d-.02,height*.72],
      i%2?'#76573a':'#62482f',Math.max(.45,base.scale*.72));
    const centerLane=x+offset+lean;
    const radius=o.width*(.20+hash(i+phase*29)*.13);
    const centerElevation=height*(.72+hash(i+phase*31)*.15);
    const vertices=Array.from({length:12},(_,k)=>{
      const angle=k/12*Math.PI*2;
      const rough=.76+hash(i*13+k+phase*37)*.47;
      return [centerLane+Math.cos(angle)*radius*rough,d-.035,
        centerElevation+Math.sin(angle)*height*.19*rough];
    });
    roundedWorldPolygon(r,vertices,shades[(i+(o.variant??0))%shades.length],'#304a347c',.38);
    const tip=point(r,centerLane+radius*.18,d-.045,centerElevation+height*.08);
    r.ellipse(tip.x,tip.y,Math.max(.45,size*radius*.07),Math.max(.35,size*radius*.035),
      i%2?'#a2aa637c':'#bec07868',null,-.36+i*.12);
  }
}

function drawSign(r,o,d,arrival=false) {
  const x=o.lane, h=o.height, width=o.width, base=point(r,x,d);
  const signWidth=width*.83, signHeight=arrival ? .56 : .66;
  const bottom=h*.55, top=bottom+signHeight;
  r.ellipse(base.x,base.y+Math.max(1,base.scale*1.5),width*r.width*.235*base.scale*.38,
    .9*r.width*.235*base.scale*.13,'#2b30254b');
  for(const dx of [-signWidth*.40,signWidth*.40]) {
    polygon(r,[[x+dx-.05,d,0],[x+dx+.05,d,0],[x+dx+.045,d,top+.16],[x+dx-.045,d,top+.16]],
      '#755538','#4c3b2c',.8);
    worldLine(r,[x+dx-.1,d-.02,.08],[x+dx+.1,d-.02,.08],'#463a2b',1.1);
  }
  const left=x-signWidth*.5,right=x+signWidth*.5;
  polygon(r,[[left,d-.035,bottom],[right,d-.035,bottom],[right,d-.035,top],[left,d-.035,top]],
    arrival?'#9b744c':'#a87549','#523c2b',1.05);
  polygon(r,[[left+.13,d-.045,bottom+.12],[right-.13,d-.045,bottom+.12],
    [right-.13,d-.045,top-.12],[left+.13,d-.045,top-.12]],arrival?'#d4b37b':'#dec391','#815d3e',.7);
  worldLine(r,[x-signWidth*.34,d-.052,bottom+.20],[x+signWidth*.34,d-.052,bottom+.20],'#8c6947',.7);
  const center=point(r,x,d-.062,bottom+signHeight*.50);
  const pixelWidth=Math.abs(point(r,right,d-.05).x-point(r,left,d-.05).x);
  const fontSize=clamp(pixelWidth*(arrival ? .14 : .115),4,12);
  r.ctx.save();r.ctx.textAlign='center';r.ctx.textBaseline='middle';r.ctx.font=`600 ${fontSize}px system-ui, sans-serif`;
  r.ctx.fillStyle=arrival?'#4b4634':'#4b4535';
  r.ctx.fillText(arrival?'山頂':'森の小径',center.x,center.y,Math.max(5,pixelWidth*.72));
  r.ctx.restore();
  if(arrival) {
    // A short arrow notch is cut into the right end of the ridge sign.
    polygon(r,[[right-.28,d-.06,bottom+.20],[right-.06,d-.06,bottom+.30],[right-.28,d-.06,bottom+.40]],
      '#72513a');
  } else {
    for(const dx of [-signWidth*.32,signWidth*.32]) r.ellipse(point(r,x+dx,d-.055,bottom+signHeight*.48).x,
      point(r,x+dx,d-.055,bottom+signHeight*.48).y,Math.max(.5,pixelWidth*.015),Math.max(.5,pixelWidth*.015),'#dcae66');
  }
}

function drawTrailPost(r,o,d) {
  const x=o.lane,h=o.height,p=point(r,x,d);
  r.ellipse(p.x,p.y+1,Math.max(1,p.scale*r.width*.045),Math.max(.7,p.scale*r.width*.012),'#29342950');
  polygon(r,[[x-.045,d,0],[x+.045,d,0],[x+.04,d,h],[x-.04,d,h]],'#806044','#493b2b',.7);
  polygon(r,[[x-.24,d-.015,h*.74],[x+.24,d-.015,h*.74],[x+.29,d-.015,h*.98],
    [x-.20,d-.015,h*1.05]],'#916a45','#4e3b2a',.8);
  worldLine(r,[x-.16,d-.025,h*.9],[x+.17,d-.025,h*.9],'#d7b77b',.8);
  r.ellipse(point(r,x-.16,d-.04,h*.88).x,point(r,x-.16,d-.04,h*.88).y,Math.max(.7,p.scale*r.width*.012),
    Math.max(.5,p.scale*r.width*.007),'#e8c982');
}

function drawStreamStone(r,lane,z,radiusX,radiusZ,seed,height=.075) {
  if(r.mountainScene?.art?.drawProp(r,'mossBoulder',{
    lane,width:radiusX*2.1,height:height+radiusZ*.42,
  },z))return;
  const count=8,lower=[],upper=[];
  for(let i=0;i<count;i++) {
    const angle=i/count*Math.PI*2;
    const rough=.78+hash(seed+i*7)*.38;
    const x=lane+Math.cos(angle)*radiusX*rough;
    const distance=z+Math.sin(angle)*radiusZ*rough;
    lower.push([x,distance,.018]);
    upper.push([x*.0+lane+(x-lane)*.91,distance,.018+height*(.79+hash(seed+i*11)*.24)]);
  }
  const base=point(r,lane,z);
  r.ellipse(base.x,base.y+Math.max(.5,base.scale),Math.max(.8,r.width*.235*base.scale*radiusX*.9),
    Math.max(.5,r.width*.235*base.scale*radiusZ*.34),'#263b3150');
  const sideColors=['#777969','#85816c','#696d5e','#908872'];
  for(let i=0;i<count;i++) {
    const j=(i+1)%count;
    polygon(r,[lower[i],lower[j],upper[j],upper[i]],sideColors[(i+seed)%sideColors.length],'#5660529c',.4);
  }
  roundedWorldPolygon(r,upper,['#92907a','#858875','#9b967b'][seed%3],'#5b6557',.45);
  const glint=point(r,lane-radiusX*.24,z-radiusZ*.18,height*.9);
  r.ellipse(glint.x,glint.y,Math.max(.45,r.width*.235*glint.scale*radiusX*.18),
    Math.max(.35,r.width*.235*glint.scale*radiusZ*.12),'#c3b99782',null,-.3);
}

function drawStream(r,o,d,art=null) {
  const center=o.lane,z0=d-o.depth*.5,z1=d+o.depth*.5;
  const worldAt=z=>o.at+z-d;
  const bendAt=z=>{
    const t=worldAt(z);
    return .44*Math.sin(t*.64+1.4)+.18*Math.sin(t*1.37-.6)+.055*Math.sin(t*2.6+.3);
  };
  const halfAt=z=>{
    const t=worldAt(z);
    return .43+.085*Math.sin(t*.93+.5)+.045*Math.sin(t*2.3-1.1);
  };
  const bankAt=z=>.16+.055*Math.sin(worldAt(z)*1.18+.7);
  const segments=18,bankLeft=[],bankRight=[],waterLeft=[],waterRight=[];
  for(let i=0;i<=segments;i++) {
    const t=i/segments,z=z0+t*o.depth,cx=center+bendAt(z),half=halfAt(z),outer=half+bankAt(z);
    bankLeft.push([cx-outer,z,.004]);bankRight.push([cx+outer,z,.004]);
    waterLeft.push([cx-half,z,.022+.008*Math.sin(worldAt(z)*1.7)]);
    waterRight.push([cx+half,z,.022+.008*Math.sin(worldAt(z)*1.7)]);
  }
  const bank=[...bankLeft,...bankRight.slice().reverse()];
  const water=[...waterLeft,...waterRight.slice().reverse()];
  // A shallow stony bed follows a wavering channel. The muted water leaves
  // the uneven gravel banks visible and avoids a broad, pool-like surface.
  roundedWorldPolygon(r,bank,'#77745f','#5e6654',.45);
  roundedWorldPolygon(r,water,'#708a83','#596f69',.38);

  // A visible gravel bed and exposed mossy stones break the broad fill into
  // shallow pools. Their positions are world anchored, including during pause.
  for(let i=0;i<34;i++){
    const z=z0+.12+hash(i+3101)*(o.depth-.24),cx=center+bendAt(z),half=halfAt(z);
    const lane=cx+(hash(i+3111)-.5)*half*1.86;
    const size=.026+hash(i+3121)*.065;
    disk(r,lane,z,size,size*.73,.029,['#b0ad8b99','#515f50aa','#c2b89988','#7c806abb'][i%4],null,7);
  }
  for(let i=0;i<13;i++){
    const z=z0+.15+hash(i+3141)*(o.depth-.3),cx=center+bendAt(z);
    const lane=cx+(hash(i+3151)>.5?1:-1)*(halfAt(z)*(.7+hash(i+3161)*.43));
    const width=.16+hash(i+3171)*.25;
    if(!art?.drawProp?.(r,'mossBoulder',{lane,width,height:width*.65},z))
      drawStreamStone(r,lane,z,width*.5,width*.46,i+91,width*.25);
  }
  // Small shoals and stones break the water edge; no continuous bright shelf
  // or foam stripe makes the stream read as a constructed channel.
  for(let i=0;i<7;i++) {
    const z=z0+.30+hash(i+1901)*(o.depth-.60),side=hash(i+1911)>.5?1:-1;
    const cx=center+bendAt(z),half=halfAt(z),lane=cx+side*(half+bankAt(z)*.52);
    const size=.075+hash(i+1921)*.09;
    drawStreamStone(r,lane,z,size,size*(.85+hash(i+1931)*.5),Math.floor(worldAt(z)*17+i+41),.035+size*.3);
  }
  for(let i=0;i<5;i++) {
    const t=(i+.5)/5,z=z0+t*o.depth+(hash(i+1941)-.5)*.22;
    const cx=center+bendAt(z),lane=cx+(hash(i+1951)-.5)*halfAt(z)*1.1;
    const endZ=Math.min(z1,z+.17+hash(i+1961)*.22);
    const endLane=center+bendAt(endZ)+(lane-cx)*.72;
    worldLine(r,[lane,z,.042],[endLane,endZ,.044],i%2?'#c7d1c18a':'#d1d7c18e',
      Math.max(.5,r.width*.0012*point(r,lane,z).scale));
  }
}

function drawCascade(r,o,d) {
  const x=o.lane,z=d+o.depth*.30,h=o.height;
  // A shallow rock lip pinches the current into a short, uneven spill.
  for(let i=0;i<5;i++) {
    const lane=x-.46+i*.23+(hash(i+2801)-.5)*.08;
    const distance=z+(hash(i+2811)-.5)*.15;
    drawStreamStone(r,lane,distance,.16+hash(i+2821)*.09,.18+hash(i+2831)*.10,
      i+61,.07+hash(i+2841)*.09);
  }
  const left=x-.24,right=x+.22;
  roundedWorldPolygon(r,[[left,z-.11,.18],[x-.08,z-.09,.16],[x+.02,z-.03,.14],
    [right,z+.02,.12],[x+.12,z+.11,.075],[x-.04,z+.13,.07]],'#78918a','#667d74',.35);
  for(let i=0;i<4;i++) {
    const lane=x-.13+i*.085;
    worldLine(r,[lane,z-.04,h*.28],[lane+(i%2?-.035:.025),z+.12,.08],
      i%2?'#d1d9c791':'#c2d1c391',Math.max(.5,r.width*.0013*point(r,lane,z).scale));
  }
}

function drawBridge(r,o,d) {
  const x=o.lane,width=o.width,depth=o.depth;
  // Four worn stepping stones form a shallow crossing without boards or rails.
  for(let i=0;i<4;i++) {
    const t=i/3-.5;
    const lane=x+t*width*.78+(hash(i+2901)-.5)*.07;
    const z=d+(hash(i+2911)-.5)*depth*.34;
    const rx=.17+hash(i+2921)*.075,rz=.22+hash(i+2931)*.09;
    drawStreamStone(r,lane,z,rx,rz,i+71,.08+hash(i+2941)*.045);
  }
}

function drawWithNatureArt(r,art,key,o,d,fallback) {
  if(typeof art?.drawProp==='function'&&art.drawProp(r,key,o,d)) return true;
  fallback();
  return false;
}

function drawObject(r,o,travel,timeMs,art=null) {
  const d=o.at-travel;
  const boundPoints=[];
  const elevation=Number.isFinite(o.elevation)?o.elevation:0;
  for(const lane of [o.lane-o.width/2,o.lane+o.width/2])
    for(const distance of [d-o.depth/2,d+o.depth/2])
      for(const offset of [elevation,elevation+o.height]) boundPoints.push(point(r,lane,distance,offset));
  const bounds={left:Math.min(...boundPoints.map(p=>p.x)),right:Math.max(...boundPoints.map(p=>p.x)),
    top:Math.min(...boundPoints.map(p=>p.y)),bottom:Math.max(...boundPoints.map(p=>p.y))};
  if(bounds.right<0||bounds.left>r.width||bounds.bottom<0||bounds.top>r.height) return null;
  if(d < NEAR-o.depth || d > FAR) return null;
  if(['stream','cascade','log-bridge'].includes(o.kind)&&d>7) return null;
  if(WILDLIFE_KINDS.has(o.kind)&&d>8) return null;
  const p=point(r,o.lane,d,elevation);
  const c=r.ctx;c.save();c.globalAlpha*=Math.min(1,Math.max(0,(FAR-d)/12));
  if(WILDLIFE_KINDS.has(o.kind))c.globalAlpha*=clamp((8-d)/1.5,0,1);
  switch(o.kind) {
    case 'pine': drawWithNatureArt(r,art,o.artKey??'treePine',o,d,()=>pine(r,o,d)); break;
    case 'moss-rock': drawWithNatureArt(r,art,'mossBoulder',o,d,()=>drawRock(r,o,d)); break;
    case 'stump': drawStump(r,o,d); break;
    case 'fallen-log': drawWithNatureArt(r,art,'fallenLog',o,d,()=>drawLog(r,o,d)); break;
    case 'entrance-sign': drawSign(r,o,d,false); break;
    case 'arrival-sign': drawSign(r,o,d,true); break;
    case 'trail-post': drawTrailPost(r,o,d); break;
    case 'fern': drawWithNatureArt(r,art,'fernClump',o,d,()=>drawFern(r,o,d,timeMs)); break;
    case 'shrub': drawWithNatureArt(r,art,'shrub',o,d,()=>drawShrub(r,o,d,timeMs)); break;
    case 'wildflowers': drawFlowers(r,o,d); break;
    case 'stream': drawStream(r,o,d,art); break;
    case 'cascade': drawCascade(r,o,d); break;
    case 'log-bridge': drawBridge(r,o,d); break;
    default:
      if(WILDLIFE_KINDS.has(o.kind)) drawMountainWildlife(r,o,d,timeMs,art);
  }
  c.restore();
  return Object.freeze({id:o.id,kind:o.kind,animal:WILDLIFE_KINDS.has(o.kind),lane:o.lane,at:o.at,distance:d,x:p.x,y:p.y,scale:p.scale,
    width:o.width,depth:o.depth,height:o.height,elevation,bounds});
}

export function drawMountainLandscape(renderer, travel, timeMs = 0, art = null) {
  renderer.motionTimeMs=timeMs;
  const backdrop=skyAndHorizon(renderer,timeMs);
  trailGround(renderer,travel,timeMs,art);
  drawDistantTreeLine(renderer.ctx,renderer.width,renderer.height,point(renderer,0,FAR).y,.55+backdrop.forest*.45);
  const landmarks=[];
  const visible=MOUNTAIN_WORLD.filter(o=>o.at-travel+o.depth/2>=NEAR&&o.at-travel<=FAR);
  const overlayKinds=new Set(['cascade','log-bridge']);
  const ordered=[...visible.filter(o=>o.kind==='stream'),
    ...visible.filter(o=>o.kind!=='stream'&&!overlayKinds.has(o.kind)&&o.id!=='stream-rock-b'),
    ...visible.filter(o=>overlayKinds.has(o.kind)||o.id==='stream-rock-b')];
  for(const o of ordered) {
    const result=drawObject(renderer,o,travel,timeMs,art);
    if(result)landmarks.push(result);
  }
  return Object.freeze(landmarks);
}

export class MountainScene {
  constructor() {
    this.stage='trailhead';
    this.camera='street-world-fixed';
    this.sceneryMode='world-mountain';
    this.landmarks=Object.freeze([]);
    this.art=new MountainNatureArt();
    this.ready=this.art.ready.then(()=>this);
  }

  get stats() {
    return Object.freeze({stage:this.stage,camera:this.camera,landmarks:this.landmarks,
      sceneryMode:this.sceneryMode,natureArt:this.art.stats,warningMarkers:Object.freeze([])});
  }

  draw(renderer,game,{timeMs=0}={}) {
    if(!Number.isFinite(renderer?.width)||!Number.isFinite(renderer?.height)||renderer.width<=0||renderer.height<=0) return;
    const activeMs=Math.max(0,Number.isFinite(game?.timeMs)?game.timeMs:Number.isFinite(timeMs)?timeMs:0);
    const travel=game && Number.isFinite(renderer.worldDistance?.(game))
      ?renderer.worldDistance(game):activeMs/1000*1.25;
    this.stage=mountainStageAt(activeMs);
    this.landmarks=drawMountainLandscape(renderer,travel,activeMs,this.art);
  }
}

function obstacleScale(renderer,scale) {
  // Obstacle paths are authored in 100px units; this maps one unit to one
  // projectStreet world lane unit at the renderer's current width and scale.
  return Math.max(.001,(Number.isFinite(scale)?scale:1)*Math.max(1,renderer.width)*.235/100);
}

function hazardShadow(renderer,x,y,s,width=28) {
  renderer.ellipse(x,y+Math.max(.8,s*2),width*s,Math.max(1,s*4.3),'#26352b6b');
}

function drawRootHazard(renderer,x,y,s) {
  const c=renderer.ctx;
  hazardShadow(renderer,x,y,s,25);
  c.save();c.translate(x,y);c.scale(s,s);
  // A low, three-pronged root has a broad contact patch and rising, tapered
  // forks, so its silhouette reads as a root rather than a generic lump.
  renderer.path([[-29,4],[-25,-2],[-13,-5],[-8,-17],[-4,-18],[0,-7],[8,-7],[17,-15],
    [21,-13],[16,-4],[28,-1],[30,4],[18,7],[-19,7]],'#5b4935','#39372d',1.5);
  renderer.path([[-24,1],[-13,-1],[-7,-12],[-5,-3],[2,-2],[16,-10],[11,-1],[24,1],
    [14,3],[-16,4]],'#85613d','#574631',.8);
  c.beginPath();c.moveTo(-19,1);c.quadraticCurveTo(-8,-2,-5,-12);c.moveTo(1,-2);c.quadraticCurveTo(9,-3,17,-10);
  c.strokeStyle='#c09a665e';c.lineWidth=1.1;c.stroke();
  renderer.path([[-4,-8],[2,-8],[4,-3],[-1,-2]],'#708151','#49513a',.55);
  renderer.ellipse(12,-3,3.5,1.4,'#82905b',null,-.35);
  c.restore();
}

function drawHazardRock(renderer,x,y,s) {
  const c=renderer.ctx;
  hazardShadow(renderer,x,y,s,25);
  c.save();c.translate(x,y);c.scale(s,s);
  c.beginPath();c.moveTo(-28,4);c.lineTo(-26,-5);c.lineTo(-19,-10);c.lineTo(-11,-9);
  c.lineTo(-5,-16);c.lineTo(8,-15);c.lineTo(14,-10);c.lineTo(23,-8);c.lineTo(29,-1);
  c.lineTo(25,5);c.lineTo(14,8);c.lineTo(-18,8);c.closePath();
  const gradient=c.createLinearGradient(-17,-15,15,8);
  gradient.addColorStop(0,'#89907b');gradient.addColorStop(.43,'#697461');gradient.addColorStop(1,'#4d5949');
  c.fillStyle=gradient;c.strokeStyle='#343d34';c.lineWidth=1.45;c.fill();c.stroke();
  renderer.path([[-11,-9],[-5,-16],[8,-15],[11,-7],[1,-4]],'#a2a08a','#68705e',.7);
  renderer.path([[11,-7],[23,-8],[29,-1],[22,3],[10,1]],'#566451','#424b40',.7);
  renderer.path([[-17,-4],[-8,-7],[-2,-3],[-5,1],[-18,2]],'#66755d','#4f604e',.6);
  c.beginPath();c.moveTo(7,-12);c.lineTo(10,-7);c.lineTo(7,-3);c.strokeStyle='#454e40';c.lineWidth=.8;c.stroke();
  renderer.ellipse(-12,-8,4.8,1.8,'#82925d',null,-.25);
  renderer.ellipse(15,-6,3.5,1.6,'#718256',null,.2);
  c.restore();
}

function drawHazardLog(renderer,x,y,s) {
  const c=renderer.ctx;
  hazardShadow(renderer,x,y,s,29);
  c.save();c.translate(x,y);c.scale(s,s);
  // Flat lower bark, rounded crown, dark end caps and visible cut rings make
  // the obstacle legible as a fallen timber at the same 56px footprint.
  c.beginPath();c.moveTo(-29,4);c.lineTo(-27,-3);c.lineTo(-19,-10);c.lineTo(19,-10);
  c.lineTo(27,-4);c.lineTo(29,4);c.closePath();
  const bark=c.createLinearGradient(0,-10,0,5);
  bark.addColorStop(0,'#b18758');bark.addColorStop(.46,'#805c3d');bark.addColorStop(1,'#59432f');
  c.fillStyle=bark;c.strokeStyle='#453629';c.lineWidth=1.4;c.fill();c.stroke();
  c.beginPath();c.moveTo(-26,-1);c.quadraticCurveTo(-9,-6,10,-3);c.quadraticCurveTo(21,-1,27,-3);
  c.moveTo(-24,2);c.quadraticCurveTo(-4,-1,16,1);c.strokeStyle='#d0a66b7d';c.lineWidth=1;c.stroke();
  for(const side of [-1,1]) {
    c.beginPath();c.ellipse(side*25,-2,4.3,5.3,0,0,Math.PI*2);c.fillStyle='#c19a66';c.fill();
    c.strokeStyle='#4b3929';c.lineWidth=1;c.stroke();
    c.beginPath();c.ellipse(side*25,-2,2.2,3.1,0,0,Math.PI*2);c.strokeStyle='#846344';c.lineWidth=.7;c.stroke();
    c.beginPath();c.moveTo(side*25,-4);c.lineTo(side*25,-.2);c.strokeStyle='#694e33';c.lineWidth=.55;c.stroke();
  }
  renderer.path([[-9,-8],[-5,-9],[2,-7],[-1,-5],[-8,-5]],'#6d8350','#526144',.5);
  c.restore();
}

function drawRollingStone(renderer,x,y,s,timeMs) {
  const c=renderer.ctx;
  hazardShadow(renderer,x,y,s,22);
  c.save();c.translate(x,y-19*s);
  const rotation=renderer.reducedMotion?0:(Number.isFinite(timeMs)?timeMs:0)/1000*2.25;
  c.rotate(rotation);c.scale(s,s);
  c.beginPath();c.moveTo(-26,-2);c.lineTo(-21,-15);c.lineTo(-7,-21);c.lineTo(11,-17);
  c.lineTo(25,-6);c.lineTo(27,2);c.lineTo(18,16);c.lineTo(2,21);c.lineTo(-17,15);c.lineTo(-26,5);c.closePath();
  const stone=c.createLinearGradient(-16,-16,16,16);
  stone.addColorStop(0,'#9b9a7f');stone.addColorStop(.48,'#717762');stone.addColorStop(1,'#485547');
  c.fillStyle=stone;c.strokeStyle='#343e35';c.lineWidth=1.4;c.fill();c.stroke();
  renderer.path([[-21,-11],[-7,-20],[8,-15],[2,-5],[-15,1]],'#aaa38a','#656957',.65);
  renderer.path([[2,-5],[11,-15],[24,-6],[18,10],[3,11]],'#626f58','#455144',.65);
  c.beginPath();c.moveTo(-14,4);c.lineTo(-8,12);c.lineTo(1,13);c.lineTo(6,7);
  c.strokeStyle='#4b5946';c.lineWidth=.9;c.stroke();
  renderer.ellipse(-13,-11,4.5,1.8,'#8c9962',null,-.3);
  c.restore();
}

/** Draw one mountain hazard at a projectStreet-projected ground anchor. */
export function drawMountainObstacle(renderer,obstacle,x,y,scale,timeMs=0) {
  if(!renderer?.ctx||!Number.isFinite(x)||!Number.isFinite(y)) return false;
  const s=obstacleScale(renderer,scale);
  if(renderer.mountainScene?.art?.drawObstacle(renderer,obstacle?.type,x,y,s,timeMs)){
    return true;
  }
  switch(obstacle?.type) {
    case 'root': drawRootHazard(renderer,x,y,s); return true;
    case 'rock': drawHazardRock(renderer,x,y,s); return true;
    case 'log': drawHazardLog(renderer,x,y,s); return true;
    case 'rollingStone': drawRollingStone(renderer,x,y,s,timeMs); return true;
    default: return false;
  }
}
