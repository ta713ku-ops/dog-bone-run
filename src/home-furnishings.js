import { homeDogLayout } from './home-presence.js';

const BED_URL = new URL('../art/home-shop/bed.webp', import.meta.url);
const PLUSH_URL = new URL('../art/home-shop/plush.webp', import.meta.url);
const BALL_URL = new URL('../art/home-toys-v2/ball.webp', import.meta.url);
const ROPE_URL = new URL('../art/home-toys-v2/rope.webp', import.meta.url);
const OAT_URL = new URL('../art/home-shop/rug-oat.webp', import.meta.url);
const SAGE_URL = new URL('../art/home-shop/rug-sage.webp', import.meta.url);
const PLANT_URL = new URL('../art/home-customization/plant.webp', import.meta.url);
const LANTERN_URL = new URL('../art/home-customization/lantern.webp', import.meta.url);
const SLOT_IDS = Object.freeze({
  rug: new Set(['rug-oat', 'rug-sage']),
  bed: new Set(['bed']),
  toy: new Set(['starterBall', 'plush', 'rope']),
  decor: new Set(['decor-plant', 'decor-lantern']),
});
const ITEM_SLOT = Object.freeze({
  'rug-oat': 'rug', 'rug-sage': 'rug', bed: 'bed',
  starterBall: 'toy', plush: 'toy', rope: 'toy',
  'decor-plant': 'decor', 'decor-lantern': 'decor',
});
const ASSET_URLS = Object.freeze({
  bed: BED_URL, plush: PLUSH_URL, starterBall: BALL_URL, rope: ROPE_URL,
  'rug-oat': OAT_URL, 'rug-sage': SAGE_URL,
  'decor-plant': PLANT_URL, 'decor-lantern': LANTERN_URL,
});
const MAX_ART_EDGE = 1024;
const MAX_ART_PIXELS = 1_048_576;
const DEFAULT_ART_TIMEOUT_MS = 5000;

function validViewport(width, height) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 160 && height >= 180
    && width <= 10_000 && height <= 10_000;
}

function validDrawSize(width, height) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0 && width <= 10_000 && height <= 10_000;
}

function rect(x, y, width, height) {
  return {
    x, y, width, height,
    left: x, top: y, right: x + width, bottom: y + height,
    centerX: x + width / 2, centerY: y + height / 2,
  };
}

/**
 * Fixed room slots derived from the existing dog pose. All slots remain in the
 * lower floor band; the renderer paints them before the live dog.
 */
export function homeFurnitureLayout(width, height) {
  if (!validViewport(width, height)) return null;

  const dog = homeDogLayout(width, height);
  const dogTouchRight = dog.touch?.left + dog.touch?.width;
  if (![dog.x, dog.foot, dog.size, dog.touch?.left, dogTouchRight].every(Number.isFinite)
    || dog.size <= 0) return null;

  const floorLineY = height * .64;
  const rugWidth = Math.min(width * .995, height * 1.25);
  const rugHeight = Math.min(rugWidth * .34, dog.size * .74, height * .28);
  const rug = rect((width - rugWidth) / 2, floorLineY - rugHeight - .01, rugWidth, rugHeight);

  const sideMargin = Math.max(4, width * .02);
  const sideGap = Math.max(3, width * .01);
  const dogTouchWidth = dog.touch.width;
  // Keep the bed centered under the dog while leaving a clear floor strip on
  // both sides for the two independent small-object slots.
  const bedWidth = Math.min(dog.size * 1.06, width * .72, dogTouchWidth + sideGap * 2);
  const bedHeight = bedWidth / (640 / 166);
  const bed = rect(dog.x - bedWidth / 2, floorLineY - bedHeight - .01, bedWidth, bedHeight);

  const decorRight = Math.min(bed.left, dog.touch.left - sideGap);
  const toyLeft = Math.max(bed.right, dogTouchRight + sideGap);
  const leftSpace = Math.max(0, decorRight - sideMargin);
  const rightSpace = Math.max(0, width - sideMargin - toyLeft);
  const targetSideWidth = Math.min(width * .16, height * .17);
  const decorWidth = Math.min(targetSideWidth, leftSpace);
  const decorHeight = Math.min(decorWidth * 1.35, height * .34, floorLineY - height * .30);
  const decor = rect(decorRight - decorWidth, floorLineY - decorHeight, decorWidth, decorHeight);
  const toyWidth = Math.min(targetSideWidth, rightSpace);
  const toyHeight = Math.min(toyWidth, height * .34, floorLineY - height * .30);
  const toy = rect(toyLeft, floorLineY - toyHeight, toyWidth, toyHeight);

  const minTop = height * .30;
  // Subtraction followed by addition can overshoot the floor by a few ULPs
  // (e.g. decor.bottom at 320x954). Ignore only numerical roundoff, otherwise
  // one innocent slot would suppress every equipped item in the scene.
  const roundingTolerance = Number.EPSILON * Math.max(width, height) * 8;
  for (const box of [rug, bed, decor, toy]) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0
      || box.left < -roundingTolerance || box.right > width + roundingTolerance
      || box.top < minTop - roundingTolerance || box.bottom > floorLineY + roundingTolerance) return null;
  }

  const clearOfDog = box => box.right <= dog.touch.left - sideGap + .01
    || box.left >= dogTouchRight + sideGap - .01;
  if (![decor, toy].every(clearOfDog)) return null;

  return { width, height, dog, floorLineY, slots: { rug, bed, decor, toy } };
}

function addStops(gradient, stops) {
  if (!gradient?.addColorStop) return null;
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function linear(ctx, x0, y0, x1, y1, stops, fallback) {
  try {
    return addStops(ctx.createLinearGradient(x0, y0, x1, y1), stops) ?? fallback;
  } catch {
    return fallback;
  }
}

function radial(ctx, x0, y0, r0, x1, y1, r1, stops, fallback) {
  try {
    return addStops(ctx.createRadialGradient(x0, y0, r0, x1, y1, r1), stops) ?? fallback;
  } catch {
    return fallback;
  }
}

function groundShadowColor(environment, alpha = .23) {
  return environment === 'garden'
    ? `rgba(36, 65, 42, ${alpha})`
    : `rgba(58, 43, 31, ${alpha})`;
}

function drawContactShadow(ctx, box, environment, widthRatio = .58, heightRatio = .12, { alignToBottom = false } = {}) {
  const radiusY = Math.max(.9, box.height * heightRatio);
  const centerY = alignToBottom ? box.bottom - radiusY : box.bottom - box.height * .035;
  ellipse(ctx, box.centerX, centerY,
    box.width * widthRatio / 2, radiusY,
    groundShadowColor(environment, environment === 'garden' ? .24 : .22));
}

function ellipse(ctx, x, y, radiusX, radiusY, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(.01, radiusX), Math.max(.01, radiusY), 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawWovenRug(ctx, box, colorway, environment = 'indoor') {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width * .49;
  const ry = height * .47;
  const oat = colorway === 'rug-oat';
  const colors = oat
    ? { top: '#eee3d0', middle: '#ddc9aa', bottom: '#c3a47a', edge: '#967953', weave: 'rgba(111,79,48,.20)', glint: 'rgba(255,248,231,.43)' }
    : { top: '#d5ddc4', middle: '#adb994', bottom: '#82916f', edge: '#667657', weave: 'rgba(55,73,47,.22)', glint: 'rgba(244,248,223,.40)' };

  ctx.save();
  ctx.shadowColor = groundShadowColor(environment, .28);
  ctx.shadowBlur = Math.min(5, height * .055);
  ctx.shadowOffsetY = Math.min(2.5, height * .035);
  ellipse(ctx, cx, cy + height * .035, rx, ry, groundShadowColor(environment, .27));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const surface = linear(ctx, cx, y, cx, y + height, [
    [0, colors.top], [.48, colors.middle], [1, colors.bottom],
  ], colors.middle);
  ellipse(ctx, cx, cy, rx, ry, surface, colors.edge, Math.max(.8, height * .018));

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * .965, ry * .91, 0, 0, Math.PI * 2);
  ctx.clip();

  const weaveWidth = Math.max(.42, Math.min(1.05, height * .012));
  const rows = Math.max(10, Math.min(30, Math.round(height * .31)));
  ctx.lineWidth = weaveWidth;
  for (let row = 0; row < rows; row += 1) {
    const u = (row + .5) / rows * 2 - 1;
    const py = cy + u * ry * .85;
    const span = rx * Math.sqrt(Math.max(0, 1 - (u * .91) ** 2)) * .96;
    ctx.beginPath();
    ctx.moveTo(cx - span, py);
    ctx.lineTo(cx + span, py);
    ctx.strokeStyle = row % 2 ? colors.weave : colors.glint;
    ctx.stroke();
  }

  const columns = Math.max(12, Math.min(40, Math.round(width / 11)));
  for (let column = 0; column < columns; column += 1) {
    const u = (column + .5) / columns * 2 - 1;
    const px = cx + u * rx * .91;
    const span = ry * Math.sqrt(Math.max(0, 1 - (u * .94) ** 2)) * .85;
    ctx.beginPath();
    ctx.moveTo(px, cy - span);
    ctx.lineTo(px, cy + span);
    ctx.strokeStyle = column % 2 ? colors.glint : colors.weave;
    ctx.stroke();
  }
  ctx.restore();

  ellipse(ctx, cx, cy, rx * .92, ry * .82, null, 'rgba(255, 249, 232, .62)', Math.max(.7, height * .014));
  ellipse(ctx, cx, cy, rx * .875, ry * .76, null, 'rgba(91, 69, 46, .18)', Math.max(.45, height * .009));
  ctx.restore();
}

function drawNativeBed(ctx, box, environment = 'indoor') {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  const baseY = y + height * .56;
  ctx.save();
  ctx.shadowColor = groundShadowColor(environment, .32);
  ctx.shadowBlur = Math.min(4, height * .13);
  ctx.shadowOffsetY = Math.min(2, height * .07);
  ellipse(ctx, cx, y + height * .79, width * .47, height * .18, groundShadowColor(environment, .30));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const cushion = linear(ctx, cx, y + height * .16, cx, y + height * .9, [
    [0, '#f0e4d2'], [.55, '#d5c1a6'], [1, '#b59a79'],
  ], '#d8c4a8');
  ellipse(ctx, cx, baseY, width * .49, height * .39, cushion, '#9d8161', Math.max(.8, height * .045));
  ellipse(ctx, cx, y + height * .52, width * .405, height * .245,
    linear(ctx, cx, y + height * .31, cx, y + height * .72, [
      [0, '#f4ebdd'], [1, '#d8c5a9'],
    ], '#eadcc8'), 'rgba(255, 248, 236, .75)', Math.max(.6, height * .025));

  ctx.beginPath();
  ctx.moveTo(x + width * .18, y + height * .64);
  ctx.quadraticCurveTo(cx, y + height * .73, x + width * .82, y + height * .64);
  ctx.strokeStyle = 'rgba(133, 105, 76, .42)';
  ctx.lineWidth = Math.max(.6, height * .022);
  ctx.stroke();
  ctx.restore();
}

function drawBall(ctx, box, environment = 'indoor', { contactShadow = true } = {}) {
  const { x, y, width, height } = box;
  const diameter = Math.min(width * .90, height * .94);
  const radius = diameter / 2;
  const cx = x + width * .5;
  const cy = box.bottom - radius * .97;
  ctx.save();
  if (contactShadow) drawContactShadow(ctx, box, environment, .72, .12, { alignToBottom: true });
  const fill = radial(ctx, cx - radius * .34, cy - radius * .42, radius * .06, cx, cy, radius * 1.24, [
    [0, '#f4f0e4'], [.38, '#dce0cd'], [.76, '#b5bea1'], [1, '#8f9b82'],
  ], '#c7ceb8');
  ellipse(ctx, cx, cy, radius, radius * .97, fill, 'rgba(91, 103, 78, .28)', Math.max(.6, radius * .025));
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * .98, radius * .95, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - radius * .92, cy - radius * .18);
  ctx.quadraticCurveTo(cx - radius * .04, cy - radius * .48, cx + radius * .88, cy - radius * .10);
  ctx.moveTo(cx - radius * .18, cy - radius * .92);
  ctx.quadraticCurveTo(cx + radius * .40, cy, cx - radius * .16, cy + radius * .92);
  ctx.strokeStyle = 'rgba(246, 242, 228, .72)';
  ctx.lineWidth = Math.max(.7, radius * .035);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - radius * .92, cy - radius * .18);
  ctx.quadraticCurveTo(cx - radius * .04, cy - radius * .48, cx + radius * .88, cy - radius * .10);
  ctx.strokeStyle = 'rgba(112, 127, 96, .28)';
  ctx.lineWidth = Math.max(.4, radius * .012);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawNativePlush(ctx, box, environment = 'indoor', { contactShadow = true } = {}) {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const unit = Math.min(width, height);
  ctx.save();
  if (contactShadow) drawContactShadow(ctx, box, environment, .70, .11);
  ellipse(ctx, cx - width * .22, cy - height * .18, width * .12, height * .26,
    linear(ctx, x, cy - height * .4, x + width, cy + height * .1, [[0, '#f1d6b2'], [1, '#9b6745']], '#bd8961'));
  ellipse(ctx, cx + width * .22, cy - height * .18, width * .12, height * .26,
    linear(ctx, x, cy - height * .4, x + width, cy + height * .1, [[0, '#f1d6b2'], [1, '#9b6745']], '#bd8961'));
  ellipse(ctx, cx, cy + height * .08, width * .38, height * .32,
    linear(ctx, cx, cy - height * .28, cx, cy + height * .37, [[0, '#e6c49e'], [1, '#9b6848']], '#c08b62'), '#88583d', Math.max(.6, unit * .025));
  ellipse(ctx, cx, cy - height * .08, width * .29, height * .32,
    linear(ctx, cx, cy - height * .42, cx, cy + height * .06, [[0, '#f0d8b9'], [1, '#b27a53']], '#d0a078'));
  ellipse(ctx, cx, cy + height * .015, width * .145, height * .12, '#f3e5d2');
  ellipse(ctx, cx - width * .085, cy - height * .11, unit * .032, unit * .032, '#4d382c');
  ellipse(ctx, cx + width * .085, cy - height * .11, unit * .032, unit * .032, '#4d382c');
  ellipse(ctx, cx, cy - height * .035, unit * .035, unit * .028, '#6b4534');

  // A quiet stitched seam and a few soft flecks keep the small fabric form readable.
  ctx.beginPath();
  ctx.moveTo(cx - width * .25, cy + height * .23);
  ctx.quadraticCurveTo(cx, cy + height * .34, cx + width * .25, cy + height * .23);
  ctx.strokeStyle = 'rgba(112, 75, 50, .55)';
  ctx.lineWidth = Math.max(.65, unit * .018);
  ctx.stroke();
  for (const [dx, dy] of [[-.20, .10], [-.13, .21], [.16, .12], [.22, .02]]) {
    ellipse(ctx, cx + width * dx, cy + height * dy, unit * .012, unit * .012, 'rgba(255, 235, 209, .58)');
  }
  ctx.restore();
}

function drawBraidedRope(ctx, box, environment = 'indoor', { contactShadow = true } = {}) {
  const { x, y, width, height } = box;
  const unit = Math.min(width, height);
  const knotRadius = Math.min(unit * .12, height * .20);
  const ropeWidth = Math.max(1.8, unit * .22);
  const amplitude = Math.min(height * .12, unit * .085);
  const middle = box.bottom - Math.max(knotRadius, amplitude) - ropeWidth / 2;
  const left = x + width * .12;
  const right = x + width * .88;
  const points = [];
  const count = 64;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push({ x: left + (right - left) * t, y: middle + Math.sin(t * Math.PI * 2.2) * amplitude });
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (contactShadow) drawContactShadow(ctx, rect(x + width * .08, box.bottom - knotRadius * 2.1, width * .84, knotRadius * 2.1),
    environment, .96, .18, { alignToBottom: true });
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = '#ded3bd';
  ctx.lineWidth = ropeWidth;
  ctx.stroke();

  // Muted sage and ivory crossings suggest twisted cotton without the hard
  // dark bands that made the earlier fallback look like varnished cord.
  const braidStep = Math.max(2.4, unit * .15);
  const braidLength = unit * .16;
  for (let distance = braidStep / 2, index = 0; distance < right - left; distance += braidStep, index += 1) {
    const t = distance / (right - left);
    const pointIndex = Math.min(count - 1, Math.floor(t * count));
    const a = points[pointIndex];
    const b = points[pointIndex + 1];
    const tangentX = b.x - a.x;
    const tangentY = b.y - a.y;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const nx = -tangentY / length;
    const ny = tangentX / length;
    const px = (a.x + b.x) / 2;
    const py = (a.y + b.y) / 2;
    ctx.beginPath();
    ctx.moveTo(px - nx * braidLength, py - ny * braidLength);
    ctx.lineTo(px + nx * braidLength, py + ny * braidLength);
    ctx.strokeStyle = index % 2 ? '#a4ad91' : '#f2ead9';
    ctx.lineWidth = Math.max(.7, unit * .075);
    ctx.stroke();
  }

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y - unit * .065) : ctx.moveTo(point.x, point.y - unit * .065));
  ctx.strokeStyle = 'rgba(255, 255, 255, .48)';
  ctx.lineWidth = Math.max(.55, unit * .025);
  ctx.stroke();

  const knotY = box.bottom - knotRadius;
  for (const [endX, flip] of [[left, 1], [right, -1]]) {
    ellipse(ctx, endX, knotY, knotRadius * .82, knotRadius, '#c8d0b8');
    ellipse(ctx, endX + flip * knotRadius * .22, knotY - knotRadius * .12,
      knotRadius * .48, knotRadius * .76, '#f0e8d8');
    ellipse(ctx, endX - flip * knotRadius * .18, knotY + knotRadius * .13,
      knotRadius * .46, knotRadius * .70, '#9da88e');
  }
  ctx.restore();
}

function drawLeaf(ctx, baseX, baseY, tipX, tipY, leafWidth, color) {
  const dx = tipX - baseX;
  const dy = tipY - baseY;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const midX = (baseX + tipX) / 2;
  const midY = (baseY + tipY) / 2;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.quadraticCurveTo(midX + nx * leafWidth * .78, midY + ny * leafWidth * .78, tipX, tipY);
  ctx.quadraticCurveTo(midX - nx * leafWidth * .78, midY - ny * leafWidth * .78, baseX, baseY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 67, 41, .68)';
  ctx.lineWidth = Math.max(.65, leafWidth * .055);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.quadraticCurveTo(midX + nx * leafWidth * .12, midY + ny * leafWidth * .12,
    baseX + dx * .84, baseY + dy * .84);
  ctx.strokeStyle = 'rgba(232, 240, 205, .48)';
  ctx.lineWidth = Math.max(.55, leafWidth * .035);
  ctx.stroke();
}

function drawNativePlant(ctx, box, environment = 'indoor') {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  const potTop = y + height * .70;
  const floor = y + height * .97;
  ctx.save();
  drawContactShadow(ctx, box, environment, .72, .10);

  const leaves = [
    { base: [.50, .72], tip: [.12, .34], width: .28, color: '#75915b' },
    { base: [.48, .70], tip: [.25, .18], width: .27, color: '#91a96c' },
    { base: [.49, .68], tip: [.49, .08], width: .27, color: '#6e8d54' },
    { base: [.52, .70], tip: [.77, .19], width: .28, color: '#9caf73' },
    { base: [.53, .72], tip: [.91, .38], width: .25, color: '#668653' },
    { base: [.48, .73], tip: [.30, .42], width: .22, color: '#a5b880' },
    { base: [.53, .73], tip: [.72, .39], width: .23, color: '#7d995f' },
  ];
  ctx.lineCap = 'round';
  for (const leaf of leaves) {
    const baseX = x + width * leaf.base[0];
    const baseY = y + height * leaf.base[1];
    const tipX = x + width * leaf.tip[0];
    const tipY = y + height * leaf.tip[1];
    ctx.beginPath();
    ctx.moveTo(cx, potTop + height * .02);
    ctx.quadraticCurveTo((cx + baseX) / 2, y + height * .48, baseX, baseY);
    ctx.strokeStyle = '#52764b';
    ctx.lineWidth = Math.max(1, width * .035);
    ctx.stroke();
    drawLeaf(ctx, baseX, baseY, tipX, tipY, width * leaf.width, leaf.color);
  }

  const potFill = linear(ctx, cx, potTop, cx, floor, [
    [0, '#d69a6b'], [.52, '#bc7950'], [1, '#985b3d'],
  ], '#bd8058');
  ctx.beginPath();
  ctx.moveTo(x + width * .29, potTop);
  ctx.lineTo(x + width * .71, potTop);
  ctx.lineTo(x + width * .64, floor);
  ctx.quadraticCurveTo(cx, floor + height * .015, x + width * .36, floor);
  ctx.closePath();
  ctx.fillStyle = potFill;
  ctx.fill();
  ctx.strokeStyle = '#81513a';
  ctx.lineWidth = Math.max(.8, width * .025);
  ctx.stroke();
  ellipse(ctx, cx, potTop + height * .012, width * .235, height * .052, '#dca477', '#87563d', Math.max(.7, width * .018));
  ellipse(ctx, cx, potTop + height * .012, width * .185, height * .029, '#4f4032');
  ctx.beginPath();
  ctx.moveTo(x + width * .40, floor - height * .06);
  ctx.quadraticCurveTo(cx, floor - height * .035, x + width * .60, floor - height * .06);
  ctx.strokeStyle = 'rgba(255, 220, 181, .43)';
  ctx.lineWidth = Math.max(.6, width * .018);
  ctx.stroke();
  ctx.restore();
}

function drawNativeLantern(ctx, box, environment = 'indoor') {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  ctx.save();
  drawContactShadow(ctx, box, environment, .68, .10);

  const glow = radial(ctx, cx, y + height * .53, 0, cx, y + height * .53, width * .48, [
    [0, 'rgba(255, 221, 128, .40)'], [.52, 'rgba(255, 207, 91, .18)'], [1, 'rgba(255, 197, 76, 0)'],
  ], 'rgba(255, 218, 126, .18)');
  ellipse(ctx, cx, y + height * .53, width * .47, height * .43, glow);

  ctx.beginPath();
  ctx.arc(cx, y + height * .25, width * .19, Math.PI, Math.PI * 2);
  ctx.strokeStyle = '#705538';
  ctx.lineWidth = Math.max(1.3, width * .045);
  ctx.stroke();

  const glass = linear(ctx, cx, y + height * .34, cx, y + height * .75, [
    [0, '#fff4c5'], [.52, '#f5d578'], [1, '#d69c43'],
  ], '#f0c663');
  ctx.beginPath();
  ctx.moveTo(x + width * .27, y + height * .36);
  ctx.quadraticCurveTo(cx, y + height * .28, x + width * .73, y + height * .36);
  ctx.lineTo(x + width * .68, y + height * .77);
  ctx.quadraticCurveTo(cx, y + height * .83, x + width * .32, y + height * .77);
  ctx.closePath();
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = '#6d5035';
  ctx.lineWidth = Math.max(1, width * .04);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + width * .23, y + height * .35);
  ctx.quadraticCurveTo(cx, y + height * .24, x + width * .77, y + height * .35);
  ctx.lineTo(x + width * .72, y + height * .42);
  ctx.lineTo(x + width * .28, y + height * .42);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, cx, y + height * .25, cx, y + height * .43, [
    [0, '#9a7849'], [1, '#5c4935'],
  ], '#7a5c3d');
  ctx.fill();
  ctx.strokeStyle = '#55432f';
  ctx.lineWidth = Math.max(.8, width * .025);
  ctx.stroke();

  for (const px of [.31, .69]) {
    ctx.beginPath();
    ctx.moveTo(x + width * px, y + height * .39);
    ctx.lineTo(x + width * px, y + height * .77);
    ctx.strokeStyle = '#705539';
    ctx.lineWidth = Math.max(.8, width * .03);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x + width * .28, y + height * .77);
  ctx.quadraticCurveTo(cx, y + height * .84, x + width * .72, y + height * .77);
  ctx.lineTo(x + width * .77, y + height * .86);
  ctx.quadraticCurveTo(cx, y + height * .93, x + width * .23, y + height * .86);
  ctx.closePath();
  ctx.fillStyle = '#77573a';
  ctx.fill();
  ctx.strokeStyle = '#51402f';
  ctx.lineWidth = Math.max(.8, width * .025);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y + height * .45);
  ctx.lineTo(cx, y + height * .61);
  ctx.strokeStyle = '#a66d35';
  ctx.lineWidth = Math.max(1, width * .026);
  ctx.stroke();
  ellipse(ctx, cx, y + height * .63, width * .06, height * .035, '#fff3bf');
  ctx.restore();
}

function imageDimensions(image) {
  if (!image) return null;
  const width = image.naturalWidth || image.videoWidth || image.width;
  const height = image.naturalHeight || image.videoHeight || image.height;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

function drawAsset(ctx, image, box, {
  verticalAlign = 'center', environment = 'indoor', contactShadow = true,
  shadowWidth = .60, shadowHeight = .09, shadowAtBottom = false,
} = {}) {
  const dimensions = imageDimensions(image);
  if (!dimensions || typeof ctx.drawImage !== 'function') return false;
  const scale = Math.min(box.width / dimensions.width, box.height / dimensions.height);
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const x = box.x + (box.width - width) / 2;
  const y = verticalAlign === 'bottom'
    ? box.bottom - height
    : box.y + (box.height - height) / 2;
  try {
    if (contactShadow) {
      drawContactShadow(ctx, rect(x, y, width, height), environment,
        shadowWidth, shadowHeight, { alignToBottom: shadowAtBottom });
    }
    ctx.drawImage(image, x, y, width, height);
    return true;
  } catch {
    return false;
  }
}

function drawFurnitureItemBase(ctx, itemId, box, images = {}, environment = 'indoor', { contactShadow = true } = {}) {
  if (!ctx || !box || !ITEM_SLOT[itemId]) return false;
  if (itemId === 'rug-oat' || itemId === 'rug-sage') {
    if (!drawAsset(ctx, images[itemId], box, {
      verticalAlign: 'bottom', environment, contactShadow: false,
    })) drawWovenRug(ctx, box, itemId, environment);
    return true;
  }
  if (itemId === 'bed') {
    if (!drawAsset(ctx, images.bed, box, {
      verticalAlign: 'bottom', environment, contactShadow: false,
    })) drawNativeBed(ctx, box, environment);
    return true;
  }
  if (itemId === 'starterBall') {
    if (!drawAsset(ctx, images.starterBall, box, {
      verticalAlign: 'bottom', environment, contactShadow, shadowWidth: .72, shadowHeight: .12, shadowAtBottom: true,
    })) drawBall(ctx, box, environment, { contactShadow });
    return true;
  }
  if (itemId === 'plush') {
    if (!drawAsset(ctx, images.plush, box, {
      verticalAlign: 'bottom', environment, contactShadow, shadowWidth: .76, shadowHeight: .12, shadowAtBottom: true,
    })) drawNativePlush(ctx, box, environment, { contactShadow });
    return true;
  }
  if (itemId === 'rope') {
    if (!drawAsset(ctx, images.rope, box, {
      verticalAlign: 'bottom', environment, contactShadow, shadowWidth: .92, shadowHeight: .18, shadowAtBottom: true,
    })) drawBraidedRope(ctx, box, environment, { contactShadow });
    return true;
  }
  if (itemId === 'decor-plant') {
    if (!drawAsset(ctx, images[itemId], box, { verticalAlign: 'bottom', environment })) {
      drawNativePlant(ctx, box, environment);
    }
    return true;
  }
  if (itemId === 'decor-lantern') {
    if (!drawAsset(ctx, images[itemId], box, { verticalAlign: 'bottom', environment })) {
      drawNativeLantern(ctx, box, environment);
    }
    return true;
  }
  return false;
}

function drawFurnitureItem(ctx, itemId, box, images = {}, environment = 'indoor', rotation = 0, options = {}) {
  const angle = Number.isFinite(rotation) ? rotation : 0;
  if (Math.abs(angle) < 1e-8) return drawFurnitureItemBase(ctx, itemId, box, images, environment, options);
  ctx.save();
  ctx.translate(box.centerX, box.centerY);
  ctx.rotate(angle);
  ctx.translate(-box.centerX, -box.centerY);
  const drawn = drawFurnitureItemBase(ctx, itemId, box, images, environment, options);
  ctx.restore();
  return drawn;
}

function outputBox(itemId, slot, geometry) {
  return { itemId, slot, ...geometry };
}

/** Paints items into their room slots. The caller must draw this before the dog. */
export function drawHomeFurniture(ctx, width, height, equipped, { images = {}, preview = false, environment = 'indoor', skipToy = false } = {}) {
  void preview; // Preview uses the exact same art and geometry as committed furniture.
  const layout = homeFurnitureLayout(width, height);
  const result = { rug: null, bed: null, decor: null, toy: null };
  if (!layout || !ctx || !equipped || typeof equipped !== 'object') return result;

  for (const slot of ['rug', 'bed', 'decor', 'toy']) {
    const itemId = equipped[slot];
    if (typeof itemId !== 'string' || !SLOT_IDS[slot].has(itemId)) continue;
    if (slot === 'toy' && skipToy) {
      result[slot] = outputBox(itemId, slot, layout.slots[slot]);
      continue;
    }
    if (!drawFurnitureItem(ctx, itemId, layout.slots[slot], images, environment)) continue;
    result[slot] = outputBox(itemId, slot, layout.slots[slot]);
  }
  return result;
}

/** Draw an equipped item at a sampled play position using the same art and shadow painter as the room slot. */
export function drawHomeFurnitureItem(ctx, itemId, box, { images = {}, environment = 'indoor', rotation = 0, attached = false } = {}) {
  if (!ctx || !box || !ITEM_SLOT[itemId]) return false;
  return drawFurnitureItem(ctx, itemId, box, images, environment, rotation, { contactShadow: !attached });
}

/** Thumbnail previews call the same item painter used for the room. */
export function drawHomeFurnitureThumbnail(ctx, itemId, width, height, { images = {}, environment = 'indoor' } = {}) {
  if (!validDrawSize(width, height) || typeof itemId !== 'string' || !ITEM_SLOT[itemId]) return null;
  const slot = ITEM_SLOT[itemId];
  let box;
  if (slot === 'rug') {
    box = rect(width * .06, height * .15, width * .88, height * .70);
  } else if (slot === 'bed') {
    box = rect(width * .07, height * .21, width * .86, height * .58);
  } else if (slot === 'decor') {
    box = rect(width * .31, height * .09, width * .38, height * .80);
  } else {
    box = rect(width * .25, height * .15, width * .50, height * .70);
  }
  if (!ctx || !drawFurnitureItem(ctx, itemId, box, images, environment)) return null;
  return outputBox(itemId, slot, box);
}

function visibleAlpha(image, width, height) {
  let canvas;
  try {
    if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height);
    else if (typeof document !== 'undefined' && document.createElement) canvas = document.createElement('canvas');
    if (!canvas) return false;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx?.getImageData) return false;
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 32) visible += 1;
    }
    return visible >= Math.max(8, Math.ceil(width * height * .001));
  } catch {
    return false;
  }
}

function loadArt(ImageClass, itemId, url, timeoutMs) {
  if (typeof ImageClass !== 'function') return Promise.resolve({ itemId, state: 'unavailable' });
  return new Promise(resolve => {
    let image;
    let settled = false;
    let timer;
    const finish = state => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
      resolve({ itemId, state, image: state === 'ready' ? image : null });
    };
    try {
      image = new ImageClass();
      image.decoding = 'async';
      image.onload = () => {
        const dimensions = imageDimensions(image);
        if (!dimensions || dimensions.width > MAX_ART_EDGE || dimensions.height > MAX_ART_EDGE
          || dimensions.width * dimensions.height > MAX_ART_PIXELS) return finish('oversize-or-empty');
        finish(visibleAlpha(image, dimensions.width, dimensions.height) ? 'ready' : 'transparent-or-unreadable');
      };
      image.onerror = () => finish('load-error');
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      image.src = String(url);
    } catch {
      finish('load-error');
    }
  });
}

/** Optional raster art loader. Any failed, transparent, unreadable or absent asset uses a native painter. */
export class HomeFurnitureArt {
  constructor({ ImageClass = globalThis.Image, timeoutMs = DEFAULT_ART_TIMEOUT_MS, eager = true } = {}) {
    this.images = Object.create(null);
    this._states = Object.fromEntries(Object.keys(ASSET_URLS).map(key=>[key,'idle']));
    this.ImageClass=ImageClass;
    this.timeoutMs=Number.isFinite(timeoutMs)?Math.max(0,Math.min(30000,timeoutMs)):DEFAULT_ART_TIMEOUT_MS;
    this.requests=new Map();
    this.ready=eager?this.prepareAll():Promise.resolve(this);
  }
  prepare(equipped={}) {
    const ids=Array.isArray(equipped)?equipped:Object.values(equipped??{});
    const requests=ids.filter(id=>Object.hasOwn(ASSET_URLS,id)).map(itemId=>{
      if(!this.requests.has(itemId)) {
        this._states[itemId]='pending';
        this.requests.set(itemId,loadArt(this.ImageClass,itemId,ASSET_URLS[itemId],this.timeoutMs).then(result=>{
          this._states[itemId]=result.state;if(result.image)this.images[itemId]=result.image;
        }));
      }
      return this.requests.get(itemId);
    });
    return Promise.all(requests).then(()=>this);
  }
  prepareAll() {return this.prepare(Object.keys(ASSET_URLS));}

  get stats() {
    const states = Object.values(this._states);
    return Object.freeze({
      pending: states.filter(state => state === 'pending').length,
      ready: states.filter(state => state === 'ready').length,
      fallback: states.filter(state => state !== 'pending' && state !== 'ready' && state !== 'idle').length,
      states: Object.freeze({ ...this._states }),
    });
  }
}
