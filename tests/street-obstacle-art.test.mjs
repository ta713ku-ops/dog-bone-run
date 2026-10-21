import assert from 'node:assert/strict';
import test from 'node:test';
import { StreetObstacleArt } from '../src/street-obstacle-art.js';

const TYPES = ['litter', 'crow', 'cat'];
const CELLS = Object.freeze({
  litter: Object.freeze({ crop: Object.freeze([12, 138, 271, 138]), root: Object.freeze([147.5, 274]) }),
  crow: Object.freeze({ crop: Object.freeze([361, 12, 231, 273]), root: Object.freeze([476.5, 283]) }),
  cat: Object.freeze({ crop: Object.freeze([664, 9, 224, 271]), root: Object.freeze([776, 278]) }),
});

function fakeRenderer({ width = 64, height = 40, x = 120, y = 200 } = {}) {
  const operations = [];
  const ctx = {
    globalAlpha: 1,
    save() { operations.push({ kind: 'save' }); },
    restore() { operations.push({ kind: 'restore' }); },
    drawImage(...args) { operations.push({ kind: 'image', args }); },
    createLinearGradient(...args) {
      operations.push({ kind: 'gradient', args });
      return { addColorStop() {} };
    },
    beginPath() { operations.push({ kind: 'begin' }); },
    moveTo(px, py) { operations.push({ kind: 'point', x: px, y: py }); },
    lineTo(px, py) { operations.push({ kind: 'point', x: px, y: py }); },
    bezierCurveTo(...points) {
      for (let index = 0; index < points.length; index += 2) {
        operations.push({ kind: 'point', x: points[index], y: points[index + 1] });
      }
    },
    stroke() { operations.push({ kind: 'stroke' }); },
  };
  const renderer = {
    ctx,
    ellipse(px, py, rx, ry, fill) { operations.push({ kind: 'ellipse', x: px, y: py, rx, ry, fill }); },
    path(points, fill, stroke, lineWidth) { operations.push({ kind: 'path', points, fill, stroke, lineWidth }); },
    obstacleFootprint(lane, distance) {
      operations.push({ kind: 'footprint', lane, distance });
      return { p: { x, y, scale: .72 }, width, height };
    },
  };
  return { renderer, operations };
}

test('obstacle atlas readiness waits for image decoding without blocking construction', async () => {
  const images = [];
  class DelayedImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 1800;
      this.naturalHeight = 600;
      images.push(this);
    }
    set src(value) {
      this.url = value;
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    }
    decode() { return new Promise(resolve => { this.finishDecode = resolve; }); }
  }

  const art = new StreetObstacleArt({ ImageCtor: DelayedImage, timeoutMs: 500 });
  assert.equal(art.atlasReady, false);
  assert.deepEqual(art.stats, { obstacles: 'pending' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(images.length, 1);
  assert.match(images[0].url, /art\/resolution-v36\/street-obstacles\.webp/);
  images[0].finishDecode();
  await art.ready;
  assert.equal(art.atlasReady, true);
  assert.deepEqual(art.stats, { obstacles: 'ready' });
});

test('a stalled decode resolves at its timeout and selects a drawable fallback', async () => {
  class StalledImage {
    constructor() { this.complete = false; this.naturalWidth = 900; this.naturalHeight = 300; }
    set src(_) { this.complete = true; queueMicrotask(() => this.onload?.()); }
    decode() { return new Promise(() => {}); }
  }
  const art = new StreetObstacleArt({ ImageCtor: StalledImage, timeoutMs: 100 });
  await art.ready;
  assert.equal(art.atlasReady, false);
  assert.deepEqual(art.stats, { obstacles: 'fallback' });

  for (const type of TYPES) {
    const { renderer, operations } = fakeRenderer();
    assert.equal(art.draw(renderer, type, 1, .7), true, `${type} fallback draws`);
    assert.ok(operations.some(operation => operation.kind === 'path' || operation.kind === 'ellipse'),
      `${type} uses a recognizable vector silhouette`);
  }
});

test('failed image creation and image errors both resolve through the fallback state', async () => {
  class BrokenImage {
    set src(_) { queueMicrotask(() => this.onerror?.(new Error('decode failed'))); }
  }
  const thrown = new StreetObstacleArt({ ImageCtor: class { constructor() { throw new Error('unavailable'); } } });
  const errored = new StreetObstacleArt({ ImageCtor: BrokenImage, timeoutMs: 150 });
  await Promise.all([thrown.ready, errored.ready]);
  assert.deepEqual(thrown.stats, { obstacles: 'fallback' });
  assert.deepEqual(errored.stats, { obstacles: 'fallback' });
});

test('measured atlas crops and roots put all sprites on the projected baseline', () => {
  const art = new StreetObstacleArt({ ImageCtor: null });
  art.images.obstacles = { complete: true, naturalWidth: 1800, naturalHeight: 600 };

  for (const type of TYPES) {
    const [sx, sy, sw, sh] = CELLS[type].crop;
    const [rootX, rootY] = CELLS[type].root;
    const geometry = art.geometry(type);
    const { renderer, operations } = fakeRenderer();
    assert.equal(art.drawAt(renderer, type, { x: 120, y: 200, width: 48, height: 52 }), true);
    const [, ...args] = operations.find(operation => operation.kind === 'image').args;
    const [drawSx, drawSy, drawSw, drawSh, dx, dy, dw, dh] = args;
    assert.deepEqual([drawSx, drawSy, drawSw, drawSh], [sx * 2, sy * 2, sw * 2, sh * 2]);
    assert.ok(Math.abs(dx + geometry.anchorX * dw - 120) < 1e-9);
    assert.ok(Math.abs(dy + geometry.anchorY * dh - 200) < 1e-9);
    assert.equal(geometry.aspect, sw / sh);
    assert.equal(geometry.anchorX, (rootX - sx) / sw);
    assert.equal(geometry.anchorY, (rootY - sy) / sh);
  }
});

test('street obstacle sizing fits litter inside the footprint and roots every type at its center', () => {
  const art = new StreetObstacleArt({ ImageCtor: null });
  art.images.obstacles = { complete: true, naturalWidth: 900, naturalHeight: 300 };
  const spriteSizes = {};

  for (const type of TYPES) {
    const { renderer, operations } = fakeRenderer({ width: 64, height: 40, x: 120, y: 200 });
    assert.equal(art.draw(renderer, type, -1, .85), true);
    const footprint = operations.find(operation => operation.kind === 'footprint');
    assert.deepEqual([footprint.lane, footprint.distance], [-1, .85]);
    const image = operations.find(operation => operation.kind === 'image');
    const [, , , , , dx, dy, dw, dh] = image.args;
    const geometry = art.geometry(type);
    assert.ok(dw <= 64, `${type} image width remains within the obstacle lane width`);
    assert.ok(Math.abs(dx + geometry.anchorX * dw - 120) < 1e-9);
    assert.ok(Math.abs(dy + geometry.anchorY * dh - 200) < 1e-9);
    spriteSizes[type] = { width: dw, height: dh };
    if (type === 'litter') assert.ok(dh <= 40 * .9 + 1e-9, 'the ground bag stays within its physical length');
    else {
      assert.ok(dh > 40, `${type} may rise above the ground footprint`);
      assert.ok(Math.abs(dh / dw - CELLS[type].crop[3] / CELLS[type].crop[2]) < 1e-9,
        `${type} keeps its measured natural proportions`);
      assert.ok(dh / dw > 1.15 && dh / dw < 1.22,
        `${type} retains an upright natural silhouette`);
    }
  }
  assert.ok(Math.abs(spriteSizes.litter.height / spriteSizes.litter.width - 138 / 271) < 1e-9,
    'the flattened bag keeps its measured ground shape');
});

test('canvas fallbacks remain inside the lane width and keep static, distinct silhouettes', () => {
  const signatures = new Map();
  for (const type of TYPES) {
    const art = new StreetObstacleArt({ ImageCtor: null });
    const { renderer, operations } = fakeRenderer({ width: 64, height: 40, x: 120, y: 200 });
    assert.equal(art.draw(renderer, type, 0, 0), true);

    const horizontalPoints = operations.filter(operation => operation.kind === 'point').map(operation => operation.x);
    const shapePoints = operations.filter(operation => operation.kind === 'path')
      .flatMap(operation => operation.points.map(point => point[0]));
    const allX = [...horizontalPoints, ...shapePoints];
    assert.ok(allX.length > 0);
    assert.ok(Math.min(...allX) >= 120 - 32 - 1e-6, `${type} fallback stays inside the lane's left edge`);
    assert.ok(Math.max(...allX) <= 120 + 32 + 1e-6, `${type} fallback stays inside the lane's right edge`);
    assert.ok(operations.some(operation => operation.kind === 'ellipse' && operation.fill.startsWith('rgba')),
      `${type} keeps a contact shadow at ground level`);
    const maxPathY = Math.max(...operations.filter(operation => operation.kind === 'path')
      .flatMap(operation => operation.points.map(point => point[1])), 200);
    const maxY = Math.max(maxPathY, ...operations.filter(operation => operation.kind === 'point').map(operation => operation.y), 200);
    assert.ok(maxY <= 200 + 1.5, `${type} has no artwork hanging below its root baseline`);
    signatures.set(type, operations.filter(operation => ['path', 'ellipse'].includes(operation.kind)).length);
  }
  assert.equal(new Set(signatures.values()).size, TYPES.length,
    'the bag, pecking bird, and seated cat use different shape constructions');
});
