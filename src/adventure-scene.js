import { CONFIG } from './config.js';
import { NEIGHBORHOOD_ART } from './neighborhood-art.js';
import { projectStreet } from './street-camera.js';
import { paintMaterial, STREET_MATERIALS } from './street-materials.js';
import { drawFacade, STREET_FACADE_ART } from './street-facade-art.js';
import { drawVariantFacade, STREET_VARIANT_ART } from './street-facade-variants.js';
import { drawFoliage, STREET_FOLIAGE_ART } from './street-foliage-art.js';

const STAGES = Object.freeze([
  Object.freeze({ index: 0, title: '家並みの道' }),
  Object.freeze({ index: 1, title: '庭木のある通り' }),
  Object.freeze({ index: 2, title: '塀沿いの道' }),
]);

const ROAD_EDGE = 1.55;
const SHOULDER_EDGE = 1.76;
const VERGE_EDGE = 1.91;
const WALL_LANE = 1.90;
const HOUSE_LANE = 3.6;
const LOOK_AHEAD = CONFIG.lookAhead;
const ROAD_NEAR = -.82;
const HOUSE_SPACING = 1.9;
const HOUSE_WIDTH = 328;
const COMMERCIAL_WIDTH = 398;
const POLE_SPACING = 8.4;
const POLE_LANE = 2.08;
const VENDING_LANE = 2.34;
const WALL_SPACING = .72;
const CROSS_LINE_SPACING = .8;

const PALETTES = Object.freeze([
  Object.freeze({ skyTop: '#f3ddc2', skyBottom: '#e9e6d5', ground: '#c9c1b0', wall: '#d9d0bd' }),
  Object.freeze({ skyTop: '#f1ddc8', skyBottom: '#e4e7d6', ground: '#c3c3b2', wall: '#d7cdbc' }),
  Object.freeze({ skyTop: '#eadbc9', skyBottom: '#e4e5d9', ground: '#c8c0b5', wall: '#d2cabd' }),
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

function stageWeights(timeMs) {
  const gardens = smoothstep(8_300, 11_700, timeMs);
  const walls = smoothstep(18_300, 21_700, timeMs);
  return { houses: 1 - gardens, gardens: gardens * (1 - walls), walls };
}

function colorChannels(color) {
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color);
  if (rgb) return rgb.slice(1).map(Number);
  const hex = /^#([\da-f]{6})$/i.exec(color);
  if (!hex) return [190, 190, 190];
  const value = Number.parseInt(hex[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function colorBetween(a, b, amount) {
  const left = colorChannels(a), right = colorChannels(b);
  return `rgb(${left.map((channel, index) => Math.round(channel * (1 - amount) + right[index] * amount)).join(', ')})`;
}

function weightedPalette(key, weights) {
  const colors = PALETTES.map(palette => Number.parseInt(palette[key].slice(1), 16));
  const channel = shift => Math.round(colors.reduce((total, color, index) => {
    const weight = index === 0 ? weights.houses : index === 1 ? weights.gardens : weights.walls;
    return total + ((color >> shift) & 255) * weight;
  }, 0));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function sceneDistance(renderer, game, menu) {
  if (menu) return 0;
  const distance = renderer.worldDistance?.(game);
  return Number.isFinite(distance) ? distance : finiteTime(game?.timeMs) / 1000;
}

function unitAt(renderer) {
  return Math.max(.55, Math.min(renderer.width / 390, renderer.height / 680));
}

function scaleAt(renderer, point) {
  return Math.max(.12, Math.min(renderer.width / 390, renderer.height / 680) * point.scale);
}

function positiveModulo(value, period) {
  return ((value % period) + period) % period;
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.scale);
}

function validXY(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
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

function recordStreetUnit(renderer, objectId, category, bounds, alpha, laneA, laneB) {
  const worldLaneBounds = { min: Math.min(laneA, laneB), max: Math.max(laneA, laneB) };
  renderer.recordRoadDecoration?.({
    objectId, generation: renderer.roadGeneration ?? 0, category, bounds, alpha, lineId: null,
    worldLaneBounds,
  });
}

function unionBounds(current, addition) {
  if (!addition) return current;
  if (!current) return { ...addition };
  return {
    left: Math.min(current.left, addition.left),
    top: Math.min(current.top, addition.top),
    right: Math.max(current.right, addition.right),
    bottom: Math.max(current.bottom, addition.bottom),
  };
}

function segment(ctx, from, to, color, width) {
  if (!validXY(from) || !validXY(to)) return;
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
}

function projectedLine(renderer, lane, startDistance, endDistance, color, width, verticalOffset = 0) {
  const steps = Math.max(1, Math.ceil(Math.abs(startDistance - endDistance) / .18));
  let previous = renderer.project(lane, startDistance);
  if (!validPoint(previous)) return;
  previous = { ...previous, y: previous.y - verticalOffset * scaleAt(renderer, previous) };
  for (let index = 1; index <= steps; index++) {
    const distance = startDistance + (endDistance - startDistance) * index / steps;
    let current = renderer.project(lane, distance);
    if (!validPoint(current)) continue;
    current = { ...current, y: current.y - verticalOffset * scaleAt(renderer, current) };
    segment(renderer.ctx, previous, current, color, width);
    previous = current;
  }
}

function polygon(renderer, points, fill, stroke = null, lineWidth = 1) {
  if (!points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  renderer.path(points.map(point => [point.x, point.y]), fill, stroke, lineWidth);
  return true;
}

function drawSky(renderer, horizon, timeSeconds, reducedMotion, weights) {
  const { ctx: c, width: w, height: h } = renderer;
  const top = weightedPalette('skyTop', weights);
  const bottom = weightedPalette('skyBottom', weights);
  const gradient = c.createLinearGradient?.(0, 0, 0, Math.max(1, horizon + h * .12));
  if (gradient && typeof gradient.addColorStop === 'function') {
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    c.fillStyle = gradient;
  } else c.fillStyle = top;
  c.fillRect(0, 0, w, h);

  const unit = unitAt(renderer);
  const drift = reducedMotion ? 0 : timeSeconds * 1.4;
  const cloudSizes = [32, 23, 28];
  for (let index = 0; index < cloudSizes.length; index++) {
    const size = cloudSizes[index] * unit;
    const baseX = w * [.16, .56, .86][index];
    const x = positiveModulo(baseX + drift * (index % 2 ? .55 : .8), w + size * 3) - size;
    const y = Math.min(horizon * [.22, .15, .26][index], h * .19);
    renderer.ellipse(x, y, size * 1.15, size * .3, '#fff9ed73');
    renderer.ellipse(x - size * .42, y - size * .07, size * .42, size * .24, '#fffaf087');
    renderer.ellipse(x + size * .34, y - size * .11, size * .48, size * .28, '#fffaf087');
  }

  const glowX = w * .18, glowY = h * .12, glowRadius = Math.min(w, h) * .42;
  const glow = c.createRadialGradient?.(glowX, glowY, 1, glowX, glowY, glowRadius);
  if (glow && typeof glow.addColorStop === 'function') {
    glow.addColorStop(0, '#fff6e5a0');
    glow.addColorStop(.42, '#fff4dd42');
    glow.addColorStop(1, '#fff4dd00');
    c.save(); c.fillStyle = glow;
    c.fillRect(0, 0, Math.min(w, glowX + glowRadius), Math.min(h, glowY + glowRadius));
    c.restore();
  }
}

function drawGround(renderer, horizon, weights) {
  const { ctx: c, width: w, height: h } = renderer;
  const top = Math.min(h, Math.max(0, horizon - h * .11));
  const ground = weightedPalette('ground', weights);
  const skyBottom = weightedPalette('skyBottom', weights);
  const gradient = c.createLinearGradient?.(0, top, 0, h);
  if (gradient && typeof gradient.addColorStop === 'function') {
    gradient.addColorStop(0, colorBetween(skyBottom, ground, .04));
    gradient.addColorStop(.58, colorBetween(skyBottom, ground, .68));
    gradient.addColorStop(.76, ground);
    gradient.addColorStop(1, colorBetween(ground, '#b8afa0', .22));
    c.fillStyle = gradient;
  } else c.fillStyle = ground;
  c.fillRect(0, top, w, h - top);
}

function drawVectorHouse(renderer, name, x, baseline, width, height) {
  const c = renderer.ctx, u = Math.max(.35, width / 140);
  const left = -width / 2, right = width / 2;
  const roofColor = name === 'brick-right' ? '#766657' : name === 'timber-left' ? '#61584f' : '#71685e';
  const wallColor = name === 'timber-left' ? '#c5aa8e' : name === 'brick-right' ? '#d2c2ae' : '#e4d8c5';
  const trim = '#9b866c';
  const wallTop = -height * .73;
  const roofTop = -height * .96;

  c.save(); c.translate(x, baseline);
  renderer.ellipse(0, 1.6 * u, width * .34, 3.8 * u, '#554c3e22');
  renderer.path([
    [left - width * .055, wallTop + height * .03], [0, roofTop], [right + width * .055, wallTop + height * .03],
    [right + width * .045, wallTop + height * .12], [left - width * .045, wallTop + height * .12],
  ], roofColor, '#5c554d', Math.max(.55, .8 * u));
  renderer.path([[left, wallTop + height * .09], [right, wallTop + height * .09], [right, 0], [left, 0]], wallColor, trim, Math.max(.55, .8 * u));

  if (name === 'timber-left') {
    for (const offset of [-.3, .03, .34]) {
      const xLine = offset * width;
      segment(c, { x: xLine, y: wallTop + height * .15 }, { x: xLine, y: -height * .04 }, '#886f5c', Math.max(.45, .7 * u));
    }
    segment(c, { x: left + width * .06, y: -height * .31 }, { x: right - width * .06, y: -height * .31 }, '#9b8068', Math.max(.45, .65 * u));
  }
  if (name === 'brick-right') {
    for (let row = 0; row < 3; row++) {
      const y = -height * (.17 + row * .095);
      segment(c, { x: left + width * .04, y }, { x: right - width * .04, y }, '#b58670', Math.max(.45, .65 * u));
    }
  }

  const windowWidth = width * .2, windowHeight = height * .23;
  const windowY = -height * .53;
  for (const center of [-.28, .12]) {
    const wx = center * width;
    renderer.path([[wx - windowWidth / 2, windowY], [wx + windowWidth / 2, windowY],
      [wx + windowWidth / 2, windowY + windowHeight], [wx - windowWidth / 2, windowY + windowHeight]],
    '#b5c4bd', '#8b7969', Math.max(.55, .8 * u));
    segment(c, { x: wx, y: windowY }, { x: wx, y: windowY + windowHeight }, '#e5e8df', Math.max(.45, .65 * u));
  }
  const doorX = width * .31;
  renderer.path([[doorX - width * .09, -height * .31], [doorX + width * .09, -height * .31],
    [doorX + width * .09, 0], [doorX - width * .09, 0]], '#8e7861', '#74614e', Math.max(.45, .7 * u));
  renderer.ellipse(doorX + width * .055, -height * .14, .8 * u, .8 * u, '#eadcbf');
  segment(c, { x: left + width * .1, y: -height * .04 }, { x: right - width * .1, y: -height * .04 }, '#b09a7d', Math.max(.45, .65 * u));
  c.restore();
}

function drawVectorBuilding(renderer, kind, side, x, baseline, width, height, seed) {
  const c = renderer.ctx;
  const unit = Math.max(.32, width / 180);
  const left = -width / 2, right = width / 2;
  const roofTop = -height * .96, wallTop = -height * .84;
  const wall = kind === 'apartment' ? '#e6ddcd' : '#f0e4d2';
  const ink = '#5d4432';
  const glass = '#b7c8c1';
  const trim = '#9a765d';
  const accent = kind === 'convenience' ? '#657c68'
    : kind === 'shop' ? '#a76c4f' : '#8d755f';

  c.save(); c.translate(x, baseline);
  renderer.ellipse(width * .02, 2.2 * unit, width * .43, 4.2 * unit, '#493b2e25');
  renderer.path([
    [left - width * .045, wallTop + height * .04], [left + width * .04, roofTop],
    [right - width * .08, roofTop], [right + width * .055, wallTop + height * .04],
    [right + width * .04, wallTop + height * .12], [left - width * .04, wallTop + height * .12],
  ], kind === 'apartment' ? '#766d61' : '#776858', ink, Math.max(.6, .8 * unit));
  renderer.path([[left, wallTop + height * .08], [right, wallTop + height * .08], [right, 0], [left, 0]], wall, trim, Math.max(.6, .8 * unit));
  // A soft upper-left highlight matches the daylight direction of the other
  // neighborhood art without introducing a large bright plane.
  renderer.path([[left + width * .025, wallTop + height * .13], [left + width * .31, wallTop + height * .13],
    [left + width * .31, -height * .08], [left + width * .025, -height * .08]], '#fff6e57a');

  if (kind === 'apartment') {
    const rows = [height * .32, height * .58];
    for (let row = 0; row < rows.length; row++) {
      for (const column of [-.31, .03, .35]) {
        const wx = column * width, wy = -rows[row];
        renderer.path([[wx - width * .09, wy - height * .075], [wx + width * .09, wy - height * .075],
          [wx + width * .09, wy + height * .075], [wx - width * .09, wy + height * .075]], glass, trim, Math.max(.5, .65 * unit));
        segment(c, { x: wx, y: wy - height * .075 }, { x: wx, y: wy + height * .075 }, '#e5e5d9', Math.max(.45, .6 * unit));
      }
      const balconyY = -rows[row] + height * .105;
      segment(c, { x: left + width * .055, y: balconyY }, { x: right - width * .055, y: balconyY }, '#8a7868', Math.max(.65, .9 * unit));
    }
    const stairX = side < 0 ? .31 : -.31;
    renderer.path([[stairX * width - width * .07, -height * .3], [stairX * width + width * .07, -height * .3],
      [stairX * width + width * .07, 0], [stairX * width - width * .07, 0]], '#9e8268', ink, Math.max(.5, .7 * unit));
  } else {
    const bandTop = wallTop + height * .11;
    const bandBottom = -height * .57;
    renderer.path([[left + width * .015, bandTop], [right - width * .015, bandTop],
      [right - width * .015, bandBottom], [left + width * .015, bandBottom]], accent, ink, Math.max(.5, .7 * unit));
    const label = kind === 'convenience' ? 'コンビニ' : (seed % 2 ? '商店' : 'まちの店');
    if (typeof c.fillText === 'function') {
      c.fillStyle = '#fff8eb'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `600 ${Math.max(4, 10 * unit)}px system-ui, sans-serif`;
      c.fillText(label, 0, (bandTop + bandBottom) / 2, width * .68);
    }
    for (const center of [-.28, .17]) {
      const wx = center * width;
      renderer.path([[wx - width * .145, -height * .52], [wx + width * .145, -height * .52],
        [wx + width * .145, -height * .14], [wx - width * .145, -height * .14]], glass, trim, Math.max(.5, .75 * unit));
      segment(c, { x: wx, y: -height * .52 }, { x: wx, y: -height * .14 }, '#e9eee5', Math.max(.45, .65 * unit));
      segment(c, { x: wx - width * .145, y: -height * .28 }, { x: wx + width * .145, y: -height * .28 }, '#e9eee5', Math.max(.45, .65 * unit));
    }
    const doorX = side < 0 ? .32 : -.32;
    renderer.path([[doorX * width - width * .035, -height * .32], [doorX * width + width * .035, -height * .32],
      [doorX * width + width * .035, 0], [doorX * width - width * .035, 0]], '#a28164', ink, Math.max(.45, .6 * unit));
    if (kind === 'shop') {
      const awningY = -height * .13;
      for (let index = 0; index < 5; index++) {
        const x0 = left + width * (.06 + index * .18);
        renderer.path([[x0, awningY], [x0 + width * .11, awningY],
          [x0 + width * .12, awningY + height * .085], [x0 + width * .01, awningY + height * .085]],
        index % 2 ? '#f2dfc6' : '#c88765', ink, Math.max(.35, .45 * unit));
      }
    }
  }
  segment(c, { x: left + width * .06, y: -height * .035 }, { x: right - width * .06, y: -height * .035 }, '#b49a7e', Math.max(.5, .7 * unit));
  c.restore();
}

function drawStructure(renderer, side, distance, kind, name, objectId, seed = 0) {
  const rootLane = side * HOUSE_LANE;
  const root = renderer.project(rootLane, distance);
  if (!validPoint(root) || root.y < -renderer.height * .3 || root.y > renderer.height * 1.08) return;
  const geometry = kind === 'house'
    ? NEIGHBORHOOD_ART.houseGeometry(name)
    : NEIGHBORHOOD_ART.buildingGeometry(name);
  const unit = unitAt(renderer), scale = scaleAt(renderer, root);
  const inwardEdge = renderer.project(side * ROAD_EDGE, distance);
  const available = side < 0 ? inwardEdge.x - root.x : root.x - inwardEdge.x;
  const inwardFraction = side < 0 ? 1 - geometry.anchorX : geometry.anchorX;
  const maxWidth = Math.max(0, (available - 7 * unit) / Math.max(.2, inwardFraction));
  const desiredWidth = (kind === 'house' ? HOUSE_WIDTH : COMMERCIAL_WIDTH) * scale;
  const width = Math.min(desiredWidth, maxWidth);
  const height = width / Math.max(.6, geometry.aspect);
  if (width < 8 * unit || !Number.isFinite(height)) return;

  const c = renderer.ctx, alpha = c.globalAlpha;
  const drawn = kind === 'house'
    ? typeof c.drawImage === 'function' && NEIGHBORHOOD_ART.drawHouse(c, name, root.x, root.y, width, height)
    : typeof c.drawImage === 'function' && NEIGHBORHOOD_ART.drawBuilding(c, name, root.x, root.y, width, height);
  if (!drawn) {
    if (kind === 'house') drawVectorHouse(renderer, name, root.x, root.y, width, height);
    else drawVectorBuilding(renderer, kind, side, root.x, root.y, width, height, seed);
  }
  const bounds = {
    left: root.x - geometry.anchorX * width,
    top: root.y - geometry.anchorY * height,
    right: root.x + (1 - geometry.anchorX) * width,
    bottom: root.y + (1 - geometry.anchorY) * height,
  };
  recordRoadUnit(renderer, objectId, 'road_landmark', bounds, alpha);
}

function drawHouse(renderer, side, distance, name, objectId) {
  drawStructure(renderer, side, distance, 'house', name, objectId);
}

function drawVendingMachine(renderer, side, distance, objectId) {
  const root = renderer.project(side * VENDING_LANE, distance);
  if (!validPoint(root) || root.y < -renderer.height * .2 || root.y > renderer.height * 1.08) return;
  if (!roadDecorationAllowed(renderer, objectId, { near: distance < 1.5 })) return;
  const unit = scaleAt(renderer, root);
  const width = 25 * unit, height = 64 * unit;
  const inwardEdge = renderer.project(side * SHOULDER_EDGE, distance);
  if (side < 0 ? root.x + width * .5 >= inwardEdge.x : root.x - width * .5 <= inwardEdge.x) return;

  const c = renderer.ctx, alpha = c.globalAlpha;
  c.save(); c.translate(root.x, root.y);
  renderer.ellipse(0, 1.5 * unit, 15 * unit, 3.4 * unit, '#493b2e28');
  renderer.path([[-width * .5, -height], [width * .5, -height],
    [width * .5, 0], [-width * .5, 0]], '#e9e3dd', '#5d4432', Math.max(.7, unit));
  renderer.path([[-width * .34, -height * .91], [width * .25, -height * .91],
    [width * .25, -height * .39], [-width * .34, -height * .39]], '#8caaa0', '#5d4432', Math.max(.45, .65 * unit));
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      const x = -width * .25 + column * width * .25;
      const y = -height * (.83 - row * .23);
      renderer.path([[x - width * .075, y - height * .045], [x + width * .075, y - height * .045],
        [x + width * .075, y + height * .045], [x - width * .075, y + height * .045]],
      (row + column) % 2 ? '#d4ad72' : '#c77c60', '#80644f', Math.max(.3, .4 * unit));
    }
  }
  renderer.path([[width * .29, -height * .84], [width * .4, -height * .84],
    [width * .4, -height * .57], [width * .29, -height * .57]], '#d4c3a8');
  renderer.path([[-width * .5, -height * .31], [width * .5, -height * .31],
    [width * .5, -height * .23], [-width * .5, -height * .23]], '#a76c4f');
  c.restore();
  recordRoadUnit(renderer, objectId, 'road_landmark', {
    left: root.x - width * .5, top: root.y - height,
    right: root.x + width * .5, bottom: root.y,
  }, alpha);
}

function drawHouses(renderer, scrollDistance, maxDistance) {
  const houses = [];
  for (const side of [-1, 1]) {
    const anchor = side < 0 ? .28 : 1.12;
    const firstSlot = Math.floor((scrollDistance + ROAD_NEAR - anchor) / HOUSE_SPACING);
    const lastSlot = Math.ceil((scrollDistance + maxDistance - anchor) / HOUSE_SPACING);
    for (let slot = firstSlot; slot <= lastSlot; slot++) {
      const worldDistance = anchor + slot * HOUSE_SPACING;
      const distance = worldDistance - scrollDistance;
      if (distance < ROAD_NEAR || distance > maxDistance) continue;
      const phase = side < 0 ? 0 : 8;
      let kind = 'house';
      if (positiveModulo(slot + phase, 16) === 7) kind = 'convenience';
      else {
        const block = Math.floor(slot / 3);
        const commercialSlot = stableHash(`street-v25:mix:${side}:${block}`) % 3;
        if (positiveModulo(slot, 3) === commercialSlot) {
          kind = positiveModulo(block + (side < 0 ? 0 : 1), 2) ? 'shop' : 'apartment';
        }
      }
      const name = kind === 'house'
        ? side < 0
          ? (stableHash(`house-v25:${side}:${slot}`) % 2 ? 'timber-left' : 'cream-left')
          : (stableHash(`house-v25:${side}:${slot}`) % 2 ? 'brick-right' : 'cream-right')
        : `${kind}-${side < 0 ? 'left' : 'right'}`;
      const objectId = kind === 'house' ? `house:${side}:${slot}` : `${kind}:${side}:${slot}`;
      houses.push({ side, distance, name, kind, seed: stableHash(objectId), objectId });
    }
  }
  houses.sort((a, b) => b.distance - a.distance);
  for (const building of houses) {
    if (!roadDecorationAllowed(renderer, building.objectId, { near: building.distance < 1.5, essential: true })) continue;
    const c = renderer.ctx;
    // Fade across the final portion of the projection so a house leaves the
    // look-ahead smoothly instead of popping at its far clipping boundary.
    const opacity = 1 - smoothstep(maxDistance - .32, maxDistance, building.distance);
    if (opacity <= .005) continue;
    c.save();
    c.globalAlpha *= opacity;
    drawStructure(renderer, building.side, building.distance, building.kind, building.name, building.objectId, building.seed);
    if (building.kind === 'convenience') {
      drawVendingMachine(renderer, building.side, building.distance, `vending:${building.side}:${building.objectId.split(':').at(-1)}`);
    }
    c.restore();
  }
}

function drawPowerLines(renderer, scrollDistance, maxDistance, structures) {
  const c = renderer.ctx;
  for (const side of [-1, 1]) {
    const structure = structures.get(side);
    if (!structure?.visible) continue;
    const anchor = side < 0 ? .9 : 7.1;
    const first = Math.floor((scrollDistance + ROAD_NEAR - anchor) / POLE_SPACING);
    const last = Math.ceil((scrollDistance + maxDistance - anchor) / POLE_SPACING);
    for (let slot = first; slot <= last; slot++) {
      const worldStart = anchor + slot * POLE_SPACING;
      const startDistance = worldStart - scrollDistance;
      const endDistance = startDistance + POLE_SPACING;
      if (endDistance < ROAD_NEAR || startDistance > maxDistance) continue;
      const visibleStart = Math.max(startDistance, ROAD_NEAR);
      const visibleEnd = Math.min(endDistance, maxDistance);
      const startFraction = (visibleStart - startDistance) / POLE_SPACING;
      const endFraction = (visibleEnd - startDistance) / POLE_SPACING;
      const wirePointAt = fraction => {
        const sag = 36 * fraction * (1 - fraction);
        const distance = startDistance + POLE_SPACING * fraction;
        const point = renderer.project(side * POLE_LANE, distance);
        if (!validPoint(point)) return null;
        const scale = scaleAt(renderer, point);
        return { x: point.x, y: point.y - (104 - sag) * scale };
      };
      const quietBoundary = renderer.height * .57;
      let clippedStart = startFraction, clippedEnd = endFraction;
      const originalStart = wirePointAt(startFraction), originalEnd = wirePointAt(endFraction);
      if (!originalStart || !originalEnd || (originalStart.y > quietBoundary && originalEnd.y > quietBoundary)) continue;
      if (originalStart.y > quietBoundary) {
        let low = startFraction, high = endFraction;
        for (let iteration = 0; iteration < 18; iteration++) {
          const middle = (low + high) / 2;
          if (wirePointAt(middle)?.y <= quietBoundary) high = middle;
          else low = middle;
        }
        clippedStart = high;
      }
      if (originalEnd.y > quietBoundary) {
        let low = clippedStart, high = endFraction;
        for (let iteration = 0; iteration < 18; iteration++) {
          const middle = (low + high) / 2;
          if (wirePointAt(middle)?.y <= quietBoundary) low = middle;
          else high = middle;
        }
        clippedEnd = low;
      }
      if (clippedEnd - clippedStart < .0001) continue;
      const points = [clippedStart, (clippedStart + clippedEnd) / 2, clippedEnd]
        .map(wirePointAt).filter(Boolean);
      if (points.length < 3) continue;
      const startPoint = renderer.project(side * POLE_LANE, startDistance + POLE_SPACING * clippedStart);
      const endPoint = renderer.project(side * POLE_LANE, startDistance + POLE_SPACING * clippedEnd);
      const startScale = validPoint(startPoint) ? scaleAt(renderer, startPoint) : unitAt(renderer);
      const endScale = validPoint(endPoint) ? scaleAt(renderer, endPoint) : unitAt(renderer);
      c.save(); c.globalAlpha *= .58;
      segment(c, points[0], points[1], '#62564866', Math.max(.35, .55 * startScale));
      segment(c, points[1], points[2], '#62564866', Math.max(.35, .55 * endScale));
      const alpha = c.globalAlpha;
      c.restore();
      structure.bounds = unionBounds(structure.bounds, boundsFromPoints(points, 1));
      structure.alpha = Math.max(structure.alpha, alpha);
    }
  }
}

function drawPowerPoles(renderer, scrollDistance, maxDistance, structures) {
  const c = renderer.ctx;
  for (const side of [-1, 1]) {
    const structure = structures.get(side);
    if (!structure?.visible) continue;
    const anchor = side < 0 ? .9 : 7.1;
    const first = Math.floor((scrollDistance + ROAD_NEAR - anchor) / POLE_SPACING);
    const last = Math.ceil((scrollDistance + maxDistance - anchor) / POLE_SPACING);
    for (let slot = first; slot <= last; slot++) {
      const distance = anchor + slot * POLE_SPACING - scrollDistance;
      if (distance < ROAD_NEAR || distance > maxDistance) continue;
      const root = renderer.project(side * POLE_LANE, distance);
      const curb = renderer.project(side * SHOULDER_EDGE, distance);
      if (!validPoint(root) || !validPoint(curb) || root.y < -renderer.height * .12 || root.y > renderer.height * 1.08) continue;
      const scale = scaleAt(renderer, root);
      const lean = side * 2.5 * scale;
      const top = { x: root.x + lean, y: root.y - 126 * scale };
      const armA = { x: top.x - side * 13 * scale, y: top.y + 9 * scale };
      const armB = { x: top.x + side * 13 * scale, y: top.y + 9 * scale };
      const armFar = { x: top.x + side * 16 * scale, y: top.y + 9 * scale };
      const half = Math.max(.75, 2.1 * scale);
      if (side < 0 ? root.x + half >= curb.x : root.x - half <= curb.x) continue;

      c.save();
      segment(c, root, top, '#746657', Math.max(1, 2.4 * scale));
      segment(c, { x: root.x - side * 1.1 * scale, y: root.y },
        { x: top.x - side * 1.1 * scale, y: top.y }, '#aa947a', Math.max(.45, .8 * scale));
      segment(c, armA, armFar, '#746657', Math.max(.8, 1.6 * scale));
      segment(c, { x: armA.x, y: armA.y + 3 * scale }, { x: armFar.x, y: armFar.y + 3 * scale }, '#aa947a', Math.max(.4, .55 * scale));
      c.restore();
      structure.bounds = unionBounds(structure.bounds, boundsFromPoints([root, top, armA, armB, armFar], half));
      structure.alpha = Math.max(structure.alpha, c.globalAlpha);
    }
  }
}

function makePowerStructures(renderer) {
  const structures = new Map();
  for (const side of [-1, 1]) {
    const objectId = `power-structure:${side}`;
    structures.set(side, {
      objectId,
      visible: roadDecorationAllowed(renderer, objectId, { near: true, essential: true }),
      bounds: null,
      alpha: renderer.ctx.globalAlpha,
    });
  }
  return structures;
}

function recordPowerStructures(renderer, structures) {
  for (const structure of structures.values()) {
    if (structure.bounds) {
      recordRoadUnit(renderer, structure.objectId, 'road_landmark', structure.bounds, structure.alpha);
    }
  }
}

function drawGardenShrubs(renderer, scrollDistance, maxDistance, weights) {
  if (weights.gardens < .03) return;
  const c = renderer.ctx;
  const anchors = new Map([[-1, .66], [1, 1.22]]);
  for (const side of [-1, 1]) {
    const anchor = anchors.get(side);
    const firstSlot = Math.floor((scrollDistance + ROAD_NEAR - anchor) / 3.8);
    const lastSlot = Math.ceil((scrollDistance + maxDistance - anchor) / 3.8);
    for (let slot = firstSlot; slot <= lastSlot; slot++) {
      const distance = anchor + slot * 3.8 - scrollDistance;
      if (distance < ROAD_NEAR || distance > maxDistance) continue;
      const id = `garden-shrub:${side}:${slot}`;
      if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5, essential: true })) continue;
      const p = renderer.project(side * 2.94, distance);
      if (!validPoint(p) || p.y < -renderer.height * .2 || p.y > renderer.height * 1.08) continue;
      const scale = scaleAt(renderer, p);
      const alpha = c.globalAlpha;
      c.save(); c.globalAlpha *= weights.gardens;
      renderer.ellipse(p.x, p.y + 1.5 * scale, 17 * scale, 3.4 * scale, '#5a5a462b');
      renderer.ellipse(p.x - 7 * scale, p.y - 9 * scale, 10 * scale, 8 * scale, '#728966');
      renderer.ellipse(p.x + 3 * scale, p.y - 12 * scale, 12 * scale, 10 * scale, '#849774');
      renderer.ellipse(p.x + 12 * scale, p.y - 8 * scale, 9 * scale, 7 * scale, '#738968');
      renderer.ellipse(p.x - 1 * scale, p.y - 16 * scale, 5.5 * scale, 2.8 * scale, '#a9b297');
      c.restore();
      recordRoadUnit(renderer, id, 'road_grass', {
        left: p.x - 18 * scale, top: p.y - 20 * scale,
        right: p.x + 21 * scale, bottom: p.y + 4 * scale,
      }, alpha * weights.gardens);
    }
  }
}

function drawGardenWalls(renderer, scrollDistance, maxDistance, weights) {
  const wallColor = colorBetween(weightedPalette('wall', weights), '#c3b7a6', weights.walls * .7);
  const firstIndex = Math.floor((scrollDistance + ROAD_NEAR) / WALL_SPACING);
  const lastIndex = Math.ceil((scrollDistance + maxDistance) / WALL_SPACING);
  const c = renderer.ctx, unit = unitAt(renderer);
  for (const side of [-1, 1]) {
    const id = `garden-wall:${side}`;
    if (!roadDecorationAllowed(renderer, id, { near: true, essential: true })) continue;
    const wallPoints = [];
    const alpha = c.globalAlpha;
    for (let index = lastIndex; index >= firstIndex; index--) {
      const nearDistance = index * WALL_SPACING - scrollDistance;
      const farDistance = nearDistance + WALL_SPACING;
      if (farDistance < ROAD_NEAR || nearDistance > maxDistance) continue;
      const near = renderer.project(side * WALL_LANE, Math.max(ROAD_NEAR, nearDistance));
      const far = renderer.project(side * WALL_LANE, Math.min(maxDistance, farDistance));
      if (!validPoint(near) || !validPoint(far)) continue;
      const nearScale = scaleAt(renderer, near), farScale = scaleAt(renderer, far);
      const wallHeight = 12 + 62 * weights.walls;
      const points = [
        { x: near.x, y: near.y },
        { x: far.x, y: far.y },
        { x: far.x, y: far.y - wallHeight * farScale },
        { x: near.x, y: near.y - wallHeight * nearScale },
      ];
      polygon(renderer, points, wallColor, '#b7aa94', Math.max(.5, .75 * nearScale));
      segment(c,
        { x: near.x, y: near.y - wallHeight * nearScale },
        { x: far.x, y: far.y - wallHeight * farScale },
        '#f2ebdb', Math.max(.55, 1.2 * nearScale));
      wallPoints.push(...points);
      if (weights.walls > .35 && index % 4 === 0) {
        const pillarWidth = 1.9 * nearScale;
        const pillar = [
          { x: near.x - pillarWidth, y: near.y },
          { x: near.x + pillarWidth, y: near.y },
          { x: near.x + pillarWidth, y: near.y - wallHeight * nearScale * 1.18 },
          { x: near.x - pillarWidth, y: near.y - wallHeight * nearScale * 1.18 },
        ];
        polygon(renderer, pillar, '#b8aa96');
        wallPoints.push(...pillar);
      }
    }
    recordRoadUnit(renderer, id, 'road_fence', boundsFromPoints(wallPoints, 1.5 * unit), alpha);
  }
}

function drawDistantNeighborhood(renderer, horizon, centerX) {
  const { ctx: c, width: w, height: h } = renderer;
  const unit = unitAt(renderer);
  const widths = [48, 58, 44, 62, 50].map(value => value * unit);
  const offsets = [54, 86, 119, 153, 185].map(value => value * unit);
  const baseline = Math.min(h, horizon - 20 * unit);

  // A restrained, camera-fixed row breaks up the sky/ground join. It uses
  // constant IDs and sits outside the narrow corridor where the road vanishes.
  for (const side of [-1, 1]) {
    for (let index = 0; index < widths.length; index++) {
      const id = `distant-house:${side}:${index}`;
      if (!roadDecorationAllowed(renderer, id, { essential: true })) continue;
      const width = widths[index];
      const x = centerX + side * offsets[index];
      const inwardEdge = x - side * width * .48;
      const corridorEdge = centerX + side * 12 * unit;
      if (side < 0 ? inwardEdge > corridorEdge : inwardEdge < corridorEdge) continue;
      const kind = (side < 0 && index === 2) || (side > 0 && index === 1)
        ? 'apartment'
        : (side < 0 && index === 4) || (side > 0 && index === 0) ? 'shop' : 'house';
      const name = kind === 'house'
        ? side < 0
          ? (index % 2 ? 'timber-left' : 'cream-left')
          : (index % 2 ? 'brick-right' : 'cream-right')
        : `${kind}-${side < 0 ? 'left' : 'right'}`;
      const geometry = kind === 'house'
        ? NEIGHBORHOOD_ART.houseGeometry(name)
        : NEIGHBORHOOD_ART.buildingGeometry(name);
      const height = width / Math.max(.6, geometry.aspect);
      const alpha = c.globalAlpha;
      c.save(); c.globalAlpha *= .46;
      const drawn = kind === 'house'
        ? typeof c.drawImage === 'function' && NEIGHBORHOOD_ART.drawHouse(c, name, x, baseline, width, height)
        : typeof c.drawImage === 'function' && NEIGHBORHOOD_ART.drawBuilding(c, name, x, baseline, width, height);
      if (!drawn) {
        if (kind === 'house') drawVectorHouse(renderer, name, x, baseline, width, height);
        else drawVectorBuilding(renderer, kind, side, x, baseline, width, height, stableHash(`${side}:${index}`));
      }
      c.restore();
      recordRoadUnit(renderer, id, 'road_landmark', {
        left: x - geometry.anchorX * width,
        top: baseline - geometry.anchorY * height,
        right: x + (1 - geometry.anchorX) * width,
        bottom: baseline + (1 - geometry.anchorY) * height,
      }, alpha * .46);
    }
  }
}

function drawFarRoadExtension(renderer, maxDistance, centerPoint, leftEdge, rightEdge) {
  const centerX = centerPoint.x;
  const horizon = centerPoint.y;
  const unit = unitAt(renderer);
  const tipY = Math.max(0, horizon - 35 * unit);
  const roadHalf = 6.5 * unit;
  const shoulderHalf = 10.5 * unit;
  const roadColor = '#85817a';
  const shoulderColor = '#d5cbb8';
  const vergeColor = '#aeb7a0';

  for (const side of [-1, 1]) {
    const roadTip = { x: centerX + side * roadHalf, y: tipY };
    const shoulderTip = { x: centerX + side * shoulderHalf, y: tipY };
    const shoulderStart = renderer.project(side * SHOULDER_EDGE, maxDistance);
    const vergeStart = renderer.project(side * VERGE_EDGE, maxDistance);
    const roadStart = side < 0 ? leftEdge : rightEdge;
    polygon(renderer, [roadStart, shoulderStart, shoulderTip, roadTip], shoulderColor);
    polygon(renderer, [shoulderStart, vergeStart,
      { x: centerX + side * (shoulderHalf + 4 * unit), y: tipY }, shoulderTip], vergeColor);
  }
  polygon(renderer, [leftEdge, { x: centerX - roadHalf, y: tipY },
    { x: centerX + roadHalf, y: tipY }, rightEdge], roadColor);
  segment(renderer.ctx, leftEdge, { x: centerX - roadHalf, y: tipY }, '#756f67', Math.max(.7, .9 * unit));
  segment(renderer.ctx, rightEdge, { x: centerX + roadHalf, y: tipY }, '#756f67', Math.max(.7, .9 * unit));
}

function drawRoad(renderer, scrollDistance, menu, maxDistance) {
  const c = renderer.ctx, unit = unitAt(renderer);
  const roadColor = '#85817a';
  const shoulderColor = '#d5cbb8';
  const vergeColor = '#aeb7a0';

  for (let farDistance = maxDistance; farDistance > ROAD_NEAR;) {
    const nearDistance = Math.max(ROAD_NEAR, farDistance - .36);
    for (const side of [-1, 1]) {
      const shoulderNear = renderer.project(side * ROAD_EDGE, nearDistance);
      const shoulderOuterNear = renderer.project(side * SHOULDER_EDGE, nearDistance);
      const shoulderOuterFar = renderer.project(side * SHOULDER_EDGE, farDistance);
      const shoulderFar = renderer.project(side * ROAD_EDGE, farDistance);
      polygon(renderer, [shoulderNear, shoulderOuterNear, shoulderOuterFar, shoulderFar], shoulderColor);

      const vergeNear = renderer.project(side * SHOULDER_EDGE, nearDistance);
      const vergeOuterNear = renderer.project(side * VERGE_EDGE, nearDistance);
      const vergeOuterFar = renderer.project(side * VERGE_EDGE, farDistance);
      const vergeFar = renderer.project(side * SHOULDER_EDGE, farDistance);
      polygon(renderer, [vergeNear, vergeOuterNear, vergeOuterFar, vergeFar], vergeColor);
    }
    const roadPoints = [
      renderer.project(-ROAD_EDGE, nearDistance), renderer.project(ROAD_EDGE, nearDistance),
      renderer.project(ROAD_EDGE, farDistance), renderer.project(-ROAD_EDGE, farDistance),
    ];
    polygon(renderer, roadPoints, roadColor);
    if (NEIGHBORHOOD_ART.asphaltReady && renderer.roadDecoration !== 'minimal') {
      const midDistance = (nearDistance + farDistance) / 2;
      const center = renderer.project(0, midDistance);
      const laneUnit = renderer.project(1, midDistance);
      const before = renderer.project(0, nearDistance), after = renderer.project(0, farDistance);
      NEIGHBORHOOD_ART.drawAsphaltQuad(c, roadPoints, {
        opacity: .19,
        centerX: center.x,
        centerY: (before.y + after.y) / 2,
        pixelsPerLane: Math.abs(laneUnit.x - center.x),
        pixelsPerDistance: Math.abs(after.y - before.y) / (farDistance - nearDistance),
        worldOffset: scrollDistance + midDistance,
        worldSpan: 1.1,
      });
    }
    farDistance = nearDistance;
  }

  const edgeWidth = Math.max(.7, .9 * unit);
  projectedLine(renderer, -ROAD_EDGE, maxDistance, ROAD_NEAR, '#756f67', edgeWidth);
  projectedLine(renderer, ROAD_EDGE, maxDistance, ROAD_NEAR, '#756f67', edgeWidth);
  projectedLine(renderer, -1.585, maxDistance, ROAD_NEAR, '#f0e9d9', Math.max(.75, 1.2 * unit));
  projectedLine(renderer, 1.585, maxDistance, ROAD_NEAR, '#f0e9d9', Math.max(.75, 1.2 * unit));

  if (renderer.roadComfortFlags?.crossLines !== false && renderer.roadDecoration !== 'minimal') {
    const first = Math.floor((scrollDistance + ROAD_NEAR) / CROSS_LINE_SPACING) + 1;
    const last = Math.floor((scrollDistance + maxDistance) / CROSS_LINE_SPACING);
    c.save(); c.globalAlpha *= .20;
    for (let index = first; index <= last; index++) {
      const distance = index * CROSS_LINE_SPACING - scrollDistance;
      const id = `road-cross-${index}`;
      if (!roadDecorationAllowed(renderer, id)) continue;
      const left = renderer.project(-ROAD_EDGE, distance), right = renderer.project(ROAD_EDGE, distance);
      const center = renderer.project(0, distance);
      const width = Math.max(.45, .7 * scaleAt(renderer, center));
      segment(c, left, right, '#d2c9ba', width);
      recordRoadUnit(renderer, id, 'road_cross_line', boundsFromPoints([left, right], width / 2), c.globalAlpha, id);
    }
    c.restore();
  }

  if (renderer.roadDecoration !== 'minimal') {
    const first = Math.floor((scrollDistance + ROAD_NEAR) / 2.4) + 1;
    const last = Math.floor((scrollDistance + maxDistance) / 2.4);
    c.save(); c.globalAlpha *= .18;
    for (let index = first; index <= last; index++) {
      const distance = index * 2.4 - scrollDistance;
      for (const lane of [-.5, .5]) {
        const id = `road-guide:${lane}:${index}`;
        if (!roadDecorationAllowed(renderer, id, { near: distance < .9 })) continue;
        const start = renderer.project(lane, distance + .04);
        if (!validPoint(start) || start.y >= renderer.height * .6) continue;
        const end = renderer.project(lane, Math.min(maxDistance, distance + .25));
        const width = Math.max(.4, .62 * scaleAt(renderer, start));
        segment(c, start, end, '#c5bdb0', width);
        recordRoadUnit(renderer, id, 'road_texture', boundsFromPoints([start, end], width / 2), c.globalAlpha);
      }
    }
    c.restore();
  }
}

function drawLandscape(renderer, timeMs, menu, scrollDistance) {
  NEIGHBORHOOD_ART.load?.();
  const { ctx: c, width: w, height: h } = renderer;
  const stageTime = menu ? 0 : timeMs;
  const weights = stageWeights(stageTime);
  const maxDistance = menu ? Math.min(LOOK_AHEAD, h < 620 ? 1.7 : 2.15) : LOOK_AHEAD;
  const horizonPoint = renderer.project(0, maxDistance);
  const horizonLeft = renderer.project(-ROAD_EDGE, maxDistance);
  const horizonRight = renderer.project(ROAD_EDGE, maxDistance);
  const horizon = Math.max(h * .16, Math.min(h * .48, horizonPoint.y));
  const freezeEnvironment = renderer.reducedMotion || renderer.roadComfortFlags?.farParallax === false;
  const animationTime = freezeEnvironment ? 0 : timeMs / 1000;

  drawSky(renderer, horizon, animationTime, freezeEnvironment, weights);
  drawGround(renderer, horizon, weights);
  drawDistantNeighborhood(renderer, horizon, horizonPoint.x);
  const powerStructures = makePowerStructures(renderer);
  drawPowerLines(renderer, scrollDistance, maxDistance, powerStructures);
  drawFarRoadExtension(renderer, maxDistance, horizonPoint, horizonLeft, horizonRight);
  drawGardenShrubs(renderer, scrollDistance, maxDistance, weights);
  drawHouses(renderer, scrollDistance, maxDistance);
  drawGardenWalls(renderer, scrollDistance, maxDistance, weights);
  drawPowerPoles(renderer, scrollDistance, maxDistance, powerStructures);
  recordPowerStructures(renderer, powerStructures);
  drawRoad(renderer, scrollDistance, menu, maxDistance);

  // A narrow curb edge joins the sidewalk to the asphalt without entering a lane.
  const curbWidth = Math.max(.8, 1.1 * unitAt(renderer));
  projectedLine(renderer, -SHOULDER_EDGE, maxDistance, ROAD_NEAR, '#eee5d2', curbWidth);
  projectedLine(renderer, SHOULDER_EDGE, maxDistance, ROAD_NEAR, '#eee5d2', curbWidth);
}

// Running-course scenery uses the shared street camera. The menu keeps the
// older, deliberately shallow composition above because its copy occupies the
// upper half of the home screen.
const STREET_HORIZON_DISTANCE = 60;
const STREET_NEAR_DISTANCE = -.82;
const STREET_ROAD_EDGE = 1.55;
const STREET_GUTTER_EDGE = 1.76;
const STREET_SIDEWALK_EDGE = 2.18;
const STREET_GRASS_EDGE = 2.58;
const STREET_LOT_SPACING = 2.55;
const STREET_BUILDING_SLOTS = Object.freeze([
  'house', 'house', 'shop', 'house', 'apartment',
  'house', 'convenience', 'house', 'house', 'house',
]);

function streetGround(renderer, lane, distance) {
  const point = renderer.project(lane, Math.max(-.82, Math.min(STREET_HORIZON_DISTANCE, distance)));
  return validPoint(point) ? point : null;
}

function streetElevated(renderer, lane, distance, elevation) {
  const point = projectStreet(renderer.width, renderer.height, lane,
    Math.max(-.82, Math.min(STREET_HORIZON_DISTANCE, distance)), elevation, renderer.trailBend ?? 0);
  return validPoint(point) ? point : null;
}

function streetVertex(renderer, vertex) {
  return vertex[2] > 0
    ? streetElevated(renderer, vertex[0], vertex[1], vertex[2])
    : streetGround(renderer, vertex[0], vertex[1]);
}

function streetPolygon(renderer, vertices, fill, stroke = null, lineWidth = 1, material = null, materialOptions = {}) {
  const points = vertices.map(vertex => streetVertex(renderer, vertex));
  if (points.some(point => !point)) return null;
  if (points.every(p => p.x < 0) || points.every(p => p.x > renderer.width)
    || points.every(p => p.y < 0) || points.every(p => p.y > renderer.height)) return points;
  polygon(renderer, points, fill, stroke, lineWidth);
  if (material) paintStreetMaterial(renderer, vertices, points, material, materialOptions);
  return points;
}

function paintStreetMaterial(renderer, vertices, points, material, options = {}) {
  if (!points || typeof paintMaterial !== 'function') return false;
  const box = boundsFromPoints(points);
  if (!box || box.right < 0 || box.left > renderer.width || box.bottom < 0 || box.top > renderer.height
    || box.right - box.left < 1.25 || box.bottom - box.top < 1.25) return false;
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  const distance = vertices.reduce((sum, vertex) => sum + vertex[1] / vertices.length, 0);
  const scale = streetGround(renderer, 0, distance)?.scale ?? 1;
  return paintMaterial(renderer.ctx, points, material, {
    opacity: .13,
    centerX: center.x,
    centerY: center.y,
    pixelsPerUnit: Math.max(.2, .235 * renderer.width * scale),
    worldOffset: distance,
    worldSpan: 1.3,
    ...options,
  });
}

function streetLine(renderer, a, b, color, width = 1) {
  const from = streetVertex(renderer, a), to = streetVertex(renderer, b);
  if (from && to) segment(renderer.ctx, from, to, color, width);
}

function drawStreetSky(renderer, horizon, timeSeconds, reducedMotion) {
  const { ctx: c, width: w, height: h } = renderer;
  const gradient = c.createLinearGradient?.(0, 0, 0, Math.max(1, horizon));
  if (gradient?.addColorStop) {
    gradient.addColorStop(0, '#b9d5e0');
    gradient.addColorStop(.62, '#dce6df');
    gradient.addColorStop(1, '#f5e8cd');
    c.fillStyle = gradient;
  } else c.fillStyle = '#dce6df';
  c.fillRect(0, 0, w, h);

  const glow = c.createRadialGradient?.(w * .17, h * .11, 1, w * .17, h * .11, Math.min(w, h) * .62);
  if (glow?.addColorStop) {
    glow.addColorStop(0, '#fff3d78a');
    glow.addColorStop(.52, '#fff3d736');
    glow.addColorStop(1, '#fff3d700');
    c.save(); c.fillStyle = glow; c.fillRect(0, 0, w * .82, h * .72); c.restore();
  }

  const unit = Math.max(.55, Math.min(w / 390, h / 680));
  const drift = reducedMotion ? 0 : timeSeconds * 1.8;
  for (let index = 0; index < 3; index++) {
    const width = [47, 34, 42][index] * unit;
    const base = w * [.15, .57, .89][index];
    const x = positiveModulo(base + drift * (index === 1 ? .36 : .68), w + width * 2) - width;
    const y = h * [.12, .085, .17][index];
    renderer.ellipse(x, y, width, width * .16, '#fff9ec6e');
    renderer.ellipse(x - width * .22, y - width * .035, width * .3, width * .13, '#fff9ec76');
    renderer.ellipse(x + width * .19, y - width * .045, width * .34, width * .15, '#fff9ec76');
  }
}

function drawStreetHorizon(renderer, horizon) {
  const { width: w, height: h, ctx: c } = renderer;
  const base = Math.min(h, Math.max(0, horizon + h * .035));
  const ground = c.createLinearGradient?.(0, base, 0, h);
  if (ground?.addColorStop) {
    ground.addColorStop(0, '#d7d9ca');
    ground.addColorStop(.2, '#bdc4aa');
    ground.addColorStop(.7, '#a8b392');
    ground.addColorStop(1, '#919f7d');
    c.fillStyle = ground;
  } else c.fillStyle = '#bdc4aa';
  c.fillRect(0, base, w, h - base);

  // A quiet, broken neighborhood silhouette sits at the far grass edge.
  // Low opacity and varied spacing keep it atmospheric instead of reading as
  // a row of repeated hills or roof triangles.
  const unit = unitAt(renderer);
  for (let index = 0; index < 11; index++) {
    const hash = stableHash(`far-building:${index}`);
    const centerX = w * (index + .42 + (hash % 23) / 100) / 11;
    const width = (12 + (hash >>> 5) % 18) * unit;
    const buildingHeight = (5 + (hash >>> 11) % 12) * unit;
    const baseY = base + (2 + (hash >>> 17) % 9) * unit;
    c.save(); c.globalAlpha *= .15 + ((hash >>> 23) % 8) / 100;
    c.fillStyle = ['#858b7b', '#938c7d', '#7d897a'][index % 3];
    c.fillRect(centerX - width * .42, baseY - buildingHeight, width * .84, buildingHeight);
    renderer.path([[centerX - width * .5, baseY - buildingHeight],
      [centerX, baseY - buildingHeight - width * .16],
      [centerX + width * .5, baseY - buildingHeight],
      [centerX + width * .44, baseY - buildingHeight + unit],
      [centerX - width * .44, baseY - buildingHeight + unit]], '#91816d');
    c.restore();
  }
  for (let index = 0; index < 8; index++) {
    const hash = stableHash(`far-foliage:${index}`);
    const x = w * (index + .35 + (hash % 31) / 100) / 8;
    const width = (18 + (hash >>> 6) % 22) * unit;
    const y = base + (4 + (hash >>> 14) % 9) * unit;
    c.save(); c.globalAlpha *= .2 + ((hash >>> 21) % 12) / 100;
    if (!drawFoliage(c, x, y, width, 'tree')) {
      renderer.ellipse(x, y - width * .31, width * .36, width * .25, '#89947b');
      renderer.ellipse(x - width * .17, y - width * .21, width * .24, width * .2, '#929a7d');
    }
    c.restore();
  }
}

function drawStreetGroundStrips(renderer, scrollDistance) {
  const near = STREET_NEAR_DISTANCE, far = STREET_HORIZON_DISTANCE;
  const c = renderer.ctx;
  streetPolygon(renderer, [[-STREET_ROAD_EDGE, near, 0], [STREET_ROAD_EDGE, near, 0],
    [STREET_ROAD_EDGE, far, 0], [-STREET_ROAD_EDGE, far, 0]], '#787b79');

  // Short world-anchored slices follow the road's changing perspective scale.
  // A single near-to-horizon texture quad makes the asphalt grain look fixed
  // to the screen and compresses it to noise at the vanishing point.
  const asphaltStep = .6;
  const firstAsphaltSlice = Math.floor((scrollDistance + near) / asphaltStep);
  const lastAsphaltSlice = Math.ceil((scrollDistance + far) / asphaltStep);
  for (let slice = firstAsphaltSlice; slice < lastAsphaltSlice; slice++) {
    const worldNear = slice * asphaltStep;
    const worldFar = Math.min((slice + 1) * asphaltStep, scrollDistance + far);
    const sliceNear = Math.max(near, worldNear - scrollDistance);
    const sliceFar = Math.min(far, worldFar - scrollDistance);
    if (sliceFar - sliceNear < .01) continue;
    const vertices = [[-STREET_ROAD_EDGE, sliceNear, 0], [STREET_ROAD_EDGE, sliceNear, 0],
      [STREET_ROAD_EDGE, sliceFar, 0], [-STREET_ROAD_EDGE, sliceFar, 0]];
    const points = vertices.map(vertex => streetVertex(renderer, vertex));
    if (points.some(point => !point)) continue;
    paintStreetMaterial(renderer, vertices, points, 'asphalt', {
      opacity: .13,
      worldOffset: scrollDistance + (sliceNear + sliceFar) * .5,
      worldSpan: 1.35,
    });
  }

  for (const side of [-1, 1]) {
    streetPolygon(renderer, [[side * STREET_GUTTER_EDGE, near, 0], [side * STREET_ROAD_EDGE, near, 0],
      [side * STREET_ROAD_EDGE, far, 0], [side * STREET_GUTTER_EDGE, far, 0]], '#9b9a8e', null, 0, 'concrete');
    streetPolygon(renderer, [[side * STREET_SIDEWALK_EDGE, near, 0], [side * STREET_GUTTER_EDGE, near, 0],
      [side * STREET_GUTTER_EDGE, far, 0], [side * STREET_SIDEWALK_EDGE, far, 0]], '#d0c9b8', null, 0, 'concrete');
    streetPolygon(renderer, [[side * STREET_GRASS_EDGE, near, 0], [side * STREET_SIDEWALK_EDGE, near, 0],
      [side * STREET_SIDEWALK_EDGE, far, 0], [side * STREET_GRASS_EDGE, far, 0]], '#a6b28f', null, 0);
    streetPolygon(renderer, [[side * 8.4, near, 0], [side * STREET_GRASS_EDGE, near, 0],
      [side * STREET_GRASS_EDGE, far, 0], [side * 8.4, far, 0]], '#9ead87', null, 0);
  }

  // Fine edge bands give the road a curb, side gutter and sidewalk joint.
  streetLine(renderer, [-STREET_ROAD_EDGE, near, 0], [-STREET_ROAD_EDGE, far, 0], '#c2b9a8', .9);
  streetLine(renderer, [STREET_ROAD_EDGE, near, 0], [STREET_ROAD_EDGE, far, 0], '#c2b9a8', .9);
  streetLine(renderer, [-STREET_SIDEWALK_EDGE, near, 0], [-STREET_SIDEWALK_EDGE, far, 0], '#eee2c9', 1.25);
  streetLine(renderer, [STREET_SIDEWALK_EDGE, near, 0], [STREET_SIDEWALK_EDGE, far, 0], '#eee2c9', 1.25);
  streetLine(renderer, [-STREET_GUTTER_EDGE, near, 0], [-STREET_GUTTER_EDGE, far, 0], '#777973', .7);
  streetLine(renderer, [STREET_GUTTER_EDGE, near, 0], [STREET_GUTTER_EDGE, far, 0], '#777973', .7);

  // The narrow drain slots live on the verge at regular world intervals.
  const first = Math.floor((scrollDistance + near) / 4.8);
  const last = Math.ceil((scrollDistance + far) / 4.8);
  for (let index = first; index <= last; index++) {
    const world = index * 4.8;
    const distance = world - scrollDistance;
    if (distance < near || distance > far) continue;
    for (const side of [-1, 1]) {
      const id = 'street-drain:' + side + ':' + index;
      if (!roadDecorationAllowed(renderer, id)) continue;
      const outer = side * (STREET_GUTTER_EDGE - .025);
      const inner = side * (STREET_ROAD_EDGE + .02);
      const points = streetPolygon(renderer, [[inner, distance - .09, 0], [outer, distance - .09, 0],
        [outer, distance + .09, 0], [inner, distance + .09, 0]], '#666d6a');
      if (!points) continue;
      const width = Math.max(.35, .55 * (streetGround(renderer, outer, distance)?.scale ?? 1));
      for (let slot = 1; slot <= 4; slot++) {
        const t = slot / 5;
        streetLine(renderer, [inner + (outer - inner) * t, distance - .075, 0],
          [inner + (outer - inner) * t, distance + .075, 0], '#a6a59b', width);
      }
      recordRoadUnit(renderer, id, 'road_texture', boundsFromPoints(points, 1), c.globalAlpha);
    }
  }

  // Very low contrast road seams and manholes add scale without marking lanes.
  const seamFirst = Math.floor((scrollDistance + near) / 9.5);
  const seamLast = Math.ceil((scrollDistance + far) / 9.5);
  for (let index = seamFirst; index <= seamLast; index++) {
    const distance = index * 9.5 - scrollDistance;
    if (distance < near || distance > far) continue;
    const alpha = c.globalAlpha;
    c.save(); c.globalAlpha *= .095;
    streetLine(renderer, [-1.4, distance, 0], [1.4, distance, 0], '#ded8cc', .7);
    c.restore();
    if (index % 2 === 0) {
      const lane = index % 4 === 0 ? -.62 : .62;
      const p = streetGround(renderer, lane, distance);
      if (p && renderer.ellipse) renderer.ellipse(p.x, p.y, 2.2 * p.scale, 1.35 * p.scale, '#646a681f');
    }
  }
}

function streetVisibility(distance, maxDistance = STREET_HORIZON_DISTANCE) {
  return 1 - smoothstep(6, Math.min(50, maxDistance), distance);
}

function drawStreetGardenClump(renderer, lane, distance, id, points) {
  const root = streetGround(renderer, lane, distance);
  if (!root || root.y < -renderer.height * .2 || root.y > renderer.height * 1.08) return;
  const scale = Math.max(.12, Math.min(renderer.width / 390, renderer.height / 680) * root.scale);
  renderer.ellipse(root.x, root.y + .8 * scale, 8.5 * scale, 2.1 * scale, '#4e594221');
  const colors = ['#647d5c', '#708561', '#798969', '#6a805f'];
  const shade = stableHash('garden-clump:' + id) % colors.length;
  const blob = (centerLane, centerElevation, radiusLane, radiusHeight, color, salt) => {
    const vertices = [];
    for (let leaf = 0; leaf < 13; leaf++) {
      const angle = leaf / 13 * Math.PI * 2;
      const irregular = .84 + (stableHash(id + ':' + salt + ':' + leaf) % 32) / 100;
      vertices.push([centerLane + Math.cos(angle) * radiusLane * irregular, distance,
        centerElevation + Math.sin(angle) * radiusHeight * irregular]);
    }
    const drawn = streetPolygon(renderer, vertices, color);
    if (drawn) points.push(...drawn);
  };
  blob(lane, .38, .26, .38, colors[shade], 'base');
  blob(lane - .08, .52, .18, .24, ['#899873', '#8b9a74', '#91a078', '#869671'][shade], 'light');
}

function streetBuildingKind(side, slot) {
  const phase = side < 0 ? 0 : 4;
  return STREET_BUILDING_SLOTS[positiveModulo(slot + phase, STREET_BUILDING_SLOTS.length)];
}

function buildingDimensions(kind, side, slot) {
  const variation = stableHash('street-v26-size:' + side + ':' + slot) % 4;
  const setback = kind === 'house'
    ? [.16, .26, .38, .52][variation]
    : kind === 'apartment' ? .24 : .14;
  const fenced = kind === 'house' && stableHash('lot-fence:' + side + ':' + slot) % 4 !== 1;
  if (kind === 'apartment') return { width: 2.7, depth: 1.1, height: 4.55, roofRise: .28, setback, fenced };
  if (kind === 'convenience') return { width: 3.15, depth: 1.18, height: 2.85, roofRise: .22, setback, fenced };
  if (kind === 'shop') return { width: 2.85 + variation * .07, depth: 1.12, height: 2.7, roofRise: .66, setback, fenced };
  return {
    width: 2.05 + variation * .12,
    depth: .72 + (variation % 2) * .1,
    height: [2.76, 2.95, 3.14, 3.31][variation],
    roofRise: .78 + (variation % 2) * .1,
    setback,
    fenced,
  };
}

function facadeScreenQuad(points) {
  if (!points || points.length !== 4) return null;
  const bottom = points.slice(0, 2).sort((a, b) => a.x - b.x);
  const top = points.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function streetFacadeVariant(item) {
  if (item.kind === 'shop') return 'bakery';
  if (item.kind !== 'house') return null;
  const variant = stableHash(`house-facade:${item.side}:${item.slot}`) % 4;
  return ['cedar', 'brick', 'blue', null][variant];
}

function drawStreetFacadeArt(ctx, quad, item, shade = 0) {
  const variant = streetFacadeVariant(item);
  if (variant && drawVariantFacade(ctx, quad, variant, { shade })) return true;
  const kind = item.kind === 'house' ? 'house'
    : item.kind === 'apartment' ? 'apartment'
      : 'store';
  return drawFacade(ctx, quad, kind, { shade });
}

function drawSideWindow(renderer, lane, distance, width, bottom, top, frame, glass) {
  const outer = streetPolygon(renderer, [[lane, distance, bottom], [lane, distance + width, bottom],
    [lane, distance + width, top], [lane, distance, top]], frame);
  if (!outer) return [];
  const inset = Math.min(.06, width * .18);
  const pane = streetPolygon(renderer, [[lane - .008, distance + inset, bottom + .06],
    [lane - .008, distance + width - inset, bottom + .06],
    [lane - .008, distance + width - inset, top - .06],
    [lane - .008, distance + inset, top - .06]], glass);
  if (pane) {
    streetLine(renderer, [lane - .014, distance + width / 2, bottom + .06],
      [lane - .014, distance + width / 2, top - .06], '#e7e8dc', .5);
    streetLine(renderer, [lane - .014, distance + inset, (bottom + top) / 2],
      [lane - .014, distance + width - inset, (bottom + top) / 2], '#e7e8dc', .45);
    return [...outer, ...pane];
  }
  return outer;
}

function drawSideDoor(renderer, lane, distance, width, height, color) {
  const inset = Math.min(.055, width * .14);
  const frame = streetPolygon(renderer, [[lane - .01, distance, 0], [lane - .01, distance + width, 0],
    [lane - .01, distance + width, height], [lane - .01, distance, height]], '#766450');
  const door = streetPolygon(renderer, [[lane - .02, distance + inset, .035],
    [lane - .02, distance + width - inset, .035],
    [lane - .02, distance + width - inset, height - .04],
    [lane - .02, distance + inset, height - .04]], color);
  const knob = streetElevated(renderer, lane - .03, distance + width * .74, height * .52);
  if (knob) renderer.ellipse(knob.x, knob.y, .65, .65, '#dfc58c');
  return [...(frame ?? []), ...(door ?? [])];
}

function drawRoadFacingFallback(renderer, kind, lane, start, depth, height, side, allPoints) {
  const c = renderer.ctx;
  const trim = '#846f5b';
  const glass = '#9eb8b2';
  if (kind === 'house') {
    const floors = height > 3.25 ? [1.0, 2.05] : [.96, 1.88];
    const windowWidth = depth * .22;
    for (const floor of floors) {
      for (let column = 0; column < 2; column++) {
        const d = start + depth * (.12 + column * .38);
        allPoints.push(...drawSideWindow(renderer, lane, d, windowWidth, floor, floor + .72, trim, glass));
      }
    }
    allPoints.push(...drawSideDoor(renderer, lane, start + depth * .1, Math.min(.5, depth * .24),
      Math.min(2.06, height - .32), '#856d55'));
  } else if (kind === 'apartment') {
    const windowWidth = depth * .19;
    for (const floor of [.72, 2.02, 3.32]) {
      for (let column = 0; column < 3; column++) {
        const d = start + depth * (.12 + column * .27);
        allPoints.push(...drawSideWindow(renderer, lane, d, windowWidth, floor, floor + .75, trim, glass));
      }
      streetLine(renderer, [lane - .025, start + depth * .1, floor + .08],
        [lane - .025, start + depth * .9, floor + .08], '#8d8070', .7);
    }
    allPoints.push(...drawSideDoor(renderer, lane, start + depth * .1, Math.min(.5, depth * .24),
      2.02, '#85745f'));
  } else {
    const signBottom = Math.min(height - .65, 1.96);
    const signTop = Math.min(height - .15, signBottom + .48);
    const frontageStart = start + depth * .12;
    const frontageEnd = start + depth * .88;
    const sign = streetPolygon(renderer, [[lane - .025, frontageStart, signBottom],
      [lane - .025, frontageEnd, signBottom], [lane - .025, frontageEnd, signTop],
      [lane - .025, frontageStart, signTop]], kind === 'convenience' ? '#65806d' : '#a86d50');
    if (sign) allPoints.push(...sign);
    const display = streetPolygon(renderer, [[lane - .03, frontageStart, .45],
      [lane - .03, frontageEnd, .45], [lane - .03, frontageEnd, signBottom - .1],
      [lane - .03, frontageStart, signBottom - .1]], '#9bb9b0');
    if (display) allPoints.push(...display);
    streetLine(renderer, [lane - .04, frontageStart, 1.12],
      [lane - .04, frontageEnd, 1.12], '#e1e6d9', .55);
    if (typeof c.fillText === 'function') {
      const label = streetGround(renderer, lane, start + depth * .5);
      const signPoint = streetElevated(renderer, lane, start + depth * .5, (signBottom + signTop) * .5);
      if (label && signPoint) {
        c.save(); c.fillStyle = '#fff2d9'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '600 ' + Math.max(4, 10 * label.scale) + 'px sans-serif';
        c.fillText(kind === 'convenience' ? 'コンビニ' : 'まちの店', signPoint.x, signPoint.y,
          Math.max(3, Math.abs((start + depth - .45 - (start + .25)) * .235 * renderer.width * label.scale)));
        c.restore();
      }
    }
    allPoints.push(...drawSideDoor(renderer, lane, start + depth * .65, Math.min(.46, depth * .24),
      Math.min(2.04, height - .24), '#886d54'));
  }
}

function drawStreetGroundLot(renderer, item, scrollDistance) {
  const { side, kind, startWorld, width, depth, setback = .2, fenced = true } = item;
  const distance = startWorld - scrollDistance;
  const fade = streetVisibility(Math.max(0, distance));
  if (fade < .005) return;
  const parcelHalfSpan = STREET_LOT_SPACING * .5 + .04;
  const yardNear = Math.max(STREET_NEAR_DISTANCE, distance - parcelHalfSpan);
  const back = Math.min(STREET_HORIZON_DISTANCE, distance + parcelHalfSpan);
  const outerLane = side * (2.48 + setback + width + .36);
  const id = 'lot:' + side + ':' + item.slot;
  if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5, essential: true })) return;
  const ctx = renderer.ctx;
  const alpha = ctx.globalAlpha * fade;
  ctx.save(); ctx.globalAlpha *= fade;
  const points = [];

  const shopLot = kind === 'convenience' || kind === 'shop';
  const yardStyle = stableHash(`yard-style:${side}:${item.slot}`) % 6;
  const yardColor = shopLot ? '#c8c3b5'
    : ['#a7b490', '#adb899', '#9eae88', '#b4ae9e', '#a4b18d', '#b1b39d'][yardStyle];
  const gateDistance = distance + (stableHash(`gate-position:${side}:${item.slot}`) % 49 - 24) / 100;
  const yard = streetPolygon(renderer, [[side * 2.34, yardNear, 0], [outerLane, yardNear, 0],
    [outerLane, back, 0], [side * 2.34, back, 0]], yardColor,
  null, 0, shopLot || yardStyle === 3 || yardStyle === 5 ? 'concrete' : null,
  { opacity: shopLot ? .10 : .095, worldOffset: item.startWorld, worldSpan: 1.05 });
  if (yard) points.push(...yard);

  // A continuous paved approach joins the public path to each entrance.
  const doorLane = side * ((kind === 'convenience' ? 2.52 : 2.48) + setback);
  const path = streetPolygon(renderer, [[side * 2.22, gateDistance - .21, 0],
    [side * 2.46, gateDistance - .21, 0], [doorLane, gateDistance + .16, 0],
    [doorLane - side * .18, gateDistance + .16, 0]], '#c9c1b2', null, 0, 'concrete', { opacity: .1 });
  if (path) points.push(...path);

  // Some homes have a wider concrete entry apron that visibly connects the
  // sidewalk to the front step and breaks up the uninterrupted lawn wedges.
  const driveway = !shopLot && [1, 4, 5].includes(yardStyle);
  if (driveway) {
    const apronOuter = side * (2.48 + setback + .04);
    const apronNear = gateDistance - (.34 + (stableHash(`driveway-depth:${side}:${item.slot}`) % 20) / 100);
    const apronFar = gateDistance + .08;
    const apron = streetPolygon(renderer, [[side * 2.2, apronNear, 0],
      [apronOuter, apronNear, 0], [apronOuter, apronFar, 0],
      [side * 2.2, apronFar, 0]], yardStyle === 1 ? '#b5b2a8' : '#c1bcae', null, 0, 'concrete', { opacity: .08 });
    if (apron) points.push(...apron);
    streetLine(renderer, [side * 2.22, apronNear + .14, 0], [apronOuter, apronNear + .14, 0], '#e1dccf', .6);
    streetLine(renderer, [side * 2.22, apronFar - .08, 0], [apronOuter, apronFar - .08, 0], '#a8a69c', .48);
  }

  if (shopLot) {
    // Two parking bays open onto the road-facing door and glazed storefront.
    for (let bay = 0; bay < 2; bay++) {
      const lane = side * (3.45 + bay * .68);
      const bayPoints = streetPolygon(renderer, [[lane, distance + .72, 0], [lane + side * .48, distance + .72, 0],
        [lane + side * .48, distance + 1.55, 0], [lane, distance + 1.55, 0]], '#b8b7ad');
      if (bayPoints) points.push(...bayPoints);
      streetLine(renderer, [lane, distance + .74, 0], [lane, distance + 1.53, 0], '#e6dfcc', .65);
      streetLine(renderer, [lane + side * .48, distance + .74, 0], [lane + side * .48, distance + 1.53, 0], '#e6dfcc', .65);
    }
  } else {
    // A compact flower bed and low hedge row fill the space between sidewalk
    // and frontage, extending down to the near camera across the whole block.
    const bedSeed = stableHash(`planting-style:${side}:${item.slot}`) % 4;
    const bedA = bedSeed === 1 ? null : streetPolygon(renderer, [[side * 2.57, yardNear + .18, 0], [side * 2.96, yardNear + .18, 0],
      [side * 2.96, Math.min(gateDistance - .34, yardNear + .8), 0],
      [side * 2.57, Math.min(gateDistance - .34, yardNear + .8), 0]], '#758b68');
    const bedB = bedSeed === 2 ? null : streetPolygon(renderer, [[side * 2.55, Math.max(gateDistance + .34, back - .9), 0],
      [side * 2.94, Math.max(gateDistance + .34, back - .9), 0],
      [side * 2.94, back - .18, 0], [side * 2.55, back - .18, 0]], '#758b68');
    if (bedA) points.push(...bedA);
    if (bedB) points.push(...bedB);

    const hedgeLane = side * 2.42;
    const nearTrim = (stableHash(`hedge-near:${side}:${item.slot}`) % 24) / 100;
    const farTrim = (stableHash(`hedge-far:${side}:${item.slot}`) % 28) / 100;
    const hedgeSegments = [[yardNear + nearTrim, gateDistance - .24], [gateDistance + .24, back - farTrim]];
    const hedgeHeight = .4 + (stableHash(`hedge-height:${side}:${item.slot}`) % 3) * .055;
    for (const [segmentStart, segmentEnd] of fenced ? hedgeSegments : []) {
      if (segmentEnd - segmentStart < .16) continue;
      const hedge = streetPolygon(renderer, [[hedgeLane, segmentStart, 0], [hedgeLane, segmentEnd, 0],
        [hedgeLane, segmentEnd, hedgeHeight], [hedgeLane, segmentStart, hedgeHeight]], '#718363');
      if (hedge) points.push(...hedge);
      const hedgeTop = streetPolygon(renderer, [[hedgeLane, segmentStart, hedgeHeight],
        [hedgeLane + side * .12, segmentStart, hedgeHeight], [hedgeLane + side * .12, segmentEnd, hedgeHeight],
        [hedgeLane, segmentEnd, hedgeHeight]], '#879476');
      if (hedgeTop) points.push(...hedgeTop);
      const hedgeReturn = streetPolygon(renderer, [[hedgeLane + side * .12, segmentStart, 0],
        [hedgeLane + side * .12, segmentEnd, 0], [hedgeLane + side * .12, segmentEnd, hedgeHeight],
        [hedgeLane + side * .12, segmentStart, hedgeHeight]], '#637857');
      if (hedgeReturn) points.push(...hedgeReturn);
      streetLine(renderer, [hedgeLane + side * .05, segmentStart, hedgeHeight - .015],
        [hedgeLane + side * .05, segmentEnd, hedgeHeight - .015], '#a6a98b', .42);
      const sprigStep = .36 + (stableHash(`hedge-density:${side}:${item.slot}`) % 33) / 100;
      const sprigOffset = .16 + (stableHash(`hedge-offset:${side}:${item.slot}`) % 16) / 100;
      for (let sprig = segmentStart + sprigOffset, sprigIndex = 0; sprig < segmentEnd; sprig += sprigStep, sprigIndex++) {
        const root = streetGround(renderer, hedgeLane + side * .06, sprig);
        if (!root) continue;
        const lanePixels = .235 * renderer.width * root.scale;
        const spriteWidth = lanePixels * (1.0 + (stableHash(`${id}:hedge:${sprigIndex}`) % 34) / 100);
        const spriteHeight = spriteWidth * 82 / 240;
        if (drawFoliage(renderer.ctx, root.x, root.y, spriteWidth, 'hedge')) {
          points.push({ x: root.x - spriteWidth / 2, y: root.y - spriteHeight },
            { x: root.x + spriteWidth / 2, y: root.y });
        }
      }
      const postStep = 1.05 + (stableHash(`hedge-post:${side}:${item.slot}`) % 61) / 100;
      const postCount = Math.max(1, Math.floor((segmentEnd - segmentStart) / postStep));
      for (let post = 0; post <= postCount; post++) {
        const postDistance = segmentStart + (segmentEnd - segmentStart) * post / postCount;
        const postPoints = streetPolygon(renderer, [[hedgeLane - side * .045, postDistance - .045, 0],
          [hedgeLane + side * .055, postDistance - .045, 0], [hedgeLane + side * .055, postDistance - .045, .51],
          [hedgeLane - side * .045, postDistance - .045, .51]], '#a9997d');
        if (postPoints) points.push(...postPoints);
        const postSide = streetPolygon(renderer, [[hedgeLane + side * .055, postDistance - .045, 0],
          [hedgeLane + side * .055, postDistance + .045, 0], [hedgeLane + side * .055, postDistance + .045, .51],
          [hedgeLane + side * .055, postDistance - .045, .51]], '#82745f');
        if (postSide) points.push(...postSide);
      }
    }

    // Two gate posts and fine rails meet the entry walk at the opening.
    for (const distanceOffset of fenced ? [-.24, .24] : []) {
      const gateD = gateDistance + distanceOffset;
      const post = streetPolygon(renderer, [[hedgeLane - side * .055, gateD - .045, 0],
        [hedgeLane + side * .055, gateD - .045, 0], [hedgeLane + side * .055, gateD - .045, .68],
        [hedgeLane - side * .055, gateD - .045, .68]], '#b39976');
      if (post) points.push(...post);
      const postReturn = streetPolygon(renderer, [[hedgeLane + side * .055, gateD - .045, 0],
        [hedgeLane + side * .055, gateD + .045, 0], [hedgeLane + side * .055, gateD + .045, .68],
        [hedgeLane + side * .055, gateD - .045, .68]], '#8f7d64');
      if (postReturn) points.push(...postReturn);
    }
    const gateSlats = 3 + stableHash(`gate-style:${side}:${item.slot}`) % 3;
    for (let slat = 0; fenced && slat < gateSlats; slat++) {
      const lane = hedgeLane + side * (.025 + slat * .064);
      streetLine(renderer, [lane, gateDistance - .22, .12], [lane, gateDistance + .22, .56], '#947856', .62);
    }
    if (fenced) {
      streetLine(renderer, [hedgeLane, gateDistance - .22, .53],
        [hedgeLane, gateDistance + .22, .53], '#947856', .58);
    }

    // Planted clumps and a few pale flowers sit in stable, world-anchored beds.
    const plantCount = 2 + stableHash(`flower-count:${side}:${item.slot}`) % 4;
    const plantStart = yardNear + .22 + (stableHash(`flower-start:${side}:${item.slot}`) % 16) / 100;
    const plantGap = .32 + (stableHash(`flower-gap:${side}:${item.slot}`) % 19) / 100;
    for (let plant = 0; plant < plantCount; plant++) {
      const plantDistance = plantStart + plant * plantGap;
      if (plantDistance > gateDistance - .32) continue;
      const lane = side * (2.7 + (plant % 2) * .2);
      const p = streetGround(renderer, lane, plantDistance);
      if (!p || p.y < -renderer.height * .2 || p.y > renderer.height * 1.05) continue;
      const scale = Math.max(.12, Math.min(renderer.width / 390, renderer.height / 680) * p.scale);
      const shrub = (offset, width, rise, color) => {
        const shape = [];
        for (let petal = 0; petal < 10; petal++) {
          const angle = petal / 10 * Math.PI * 2;
          const irregular = .88 + (stableHash(`garden-leaf:${id}:${plant}:${petal}`) % 25) / 100;
          shape.push([lane + side * (offset + Math.cos(angle) * width * irregular), plantDistance,
            .04 + Math.max(0, Math.sin(angle)) * rise * irregular]);
        }
        streetPolygon(renderer, shape, color);
      };
      shrub(0, .09, .085, '#697f5d');
      shrub(.05, .072, .13, '#85946f');
      shrub(-.055, .067, .11, '#8d9b78');
      if (plant % 2 === 0) {
        renderer.ellipse(p.x - 1.2 * scale, p.y - 5.25 * scale, 1.15 * scale, 1.15 * scale, '#f0d7a9');
        renderer.ellipse(p.x + 2.5 * scale, p.y - 4.85 * scale, 1.05 * scale, 1.05 * scale, '#e9c39d');
      }
    }

    // Open pockets behind and beside the compact building keep each parcel
    // from reading as one uninterrupted wall while adding planted depth.
    if (kind === 'house' || kind === 'apartment') {
      const gardenLane = side * Math.min(outerLane / side - .18, 2.7 + setback + width * .72);
      drawStreetGardenClump(renderer, gardenLane, distance - .58, id + ':front-plant', points);
      drawStreetGardenClump(renderer, gardenLane - side * .12, Math.min(back - .16, distance + depth + .36),
        id + ':back-plant', points);
    }
  }

  ctx.restore();
  recordStreetUnit(renderer, id, 'road_grass', boundsFromPoints(points, .8), alpha,
    side < 0 ? outerLane : side * 2.24, side < 0 ? side * 2.24 : outerLane);
}

function facadeWindow(renderer, side, distance, laneA, laneB, bottom, top, trim, glass) {
  const frame = streetPolygon(renderer, [[laneA, distance, bottom], [laneB, distance, bottom],
    [laneB, distance, top], [laneA, distance, top]], trim);
  if (!frame) return [];
  const insetA = laneA + side * .075, insetB = laneB - side * .075;
  const pane = streetPolygon(renderer, [[insetA, distance - .006, bottom + .075],
    [insetB, distance - .006, bottom + .075], [insetB, distance - .006, top - .075],
    [insetA, distance - .006, top - .075]], glass);
  if (pane) {
    streetLine(renderer, [(insetA + insetB) / 2, distance - .012, bottom + .075],
      [(insetA + insetB) / 2, distance - .012, top - .075], '#e5e6db', .55);
    streetLine(renderer, [insetA, distance - .012, (bottom + top) / 2],
      [insetB, distance - .012, (bottom + top) / 2], '#e5e6db', .5);
    return [...frame, ...pane];
  }
  return frame;
}

function facadeDoor(renderer, side, distance, laneA, laneB, height, color) {
  const recess = streetPolygon(renderer, [[laneA, distance - .014, 0], [laneB, distance - .014, 0],
    [laneB, distance - .014, height], [laneA, distance - .014, height]], '#806d5d');
  const door = streetPolygon(renderer, [[laneA + side * .055, distance - .022, .04],
    [laneB - side * .055, distance - .022, .04], [laneB - side * .055, distance - .022, height - .08],
    [laneA + side * .055, distance - .022, height - .08]], color);
  if (door && door.length) {
    const knobLane = (laneA + laneB) / 2 + side * .045;
    const knob = streetElevated(renderer, knobLane, distance - .03, height * .53);
    if (knob) renderer.ellipse(knob.x, knob.y, .75, .75, '#ead7ad');
  }
  return [...(recess ?? []), ...(door ?? [])];
}

function drawStreetBuilding(renderer, item, scrollDistance) {
  const { side, kind, startWorld, depth, width, height, roofRise, setback = .2 } = item;
  const start = startWorld - scrollDistance;
  const end = start + depth;
  if (end < STREET_NEAR_DISTANCE || start > STREET_HORIZON_DISTANCE) return;
  const fade = streetVisibility(Math.max(start, 0));
  if (fade < .005) return;
  const id = kind + ':' + side + ':' + item.slot;
  if (!roadDecorationAllowed(renderer, id, { near: start < 1.5, essential: true })) return;

  const baseLane = side * ((kind === 'convenience' ? 2.52 : 2.48) + setback);
  const farLane = side * (Math.abs(baseLane) + width);
  const roofNear = Math.max(-.82, start - .12), roofFar = Math.min(STREET_HORIZON_DISTANCE, end + .12);
  const roofNearLane = side * (Math.abs(baseLane) - .15);
  const roofFarLane = side * (Math.abs(farLane) + .15);
  const ridgeLane = side * (Math.abs(baseLane) + width * .5);
  const c = renderer.ctx;
  const unit = Math.max(.3, Math.min(renderer.width / 390, renderer.height / 680));
  const wall = kind === 'apartment' ? '#d7d1c3'
    : kind === 'convenience' ? '#e5e0cf'
      : kind === 'shop' ? '#dfcfb5'
        : ['#e0d3bd', '#d3c6ad', '#e5d9c4', '#cfc9b8'][stableHash(id) % 4];
  const wallShade = kind === 'apartment' ? '#bcb9ae'
    : kind === 'convenience' ? '#c9c8bb'
      : kind === 'shop' ? '#bdab91' : '#b9aa94';
  const roof = kind === 'apartment' ? '#757a77'
    : kind === 'convenience' ? '#777d76'
      : kind === 'shop' ? '#a15e43'
        : ['#995b43', '#786750', '#a4664b', '#777063'][stableHash('roof:' + id) % 4];
  const roofShadow = kind === 'apartment' ? '#626967'
    : kind === 'convenience' ? '#666d68' : '#784d3b';
  const windowTrim = '#8e7965';
  const glass = kind === 'convenience' || kind === 'shop' ? '#a8c0b9' : '#9fb7b4';
  const allPoints = [];

  const baseAlpha = c.globalAlpha;
  c.save();
  c.globalAlpha *= fade;

  // A close footprint shadow grounds the walls without casting long parallel
  // streaks across every yard.
  const shadowInner = side * (Math.abs(baseLane) - .06);
  const shadowOuter = side * (Math.abs(farLane) + .1);
  const lotShadow = streetPolygon(renderer, [[shadowInner, start + .025, 0], [shadowOuter, start + .025, 0],
    [shadowOuter, end + .11, 0], [shadowInner, end + .11, 0]], '#514b4010');
  if (lotShadow) allPoints.push(...lotShadow);
  const contactShadow = streetPolygon(renderer, [[baseLane, start + .025, 0],
    [baseLane - side * .07, start + .025, 0], [baseLane - side * .07, end + .035, 0],
    [baseLane, end + .035, 0]], '#514b4019');
  if (contactShadow) allPoints.push(...contactShadow);

  // Street-facing side wall: a real longitudinal plane with a shaded return.
  const wallMaterial = STREET_FACADE_ART.atlasReady || STREET_VARIANT_ART.atlasReady ? null : 'plaster';
  const sideWall = streetPolygon(renderer, [[baseLane, start, 0], [baseLane, end, 0],
    [baseLane, end, height], [baseLane, start, height]], wallShade, null, 0, wallMaterial);
  if (sideWall) allPoints.push(...sideWall);
  const roadFacadePainted = Boolean(sideWall && drawStreetFacadeArt(c, facadeScreenQuad(sideWall), item,
    side < 0 ? .04 : .09));
  // The far wall faces away from a camera on the road and is hidden by the
  // roof, near end and street-facing wall. Do not texture this back face.

  // Front facade sits across the street-facing end of each lot. The opening
  // positions and door heights are in world units, so they recede with roofs.
  const frontWall = streetPolygon(renderer, [[baseLane, start, 0], [farLane, start, 0],
    [farLane, start, height], [baseLane, start, height]], wall, null, 0, wallMaterial,
  { opacity: .085, worldOffset: scrollDistance + start, worldSpan: 1 });
  if (frontWall) allPoints.push(...frontWall);
  const endFacadePainted = Boolean(frontWall && drawStreetFacadeArt(c, facadeScreenQuad(frontWall), item, .13));

  // A vector façade remains available on the road-side plane while the
  // optional perspective atlas loads or if Canvas image mapping fails.
  if (!roadFacadePainted) drawRoadFacingFallback(renderer, kind, baseLane - side * .018,
    start, depth, height, side, allPoints);

  if (!endFacadePainted && kind === 'apartment') {
    const facadeLow = [[baseLane, start - .015, .95], [baseLane + side * .62, start - .015, .95],
      [baseLane + side * .62, start - .015, 1.8], [baseLane, start - .015, 1.8]];
    const facadeHigh = [[baseLane, start - .015, 2.75], [baseLane + side * .62, start - .015, 2.75],
      [baseLane + side * .62, start - .015, 3.65], [baseLane, start - .015, 3.65]];
    for (const vertices of [facadeLow, facadeHigh]) {
      const points = streetPolygon(renderer, vertices, '#b8ad9a');
      if (points) allPoints.push(...points);
    }
    for (const row of [0, 1]) {
      const bottom = row === 0 ? .98 : 2.78;
      const top = bottom + .75;
      for (let column = 0; column < 3; column++) {
        const laneA = baseLane + side * (.18 + column * .78);
        const laneB = laneA + side * .47;
        const windowPoints = facadeWindow(renderer, side, start - .028, laneA, laneB, bottom, top, windowTrim, glass);
        allPoints.push(...windowPoints);
        const balcony = streetPolygon(renderer, [[laneA - side * .07, start - .065, bottom - .12],
          [laneB + side * .07, start - .065, bottom - .12], [laneB + side * .07, start - .065, bottom + .02],
          [laneA - side * .07, start - .065, bottom + .02]], '#8b8274');
        if (balcony) allPoints.push(...balcony);
      }
    }
    const stairLaneA = baseLane + side * width * .63;
    const stairLaneB = stairLaneA + side * .5;
    allPoints.push(...facadeDoor(renderer, side, start - .035, stairLaneA, stairLaneB, 2.05, '#85745f'));
  } else if (!endFacadePainted && (kind === 'convenience' || kind === 'shop')) {
    const signHeight = kind === 'convenience' ? 2.15 : 2.0;
    const sign = streetPolygon(renderer, [[baseLane + side * .13, start - .03, signHeight - .48],
      [farLane - side * .13, start - .03, signHeight - .48], [farLane - side * .13, start - .03, signHeight],
      [baseLane + side * .13, start - .03, signHeight]], kind === 'convenience' ? '#657d6e' : '#a86d50');
    if (sign) allPoints.push(...sign);

    const windowA = baseLane + side * .14, windowB = farLane - side * .14;
    const shopWindows = facadeWindow(renderer, side, start - .045, windowA, windowB,
      .45, 1.72, '#806d5b', '#9ebbb6');
    allPoints.push(...shopWindows);
    const doorA = baseLane + side * width * .32;
    const doorB = doorA + side * .53;
    allPoints.push(...facadeDoor(renderer, side, start - .06, doorA, doorB, 2.05, '#886d54'));

    if (kind === 'shop') {
      // A fabric awning projects toward the public sidewalk, with small
      // alternating cloth panels and a thin front valance.
      const awningLaneA = baseLane - side * .22;
      const awningLaneB = farLane + side * .04;
      const awningTop = 2.15, awningBottom = 1.92;
      const awning = streetPolygon(renderer, [[awningLaneA, start - .26, awningTop],
        [awningLaneB, start - .26, awningTop], [awningLaneB, start + .07, awningBottom],
        [awningLaneA, start + .07, awningBottom]], '#d4a67b');
      if (awning) allPoints.push(...awning);
      for (let panel = 0; panel < 5; panel++) {
        const a = awningLaneA + (awningLaneB - awningLaneA) * panel / 5;
        const b = awningLaneA + (awningLaneB - awningLaneA) * (panel + 1) / 5;
        const stripe = streetPolygon(renderer, [[a, start - .26, awningTop],
          [b, start - .26, awningTop], [b, start + .07, awningBottom], [a, start + .07, awningBottom]],
        panel % 2 ? '#eee0c6' : '#bd7858');
        if (stripe) allPoints.push(...stripe);
      }
      streetLine(renderer, [awningLaneA, start + .07, awningBottom], [awningLaneB, start + .07, awningBottom], '#846d5a', .65);
    }

    const label = kind === 'convenience' ? 'コンビニ' : 'まちの店';
    const centerLane = (baseLane + farLane) / 2;
    const signCenter = streetElevated(renderer, centerLane, start - .047, signHeight - .25);
    if (signCenter && typeof c.fillText === 'function') {
      c.save(); c.fillStyle = '#fff4dc'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '600 ' + Math.max(5, 14 * unit * signCenter.scale) + 'px sans-serif';
      c.fillText(label, signCenter.x, signCenter.y, Math.abs((farLane - baseLane) * .235 * renderer.width * signCenter.scale * .8));
      c.restore();
    }
  } else if (!endFacadePainted) {
    const windowPointsA = facadeWindow(renderer, side, start - .035,
      baseLane + side * .18, baseLane + side * .68, .92, 1.62, windowTrim, glass);
    const windowPointsB = facadeWindow(renderer, side, start - .035,
      farLane - side * .68, farLane - side * .18, .92, 1.62, windowTrim, glass);
    allPoints.push(...windowPointsA, ...windowPointsB);
    const doorLaneA = baseLane + side * Math.min(width * .56, 1.34);
    const doorLaneB = doorLaneA + side * .48;
    allPoints.push(...facadeDoor(renderer, side, start - .045, doorLaneA, doorLaneB, 1.93, '#856d55'));

    // A shallow entrance step and lintel make the doorway feel recessed.
    const step = streetPolygon(renderer, [[doorLaneA - side * .08, start - .18, 0],
      [doorLaneB + side * .08, start - .18, 0], [doorLaneB + side * .08, start - .07, .08],
      [doorLaneA - side * .08, start - .07, .08]], '#b9a88e');
    if (step) allPoints.push(...step);

    // Fine timber battens and a transom break up plaster without heavy ink.
    if (item.slot % 2 === 0) {
      for (let batten = 0; batten < 4; batten++) {
        const lane = baseLane + side * (.1 + batten * .12);
        streetLine(renderer, [lane, start - .03, .12], [lane, start - .03, height - .16], '#a98f70', .45);
      }
    }
  }

  // Eaves and the ridge cast a gentle, narrow shadow across the facade.
  streetLine(renderer, [baseLane - side * .08, start - .05, height + .02],
    [baseLane - side * .08, end + .05, height + .02], '#948471', .7);
  streetLine(renderer, [farLane + side * .08, start + .12, height + .02],
    [farLane + side * .08, end + .05, height + .02], '#b7a994', .5);

  if (kind === 'apartment') {
    const parapet = streetPolygon(renderer, [[roofNearLane, roofNear, height], [roofFarLane, roofNear, height],
      [roofFarLane, roofFar, height], [roofNearLane, roofFar, height]], roof, null, 0, 'roof');
    if (parapet) allPoints.push(...parapet);
    const cap = streetPolygon(renderer, [[roofNearLane, roofNear, height + .28],
      [roofFarLane, roofNear, height + .28], [roofFarLane, roofFar, height + .28],
      [roofNearLane, roofFar, height + .28]], roofShadow);
    if (cap) allPoints.push(...cap);
  } else {
    const ridgeHeight = height + roofRise;
    const roofA = streetPolygon(renderer, [[roofNearLane, roofNear, height], [ridgeLane, roofNear, ridgeHeight],
      [ridgeLane, roofFar, ridgeHeight], [roofNearLane, roofFar, height]], roof, null, 0, 'roof',
    { opacity: .18, worldOffset: scrollDistance + start, worldSpan: .72 });
    const roofB = streetPolygon(renderer, [[ridgeLane, roofNear, ridgeHeight], [roofFarLane, roofNear, height],
      [roofFarLane, roofFar, height], [ridgeLane, roofFar, ridgeHeight]], roofShadow, null, 0, 'roof',
    { opacity: .16, worldOffset: scrollDistance + start, worldSpan: .72 });
    if (roofA) allPoints.push(...roofA);
    if (roofB) allPoints.push(...roofB);

    // Gable ends expose the roof pitch at the street-facing end.
    const gable = streetPolygon(renderer, [[baseLane, start - .008, height],
      [farLane, start - .008, height], [ridgeLane, start - .008, ridgeHeight]], wallShade);
    if (gable) allPoints.push(...gable);
    streetLine(renderer, [roofNearLane, roofNear, height], [ridgeLane, roofNear, ridgeHeight], '#b58b68', .55);
    streetLine(renderer, [ridgeLane, roofNear, ridgeHeight], [roofFarLane, roofNear, height], '#704e3b', .55);

    // Narrow rows across the roof plane suggest ceramic tile, at world-fixed
    // intervals so every frame keeps the same surface pattern.
    const tileStep = kind === 'house' ? .42 : .66;
    for (let d = roofNear + tileStep; d < roofFar; d += tileStep) {
      const worldRow = Math.round((scrollDistance + d) / tileStep);
      if (worldRow % 4 === 0) {
        const ridge = ridgeHeight - .05;
        streetLine(renderer, [roofNearLane, d, height + .015], [ridgeLane, d, ridge], '#d6b28e2a', .34);
        streetLine(renderer, [ridgeLane, d, ridge], [roofFarLane, d, height + .015], '#493f382b', .34);
      }
    }
  }

  // Wall-mounted air conditioners and downpipes add small, useful scale cues.
  if (kind === 'house' || kind === 'apartment') {
    const acLane = baseLane - side * .12;
    const acD = start + depth * .63;
    const ac = streetPolygon(renderer, [[acLane, acD, 1.06], [acLane - side * .18, acD, 1.06],
      [acLane - side * .18, acD, 1.46], [acLane, acD, 1.46]], '#c6c4b8');
    if (ac) allPoints.push(...ac);
    streetLine(renderer, [acLane - side * .19, acD - .012, 1.14],
      [acLane - side * .19, acD - .012, 1.38], '#8d928e', .55);
    const pipeLane = farLane - side * .12;
    streetLine(renderer, [pipeLane, start - .025, height + .12], [pipeLane, start - .025, .12], '#a27e5e', .8);
  }

  c.restore();
  recordStreetUnit(renderer, id, 'road_landmark', boundsFromPoints(allPoints, .8), baseAlpha * fade,
    side < 0 ? roofFarLane : roofNearLane, side < 0 ? roofNearLane : roofFarLane);
}

function drawStreetFrontageTree(renderer, item, scrollDistance) {
  const { side, slot, kind, startWorld, setback = .2 } = item;
  if (kind !== 'house' && kind !== 'apartment') return;
  // Alternate trees on each side so every short block has one clear garden
  // focal point without making a continuous row of matching crowns.
  if (positiveModulo(slot + (side > 0 ? 1 : 0), 2) !== 0) return;
  const lotOffset = .3 + (stableHash(`frontage-tree:${side}:${slot}`) % 41) / 100;
  const distance = startWorld - scrollDistance + lotOffset;
  if (distance < STREET_NEAR_DISTANCE || distance > STREET_HORIZON_DISTANCE) return;
  const id = `lot-tree:${side}:${slot}`;
  if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5, essential: true })) return;

  const lane = side * (2.32 + Math.min(.08, setback * .16));
  const root = streetGround(renderer, lane, distance);
  if (!root || root.y < -renderer.height * .18 || root.y > renderer.height * 1.08) return;
  const ctx = renderer.ctx;
  const alpha = ctx.globalAlpha * streetVisibility(distance);
  if (alpha < .01) return;
  ctx.save(); ctx.globalAlpha *= streetVisibility(distance);
  const laneScale = .235 * renderer.width * root.scale;
  const spriteWidth = laneScale * (1.04 + (stableHash(id + ':crown') % 12) / 100);
  const spriteHeight = spriteWidth * 240 / 189;
  renderer.ellipse(root.x, root.y + Math.max(.8, root.scale), spriteWidth * .22,
    Math.max(1.2, spriteWidth * .047), '#4e514329');

  let bounds = null;
  if (drawFoliage(ctx, root.x, root.y, spriteWidth, 'tree')) {
    bounds = { left: root.x - spriteWidth / 2, top: root.y - spriteHeight,
      right: root.x + spriteWidth / 2, bottom: root.y };
  } else {
    const trunk = streetPolygon(renderer, [[lane - side * .09, distance, 0],
      [lane + side * .09, distance, 0], [lane + side * .055, distance, .92],
      [lane - side * .055, distance, .92]], '#80654b');
    const canopy = [];
    for (let leaf = 0; leaf < 16; leaf++) {
      const angle = leaf / 16 * Math.PI * 2;
      const irregular = .86 + (stableHash(`${id}:leaf:${leaf}`) % 28) / 100;
      canopy.push([lane + Math.cos(angle) * .57 * irregular, distance,
        1.45 + Math.sin(angle) * .72 * irregular]);
    }
    const crown = streetPolygon(renderer, canopy, '#71845f');
    const sunlit = streetPolygon(renderer, canopy.map(([x, d, z]) => [
      lane + side * .1 + (x - lane) * .57, d - .002, 1.62 + (z - 1.45) * .58,
    ]), '#8d9c70');
    const points = [...(trunk ?? []), ...(crown ?? []), ...(sunlit ?? []), root];
    bounds = boundsFromPoints(points, .8);
  }
  ctx.restore();

  recordStreetUnit(renderer, id, 'road_landmark', bounds, alpha,
    lane - side * .59, lane + side * .59);
}

function makeStreetBuildings(scrollDistance) {
  const buildings = [];
  for (const side of [-1, 1]) {
    const offset = side < 0 ? 1.25 : 3.85;
    const first = Math.floor((scrollDistance + STREET_NEAR_DISTANCE - offset - 4) / STREET_LOT_SPACING);
    const last = Math.ceil((scrollDistance + STREET_HORIZON_DISTANCE - offset) / STREET_LOT_SPACING);
    for (let slot = first; slot <= last; slot++) {
      const startWorld = offset + slot * STREET_LOT_SPACING;
      const distance = startWorld - scrollDistance;
      const kind = streetBuildingKind(side, slot);
      const dimensions = buildingDimensions(kind, side, slot);
      buildings.push({ side, slot, kind, startWorld, distance, ...dimensions });
    }
  }
  return buildings.sort((a, b) => b.distance - a.distance);
}

function drawStreetBuildings(renderer, scrollDistance) {
  const buildings = makeStreetBuildings(scrollDistance);
  for (const building of buildings) {
    drawStreetGroundLot(renderer, building, scrollDistance);
    drawStreetBuilding(renderer, building, scrollDistance);
    drawStreetFrontageTree(renderer, building, scrollDistance);
    if (building.kind === 'convenience') drawStreetVending(renderer, building, scrollDistance);
  }
  return buildings;
}

function drawStreetTree(renderer, side, slot, worldDistance, scrollDistance) {
  const distance = worldDistance - scrollDistance;
  if (distance < STREET_NEAR_DISTANCE || distance > STREET_HORIZON_DISTANCE) return;
  const fade = streetVisibility(distance);
  if (fade < .005) return;
  const id = 'street-tree:' + side + ':' + slot;
  if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5, essential: true })) return;
  const lane = side * (5.65 + (stableHash(id) % 3) * .22);
  const ground = streetGround(renderer, lane, distance);
  const leftCrown = streetElevated(renderer, lane - side * .64, distance, 3.15);
  const rightCrown = streetElevated(renderer, lane + side * .64, distance, 3.15);
  const top = streetElevated(renderer, lane, distance, 4.45);
  const trunkTop = streetElevated(renderer, lane, distance, 2.7);
  if (!ground || !leftCrown || !rightCrown || !top || !trunkTop
    || ground.y < -renderer.height * .15 || ground.y > renderer.height * 1.08) return;
  const c = renderer.ctx;
  const alpha = c.globalAlpha * fade;
  c.save(); c.globalAlpha *= fade;
  const unit = Math.max(.3, Math.min(renderer.width / 390, renderer.height / 680));
  const scale = Math.max(.12, ground.scale);
  const bounds = [];

  const shadow = streetGround(renderer, lane, distance);
  const crownWidth = renderer.width * .235 * ground.scale
    * (.94 + (stableHash('street-tree-width:' + id) % 35) / 100);
  const crownHeight = crownWidth * 240 / 189;
  if (shadow) renderer.ellipse(shadow.x, shadow.y + 1.5 * scale,
    crownWidth * .29, Math.max(1.2, crownWidth * .055), '#514d3d24');
  if (drawFoliage(c, ground.x, ground.y, crownWidth, 'tree')) {
    bounds.push({ x: ground.x - crownWidth / 2, y: ground.y - crownHeight },
      { x: ground.x + crownWidth / 2, y: ground.y });
    c.restore();
    recordStreetUnit(renderer, id, 'road_landmark', boundsFromPoints(bounds, 1), alpha,
      lane - side * .7, lane + side * .7);
    return;
  }
  const trunk = streetPolygon(renderer, [[lane - side * .095, distance, 0],
    [lane + side * .095, distance, 0], [lane + side * .06, distance, 2.75],
    [lane - side * .06, distance, 2.75]], '#876b50');
  if (trunk) bounds.push(...trunk);
  streetLine(renderer, [lane - side * .02, distance, .22], [lane - side * .01, distance, 2.45], '#ad8b67', Math.max(.45, .65 * scale));
  const branchA = streetElevated(renderer, lane - side * .28, distance, 3.3);
  const branchB = streetElevated(renderer, lane + side * .26, distance, 3.55);
  if (branchA && branchB) {
    segment(c, trunkTop, branchA, '#745c46', Math.max(.65, 1.2 * scale));
    segment(c, trunkTop, branchB, '#745c46', Math.max(.65, 1.2 * scale));
  }

  const crownCenter = lane + side * .015;
  const crown = (centerLane, centerElevation, radiusLane, radiusHeight, color, seed) => {
    const vertices = [];
    const leaves = 17;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const angle = (leaf / leaves) * Math.PI * 2;
      const irregular = .84 + (stableHash(seed + ':' + leaf) % 30) / 100;
      const scallop = leaf % 2 === 0 ? 1.04 : .91;
      vertices.push([centerLane + Math.cos(angle) * radiusLane * irregular * scallop, distance,
        centerElevation + Math.sin(angle) * radiusHeight * irregular * scallop]);
    }
    const result = streetPolygon(renderer, vertices, color);
    if (result) bounds.push(...result);
  };
  const tint = stableHash('tree-color:' + id) % 4;
  const shadowGreen = ['#50684f', '#596d4f', '#526b57', '#5e7151'][tint];
  const leafGreen = ['#718762', '#7b8d63', '#6f8566', '#82916a'][tint];
  const sunGreen = ['#929f73', '#9ca77a', '#8d9e76', '#a4aa7e'][tint];
  const radiusX = Math.max(2, Math.abs(rightCrown.x - leftCrown.x) * .54);
  crown(crownCenter, 3.54, .67, .88, shadowGreen, id + ':crown');
  crown(crownCenter - side * .16, 3.77, .43, .51, leafGreen, id + ':upper');
  crown(crownCenter + side * .18, 3.34, .43, .48, leafGreen, id + ':lower');
  crown(crownCenter - side * .2, 3.94, .23, .27, sunGreen, id + ':sunlit');
  bounds.push(...[ground, trunkTop, leftCrown, rightCrown, top]);
  c.restore();
  recordStreetUnit(renderer, id, 'road_landmark', boundsFromPoints(bounds, radiusX), alpha,
    lane - side * .7, lane + side * .7);
}

function drawStreetTrees(renderer, scrollDistance) {
  for (const side of [-1, 1]) {
    const spacing = 7.65;
    const offset = side < 0 ? 6.8 : 12.2;
    const first = Math.floor((scrollDistance + STREET_NEAR_DISTANCE - offset) / spacing);
    const last = Math.ceil((scrollDistance + STREET_HORIZON_DISTANCE - offset) / spacing);
    for (let slot = first; slot <= last; slot++) {
      const worldDistance = offset + slot * spacing;
      if (stableHash('street-tree-on:' + side + ':' + slot) % 5 === 1) continue;
      drawStreetTree(renderer, side, slot, worldDistance, scrollDistance);
    }
  }
}

function drawStreetVending(renderer, building, scrollDistance) {
  const { side, slot, startWorld } = building;
  const distance = startWorld + .85 - scrollDistance;
  if (distance < STREET_NEAR_DISTANCE || distance > STREET_HORIZON_DISTANCE) return;
  const fade = streetVisibility(Math.max(0, distance));
  if (fade < .005) return;
  const id = 'street-vending:' + side + ':' + slot;
  if (!roadDecorationAllowed(renderer, id, { near: distance < 1.5, essential: true })) return;
  const lane = side * 2.42;
  const width = .32, height = 1.72;
  const c = renderer.ctx;
  const alpha = c.globalAlpha * fade;
  const base = streetGround(renderer, lane, distance);
  if (!base || base.y < -renderer.height * .2 || base.y > renderer.height * 1.08) return;
  const points = [];
  c.save(); c.globalAlpha *= fade;
  const body = streetPolygon(renderer, [[lane - side * width / 2, distance, 0],
    [lane + side * width / 2, distance, 0], [lane + side * width / 2, distance, height],
    [lane - side * width / 2, distance, height]], '#e2ded0');
  if (body) points.push(...body);
  const sideFace = streetPolygon(renderer, [[lane + side * width / 2, distance, 0],
    [lane + side * width / 2, distance + .07, 0], [lane + side * width / 2, distance + .07, height],
    [lane + side * width / 2, distance, height]], '#beb9ab');
  if (sideFace) points.push(...sideFace);
  const display = streetPolygon(renderer, [[lane - side * .105, distance - .01, .72],
    [lane + side * .105, distance - .01, .72], [lane + side * .105, distance - .01, 1.55],
    [lane - side * .105, distance - .01, 1.55]], '#91aaa4');
  if (display) points.push(...display);
  for (let row = 0; row < 3; row++) {
    const e = 1.43 - row * .22;
    for (let column = 0; column < 2; column++) {
      const center = lane + side * (column ? .055 : -.055);
      streetPolygon(renderer, [[center - side * .035, distance - .018, e],
        [center + side * .035, distance - .018, e], [center + side * .035, distance - .018, e + .1],
        [center - side * .035, distance - .018, e + .1]], (row + column) % 2 ? '#d7aa6c' : '#c7795f');
    }
  }
  streetLine(renderer, [lane - side * width / 2, distance - .02, .55],
    [lane + side * width / 2, distance - .02, .55], '#a86d50', .7);
  c.restore();
  recordStreetUnit(renderer, id, 'road_landmark', boundsFromPoints(points, .5), alpha,
    lane - side * width / 2, lane + side * width / 2);
}

function drawStreetPower(renderer, scrollDistance) {
  const c = renderer.ctx;
  const spacing = 9.6;
  const pointsBySide = new Map();
  for (const side of [-1, 1]) {
    const offset = side < 0 ? 7.4 : 14.6;
    const first = Math.floor((scrollDistance + STREET_NEAR_DISTANCE - offset) / spacing);
    const last = Math.ceil((scrollDistance + STREET_HORIZON_DISTANCE - offset) / spacing);
    const poles = [];
    for (let slot = first; slot <= last; slot++) {
      const world = offset + slot * spacing;
      const distance = world - scrollDistance;
      if (distance < STREET_NEAR_DISTANCE || distance > STREET_HORIZON_DISTANCE) continue;
      const poleId = 'street-pole:' + side + ':' + slot;
      if (!roadDecorationAllowed(renderer, poleId, { essential: true })) continue;
      const lane = side * 2.63;
      const foot = streetGround(renderer, lane, distance);
      const top = streetElevated(renderer, lane, distance, 5.55);
      const cap = streetElevated(renderer, lane, distance, 5.86);
      const armA = streetElevated(renderer, lane - side * .46, distance, 5.61);
      const armB = streetElevated(renderer, lane + side * .46, distance, 5.61);
      if (!foot || !top || !cap || !armA || !armB || foot.y < -renderer.height * .15 || foot.y > renderer.height * 1.08) continue;
      const fade = streetVisibility(Math.max(0, distance));
      if (fade < .005) continue;
      const unit = Math.max(.2, foot.scale);
      const alpha = c.globalAlpha * fade;
      c.save(); c.globalAlpha *= fade;
      segment(c, foot, top, '#765f4b', Math.max(.7, 2.2 * unit));
      segment(c, { x: foot.x - side * .7 * unit, y: foot.y },
        { x: top.x - side * .7 * unit, y: top.y }, '#ad9071', Math.max(.4, .7 * unit));
      segment(c, armA, armB, '#755f4b', Math.max(.75, 1.7 * unit));
      segment(c, { x: armA.x, y: armA.y + 2.4 * unit }, { x: armB.x, y: armB.y + 2.4 * unit }, '#a89072', Math.max(.35, .55 * unit));
      for (const arm of [armA, armB]) renderer.ellipse(arm.x, arm.y - 1.1 * unit, 1.35 * unit, 1.35 * unit, '#e0d3b9');
      const bounds = boundsFromPoints([foot, top, cap, armA, armB], 2 * unit);
      c.restore();
      recordStreetUnit(renderer, poleId, 'road_landmark', bounds, alpha,
        lane - side * .46, lane + side * .46);
      poles.push({ side, slot, world, distance, lane, top, fade });
    }
    poles.sort((a, b) => a.world - b.world);
    pointsBySide.set(side, poles);
  }

  // Utility wires stay on the same roadside network. They sag gently between
  // poles and never cross the dog or obstacle lanes.
  for (const side of [-1, 1]) {
    const poles = pointsBySide.get(side) ?? [];
    for (let index = 0; index < poles.length - 1; index++) {
      const a = poles[index], b = poles[index + 1];
      if (b.world - a.world > spacing * 1.1) continue;
      const fade = Math.min(a.fade, b.fade);
      if (fade < .005) continue;
      const id = 'street-wire:' + side + ':' + a.slot;
      if (!roadDecorationAllowed(renderer, id, { essential: true })) continue;
      const sag = .48;
      const p0 = streetElevated(renderer, a.lane, a.distance, 5.58);
      const p1 = streetElevated(renderer, a.lane, a.distance + (b.distance - a.distance) / 3, 5.58 - sag * .8);
      const p2 = streetElevated(renderer, b.lane, b.distance - (b.distance - a.distance) / 3, 5.58 - sag * .8);
      const p3 = streetElevated(renderer, b.lane, b.distance, 5.58);
      if (!p0 || !p1 || !p2 || !p3) continue;
      c.save(); c.globalAlpha *= .64 * fade;
      c.beginPath(); c.moveTo(p0.x, p0.y);
      if (typeof c.bezierCurveTo === 'function') {
        c.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      } else {
        c.lineTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.lineTo(p3.x, p3.y);
      }
      c.strokeStyle = '#625b50'; c.lineWidth = .8; c.stroke();
      const alpha = c.globalAlpha; c.restore();
      recordStreetUnit(renderer, id, 'road_landmark', boundsFromPoints([p0, p1, p2, p3], 1), alpha,
        a.lane - side * .02, b.lane + side * .02);
    }
  }
}

function drawProjectedLandscape(renderer, timeMs, scrollDistance, holdMotion = false) {
  const { width: w, height: h } = renderer;
  const horizonPoint = streetGround(renderer, 0, STREET_HORIZON_DISTANCE);
  if (!horizonPoint) return;
  const horizon = Math.max(h * .12, Math.min(h * .32, horizonPoint.y));
  const freeze = holdMotion || renderer.reducedMotion || renderer.roadComfortFlags?.farParallax === false;
  drawStreetSky(renderer, horizon, freeze ? 0 : timeMs / 1000, freeze);
  drawStreetHorizon(renderer, horizon);
  drawStreetGroundStrips(renderer, scrollDistance);
  drawStreetTrees(renderer, scrollDistance);
  drawStreetPower(renderer, scrollDistance);
  drawStreetBuildings(renderer, scrollDistance);

  // Narrow center dashes are lightly textured and remain subordinate to the
  // dog, bones and hazard silhouettes. Small interruptions make the road feel
  // residential rather than like a marked highway.
  const c = renderer.ctx;
  const first = Math.floor((scrollDistance + STREET_NEAR_DISTANCE) / 5.2);
  const last = Math.ceil((scrollDistance + STREET_HORIZON_DISTANCE) / 5.2);
  for (let index = first; index <= last; index++) {
    const distance = index * 5.2 - scrollDistance;
    if (distance < STREET_NEAR_DISTANCE || distance > STREET_HORIZON_DISTANCE || index % 4 === 1) continue;
    const id = 'street-center-dash:' + index;
    if (!roadDecorationAllowed(renderer, id)) continue;
    const start = streetGround(renderer, 0, distance);
    const end = streetGround(renderer, 0, Math.min(STREET_HORIZON_DISTANCE, distance + .72));
    if (!start || !end) continue;
    const alpha = c.globalAlpha;
    c.save(); c.globalAlpha *= .115;
    segment(c, start, end, '#eee8d9', Math.max(.5, .95 * start.scale));
    const bounds = boundsFromPoints([start, end], Math.max(.5, .95 * start.scale));
    const fade = streetVisibility(distance);
    c.restore();
    recordRoadUnit(renderer, id, 'road_texture', bounds, alpha * fade);
  }
}

export function getAdventureStage(timeMs) {
  const time = finiteTime(timeMs);
  if (time < 10_000) return STAGES[0];
  if (time < 20_000) return STAGES[1];
  return STAGES[2];
}

export class AdventureScene {
  constructor() {
    // The street's optional atlases settle independently of gameplay startup.
    this.ready = Promise.all([STREET_MATERIALS.ready, STREET_FACADE_ART.ready,
      STREET_FOLIAGE_ART.ready, STREET_VARIANT_ART.ready]).then(() => this);
  }

  get stats() {
    return Object.freeze({
      renderer: 'perspective-textured-street',
      materials: STREET_MATERIALS.stats,
      facades: STREET_FACADE_ART.stats,
      foliage: STREET_FOLIAGE_ART.stats,
      variants: STREET_VARIANT_ART.stats,
      legacy: NEIGHBORHOOD_ART.stats,
    });
  }

  draw(renderer, game, { menu = false, timeMs = 0 } = {}) {
    const w = renderer.width, h = renderer.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    const frameTime = menu ? finiteTime(timeMs) : finiteTime(game?.timeMs);
    const distance = sceneDistance(renderer, game, menu);
    if (!menu && renderer.streetPerspective) {
      drawProjectedLandscape(renderer, frameTime, distance, Boolean(game && game.state !== 'running'));
      return;
    }
    drawLandscape(renderer, frameTime, Boolean(menu), distance);
  }
}
