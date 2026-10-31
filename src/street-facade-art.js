const FACADE_ATLAS_URL = new URL('../art/resolution-v36/facades.webp', import.meta.url).href;
const SOURCE_SIZE = Object.freeze({ width: 1024, height: 1024 });
const FACE_SIZE = 512;
const DEFAULT_TIMEOUT_MS = 2_400;
const FACADE_KINDS = Object.freeze(['house', 'side', 'store', 'apartment']);
const CELLS = Object.freeze({
  house: Object.freeze([0, 0]),
  side: Object.freeze([1, 0]),
  store: Object.freeze([0, 1]),
  apartment: Object.freeze([1, 1]),
});

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
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

function quadData(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return null;
  const points = quad.map(point => ({ x: point?.x, y: point?.y }));
  if (!points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)
    && Math.abs(x) <= 1e7 && Math.abs(y) <= 1e7)) return null;

  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let twiceArea = 0;
  const crosses = [];
  for (let index = 0; index < 4; index++) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    left = Math.min(left, a.x);
    top = Math.min(top, a.y);
    right = Math.max(right, a.x);
    bottom = Math.max(bottom, a.y);
    twiceArea += a.x * b.y - b.x * a.y;
    crosses.push((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  }
  if (right - left < .5 || bottom - top < .5
    || !Number.isFinite(twiceArea) || twiceArea < 1e-3
    || !crosses.every(cross => cross > 1e-4)) return null;
  return { points, left, top, right, bottom, maxDimension: Math.max(right - left, bottom - top) };
}

function isAxisAlignedRect(points) {
  const epsilon = 1e-5;
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  return Math.abs(topLeft.y - topRight.y) <= epsilon
    && Math.abs(bottomLeft.y - bottomRight.y) <= epsilon
    && Math.abs(topLeft.x - bottomLeft.x) <= epsilon
    && Math.abs(topRight.x - bottomRight.x) <= epsilon;
}

function transformPoint(transform, point) {
  const x = transform.a * point.x + transform.c * point.y + transform.e;
  const y = transform.b * point.x + transform.d * point.y + transform.f;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function fullyOutsideCanvas(ctx, shape) {
  const canvas = ctx?.canvas;
  if (!canvas || !Number.isFinite(canvas.width) || canvas.width <= 0
    || !Number.isFinite(canvas.height) || canvas.height <= 0) return false;

  let points;
  try {
    const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (transform && ['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(transform[key]))) {
      points = shape.points.map(point => transformPoint(transform, point));
      if (points.some(point => !point)) return false;
    } else {
      const dpr = Number.isFinite(globalThis.devicePixelRatio)
        ? Math.max(1, Math.min(2, globalThis.devicePixelRatio)) : 1;
      const logicalWidth = Number.isFinite(canvas.clientWidth) && canvas.clientWidth > 0
        ? canvas.clientWidth : canvas.width / dpr;
      const logicalHeight = Number.isFinite(canvas.clientHeight) && canvas.clientHeight > 0
        ? canvas.clientHeight : canvas.height / dpr;
      points = shape.points;
      return shape.right <= 0 || shape.bottom <= 0
        || shape.left >= logicalWidth || shape.top >= logicalHeight;
    }
  } catch {
    return false;
  }

  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x));
  const bottom = Math.max(...points.map(point => point.y));
  return right <= 0 || bottom <= 0 || left >= canvas.width || top >= canvas.height;
}

function homographyForQuad(points) {
  const [p0, p1, p2, p3] = points;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;

  if (Math.abs(dx3) > 1e-8 || Math.abs(dy3) > 1e-8) {
    const determinant = dx1 * dy2 - dx2 * dy1;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
    g = (dx3 * dy2 - dx2 * dy3) / determinant;
    h = (dx1 * dy3 - dx3 * dy1) / determinant;
  }
  const matrix = {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };
  return Object.values(matrix).every(Number.isFinite) ? matrix : null;
}

function projectPoint(matrix, u, v) {
  const denominator = matrix.g * u + matrix.h * v + 1;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-7) return null;
  const x = (matrix.a * u + matrix.b * v + matrix.c) / denominator;
  const y = (matrix.d * u + matrix.e * v + matrix.f) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function affineFromTriangles(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y;
  const sx2 = s2.x - s0.x, sy2 = s2.y - s0.y;
  const determinant = sx1 * sy2 - sx2 * sy1;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
  const dx1 = d1.x - d0.x, dy1 = d1.y - d0.y;
  const dx2 = d2.x - d0.x, dy2 = d2.y - d0.y;
  const a = (dx1 * sy2 - dx2 * sy1) / determinant;
  const c = (sx1 * dx2 - sx2 * dx1) / determinant;
  const b = (dy1 * sy2 - dy2 * sy1) / determinant;
  const d = (sx1 * dy2 - sx2 * dy1) / determinant;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  const transform = { a, b, c, d, e, f };
  return Object.values(transform).every(Number.isFinite) ? transform : null;
}

function expandedTriangle(points, padding = .35) {
  const center = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };
  return points.map(point => {
    const dx = point.x - center.x, dy = point.y - center.y;
    const length = Math.hypot(dx, dy);
    return length > 0
      ? { x: point.x + dx / length * padding, y: point.y + dy / length * padding }
      : point;
  });
}

function makeTrianglePlan(image, cell, homography, divisions) {
  const [column, row] = cell;
  const scaleX = image.naturalWidth / SOURCE_SIZE.width;
  const scaleY = image.naturalHeight / SOURCE_SIZE.height;
  const sx = column * FACE_SIZE * scaleX;
  const sy = row * FACE_SIZE * scaleY;
  const sw = FACE_SIZE * scaleX;
  const sh = FACE_SIZE * scaleY;
  const points = [];
  for (let rowIndex = 0; rowIndex <= divisions; rowIndex++) {
    const v = rowIndex / divisions;
    const line = [];
    for (let columnIndex = 0; columnIndex <= divisions; columnIndex++) {
      const u = columnIndex / divisions;
      const projected = projectPoint(homography, u, v);
      if (!projected) return null;
      line.push({ u, v, ...projected });
    }
    points.push(line);
  }

  const triangles = [];
  for (let rowIndex = 0; rowIndex < divisions; rowIndex++) {
    for (let columnIndex = 0; columnIndex < divisions; columnIndex++) {
      const tl = points[rowIndex][columnIndex];
      const tr = points[rowIndex][columnIndex + 1];
      const br = points[rowIndex + 1][columnIndex + 1];
      const bl = points[rowIndex + 1][columnIndex];
      const sourcePoint = point => ({ x: sx + point.u * sw, y: sy + point.v * sh });
      for (const vertices of [[tl, tr, br], [tl, br, bl]]) {
        const source = vertices.map(sourcePoint);
        const destination = vertices.map(point => ({ x: point.x, y: point.y }));
        const transform = affineFromTriangles(source, destination);
        if (!transform) return null;
        const sourceX = Math.min(...source.map(point => point.x));
        const sourceY = Math.min(...source.map(point => point.y));
        const sourceRight = Math.max(...source.map(point => point.x));
        const sourceBottom = Math.max(...source.map(point => point.y));
        triangles.push({
          sourceRect: { x: sourceX, y: sourceY, width: sourceRight - sourceX, height: sourceBottom - sourceY },
          destination: expandedTriangle(destination),
          transform,
        });
      }
    }
  }
  return { sx, sy, sw, sh, triangles };
}

function drawTriangle(ctx, image, triangle, alpha) {
  const { x: sx, y: sy, width: sw, height: sh } = triangle.sourceRect;
  let saved = false;
  try {
    ctx.save();
    saved = true;
    ctx.beginPath();
    ctx.moveTo(triangle.destination[0].x, triangle.destination[0].y);
    ctx.lineTo(triangle.destination[1].x, triangle.destination[1].y);
    ctx.lineTo(triangle.destination[2].x, triangle.destination[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(triangle.transform.a, triangle.transform.b, triangle.transform.c,
      triangle.transform.d, triangle.transform.e, triangle.transform.f);
    ctx.globalAlpha = alpha;
    // Draw only the source triangle's bounding box; at the 4x4 mesh limit this
    // keeps raster work close to one atlas cell rather than 32 full-cell draws.
    ctx.drawImage(image, sx, sy, sw, sh, sx, sy, sw, sh);
    return true;
  } catch {
    return false;
  } finally {
    if (saved) {
      try { ctx.restore(); } catch { /* Keep optional facade paint isolated. */ }
    }
  }
}

function drawShade(ctx, shape, shade) {
  if (shade <= 0) return true;
  let saved = false;
  try {
    ctx.save();
    saved = true;
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let index = 1; index < shape.points.length; index++) {
      ctx.lineTo(shape.points[index].x, shape.points[index].y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * shade;
    ctx.fillStyle = '#000';
    ctx.fillRect(shape.left, shape.top, shape.right - shape.left, shape.bottom - shape.top);
    return true;
  } catch {
    return false;
  } finally {
    if (saved) {
      try { ctx.restore(); } catch { /* Keep optional facade shading isolated. */ }
    }
  }
}

function drawAxisAlignedFacade(ctx, image, cell, shape, shade, alpha) {
  const [column, row] = cell;
  const scaleX = image.naturalWidth / SOURCE_SIZE.width;
  const scaleY = image.naturalHeight / SOURCE_SIZE.height;
  const sx = column * FACE_SIZE * scaleX;
  const sy = row * FACE_SIZE * scaleY;
  const sw = FACE_SIZE * scaleX;
  const sh = FACE_SIZE * scaleY;
  let saved = false;
  try {
    ctx.save();
    saved = true;
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, sx, sy, sw, sh,
      shape.left, shape.top, shape.right - shape.left, shape.bottom - shape.top);
    if (shade > 0) {
      ctx.globalAlpha = alpha * shade;
      ctx.fillStyle = '#000';
      ctx.fillRect(shape.left, shape.top, shape.right - shape.left, shape.bottom - shape.top);
    }
    return true;
  } catch {
    return false;
  } finally {
    if (saved) {
      try { ctx.restore(); } catch { /* Keep optional facade paint isolated. */ }
    }
  }
}

/** Optional perspective facade atlas; its readiness never gates gameplay. */
export class StreetFacadeArt {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = DEFAULT_TIMEOUT_MS,
    atlasUrl = FACADE_ATLAS_URL, cells = CELLS, lazy = false } = {}) {
    this.image = null;
    this.cells = cells;
    this.status = Object.fromEntries(Object.keys(cells).map(kind => [kind, 'pending']));
    this.load=()=>this._ready??=loadImage(atlasUrl, ImageCtor, timeoutMs).then(image => {
      this.image = image;
      for (const kind of Object.keys(cells)) this.status[kind] = image ? 'ready' : 'fallback';
      return this;
    });
    if(!lazy)this.load();
  }
  get ready(){return this.load();}

  get atlasReady() { return validImage(this.image); }
  get stats() { return Object.freeze({ ...this.status }); }

  drawFacade(ctx, quad, kind, { shade = 0 } = {}) {
    if (!Object.hasOwn(this.cells, kind)) return false;
    const shape = quadData(quad);
    if (!shape) return false;
    // Hidden facades are intentionally complete without invoking a fallback,
    // even while an optional atlas is still decoding or unavailable.
    if (fullyOutsideCanvas(ctx, shape)) return true;
    if (!this.atlasReady || typeof ctx?.save !== 'function' || typeof ctx?.restore !== 'function'
      || typeof ctx?.drawImage !== 'function') return false;
    const safeShade = Number.isFinite(shade) ? Math.max(0, Math.min(.85, shade)) : 0;
    const alpha = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
    const cell = this.cells[kind];
    if (isAxisAlignedRect(shape.points)) {
      if (safeShade > 0 && typeof ctx.fillRect !== 'function') return false;
      return drawAxisAlignedFacade(ctx, this.image, cell, shape, safeShade, alpha);
    }
    if (typeof ctx.beginPath !== 'function' || typeof ctx.moveTo !== 'function'
      || typeof ctx.lineTo !== 'function' || typeof ctx.closePath !== 'function'
      || typeof ctx.clip !== 'function' || typeof ctx.transform !== 'function'
      || (safeShade > 0 && typeof ctx.fillRect !== 'function')) return false;

    const homography = homographyForQuad(shape.points);
    if (!homography) return false;
    const divisions = shape.maxDimension < 50 ? 1 : shape.maxDimension < 140 ? 2 : 4;
    const plan = makeTrianglePlan(this.image, cell, homography, divisions);
    if (!plan) return false;
    for (const triangle of plan.triangles) {
      if (!drawTriangle(ctx, this.image, triangle, alpha)) return false;
    }
    return drawShade(ctx, shape, safeShade);
  }
}

export const STREET_FACADE_ART = new StreetFacadeArt({lazy:true,timeoutMs:10000});

export function drawFacade(ctx, quad, kind, options = {}) {
  return STREET_FACADE_ART.drawFacade(ctx, quad, kind, options);
}
