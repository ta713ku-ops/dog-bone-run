const ATLAS_URL = new URL('../art/neighborhood-v24/houses.webp', import.meta.url).href;
const ASPHALT_URL = new URL('../art/neighborhood-v24/asphalt.webp', import.meta.url).href;
const BUILDINGS_URL = new URL('../art/street-v25/buildings.webp', import.meta.url).href;

const DEFAULT_CELLS = Object.freeze({
  'cream-left': Object.freeze({ crop: Object.freeze([16, 37, 494, 456]), rootAnchor: Object.freeze([263, 490]) }),
  'timber-left': Object.freeze({ crop: Object.freeze([526, 28, 482, 463]), rootAnchor: Object.freeze([767, 488]) }),
  'cream-right': Object.freeze({ crop: Object.freeze([14, 517, 498, 465]), rootAnchor: Object.freeze([263, 979]) }),
  'brick-right': Object.freeze({ crop: Object.freeze([512, 519, 508, 461]), rootAnchor: Object.freeze([766, 977]) }),
});

const DEFAULT_BUILDING_CELLS = Object.freeze({
  'convenience-left': Object.freeze({ crop: Object.freeze([10, 129, 300, 179]), rootAnchor: Object.freeze([160, 306]) }),
  'convenience-right': Object.freeze({ crop: Object.freeze([330, 127, 300, 181]), rootAnchor: Object.freeze([480, 306]) }),
  'shop-left': Object.freeze({ crop: Object.freeze([10, 352, 300, 276]), rootAnchor: Object.freeze([160, 626]) }),
  'shop-right': Object.freeze({ crop: Object.freeze([330, 348, 300, 280]), rootAnchor: Object.freeze([480, 626]) }),
  'apartment-left': Object.freeze({ crop: Object.freeze([36, 648, 248, 300]), rootAnchor: Object.freeze([160, 946]) }),
  'apartment-right': Object.freeze({ crop: Object.freeze([353, 648, 253, 300]), rootAnchor: Object.freeze([479.5, 946]) }),
});
const DEFAULT_BUILDING_SOURCE_SIZE = Object.freeze({ width: 640, height: 960 });

const ASPHALT_PATTERNS = new WeakMap();

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
}

function boundedTimeout(timeoutMs) {
  return Math.max(100, Math.min(10_000, Number.isFinite(timeoutMs) ? timeoutMs : 2_400));
}

function positiveModulo(value, period) {
  return ((value % period) + period) % period;
}

function loadImage(url, ImageCtor, timeoutMs) {
  if (typeof ImageCtor !== 'function') return Promise.resolve(null);

  return new Promise(resolve => {
    let settled = false;
    let decoding = false;
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
    if (validImage(image)) void decodeComplete();
  });
}

function bounds(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const xs = points.map(point => point?.x), ys = points.map(point => point?.y);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  return {
    left: Math.min(...xs), top: Math.min(...ys),
    right: Math.max(...xs), bottom: Math.max(...ys),
  };
}

function drawAsphaltMaterial(ctx, image, points, {
  opacity = .19, centerX = 0, centerY = 0,
  pixelsPerLane = 1, pixelsPerDistance = 1,
  worldOffset = 0, worldSpan = 1,
} = {}) {
  if (!validImage(image) || typeof ctx?.createPattern !== 'function' || typeof ctx.clip !== 'function') return false;
  const box = bounds(points);
  if (!box || box.right <= box.left || box.bottom <= box.top) return false;

  let cached = ASPHALT_PATTERNS.get(ctx);
  if (!cached || cached.image !== image) {
    const pattern = ctx.createPattern(image, 'repeat');
    if (!pattern) return false;
    cached = { image, pattern };
    ASPHALT_PATTERNS.set(ctx, cached);
  }

  ctx.save();
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath(); ctx.clip();
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
  ctx.globalAlpha *= Math.max(0, Math.min(.28, Number.isFinite(opacity) ? opacity : 0));
  ctx.fillStyle = cached.pattern;
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.restore();
  return true;
}

/** Non-blocking house atlas loader. Failed assets use the scene's vector houses. */
export class NeighborhoodArt {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = 2_400, lazy = false,
    atlasUrl = ATLAS_URL, asphaltUrl = ASPHALT_URL, buildingsUrl = BUILDINGS_URL,
    buildingCells = DEFAULT_BUILDING_CELLS, buildingSourceSize = DEFAULT_BUILDING_SOURCE_SIZE } = {}) {
    this.images = { houses: null, asphalt: null, buildings: null };
    this.cells = DEFAULT_CELLS;
    this.sourceSize = { width: 1024, height: 1024 };
    this.buildingCells = buildingCells;
    this.buildingSourceSize = buildingSourceSize;
    this.status = { houses: 'pending', asphalt: 'pending', buildings: 'pending' };
    this.ImageCtor = ImageCtor;
    this.timeoutMs = timeoutMs;
    this.urls = { houses: atlasUrl, asphalt: asphaltUrl, buildings: buildingsUrl };
    this._readyPromise = null;
    this.ready = lazy ? Promise.resolve(this) : this.load();
  }

  load() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = Promise.all([
      loadImage(this.urls.houses, this.ImageCtor, this.timeoutMs).then(image => {
        this.images.houses = image;
        this.status.houses = image ? 'ready' : 'fallback';
      }),
      loadImage(this.urls.asphalt, this.ImageCtor, this.timeoutMs).then(image => {
        this.images.asphalt = image;
        this.status.asphalt = image ? 'ready' : 'fallback';
      }),
      loadImage(this.urls.buildings, this.ImageCtor, this.timeoutMs).then(image => {
        this.images.buildings = image;
        this.status.buildings = image ? 'ready' : 'fallback';
      }),
    ]).then(() => {
      return this;
    });
    this.ready = this._readyPromise;
    return this._readyPromise;
  }

  get housesReady() { return validImage(this.images.houses); }
  get asphaltReady() { return validImage(this.images.asphalt); }
  get buildingsReady() { return validImage(this.images.buildings); }
  get stats() { return Object.freeze({ ...this.status }); }

  houseGeometry(name) {
    const cell = this.cells[name] ?? DEFAULT_CELLS['cream-left'];
    const [x, y, width, height] = cell.crop;
    const [rootX, rootY] = cell.rootAnchor;
    return Object.freeze({
      crop: Object.freeze([...cell.crop]),
      aspect: width / height,
      anchorX: Math.max(0, Math.min(1, (rootX - x) / width)),
      anchorY: Math.max(0, Math.min(1, (rootY - y) / height)),
    });
  }

  drawHouse(ctx, name, x, baseline, width, height) {
    const image = this.images.houses;
    if (!validImage(image) || typeof ctx?.drawImage !== 'function') return false;
    const geometry = this.houseGeometry(name);
    const scaleX = image.naturalWidth / this.sourceSize.width;
    const scaleY = image.naturalHeight / this.sourceSize.height;
    const [sx, sy, sw, sh] = geometry.crop;
    ctx.save();
    ctx.drawImage(image, sx * scaleX, sy * scaleY, sw * scaleX, sh * scaleY,
      x - geometry.anchorX * width, baseline - geometry.anchorY * height, width, height);
    ctx.restore();
    return true;
  }

  buildingGeometry(name) {
    const cell = this.buildingCells[name] ?? this.buildingCells['shop-left'];
    const [x, y, width, height] = cell.crop;
    const [rootX, rootY] = cell.rootAnchor;
    return Object.freeze({
      crop: Object.freeze([...cell.crop]),
      aspect: width / height,
      anchorX: Math.max(0, Math.min(1, (rootX - x) / width)),
      anchorY: Math.max(0, Math.min(1, (rootY - y) / height)),
    });
  }

  drawBuilding(ctx, name, x, baseline, width, height) {
    const image = this.images.buildings;
    if (!validImage(image) || typeof ctx?.drawImage !== 'function') return false;
    const geometry = this.buildingGeometry(name);
    const scaleX = image.naturalWidth / this.buildingSourceSize.width;
    const scaleY = image.naturalHeight / this.buildingSourceSize.height;
    const [sx, sy, sw, sh] = geometry.crop;
    ctx.save();
    ctx.drawImage(image, sx * scaleX, sy * scaleY, sw * scaleX, sh * scaleY,
      x - geometry.anchorX * width, baseline - geometry.anchorY * height, width, height);
    ctx.restore();
    return true;
  }

  drawAsphaltQuad(ctx, points, options = {}) {
    return drawAsphaltMaterial(ctx, this.images.asphalt, points, options);
  }
}

export const NEIGHBORHOOD_ART = new NeighborhoodArt({ lazy: true });
export { DEFAULT_BUILDING_CELLS, DEFAULT_BUILDING_SOURCE_SIZE };
