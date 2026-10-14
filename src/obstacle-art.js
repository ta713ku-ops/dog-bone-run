// Ground artwork fits inside the projected obstacle footprint. Its contact shadow
// stays close to the pavement so the objects read at their actual road height.
const SHORE = [
  [-.98, -.04], [-.88, -.48], [-.61, -.75], [-.31, -.86], [.04, -.77],
  [.36, -.91], [.72, -.69], [.94, -.28], [.98, .12], [.79, .58],
  [.45, .84], [.09, .76], [-.22, .92], [-.63, .72], [-.91, .39],
];
const CONTACT_SHADOW = 'rgba(31, 39, 42, .22)';

function linearGradient(ctx, x0, y0, x1, y1, stops, fallback) {
  const gradient = ctx.createLinearGradient?.(x0, y0, x1, y1);
  if (!gradient || typeof gradient.addColorStop !== 'function') return fallback;
  for (const [position, color] of stops) gradient.addColorStop(position, color);
  return gradient;
}

function traceSoftShape(ctx, points) {
  const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  if (typeof ctx.quadraticCurveTo !== 'function') {
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    return;
  }
  const first = midpoint(points[points.length - 1], points[0]);
  ctx.moveTo(first[0], first[1]);
  for (let i = 0; i < points.length; i++) {
    const next = midpoint(points[i], points[(i + 1) % points.length]);
    ctx.quadraticCurveTo(points[i][0], points[i][1], next[0], next[1]);
  }
  ctx.closePath();
}

function fillSoftShape(ctx, points, fill) {
  traceSoftShape(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawPuddle(r, lane, distance) {
  const c = r.ctx, {p, width, height} = r.obstacleFootprint(lane, distance);
  const rx = Math.max(.3, width / 2 - 1.5), ry = Math.max(.3, height / 2 - 1.5);
  const shape = scale => SHORE.map(([x, y]) => [p.x + rx * x * scale, p.y + ry * y * scale]);

  fillSoftShape(c, shape(1), CONTACT_SHADOW);
  fillSoftShape(c, shape(.95), '#3e4b50');
  fillSoftShape(c, shape(.88), '#65747a');
  const water = linearGradient(c, p.x - rx * .42, p.y - ry * .5, p.x + rx * .38, p.y + ry * .5,
    [[0, '#a9bec0'], [.48, '#829da5'], [1, '#586f7c']], '#78939d');
  fillSoftShape(c, shape(.81), water);

  c.save();
  traceSoftShape(c, shape(.81));
  c.clip();
  // Broad, still reflections suggest a thin layer of rainwater without sparkles.
  c.beginPath();
  c.moveTo(p.x - rx * .62, p.y - ry * .2);
  c.bezierCurveTo(p.x - rx * .3, p.y - ry * .46, p.x + rx * .04, p.y - ry * .1, p.x + rx * .52, p.y - ry * .34);
  c.strokeStyle = '#c4d1cc';
  c.lineWidth = Math.max(.7, p.scale * 1.8);
  c.stroke();
  c.beginPath();
  c.moveTo(p.x - rx * .5, p.y + ry * .38);
  c.bezierCurveTo(p.x - rx * .12, p.y + ry * .14, p.x + rx * .2, p.y + ry * .5, p.x + rx * .64, p.y + ry * .23);
  c.strokeStyle = '#8faab0';
  c.lineWidth = Math.max(.7, p.scale * 1.25);
  c.stroke();
  c.restore();
}

export function drawTrashBin(r, lane, distance) {
  const c = r.ctx, {p, width} = r.obstacleFootprint(lane, distance);
  const scale = Math.max(.2, p.scale * r.width / 390);
  const stroke = Math.max(.65, scale * .95);
  const w = Math.max(0, Math.min(40 * scale, width - 2 * stroke));
  if (w <= 0) return;

  const h = 28 * scale, top = p.y - h, base = p.y - 2 * scale;
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  r.ellipse(p.x, p.y + .5 * scale, w * .48, Math.max(.7, scale * 2.4), CONTACT_SHADOW);

  const bodyTop = top + h * .23, bodyBase = base - scale;
  const front = linearGradient(c, p.x - w * .36, bodyTop, p.x + w * .32, bodyBase,
    [[0, '#c5c1b7'], [.42, '#a09f99'], [1, '#797f7f']], '#9c9f99');
  r.path([
    [p.x - w * .4, bodyTop], [p.x + w * .28, bodyTop + scale],
    [p.x + w * .23, bodyBase], [p.x - w * .34, bodyBase],
  ], front, '#555e60', stroke);
  const side = linearGradient(c, p.x + w * .26, bodyTop, p.x + w * .4, bodyBase,
    [[0, '#8c918e'], [1, '#5d6668']], '#707779');
  r.path([
    [p.x + w * .28, bodyTop + scale], [p.x + w * .4, bodyTop - scale],
    [p.x + w * .37, bodyBase - scale], [p.x + w * .23, bodyBase],
  ], side, '#555e60', stroke);

  // A shallow overhanging lid and centered catch make the small object read as a bin.
  const lid = linearGradient(c, p.x - w * .43, top + h * .06, p.x + w * .43, top + h * .21,
    [[0, '#d5d0c6'], [.5, '#b7b5ae'], [1, '#858b8a']], '#b9b7b0');
  r.path([
    [p.x - w * .48, top + h * .19], [p.x - w * .42, top + h * .06],
    [p.x + w * .39, top + h * .06], [p.x + w * .48, top + h * .18],
    [p.x + w * .29, top + h * .27], [p.x - w * .4, top + h * .25],
  ], lid, '#555e60', stroke);
  r.path([
    [p.x - w * .4, top + h * .25], [p.x + w * .29, top + h * .27],
    [p.x + w * .28, top + h * .32], [p.x - w * .39, top + h * .3],
  ], '#747c7d');

  c.beginPath();
  c.moveTo(p.x - w * .11, top + h * .14);
  c.lineTo(p.x - w * .09, top + h * .025);
  c.quadraticCurveTo(p.x, top - scale, p.x + w * .09, top + h * .025);
  c.lineTo(p.x + w * .11, top + h * .14);
  c.strokeStyle = '#626a69';
  c.lineWidth = stroke;
  c.stroke();

  const plateY = top + h * .5;
  r.path([
    [p.x - w * .15, plateY], [p.x + w * .12, plateY],
    [p.x + w * .11, plateY + h * .17], [p.x - w * .14, plateY + h * .17],
  ], '#d2cec3', '#777d7a', Math.max(.45, stroke * .65));
  c.restore();
}
