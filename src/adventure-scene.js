import { CONFIG } from './config.js';

const STAGES = Object.freeze([
  Object.freeze({ index: 0, title: '花咲く小径' }),
  Object.freeze({ index: 1, title: '木漏れ日の森' }),
  Object.freeze({ index: 2, title: '小川のほとり' }),
]);

const PARK = Object.freeze({
  skyTop: '#ffe7cf', skyBottom: '#e7f0d2', farHill: '#cfdda9', nearHill: '#a7c88f',
  ground: '#b9d29a', road: '#ead8b4', shoulder: '#c7d39b', seam: '#b79d74',
});
const WOODLAND = Object.freeze({
  skyTop: '#f4e6d1', skyBottom: '#dfead0', farHill: '#c5d8ad', nearHill: '#a7c49a',
  ground: '#a9c590', road: '#d6cbb0', shoulder: '#b3c398', seam: '#a89a7a',
});
const CREEK = Object.freeze({
  skyTop: '#e8edda', skyBottom: '#d8ecdc', farHill: '#bad8c5', nearHill: '#99c4ad',
  ground: '#a9c99c', road: '#caa77a', shoulder: '#9dc7b1', seam: '#8b795e',
});

const ROAD_EDGE = 1.55;
const SHOULDER_EDGE = 1.76;
const LOOK_AHEAD = CONFIG.lookAhead;
const ROAD_NEAR = -.82;
const SCENERY_PERIOD = 4.65;

const PARK_TREE_DISTANCES = Object.freeze([.15, .88, 1.61, 2.34, 3.07, 3.8]);
const WOOD_TREE_DISTANCES = Object.freeze([.22, .75, 1.28, 1.81, 2.34, 2.87, 3.4, 3.93, 4.46]);
const CREEK_TREE_DISTANCES = Object.freeze([.64, 1.37, 2.1, 2.83, 3.56, 4.29]);
const FLOWER_DISTANCES = Object.freeze([.32, .98, 1.76, 2.51, 3.25]);
const SIGN_DISTANCES = Object.freeze([1.35, 3.55]);
const BENCH_DISTANCES = Object.freeze([.68, 3.12]);
const FAR_RIDGE = Object.freeze([
  [0, .105], [.08, .035], [.16, .065], [.24, -.020], [.32, .040], [.41, -.072],
  [.50, .018], [.59, -.035], [.68, .055], [.77, -.058], [.86, .025], [.94, -.018], [1, .075],
]);
const MIDDLE_RIDGE = Object.freeze([
  [0, .17], [.11, .105], [.21, .145], [.33, .082], [.44, .15], [.56, .09],
  [.68, .158], [.80, .098], [.91, .147], [1, .105],
]);
const NEAR_RIDGE = Object.freeze([
  [0, .22], [.13, .163], [.26, .19], [.39, .145], [.52, .216], [.67, .157], [.82, .20], [1, .155],
]);

function finiteTime(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(start, end, value) {
  const p = clamp01((value - start) / (end - start));
  return p * p * (3 - 2 * p);
}

function themeWeights(timeMs) {
  const forest = smoothstep(8_300, 11_700, timeMs);
  const creek = smoothstep(18_300, 21_700, timeMs);
  return { park: 1 - forest, woodland: forest * (1 - creek), creek };
}

function weightedColor(a, b, c, weights) {
  const colors = [a, b, c].map(color => Number.parseInt(color.slice(1), 16));
  const channel = shift => Math.round(
    ((colors[0] >> shift) & 255) * weights.park
    + ((colors[1] >> shift) & 255) * weights.woodland
    + ((colors[2] >> shift) & 255) * weights.creek,
  );
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function sceneDistance(renderer, game, menu) {
  if (menu) return 0;
  const distance = renderer.worldDistance(game);
  return Number.isFinite(distance) ? distance : finiteTime(game.timeMs) / 1000;
}

function scaleAt(renderer, projection) {
  return Math.max(.12, Math.min(renderer.width / 390, renderer.height / 680) * projection.scale);
}

function positiveModulo(value, period) {
  return ((value % period) + period) % period;
}

function repeatingDistance(anchor, scrollDistance, period = SCENERY_PERIOD, maxDistance = LOOK_AHEAD) {
  let distance = positiveModulo(anchor - positiveModulo(scrollDistance, period), period);
  if (distance > period - .82) distance -= period;
  return distance >= ROAD_NEAR && distance <= maxDistance ? distance : null;
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.scale);
}

function stableWorldId(kind, scrollDistance, distance, variant = '') {
  const worldPosition = Math.round((scrollDistance + distance) * 1_000);
  return `${kind}:${worldPosition}:${variant}`;
}

function roadDecorationAllowed(renderer, objectId, { near = false, essential = false } = {}) {
  return typeof renderer.shouldDrawRoadDecoration !== 'function'
    || renderer.shouldDrawRoadDecoration(objectId, { near, essential });
}

function boundsFromPoints(points, padding = 0) {
  const finite = points.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!finite.length) return null;
  return {
    left: Math.min(...finite.map(point => point.x)) - padding,
    top: Math.min(...finite.map(point => point.y)) - padding,
    right: Math.max(...finite.map(point => point.x)) + padding,
    bottom: Math.max(...finite.map(point => point.y)) + padding,
  };
}

function recordRoadUnit(renderer, objectId, category, bounds, alpha, lineId = null) {
  renderer.recordRoadDecoration?.({
    objectId, generation: renderer.roadGeneration ?? 0, category, bounds, alpha, lineId,
  });
}

function segment(ctx, from, to, color, width) {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return;
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
}

function projectedLine(renderer, lane, startDistance, endDistance, color, width, yOffset = 0) {
  const difference = Math.abs(startDistance - endDistance);
  const steps = Math.max(1, Math.ceil(difference / .17));
  let previous = renderer.project(lane, startDistance);
  if (!validPoint(previous)) return;
  previous = { x: previous.x, y: previous.y - yOffset * scaleAt(renderer, previous) };
  for (let i = 1; i <= steps; i++) {
    const distance = startDistance + (endDistance - startDistance) * i / steps;
    let current = renderer.project(lane, distance);
    if (!validPoint(current)) continue;
    current = { x: current.x, y: current.y - yOffset * scaleAt(renderer, current) };
    segment(renderer.ctx, previous, current, color, width);
    previous = current;
  }
}

function quad(renderer, leftNear, rightNear, rightFar, leftFar, fill) {
  if (![leftNear, rightNear, rightFar, leftFar].every(validPoint)) return;
  renderer.path(
    [[leftNear.x, leftNear.y], [rightNear.x, rightNear.y], [rightFar.x, rightFar.y], [leftFar.x, leftFar.y]],
    fill,
  );
}

function drawCloud(renderer, x, y, size) {
  const stroke = '#f1d3b3';
  renderer.ellipse(x - size * .40, y + size * .05, size * .37, size * .22, '#fff7e8', stroke);
  renderer.ellipse(x, y - size * .04, size * .46, size * .31, '#fffaf0', stroke);
  renderer.ellipse(x + size * .40, y + size * .05, size * .34, size * .22, '#fff7e8', stroke);
  renderer.ellipse(x, y + size * .16, size * .72, size * .18, '#fff7e8');
}

function drawClouds(renderer, horizon, timeSeconds, reducedMotion) {
  const w = renderer.width, h = renderer.height, unit = Math.min(w / 390, h / 680);
  const travel = reducedMotion ? 0 : timeSeconds * 8;
  for (let i = 0; i < 3; i++) {
    const size = (22 + (i % 2) * 7) * unit;
    const x = positiveModulo(w * (.12 + i * .38) + travel * (i % 2 ? 1 : .72), w + size * 2) - size;
    const y = Math.min(horizon * (.24 + (i % 3) * .10), h * .24);
    drawCloud(renderer, x, y, size);
  }
}

function drawRidge(renderer, horizon, profile, color, verticalScale = 1) {
  const c = renderer.ctx, w = renderer.width, h = renderer.height;
  c.beginPath(); c.moveTo(0, horizon + profile[0][1] * h * verticalScale);
  const tension = .86;
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[Math.max(0, i - 1)], p1 = profile[i];
    const p2 = profile[i + 1], p3 = profile[Math.min(profile.length - 1, i + 2)];
    const x1 = p1[0] * w, y1 = horizon + p1[1] * h * verticalScale;
    const x2 = p2[0] * w, y2 = horizon + p2[1] * h * verticalScale;
    const c1x = x1 + (p2[0] - p0[0]) * w * tension / 6;
    const c1y = y1 + (p2[1] - p0[1]) * h * verticalScale * tension / 6;
    const c2x = x2 - (p3[0] - p1[0]) * w * tension / 6;
    const c2y = y2 - (p3[1] - p1[1]) * h * verticalScale * tension / 6;
    c.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
  }
  c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fillStyle = color; c.fill();
}

function drawDistantHills(renderer, horizon, weights, menu) {
  const h = renderer.height, w = renderer.width;
  const far = weightedColor(PARK.farHill, WOODLAND.farHill, CREEK.farHill, weights);
  const middle = weightedColor('#c3d79f', '#b5ce9f', '#a9d0bb', weights);
  const near = weightedColor(PARK.nearHill, WOODLAND.nearHill, CREEK.nearHill, weights);
  const relief = menu ? .15 : 1;
  drawRidge(renderer, horizon, FAR_RIDGE, far, relief);
  drawRidge(renderer, horizon, MIDDLE_RIDGE, middle, relief);
  drawRidge(renderer, horizon, NEAR_RIDGE, near, relief);

  // Rounded distant crowns make a textured treeline instead of a flat silhouette.
  const unit = Math.min(w / 390, h / 680);
  for (let i = 0; i < 12; i++) {
    const x = w * (i + .5) / 12;
    const y = horizon + h * (.155 + (i % 3) * .012);
    const size = (7 + (i % 4) * 2) * unit;
    const color = i % 3 ? weightedColor('#99bd7f', '#88ad83', '#83b59b', weights)
      : weightedColor('#a7c788', '#789d76', '#95bea0', weights);
    renderer.ellipse(x, y, size * 1.55, size * .84, color);
    renderer.ellipse(x - size * .75, y + size * .22, size * .8, size * .55, color);
    renderer.ellipse(x + size * .7, y + size * .18, size * .85, size * .57, color);
    segment(renderer.ctx, { x, y: y + size * .52 }, { x, y: y + size * 1.12 }, '#8a9f6f', Math.max(.45, unit));
  }
}

function drawGround(renderer, horizon, weights) {
  const w = renderer.width, h = renderer.height;
  const ground = weightedColor('#bad49a', '#aec990', '#aecb9c', weights);
  renderer.path([
    [0, horizon + h * .205], [w * .13, horizon + h * .181], [w * .29, horizon + h * .218],
    [w * .45, horizon + h * .19], [w * .66, horizon + h * .225], [w * .83, horizon + h * .185],
    [w, horizon + h * .214], [w, h], [0, h],
  ], ground);
}

function drawSun(renderer, horizon, reducedMotion, timeSeconds) {
  const w = renderer.width, h = renderer.height, unit = Math.min(w / 390, h / 680);
  const pulse = reducedMotion ? 0 : Math.sin(timeSeconds * .35) * 1.3 * unit;
  const x = w * .84, y = Math.min(horizon * .45, h * .17), radius = 21 * unit + pulse;
  renderer.ellipse(x, y, radius * 1.42, radius * 1.42, '#fff1c566');
  renderer.ellipse(x, y, radius, radius, '#fff4c9', '#eccd8e');
  renderer.ellipse(x - radius * .22, y - radius * .28, radius * .30, radius * .15, '#fffaf0');
}

function drawTree(renderer, lane, distance, kind, timeSeconds, reducedMotion, variant = 0, objectId = null) {
  const p = renderer.project(lane, distance);
  if (!validPoint(p) || p.y < -renderer.height * .1 || p.y > renderer.height * 1.08) return;
  const s = scaleAt(renderer, p);
  if (s < .11) return;
  const c = renderer.ctx, alpha = c.globalAlpha;
  const sway = reducedMotion ? 0 : Math.sin(timeSeconds * .9 + variant * 1.7 + lane) * .035;
  c.save(); c.translate(p.x, p.y); c.rotate(sway);
  const trunk = kind === 'creek' ? '#9b704a' : '#9a6848';
  renderer.path([[-5 * s, 0], [-4 * s, -46 * s], [4 * s, -46 * s], [6 * s, 0]], trunk, '#76523b', Math.max(.55, s * 1.2));
  segment(c, { x: 0, y: -23 * s }, { x: -15 * s, y: -49 * s }, '#79543b', Math.max(.6, s * 1.3));
  segment(c, { x: 1 * s, y: -27 * s }, { x: 16 * s, y: -53 * s }, '#79543b', Math.max(.6, s * 1.3));

  if (kind === 'woodland') {
    const color = variant % 2 ? '#739968' : '#7fa171';
    for (let tier = 0; tier < 3; tier++) {
      const y = (-66 - tier * 20) * s;
      const spread = (31 - tier * 5) * s;
      renderer.path([
        [-spread, y + 17 * s], [-spread * .70, y + 2 * s], [-spread * .38, y - 5 * s],
        [-spread * .22, y - 13 * s], [0, y - 24 * s], [spread * .19, y - 13 * s],
        [spread * .42, y - 5 * s], [spread * .72, y + 2 * s], [spread, y + 17 * s],
      ], tier === 1 ? '#88aa76' : color, '#64855f', Math.max(.6, s * 1.15));
      segment(c, { x: 0, y: y + 8 * s }, { x: 0, y: y - 14 * s }, '#a9c68a', Math.max(.45, s));
    }
    renderer.ellipse(-10 * s, -77 * s, 12 * s, 9 * s, '#a5c48a');
  } else if (kind === 'creek') {
    const greens = ['#91b77d', '#9dc184', '#84ad77'];
    renderer.ellipse(-16 * s, -68 * s, 24 * s, 16 * s, greens[variant % 3], '#6e9363');
    renderer.ellipse(10 * s, -70 * s, 28 * s, 18 * s, '#a5c78d', '#6e9363');
    renderer.ellipse(0, -82 * s, 22 * s, 17 * s, '#92b980', '#6e9363');
    for (let i = -2; i <= 2; i++) {
      const startX = i * 9 * s, endX = startX + (i * 2 + 1) * 3 * s;
      segment(c, { x: startX, y: -74 * s }, { x: endX, y: -48 * s }, '#789b69', Math.max(.5, s * .8));
    }
    renderer.ellipse(-12 * s, -81 * s, 7 * s, 4 * s, '#c2d79b');
  } else {
    const greens = ['#86ad72', '#94b978', '#a1c381'];
    renderer.ellipse(-16 * s, -63 * s, 23 * s, 19 * s, greens[variant % 3], '#68875b');
    renderer.ellipse(10 * s, -71 * s, 25 * s, 22 * s, '#a1c47f', '#68875b');
    renderer.ellipse(-1 * s, -89 * s, 22 * s, 20 * s, '#92b976', '#68875b');
    renderer.ellipse(-23 * s, -66 * s, 8 * s, 7 * s, '#b6d08e');
    renderer.ellipse(12 * s, -84 * s, 8 * s, 6 * s, '#c1d995');
  }
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, 'road_landmark', {
    left: p.x - 54 * s, top: p.y - 118 * s, right: p.x + 54 * s, bottom: p.y + 5 * s,
  }, alpha);
}

function drawFlower(renderer, lane, distance, color, timeSeconds, reducedMotion, variant, objectId = null) {
  const p = renderer.project(lane, distance);
  if (!validPoint(p) || p.y < -20 || p.y > renderer.height + 25) return;
  const s = scaleAt(renderer, p) * (.48 + (variant % 3) * .08);
  const c = renderer.ctx, alpha = c.globalAlpha;
  c.save(); c.translate(p.x, p.y); c.rotate(reducedMotion ? 0 : Math.sin(timeSeconds * 1.5 + variant) * .045);
  renderer.flower(0, -4 * s, s, color);
  renderer.ellipse(-6 * s, 2 * s, 4 * s, 2 * s, '#78a56c', null, -.32);
  renderer.ellipse(6 * s, 3 * s, 4 * s, 2 * s, '#83ad6d', null, .32);
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, 'road_flower', {
    left: p.x - 10 * s, top: p.y - 11 * s, right: p.x + 10 * s, bottom: p.y + 6 * s,
  }, alpha);
}

function drawBench(renderer, lane, distance, objectId = null) {
  const p = renderer.project(lane, distance);
  if (!validPoint(p) || p.y < 0 || p.y > renderer.height + 20) return;
  const s = scaleAt(renderer, p), c = renderer.ctx, alpha = c.globalAlpha;
  c.save(); c.translate(p.x, p.y);
  renderer.path([[-18 * s, -19 * s], [18 * s, -19 * s], [18 * s, -8 * s], [-18 * s, -8 * s]], '#b87949', '#76533b', Math.max(.7, s * 1.2));
  renderer.path([[-20 * s, -8 * s], [20 * s, -8 * s], [18 * s, 0], [-18 * s, 0]], '#d49a5c', '#76533b', Math.max(.7, s * 1.2));
  segment(c, { x: -14 * s, y: -7 * s }, { x: -17 * s, y: 10 * s }, '#78563b', Math.max(.8, s * 1.6));
  segment(c, { x: 14 * s, y: -7 * s }, { x: 17 * s, y: 10 * s }, '#78563b', Math.max(.8, s * 1.6));
  segment(c, { x: -14 * s, y: -14 * s }, { x: 14 * s, y: -14 * s }, '#edbd7a', Math.max(.45, s * .8));
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, 'road_landmark', {
    left: p.x - 22 * s, top: p.y - 22 * s, right: p.x + 22 * s, bottom: p.y + 12 * s,
  }, alpha);
}

function drawSign(renderer, lane, distance, label, weight, objectId = null) {
  if (weight <= .015) return;
  const p = renderer.project(lane, distance);
  if (!validPoint(p) || p.y < 0 || p.y > renderer.height + 20) return;
  const s = scaleAt(renderer, p), c = renderer.ctx, alpha = c.globalAlpha * weight;
  c.save(); c.globalAlpha *= weight; c.translate(p.x, p.y);
  segment(c, { x: 0, y: 0 }, { x: 0, y: -45 * s }, '#8e6543', Math.max(.8, 2 * s));
  renderer.path([[-22 * s, -48 * s], [18 * s, -48 * s], [24 * s, -39 * s], [18 * s, -30 * s], [-22 * s, -30 * s]], '#f4dfac', '#77583c', Math.max(.65, 1.3 * s));
  c.fillStyle = '#654b32'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `900 ${Math.max(4, 12 * s)}px sans-serif`; c.fillText(label, -1 * s, -39 * s, 39 * s);
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, 'road_landmark', {
    left: p.x - 24 * s, top: p.y - 50 * s, right: p.x + 25 * s, bottom: p.y + 2 * s,
  }, alpha);
}

function drawFence(renderer, side, scrollDistance, timeSeconds, reducedMotion, weight, creek = false, maxDistance = LOOK_AHEAD, objectId = null) {
  if (weight <= .015) return;
  const c = renderer.ctx, posts = [];
  const offset = positiveModulo(scrollDistance, .72);
  for (let i = 0; i < 7; i++) {
    const distance = maxDistance - i * .72 - offset;
    if (distance < ROAD_NEAR || distance > maxDistance) continue;
    const p = renderer.project(side * 1.94, distance);
    if (!validPoint(p)) continue;
    posts.push({ p, s: scaleAt(renderer, p), distance });
  }
  if (posts.length < 2) return;
  const alpha = c.globalAlpha * weight;
  c.save(); c.globalAlpha *= weight;
  const wood = creek ? '#a67a50' : '#b88b59';
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    for (const height of [.22, .56]) {
      projectedLine(renderer, side * 1.94, a.distance, b.distance,
        creek ? '#c49766' : '#d0a270', Math.max(.65, a.s * 2.5), height * 30);
    }
  }
  for (const { p, s } of posts) {
    segment(c, { x: p.x, y: p.y }, { x: p.x, y: p.y - 31 * s }, wood, Math.max(.7, 2.3 * s));
    renderer.ellipse(p.x, p.y - 31 * s, 2.5 * s, 2 * s, '#d8ac76');
  }
  const leafSwing = reducedMotion ? 0 : Math.sin(timeSeconds + side) * 1.2;
  if (!creek) {
    const p = posts[Math.min(1, posts.length - 1)].p;
    renderer.ellipse(p.x + leafSwing, p.y - 43 * scaleAt(renderer, p), 8 * scaleAt(renderer, p), 4 * scaleAt(renderer, p), '#91b878');
  }
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, 'road_fence', boundsFromPoints(
    posts.flatMap(({ p, s }) => [{ x: p.x, y: p.y }, { x: p.x, y: p.y - (creek ? 36 : 49) * s }]),
    Math.max(1, ...posts.map(({ s }) => 2.5 * s)),
  ), alpha);
}

function drawGrassTuft(renderer, lane, distance, timeSeconds, reducedMotion, color = '#70965d', objectId = null, category = 'road_grass') {
  const p = renderer.project(lane, distance);
  if (!validPoint(p) || p.y < -10 || p.y > renderer.height + 10) return;
  const s = scaleAt(renderer, p), c = renderer.ctx, alpha = c.globalAlpha;
  const sway = reducedMotion ? 0 : Math.sin(timeSeconds * 1.8 + lane + distance) * 2.5 * s;
  c.save(); c.translate(p.x, p.y);
  for (let i = -1; i <= 1; i++) {
    segment(c, { x: i * 2 * s, y: 1 * s }, { x: i * 5 * s + sway, y: -10 * s - Math.abs(i) * 2 * s }, color, Math.max(.55, s * 1.15));
  }
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, category, {
    left: p.x - 8 * s, top: p.y - 14 * s, right: p.x + 8 * s, bottom: p.y + 3 * s,
  }, alpha);
}

function drawReeds(renderer, lane, distance, timeSeconds, reducedMotion, color = '#769d70', objectId = null) {
  const p = renderer.project(lane, distance);
  if (!validPoint(p) || p.y < -10 || p.y > renderer.height + 10) return;
  const s = scaleAt(renderer, p), c = renderer.ctx, alpha = c.globalAlpha;
  const sway = reducedMotion ? 0 : Math.sin(timeSeconds * 1.3 + distance) * 2 * s;
  c.save(); c.translate(p.x, p.y);
  for (let i = -1; i <= 1; i++) {
    const x = i * 4 * s;
    segment(c, { x, y: 0 }, { x: x + sway + i * 3 * s, y: -19 * s + Math.abs(i) * 4 * s }, color, Math.max(.55, s * 1.05));
    renderer.ellipse(x + sway + i * 3 * s, -20 * s + Math.abs(i) * 4 * s, 2 * s, 4 * s, i % 2 ? '#a68f5c' : '#b39b65');
  }
  c.restore();
  if (objectId) recordRoadUnit(renderer, objectId, 'road_grass', {
    left: p.x - 15 * s, top: p.y - 25 * s, right: p.x + 15 * s, bottom: p.y + 2 * s,
  }, alpha);
}

function drawButterfly(renderer, lane, distance, timeSeconds, reducedMotion, variant, objectId = null) {
  const base = renderer.project(lane, distance);
  if (!validPoint(base)) return;
  const s = Math.min(renderer.width / 390, renderer.height / 680) * Math.max(.24, base.scale);
  const phase = reducedMotion ? variant * 1.4 : timeSeconds * 2.1 + variant * 1.4;
  const flap = reducedMotion ? 1 : .72 + Math.abs(Math.sin(phase * 2.5)) * .48;
  const x = base.x + Math.sin(phase) * 4 * s;
  const y = base.y - 26 * s + Math.cos(phase * .7) * 3 * s;
  const color = variant % 2 ? '#f09a74' : '#f2c552';
  renderer.ellipse(x - 4 * s, y, 4.4 * s, 3 * s * flap, color, '#805a4a');
  renderer.ellipse(x + 4 * s, y, 4.4 * s, 3 * s * flap, color, '#805a4a');
  segment(renderer.ctx, { x, y: y - 2 * s }, { x, y: y + 4 * s }, '#684d3d', Math.max(.5, .8 * s));
  if (objectId) recordRoadUnit(renderer, objectId, 'road_landmark', {
    left: x - 9 * s, top: y - 4 * s, right: x + 9 * s, bottom: y + 5 * s,
  }, renderer.ctx.globalAlpha);
}

function drawCreekWater(renderer, scrollDistance, animationTime, reducedMotion, weight, maxDistance) {
  if (weight <= .015) return;
  const c = renderer.ctx;
  c.save(); c.globalAlpha *= weight;
  const rows = Math.ceil((maxDistance - ROAD_NEAR) / .36);
  for (const side of [-1, 1]) {
    for (let i = 0; i < rows; i++) {
      const farDistance = maxDistance - i * .36 - positiveModulo(scrollDistance, .36);
      const nearDistance = Math.max(ROAD_NEAR, farDistance - .38);
      if (farDistance < ROAD_NEAR || nearDistance >= farDistance) continue;
      const waviness = Math.sin(farDistance * 3.2 + side) * .045;
      const innerFar = renderer.project(side * (1.82 + waviness), farDistance);
      const outerFar = renderer.project(side * 2.58, farDistance);
      const innerNear = renderer.project(side * (1.82 - waviness), nearDistance);
      const outerNear = renderer.project(side * 2.62, nearDistance);
      quad(renderer, innerNear, outerNear, outerFar, innerFar, i % 2 ? '#8bc9c8' : '#83c2c7');
      const a = renderer.project(side * 1.88, farDistance - .04);
      const b = renderer.project(side * 2.48, nearDistance + .05);
      segment(c, a, b, '#d0e8cb', Math.max(.55, scaleAt(renderer, a) * 1.2));
    }
  }
  if (!reducedMotion) {
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const lane = side * (1.98 + (i % 3) * .13);
      const distance = .28 + ((i * .47 + animationTime * .72) % 2.8);
      const p = renderer.project(lane, distance);
      if (validPoint(p)) renderer.ellipse(p.x, p.y, 3.3 * scaleAt(renderer, p), .8 * scaleAt(renderer, p), '#eff8d6');
    }
  }
  c.restore();
}

function drawBoardwalkRails(renderer, scrollDistance, weight, maxDistance) {
  if (weight <= .015) return;
  const c = renderer.ctx;
  c.save(); c.globalAlpha *= weight;
  for (const side of [-1, 1]) {
    const a = renderer.project(side * 1.73, maxDistance), b = renderer.project(side * 1.73, ROAD_NEAR);
    const id = `boardwalk-rail:${side}`;
    const boundsPoints = [a, b];
    projectedLine(renderer, side * 1.73, maxDistance, ROAD_NEAR, '#a8784e', 2.3 * Math.min(renderer.width / 390, renderer.height / 680));
    const offset = positiveModulo(scrollDistance, .72);
    for (let i = 0; i < 7; i++) {
      const d = maxDistance - i * .72 - offset;
      if (d < ROAD_NEAR || d > maxDistance) continue;
      const p = renderer.project(side * 1.73, d);
      const s = scaleAt(renderer, p);
      segment(c, { x: p.x, y: p.y }, { x: p.x, y: p.y - 10 * s }, '#986b48', Math.max(.6, s * 1.5));
      boundsPoints.push(p, { x: p.x, y: p.y - 10 * s });
    }
    recordRoadUnit(renderer, id, 'road_fence', boundsFromPoints(
      boundsPoints, 2.3 * Math.min(renderer.width / 390, renderer.height / 680),
    ), c.globalAlpha);
  }
  c.restore();
}

function drawRoad(renderer, scrollDistance, menu, weights, maxDistance) {
  const roadColor = weightedColor(PARK.road, WOODLAND.road, CREEK.road, weights);
  const shoulderColor = weightedColor(PARK.shoulder, WOODLAND.shoulder, CREEK.shoulder, weights);
  const seamColor = weightedColor('#ddcba8', '#cfc5aa', '#c3a27b', weights);
  const textureColor = weightedColor('#c7b58f', '#beb396', '#bda27f', weights);
  const c = renderer.ctx;
  for (let farDistance = maxDistance; farDistance > ROAD_NEAR;) {
    const nearDistance = Math.max(ROAD_NEAR, farDistance - .34);
    for (const side of [-1, 1]) {
      const left = renderer.project(side * ROAD_EDGE, nearDistance);
      const right = renderer.project(side * SHOULDER_EDGE, nearDistance);
      const rightFar = renderer.project(side * SHOULDER_EDGE, farDistance);
      const leftFar = renderer.project(side * ROAD_EDGE, farDistance);
      quad(renderer, left, right, rightFar, leftFar, shoulderColor);
    }
    const left = renderer.project(-ROAD_EDGE, nearDistance), right = renderer.project(ROAD_EDGE, nearDistance);
    const rightFar = renderer.project(ROAD_EDGE, farDistance), leftFar = renderer.project(-ROAD_EDGE, farDistance);
    quad(renderer, left, right, rightFar, leftFar, roadColor);
    farDistance = nearDistance;
  }

  const edgeWidth = 1.25 * Math.min(renderer.width / 390, renderer.height / 680);
  projectedLine(renderer, -ROAD_EDGE, maxDistance, ROAD_NEAR, '#b09c78', edgeWidth);
  projectedLine(renderer, ROAD_EDGE, maxDistance, ROAD_NEAR, '#b09c78', edgeWidth);

  // The world-fixed cross seam is shared by every landscape. At 0.8 world
  // units it stays below both the two-line viewport cap and two crossings/s.
  if (renderer.roadComfortFlags?.crossLines !== false && renderer.roadDecoration !== 'minimal') {
    const spacing = .8, offset = menu ? 0 : positiveModulo(scrollDistance, spacing);
    c.save(); c.globalAlpha *= .24;
    for (let distance = -offset; distance <= maxDistance; distance += spacing) {
      const worldDistance = scrollDistance + distance;
      const index = Math.round(worldDistance / spacing);
      const lineId = `road-cross-${index}`;
      if (!roadDecorationAllowed(renderer, lineId)) continue;
      const left = renderer.project(-ROAD_EDGE, distance), right = renderer.project(ROAD_EDGE, distance);
      const center = renderer.project(0, distance);
      const width = Math.max(.55, .85 * scaleAt(renderer, center));
      const creekBoard = weights.creek > .45 && renderer.roadComfortFlags?.creekBoards !== false;
      segment(c, left, right, creekBoard ? '#c3a27b' : seamColor, width);
      recordRoadUnit(renderer, lineId, 'road_cross_line', boundsFromPoints([left, right], width / 2), c.globalAlpha, lineId);
    }
    c.restore();
  }

  // Two short lane guides preserve the three-lane reading with little texture.
  const guideSpacing = 2.4, guideOffset = menu ? 0 : positiveModulo(scrollDistance, guideSpacing);
  c.save(); c.globalAlpha *= .14;
  for (let distance = -guideOffset; distance <= maxDistance; distance += guideSpacing) {
    for (const lane of [-.5, .5]) {
      const id = stableWorldId('lane-guide', scrollDistance, distance, lane);
      if (!roadDecorationAllowed(renderer, id)) continue;
      const start = renderer.project(lane, distance + .04);
      const end = renderer.project(lane, Math.min(maxDistance, distance + .27));
      const width = Math.max(.45, .68 * scaleAt(renderer, start));
      segment(c, start, end, textureColor, width);
      recordRoadUnit(renderer, id, 'road_texture', boundsFromPoints([start, end], width / 2), c.globalAlpha);
    }
  }
  c.restore();

  // Small gravel clusters are fixed to the same world lattice as the path.
  if (weights.woodland > .01) {
    const spacing = 4.8, offset = menu ? 0 : positiveModulo(scrollDistance, spacing);
    c.save(); c.globalAlpha *= weights.woodland * .24;
    for (let distance = .9 - offset; distance <= maxDistance; distance += spacing) {
      const id = stableWorldId('gravel-cluster', scrollDistance, distance);
      if (!roadDecorationAllowed(renderer, id)) continue;
      const points = [-.44, 0, .39].map((lane, i) => renderer.project(lane + (i - 1) * .07, distance + i * .025));
      for (const p of points) {
        if (validPoint(p)) renderer.ellipse(p.x, p.y, .9 * scaleAt(renderer, p), .55 * scaleAt(renderer, p), '#eee3c6');
      }
      recordRoadUnit(renderer, id, 'road_texture', boundsFromPoints(points, 2), c.globalAlpha);
    }
    c.restore();
  }
}

function drawRoadsideDetails(renderer, scrollDistance, menu, weights, maxDistance) {
  const c = renderer.ctx;
  const stoneSpacing = 1.6, offset = menu ? 0 : positiveModulo(scrollDistance, stoneSpacing);
  const stoneColor = weightedColor('#c9ad7d', '#b7a883', '#b49b75', weights);
  c.save(); c.globalAlpha *= .86;
  for (let distance = -offset; distance <= maxDistance - .09; distance += stoneSpacing) {
    if (distance < .9) continue;
    const worldIndex = Math.round((scrollDistance + distance) / stoneSpacing);
    const side = worldIndex % 2 ? 1 : -1;
    const id = stableWorldId('road-stone', scrollDistance, distance, side);
    if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5 })) continue;
    const p = renderer.project(side * 1.66, distance);
    if (!validPoint(p)) continue;
    const s = scaleAt(renderer, p);
    renderer.ellipse(p.x, p.y + 1.1 * s, 2.3 * s, 1.15 * s, stoneColor, '#a48f6f');
    recordRoadUnit(renderer, id, 'road_stone', {
      left: p.x - 2.3 * s - 1, top: p.y + 1.1 * s - 1.15 * s - 1,
      right: p.x + 2.3 * s + 1, bottom: p.y + 1.1 * s + 1.15 * s + 1,
    }, c.globalAlpha);
  }
  c.restore();

  // Dappled light stays in the outer strips of the road, beyond the hazard lanes.
  if (weights.woodland > .015) {
    c.save(); c.globalAlpha *= weights.woodland * .18;
    const lightOffset = menu ? 0 : positiveModulo(scrollDistance, 1.66);
    for (let i = 0, distance = .24 - lightOffset; distance <= maxDistance; i++, distance += 1.66) {
      if (distance < .9) continue;
      const id = stableWorldId('dapple-pair', scrollDistance, distance, i);
      if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5 })) continue;
      const points = [];
      let padding = 1;
      for (const side of [-1, 1]) {
        const p = renderer.project(side * 1.455, distance);
        if (!validPoint(p)) continue;
        const s = scaleAt(renderer, p);
        renderer.ellipse(p.x, p.y, 4.2 * s, 2.5 * s, '#fff0c7');
        renderer.ellipse(p.x + side * 3.8 * s, p.y + 2 * s, 2.8 * s, 1.6 * s, '#fff4d7');
        points.push({ x: p.x, y: p.y }, { x: p.x + side * 7 * s, y: p.y + 2 * s });
        padding = Math.max(padding, 5 * s + 1);
      }
      recordRoadUnit(renderer, id, 'road_texture', boundsFromPoints(points, padding), c.globalAlpha);
    }
    c.restore();
  }
}

function drawScenery(renderer, weights, scrollDistance, animationTime, reducedMotion, maxDistance) {
  const c = renderer.ctx;
  const groups = [
    { weight: weights.park, kind: 'park', trees: PARK_TREE_DISTANCES },
    { weight: weights.woodland, kind: 'woodland', trees: WOOD_TREE_DISTANCES },
    { weight: weights.creek, kind: 'creek', trees: CREEK_TREE_DISTANCES },
  ];

  for (const group of groups) {
    if (group.weight <= .015) continue;
    c.save(); c.globalAlpha *= group.weight;
    for (let i = 0; i < group.trees.length; i++) {
      const distance = repeatingDistance(group.trees[i], scrollDistance, SCENERY_PERIOD, maxDistance);
      if (distance === null) continue;
      if (distance < .9) continue;
      for (const side of [-1, 1]) {
        const treeEdge = group.kind === 'woodland' ? 2.06 + (i % 3) * .11 : 2.42 + (i % 3) * .16;
        const lane = side * treeEdge;
        const objectId = stableWorldId(`tree-${group.kind}`, scrollDistance, distance, `${i}:${side}`);
        if (!roadDecorationAllowed(renderer, objectId, { near: distance < 1.5 })) continue;
        drawTree(renderer, lane, distance, group.kind, animationTime, reducedMotion, i + (side > 0 ? 2 : 0), objectId);
      }
    }
    c.restore();
  }

  for (let i = 0; i < FLOWER_DISTANCES.length; i++) {
    const distance = repeatingDistance(FLOWER_DISTANCES[i], scrollDistance, SCENERY_PERIOD, maxDistance);
    if (distance === null || distance < .9) continue;
    const side = i % 2 ? 1 : -1;
    const colors = ['#f6d777', '#f2a9a0', '#fff4d9', '#b8a3cf', '#eaa37c'];
    const bedLane = side * (1.97 + (i % 3) * .12);
    const bedId = stableWorldId('flower-bed', scrollDistance, distance, i);
    if (roadDecorationAllowed(renderer, bedId, { near: distance < 1.5 })) {
      const alpha = c.globalAlpha;
      const bedPoints = [];
      let bedPadding = 1;
      const bedFlowers = [[bedLane, distance, colors[i], i]];
      if (distance + .055 <= maxDistance) bedFlowers.push([
        bedLane + side * .14, distance + .055, colors[(i + 2) % colors.length], i + 2,
      ]);
      bedFlowers.push([bedLane + side * .27, distance - .045, colors[(i + 3) % colors.length], i + 3]);
      for (const [lane, flowerDistance, color, variant] of bedFlowers) {
        const p = renderer.project(lane, flowerDistance);
        if (validPoint(p)) {
          const flowerScale = scaleAt(renderer, p);
          bedPoints.push({ x: p.x, y: p.y - 11 * flowerScale }, { x: p.x, y: p.y + 6 * flowerScale });
          bedPadding = Math.max(bedPadding, 10 * flowerScale);
        }
        drawFlower(renderer, lane, flowerDistance, color, animationTime, reducedMotion, variant);
      }
      recordRoadUnit(renderer, bedId, 'road_flower', boundsFromPoints(bedPoints, bedPadding), alpha);
    }
  }

  if (weights.woodland > .015) {
    c.save(); c.globalAlpha *= weights.woodland;
    for (let i = 0; i < WOOD_TREE_DISTANCES.length; i++) {
      const distance = repeatingDistance(WOOD_TREE_DISTANCES[i] + .5, scrollDistance, SCENERY_PERIOD, maxDistance);
      if (distance !== null && distance >= .9) {
        const id = stableWorldId('woodland-grass', scrollDistance, distance, i);
        if (roadDecorationAllowed(renderer, id, { near: distance < 1.5 })) {
          drawGrassTuft(renderer, (i % 2 ? 1 : -1) * 2.12, distance, animationTime, reducedMotion, '#759765', id);
        }
      }
    }
    c.restore();
  }

  const fenceDistance = positiveModulo(scrollDistance, .72);
  for (const side of [-1]) {
    const parkId = `park-fence:${side}`;
    if (roadDecorationAllowed(renderer, parkId, { near: true })) {
      drawFence(renderer, side, scrollDistance, animationTime, reducedMotion, weights.park, false, maxDistance, parkId);
    }
    const creekScroll = scrollDistance + fenceDistance * .08;
    const creekId = `creek-fence:${side}`;
    if (roadDecorationAllowed(renderer, creekId, { near: true })) {
      drawFence(renderer, side, creekScroll, animationTime, reducedMotion, weights.creek, true, maxDistance, creekId);
    }
  }

  for (let i = 0; i < BENCH_DISTANCES.length; i++) {
    const distance = repeatingDistance(BENCH_DISTANCES[i], scrollDistance, SCENERY_PERIOD, maxDistance);
    if (distance !== null && distance >= .9) {
      const id = stableWorldId('bench', scrollDistance, distance, i);
      if (roadDecorationAllowed(renderer, id, { near: distance < 1.5 })) drawBench(renderer, (i % 2 ? 1 : -1) * 2.66, distance, id);
    }
  }

  for (let i = 0; i < SIGN_DISTANCES.length; i++) {
    const distance = repeatingDistance(SIGN_DISTANCES[i], scrollDistance, SCENERY_PERIOD, maxDistance);
    if (distance === null || distance < .9) continue;
    const side = i % 2 ? -1 : 1;
    const [kind, lane, label] = weights.park >= weights.woodland && weights.park >= weights.creek
      ? ['park-sign', side * 2.58, i % 2 ? '花' : '公園']
      : weights.woodland >= weights.creek
        ? ['wood-sign', -side * 2.62, i % 2 ? '森' : '木道']
        : ['creek-sign', side * 2.60, i % 2 ? '川' : '橋'];
    const id = stableWorldId(kind, scrollDistance, distance, i);
    if (roadDecorationAllowed(renderer, id, { essential: true })) drawSign(renderer, lane, distance, label, 1, id);
  }

  for (let i = 0; i < 5; i++) {
    const distance = repeatingDistance(.55 + i * .79, scrollDistance, SCENERY_PERIOD, maxDistance);
    if (distance === null || distance < .9) continue;
    const side = i % 2 ? 1 : -1;
    const lane = side * (2.02 + (i % 3) * .16);
    if (weights.creek > .015) {
      const reedsId = stableWorldId('creek-reeds', scrollDistance, distance, i);
      if (roadDecorationAllowed(renderer, reedsId, { near: distance < 1.5 })) {
        c.save(); c.globalAlpha *= weights.creek;
        drawReeds(renderer, lane, distance, animationTime, reducedMotion, '#6e9c76', reedsId);
        c.restore();
      }
    }
  }

  const butterflyWeight = weights.park + weights.woodland * .42;
  if (butterflyWeight > .015) {
    c.save(); c.globalAlpha *= butterflyWeight;
    for (let i = 0; i < 3; i++) {
      const side = i % 2 ? 1 : -1;
      const distance = 1.18 + i * .69;
      if (distance > maxDistance) continue;
      const id = stableWorldId('butterfly', scrollDistance, distance, i);
      if (roadDecorationAllowed(renderer, id, { near: distance < 1.5 })) {
        drawButterfly(renderer, side * (2.12 + i * .10), distance, animationTime, reducedMotion, i, id);
      }
    }
    c.restore();
  }
}

function drawLandscape(renderer, timeMs, menu, scrollDistance) {
  const c = renderer.ctx, w = renderer.width, h = renderer.height;
  const stageTime = menu ? 0 : timeMs;
  const weights = themeWeights(stageTime);
  const farDistance = menu ? Math.min(LOOK_AHEAD, h < 620 ? 1.7 : 2.15) : LOOK_AHEAD;
  const center = renderer.project(0, farDistance);
  const horizon = Math.max(h * .16, Math.min(h * .48, center.y));
  const animationTime = renderer.reducedMotion ? 0 : timeMs / 1000;
  const top = weightedColor(PARK.skyTop, WOODLAND.skyTop, CREEK.skyTop, weights);
  const bottom = weightedColor(PARK.skyBottom, WOODLAND.skyBottom, CREEK.skyBottom, weights);
  const sky = c.createLinearGradient(0, 0, 0, Math.max(1, horizon + h * .11));
  sky.addColorStop(0, top); sky.addColorStop(1, bottom);
  c.fillStyle = sky; c.fillRect(0, 0, w, h);

  const staticFarParallax = renderer.reducedMotion || renderer.roadComfortFlags?.farParallax === false;
  drawClouds(renderer, horizon, animationTime, staticFarParallax);
  drawSun(renderer, horizon, staticFarParallax, animationTime);
  drawDistantHills(renderer, horizon, weights, menu);
  drawGround(renderer, horizon, weights);
  drawCreekWater(renderer, scrollDistance, animationTime, staticFarParallax, weights.creek, farDistance);
  drawRoad(renderer, scrollDistance, menu, weights, farDistance);
  drawRoadsideDetails(renderer, scrollDistance, menu, weights, farDistance);
  drawBoardwalkRails(renderer, scrollDistance, weights.creek, farDistance);
  drawScenery(renderer, weights, scrollDistance, animationTime, renderer.reducedMotion, farDistance);
}

export function getAdventureStage(timeMs) {
  const time = finiteTime(timeMs);
  if (time < 10_000) return STAGES[0];
  if (time < 20_000) return STAGES[1];
  return STAGES[2];
}

export class AdventureScene {
  draw(renderer, game, { menu = false, timeMs = 0 } = {}) {
    const w = renderer.width, h = renderer.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    const frameTime = menu ? finiteTime(timeMs) : finiteTime(game?.timeMs);
    const distance = sceneDistance(renderer, game ?? {}, menu);
    drawLandscape(renderer, frameTime, Boolean(menu), distance);
  }
}
