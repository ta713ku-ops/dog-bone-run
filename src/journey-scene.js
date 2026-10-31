import {drawDistinctDiscovery} from './journey-discovery-art.js';
import { CONFIG } from './config.js';

const INK = '#59452f';
const GOLD = '#e7b85b';
const ROUTE_SCENES = Object.freeze({
  'street-1': Object.freeze({ variant: 'morning-arcade', features: Object.freeze(['shop-awnings', 'sunlit-signs']), light: 'warm-morning' }),
  'street-2': Object.freeze({ variant: 'riverside-return', features: Object.freeze(['riverbank', 'wooden-bridge', 'water-glints']), waterBody: 'river', light: 'late-afternoon' }),
  'street-3': Object.freeze({ variant: 'after-rain-alley', features: Object.freeze(['road-puddles', 'window-reflections', 'wet-asphalt']), weather: 'after-rain' }),
  'park-1': Object.freeze({ variant: 'sunlit-hill', features: Object.freeze(['rolling-meadow', 'hill-flowers']), light: 'sunlit' }),
  'park-2': Object.freeze({ variant: 'canopy-path', features: Object.freeze(['tree-canopy', 'dappled-shadows']), light: 'leaf-shade' }),
  'park-3': Object.freeze({ variant: 'pond-bank', features: Object.freeze(['pond', 'reeds', 'shore-ripples']), waterBody: 'pond' }),
  'mountain-1': Object.freeze({ variant: 'woodland-trail', features: Object.freeze(['trail-posts', 'trail-stones', 'fern-edge']) }),
  'mountain-2': Object.freeze({ variant: 'ridge-lookout', features: Object.freeze(['open-ridge', 'distant-valley', 'timber-rail']), light: 'open-sky' }),
  'mountain-3': Object.freeze({ variant: 'pinecone-woods', features: Object.freeze(['pinecones', 'fallen-needles', 'woodland-floor']) }),
  'cave-1': Object.freeze({ variant: 'daylit-entry', features: Object.freeze(['entrance-light-shaft', 'entry-rill']), light: 'daylight' }),
  'cave-2': Object.freeze({ variant: 'glowing-moss-grotto', features: Object.freeze(['moss-patches', 'green-wall-glow']), light: 'moss-glow' }),
  'cave-3': Object.freeze({ variant: 'crystal-gallery', features: Object.freeze(['crystal-clusters', 'faceted-wall-light']), light: 'crystal-glow' }),
});

export function getJourneySceneProfile(routeId) {
  const scene = ROUTE_SCENES[routeId]??ROUTE_SCENES[{'dusk-1':'street-2','dusk-2':'park-3','dusk-3':'mountain-2'}[routeId]];
  return scene ? Object.freeze({ routeId, ...scene }) : null;
}

function worldPoint(renderer, lane, distance, elevation = 0) {
  const point = renderer.project(lane, distance);
  return { ...point, y: point.y - elevation * renderer.width * .235 * point.scale };
}

function worldPolygon(renderer, vertices, fill, stroke = null, lineWidth = 1) {
  const points = vertices.map(([lane, distance, elevation = 0]) => worldPoint(renderer, lane, distance, elevation));
  renderer.path(points.map(point => [point.x, point.y]), fill, stroke, lineWidth);
  return points;
}

function worldLine(renderer, from, to, color, lineWidth = 1) {
  const a = worldPoint(renderer, from[0], from[1], from[2] ?? 0);
  const b = worldPoint(renderer, to[0], to[1], to[2] ?? 0);
  const ctx = renderer.ctx;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.stroke();
  return [a, b];
}

function worldEllipse(renderer, centerLane, centerDistance, radiusLane, radiusDepth, fill, stroke = null, count = 32) {
  const vertices = Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    return [centerLane + Math.cos(angle) * radiusLane, centerDistance + Math.sin(angle) * radiusDepth, 0];
  });
  return worldPolygon(renderer, vertices, fill, stroke, Math.max(.7, renderer.width / 500));
}

function visibleDistance(renderer, distance, margin = .8) {
  return distance >= -margin && distance <= 16;
}

function drawStorefront(renderer, lane, distance, variant) {
  if (!visibleDistance(renderer, distance, 1.2)) return false;
  const ctx = renderer.ctx;
  const point = worldPoint(renderer, lane, distance);
  const scale = Math.max(.16, Math.min(1.1, point.scale));
  const width = renderer.width * .074 * scale;
  const height = renderer.height * .055 * scale;
  const left = point.x - width / 2, base = point.y;
  // Small, grounded pavement signs belong to the existing street frontage.
  // Their scale leaves the original textured architecture unobstructed.
  ctx.save();
  renderer.ellipse(point.x,base+2*scale,width*.7,height*.12,'rgba(67,52,36,.16)');
  ctx.strokeStyle='#74583d';ctx.lineWidth=Math.max(.7,2*scale);
  ctx.beginPath();ctx.moveTo(left+width*.18,base-height);ctx.lineTo(left-width*.08,base);ctx.moveTo(left+width*.82,base-height);ctx.lineTo(left+width*1.08,base);ctx.stroke();
  ctx.fillStyle='#b38e62';ctx.fillRect(left,base-height,width,height*.8);
  ctx.strokeRect(left,base-height,width,height*.8);
  ctx.fillStyle=variant%2?'#597261':'#795b46';ctx.fillRect(left+width*.09,base-height*.92,width*.82,height*.56);
  ctx.strokeStyle='#efe5c4';ctx.lineWidth=Math.max(.6,scale);
  for(let line=0;line<3;line++){ctx.beginPath();ctx.moveTo(left+width*.22,base-height*(.8-line*.14));ctx.lineTo(left+width*(line%2?.68:.8),base-height*(.8-line*.14));ctx.stroke();}

  ctx.restore();
  return true;
}

function drawMorningArcade(renderer, game) {
  const speed = game.speed || 1;
  const currentDistance = renderer.worldDistance(game);
  let stores = 0;
  for (let index = 0; index < 8; index++) {
    const worldDistance = (2.2 + index * 3.65) * speed;
    const distance = worldDistance - currentDistance;
    for (const side of index % 2 ? [-1] : [-1, 1]) {
      stores += Number(drawStorefront(renderer, side * (2.45 + (index % 3) * .14), distance, index + Number(side > 0)));
    }
  }
  const { ctx, width, height } = renderer;
  ctx.save(); ctx.globalAlpha = .13;
  worldPolygon(renderer, [[-3.7, 10, 0], [-2.5, 10, 0], [-.65, .1, 0], [-1.35, .1, 0]], '#ffe3a9');
  worldPolygon(renderer, [[3.1, 12, 0], [4.1, 12, 0], [1.05, .1, 0], [.45, .1, 0]], '#fff0ce');
  ctx.restore();
  // A small morning glint stays in the sky and never covers the play lane.
  ctx.save(); ctx.globalAlpha = .45;
  renderer.ellipse(width * .83, height * .15, width * .055, width * .055, '#ffe2a5');
  ctx.restore();
  return stores > 0;
}

function drawWaterRibbon(renderer, currentDistance, { side = 1, innerLane = 1.92, outerLane = 7.2, far = 14 } = {}) {
  const inside = [], outside = [], bankPoints = [];
  for (let index = 0; index <= 24; index++) {
    const distance = far + (-.82 - far) * index / 24;
    const world = currentDistance + distance;
    const ripple = Math.sin(world * .27) * .10;
    const lane = side * (innerLane + ripple);
    inside.push([lane, distance, 0]);
    outside.push([side * (outerLane + ripple * 1.8), distance, 0]);
    bankPoints.push(worldPoint(renderer, lane, distance));
  }
  const water=renderer.ctx.createLinearGradient?.(0,renderer.height*.28,0,renderer.height);
  if(water){water.addColorStop(0,'#8eafb0');water.addColorStop(.45,'#69999e');water.addColorStop(1,'#467e88');}
  worldPolygon(renderer, [...inside, ...outside.reverse()], water??'#579ca2', '#477d83', Math.max(1, renderer.width / 360));
  const ctx = renderer.ctx;
  ctx.beginPath(); bankPoints.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = '#c7d3ad'; ctx.lineWidth = Math.max(.65, renderer.width / 560); ctx.stroke();
  const first = Math.floor((currentDistance - 1) / 2.4) * 2.4;
  for (let world = first; world <= currentDistance + far; world += 2.4) {
    const distance = world - currentDistance;
    if (!visibleDistance(renderer, distance)) continue;
    const lane = side * (2.14 + .18 * Math.sin(world * .41));
    worldLine(renderer, [lane, distance], [lane + side * .62, distance - .08], '#d9eece', Math.max(1, renderer.width / 380));
    worldLine(renderer, [lane + side * .36, distance + .13], [lane + side * .95, distance + .10], 'rgba(235,246,222,.72)', Math.max(.7, renderer.width / 500));
  }
}

function drawRiverside(renderer, game) {
  const currentDistance = renderer.worldDistance(game), speed = game.speed || 1;
  // The road follows an open water edge for the whole return walk.
  worldPolygon(renderer, [[1.68, 14, 0], [2.02, 14, 0], [2.02, -.82, 0], [1.68, -.82, 0]], '#c8b58b');
  drawWaterRibbon(renderer, currentDistance, { side: 1, innerLane: 2.02, outerLane: 7.2, far: 14 });
  const bridgeDistance = 16 * speed - currentDistance;
  if (visibleDistance(renderer, bridgeDistance, .5)) {
    worldPolygon(renderer, [[1.9, bridgeDistance - .18, .08], [5.9, bridgeDistance - .18, .08],
      [5.9, bridgeDistance + .18, .08], [1.9, bridgeDistance + .18, .08]], '#9b7653', '#624c36', Math.max(1, renderer.width / 410));
    worldLine(renderer, [2.0, bridgeDistance - .19, .42], [5.8, bridgeDistance - .19, .42], '#d9bf8f', Math.max(1.3, renderer.width / 210));
    worldLine(renderer, [2.0, bridgeDistance + .19, .42], [5.8, bridgeDistance + .19, .42], '#d9bf8f', Math.max(1.3, renderer.width / 210));
    for (const lane of [2.2, 3.35, 4.5, 5.65]) {
      worldLine(renderer, [lane, bridgeDistance - .19, .08], [lane, bridgeDistance - .19, .42], '#76583d', Math.max(1, renderer.width / 380));
    }
  }
  // Late-day light appears as short reflections in the river, not a full-scene tint.
  const glint = (16 * speed - currentDistance);
  if (visibleDistance(renderer, glint, 5)) {
    worldLine(renderer, [2.12, glint + 1.2], [2.8, glint + 1.2], '#ffe3a4', Math.max(1.2, renderer.width / 250));
    worldLine(renderer, [2.28, glint + .7], [2.64, glint + .7], '#f9d38c', Math.max(.9, renderer.width / 340));
  }
  return true;
}

function drawAfterRain(renderer, game) {
  const speed = game.speed || 1, currentDistance = renderer.worldDistance(game);
  const ctx = renderer.ctx;
  // Narrow reflected streaks keep the asphalt visibly damp while leaving its
  // existing material and lane markings readable.
  ctx.save(); ctx.globalAlpha = .34;
  worldPolygon(renderer, [[-1.52, 14, 0], [1.52, 14, 0], [1.52, -.82, 0], [-1.52, -.82, 0]], 'rgba(111,157,169,.12)');
  ctx.restore();
  for (let index = 0; index < 12; index++) {
    const worldDistance = (1.7 + index * 2.45) * speed;
    const distance = worldDistance - currentDistance;
    if (!visibleDistance(renderer, distance, .8)) continue;
    const lane = [-1.05, -.35, .54, 1.1][index % 4];
    const radiusLane = .23 + (index % 3) * .08;
    const radiusDepth = .18 + (index % 4) * .06;
    worldEllipse(renderer, lane, distance, radiusLane, radiusDepth, 'rgba(67,132,147,.48)', 'rgba(204,229,222,.68)', 24);
    worldLine(renderer, [lane - radiusLane * .45, distance - .025], [lane + radiusLane * .38, distance - .035],
      'rgba(255,239,199,.86)', Math.max(.8, renderer.width / 430));
  }
  // A few window-colored reflections catch in the wet lane after the rain.
  for (let index = 0; index < 6; index++) {
    const worldDistance = (4.2 + index * 4.1) * speed;
    const distance = worldDistance - currentDistance;
    if (!visibleDistance(renderer, distance, .8)) continue;
    worldLine(renderer, [-.8 + index * .28, distance], [-.38 + index * .28, distance - .04], '#f2c88c', Math.max(.85, renderer.width / 420));
  }
  return true;
}

function drawMeadowHill(renderer, side, currentDistance) {
  const inner = [], outer = [];
  for (let index = 0; index <= 24; index++) {
    const distance = 14 + (-.82 - 14) * index / 24;
    const world = currentDistance + distance;
    const contour = Math.max(0, Math.sin(world * .27 + side * 1.3)) * .34;
    inner.push([side * (1.72 + .06 * Math.sin(world * .42)), distance, contour]);
    outer.push([side * (5.4 + .25 * Math.sin(world * .18 + side)), distance, contour + .18]);
  }
  worldPolygon(renderer, [...inner, ...outer.reverse()], side < 0 ? '#a6bd83' : '#96b679', '#849d67', Math.max(.8, renderer.width / 480));
  return true;
}

function drawHillWalk(renderer, game) {
  const currentDistance = renderer.worldDistance(game);
  drawMeadowHill(renderer, -1, currentDistance);
  drawMeadowHill(renderer, 1, currentDistance);
  for (let index = 0; index < 12; index++) {
    const world = (1.8 + index * 2.15) * (game.speed || 1);
    const distance = world - currentDistance;
    if (!visibleDistance(renderer, distance)) continue;
    const side = index % 2 ? -1 : 1;
    const point = worldPoint(renderer, side * (1.95 + (index % 3) * .18), distance, .12);
    const scale = Math.max(.18, Math.min(1, point.scale));
    renderer.ellipse(point.x, point.y, 3.6 * scale, 2.6 * scale, index % 3 ? '#f0df9e' : '#e9a59a', '#82694a');
    renderer.ellipse(point.x + 4 * scale, point.y - 2 * scale, 2.6 * scale, 2.2 * scale, '#fff0c7');
  }
  return true;
}

function drawCanopyTree(renderer, side, distance, index) {
  const ctx = renderer.ctx;
  const base = worldPoint(renderer, side * (2.1 + (index % 2) * .28), distance);
  if (!visibleDistance(renderer, distance)) return false;
  const scale = Math.max(.16, Math.min(1.05, base.scale));
  const unit = renderer.width * .235 * scale;
  const trunkHeight = unit * (2.3 + (index % 3) * .15);
  ctx.save(); ctx.globalAlpha = Math.min(.9, .52 + base.scale * .45);
  ctx.strokeStyle = '#66513c'; ctx.lineWidth = Math.max(2, unit * .12);
  ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(base.x, base.y - trunkHeight); ctx.stroke();
  const crownY = base.y - trunkHeight;
  renderer.ellipse(base.x, crownY, unit * 1.15, unit * .64, index % 2 ? '#516f4a' : '#5d7c50', '#425f40');
  renderer.ellipse(base.x - side * unit * .45, crownY + unit * .11, unit * .72, unit * .46, '#74905a');
  renderer.ellipse(base.x + side * unit * .42, crownY + unit * .12, unit * .68, unit * .44, '#6b8954');
  ctx.restore();
  return true;
}

function drawCanopyPath(renderer, game) {
  const currentDistance = renderer.worldDistance(game), speed = game.speed || 1;
  let trees = 0;
  for (let index = 0; index < 10; index++) {
    const distance = (2 + index * 1.85) * speed - currentDistance;
    trees += Number(drawCanopyTree(renderer, index % 2 ? -1 : 1, distance, index));
  }
  for (let index = 0; index < 9; index++) {
    const distance = (1.4 + index * 2.5) * speed - currentDistance;
    if (!visibleDistance(renderer, distance)) continue;
    const lane = [-.95, -.45, .22, .78, 1.22][index % 5];
    worldEllipse(renderer, lane, distance, .21 + (index % 2) * .1, .13 + (index % 3) * .04,
      'rgba(46,67,45,.18)', null, 18);
  }
  return trees > 0;
}

function drawPond(renderer, game) {
  const speed = game.speed || 1;
  const currentDistance = renderer.worldDistance(game);
  const center = 16 * speed - currentDistance;
  if (center < -7 || center > 24) return false;
  worldEllipse(renderer, 3.45, center, 1.7, 6.1, '#c3b186', '#6c875d', 44);
  worldEllipse(renderer, 3.48, center, 1.48, 5.75, '#579ca2', '#467d80', 44);
  for (const offset of [-3.8, -1.1, 1.9, 4.2]) {
    const distance = center + offset;
    const lane = 2.35 + (offset > 0 ? .12 : 0);
    worldLine(renderer, [lane, distance], [lane + .55, distance - .06], 'rgba(229,245,219,.76)', Math.max(1, renderer.width / 360));
  }
  for (const offset of [-4.8, -2.1, .7, 3.4, 5.2]) {
    const distance = center + offset;
    if (!visibleDistance(renderer, distance)) continue;
    const side = offset % 2 ? -1 : 1;
    const base = worldPoint(renderer, side * 2.0, distance);
    const scale = Math.max(.15, Math.min(1, base.scale));
    const ctx = renderer.ctx;
    ctx.save(); ctx.strokeStyle = '#587d50'; ctx.lineWidth = Math.max(1, renderer.width / 450);
    for (let reed = 0; reed < 3; reed++) {
      const x = base.x + side * reed * 3.4 * scale;
      ctx.beginPath(); ctx.moveTo(x, base.y); ctx.quadraticCurveTo(x + side * 4 * scale, base.y - 10 * scale, x + side * 1.4 * scale, base.y - 23 * scale);
      ctx.stroke();
      renderer.ellipse(x + side * 1.4 * scale, base.y - 23 * scale, 2 * scale, 4 * scale, '#8ca36c', '#587d50');
    }
    ctx.restore();
  }
  return true;
}

function drawTrailPost(renderer, side, distance, index) {
  if (!visibleDistance(renderer, distance)) return false;
  const point = worldPoint(renderer, side * 1.94, distance);
  const scale = Math.max(.15, Math.min(1, point.scale));
  const unit = renderer.width * .235 * scale;
  const ctx = renderer.ctx;
  ctx.save();
  ctx.fillStyle = '#8b6946'; ctx.strokeStyle = '#553f2c'; ctx.lineWidth = Math.max(.75, scale);
  ctx.fillRect(point.x - unit * .10, point.y - unit * 1.25, unit * .2, unit * 1.25);
  ctx.strokeRect(point.x - unit * .10, point.y - unit * 1.25, unit * .2, unit * 1.25);
  ctx.fillStyle = index % 2 ? '#e8d6a4' : '#8fa86c';
  ctx.fillRect(point.x - unit * .26, point.y - unit * 1.03, unit * .52, unit * .21);
  ctx.strokeRect(point.x - unit * .26, point.y - unit * 1.03, unit * .52, unit * .21);
  ctx.restore();
  return true;
}

function drawWoodlandTrail(renderer, game) {
  const currentDistance = renderer.worldDistance(game), speed = game.speed || 1;
  for (let index = 0; index < 9; index++) {
    const distance = (1.4 + index * 3.5) * speed - currentDistance;
    drawTrailPost(renderer, index % 2 ? -1 : 1, distance, index);
    if (!visibleDistance(renderer, distance)) continue;
    const stoneLane = (index % 2 ? -1 : 1) * 1.74;
    worldEllipse(renderer, stoneLane, distance + .42, .12, .18, '#a99775', '#74684f', 14);
  }
  return true;
}

function drawRidgeBackdrop(renderer) {
  const { ctx, width, height } = renderer;
  ctx.save();
  ctx.globalAlpha = .62;
  ctx.beginPath(); ctx.moveTo(0, height * .36); ctx.lineTo(0, height * .30);
  ctx.quadraticCurveTo(width * .12, height * .22, width * .24, height * .29);
  ctx.quadraticCurveTo(width * .39, height * .34, width * .52, height * .23);
  ctx.quadraticCurveTo(width * .68, height * .14, width * .81, height * .26);
  ctx.quadraticCurveTo(width * .93, height * .32, width, height * .22);
  ctx.lineTo(width, height * .40); ctx.closePath(); ctx.fillStyle = '#879783'; ctx.fill();
  ctx.globalAlpha = .48;
  ctx.beginPath(); ctx.moveTo(0, height * .38); ctx.lineTo(0, height * .34);
  ctx.quadraticCurveTo(width * .19, height * .27, width * .31, height * .34);
  ctx.quadraticCurveTo(width * .51, height * .40, width * .66, height * .30);
  ctx.quadraticCurveTo(width * .83, height * .24, width, height * .33);
  ctx.lineTo(width, height * .43); ctx.closePath(); ctx.fillStyle = '#617b70'; ctx.fill();
  ctx.restore();
  return true;
}

function drawRidgeRail(renderer, game) {
  const currentDistance = renderer.worldDistance(game), speed = game.speed || 1;
  let posts = 0;
  for (let index = 0; index < 9; index++) {
    const distance = (1.2 + index * 3.1) * speed - currentDistance;
    if (!visibleDistance(renderer, distance)) continue;
    const side = index % 2 ? -1 : 1;
    const point = worldPoint(renderer, side * 1.94, distance);
    const scale = Math.max(.15, Math.min(1, point.scale));
    const unit = renderer.width * .235 * scale;
    const ctx = renderer.ctx;
    ctx.save(); ctx.strokeStyle = '#805e40'; ctx.lineWidth = Math.max(1, unit * .08);
    ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(point.x, point.y - unit * .8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(point.x - side * unit * .3, point.y - unit * .48);
    ctx.lineTo(point.x + side * unit * .30, point.y - unit * .48); ctx.stroke();
    ctx.restore();
    if (index > 0) {
      const previousDistance = (1.2 + (index - 1) * 3.1) * speed - currentDistance;
      const previousLane = (index - 1) % 2 ? -1.94 : 1.94;
      // Rails follow one side at a time, keeping the path edge open.
      if (Math.sign(previousLane) === side) {
        worldLine(renderer, [side * 1.94, previousDistance, .8], [side * 1.94, distance, .8], '#b08960', Math.max(1.2, unit * .075));
      }
    }
    posts++;
  }
  return posts > 0;
}

function drawRidgeLookout(renderer, game) {
  drawRidgeBackdrop(renderer);
  drawRidgeRail(renderer, game);
  const { ctx, width, height } = renderer;
  ctx.save(); ctx.globalAlpha = .72;
  renderer.ellipse(width * .78, height * .18, width * .035, width * .035, '#f4dfad');
  ctx.restore();
  return true;
}

function drawPinecone(renderer, lane, distance, index) {
  if (!visibleDistance(renderer, distance, .5)) return false;
  const point = worldPoint(renderer, lane, distance, .10);
  const scale = Math.max(.17, Math.min(1, point.scale));
  const ctx = renderer.ctx;
  ctx.save(); ctx.translate(point.x, point.y); ctx.scale(scale, scale);
  ctx.rotate(index % 2 ? -.18 : .16);
  renderer.ellipse(0, 0, 7.5, 12, '#936743', '#5f4832');
  for (let row = 0; row < 4; row++) {
    const y = -7 + row * 4;
    ctx.strokeStyle = row % 2 ? '#c19662' : '#6b4c31'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-5.5 + row * .55, y); ctx.lineTo(5.5 - row * .55, y); ctx.stroke();
  }
  ctx.strokeStyle = '#4b6b43'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-4, 7); ctx.quadraticCurveTo(-10, 1, -13, -1); ctx.stroke();
  renderer.ellipse(-11, -1, 4, 2, '#78935d', '#4b6b43', -.4);
  renderer.ellipse(-6, 5, 3.6, 1.8, '#78935d', '#4b6b43', .35);
  ctx.restore();
  return true;
}

function drawPineconeWoods(renderer, game) {
  const speed = game.speed || 1, currentDistance = renderer.worldDistance(game);
  for (let index = 0; index < 15; index++) {
    const world = (1.5 + index * 2.05) * speed;
    const distance = world - currentDistance;
    const lane = (index % 2 ? -1 : 1) * (1.78 + (index % 3) * .16);
    drawPinecone(renderer, lane, distance, index);
  }
  return true;
}

function drawCaveEntry(renderer, game) {
  const speed = game.speed || 1, currentDistance = renderer.worldDistance(game);
  const entrance = 9 * speed - currentDistance;
  if (visibleDistance(renderer, entrance, 1.4)) {
    worldPolygon(renderer, [[-1.5, entrance, .15], [1.5, entrance, .15],
      [.78, entrance - 7.2, 0], [-.78, entrance - 7.2, 0]], 'rgba(248,205,132,.18)');
    worldPolygon(renderer, [[-.85, entrance - .1, .14], [.85, entrance - .1, .14],
      [.42, entrance - 4.4, 0], [-.42, entrance - 4.4, 0]], 'rgba(255,237,190,.17)');
    const arch = worldPoint(renderer, 0, entrance);
    const scale = Math.max(.2, Math.min(1, arch.scale));
    renderer.ellipse(arch.x, arch.y, renderer.width * .18 * scale, renderer.height * .12 * scale, 'rgba(255,217,150,.13)');
  }
  drawWaterRibbon(renderer, currentDistance, { side: -1, innerLane: 1.87, outerLane: 4.7, far: 7.8 });
  return true;
}

function drawMossGrotto(renderer, game) {
  const speed = game.speed || 1, currentDistance = renderer.worldDistance(game);
  let patches = 0;
  for (let index = 0; index < 14; index++) {
    const distance = (1.1 + index * 2.05) * speed - currentDistance;
    if (!visibleDistance(renderer, distance)) continue;
    const side = index % 2 ? -1 : 1;
    const point = worldPoint(renderer, side * (1.78 + (index % 3) * .20), distance, .42 + (index % 2) * .2);
    const scale = Math.max(.15, Math.min(1, point.scale));
    renderer.ellipse(point.x, point.y, 16 * scale, 9 * scale, 'rgba(124,201,113,.22)');
    renderer.ellipse(point.x, point.y, 9 * scale, 5.5 * scale, '#537f52', '#315d46');
    renderer.ellipse(point.x - 2 * scale, point.y - 1.3 * scale, 3.2 * scale, 2 * scale, '#a7cf79');
    renderer.ellipse(point.x + 3.2 * scale, point.y + .8 * scale, 2.5 * scale, 1.7 * scale, '#7ebc74');
    patches++;
  }
  return patches > 0;
}

function drawCrystalCluster(renderer, lane, distance, variant) {
  if (!visibleDistance(renderer, distance)) return false;
  const point = worldPoint(renderer, lane, distance, .1);
  const scale = Math.max(.15, Math.min(1, point.scale));
  const ctx = renderer.ctx;
  ctx.save();
  renderer.ellipse(point.x, point.y - 5 * scale, 23 * scale, 26 * scale, 'rgba(142,188,220,.18)');
  const colors = variant % 2 ? ['#9ad4db', '#507da7', '#c6e5ea'] : ['#a8cce0', '#675d9b', '#d1e2f2'];
  const width = 12 * scale, height = 34 * scale;
  ctx.beginPath(); ctx.moveTo(point.x, point.y - height); ctx.lineTo(point.x + width * .55, point.y - height * .35);
  ctx.lineTo(point.x + width * .36, point.y + 2 * scale); ctx.lineTo(point.x - width * .32, point.y + 2 * scale);
  ctx.lineTo(point.x - width * .55, point.y - height * .45); ctx.closePath();
  ctx.fillStyle = colors[0]; ctx.strokeStyle = '#46617d'; ctx.lineWidth = Math.max(.8, scale); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(point.x, point.y - height); ctx.lineTo(point.x + width * .05, point.y - height * .1);
  ctx.lineTo(point.x - width * .32, point.y + 2 * scale); ctx.lineTo(point.x - width * .55, point.y - height * .45); ctx.closePath();
  ctx.fillStyle = colors[1]; ctx.fill();
  ctx.beginPath(); ctx.moveTo(point.x + width * .05, point.y - height * .78); ctx.lineTo(point.x + width * .42, point.y - height * .4);
  ctx.strokeStyle = colors[2]; ctx.lineWidth = Math.max(.9, scale * 1.4); ctx.stroke();
  ctx.restore();
  return true;
}

function drawCrystalGallery(renderer, game) {
  const speed = game.speed || 1, currentDistance = renderer.worldDistance(game);
  let clusters = 0;
  for (let index = 0; index < 10; index++) {
    const distance = (1.4 + index * 2.45) * speed - currentDistance;
    const side = index % 2 ? -1 : 1;
    clusters += Number(drawCrystalCluster(renderer, side * (1.83 + (index % 3) * .16), distance, index));
  }
  return clusters > 0;
}

function drawSparkle(ctx, x, y, size, color = GOLD) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * .26, y - size * .26);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + size * .26, y + size * .26);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * .26, y + size * .26);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - size * .26, y - size * .26);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function discoverySuffix(discovery) {
  return typeof discovery?.id === 'string' ? discovery.id.slice(discovery.id.lastIndexOf('-') + 1) : '';
}

function drawButterfly(renderer, ctx, line) {
  // Paired upper/lower wings and antennae stay legible at the encounter's
  // small in-world scale, unlike the side-on bird emblem used for other finds.
  renderer.ellipse(-8, -9, 7, 6, '#e7a75f', '#9a6549', -.45);
  renderer.ellipse(8, -9, 7, 6, '#e7a75f', '#9a6549', .45);
  renderer.ellipse(-7, 1, 5, 4, '#e8c779', '#9a6549', .45);
  renderer.ellipse(7, 1, 5, 4, '#e8c779', '#9a6549', -.45);
  ctx.fillStyle = '#f8e6b4';
  for (const x of [-9, 9]) renderer.ellipse(x, -9, 1.35, 1.35, '#f8e6b4');
  ctx.strokeStyle = '#59452f'; ctx.lineWidth = line;
  ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-1, -14); ctx.quadraticCurveTo(-5, -20, -7, -19); ctx.moveTo(1, -14); ctx.quadraticCurveTo(5, -20, 7, -19); ctx.stroke();
}

function drawDuck(renderer, ctx, line) {
  renderer.ellipse(-1, -2, 13, 8, '#e7c66f', '#957343');
  renderer.ellipse(7, -12, 6, 6, '#efd47d', '#957343');
  renderer.path([[12, -13], [21, -11], [13, -8]], '#d8874f', '#9d5d3e', line);
  renderer.ellipse(9, -14, 1.1, 1.1, '#3b3327');
  renderer.ellipse(-2, -4, 7, 4, '#f4df98', '#b18e4f', -.18);
  ctx.strokeStyle = '#987544'; ctx.lineWidth = line;
  ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(-8, 10); ctx.moveTo(1, 6); ctx.lineTo(2, 10); ctx.stroke();
  ctx.strokeStyle = '#f4fff5'; ctx.lineWidth = Math.max(.8, line * .7);
  ctx.beginPath(); ctx.moveTo(-16, 12); ctx.quadraticCurveTo(-8, 9, 0, 12); ctx.moveTo(4, 12); ctx.quadraticCurveTo(11, 9, 18, 12); ctx.stroke();
}

function drawDragonfly(renderer, ctx, line) {
  // A narrow segmented body with four long, crossed wings reads as a
  // dragonfly, while keeping its footprint within the marker silhouette.
  renderer.ellipse(0, -1, 2.2, 12, '#507b72', '#38584f');
  renderer.ellipse(0, -15, 3.2, 3.2, '#648c7d', '#38584f');
  renderer.ellipse(-8, -7, 8, 3, 'rgba(177,218,207,.92)', '#6d9a8c', -.28);
  renderer.ellipse(8, -7, 8, 3, 'rgba(177,218,207,.92)', '#6d9a8c', .28);
  renderer.ellipse(-7, -1, 7, 2.5, 'rgba(202,228,209,.92)', '#6d9a8c', .18);
  renderer.ellipse(7, -1, 7, 2.5, 'rgba(202,228,209,.92)', '#6d9a8c', -.18);
  ctx.strokeStyle = '#496d62'; ctx.lineWidth = line;
  ctx.beginPath(); ctx.moveTo(-1, -10); ctx.lineTo(-4, -14); ctx.moveTo(1, -10); ctx.lineTo(4, -14); ctx.stroke();
}

function drawBat(renderer, ctx, line) {
  // The scalloped wing edge is the identifying silhouette; two pointed ears
  // and a tiny resting body keep this gentle rather than menacing.
  renderer.path([[-16, -8], [-22, -17], [-20, -5], [-15, -1], [-9, -5], [-5, 0], [0, -4], [5, 0], [9, -5], [15, -1], [20, -5], [22, -17], [16, -8], [8, -11], [0, -9], [-8, -11]], '#574b58', '#3e3542', line);
  renderer.ellipse(0, -8, 7, 7, '#665768', '#3e3542');
  renderer.path([[-5, -12], [-4, -20], [0, -13], [4, -20], [5, -12]], '#665768', '#3e3542', line);
  renderer.ellipse(-2.6, -8, .85, .85, '#f0d68b');
  renderer.ellipse(2.6, -8, .85, .85, '#f0d68b');
}

function drawBench(ctx, line) {
  ctx.fillStyle = '#9d7046'; ctx.strokeStyle = '#65482f'; ctx.lineWidth = line;
  // Back slats and seat are deliberately horizontal, unlike the upright sign.
  for (const y of [-17, -12, -7]) {
    ctx.beginPath(); ctx.moveTo(-13, y); ctx.lineTo(13, y); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(14, -2); ctx.lineTo(12, 3); ctx.lineTo(-12, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, 3); ctx.lineTo(-11, 11); ctx.moveTo(9, 3); ctx.lineTo(11, 11); ctx.stroke();
}

function drawBridge(ctx, line) {
  ctx.strokeStyle = '#77583c'; ctx.lineWidth = line + .4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-19, 2); ctx.quadraticCurveTo(0, -1, 19, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-19, -10); ctx.quadraticCurveTo(0, -13, 19, -10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-17, -10); ctx.lineTo(-17, 1); ctx.moveTo(-7, -11); ctx.lineTo(-7, 1);
  ctx.moveTo(7, -11); ctx.lineTo(7, 1); ctx.moveTo(17, -10); ctx.lineTo(17, 1); ctx.stroke();
  ctx.strokeStyle = '#b38a5b'; ctx.lineWidth = line * 1.5;
  ctx.beginPath(); ctx.moveTo(-20, 4); ctx.quadraticCurveTo(0, 1, 20, 4); ctx.stroke();
}

function drawClover(renderer, ctx, line) {
  const leaves = [[-5, -12, -.55], [5, -12, .55], [-5, -3, .55], [5, -3, -.55]];
  for (const [x, y, angle] of leaves) renderer.ellipse(x, y, 6.3, 4.8, '#7da666', '#527a48', angle);
  renderer.ellipse(0, -7.5, 2, 2, '#c4d98e', '#527a48');
  ctx.strokeStyle = '#527a48'; ctx.lineWidth = line + .5;
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(2, 3, 0, 12); ctx.stroke();
}

function drawPineconeIcon(ctx, line) {
  ctx.fillStyle = '#a87443'; ctx.strokeStyle = '#704b32'; ctx.lineWidth = line;
  ctx.beginPath(); ctx.moveTo(0, -22); ctx.quadraticCurveTo(15, -8, 11, 6); ctx.quadraticCurveTo(0, 15, -11, 6); ctx.quadraticCurveTo(-15, -8, 0, -22); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (let row = 0; row < 4; row++) {
    const y = -13 + row * 5;
    const width = 4 + row * 1.7;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(side * width, y - 4, side * width * 1.2, y + 1); ctx.stroke();
    }
  }
  ctx.strokeStyle = '#6d7748'; ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(0, -25); ctx.stroke();
}

function drawAcorn(renderer, ctx, line) {
  renderer.ellipse(0, 1, 10, 12, '#b77943', '#744c30');
  renderer.ellipse(0, -7, 12, 5, '#856044', '#60462f');
  ctx.strokeStyle = '#684a31'; ctx.lineWidth = line;
  for (let x = -8; x <= 8; x += 4) {
    ctx.beginPath(); ctx.moveTo(x, -7); ctx.lineTo(x * .8, -10); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.quadraticCurveTo(2, -16, 6, -16); ctx.stroke();
}

function drawCrystal(renderer, kind, line) {
  if (kind === 'quartz') {
    renderer.path([[-15, 10], [-12, -13], [-7, -22], [-2, -13], [1, 10]], '#b8d8d4', '#587f7e', line);
    renderer.path([[-5, 10], [-3, -18], [2, -27], [8, -17], [9, 10]], '#d6ece2', '#587f7e', line);
    renderer.path([[6, 10], [9, -9], [14, -16], [18, -8], [17, 10]], '#9dc7c1', '#587f7e', line);
    renderer.path([[2, -26], [2, 9], [-3, 9], [-3, -17]], 'rgba(255,255,255,.58)');
    return;
  }
  // The cave-wall mineral has a rough host stone and one faceted pocket;
  // quartz instead gets a distinct cluster of pointed, prismatic crystals.
  renderer.path([[-19, 5], [-14, -5], [-8, -7], [-5, -16], [3, -12], [10, -19], [17, -8], [20, 5], [12, 12], [-12, 12]], '#877a66', '#5d5549', line);
  renderer.path([[-4, 7], [-2, -8], [3, -15], [8, -8], [10, 7]], '#b9d4d0', '#668b88', line);
  renderer.path([[3, -14], [3, 6], [-2, 6]], 'rgba(255,255,255,.68)');
}

export function drawDiscoverySilhouette(renderer, discovery, x, y, scale) {
  const ctx = renderer.ctx;
  const kind = discovery.kind;
  const suffix = discoverySuffix(discovery);
  const line = 1.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (drawDistinctDiscovery(renderer,discovery,line)) {
    // The route subject has its own original study.
  } else if (suffix === 'butterfly') {
    drawButterfly(renderer, ctx, line);
  } else if (suffix === 'duck') {
    drawDuck(renderer, ctx, line);
  } else if (suffix === 'dragonfly') {
    drawDragonfly(renderer, ctx, line);
  } else if (suffix === 'bat') {
    drawBat(renderer, ctx, line);
  } else if (suffix === 'bench') {
    drawBench(ctx, line);
  } else if (suffix === 'bridge') {
    drawBridge(ctx, line);
  } else if (suffix === 'clover') {
    drawClover(renderer, ctx, line);
  } else if (suffix === 'pinecone') {
    drawPineconeIcon(ctx, line);
  } else if (suffix === 'acorn') {
    drawAcorn(renderer, ctx, line);
  } else if (suffix === 'crystal' || suffix === 'quartz') {
    drawCrystal(renderer, suffix, line);
  } else if (kind === 'water') {
    renderer.ellipse(0, -2, 15, 7, '#86c8cf', '#4e8f97');
    ctx.strokeStyle = '#f6fffa'; ctx.lineWidth = line;
    for (const offset of [-7, 0, 7]) {
      ctx.beginPath(); ctx.moveTo(-8, offset - 3); ctx.quadraticCurveTo(0, offset + 2, 8, offset - 3); ctx.stroke();
    }
    renderer.ellipse(0, -23, 4, 7, '#b8edf0', '#5f9ea2');
  } else if (kind === 'plant') {
    ctx.strokeStyle = '#557d48'; ctx.lineWidth = line + .8;
    ctx.beginPath(); ctx.moveTo(0, 9); ctx.quadraticCurveTo(-2, -2, 0, -18); ctx.stroke();
    renderer.ellipse(-8, -7, 8, 4, '#83aa67', '#557d48', -.45);
    renderer.ellipse(8, -13, 8, 4, '#9cbd76', '#557d48', .5);
    renderer.ellipse(0, -21, 5, 5, '#f4d27a', '#ad7740');
  } else if (kind === 'animal') {
    renderer.ellipse(-1, -1, 14, 9, '#75634f', '#4b3c2e');
    renderer.ellipse(10, -10, 7, 7, '#86715b', '#4b3c2e');
    renderer.path([[15, -11], [23, -8], [15, -5]], '#d49c55', '#755735');
    renderer.ellipse(12, -12, 1.1, 1.1, '#2d261e');
    ctx.strokeStyle = '#4b3c2e'; ctx.lineWidth = line;
    ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-21, -5); ctx.stroke();
  } else if (kind === 'light') {
    renderer.ellipse(0, -2, 11, 11, '#ffe19b', '#b88339');
    renderer.ellipse(0, -2, 6, 6, '#fff4cb');
    ctx.strokeStyle = '#d6a34c'; ctx.lineWidth = line;
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 16, -2 + Math.sin(angle) * 16);
      ctx.lineTo(Math.cos(angle) * 21, -2 + Math.sin(angle) * 21);
      ctx.stroke();
    }
  } else if (kind === 'landmark') {
    ctx.strokeStyle = '#755635'; ctx.lineWidth = line + 1;
    ctx.beginPath(); ctx.moveTo(-10, 11); ctx.lineTo(-10, -17); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(13, -16); ctx.lineTo(8, -7); ctx.lineTo(-8, -7); ctx.closePath();
    ctx.fillStyle = '#d8a861'; ctx.fill(); ctx.stroke();
    renderer.ellipse(3, -12, 2, 2, '#fff2c6');
  } else if (kind === 'sound' || kind === 'scent') {
    renderer.ellipse(-10, 2, 4, 4, '#efe0b8', '#a88a58');
    renderer.ellipse(0, -7, 4, 4, '#f7ebce', '#a88a58');
    renderer.ellipse(10, -18, 4, 4, '#fff4d9', '#a88a58');
    ctx.strokeStyle = '#b79b69'; ctx.lineWidth = line;
    ctx.beginPath(); ctx.moveTo(-1, 2); ctx.bezierCurveTo(9, -2, -7, -10, 3, -15); ctx.stroke();
  } else if (kind === 'object') {
    renderer.path([[0, -26], [15, -6], [9, 11], [-9, 11], [-15, -6]], '#b9d4d0', '#5d7d7c', line);
    renderer.path([[0, -26], [0, 11], [-9, 11], [-15, -6]], '#e2f0db');
    ctx.strokeStyle = '#f4ffed'; ctx.lineWidth = line;
    ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(0, -18); ctx.lineTo(6, -5); ctx.stroke();
  } else {
    // Fine details and route-specific keepsakes use a clear, compact emblem.
    renderer.ellipse(0, 0, 14, 11, '#d9c59c', '#8d704b');
    ctx.strokeStyle = '#fff4d5'; ctx.lineWidth = line;
    ctx.beginPath(); ctx.arc(0, 0, 6, -.6, Math.PI * 1.15); ctx.stroke();
    drawSparkle(ctx, 0, -1, 3, '#fff5d8');
  }
  ctx.restore();
}

/** Paints the three small, lane-bound encounters in a journey course. */
export class JourneyScene {
  constructor() {
    this.inspection = null;
  }

  drawEnvironment(renderer, game) {
    const routeId = game?.journeyRouteId;
    if (!routeId) {
      this.inspection = null;
      renderer.journeySceneInspection = null;
      return null;
    }
    if (this.inspection?.routeId !== routeId) this.inspection = getJourneySceneProfile(routeId);
    if (!this.inspection) {
      renderer.journeySceneInspection = null;
      return null;
    }
    renderer.journeySceneInspection = this.inspection;
    const baseRouteId={'dusk-1':'street-2','dusk-2':'park-3','dusk-3':'mountain-2'}[routeId]??routeId;
    switch (baseRouteId) {
      case 'street-1': drawMorningArcade(renderer, game); break;
      case 'street-2': drawRiverside(renderer, game); break;
      case 'street-3': drawAfterRain(renderer, game); break;
      case 'park-1': drawHillWalk(renderer, game); break;
      case 'park-2': drawCanopyPath(renderer, game); break;
      case 'park-3': drawPond(renderer, game); break;
      case 'mountain-1': drawWoodlandTrail(renderer, game); break;
      case 'mountain-2': drawRidgeLookout(renderer, game); break;
      case 'mountain-3': drawPineconeWoods(renderer, game); break;
      case 'cave-1': drawCaveEntry(renderer, game); break;
      case 'cave-2': drawMossGrotto(renderer, game); break;
      case 'cave-3': drawCrystalGallery(renderer, game); break;
      default: return null;
    }
    if(routeId.startsWith('dusk-')) {
      const {ctx,width,height}=renderer;ctx.save();
      ctx.fillStyle=routeId==='dusk-1'?'rgba(164,100,73,.13)':'rgba(27,38,65,.46)';ctx.fillRect(0,0,width,height);
      const sky=ctx.createLinearGradient(0,0,0,height*.45);
      sky.addColorStop(0,routeId==='dusk-1'?'rgba(174,125,130,.9)':'rgba(38,49,77,.93)');
      sky.addColorStop(1,routeId==='dusk-1'?'rgba(246,181,125,0)':'rgba(75,79,105,0)');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height*.45);
      if(routeId==='dusk-1')renderer.ellipse(width*.74,height*.20,width*.055,width*.055,'#e4b27e');
      if(routeId==='dusk-2'){
        renderer.ellipse(width*.22,height*.17,width*.028,width*.028,'#d4d9bd');
        for(let i=0;i<16;i++){
          const phase=renderer.reducedMotion?0:game.timeMs/1700+i*1.6;
          const x=width*(.08+.84*((i*7%17)/17)),y=height*(.30+(i%5)*.062)+Math.sin(phase)*4;
          ctx.globalAlpha=.35+Math.sin(phase)*.15;renderer.ellipse(x,y,3,3,'#e4edac');renderer.ellipse(x,y,8,8,'#c5dc9520');
        }
      }
      if(routeId==='dusk-3')for(let i=0;i<28;i++){const x=width*((i*37%101)/101),y=height*(.055+(i*13%19)/100);renderer.ellipse(x,y,i%7?1:2,i%7?1:2,'#e2e4cb');}
      ctx.restore();
    }
    return this.inspection;
  }

  drawLaneCue(renderer, game) {
    const discovery = game.discoveries?.find(item => item.status === 'pending'
      && item.distance - renderer.worldDistance(game) > .08
      && item.distance - renderer.worldDistance(game) <= CONFIG.lookAhead);
    if (!discovery) return false;
    const distance = discovery.distance - renderer.worldDistance(game);
    const far = renderer.project(discovery.lane, distance);
    const near = renderer.project(discovery.lane, Math.min(distance, .58));
    const ctx = renderer.ctx;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(far.x, far.y + 2); ctx.lineTo(near.x, near.y + 2);
    ctx.strokeStyle = 'rgba(246, 211, 139, .30)';
    ctx.lineWidth = Math.max(2, 7 * Math.min(far.scale, 1));
    ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(far.x, far.y, Math.max(5, 11 * far.scale), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 245, 216, .78)'; ctx.lineWidth = Math.max(1.2, 2.2 * far.scale); ctx.stroke();
    ctx.restore();
    return true;
  }

  drawObservation(renderer,discovery,game) {
    const x=renderer.width*(game.lane<0?.73:.27),y=renderer.height*.44;
    const scale=Math.max(.65,renderer.width/390)*.95;
    renderer.ellipse(x,y+10*scale,24*scale,7*scale,'rgba(47,51,39,.13)');
    drawDiscoverySilhouette(renderer,discovery,x,y,scale);
  }

  drawEncounter(renderer, discovery, distance) {
    const point = renderer.project(discovery.lane, distance);
    const scale = Math.max(.3, Math.min(1.3, point.scale));
    const ctx = renderer.ctx;
    ctx.save();
    renderer.ellipse(point.x, point.y + 3 * scale, 20 * scale, 6 * scale, 'rgba(47, 51, 39, .15)');
    drawDiscoverySilhouette(renderer, discovery, point.x, point.y - 5 * scale, 1.18 * scale);

    // The one small sparkle makes this a discoverable place detail without
    // adding per-frame text measurement or a HUD panel.
    const cueX = point.x + 19 * scale, cueY = point.y - 34 * scale;
    renderer.ellipse(cueX, cueY, 8 * scale, 8 * scale, '#fff8e8', '#b98948');
    drawSparkle(ctx, cueX, cueY, 4 * scale, '#db9d37');
    ctx.restore();
    return { discoveryId: discovery.id, lane: discovery.lane, ...point };
  }
}
