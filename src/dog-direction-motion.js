// Optional screen-space head yaw for the natural 2D home dog. The base dog is
// painted first; a bounded head-only mesh then replaces its face in place.
import { createHeadMotionRegion, headMotionPoint } from './dog-natural-motion.js';

const DEFAULT_METADATA_URL = new URL('../art/dog-direction/metadata.json', import.meta.url);
const DEFAULT_HEADS_URL = new URL('../art/dog-direction/heads.webp', import.meta.url);
const CANONICAL_SIZE = 384;
const REFERENCE_HEIGHT = 336;
const REFERENCE_GROUND = 372;
const REFERENCE_EYE_MID = { x: 183, y: 127.5 };
const LOAD_TIMEOUT_MS = 3_000;
const SCRATCH_PADDING = 19;
const EPSILON = 1e-5;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => Number.isFinite(value);
const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

function pointXY(point) {
  if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
  return { x: Number(point?.x), y: Number(point?.y) };
}

function numericCell(cell) {
  if (!cell || typeof cell !== 'object') return null;
  const x = Number(cell.x), y = Number(cell.y);
  const width = Number(cell.width ?? cell.w), height = Number(cell.height ?? cell.h);
  if (![x, y, width, height].every(finite) || x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function normalizeMetadata(metadata) {
  if (!metadata || metadata.version !== 1 || metadata.canonicalSize !== CANONICAL_SIZE
    || metadata.referenceHeight !== REFERENCE_HEIGHT || metadata.ground !== REFERENCE_GROUND) return null;
  const rect = metadata.rect;
  if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(finite)
    || rect.left < 0 || rect.top < 0 || rect.width <= 0 || rect.height <= 0
    || rect.left + rect.width > CANONICAL_SIZE || rect.top + rect.height > CANONICAL_SIZE) return null;

  const sheet = metadata.sheet ?? metadata.imageSheet ?? metadata.atlas;
  const cells = sheet?.cells ?? metadata.cells;
  const leftCell = numericCell(cells?.left);
  const rightCell = numericCell(cells?.right);
  const controls = metadata.controls;
  if (!leftCell || !rightCell || !controls) return null;

  const front = controls.front?.map(pointXY);
  const left = controls.left?.map(pointXY);
  const right = controls.right?.map(pointXY);
  const eyeIndices = metadata.eyeIndices ?? controls.eyeIndices ?? [13, 14];
  if (!front || front.length < 3 || front.length !== left?.length || front.length !== right?.length
    || ![...front, ...left, ...right].every(point => finite(point.x) && finite(point.y))
    || !Array.isArray(eyeIndices) || eyeIndices.length !== 2
    || eyeIndices.some(index => !Number.isInteger(index) || index < 0 || index >= front.length)) return null;

  const triangles = (metadata.triangles ?? controls.triangles ?? triangulatePoints(front))
    .map(triangle => Array.isArray(triangle) ? triangle.map(Number) : []);
  if (triangles.length === 0 || triangles.some(triangle => triangle.length !== 3
    || triangle.some(index => !Number.isInteger(index) || index < 0 || index >= front.length))) return null;
  if (!trianglesHaveArea(front, triangles) || !trianglesHaveArea(left, triangles) || !trianglesHaveArea(right, triangles)) return null;

  const width = Number(sheet?.width ?? metadata.sheetWidth ?? 448);
  const height = Number(sheet?.height ?? metadata.sheetHeight ?? 224);
  if (![width, height].every(finite) || width <= 0 || height <= 0
    || leftCell.x + leftCell.width > width + EPSILON || rightCell.x + rightCell.width > width + EPSILON
    || leftCell.y + leftCell.height > height + EPSILON || rightCell.y + rightCell.height > height + EPSILON) return null;

  return {
    version: 1,
    canonicalSize: CANONICAL_SIZE,
    referenceHeight: REFERENCE_HEIGHT,
    ground: REFERENCE_GROUND,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    sheet: {
      url: sheet?.url ?? sheet?.src ?? sheet?.file ?? './heads.webp',
      width,
      height,
      cells: { left: leftCell, right: rightCell },
    },
    controls: { front, left, right, eyeIndices },
    eyeIndices,
    triangles,
  };
}

export function validateDirectionMetadata(metadata) {
  return normalizeMetadata(metadata);
}

function signedArea(points, triangle) {
  const [a, b, c] = triangle.map(index => pointXY(points[index]));
  if (![a.x, a.y, b.x, b.y, c.x, c.y].every(finite)) return Number.NaN;
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

function trianglesHaveArea(points, triangles) {
  return triangles.every(triangle => Math.abs(signedArea(points, triangle)) > EPSILON);
}

/** Deterministic Bowyer-Watson triangulation for a small set of control points. */
export function triangulatePoints(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const vertices = points.map(pointXY);
  if (!vertices.every(point => finite(point.x) && finite(point.y))) return [];
  const minX = Math.min(...vertices.map(point => point.x)), maxX = Math.max(...vertices.map(point => point.x));
  const minY = Math.min(...vertices.map(point => point.y)), maxY = Math.max(...vertices.map(point => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2, count = vertices.length;
  vertices.push({ x: midX - 32 * span, y: midY + 16 * span });
  vertices.push({ x: midX, y: midY - 32 * span });
  vertices.push({ x: midX + 32 * span, y: midY + 16 * span });
  let triangles = [[count, count + 1, count + 2]];

  const circle = triangle => {
    const [a, b, c] = triangle.map(index => vertices[index]);
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < EPSILON) return null;
    const aa = a.x * a.x + a.y * a.y, bb = b.x * b.x + b.y * b.y, cc = c.x * c.x + c.y * c.y;
    const x = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
    const y = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
    return { x, y, radius2: (x - a.x) ** 2 + (y - a.y) ** 2 };
  };

  for (let inserted = 0; inserted < count; inserted++) {
    const point = vertices[inserted], bad = [];
    for (const triangle of triangles) {
      const circumcircle = circle(triangle);
      if (circumcircle && (point.x - circumcircle.x) ** 2 + (point.y - circumcircle.y) ** 2
        <= circumcircle.radius2 + span * span * 1e-10) bad.push(triangle);
    }
    const edgeCounts = new Map();
    for (const triangle of bad) {
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge], b = triangle[(edge + 1) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const previous = edgeCounts.get(key);
        if (previous) previous.count++;
        else edgeCounts.set(key, { a, b, count: 1 });
      }
    }
    const removed = new Set(bad);
    triangles = triangles.filter(triangle => !removed.has(triangle));
    for (const edge of edgeCounts.values()) {
      if (edge.count !== 1) continue;
      let triangle = [edge.a, edge.b, inserted];
      if (signedArea(vertices, triangle) < 0) triangle = [edge.b, edge.a, inserted];
      if (Math.abs(signedArea(vertices, triangle)) > EPSILON) triangles.push(triangle);
    }
  }
  return triangles.filter(triangle => triangle.every(index => index < count));
}

/** Linearly blend corresponding canonical control points. */
export function interpolateDirectionControls(front, turned, amount) {
  if (!Array.isArray(front) || !Array.isArray(turned) || front.length !== turned.length) return [];
  const t = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  return front.map((raw, index) => {
    const a = pointXY(raw), b = pointXY(turned[index]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
}

/** Shift the authored controls so their frontal eye midpoint follows the live base pose. */
export function shiftDirectionControlsToEyeMid(points, eyes, reference = REFERENCE_EYE_MID) {
  if (!Array.isArray(points) || !Array.isArray(eyes) || eyes.length !== 2
    || ![eyes[0]?.x, eyes[0]?.y, eyes[1]?.x, eyes[1]?.y, reference?.x, reference?.y].every(finite)) return [];
  const dx = (eyes[0].x + eyes[1].x) / 2 - reference.x;
  const dy = (eyes[0].y + eyes[1].y) / 2 - reference.y;
  return translated(points.map(pointXY), dx, dy);
}

/** Place the fixed-size head work area around this frame's live eye anchor. */
export function directionScratchOrigin(storedOrigin, eyeMid, reference = REFERENCE_EYE_MID) {
  if (![storedOrigin?.x, storedOrigin?.y, eyeMid?.x, eyeMid?.y, reference?.x, reference?.y].every(finite)) return null;
  return {
    x: storedOrigin.x + eyeMid.x - reference.x,
    y: storedOrigin.y + eyeMid.y - reference.y,
  };
}

/** Return canonical mask edges around the live eye anchor, relative to scratch. */
export function directionMaskGeometry(eyeMid, origin) {
  if (![eyeMid?.x, eyeMid?.y, origin?.x, origin?.y].every(finite)) return null;
  const localX = eyeMid.x - origin.x, localY = eyeMid.y - origin.y;
  const bottom = Math.min(eyeMid.y + 100, 344);
  return {
    leftZero: localX - 105,
    leftFull: localX - 80,
    rightFull: localX + 80,
    rightZero: localX + 105,
    topZero: localY - 110,
    topFull: localY - 98,
    bottomFull: Math.min(eyeMid.y + 55, bottom - 1) - origin.y,
    bottomZero: bottom - origin.y,
  };
}

/** Bound yaw to the first non-degenerate mesh geometry along the requested path. */
export function safeDirectionAmount(front, turned, triangles, requestedAmount) {
  const requested = clamp(Number.isFinite(requestedAmount) ? requestedAmount : 0, 0, 1);
  if (requested === 0 || !Array.isArray(triangles) || triangles.length === 0
    || !trianglesHaveArea(front, triangles) || !trianglesHaveArea(turned, triangles)) return requested === 0 ? 0 : 0;
  const signs = triangles.map(triangle => Math.sign(signedArea(front, triangle)));
  const safeAt = amount => {
    const points = interpolateDirectionControls(front, turned, amount);
    return triangles.every((triangle, index) => {
      const area = signedArea(points, triangle);
      return finite(area) && Math.sign(area) === signs[index] && Math.abs(area) > EPSILON;
    });
  };
  if (safeAt(requested)) return requested;
  let previous = 0;
  for (let step = 1; step <= 64; step++) {
    const candidate = requested * step / 64;
    if (safeAt(candidate)) { previous = candidate; continue; }
    let low = previous, high = candidate;
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = (low + high) / 2;
      if (safeAt(middle)) low = middle;
      else high = middle;
    }
    return low;
  }
  return previous;
}

/** Return a Canvas 2D affine matrix mapping one triangle onto another. */
export function triangleAffine(source, destination) {
  if (!Array.isArray(source) || !Array.isArray(destination) || source.length !== 3 || destination.length !== 3) return null;
  const [s0, s1, s2] = source.map(pointXY), [d0, d1, d2] = destination.map(pointXY);
  if (![s0, s1, s2, d0, d1, d2].every(point => finite(point.x) && finite(point.y))) return null;
  const denominator = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(denominator) <= EPSILON) return null;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denominator;
  const c = ((s1.x - s0.x) * (d2.x - d0.x) - (s2.x - s0.x) * (d1.x - d0.x)) / denominator;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denominator;
  const d = ((s1.x - s0.x) * (d2.y - d0.y) - (s2.x - s0.x) * (d1.y - d0.y)) / denominator;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  return [a, b, c, d, e, f].every(finite) ? { a, b, c, d, e, f } : null;
}

function transformPoint(point, transform) {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

function readTransform(ctx) {
  if (typeof ctx?.getTransform !== 'function') return null;
  const transform = ctx.getTransform();
  const value = { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f };
  const determinant = value.a * value.d - value.b * value.c;
  return [value.a, value.b, value.c, value.d, value.e, value.f].every(finite)
    && Math.abs(determinant) > EPSILON ? value : null;
}

function projectFeatureEyes(features, layers) {
  if (!features || !Array.isArray(layers) || layers.length === 0) return null;
  let weightTotal = 0, x0 = 0, y0 = 0, rx0 = 0, ry0 = 0, x1 = 0, y1 = 0, rx1 = 0, ry1 = 0;
  for (const layer of layers) {
    const key = `${layer.atlas}:${layer.index}`;
    const feature = (features instanceof Map ? features.get(key) : null)
      ?? features[key]
      ?? features[layer.atlas]?.[layer.index]
      ?? layer.feature;
    const landmarks = feature?.landmarks ?? feature;
    const weight = Number(layer.weight);
    if (!landmarks?.eyes || landmarks.eyes.length !== 2 || !finite(weight) || weight <= 0) continue;
    const [left, right] = landmarks.eyes;
    if (![left.x, left.y, right.x, right.y].every(finite)) continue;
    weightTotal += weight;
    x0 += left.x * weight; y0 += left.y * weight; rx0 += (left.rx ?? 0) * weight; ry0 += (left.ry ?? 0) * weight;
    x1 += right.x * weight; y1 += right.y * weight; rx1 += (right.rx ?? 0) * weight; ry1 += (right.ry ?? 0) * weight;
  }
  if (weightTotal <= 0) return null;
  return [
    { x: x0 / weightTotal, y: y0 / weightTotal, rx: rx0 / weightTotal, ry: ry0 / weightTotal },
    { x: x1 / weightTotal, y: y1 / weightTotal, rx: rx1 / weightTotal, ry: ry1 / weightTotal },
  ];
}

function applyHeadPose(points, region, sample) {
  return points.map(point => headMotionPoint(point.x, point.y, region,
    sample.headAngle ?? 0, sample.headLift ?? 0, sample.headRest ?? 0));
}

function translated(points, dx, dy) {
  return points.map(point => ({ x: point.x + dx, y: point.y + dy }));
}

function isCanvasContext(ctx) {
  return !!ctx?.canvas && typeof ctx.drawImage === 'function' && typeof ctx.save === 'function'
    && typeof ctx.beginPath === 'function' && typeof ctx.clip === 'function';
}

function loadImage(url, timeoutMs, signal) {
  return new Promise(resolve => {
    if (typeof Image !== 'function') { resolve(null); return; }
    let image;
    try { image = new Image(); } catch { resolve(null); return; }
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', onAbort);
      if (!result) image.src = '';
      resolve(result);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (signal?.aborted) { finish(null); return; }
    signal?.addEventListener('abort', onAbort, {once:true});
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.decoding = 'async';
    image.src = url;
    if (typeof image.decode === 'function') image.decode().then(() => finish(image), () => {});
  });
}

function makeCanvas(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
}

function addSmoothTransition(gradient, start, end, totalStart, totalEnd, fromAlpha, toAlpha) {
  const length = totalEnd - totalStart;
  if (Math.abs(end - start) < EPSILON || Math.abs(length) < EPSILON) return;
  for (let step = 0; step <= 4; step++) {
    const progress = step / 4;
    const eased = smooth(progress);
    const coordinate = start + (end - start) * progress;
    const offset = clamp((coordinate - totalStart) / length, 0, 1);
    const alpha = fromAlpha + (toAlpha - fromAlpha) * eased;
    gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  }
}

function paintDirectionMask(context, canvas, geometry) {
  if (!context || !canvas || !geometry
    || geometry.rightZero <= geometry.leftZero
    || geometry.bottomZero <= geometry.topZero) return false;
  context.save();
  try {
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.width, canvas.height);
    const horizontal = context.createLinearGradient(geometry.leftZero, 0, geometry.rightZero, 0);
    addSmoothTransition(horizontal, geometry.leftZero, geometry.leftFull,
      geometry.leftZero, geometry.rightZero, 0, 1);
    horizontal.addColorStop(clamp((geometry.rightFull - geometry.leftZero)
      / (geometry.rightZero - geometry.leftZero), 0, 1), 'rgba(255,255,255,1)');
    addSmoothTransition(horizontal, geometry.rightFull, geometry.rightZero,
      geometry.leftZero, geometry.rightZero, 1, 0);
    context.fillStyle = horizontal;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.globalCompositeOperation = 'destination-in';
    const vertical = context.createLinearGradient(0, geometry.topZero, 0, geometry.bottomZero);
    addSmoothTransition(vertical, geometry.topZero, geometry.topFull,
      geometry.topZero, geometry.bottomZero, 0, 1);
    vertical.addColorStop(clamp((geometry.bottomFull - geometry.topZero)
      / (geometry.bottomZero - geometry.topZero), 0, 1), 'rgba(255,255,255,1)');
    addSmoothTransition(vertical, geometry.bottomFull, geometry.bottomZero,
      geometry.topZero, geometry.bottomZero, 1, 0);
    context.fillStyle = vertical;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return true;
  } finally {
    context.restore();
  }
}

function drawTriangle(ctx, image, sourceTriangle, destinationTriangle, alpha) {
  if (alpha <= 0) return true;
  const affine = triangleAffine(sourceTriangle, destinationTriangle);
  if (!affine) return false;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.moveTo(destinationTriangle[0].x, destinationTriangle[0].y);
    ctx.lineTo(destinationTriangle[1].x, destinationTriangle[1].y);
    ctx.lineTo(destinationTriangle[2].x, destinationTriangle[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, 0, 0);
    return true;
  } finally {
    ctx.restore();
  }
}

/**
 * Optional direction replacement for the existing front-facing 2D dog.
 * The destination must be a transparent dog-only canvas, not the room scene.
 * `drawBase` must synchronously paint the normal dog (with headYaw set to zero)
 * at the supplied x/foot/size and return a boolean.
 */
export class DirectionalHeadPainter {
  constructor(options = {}) {
    this.options = options;
    this.metadataUrl = new URL(options.metadataUrl ?? DEFAULT_METADATA_URL, import.meta.url);
    this.metadata = null;
    this.image = null;
    this.available = false;
    this.disposed = false;
    this.loadController = null;
    this.scratch = null;
    this.mask = null;
    this.cellScratch = null;
    this.blinkPatch = null;
    this.stats = { decodedBytes: 0, scratchBytes: 0, maskBytes: 0, peakCachedBytes: 0, available: false };
    this.ready = this.#load();
  }

  async #load() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this.loadController = controller;
    let timedOut = false;
    let candidate = null;
    const timeout = new Promise(resolve => {
      this.cancelLoad = () => resolve(null);
      this.loadTimer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
        resolve(null);
      }, this.options.timeoutMs ?? LOAD_TIMEOUT_MS);
    });
    try {
      const fetcher = this.options.fetcher ?? globalThis.fetch;
      if (typeof fetcher !== 'function') return false;
      const metadataPromise = Promise.resolve(fetcher(this.metadataUrl, controller ? { signal: controller.signal } : undefined))
        .then(response => response?.ok ? response.json() : null)
        .catch(() => null);
      const rawMetadata = await Promise.race([metadataPromise, timeout]);
      if (!rawMetadata || timedOut || this.disposed) return false;
      const metadata = normalizeMetadata(rawMetadata);
      if (!metadata) return false;

      const imageUrl = metadata.sheet.url
        ? new URL(metadata.sheet.url, this.metadataUrl).href
        : DEFAULT_HEADS_URL.href;
      const remaining = Math.max(1, (this.options.timeoutMs ?? LOAD_TIMEOUT_MS) - 1);
      const loadingImage = loadImage(imageUrl, remaining, controller?.signal).then(image => {
        if (timedOut || this.disposed) { if(image)image.src=''; return null; }
        return image;
      });
      const image = await Promise.race([loadingImage, timeout]);
      candidate = image;
      if (!image || timedOut || this.disposed) return false;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (width !== metadata.sheet.width || height !== metadata.sheet.height) return false;

      const padding = this.options.scratchPadding ?? SCRATCH_PADDING;
      const scratch = makeCanvas(Math.ceil(metadata.rect.width + padding * 2), Math.ceil(metadata.rect.height + padding * 2));
      const mask = makeCanvas(scratch?.canvas.width ?? 1, scratch?.canvas.height ?? 1);
      const cell = metadata.sheet.cells.left;
      const cellScratch = makeCanvas(Math.ceil(cell.width), Math.ceil(cell.height));
      if (!scratch || !mask || !cellScratch || metadata.sheet.cells.right.width !== cell.width
        || metadata.sheet.cells.right.height !== cell.height) return false;
      this.metadata = metadata;
      this.image = image;
      this.scratch = { ...scratch, origin: { x: metadata.rect.left - padding, y: metadata.rect.top - padding }, padding };
      this.mask = mask;
      this.cellScratch = cellScratch;
      this.blinkPatch = cellScratch.context.createImageData(
        Math.round(34 * cell.width / metadata.rect.width),
        Math.round(34 * cell.height / metadata.rect.height));
      this.available = true;
      const scratchBytes = scratch.canvas.width * scratch.canvas.height * 4
        + cellScratch.canvas.width * cellScratch.canvas.height * 4 + this.blinkPatch.data.byteLength
        + mask.canvas.width * mask.canvas.height * 4;
      const maskBytes = mask.canvas.width * mask.canvas.height * 4;
      this.stats = {
        decodedBytes: width * height * 4,
        scratchBytes,
        maskBytes,
        peakCachedBytes: width * height * 4 + scratchBytes,
        available: true,
      };
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(this.loadTimer);
      this.cancelLoad = null;
      if (!this.available) {
        if (candidate) candidate.src = '';
        this.dispose();
      }
    }
  }

  draw(ctx, { x, foot, size, sample, layers, features, drawBase } = {}) {
    const yawValue = sample?.headYaw;
    const yaw = finite(yawValue) ? clamp(yawValue, -1, 1) : 0;
    if (yaw === 0 || !this.available || !isCanvasContext(ctx) || typeof drawBase !== 'function'
      || ![x, foot, size].every(finite) || size <= 0) return false;
    const matrix = readTransform(ctx);
    const eyes = projectFeatureEyes(features, layers);
    if (!matrix || !eyes || !this.scratch) return false;

    let basePainted = false;
    try {
      basePainted = drawBase(ctx, {
        x, foot, size,
        sample: { ...sample, headYaw: 0 },
        layers,
      }) === true;
    } catch {
      return false;
    }
    if (!basePainted) return false;

    // The bounded head area follows the live eye anchor, including reclined
    // atlas frames. The torso, legs, and grounded foot rows stay in the target.
    const metadata = this.metadata, { rect, controls, triangles } = metadata;
    const scale = size / REFERENCE_HEIGHT;
    const left = x - 192 * scale, top = foot - REFERENCE_GROUND * scale;
    const center = { x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2 };
    const region = createHeadMotionRegion({ eyes });
    const requested = Math.abs(yaw);
    const side = yaw < 0 ? 'left' : 'right';
    const frontShifted = shiftDirectionControlsToEyeMid(controls.front, eyes);
    const sideShifted = shiftDirectionControlsToEyeMid(controls[side], eyes);
    // The generated metadata keeps eye landmarks at stable indices 13 and 14.
    // Re-anchor each live eye independently so natural frame tilt stays tracked.
    const eyeIndices = metadata.eyeIndices;
    if (Array.isArray(eyeIndices) && eyeIndices.length === 2
      && eyeIndices.every(index => Number.isInteger(index) && index >= 0 && index < frontShifted.length)) {
      frontShifted[eyeIndices[0]] = { ...eyes[0] };
      frontShifted[eyeIndices[1]] = { ...eyes[1] };
    }
    const amount = safeDirectionAmount(frontShifted, sideShifted, triangles, requested);
    if (amount <= 1e-4) return true;

    const rawTarget = interpolateDirectionControls(frontShifted, sideShifted, amount);
    const target = applyHeadPose(rawTarget, region, sample);
    const sourceFront = applyHeadPose(frontShifted, region, sample);
    const sourceSide = controls[side];
    const scratch = this.scratch, scratchCtx = scratch.context, scratchCanvas = scratch.canvas;
    const origin = directionScratchOrigin(scratch.origin, center);
    const maskGeometry = directionMaskGeometry(center, origin);
    if (!origin || !maskGeometry || !this.mask) return true;
    scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    scratchCtx.globalCompositeOperation = 'lighter';
    scratchCtx.globalAlpha = 1;
    const sourceTransform = matrix;
    const rasterScaleX = scratchCanvas.width / (rect.width + scratch.padding * 2);
    const rasterScaleY = scratchCanvas.height / (rect.height + scratch.padding * 2);
    const destinationPoints = target.map(point => ({
      x: (point.x - origin.x) * rasterScaleX,
      y: (point.y - origin.y) * rasterScaleY,
    }));
    const frontSource = sourceFront.map(point => {
      const world = { x: left + point.x * scale, y: top + point.y * scale };
      return transformPoint(world, sourceTransform);
    });
    const cell = metadata.sheet.cells[side];
    const sideSource = sourceSide.map(point => ({
      x: (point.x - rect.left) * cell.width / rect.width,
      y: (point.y - rect.top) * cell.height / rect.height,
    }));
    const cellCtx = this.cellScratch.context;
    cellCtx.clearRect(0, 0, this.cellScratch.canvas.width, this.cellScratch.canvas.height);
    cellCtx.drawImage(this.image, cell.x, cell.y, cell.width, cell.height,
      0, 0, this.cellScratch.canvas.width, this.cellScratch.canvas.height);
    const blink = Number.isFinite(sample.blink) ? clamp(sample.blink, 0, 1) : 0;
    if (blink > 0.001) {
      for (let index = 0; index < eyeIndices.length; index++) {
        this.#blinkProfileEye(side, eyeIndices[index], cell, blink, eyes[index]?.ry);
      }
    }
    const localTriangles = triangles;
    for (const triangle of localTriangles) {
      const targetTriangle = triangle.map(index => destinationPoints[index]);
      if (1 - amount > 0 && !drawTriangle(scratchCtx, ctx.canvas,
        triangle.map(index => frontSource[index]), targetTriangle, 1 - amount)) return true;
      if (amount > 0 && !drawTriangle(scratchCtx, this.cellScratch.canvas,
        triangle.map(index => sideSource[index]), targetTriangle, amount)) return true;
    }

    const maskReady = paintDirectionMask(this.mask.context, this.mask.canvas, {
      leftZero: maskGeometry.leftZero * rasterScaleX,
      leftFull: maskGeometry.leftFull * rasterScaleX,
      rightFull: maskGeometry.rightFull * rasterScaleX,
      rightZero: maskGeometry.rightZero * rasterScaleX,
      topZero: maskGeometry.topZero * rasterScaleY,
      topFull: maskGeometry.topFull * rasterScaleY,
      bottomFull: maskGeometry.bottomFull * rasterScaleY,
      bottomZero: maskGeometry.bottomZero * rasterScaleY,
    });
    if (!maskReady) return true;
    scratchCtx.save();
    scratchCtx.globalCompositeOperation = 'destination-in';
    scratchCtx.globalAlpha = 1;
    scratchCtx.drawImage(this.mask.canvas, 0, 0);
    scratchCtx.restore();

    const destinationX = left + origin.x * scale;
    const destinationY = top + origin.y * scale;
    const destinationWidth = scratchCanvas.width / rasterScaleX * scale;
    const destinationHeight = scratchCanvas.height / rasterScaleY * scale;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.mask.canvas, destinationX, destinationY, destinationWidth, destinationHeight);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(scratchCanvas, destinationX, destinationY, destinationWidth, destinationHeight);
    ctx.restore();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.cancelLoad?.();
    this.loadController?.abort();
    clearTimeout(this.loadTimer);
    if (this.scratch) {
      this.scratch.canvas.width = 1;
      this.scratch.canvas.height = 1;
    }
    if (this.mask) {
      this.mask.canvas.width = 1;
      this.mask.canvas.height = 1;
    }
    if(this.image)this.image.src='';
    this.image = null;
    this.scratch = null;
    this.mask = null;
    if (this.cellScratch) {
      this.cellScratch.canvas.width = 1;
      this.cellScratch.canvas.height = 1;
    }
    this.cellScratch = null;
    this.blinkPatch = null;
    this.available = false;
    this.stats.available = false;
    this.stats.decodedBytes = 0;
    this.stats.scratchBytes = 0;
    this.stats.maskBytes = 0;
    this.stats.peakCachedBytes = 0;
  }

  #blinkProfileEye(side, eyeIndex, cell, strength, eyeRy) {
    const metadata = this.metadata;
    const eye = metadata.controls[side][eyeIndex];
    const scaleX = cell.width / metadata.rect.width, scaleY = cell.height / metadata.rect.height;
    const width = this.blinkPatch.width, height = this.blinkPatch.height;
    const cx = (eye.x - metadata.rect.left) * scaleX;
    const cy = (eye.y - metadata.rect.top) * scaleY;
    const left = clamp(Math.floor(cx - width / 2), 0, this.cellScratch.canvas.width - width);
    const top = clamp(Math.floor(cy - height / 2), 0, this.cellScratch.canvas.height - height);
    const source = this.cellScratch.context.getImageData(left, top, width, height).data;
    const output = this.blinkPatch.data;
    const rx = 17 * scaleX, ry = 17 * scaleY;
    const radius = clamp((finite(eyeRy) ? eyeRy : 6) + 1, 5, 9) * scaleY;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const taper = 1 - smooth(Math.abs((x - (cx - left)) / rx));
        const amount = strength * 0.94 * taper;
        const delta = y - (cy - top), inner = radius * (1 - amount), absolute = Math.abs(delta);
        const sourceY = clamp(cy - top + Math.sign(delta) * (absolute < inner
          ? absolute / (1 - amount)
          : radius + (absolute - inner) * (ry - radius) / (ry - inner)), 0, height - 1);
        const y0 = Math.floor(sourceY), y1 = Math.min(height - 1, y0 + 1), mix = sourceY - y0;
        const destination = (y * width + x) * 4, p0 = (y0 * width + x) * 4, p1 = (y1 * width + x) * 4;
        for (let channel = 0; channel < 4; channel++) output[destination + channel] = source[p0 + channel] * (1 - mix) + source[p1 + channel] * mix;
      }
    }
    this.cellScratch.context.putImageData(this.blinkPatch, left, top);
  }
}
