const ATLAS_URL = new URL('../art/street-v25/obstacles.webp', import.meta.url).href;

// Crops and roots are measured in art/street-v25/metadata.json. Keep these
// measurements together so the generated atlas can be revised without
// changing projection or obstacle collision geometry.
const DEFAULT_CELLS = Object.freeze({
  litter: Object.freeze({ crop: Object.freeze([12, 138, 271, 138]), root: Object.freeze([147.5, 274]) }),
  crow: Object.freeze({ crop: Object.freeze([361, 12, 231, 273]), root: Object.freeze([476.5, 283]) }),
  cat: Object.freeze({ crop: Object.freeze([664, 9, 224, 271]), root: Object.freeze([776, 278]) }),
});
const SOURCE_SIZE = Object.freeze({ width: 900, height: 300 });
const TYPES = Object.freeze(['litter', 'crow', 'cat']);
const SHADOW = 'rgba(45, 39, 31, .28)';

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
}

function boundedTimeout(timeoutMs) {
  return Math.max(100, Math.min(10_000, Number.isFinite(timeoutMs) ? timeoutMs : 2_400));
}

function loadImage(url, ImageCtor, timeoutMs) {
  if (typeof ImageCtor !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    let decoding = false;
    let timer = null;
    let image;
    try { image = new ImageCtor(); } catch { resolve(null); return; }

    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const decodeComplete = async () => {
      if (settled || decoding) return;
      decoding = true;
      try {
        if (typeof image.decode === 'function') await image.decode();
        finish(validImage(image) ? image : null);
      } catch { finish(null); }
    };

    image.decoding = 'async';
    image.onload = decodeComplete;
    image.onerror = () => finish(null);
    timer = globalThis.setTimeout(() => finish(null), boundedTimeout(timeoutMs));
    try { image.src = url; } catch { finish(null); return; }
    if (validImage(image)) void decodeComplete();
  });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function imageGradient(ctx, x0, y0, x1, y1, stops, fallback) {
  const gradient = ctx.createLinearGradient?.(x0, y0, x1, y1);
  if (!gradient || typeof gradient.addColorStop !== 'function') return fallback;
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

function dimensionsFor(type, footprint, geometry) {
  const boxWidth = Math.max(0, Number.isFinite(footprint.width) ? footprint.width : 0);
  const boxHeight = Math.max(0, Number.isFinite(footprint.height) ? footprint.height : 0);
  if (boxWidth <= 0 || boxHeight <= 0 || geometry.aspect <= 0) return null;

  const horizontalFit = boxWidth * .94;
  if (type === 'litter') {
    const width = Math.min(horizontalFit, boxHeight * geometry.aspect * .9);
    return { width, height: width / geometry.aspect };
  }

  // Crow and cat are upright, but their feet still sit on the same collision
  // baseline and their complete image crops stay inside the hitbox's width.
  const heightLimit = boxHeight * (type === 'crow' ? 2.05 : 2.25);
  const width = Math.min(horizontalFit, heightLimit * geometry.aspect);
  return { width, height: width / geometry.aspect };
}

function coords(x, y, width, height, points) {
  return points.map(([u, v]) => [x + u * width, y + v * height]);
}

function strokeLine(ctx, x, y, width, height, points, color, lineWidth, cap = 'round') {
  if (typeof ctx?.beginPath !== 'function' || typeof ctx.stroke !== 'function') return;
  ctx.beginPath();
  const p = coords(x, y, width, height, points);
  ctx.moveTo(p[0][0], p[0][1]);
  for (let index = 1; index < p.length; index++) ctx.lineTo(p[index][0], p[index][1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawLitter(renderer, x, baseline, width, height) {
  const ctx = renderer.ctx;
  const y = baseline - height;
  const fold = Math.max(.55, width * .025);
  const orange = imageGradient(ctx, x - width * .45, y, x + width * .42, baseline,
    [[0, '#ef6b25'], [.42, '#df451e'], [1, '#a92f22']], '#dc4b25');
  const body = [[-.48, -.60], [-.36, -.76], [-.20, -.66], [-.06, -.73], [.11, -.66],
    [.28, -.77], [.45, -.61], [.39, -.35], [.47, -.15], [.34, -.02], [.18, -.04],
    [.02, 0], [-.14, -.01], [-.32, 0], [-.46, -.10], [-.38, -.31]];
  renderer.path(coords(x, baseline, width, height, body), orange, '#742d20', fold);
  // A simple chip emblem and folded foil ridges identify a discarded snack bag.
  renderer.path(coords(x, baseline, width, height, [[-.21, -.50], [.16, -.53], [.22, -.22], [-.19, -.19]]), '#f4bd42', '#9b5425', fold * .6);
  renderer.ellipse(x - width * .025, baseline - height * .36, width * .09, height * .12, '#fff0c5');
  strokeLine(ctx, x, baseline, width, height, [[-.34, -.68], [-.21, -.57], [-.28, -.43]], '#ffb76a', fold * .7);
  strokeLine(ctx, x, baseline, width, height, [[.30, -.66], [.19, -.53], [.34, -.42]], '#ffad62', fold * .7);
  strokeLine(ctx, x, baseline, width, height, [[-.30, -.10], [-.16, -.20], [-.04, -.10], [.12, -.21], [.29, -.12]], '#f58a48', fold * .65);
}

function drawCrow(renderer, x, baseline, width, height) {
  const ctx = renderer.ctx;
  const y = baseline - height;
  const edge = '#262a2b';
  const bodyFill = imageGradient(ctx, x - width * .25, y + height * .22, x + width * .28, baseline,
    [[0, '#55595a'], [.35, '#25292a'], [1, '#111516']], '#25292a');
  const line = Math.max(.6, width * .018);

  // Pecking profile: tail trails left, head and beak reach down and forward.
  renderer.path(coords(x, baseline, width, height, [[-.10, -.39], [-.48, -.19], [-.34, -.46], [-.12, -.63]]), '#171b1c', edge, line);
  strokeLine(ctx, x, baseline, width, height, [[-.04, -.13], [-.02, -.04], [-.12, 0]], '#40352a', line * 1.35);
  strokeLine(ctx, x, baseline, width, height, [[.17, -.12], [.20, -.04], [.31, 0]], '#40352a', line * 1.35);
  renderer.ellipse(x - width * .035, baseline - height * .36, width * .31, height * .27, bodyFill, edge, -.12);
  renderer.ellipse(x + width * .18, baseline - height * .65, width * .17, height * .16,
    imageGradient(ctx, x + width * .05, y + height * .2, x + width * .3, y + height * .55,
      [[0, '#4a4e4e'], [1, '#191d1e']], '#303435'), edge);
  renderer.path(coords(x, baseline, width, height, [[.28, -.65], [.49, -.57], [.30, -.51]]), '#b6753b', '#6b482d', line * .65);
  renderer.ellipse(x + width * .23, baseline - height * .68, Math.max(.6, width * .018), Math.max(.6, width * .018), '#e4c28a');
  renderer.ellipse(x - width * .06, baseline - height * .41, width * .17, height * .12, '#3a3e3f', null, -.18);
  strokeLine(ctx, x, baseline, width, height, [[-.27, -.37], [-.08, -.29], [.05, -.32]], '#666969', line * .65);
}

function drawCat(renderer, x, baseline, width, height) {
  const ctx = renderer.ctx;
  const y = baseline - height;
  const line = Math.max(.6, width * .018);
  const coat = imageGradient(ctx, x - width * .25, y + height * .4, x + width * .30, baseline,
    [[0, '#aa9178'], [.45, '#756454'], [1, '#4d4844']], '#796c5e');
  const head = imageGradient(ctx, x - width * .20, y, x + width * .24, y + height * .35,
    [[0, '#b49b82'], [1, '#726555']], '#95816c');

  // A curled tail stays within the sprite's measured width and never animates.
  if (typeof ctx?.beginPath === 'function' && typeof ctx.stroke === 'function') {
    ctx.beginPath();
    ctx.moveTo(x + width * .14, baseline - height * .22);
    ctx.bezierCurveTo(x + width * .43, baseline - height * .20,
      x + width * .46, baseline - height * .58, x + width * .31, baseline - height * .55);
    ctx.bezierCurveTo(x + width * .19, baseline - height * .52,
      x + width * .29, baseline - height * .34, x + width * .36, baseline - height * .44);
    ctx.strokeStyle = '#61564b'; ctx.lineWidth = Math.max(1, width * .12); ctx.lineCap = 'round'; ctx.stroke();
    ctx.strokeStyle = '#aa927a'; ctx.lineWidth = Math.max(.6, width * .08); ctx.stroke();
  }
  renderer.ellipse(x - width * .02, baseline - height * .25, width * .31, height * .25, coat, '#514a42', .08);
  renderer.ellipse(x, baseline - height * .57, width * .25, height * .23, head, '#514a42');
  renderer.path(coords(x, baseline, width, height, [[-.23, -.68], [-.25, -.98], [-.04, -.78]]), head, '#514a42', line);
  renderer.path(coords(x, baseline, width, height, [[.05, -.78], [.28, -1], [.24, -.66]]), head, '#514a42', line);
  renderer.path(coords(x, baseline, width, height, [[-.19, -.86], [-.16, -.94], [-.10, -.82]]), '#a96868');
  renderer.path(coords(x, baseline, width, height, [[.12, -.84], [.22, -.94], [.21, -.79]]), '#a96868');
  renderer.ellipse(x - width * .10, baseline - height * .59, Math.max(.8, width * .022), Math.max(.8, height * .022), '#26322d');
  renderer.ellipse(x + width * .10, baseline - height * .59, Math.max(.8, width * .022), Math.max(.8, height * .022), '#26322d');
  renderer.path(coords(x, baseline, width, height, [[-.035, -.50], [.035, -.50], [0, -.46]]), '#ab7773');
  strokeLine(ctx, x, baseline, width, height, [[0, -.46], [-.025, -.425], [-.10, -.43]], '#433c37', line * .55);
  strokeLine(ctx, x, baseline, width, height, [[0, -.46], [.025, -.425], [.10, -.43]], '#433c37', line * .55);
  strokeLine(ctx, x, baseline, width, height, [[-.13, -.47], [-.38, -.44]], '#ded0bd', line * .42);
  strokeLine(ctx, x, baseline, width, height, [[-.13, -.44], [-.38, -.37]], '#ded0bd', line * .42);
  strokeLine(ctx, x, baseline, width, height, [[.13, -.47], [.38, -.44]], '#ded0bd', line * .42);
  strokeLine(ctx, x, baseline, width, height, [[.13, -.44], [.38, -.37]], '#ded0bd', line * .42);
  // Quiet fur markings add texture without blinking or changing silhouette.
  strokeLine(ctx, x, baseline, width, height, [[-.07, -.74], [-.02, -.68], [.02, -.74]], '#594f45', line * .65);
  strokeLine(ctx, x, baseline, width, height, [[.07, -.74], [.12, -.68], [.16, -.74]], '#594f45', line * .65);
}

function drawFallback(renderer, type, x, baseline, width, height) {
  if (!renderer?.ctx || typeof renderer.path !== 'function' || typeof renderer.ellipse !== 'function') return false;
  if (type === 'litter') drawLitter(renderer, x, baseline, width, height);
  else if (type === 'crow') drawCrow(renderer, x, baseline, width, height);
  else if (type === 'cat') drawCat(renderer, x, baseline, width, height);
  else return false;
  return true;
}

/** Optional obstacle atlas with bounded decode and canvas fallbacks. */
export class StreetObstacleArt {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = 2_400, atlasUrl = ATLAS_URL,
    sourceSize = SOURCE_SIZE, cells = DEFAULT_CELLS } = {}) {
    this.images = { obstacles: null };
    this.status = { obstacles: 'pending' };
    this.sourceSize = Object.freeze({ width: sourceSize.width, height: sourceSize.height });
    this.cells = cells;
    this.ready = loadImage(atlasUrl, ImageCtor, timeoutMs).then(image => {
      this.images.obstacles = image;
      this.status.obstacles = image ? 'ready' : 'fallback';
      return this;
    });
  }

  get atlasReady() { return validImage(this.images.obstacles); }
  get stats() { return Object.freeze({ ...this.status }); }

  geometry(type) {
    const cell = this.cells[type] ?? this.cells.litter;
    const crop = [...cell.crop];
    const [rootX, rootY] = cell.root;
    return Object.freeze({
      crop: Object.freeze(crop),
      aspect: crop[2] / crop[3],
      anchorX: clamp((rootX - crop[0]) / crop[2], 0, 1),
      anchorY: clamp((rootY - crop[1]) / crop[3], 0, 1),
    });
  }

  drawAt(renderer, type, { x, y, scale = 1, width, height, alpha = 1 } = {}) {
    if (!TYPES.includes(type) || ![x, y, scale, width, height, alpha].every(Number.isFinite)
      || scale <= 0 || width <= 0 || height <= 0 || alpha <= 0) return false;
    const ctx = renderer?.ctx;
    if (!ctx?.save || !ctx?.restore) return false;
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const geometry = this.geometry(type);
    const image = this.images.obstacles;

    ctx.save();
    ctx.globalAlpha *= clamp(alpha, 0, 1);
    renderer.ellipse?.(x, y + Math.min(1.5, drawHeight * .03), drawWidth * .31,
      Math.max(.7, drawHeight * .045), SHADOW);
    let drawn = false;
    if (validImage(image) && typeof ctx.drawImage === 'function') {
      const sxScale = image.naturalWidth / this.sourceSize.width;
      const syScale = image.naturalHeight / this.sourceSize.height;
      const [sx, sy, sw, sh] = geometry.crop;
      try {
        ctx.drawImage(image, sx * sxScale, sy * syScale, sw * sxScale, sh * syScale,
          x - geometry.anchorX * drawWidth, y - geometry.anchorY * drawHeight,
          drawWidth, drawHeight);
        drawn = true;
      } catch { drawn = false; }
    }
    if (!drawn) drawn = drawFallback(renderer, type, x, y, drawWidth, drawHeight);
    ctx.restore();
    return drawn;
  }

  draw(renderer, type, lane, distance) {
    if (!TYPES.includes(type) || typeof renderer?.obstacleFootprint !== 'function') return false;
    const footprint = renderer.obstacleFootprint(lane, distance);
    if (!footprint?.p || !Number.isFinite(footprint.p.x) || !Number.isFinite(footprint.p.y)) return false;
    const size = dimensionsFor(type, footprint, this.geometry(type));
    if (!size || size.width <= 0 || size.height <= 0) return false;
    return this.drawAt(renderer, type, { x: footprint.p.x, y: footprint.p.y,
      width: size.width, height: size.height, alpha: 1 });
  }
}

export const STREET_OBSTACLE_ART = new StreetObstacleArt();

export function drawStreetObstacle(renderer, type, lane, distance) {
  return STREET_OBSTACLE_ART.draw(renderer, type, lane, distance);
}

/** Draw at a supplied projected root for a short post-contact effect. */
export function drawStreetObstacleAt(renderer, type, options) {
  return STREET_OBSTACLE_ART.drawAt(renderer, type, options);
}
