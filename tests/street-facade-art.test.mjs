import assert from 'node:assert/strict';
import test from 'node:test';
import { StreetFacadeArt } from '../src/street-facade-art.js';

const RECT = [
  { x: 20, y: 30 }, { x: 80, y: 30 },
  { x: 80, y: 70 }, { x: 20, y: 70 },
];

function readyImage() {
  return class ReadyImage {
    constructor() {
      this.complete = true;
      this.naturalWidth = 1024;
      this.naturalHeight = 1024;
    }
    set src(_url) {}
  };
}

function recordingContext({ canvas, transform } = {}) {
  const calls = { images: [], clips: 0, transforms: [], saves: 0, restores: 0, fills: [] };
  const stack = [];
  const ctx = {
    canvas,
    globalAlpha: .7,
    fillStyle: '#base',
    calls,
    save() {
      calls.saves++;
      stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle });
    },
    restore() {
      calls.restores++;
      const state = stack.pop();
      this.globalAlpha = state.globalAlpha;
      this.fillStyle = state.fillStyle;
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() { calls.clips++; },
    transform(...values) { calls.transforms.push(values); },
    drawImage(...args) { calls.images.push(args); },
    fillRect(...args) {
      calls.fills.push({ args, alpha: this.globalAlpha, fillStyle: this.fillStyle });
    },
  };
  if (transform) ctx.getTransform = () => transform;
  return ctx;
}

test('axis-aligned rectangles draw each correct atlas quadrant with one image call', async () => {
  const art = new StreetFacadeArt({ ImageCtor: readyImage() });
  await art.ready;
  const expected = {
    house: [0, 0], side: [512, 0], store: [0, 512], apartment: [512, 512],
  };

  for (const [kind, [sx, sy]] of Object.entries(expected)) {
    const ctx = recordingContext();
    assert.equal(art.drawFacade(ctx, RECT, kind), true);
    assert.equal(ctx.calls.images.length, 1);
    assert.deepEqual(ctx.calls.images[0].slice(1), [sx, sy, 512, 512, 20, 30, 60, 40]);
    assert.equal(ctx.calls.clips, 0, 'the rectangle path does not build triangle clips');
    assert.equal(ctx.calls.transforms.length, 0, 'the rectangle path does not apply affine transforms');
    assert.equal(ctx.calls.saves, 1);
    assert.equal(ctx.calls.restores, 1);
    assert.equal(ctx.globalAlpha, .7);
    assert.equal(ctx.fillStyle, '#base');
  }

  const shaded = recordingContext();
  assert.equal(art.drawFacade(shaded, RECT, 'side', { shade: .2 }), true);
  assert.equal(shaded.calls.images.length, 1);
  assert.equal(shaded.calls.fills.length, 1);
  assert.ok(Math.abs(shaded.calls.fills[0].alpha - .14) < 1e-12);
  assert.equal(shaded.calls.fills[0].fillStyle, '#000');
  assert.equal(shaded.calls.restores, 1);
  assert.equal(shaded.globalAlpha, .7);
  assert.equal(shaded.fillStyle, '#base');
});

test('fully off-canvas facades succeed without atlas or drawing work', () => {
  const art = new StreetFacadeArt({ ImageCtor: null });
  const calls = { getTransform: 0 };
  const ctx = {
    canvas: { width: 640, height: 400 },
    getTransform() {
      calls.getTransform++;
      return { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    },
  };
  const offscreen = [
    { x: 330, y: 20 }, { x: 360, y: 20 },
    { x: 360, y: 70 }, { x: 330, y: 70 },
  ];

  assert.equal(art.drawFacade(ctx, offscreen, 'house'), true);
  assert.equal(calls.getTransform, 1);
  assert.equal(art.atlasReady, false, 'the hidden face does not wait for the atlas');
  assert.equal(art.drawFacade(ctx, RECT, 'house'), false, 'visible art still requests the fallback when unavailable');
});

test('perspective quads keep the 4x4 affine mesh finite and restore canvas state', async () => {
  const art = new StreetFacadeArt({ ImageCtor: readyImage() });
  await art.ready;
  const ctx = recordingContext();
  const quad = [
    { x: 10, y: 20 }, { x: 220, y: 30 },
    { x: 200, y: 300 }, { x: 25, y: 280 },
  ];

  assert.equal(art.drawFacade(ctx, quad, 'apartment', { shade: .12 }), true);
  assert.equal(ctx.calls.images.length, 32, 'a 4x4 grid produces two mapped triangles per cell');
  assert.equal(ctx.calls.clips, 33, 'the shade wash adds one final clip after the 32 mesh triangles');
  assert.equal(ctx.calls.transforms.length, 32);
  assert.ok(ctx.calls.transforms.flat().every(Number.isFinite));
  assert.ok(ctx.calls.images.every(call => call[3] === 128 && call[4] === 128),
    'each triangle rasterizes only its source-cell bounds');
  assert.equal(ctx.calls.saves, 33, 'each triangle and final shade pass have isolated state');
  assert.equal(ctx.calls.restores, 33);
  assert.equal(ctx.calls.fills.length, 1);
  assert.equal(ctx.globalAlpha, .7);
  assert.equal(ctx.fillStyle, '#base');
});

test('missing atlas and degenerate visible quads preserve the caller fallback', async () => {
  const art = new StreetFacadeArt({ ImageCtor: null });
  await art.ready;
  const ctx = recordingContext();
  const degenerate = [
    { x: 0, y: 0 }, { x: 80, y: 0 },
    { x: 80, y: 40 }, { x: 40, y: 10 },
  ];

  assert.equal(art.drawFacade(ctx, RECT, 'house'), false);
  assert.equal(art.drawFacade(ctx, degenerate, 'house'), false);
  assert.equal(ctx.calls.images.length, 0);
});
