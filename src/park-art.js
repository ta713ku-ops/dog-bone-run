const SOURCES = Object.freeze({
  trees: new URL('../art/park-v23/trees.webp', import.meta.url).href,
  horizon: new URL('../art/park-v23/horizon.webp', import.meta.url).href,
  soil: new URL('../art/park-v23/soil.webp', import.meta.url).href,
  grass: new URL('../art/park-v23/grass.webp', import.meta.url).href,
});

// Crops and root anchors are measured from art/park-v23/metadata.json. The
// source atlas is a 2x2 sheet, but its transparent margins differ by species.
const TREE_CELLS = Object.freeze({
  oak: Object.freeze({ crop: Object.freeze([47, 71, 461, 427]), root: Object.freeze([256, 496]) }),
  birch: Object.freeze({ crop: Object.freeze([584, 66, 367, 433]), root: Object.freeze([768, 497]) }),
  pine: Object.freeze({ crop: Object.freeze([68, 551, 443, 425]), root: Object.freeze([256, 974]) }),
  willow: Object.freeze({ crop: Object.freeze([568, 566, 418, 410]), root: Object.freeze([768, 974]) }),
});

const TREE_BY_LANDSCAPE = Object.freeze({
  park: Object.freeze(['oak', 'birch', 'oak', 'willow']),
  woodland: Object.freeze(['pine', 'birch', 'pine', 'oak']),
  creek: Object.freeze(['willow', 'birch', 'willow', 'oak']),
});

const SOIL_PATTERNS = new WeakMap();
const GRASS_PATTERNS = new WeakMap();

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
}

function loadImage(url, ImageCtor, timeoutMs) {
  if (typeof ImageCtor !== 'function') return Promise.resolve(null);

  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    let image;
    try {
      image = new ImageCtor();
    } catch {
      resolve(null);
      return;
    }
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };

    let decoding = false;
    const decodedImage = async () => {
      if (settled || decoding) return;
      decoding = true;
      try {
        if (typeof image.decode === 'function') await image.decode();
        finish(validImage(image) ? image : null);
      } catch { finish(null); }
    };
    image.decoding = 'async';
    image.onload = decodedImage;
    image.onerror = () => finish(null);
    const boundedTimeout = Math.max(100, Math.min(10_000,
      Number.isFinite(timeoutMs) ? timeoutMs : 2_400));
    timer = globalThis.setTimeout(() => finish(null), boundedTimeout);
    try {
      image.src = url;
    } catch {
      finish(null);
    }
    if (validImage(image)) void decodedImage();
  });
}

function bounds(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const xs = points.map(point => point?.x);
  const ys = points.map(point => point?.y);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  return {
    left: Math.min(...xs), top: Math.min(...ys),
    right: Math.max(...xs), bottom: Math.max(...ys),
  };
}

function drawMaterialQuad(ctx, image, patternCache, points, {
  opacity = .18, centerX = 0, centerY = 0,
  pixelsPerLane = 1, pixelsPerDistance = 1,
  worldOffset = 0, worldSpan = 1,
} = {}) {
  if (!validImage(image) || typeof ctx?.createPattern !== 'function' || typeof ctx.clip !== 'function') return false;
  const box = bounds(points);
  if (!box || box.right <= box.left || box.bottom <= box.top) return false;

  let cached = patternCache.get(ctx);
  if (!cached || cached.image !== image) {
    const pattern = ctx.createPattern(image, 'repeat');
    if (!pattern) return false;
    cached = { image, pattern };
    patternCache.set(ctx, cached);
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath();
  ctx.clip();

  if (typeof cached.pattern.setTransform !== 'function') {
    ctx.restore();
    return false;
  }
  const span = Math.max(.24, Math.min(2.4, Number.isFinite(worldSpan) ? worldSpan : 1));
  const laneScale = Math.max(.001, Math.min(600, Number.isFinite(pixelsPerLane) ? pixelsPerLane : 1))
    * span / image.naturalWidth;
  const distanceScale = Math.max(.001, Math.min(600, Number.isFinite(pixelsPerDistance) ? pixelsPerDistance : 1))
    * span / image.naturalHeight;
  const phase = positiveModulo(Number.isFinite(worldOffset) ? worldOffset : 0, span) / span;
  try {
    cached.pattern.setTransform({
      a: laneScale, b: 0, c: 0, d: -distanceScale,
      e: (Number.isFinite(centerX) ? centerX : 0) - image.naturalWidth * laneScale / 2,
      f: (Number.isFinite(centerY) ? centerY : box.top) + phase * image.naturalHeight * distanceScale,
    });
  } catch {
    ctx.restore();
    return false;
  }
  ctx.globalAlpha *= Math.max(0, Math.min(.32, Number.isFinite(opacity) ? opacity : 0));
  ctx.fillStyle = cached.pattern;
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.restore();
  return true;
}

/**
 * Optional, non-blocking park materials. `ready` always resolves within the
 * timeout even when a generated file is absent or the browser cannot decode it.
 */
export class ParkArt {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = 2_400 } = {}) {
    this.images = { trees: null, horizon: null, soil: null, grass: null };
    this.status = { trees: 'pending', horizon: 'pending', soil: 'pending', grass: 'pending' };
    this.ready = Promise.all(Object.entries(SOURCES).map(async ([name, url]) => {
      const image = await loadImage(url, ImageCtor, timeoutMs);
      this.images[name] = image;
      this.status[name] = image ? 'ready' : 'fallback';
      return image;
    })).then(() => this);
  }

  get treesReady() { return validImage(this.images.trees); }
  get horizonReady() { return validImage(this.images.horizon); }
  get grassReady() { return validImage(this.images.grass); }
  get stats() { return Object.freeze({ ...this.status }); }

  treeGeometry(landscape, variant) {
    const { crop, root } = TREE_CELLS[treeType(landscape, variant)];
    return Object.freeze({
      crop,
      aspect: crop[2] / crop[3],
      anchorX: (root[0] - crop[0]) / crop[2],
      anchorY: (root[1] - crop[1]) / crop[3],
    });
  }

  drawTree(ctx, landscape, variant, x, baseline, width, height) {
    const image = this.images.trees;
    if (!validImage(image) || typeof ctx?.drawImage !== 'function') return false;
    const { crop, anchorX, anchorY } = this.treeGeometry(landscape, variant);
    const scaleX = image.naturalWidth / 1024;
    const scaleY = image.naturalHeight / 1024;
    ctx.save();
    ctx.drawImage(
      image, crop[0] * scaleX, crop[1] * scaleY, crop[2] * scaleX, crop[3] * scaleY,
      x - anchorX * width, baseline - anchorY * height, width, height,
    );
    ctx.restore();
    return true;
  }

  drawHorizon(ctx, x, y, width, height, alpha = 1) {
    const image = this.images.horizon;
    if (!validImage(image) || typeof ctx?.drawImage !== 'function') return false;
    ctx.save();
    const baseAlpha = ctx.globalAlpha * alpha;
    // Blend the panorama's sky and grass into the adjacent painted surfaces.
    // Draw small source rows rather than retaining another decoded canvas.
    const rows = 32;
    for (let row = 0; row < rows; row++) {
      const v = (row + .5) / rows;
      const fade = Math.min(1, v / .24, (1 - v) / .12);
      ctx.globalAlpha = baseAlpha * fade;
      const sourceY = image.naturalHeight * row / rows;
      ctx.drawImage(image, 0, sourceY, image.naturalWidth, image.naturalHeight / rows,
        x, y + height * row / rows, width, height / rows + .2);
    }
    ctx.restore();
    return true;
  }

  drawSoilQuad(ctx, points, {
    opacity = .18, centerX = 0, centerY = 0,
    pixelsPerLane = 1, pixelsPerDistance = 1,
    worldOffset = 0, worldSpan = 1,
  } = {}) {
    return drawMaterialQuad(ctx, this.images.soil, SOIL_PATTERNS, points, {
      opacity, centerX, centerY, pixelsPerLane, pixelsPerDistance, worldOffset, worldSpan,
    });
  }

  drawGrassQuad(ctx, points, {
    opacity = .12, centerX = 0, centerY = 0,
    pixelsPerLane = 1, pixelsPerDistance = 1,
    worldOffset = 0, worldSpan = 1,
  } = {}) {
    return drawMaterialQuad(ctx, this.images.grass, GRASS_PATTERNS, points, {
      opacity, centerX, centerY, pixelsPerLane, pixelsPerDistance, worldOffset, worldSpan,
    });
  }
}

function positiveModulo(value, period) {
  return ((value % period) + period) % period;
}

function treeType(landscape, variant) {
  const species = TREE_BY_LANDSCAPE[landscape] ?? TREE_BY_LANDSCAPE.park;
  const index = Math.abs(Math.trunc(Number.isFinite(variant) ? variant : 0)) % species.length;
  return species[index];
}

export const PARK_ART = new ParkArt();
