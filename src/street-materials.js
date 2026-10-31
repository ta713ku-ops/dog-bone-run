const MATERIAL_ATLAS_URL = new URL('../art/resolution-v36/street-materials.webp', import.meta.url).href;
const MATERIAL_KINDS = Object.freeze(['asphalt', 'plaster', 'roof', 'concrete']);
const CELLS = Object.freeze({
  asphalt: Object.freeze([0, 0]),
  plaster: Object.freeze([1, 0]),
  roof: Object.freeze([0, 1]),
  concrete: Object.freeze([1, 1]),
});
const DEFAULT_TIMEOUT_MS = 2_400;
const DEFAULT_PIXELS_PER_UNIT = 18;
const PATTERNS = new WeakMap();

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth >= 2
    && Number.isFinite(image.naturalHeight) && image.naturalHeight >= 2);
}

function boundedTimeout(timeoutMs) {
  return Math.max(100, Math.min(10_000,
    Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS));
}

function loadImage(url, ImageCtor, timeoutMs) {
  if (typeof ImageCtor !== 'function') return Promise.resolve(null);

  return new Promise(resolve => {
    let image;
    let settled = false;
    let decoding = false;
    let timer = null;
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

    const decodeComplete = async () => {
      if (settled || decoding) return;
      decoding = true;
      try {
        if (typeof image.decode === 'function') await image.decode();
        finish(validImage(image) ? image : null);
      } catch {
        finish(null);
      }
    };

    image.decoding = 'async';
    image.onload = decodeComplete;
    image.onerror = () => finish(null);
    timer = globalThis.setTimeout(() => finish(null), boundedTimeout(timeoutMs));
    try {
      image.src = url;
    } catch {
      finish(null);
      return;
    }
    // Cached images can already be complete without dispatching another load event.
    if (validImage(image)) void decodeComplete();
  });
}

function createCanvas(factory, width, height) {
  try {
    let canvas = null;
    if (typeof factory === 'function') canvas = factory(width, height);
    else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      canvas = document.createElement('canvas');
    } else if (typeof OffscreenCanvas === 'function') {
      canvas = new OffscreenCanvas(width, height);
    }
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    return canvas;
  } catch {
    return null;
  }
}

function polygonBounds(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 1_024) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const x = point?.x, y = point?.y;
    const next = points[(index + 1) % points.length];
    const nextX = next?.x, nextY = next?.y;
    if (![x, y, nextX, nextY].every(Number.isFinite)
      || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) return null;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    twiceArea += x * nextY - nextX * y;
  }
  if (![left, top, right, bottom, twiceArea].every(Number.isFinite)
    || right <= left || bottom <= top || Math.abs(twiceArea) < 1e-4) return null;
  return { left, top, right, bottom };
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positiveModulo(value, period) {
  return ((value % period) + period) % period;
}

/**
 * Optional, non-blocking surface materials from one four-cell atlas.
 * The scene should paint its normal base color first; this helper only adds a
 * subtle clipped repeat texture and returns false when the texture is unavailable.
 */
export class StreetMaterials {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = DEFAULT_TIMEOUT_MS,
    atlasUrl = MATERIAL_ATLAS_URL, canvasFactory = null, lazy = false } = {}) {
    this.image = null;
    this.canvasFactory = canvasFactory;
    this.tiles = new Map();
    this.status = Object.fromEntries(MATERIAL_KINDS.map(kind => [kind, 'pending']));
    this.load=()=>this._ready??=loadImage(atlasUrl, ImageCtor, timeoutMs).then(image => {
      this.image = image;
      for (const kind of MATERIAL_KINDS) this.status[kind] = image ? 'ready' : 'fallback';
      return this;
    });
    if(!lazy)this.load();
  }
  get ready(){return this.load();}

  get stats() {
    return Object.freeze({ ...this.status });
  }

  #tile(kind) {
    if (this.tiles.has(kind)) return this.tiles.get(kind);
    const image = this.image;
    if (!validImage(image)) return null;
    const cellWidth = Math.floor(image.naturalWidth / 2);
    const cellHeight = Math.floor(image.naturalHeight / 2);
    if (cellWidth < 1 || cellHeight < 1) return null;

    const canvas = createCanvas(this.canvasFactory, cellWidth, cellHeight);
    const tileContext = canvas?.getContext?.('2d');
    if (!canvas || typeof tileContext?.drawImage !== 'function') return null;
    const [column, row] = CELLS[kind];
    try {
      tileContext.drawImage(image,
        column * cellWidth, row * cellHeight, cellWidth, cellHeight,
        0, 0, cellWidth, cellHeight);
    } catch {
      return null;
    }
    this.tiles.set(kind, canvas);
    return canvas;
  }

  paintMaterial(ctx, points, kind, options = {}) {
    if (!MATERIAL_KINDS.includes(kind)
      || typeof ctx?.createPattern !== 'function'
      || typeof ctx?.save !== 'function' || typeof ctx?.restore !== 'function'
      || typeof ctx?.beginPath !== 'function' || typeof ctx?.moveTo !== 'function'
      || typeof ctx?.lineTo !== 'function' || typeof ctx?.closePath !== 'function'
      || typeof ctx?.clip !== 'function' || typeof ctx?.fillRect !== 'function') return false;
    const box = polygonBounds(points);
    if (!box) return false;
    const opacity = clamp(finiteOr(options.opacity, .12), 0, .22);
    if (opacity <= 0) return false;

    const tile = this.#tile(kind);
    if (!tile) return false;

    let contextCache = PATTERNS.get(ctx);
    if (!contextCache || contextCache.image !== this.image) {
      contextCache = { image: this.image, materials: new Map() };
      PATTERNS.set(ctx, contextCache);
    }
    let pattern = contextCache.materials.get(kind);
    if (!pattern) {
      try {
        pattern = ctx.createPattern(tile, 'repeat');
      } catch {
        return false;
      }
      if (!pattern || typeof pattern.setTransform !== 'function') return false;
      contextCache.materials.set(kind, pattern);
    }

    const worldSpan = clamp(finiteOr(options.worldSpan, 1), .02, 50);
    const pixelsPerUnit = clamp(finiteOr(options.pixelsPerUnit, DEFAULT_PIXELS_PER_UNIT), .02, 4_096);
    // Keep repeats at a useful screen scale while letting perspective reduce
    // their size naturally as the caller's projected pixels-per-unit decreases.
    const tileSize = clamp(pixelsPerUnit * worldSpan, .5, 1_024);
    const scale = tileSize / Math.max(1, tile.width);
    const centerX = clamp(finiteOr(options.centerX, 0), -1e7, 1e7);
    const centerY = clamp(finiteOr(options.centerY, 0), -1e7, 1e7);
    const worldOffset = finiteOr(options.worldOffset, 0);
    const phaseY = positiveModulo(worldOffset, worldSpan) * pixelsPerUnit;

    let saved = false;
    try {
      ctx.save();
      saved = true;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
      ctx.closePath();
      ctx.clip();
      pattern.setTransform({ a: scale, b: 0, c: 0, d: scale, e: centerX, f: centerY - phaseY });
      ctx.globalAlpha = finiteOr(ctx.globalAlpha, 1) * opacity;
      ctx.fillStyle = pattern;
      ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
      return true;
    } catch {
      return false;
    } finally {
      if (saved) {
        try { ctx.restore(); } catch { /* Canvas state restoration is best-effort on hostile contexts. */ }
      }
    }
  }
}

export const STREET_MATERIALS = new StreetMaterials({lazy:true,timeoutMs:10000});

/** Add a deterministic world-anchored texture over a caller-painted surface. */
export function paintMaterial(ctx, points, kind, options = {}) {
  return STREET_MATERIALS.paintMaterial(ctx, points, kind, options);
}
