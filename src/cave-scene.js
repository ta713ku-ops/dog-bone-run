import { projectStreet } from './street-camera.js';
import { CaveArt, drawHangingStalactite } from './cave-art.js';
import { CaveTunnel, caveTunnelGeometry, caveRoofAtLane } from './cave-tunnel.js';

const NEAR = -.82;
const FAR = 52;
const ROAD_EDGE = 1.66;
const WALL_LANE = 3.15;
const OUTER_LANE = 6.2;
const TRAVEL_RATE = 1.45;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const mod = (n, m) => ((n % m) + m) % m;
const hash = n => mod(Math.sin(n * 127.1 + 311.7) * 43758.5453, 1);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function smoothNoise(worldZ, seed, spacing = 3.4) {
  const position = worldZ / spacing;
  const index = Math.floor(position);
  const mix = smooth(0, 1, position - index);
  const from = hash(index + seed) * 2 - 1;
  const to = hash(index + seed + 1) * 2 - 1;
  return from * (1 - mix) + to * mix;
}

const ZONES = Object.freeze([
  Object.freeze({ id: 'entrance', endMs: 6_000, ceiling: 4.0, wall: '#65594c', roof: '#292927', edge: '#776956', path: '#b3a07d', water: '#68766e' }),
  Object.freeze({ id: 'corridor', endMs: 14_000, ceiling: 3.1, wall: '#5b5a54', roof: '#282b2b', edge: '#66645b', path: '#b1a083', water: '#6f8280' }),
  Object.freeze({ id: 'batcavern', endMs: 23_000, ceiling: 4.9, wall: '#4c5150', roof: '#202627', edge: '#555a56', path: '#ae9c7b', water: '#657b7d' }),
  Object.freeze({ id: 'waterside', endMs: 30_000, ceiling: 3.8, wall: '#535857', roof: '#202729', edge: '#59635e', path: '#b8a881', water: '#66878a' }),
]);

const landmark = (id, kind, lane, at, width, depth, height, elevation = 0, extra = {}) =>
  Object.freeze({ id, kind, lane, at, width, depth, height, elevation, ...extra });

export function caveZoneAt(timeMs = 0) {
  const time = clamp(timeMs, 0, 30_000);
  return ZONES.find(zone => time < zone.endMs)?.id ?? 'waterside';
}

export function caveZoneWeights(timeMs = 0) {
  const time = clamp(timeMs, 0, 30_000);
  const transitions = [6_000, 14_000, 23_000];
  const first = smooth(transitions[0] - 420, transitions[0] + 420, time);
  const second = smooth(transitions[1] - 420, transitions[1] + 420, time);
  const third = smooth(transitions[2] - 420, transitions[2] + 420, time);
  return Object.freeze({ entrance: 1 - first, corridor: first * (1 - second),
    batcavern: second * (1 - third), waterside: third });
}

function buildWorld() {
  const world = [
    landmark('entrance-limestone-arch', 'stalagmite', -2.8, 5.2, 1.8, 1.0, 3.1),
    landmark('entrance-west-stalagmite', 'stalagmite', -2.52, 2.3, .72, .6, 1.38),
    landmark('entrance-east-flowstone', 'flowstone', 3.72, 6.2, 1.18, 1.05, 1.32),
    landmark('first-rill', 'water', -2.66, 7.8, 1.05, 4.4, .08),
    landmark('corridor-west-column', 'stalagmite', -2.65, 12.1, .8, .72, 2.15),
    landmark('corridor-east-hanging-curtain', 'stalactite', 2.72, 10.0, .92, .7, 1.7, 2.72),
    landmark('corridor-east-stone', 'caveRock', 3.42, 15.2, 1.26, .92, .86),
    landmark('corridor-west-curtain', 'stalactite', -2.48, 18.4, 1.04, .74, 1.94, 2.88),
    landmark('deep-roost-left', 'roost', -2.92, 24.0, 1.5, .42, .58, 4.2),
    landmark('deep-roost-right', 'roost', 2.96, 28.2, 1.35, .42, .5, 4.25),
    landmark('batcavern-west-spire', 'stalagmite', -3.5, 24.6, 1.3, 1.1, 3.2),
    landmark('batcavern-east-boulder', 'caveRock', 3.55, 20.8, 1.48, 1.04, 1.08),
    landmark('waterside-pool-west', 'water', -2.87, 35.2, 1.46, 6.1, .06),
    landmark('waterside-pool-east', 'water', 2.9, 40.8, 1.52, 7.2, .06),
    landmark('waterside-flowstone-left', 'flowstone', -3.5, 37.8, 1.22, 1.1, 1.42),
    landmark('waterside-shelf-right', 'caveRock', 3.6, 43.7, 1.28, .92, .82),
  ];

  // Strata are uneven, continuous wall shelves. Their positions are world
  // coordinates, so every band approaches and passes with the same camera.
  for (let i = 0; i < 24; i++) {
    const side = hash(i + 141) > .5 ? 1 : -1;
    const at = 1.3 + i * 1.92 + hash(i + 271) * 1.25;
    const lane = side * (3.45 + hash(i + 411) * 1.18);
    const height = .56 + hash(i + 511) * 2.9;
    world.push(landmark(`wall-shelf-${i}`, 'wall-shelf', lane, at,
      1.3 + hash(i + 611) * 1.6, .18 + hash(i + 711) * .22,
      height, .5 + hash(i + 811) * 2.4, { side, variant: i }));
  }

  // Small edge stones and thin ceiling drapes break up large surfaces without
  // entering the player's 1.66-lane clear path.
  for (let i = 0; i < 18; i++) {
    const side = hash(i + 991) > .5 ? 1 : -1;
    const at = 3.6 + i * 2.43 + hash(i + 1091) * 1.35;
    const lane = side * (2.18 + hash(i + 1191) * .56);
    world.push(landmark(`edge-stone-${i}`, i % 2 ? 'stalagmite' : 'caveRock', lane, at,
      .48 + hash(i + 1291) * .48, .46 + hash(i + 1391) * .38,
      .52 + hash(i + 1491) * 1.3));
  }
  for (let i = 0; i < 15; i++) {
    const side = hash(i + 1591) > .5 ? 1 : -1;
    const at = 8.4 + i * 2.7 + hash(i + 1691) * 1.15;
    const zoneTime = at / TRAVEL_RATE * 1_000;
    const ceiling = ceilingAtTime(zoneTime);
    world.push(landmark(`ceiling-drape-${i}`, 'stalactite', side * (1.92 + hash(i + 1791) * .54), at,
      .3 + hash(i + 1891) * .34, .32 + hash(i + 1991) * .28,
      .72 + hash(i + 2091) * 1.2, ceiling - (1.1 + hash(i + 2191) * 1.65), { variant: i }));
  }
  for (let i = 0; i < 16; i++) for (const side of [-1, 1]) {
    const at = 1.8 + i * 2.7 + hash(i + side + 2501) * 2.1;
    const lane = side * (3.05 + hash(i + side + 2601) * .48);
    const width = 1.55 + hash(i + side + 2701) * .72;
    world.push(landmark(`limestone-wall-mass-${side}-${i}`, i % 3 ? 'caveRock' : 'stalagmite',
      lane, at, width, .8, 1.7 + hash(i + side + 2801) * 1.2));
  }
  return Object.freeze(world.filter(object=>object.kind!=='wall-shelf').sort((a, b) => b.at - a.at));
}

function zoneAtTime(timeMs) {
  const weights = caveZoneWeights(timeMs);
  return weights;
}

function mixHex(a, b, t) {
  const amount = clamp(t, 0, 1);
  const parts = [0, 1, 2].map(i => Math.round(parseInt(a.slice(i * 2 + 1, i * 2 + 3), 16) * (1 - amount)
    + parseInt(b.slice(i * 2 + 1, i * 2 + 3), 16) * amount));
  return `#${parts.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function weightedColor(key, timeMs) {
  const weights = zoneAtTime(timeMs);
  const channel = [0, 1, 2].map(i => {
    let total = 0;
    for (const zone of ZONES) total += parseInt(zone[key].slice(i * 2 + 1, i * 2 + 3), 16) * weights[zone.id];
    return Math.round(total);
  });
  return `#${channel.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function ceilingAtTime(timeMs) {
  const weights = zoneAtTime(timeMs);
  return ZONES.reduce((sum, zone) => sum + zone.ceiling * weights[zone.id], 0);
}

function ceilingContour(worldZ, timeMs) {
  const base = ceilingAtTime(timeMs);
  const amplitude = caveZoneAt(timeMs) === 'corridor' ? .3 : .68;
  return base + smoothNoise(worldZ, 381, 4.8) * amplitude
    + Math.sin(worldZ * .47 + 1.2) * .13;
}

function wallLaneAt(worldZ, side) {
  return side * (WALL_LANE + smoothNoise(worldZ, 563, 3.8) * .72
    + Math.sin(worldZ * .71 + side) * .18);
}

function pathEdgeAt(worldZ, side) {
  return side * (ROAD_EDGE + smoothNoise(worldZ, 797, 2.65) * .105
    + Math.sin(worldZ * .92 + side) * .04);
}

function project(renderer, lane, distance, elevation = 0) {
  if (typeof renderer?.project === 'function') {
    const p = renderer.project(lane, distance);
    const unit = renderer.width * .235 * p.scale;
    return { ...p, y: p.y - elevation * unit };
  }
  const p = projectStreet(renderer?.width ?? 0, renderer?.height ?? 0,
    lane, distance, elevation, renderer?.trailBend ?? 0);
  return p;
}

function polygon(renderer, vertices, fill, stroke = null, lineWidth = .8) {
  const projected = vertices.map(([lane, distance, elevation = 0]) => {
    const p = project(renderer, lane, distance, elevation);
    return [p.x, p.y];
  });
  renderer.path(projected, fill, stroke, lineWidth);
  return projected;
}

function line(renderer, from, to, color, lineWidth = 1) {
  const a = project(renderer, from[0], from[1], from[2] ?? 0);
  const b = project(renderer, to[0], to[1], to[2] ?? 0);
  const ctx = renderer.ctx;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
  return [a, b];
}

function distanceTime(activeMs, distance) {
  return clamp(activeMs + distance / TRAVEL_RATE * 1_000, 0, 30_000);
}

function drawCaveBackdrop(renderer, activeMs, travel, art) {
  const { ctx, width, height } = renderer;
  const base = ctx.createLinearGradient?.(0, 0, 0, height);
  if (base) {
    base.addColorStop(0, '#15191b');
    base.addColorStop(.42, '#343638');
    base.addColorStop(1, '#68604f');
    ctx.fillStyle = base;
  } else ctx.fillStyle = '#373733';
  ctx.fillRect(0, 0, width, height);
  // The roof continues above the near clipping plane. Its closest rock
  // texture follows world travel so portrait views never expose a blank cap.
  const roofMaterial=art?.material?.(renderer,'wall');
  if(roofMaterial?.pattern?.setTransform){
    const unit=width*.235*project(renderer,0,NEAR).scale;
    const span=3.8;
    roofMaterial.pattern.setTransform({a:unit*span/roofMaterial.tile.width,b:0,c:0,d:unit*span/roofMaterial.tile.height,e:width*.5,f:-mod(travel,span)*unit});
    ctx.save();ctx.globalAlpha=.58;ctx.fillStyle=roofMaterial.pattern;ctx.fillRect(0,0,width,height);ctx.restore();
  }

  const entrance = 1 - smooth(5_000, 11_000, activeMs);
  if (entrance > .005 && ctx.createRadialGradient) {
    const light = ctx.createRadialGradient(width * .5, height * .25, 0, width * .5, height * .28, width * .72);
    light.addColorStop(0, `rgba(230,186,117,${.27 * entrance})`);
    light.addColorStop(.46, `rgba(192,151,95,${.1 * entrance})`);
    light.addColorStop(1, 'rgba(168,135,96,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, width, height);
  }

  // A low, warm reflection stays ahead of the dog at the entrance and avoids
  // the false impression that the lit opening itself is on the path.
  if (entrance > .01) {
    const focus = project(renderer, 0, 26).y;
    const glow = ctx.createRadialGradient?.(width * .5, focus, 2, width * .5, focus, width * .43);
    if (glow) {
      glow.addColorStop(0, `rgba(210,169,105,${.18 * entrance})`);
      glow.addColorStop(1, 'rgba(210,169,105,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }
  }
}

function drawTexturedPolygon(renderer, vertices, kind, distance, art, alpha = .22,
  { plane = 'floor', lane = 0, elevation = 0, travel = 0 } = {}) {
  const material = art?.material(renderer, kind);
  if (!material) return false;
  const ctx = renderer.ctx;
  const points = vertices.map(([worldLane, worldDistance, elevation = 0]) => {
    const p = project(renderer, worldLane, worldDistance, elevation);
    return [p.x, p.y];
  });
  const center = project(renderer, lane, distance, elevation);
  const width = material.tile.width, height = material.tile.height;
  const lanePixels = renderer.width * .235 * center.scale;
  const depthPixels = renderer.height * .52 * .65 * center.scale * center.scale;
  const worldZ = Math.max(0, travel + distance);
  const spanLane = 3.85, spanDepth = 5.8, spanWallHeight = 2.5;
  let a, b, c, d, phaseX, phaseY;
  if (plane === 'wall') {
    const zDx = -lane * renderer.width * .235 * .65 * center.scale ** 2;
    const zDy = -renderer.height * .52 * .65 * center.scale ** 2;
    a = zDx * spanDepth / width;
    b = zDy * spanDepth / width;
    c = 0;
    d = -lanePixels * spanWallHeight / height;
    phaseX = mod(worldZ, spanDepth) / spanDepth * width;
    phaseY = mod(elevation, spanWallHeight) / spanWallHeight * height;
  } else if (plane === 'roof') {
    const zDx = -lane * renderer.width * .235 * .65 * center.scale ** 2;
    const zDy = -renderer.height * .52 * .65 * center.scale ** 2;
    a = lanePixels * spanLane / width;
    b = 0;
    c = zDx * spanDepth / height;
    d = zDy * spanDepth / height;
    phaseX = mod(lane, spanLane) / spanLane * width;
    phaseY = mod(worldZ, spanDepth) / spanDepth * height;
  } else {
    a = lanePixels * spanLane / width;
    b = 0;
    c = 0;
    d = -depthPixels * spanDepth / height;
    phaseX = mod(lane, spanLane) / spanLane * width;
    phaseY = mod(worldZ, spanDepth) / spanDepth * height;
  }
  const transform = { a, b, c, d,
    e: center.x - a * phaseX - c * phaseY,
    f: center.y - b * phaseX - d * phaseY };
  if (typeof material.pattern.setTransform === 'function') material.pattern.setTransform(transform);
  ctx.save();
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = material.pattern;
  ctx.fillRect(0, 0, renderer.width, renderer.height);
  ctx.restore();
  return true;
}

function drawTunnelSurfaces(renderer, travel, activeMs, art) {
  const ctx = renderer.ctx;
  const { width, height } = renderer;
  const step = 2.65;
  const firstBand = Math.ceil((travel + FAR) / step);
  const lastBand = Math.ceil((travel + NEAR) / step);
  for (let band = firstBand; band >= lastBand; band--) {
    const worldFar = band * step;
    const worldNear = Math.max(travel + NEAR, worldFar - step);
    const far = worldFar - travel;
    const near = worldNear - travel;
    const midTime = distanceTime(activeMs, (far + near) * .5);
    const farTime = distanceTime(activeMs, far);
    const nearTime = distanceTime(activeMs, near);
    const safeWorldFar = Math.max(0, worldFar);
    const safeWorldNear = Math.max(0, worldNear);
    const hFar = ceilingContour(safeWorldFar, farTime);
    const hNear = ceilingContour(safeWorldNear, nearTime);
    const wall = weightedColor('wall', midTime);
    const roof = weightedColor('roof', midTime);
    const edge = weightedColor('edge', midTime);
    const path = weightedColor('path', midTime);
    const edgeBand = mixHex(edge, '#393b39', .2);

    const leftFar = wallLaneAt(safeWorldFar, -1), leftNear = wallLaneAt(safeWorldNear, -1);
    const rightFar = wallLaneAt(safeWorldFar, 1), rightNear = wallLaneAt(safeWorldNear, 1);
    const outerFar = OUTER_LANE + smoothNoise(safeWorldFar, 1193, 4.2) * .52;
    const outerNear = OUTER_LANE + smoothNoise(safeWorldNear, 1193, 4.2) * .52;
    const pathLeftFar = pathEdgeAt(safeWorldFar, -1), pathLeftNear = pathEdgeAt(safeWorldNear, -1);
    const pathRightFar = pathEdgeAt(safeWorldFar, 1), pathRightNear = pathEdgeAt(safeWorldNear, 1);
    const leftWall = [[leftFar, far, 0], [leftNear, near, 0],
      [leftNear, near, hNear], [leftFar, far, hFar]];
    const rightWall = [[rightFar, far, 0], [rightNear, near, 0],
      [rightNear, near, hNear], [rightFar, far, hFar]];
    const roofPlane = [[leftFar, far, hFar], [rightFar, far, hFar],
      [rightNear, near, hNear], [leftNear, near, hNear]];
    const leftShoulder = [[-outerFar, far, 0], [pathLeftFar, far, 0],
      [pathLeftNear, near, 0], [-outerNear, near, 0]];
    const rightShoulder = [[pathRightFar, far, 0], [outerFar, far, 0],
      [outerNear, near, 0], [pathRightNear, near, 0]];
    const pathPlane = [[pathLeftFar, far, 0], [pathRightFar, far, 0],
      [pathRightNear, near, 0], [pathLeftNear, near, 0]];
    polygon(renderer, leftWall, wall);
    drawTexturedPolygon(renderer, leftWall, 'wall', (near + far) * .5, art, .4,
      { plane: 'wall', lane: (leftFar + leftNear) * .5, elevation: 1.3, travel });
    polygon(renderer, rightWall, mixHex(wall, '#171c1d', .14));
    drawTexturedPolygon(renderer, rightWall, 'wall', (near + far) * .5, art, .4,
      { plane: 'wall', lane: (rightFar + rightNear) * .5, elevation: 1.3, travel });
    polygon(renderer, roofPlane, roof);
    drawTexturedPolygon(renderer, roofPlane, 'wall', (near + far) * .5, art, .22,
      { plane: 'roof', lane: 0, elevation: (hNear + hFar) * .5, travel });

    polygon(renderer, leftShoulder, edgeBand);

    polygon(renderer, rightShoulder, mixHex(edgeBand, '#343839', .2));

    polygon(renderer, pathPlane, path);

  }

  drawFloorMaterial(renderer,travel,art);
  drawBrokenPathEdges(renderer, travel, activeMs);
  return height;
}

function drawFloorMaterial(renderer,travel,art) {
  const material=art?.material?.(renderer,'path');
  if(!material?.pattern?.setTransform)return;
  const c=renderer.ctx,w=renderer.width,h=renderer.height,horizon=h*.28,groundHeight=h*.52;
  const span=5.8,step=2,top=Math.ceil(project(renderer,0,FAR).y);
  c.save();c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  for(let row=top;row<h;row+=step){
    const y=row+step/2,scale=(y-horizon)/groundHeight;
    if(scale<=0)continue;
    const distance=(1/scale-1)/.65,worldZ=Math.max(0,travel+distance);
    const pxX=w*.235*scale,pxZ=groundHeight*.65*scale*scale;
    material.pattern.setTransform({a:pxX*3.85/material.tile.width,b:0,c:0,d:-pxZ*span/material.tile.height,e:w*.5,f:y+mod(worldZ,span)*pxZ});
    const left=Math.max(0,w*.5+pathEdgeAt(worldZ,-1)*pxX),right=Math.min(w,w*.5+pathEdgeAt(worldZ,1)*pxX);
    c.fillStyle=material.pattern;c.globalAlpha=.46;c.fillRect(left,row,Math.max(0,right-left),step);
    c.globalAlpha=.22;
    const wallLeft=Math.max(0,w*.5+wallLaneAt(worldZ,-1)*pxX),wallRight=Math.min(w,w*.5+wallLaneAt(worldZ,1)*pxX);
    c.fillRect(wallLeft,row,Math.max(0,left-wallLeft),step);c.fillRect(right,row,Math.max(0,wallRight-right),step);
  }
  c.restore();
}

function drawBrokenPathEdges(renderer, travel, timeMs) {
  const first = Math.floor(travel / .82) - 1;
  const last = Math.ceil((travel + FAR) / .82) + 1;
  for (let index = first; index <= last; index++) {
    const worldZ = index * .82 + .4;
    const distance = worldZ - travel;
    if (distance < NEAR || distance > FAR) continue;
    const alpha = clamp((FAR - distance) / 8, 0, 1);
    const width = .035 + hash(index + 1311) * .095;
    const length = .2 + hash(index + 1411) * .42;
    for (const side of [-1, 1]) {
      const edgeA = pathEdgeAt(worldZ, side);
      const edgeB = pathEdgeAt(worldZ + length, side);
      const lipColor = mixHex(weightedColor('path', distanceTime(timeMs, distance)), '#393a36', .48);
      renderer.ctx.save();
      renderer.ctx.globalAlpha *= .12 + alpha * .25;
      polygon(renderer, [[edgeA, distance + .12, 0], [edgeA + side * width, distance + .08, .018],
        [edgeB + side * width * .68, distance + length, .012], [edgeB, distance + length + .03, 0]], lipColor);
      if (index % 3 === 0) {
        line(renderer, [edgeA + side * .055, distance + .19, .025],
          [edgeB + side * .04, distance + length * .8, .025], 'rgba(225,207,168,.4)',
          Math.max(.35, renderer.width * .0012 * project(renderer, edgeA, distance).scale));
      }
      renderer.ctx.restore();
    }
  }
}

function drawStrata(renderer, travel, activeMs) {
  const ctx = renderer.ctx;
  const first = Math.floor(travel / 2.15) - 1;
  const last = Math.ceil((travel + FAR) / 2.15) + 1;
  for (let row = first; row <= last; row++) {
    const worldZ = 1.6 + row * 2.15;
    const distance = worldZ - travel;
    if (distance < NEAR || distance > FAR) continue;
    const time = distanceTime(activeMs, distance);
    const fade = clamp((FAR - distance) / 8, 0, 1);
    const detailAlpha = .12 + .16 * fade;
    const color = weightedColor('wall', time);
    const seam = mixHex(color, '#c9bda2', .35);
    const crack = mixHex(color, '#151a1b', .56);
    for (const side of [-1, 1]) {
      const laneA = wallLaneAt(worldZ, side);
      const laneB = wallLaneAt(worldZ + 1.9, side);
      const low = .55 + hash(row * 3 + side * 13 + 211) * 3.7;
      const length = .64 + hash(row * 3 + side * 31 + 311) * 1.9;
      ctx.save();
      ctx.globalAlpha *= detailAlpha * (.72 + hash(row * 7 + side + 411) * .55);
      line(renderer, [laneA, distance + .08, low],
        [laneA + side * .04, distance + .26, low + .1 + hash(row + 711) * .14], seam,
        Math.max(.45, renderer.width * .0013));
      line(renderer, [laneA + side * .04, distance + .26, low + .1],
        [laneB, distance + length, low + .06], crack, Math.max(.35, renderer.width * .0011));
      if (row % 2 === 0) {
        const shelfHeight = .5 + hash(row + side * 41 + 811) * 3.3;
        const shelfDistance = distance + .35 + hash(row + side * 53 + 911) * .8;
        line(renderer, [wallLaneAt(worldZ + .15, side), shelfDistance, shelfHeight],
          [wallLaneAt(worldZ + 1.15, side), shelfDistance + .8, shelfHeight + .13],
          'rgba(218,205,177,.36)', Math.max(.55, renderer.width * .0019));
        line(renderer, [wallLaneAt(worldZ + .32, side), shelfDistance + .04, shelfHeight - .13],
          [wallLaneAt(worldZ + 1.08, side), shelfDistance + .83, shelfHeight - .04],
          'rgba(28,31,30,.57)', Math.max(.6, renderer.width * .0022));
      }
      ctx.restore();
    }
  }
}

function drawRoofRibs(renderer, travel, activeMs) {
  const ctx = renderer.ctx;
  for (let row = Math.floor(travel / 6.5) - 1; row < Math.ceil((travel + FAR) / 6.5); row++) {
    const worldZ = 4.3 + row * 6.5 + (hash(row + 1001) - .5) * 2.4;
    const distance = worldZ - travel;
    if (distance < NEAR || distance > FAR) continue;
    const time = distanceTime(activeMs, distance);
    const height = ceilingContour(worldZ, time);
    const fade = clamp((FAR - distance) / 7, 0, 1);
    const tone = weightedColor('wall', time);
    const dark = mixHex(tone, '#151b1c', .54);
    const pale = mixHex(tone, '#c7b596', .32);
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const theta = Math.PI * i / 24;
      const lane = Math.cos(theta) * (WALL_LANE + smoothNoise(worldZ, 563, 3.8) * .42);
      const roughness = smoothNoise(worldZ + i * .43, row + 1201, 1.3) * .2;
      const rise = Math.sin(theta) * (.12 + .27 * (1 - Math.abs(Math.cos(theta))));
      points.push(project(renderer, lane, distance, height - .12 + rise + roughness));
    }
    ctx.save();
    ctx.globalAlpha *= .3 + fade * .28;
    ctx.beginPath();
    points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(.8, renderer.width * .0035 * points[12].scale);
    ctx.lineCap = 'round';
    ctx.stroke();
    // A broken, thinner mineral edge catches just enough warm light to reveal
    // the arched ceiling without turning it into a row of structural beams.
    ctx.beginPath();
    points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y - Math.max(.3, renderer.width * .0014 * p.scale)) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = pale;
    ctx.lineWidth = Math.max(.45, renderer.width * .0017 * points[12].scale);
    ctx.stroke();
    ctx.restore();
  }
}

function drawArch(renderer, object, distance) {
  const ctx = renderer.ctx;
  const centerLane = object.lane;
  const half = object.width * .5;
  const archHeight = object.height;
  const outer = [], inner = [];
  for (let i = 0; i <= 16; i++) {
    const theta = Math.PI * i / 16;
    outer.push([centerLane + Math.cos(theta) * half,
      distance - object.depth * .5, .1 + Math.sin(theta) * archHeight]);
  }
  for (let i = 16; i >= 0; i--) {
    const theta = Math.PI * i / 16;
    inner.push([centerLane + Math.cos(theta) * Math.max(.1, half - .42),
      distance - object.depth * .5, .1 + Math.sin(theta) * (archHeight - .72)]);
  }
  polygon(renderer, [...outer, ...inner], '#51483e', '#a48d68', Math.max(.7, renderer.width * .002));
  // Distinct, irregular blocks give the entrance a worked-over limestone rim.
  for (let i = 0; i < 7; i++) {
    const theta = Math.PI * (i + .5) / 7;
    const lane = centerLane + Math.cos(theta) * (half - .18);
    const elev = .1 + Math.sin(theta) * (archHeight - .38);
    const p = project(renderer, lane, distance - object.depth * .5, elev);
    const size = renderer.width * .235 * p.scale;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size * (.075 + hash(i + 31) * .025), size * .055, theta, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? '#78644c' : '#897456';
    ctx.fill();
    ctx.strokeStyle = 'rgba(43,42,38,.55)';
    ctx.lineWidth = Math.max(.4, size * .008);
    ctx.stroke();
  }
  return project(renderer, centerLane, distance, archHeight * .5);
}

function drawFlowstone(renderer, object, distance, timeMs) {
  const unit = renderer.width * .235 * project(renderer, object.lane, distance).scale;
  const a = object.width * .5;
  const h = object.height;
  polygon(renderer, [[object.lane - a, distance - object.depth * .5, 0],
    [object.lane + a, distance - object.depth * .5, 0],
    [object.lane + a * .8, distance + object.depth * .35, h * .32],
    [object.lane + a * .2, distance + object.depth * .5, h],
    [object.lane - a * .3, distance + object.depth * .3, h * .54],
    [object.lane - a, distance + object.depth * .5, h * .16]], '#685d4c', '#968368', .7);
  const p = project(renderer, object.lane - a * .18, distance + object.depth * .18, h * .73);
  renderer.ellipse(p.x, p.y, Math.max(.7, unit * .07), Math.max(.7, unit * .025),
    renderer.reducedMotion ? 'rgba(188,166,125,.32)' : `rgba(211,185,132,${.22 + .08 * Math.sin(timeMs / 700)})`);
}

function drawWater(renderer, object, distance, timeMs, art) {
  const points = [], count = 10;
  for (const side of [-1, 1]) {
    const indices = Array.from({length:count+1},(_,i)=>side < 0 ? i : count-i);
    for (const i of indices) {
      const z = distance - object.depth/2 + i/count*object.depth;
      const bank = object.width * (.43 + .13*hash(i + object.at*7 + side));
      points.push([object.lane + side*bank,z,.02]);
    }
  }
  polygon(renderer,points,'#45626070','#82988d66',.45);
  for (let i=0;i<5;i++) {
    const z=distance-object.depth*.4+i*object.depth*.2;
    const lane=object.lane+Math.sin(i+object.at)*object.width*.2;
    const ripple=renderer.reducedMotion?0:Math.sin(timeMs/830+i)*.035;
    line(renderer,[lane-.12,z,.035],[lane+.14+ripple,z+.12,.035],
      'rgba(206,218,198,.23)',Math.max(.35,renderer.width*.001));
    const side=i%2?-1:1;
    const rock={kind:'caveRock',lane:object.lane+side*object.width*.52,width:.25+hash(i+object.at)*.22,height:.24,elevation:0};
    art?.drawLandmark?.(renderer,rock,z,timeMs);
  }
}

function drawRoost(renderer, object, distance, timeMs, art) {
  const p = project(renderer, object.lane, distance, object.elevation);
  const unit = renderer.width * .235 * p.scale;
  const branch = '#302e2c';
  line(renderer, [object.lane - .55, distance, object.elevation + .16],
    [object.lane + .45, distance, object.elevation + .1], branch, Math.max(.6, unit * .02));
  for (let i = 0; i < 4; i++) {
    const lane = object.lane + (i - 1.5) * .23;
    const x = project(renderer, lane, distance, object.elevation).x;
    const y = project(renderer, lane, distance, object.elevation - .12 - hash(i + object.at) * .05).y;
    if (!art?.drawBat?.(renderer, { x, y, width: unit * .3, height: unit * .2,
      pose: 1, timeMs, alpha: .74 })) {
      renderer.ellipse(x, y, Math.max(.8, unit * .045), Math.max(1.1, unit * .075), '#332f2b');
    }
  }
}

function drawLandmark(renderer, object, travel, timeMs, art) {
  if (object.kind === 'stalactite' || object.kind === 'roost') {
    const roof = renderer.caveScene?.roofHeightAtLane?.(object.lane);
    if (Number.isFinite(roof)) object = { ...object, elevation: roof - (object.kind === 'roost' ? .25 : .05) };
  }
  const distance = object.at - travel;
  if (distance < NEAR - object.depth || distance > FAR) return null;
  const p = project(renderer, object.lane, distance, object.elevation);
  const unit = renderer.width * .235 * p.scale;
  const corners = [];
  for (const lane of [object.lane - object.width * .5, object.lane + object.width * .5])
    for (const z of [distance - object.depth * .5, distance + object.depth * .5])
      for (const elevation of [object.elevation, object.elevation + object.height])
        corners.push(project(renderer, lane, z, elevation));
  const bounds = Object.freeze({
    left: Math.min(...corners.map(point => point.x)), right: Math.max(...corners.map(point => point.x)),
    top: Math.min(...corners.map(point => point.y)), bottom: Math.max(...corners.map(point => point.y)),
  });
  if (bounds.right < 0 || bounds.left > renderer.width || bounds.bottom < 0 || bounds.top > renderer.height) return null;

  switch (object.kind) {
    case 'entrance-arch': drawArch(renderer, object, distance); break;
    case 'flowstone': drawFlowstone(renderer, object, distance, timeMs); break;
    case 'water': drawWater(renderer, object, distance, timeMs, art); break;
    case 'roost': drawRoost(renderer, object, distance, timeMs, art); break;
    case 'wall-shelf': {
      if (art?.drawLandmark?.(renderer,{...object,kind:'caveRock'},distance,timeMs)) break;
      const side = object.side ?? Math.sign(object.lane);
      const z1 = distance - object.depth * .5, z2 = distance + object.depth * .5;
      const y = object.elevation;
      polygon(renderer, [[object.lane, z1, y], [object.lane + side * object.width, z1, y + .12],
        [object.lane + side * object.width * .9, z2, y + object.height * .1], [object.lane, z2, y]],
      '#625a4e', '#897960', .55);
      break;
    }
    default:
      if (!art?.drawLandmark?.(renderer, object, distance, timeMs)) {
        const size = Math.max(.5, unit);
        renderer.ellipse(p.x, p.y, Math.max(1, object.width * size * .28), Math.max(1, object.height * size * .18),
          object.kind === 'stalactite' ? '#786d58' : '#655b4c');
      }
  }
  return Object.freeze({ id: object.id, kind: object.kind, lane: object.lane, at: object.at,
    elevation: object.elevation, depth: object.depth, width: object.width, height: object.height,
    distance, x: p.x, y: p.y, scale: p.scale, bounds });
}

function obstacleScale(renderer, scale) {
  return Math.max(.001, (Number.isFinite(scale) ? scale : 1) * Math.max(1, renderer.width) * .235 / 100);
}

function shadow(renderer, x, y, s, rx, ry, alpha = '70') {
  renderer.ellipse?.(x + 1.5 * s, y + 2.5 * s, rx * s, Math.max(.7, ry * s), `#1d2523${alpha}`);
}

function fallbackStalagmite(renderer, x, y, s) {
  shadow(renderer, x, y, s, 29, 4.7);
  const c = renderer.ctx;
  c.save(); c.translate(x, y); c.scale(s, s);
  renderer.path([[-30, 3], [-27, -2], [-21, -4], [-18, -13], [-14, -19], [-9, -26], [-7, -42],
    [-2, -55], [1, -63], [5, -54], [7, -39], [11, -32], [14, -20], [18, -15], [21, -7], [29, -3], [31, 3],
    [20, 7], [-19, 7]], '#6e6453', '#393a35', 1.5);
  renderer.path([[-23, -1], [-16, -5], [-12, -16], [-7, -23], [-4, -45], [0, -57], [2, -37], [7, -24],
    [14, -16], [18, -7], [27, -2], [14, 1], [-15, 3]], '#998363', '#73664f', .8);
  c.beginPath(); c.moveTo(-13, -9); c.quadraticCurveTo(-6, -16, -5, -37);
  c.moveTo(7, -18); c.quadraticCurveTo(12, -10, 16, -6);
  c.strokeStyle = 'rgba(202,184,146,.54)'; c.lineWidth = 1.2; c.stroke();
  renderer.path([[-3, -8], [2, -8], [4, -3], [-2, -3]], '#77807a', '#5b625c', .5);
  c.restore();
}

function fallbackStalactite(renderer, x, y, s) {
  drawHangingStalactite(renderer,x,y,s);
}

function fallbackCaveRock(renderer, x, y, s) {
  shadow(renderer, x, y, s, 31, 5.2);
  const c = renderer.ctx;
  c.save(); c.translate(x, y); c.scale(s, s);
  renderer.path([[-31, 3], [-29, -7], [-23, -15], [-16, -16], [-11, -25], [1, -27], [10, -21],
    [17, -17], [24, -11], [31, -3], [29, 4], [19, 8], [-20, 8]], '#625d50', '#383b37', 1.45);
  renderer.path([[-21, -9], [-15, -16], [-10, -23], [1, -24], [11, -17], [8, -10], [-5, -7]], '#9a8767', '#706852', .7);
  renderer.path([[3, -8], [11, -18], [18, -15], [27, -4], [20, 1], [8, 0]], '#56615d', '#414944', .6);
  c.beginPath(); c.moveTo(-8, -19); c.lineTo(-4, -11); c.lineTo(-7, -5);
  c.moveTo(12, -11); c.lineTo(9, -5); c.strokeStyle = 'rgba(45,49,45,.8)'; c.lineWidth = .9; c.stroke();
  c.restore();
}

function fallbackBat(renderer, x, y, s, timeMs) {
  const c = renderer.ctx;
  const phase = renderer.reducedMotion ? 1 : Math.floor(Math.max(0, timeMs) / 150) % 4;
  const angle = phase === 0 ? -.55 : phase === 1 ? 0 : phase === 2 ? .48 : 0;
  c.save(); c.translate(x, y - 108 * s); c.scale(s, s);
  c.save(); c.rotate(-angle);
  renderer.path([[-5, -2], [-14, -12], [-26, -26], [-41, -31], [-35, -19], [-48, -14],
    [-37, -8], [-39, 2], [-23, -2], [-11, 5], [-5, 8]], '#453d36', '#252b29', 1.05);
  c.restore();
  c.save(); c.scale(-1, 1); c.rotate(-angle);
  renderer.path([[-5, -2], [-14, -12], [-26, -26], [-41, -31], [-35, -19], [-48, -14],
    [-37, -8], [-39, 2], [-23, -2], [-11, 5], [-5, 8]], '#453d36', '#252b29', 1.05);
  c.restore();
  renderer.ellipse(0, 0, 22, 11, '#56483c', '#292b28');
  renderer.ellipse(-2.5, 2, 10, 5.5, '#a0815e');
  renderer.ellipse(-8.5, -2.5, 1.8, 1.8, '#bd724e');
  renderer.ellipse(8.5, -2.5, 1.8, 1.8, '#bd724e');
  c.restore();
}

/** Draw a cave obstacle at the projected ground anchor used by Renderer. */
export function drawCaveObstacle(renderer, obstacle, x, y, scale, timeMs = 0) {
  if (!renderer?.ctx || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const s = obstacleScale(renderer, scale);
  if (renderer.caveScene?.art?.drawObstacle(renderer, obstacle?.type, x, y, s, timeMs)) return true;
  switch (obstacle?.type) {
    case 'stalagmite': fallbackStalagmite(renderer, x, y, s); return true;
    case 'stalactite': fallbackStalactite(renderer, x, y, s); return true;
    case 'caveRock': fallbackCaveRock(renderer, x, y, s); return true;
    case 'bat': fallbackBat(renderer, x, y, s, timeMs); return true;
    default: return false;
  }
}

export const CAVE_WORLD = buildWorld();

/** World-coordinate cave with one projected path, wall planes, roof and props. */
export function drawCaveLandscape(renderer, travel, timeMs = 0, art = null) {
  renderer.motionTimeMs = timeMs;
  const tunnel=renderer.caveScene?.tunnel;
  if(!tunnel?.draw(renderer,travel,art)){
    drawCaveBackdrop(renderer,timeMs,travel,null);
    drawTunnelSurfaces(renderer,travel,timeMs,art);
  }
  const visible = CAVE_WORLD.filter(object => object.at - travel + object.depth * .5 >= NEAR
    && object.at - travel - object.depth * .5 <= FAR);
  const landmarks = [];
  for (const object of visible) {
    const result = drawLandmark(renderer, object, travel, timeMs, art);
    if (result) landmarks.push(result);
  }
  return Object.freeze(landmarks);
}

export class CaveScene {
  constructor(options = {}) {
    this.stage = 'entrance';
    this.camera = 'street-world-fixed';
    this.sceneryMode = 'world-ray-vault';
    this.tunnel = new CaveTunnel(options);
    this.landmarks = Object.freeze([]);
    this.art = new CaveArt(options);
    this.ready = this.art.ready.then(() => this);
  }

  get stats() {
    return Object.freeze({ stage: this.stage, camera: this.camera, landmarks: this.landmarks,
      sceneryMode: this.sceneryMode, caveArt: this.art.stats, tunnel: this.tunnel.stats });
  }

  prepare(renderer) {
    this.tunnel.prepare(renderer,this.art);
    return this;
  }

  draw(renderer, game, options = {}) {
    if (!Number.isFinite(renderer?.width) || !Number.isFinite(renderer?.height)
      || renderer.width <= 0 || renderer.height <= 0 || !renderer.ctx) return;
    const activeMs = clamp(Number.isFinite(game?.timeMs) ? game.timeMs
      : Number.isFinite(options.timeMs) ? options.timeMs : 0, 0, 30_000);
    const travel = game && Number.isFinite(renderer.worldDistance?.(game))
      ? renderer.worldDistance(game) : activeMs / 1_000 * TRAVEL_RATE;
    this.stage = caveZoneAt(activeMs);
    const geometry=caveTunnelGeometry(renderer.width,renderer.height);
    this.ceilingHeight = geometry.roof;
    this.roofHeightAtLane=lane=>caveRoofAtLane(geometry,lane);
    renderer.caveScene = this;
    this.landmarks = drawCaveLandscape(renderer, travel, activeMs, this.art);
    return this.landmarks;
  }
}
