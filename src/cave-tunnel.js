import { projectStreet } from './street-camera.js';
import { CaveGPU } from './cave-gpu.js';

// The pinhole camera is exactly projectStreet's camera, including its pitch.
// Every background pixel samples one point on a rock vault or the floor.
// Materials are indexed in world space, never translated as a screen layer.
export const CAVE_CAMERA_DEPTH = 1 / .65;
const TAU = Math.PI * 2;
const CPU_MAX_WIDTH = 260;
const CPU_MAX_HEIGHT = 420;
const PROFILE_SEGMENTS = 512;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (v, n) => ((v % n) + n) % n;
const geometryCache = new Map();

function rockRadius(cosine, sine) {
  // A lopsided limestone section, with no animated radius or camera sway.
  return 1 + .075 * (4 * cosine ** 3 - 3 * cosine)
    + .045 * (16 * sine ** 5 - 20 * sine ** 3 + 5 * sine);
}

function rockBoundary(geometry, x, y) {
  const nx = x / geometry.radiusX, ny = (y - geometry.centerY) / geometry.radiusY;
  const length = Math.hypot(nx, ny);
  if (length < 1e-10) return -1;
  return length - rockRadius(nx / length, ny / length);
}

export function caveTunnelGeometry(width, height) {
  const key = `${width}:${height}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const eye = height * .52 / (width * .235);
  const centerY = eye * .35 + .9;
  const radiusY = eye * .65 + 2.9;
  const profile = Array.from({ length: PROFILE_SEGMENTS + 1 }, (_, index) => {
    const angle = index / PROFILE_SEGMENTS * TAU;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const radius = rockRadius(cosine, sine);
    return Object.freeze({ lane: cosine * 3.65 * radius,
      elevation: centerY + sine * radiusY * radius });
  });
  const geometry = { width, height, eye, focal: width * .235 / .65,
    horizon: height * .28, radiusX: 3.65, centerY, radiusY,
    roof: centerY + radiusY * rockRadius(0, 1) };
  Object.defineProperty(geometry, 'profile', { value: Object.freeze(profile), enumerable: false });
  Object.freeze(geometry);
  geometryCache.set(key, geometry);
  if (geometryCache.size > 8) geometryCache.delete(geometryCache.keys().next().value);
  return geometry;
}

export function caveRoofAtLane(geometry, lane) {
  let low = geometry.centerY, high = geometry.centerY + geometry.radiusY * 1.2;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) * .5;
    if (rockBoundary(geometry, lane, mid) > 0) high = mid; else low = mid;
  }
  return (low + high) * .5;
}

export function traceCaveSurface(geometry, pixelX, pixelY, travel = 0) {
  const { width, eye, focal, horizon, radiusX, radiusY, centerY } = geometry;
  const dx = (pixelX - width * .5) / focal;
  const dy = (horizon - pixelY) / focal;
  const offset = eye - centerY;
  const a = dx * dx / (radiusX * radiusX) + dy * dy / (radiusY * radiusY);
  const b = 2 * offset * dy / (radiusY * radiusY);
  const c = offset * offset / (radiusY * radiusY) - 1;
  let depth = a > 1e-14 ? (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a) : Infinity;
  if (Number.isFinite(depth) && depth < 180) {
    let low = 0, high = depth * 1.6;
    for (let i = 0; i < 15; i++) {
      const mid = (low + high) * .5;
      if (rockBoundary(geometry, dx * mid, eye + dy * mid) > 0) high = mid; else low = mid;
    }
    depth = (low + high) * .5;
  }
  let surface = 'rock';
  const floorDepth = dy < 0 ? -eye / dy : Infinity;
  if (floorDepth < depth) { depth = floorDepth; surface = 'floor'; }
  if (!Number.isFinite(depth) || depth > 120) return { surface: 'void', depth: 120, distance: 120,
    lane: 0, elevation: eye, at: travel + 120 };
  return { surface, depth, distance: depth - CAVE_CAMERA_DEPTH, lane: dx * depth,
    elevation: eye + dy * depth, at: travel + depth - CAVE_CAMERA_DEPTH };
}

export function caveSurfaceUV(geometry, surface, lane, elevation, at) {
  if (surface === 'floor') return { u: at / 5.8, v: lane / 3.85 };
  const angle = Math.atan2((elevation - geometry.centerY) / geometry.radiusY,
    lane / geometry.radiusX);
  // Whole repeats close around atan2's +/-PI seam without a material jump.
  return { u: at / 5.8, v: angle / TAU * 4 };
}

function proceduralTexture(side, rock) {
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = (y * side + x) * 4;
    const grain = Math.sin(x * 1.71 + y * 2.13) * 7 + Math.sin(x * .21 - y * .38) * 9;
    const layers = Math.sin(y * .12 + Math.sin(x * .04) * 2) * 10;
    const base = (rock ? 112 : 135) + grain + layers;
    pixels[i] = base * (rock ? 1.03 : 1.06); pixels[i + 1] = base;
    pixels[i + 2] = base * .9; pixels[i + 3] = 255;
  }
  return pixels;
}

/** A bounded CPU surface buffer; sharp dogs and hazards stay on the foreground. */
export class CaveTunnel {
  constructor({ documentRef = globalThis.document, gpu = null } = {}) {
    this.documentRef = documentRef; this.cache = null; this.materialKey = null;
    this.textures = null; this.lastTravel = null; this.samples = [];
    this.gpu = gpu ?? new CaveGPU({ documentRef });
    this.backend = 'uninitialized';
    this.geometry = null;
  }

  prepare(renderer, art) {
    if (!renderer || !Number.isFinite(renderer.width) || !Number.isFinite(renderer.height)
      || renderer.width <= 0 || renderer.height <= 0) return false;
    const geometry = caveTunnelGeometry(renderer.width, renderer.height);
    this.geometry = geometry;
    let gpuReady = false;
    try {
      gpuReady = this.gpu?.prepare?.(renderer, art, geometry) === true;
    } catch { /* The first draw can still use the bounded Canvas fallback. */ }
    // A compact fallback is prepared before play so a runtime context loss
    // never has to build a ray map during a timed frame.
    this.backend = gpuReady ? 'webgl' : 'cpu';
    const cpuReady = this.prepareCPU(renderer, art);
    return gpuReady || cpuReady;
  }

  prepareCPU(renderer, art) {
    const width = renderer.width, height = renderer.height;
    // The fallback is intentionally bounded. The normal renderer keeps the
    // complete native DPR surface in the GPU canvas.
    const ratio = Math.min(1, CPU_MAX_WIDTH / width, CPU_MAX_HEIGHT / height);
    const bw = Math.max(1, Math.round(width * ratio)), bh = Math.max(1, Math.round(height * ratio));
    if (!this.cache || this.cache.width !== width || this.cache.height !== height) {
      const canvas = this.documentRef?.createElement?.('canvas');
      const ctx = canvas?.getContext?.('2d');
      if (!canvas || !ctx?.createImageData) return false;
      canvas.width = bw; canvas.height = bh;
      const geometry = caveTunnelGeometry(width, height), count = bw * bh;
      const depth = new Float32Array(count), u = new Float32Array(count), v = new Uint16Array(count);
      const shade = new Float32Array(count), fog = new Float32Array(count), floor = new Uint8Array(count);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const hit = traceCaveSurface(geometry, (x + .5) * width / bw, (y + .5) * height / bh);
        const uv = caveSurfaceUV(geometry, hit.surface, hit.lane, hit.elevation, hit.at);
        depth[i] = hit.distance; u[i] = uv.u * 256; v[i] = Math.floor(mod(uv.v, 1) * 256);
        floor[i] = hit.surface === 'floor' ? 1 : hit.surface === 'void' ? 2 : 0;
        const haze = 1 - Math.exp(-Math.max(0, hit.distance - .5) / 24);
        fog[i] = hit.surface === 'void' ? 1 : haze;
        // The lit floor joins the darker shoulders softly; there is no beige runway.
        const edgeLight = 1 - .24 * clamp((Math.abs(hit.lane) - 1.35) / 1.7, 0, 1);
        const roofShade = hit.elevation > geometry.eye + .6 ? .8 : 1;
        const nx = hit.lane / geometry.radiusX ** 2;
        const ny = (hit.elevation - geometry.centerY) / geometry.radiusY ** 2;
        const normalLength = Math.hypot(nx, ny) || 1;
        const lightLength = Math.hypot(hit.lane, hit.elevation - geometry.eye) || 1;
        const incidence = clamp((nx * hit.lane + ny * (hit.elevation - geometry.eye))
          / normalLength / lightLength, 0, 1);
        shade[i] = (hit.surface === 'floor' ? .91 * edgeLight
          : .76 * roofShade * (.55 + .45 * incidence)) * (1 - haze);
      }
      this.cache = { width, height, bw, bh, canvas, ctx, geometry, depth, u, v, shade, fog, floor,
        image: ctx.createImageData(bw, bh) };
      this.lastTravel = null;
    }
    const key = `${art?.stats?.atlas}:${art?.stats?.materials}`;
    if (this.materialKey !== key || !this.textures) {
      const load = kind => {
        const material = art?.material?.(renderer, kind);
        if (!material?.tile) return proceduralTexture(256, kind === 'wall');
        try {
          const tile = this.documentRef.createElement('canvas'); tile.width = tile.height = 256;
          const ctx = tile.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(material.tile, 0, 0, 256, 256);
          const pixels = ctx.getImageData(0, 0, 256, 256).data;
          const lit = new Uint8ClampedArray(pixels.length);
          // Relief belongs to the material's world UVs, so its fissures do not slide.
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const i = (y * 256 + x) * 4;
            const left = (y * 256 + ((x + 255) & 255)) * 4;
            const above = (((y + 255) & 255) * 256 + x) * 4;
            const slope = clamp((pixels[i] - pixels[left] + pixels[i + 1] - pixels[above + 1]) / 180, -.3, .3);
            const relief = kind === 'wall' ? 1 + slope : 1 + slope * .3;
            for (let channel = 0; channel < 3; channel++) lit[i + channel] = pixels[i + channel] * relief;
            lit[i + 3] = 255;
          }
          return lit;
        } catch { return proceduralTexture(256, kind === 'wall'); }
      };
      this.textures = [load('wall'), load('path')]; this.materialKey = key; this.lastTravel = null;
    }
    return true;
  }

  draw(renderer, travel, art) {
    if (!renderer?.ctx || !Number.isFinite(renderer.width) || !Number.isFinite(renderer.height)
      || renderer.width <= 0 || renderer.height <= 0) return false;
    const geometry = caveTunnelGeometry(renderer.width, renderer.height);
    this.geometry = geometry;
    try {
      if (this.gpu?.draw?.(renderer, travel, art, geometry) === true) {
        this.backend = 'webgl';
        this.samples = this.surfaceAnchors(travel, geometry, true);
        return true;
      }
    } catch { /* The CPU surface is the recovery path for WebGL failures. */ }
    this.backend = 'cpu';
    if (!this.prepareCPU(renderer, art)) return false;
    const c = this.cache;
    if (this.lastTravel !== travel) {
      const out = c.image.data, shift = travel / 5.8 * 256;
      for (let i = 0; i < c.floor.length; i++) {
        const o = i * 4;
        if (c.floor[i] === 2) { out[o] = 12; out[o + 1] = 17; out[o + 2] = 18; out[o + 3] = 255; continue; }
        const texture = this.textures[c.floor[i]], sample = c.u[i] + shift;
        const whole = Math.floor(sample), fraction = sample - whole;
        const tx = mod(whole, 256), next = (tx + 1) & 255;
        const a = (c.v[i] * 256 + tx) * 4, b = (c.v[i] * 256 + next) * 4;
        const light = c.shade[i], haze = c.fog[i];
        const entrance = clamp((10 - c.depth[i] - travel) / 10, 0, 1);
        out[o] = (texture[a] + (texture[b] - texture[a]) * fraction) * light * (1 + entrance * .2) + 12 * haze + entrance * 7;
        out[o + 1] = (texture[a + 1] + (texture[b + 1] - texture[a + 1]) * fraction) * light * (1 + entrance * .08) + 17 * haze;
        out[o + 2] = (texture[a + 2] + (texture[b + 2] - texture[a + 2]) * fraction) * light * (1 - entrance * .08) + 18 * haze;
        out[o + 3] = 255;
      }
      c.ctx.putImageData(c.image, 0, 0); this.lastTravel = travel;
    }
    renderer.ctx.save(); renderer.ctx.imageSmoothingEnabled = true;
    renderer.ctx.imageSmoothingQuality = 'high';
    renderer.ctx.drawImage(c.canvas, 0, 0, c.width, c.height); renderer.ctx.restore();
    this.samples = this.surfaceAnchors(travel, c.geometry, false);
    return true;
  }

  surfaceAnchors(travel, geometry = this.cache?.geometry, native = false) {
    if (!geometry) return [];
    const g = geometry, points = [];
    for (let index = 0; index < 12; index++) {
      const at = 2 + index * 4.4, distance = at - travel;
      if (distance < -.7 || distance > 52) continue;
      for (const [kind, angle] of [['left', Math.PI], ['right', 0], ['roof', Math.PI * .5]]) {
        const radius = rockRadius(Math.cos(angle), Math.sin(angle));
        const lane = Math.cos(angle) * g.radiusX * radius;
        const elevation = g.centerY + Math.sin(angle) * g.radiusY * radius;
        const p = projectStreet(g.width, g.height, lane, distance, elevation);
        if (p.x < 0 || p.x >= g.width || p.y < 0 || p.y >= g.height) continue;
        const sampleWidth = native ? this.gpu?.stats?.width ?? g.width : this.cache?.bw ?? g.width;
        const sampleHeight = native ? this.gpu?.stats?.height ?? g.height : this.cache?.bh ?? g.height;
        const pixelX = Math.min(sampleWidth - 1, Math.floor(p.x / g.width * sampleWidth));
        const pixelY = Math.min(sampleHeight - 1, Math.floor(p.y / g.height * sampleHeight));
        let rasterSample;
        if (native) {
          const sampleX = (pixelX + .5) * g.width / sampleWidth;
          const sampleY = (pixelY + .5) * g.height / sampleHeight;
          const hit = traceCaveSurface(g, sampleX, sampleY, travel);
          rasterSample = { x: sampleX, y: sampleY, at: hit.at, surface: hit.surface, source:'analytic-ray' };
        } else {
          const pixel = pixelY * this.cache.bw + pixelX;
          rasterSample = { x: (pixelX + .5) * g.width / this.cache.bw,
            y: (pixelY + .5) * g.height / this.cache.bh,
            at: this.cache.depth[pixel] + travel,
            surface: ['rock', 'floor', 'void'][this.cache.floor[pixel]], source:'cpu-raster' };
        }
        points.push({ id: `tunnel-${kind}-${index}`, kind, lane, elevation, at, distance, ...p,
          ...caveSurfaceUV(g, 'rock', lane, elevation, at),
          rasterSample });
      }
    }
    return points;
  }

  get stats() {
    const width = this.backend === 'webgl' ? this.gpu?.stats?.width ?? 0 : this.cache?.bw ?? 0;
    const height = this.backend === 'webgl' ? this.gpu?.stats?.height ?? 0 : this.cache?.bh ?? 0;
    return { mode: this.backend === 'webgl' ? 'gpu-world-vault' : 'cpu-world-vault',
      width, height, surfaces: this.samples,
      geometry: this.geometry ?? this.cache?.geometry ?? null,
      gpu: this.gpu?.stats ?? null };
  }
}
