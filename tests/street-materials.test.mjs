import test from 'node:test';
import assert from 'node:assert/strict';
import { StreetMaterials } from '../src/street-materials.js';

const POINTS = [
  { x: 80, y: 100 }, { x: 240, y: 100 },
  { x: 270, y: 220 }, { x: 50, y: 220 },
];

function readyImage() {
  return class ReadyImage {
    constructor() {
      this.complete = true;
      this.naturalWidth = 512;
      this.naturalHeight = 512;
    }
    set src(_url) {}
  };
}

function recordingCanvasFactory() {
  const canvases = [];
  const factory = (width, height) => {
    const draws = [];
    const canvas = {
      width,
      height,
      draws,
      getContext(type) {
        assert.equal(type, '2d');
        return { drawImage(...args) { draws.push(args); } };
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  return { factory, canvases };
}

function recordingContext({ throwOnTransform = false } = {}) {
  const transforms = [];
  const patterns = [];
  const calls = { saves: 0, restores: 0, clips: 0, fills: [] };
  const stack = [];
  const ctx = {
    globalAlpha: .8,
    fillStyle: '#base',
    transforms,
    patterns,
    calls,
    createPattern(tile, repetition) {
      patterns.push({ tile, repetition });
      return {
        setTransform(transform) {
          transforms.push(transform);
          if (throwOnTransform) throw new Error('unsupported transform');
        },
      };
    },
    save() {
      calls.saves++;
      stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle });
    },
    restore() {
      calls.restores++;
      const previous = stack.pop();
      this.globalAlpha = previous.globalAlpha;
      this.fillStyle = previous.fillStyle;
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() { calls.clips++; },
    fillRect(...rect) { calls.fills.push({ rect, alpha: this.globalAlpha, fillStyle: this.fillStyle }); },
  };
  return ctx;
}

test('failed material atlas settles ready and leaves surfaces on their vector fallback', async () => {
  class FailedImage {
    constructor() { this.complete = false; }
    set src(_url) { queueMicrotask(() => this.onerror?.()); }
  }
  const { factory } = recordingCanvasFactory();
  const materials = new StreetMaterials({ ImageCtor: FailedImage, timeoutMs: 100, canvasFactory: factory });

  await materials.ready;

  assert.deepEqual(materials.stats, {
    asphalt: 'fallback', plaster: 'fallback', roof: 'fallback', concrete: 'fallback',
  });
  assert.equal(materials.paintMaterial(recordingContext(), POINTS, 'asphalt'), false);
});

test('an atlas that never completes falls back after the bounded load timeout', async () => {
  class StalledImage {
    constructor() { this.complete = false; }
    set src(_url) {}
  }
  const materials = new StreetMaterials({ ImageCtor: StalledImage, timeoutMs: 100 });

  await materials.ready;

  assert.deepEqual(materials.stats, {
    asphalt: 'fallback', plaster: 'fallback', roof: 'fallback', concrete: 'fallback',
  });
  assert.equal(materials.paintMaterial(recordingContext(), POINTS, 'plaster'), false);
});

test('material cells are isolated, cached, world anchored, finite, and restore canvas state', async () => {
  const { factory, canvases } = recordingCanvasFactory();
  const materials = new StreetMaterials({ ImageCtor: readyImage(), canvasFactory: factory });
  await materials.ready;
  const ctx = recordingContext();

  assert.deepEqual(materials.stats, {
    asphalt: 'ready', plaster: 'ready', roof: 'ready', concrete: 'ready',
  });
  assert.equal(materials.paintMaterial(ctx, [{ x: NaN, y: 0 }, ...POINTS.slice(1)], 'asphalt'), false);
  assert.equal(materials.paintMaterial(ctx, POINTS, 'unknown'), false);
  assert.equal(ctx.calls.saves, 0);
  assert.equal(ctx.calls.restores, 0);
  assert.equal(ctx.globalAlpha, .8);
  assert.equal(ctx.fillStyle, '#base');

  const invalidOptions = {
    opacity: Infinity, centerX: NaN, centerY: Infinity,
    pixelsPerUnit: NaN, worldOffset: NaN, worldSpan: Infinity,
  };
  for (const kind of ['asphalt', 'plaster', 'roof', 'concrete']) {
    assert.equal(materials.paintMaterial(ctx, POINTS, kind, invalidOptions), true);
  }
  assert.equal(materials.paintMaterial(ctx, POINTS, 'asphalt', invalidOptions), true);

  assert.equal(canvases.length, 4);
  assert.deepEqual(canvases.map(canvas => canvas.draws[0].slice(1, 5)), [
    [0, 0, 256, 256], [256, 0, 256, 256],
    [0, 256, 256, 256], [256, 256, 256, 256],
  ]);
  assert.equal(ctx.patterns.length, 4, 'one repeat pattern is cached per material and context');
  assert.ok(ctx.patterns.every(({ repetition }) => repetition === 'repeat'));
  assert.ok(ctx.transforms.every(transform => Object.values(transform).every(Number.isFinite)));
  assert.equal(ctx.calls.fills.length, 5);
  assert.equal(ctx.calls.saves, 5);
  assert.equal(ctx.calls.restores, 5);
  assert.equal(ctx.globalAlpha, .8);
  assert.equal(ctx.fillStyle, '#base');

  const anchored = recordingContext();
  assert.equal(materials.paintMaterial(anchored, POINTS, 'asphalt', {
    opacity: .14, centerX: 120, centerY: 240, pixelsPerUnit: 30,
    worldOffset: 1.5, worldSpan: 3,
  }), true);
  assert.deepEqual(anchored.transforms[0], { a: 90 / 256, b: 0, c: 0, d: 90 / 256, e: 120, f: 195 });
});

test('a pattern transform failure restores the clipped drawing context', async () => {
  const { factory } = recordingCanvasFactory();
  const materials = new StreetMaterials({ ImageCtor: readyImage(), canvasFactory: factory });
  await materials.ready;
  const ctx = recordingContext({ throwOnTransform: true });

  assert.equal(materials.paintMaterial(ctx, POINTS, 'roof'), false);
  assert.equal(ctx.calls.saves, 1);
  assert.equal(ctx.calls.restores, 1);
  assert.equal(ctx.globalAlpha, .8);
  assert.equal(ctx.fillStyle, '#base');
  assert.equal(ctx.calls.fills.length, 0);
});
