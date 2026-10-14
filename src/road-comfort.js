import { CONFIG } from './config.js';

export const ROAD_DECORATION_MODES = Object.freeze(['standard', 'modest', 'minimal']);

export const ROAD_COMFORT_FLAGS = Object.freeze({
  trailBend: true,
  crossLines: true,
  nearDecorations: true,
  farParallax: true,
  dogMotion: true,
  creekBoards: true,
});

export const ROAD_CATEGORIES = Object.freeze([
  'road_cross_line', 'road_texture', 'road_stone', 'road_grass',
  'road_flower', 'road_fence', 'road_landmark',
]);

const MODE_THRESHOLD = Object.freeze({ standard: 1, modest: .5, minimal: .16 });
const LINE_SPACING = .8;
const BOTTOM_START = .6;
const WINDOW_MS = 1_000;
const UINT32_RANGE = 0x1_0000_0000;

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable FNV-1a based hash, versioned by callers when used for visual choices. */
export function stableHash32(value) {
  return fnv1a(String(value));
}

export function deriveVisualSeed(runSeed = 1) {
  const normalized = Number.isFinite(runSeed) ? runSeed >>> 0 : 1;
  return stableHash32(`road-visual-v1:${normalized}`);
}

export function shouldKeepRoadDecoration({
  visualSeed = 1, objectId, mode = 'modest', reducedMotion = false,
  essential = false, near = false, flags = ROAD_COMFORT_FLAGS,
} = {}) {
  if (!ROAD_DECORATION_MODES.includes(mode)) throw new RangeError(`Unknown road decoration mode: ${mode}`);
  if (essential) return true;
  if (near && flags.nearDecorations === false) return false;
  const threshold = MODE_THRESHOLD[mode] * (reducedMotion ? .5 : 1);
  const hash = stableHash32(`road-object-v1:${visualSeed >>> 0}:${String(objectId)}`);
  return hash / UINT32_RANGE < threshold;
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const left = Number.isFinite(bounds.left) ? bounds.left : bounds.x;
  const top = Number.isFinite(bounds.top) ? bounds.top : bounds.y;
  const right = Number.isFinite(bounds.right) ? bounds.right : left + bounds.width;
  const bottom = Number.isFinite(bounds.bottom) ? bounds.bottom : top + bounds.height;
  if (![left, top, right, bottom].every(Number.isFinite) || right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

export function clipRoadBounds(bounds, width, height) {
  const normalized = normalizeBounds(bounds);
  if (!normalized || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const clipped = {
    left: Math.max(0, normalized.left),
    top: Math.max(0, normalized.top),
    right: Math.min(width, normalized.right),
    bottom: Math.min(height, normalized.bottom),
  };
  return clipped.right <= clipped.left || clipped.bottom <= clipped.top ? null : clipped;
}

/** Inverse of Renderer.project's y curve for the 60% viewport reference line. */
export function roadReferenceDistance(height, lookAhead = CONFIG.lookAhead) {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(lookAhead) || lookAhead <= 0) return 0;
  const curveProgress = ((.8 - BOTTOM_START) / .56) ** (1 / .72);
  return lookAhead * curveProgress;
}

function linearChannel(byte) {
  const channel = byte / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}

function parseHexColor(color) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) throw new TypeError(`Expected an opaque hex color, got ${color}`);
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1];
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function relativeLuminance(color) {
  const [red, green, blue] = parseHexColor(color).map(linearChannel);
  return .2126 * red + .7152 * green + .0722 * blue;
}

/** Difference after source-over compositing in sRGB, measured as linear luminance. */
export function compositedLuminanceDelta(foreground, background, alpha = 1) {
  const opacity = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
  const over = parseHexColor(foreground), under = parseHexColor(background);
  const composite = `#${over.map((channel, index) => Math.round(channel * opacity + under[index] * (1 - opacity))
    .toString(16).padStart(2, '0')).join('')}`;
  return Math.abs(relativeLuminance(composite) - relativeLuminance(background));
}

function activeGameState(state) {
  return state === 'running' || state === 'falling';
}

/**
 * Frame-level, CSS-pixel road observations and world-trajectory line counts.
 * Lines use a stable world lattice; frame loss cannot skip a crossing.
 */
export class RoadComfortTracker {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.runKey = null;
    this.lastActive = null;
    this.events = [];
    this.units = new Map();
    this.activeMs = 0;
    this.referenceY = 0;
    this.crossedLines = [];
    this.snapshot = this.#emptySnapshot();
  }

  #emptySnapshot() {
    return Object.freeze({
      crossLinesBottom40: 0,
      decorativeObjectsBottom40: 0,
      crossingsPerSecond: null,
      crossingsInWindow: 0,
      windowMs: 0,
      windowReady: false,
      referenceY: 0,
      observedUnits: Object.freeze([]),
      crossedLines: Object.freeze([]),
    });
  }

  beginFrame({ width, height, runSeed = 1, generation = runSeed, phase = 1, distance = 0, activeMs = 0, state = 'ready', visible = true, lineVisible = () => true } = {}) {
    // A seed can intentionally be reused for a fresh attempt. Generation is
    // the run identity; keeping it in the key also prevents crossing events
    // from one attempt leaking into another with the same visual seed.
    const nextRunKey = `${phase}:${runSeed >>> 0}:${generation}`;
    const resized = width !== this.width || height !== this.height;
    if (resized || this.runKey !== nextRunKey) {
      this.lastActive = null;
      this.events = [];
    }
    this.width = width;
    this.height = height;
    this.runKey = nextRunKey;
    this.units = new Map();
    const validFrame = visible && activeGameState(state)
      && Number.isFinite(distance) && Number.isFinite(activeMs) && width > 0 && height > 0;
    const crossedLines = [];

    if (!validFrame) {
      this.lastActive = null;
    } else {
      const current = { distance, activeMs };
      if (this.lastActive) {
        const previous = this.lastActive;
        if (distance >= previous.distance && activeMs >= previous.activeMs) {
          const reference = roadReferenceDistance(height);
          const firstIndex = Math.floor((previous.distance + reference) / LINE_SPACING) + 1;
          const lastIndex = Math.floor((distance + reference) / LINE_SPACING);
          const distanceDelta = distance - previous.distance;
          const timeDelta = activeMs - previous.activeMs;
          for (let index = firstIndex; index <= lastIndex; index++) {
            const lineId = `road-cross-${index}`;
            if (!lineVisible(lineId, runSeed >>> 0)) continue;
            const worldDistance = index * LINE_SPACING;
            const fraction = distanceDelta > 0 ? (worldDistance - reference - previous.distance) / distanceDelta : 0;
            const event = {
              lineId,
              generation,
              timeMs: previous.activeMs + Math.max(0, Math.min(1, fraction)) * timeDelta,
            };
            this.events.push(event);
            crossedLines.push(event);
          }
        } else {
          this.events = [];
        }
      }
      this.lastActive = current;
    }

    const now = Number.isFinite(activeMs) ? Math.max(0, activeMs) : 0;
    this.events = this.events.filter(event => event.timeMs > now - WINDOW_MS && event.timeMs <= now);
    this.crossedLines = crossedLines;
    this.activeMs = now;
    this.referenceY = height * BOTTOM_START;
  }

  record({ objectId, generation = 0, category, bounds, alpha = 1, lineId = null, worldLaneBounds } = {}) {
    if (!ROAD_CATEGORIES.includes(category) || !Number.isFinite(alpha) || alpha <= 0) return false;
    const clipped = clipRoadBounds(bounds, this.width, this.height);
    if (!clipped || clipped.bottom < this.referenceY || clipped.top > this.height) return false;
    const stableId = String(objectId ?? lineId ?? '');
    if (!stableId) return false;
    const key = `${category}:${stableId}:${generation}`;
    if (this.units.has(key)) return true;
    this.units.set(key, Object.freeze({
      objectId: stableId,
      generation,
      category,
      lineId: lineId ?? undefined,
      bounds: Object.freeze(clipped),
      alpha: Math.min(1, alpha),
      ...(worldLaneBounds && Number.isFinite(worldLaneBounds.min) && Number.isFinite(worldLaneBounds.max)
        ? { worldLaneBounds: Object.freeze({ min: worldLaneBounds.min, max: worldLaneBounds.max }) } : {}),
    }));
    return true;
  }

  endFrame() {
    const observedUnits = [...this.units.values()];
    const crossLinesBottom40 = observedUnits.filter(unit => unit.category === 'road_cross_line').length;
    const decorativeObjectsBottom40 = observedUnits.length - crossLinesBottom40;
    const windowReady = this.activeMs >= WINDOW_MS;
    const crossingsInWindow = this.events.length;
    this.snapshot = Object.freeze({
      crossLinesBottom40,
      decorativeObjectsBottom40,
      crossingsPerSecond: windowReady ? crossingsInWindow : null,
      crossingsInWindow,
      windowMs: Math.min(WINDOW_MS, this.activeMs),
      windowReady,
      referenceY: this.referenceY,
      observedUnits: Object.freeze(observedUnits),
      crossedLines: Object.freeze([...(this.crossedLines ?? [])]),
    });
    return this.snapshot;
  }

  resetTrajectory() {
    this.lastActive = null;
  }
}
