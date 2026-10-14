import assert from 'node:assert/strict';
import test from 'node:test';
import { AdventureScene } from '../src/adventure-scene.js';
import { ParkArt } from '../src/park-art.js';

test('loaded park images become ready only after asynchronous decoding completes', async () => {
  const images = [];
  class DelayedImage {
    constructor() { this.complete = false; this.naturalWidth = 1024; this.naturalHeight = 1024; images.push(this); }
    set src(value) { this.url = value; this.complete = true; queueMicrotask(() => this.onload?.()); }
    decode() { return new Promise(resolve => { this.finishDecode = resolve; }); }
  }
  const art = new ParkArt({ ImageCtor: DelayedImage });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(images.length, 4);
  assert.ok(Object.values(art.stats).every(status => status === 'pending'));
  assert.equal(art.treesReady, false);
  for (const image of images) image.finishDecode();
  await art.ready;
  assert.ok(Object.values(art.stats).every(status => status === 'ready'));
});

test('active street readiness resolves through vector fallback without loading legacy images', async () => {
  const scene = new AdventureScene();
  await scene.ready;
  assert.equal(scene.stats.renderer, 'perspective-textured-street');
  for (const group of ['materials','facades','foliage','variants']) {
    assert.ok(Object.values(scene.stats[group]).every(status=>status==='fallback'));
  }
  assert.deepEqual(scene.stats.legacy, { houses: 'pending', asphalt: 'pending', buildings: 'pending' });
});

test('tree atlas uses measured crops and puts the measured root on its projected baseline', () => {
  const art = new ParkArt({ ImageCtor: null });
  art.images.trees = { complete: true, naturalWidth: 1024, naturalHeight: 1024 };
  const calls = [];
  const ctx = {
    save() {}, restore() {},
    drawImage(...args) { calls.push(args); },
  };

  assert.equal(art.drawTree(ctx, 'park', 0, 110, 260, 96, 88), true);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0];
  assert.deepEqual([sx, sy, sw, sh], [47, 71, 461, 427]);
  const { anchorX, anchorY } = art.treeGeometry('park', 0);
  assert.ok(Math.abs(dx + anchorX * dw - 110) < 1e-9);
  assert.ok(Math.abs(dy + anchorY * dh - 260) < 1e-9);
});

test('soil pattern transform remains continuous across adjacent projected road strips', () => {
  const art = new ParkArt({ ImageCtor: null });
  art.images.soil = { complete: true, naturalWidth: 384, naturalHeight: 384 };
  art.images.grass = { complete: true, naturalWidth: 384, naturalHeight: 384 };
  const transforms = [];
  const patternImages = [];
  const ctx = {
    globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fillRect() {},
    createPattern(image) {
      patternImages.push(image);
      return { setTransform(transform) { transforms.push(transform); } };
    },
  };
  const points = [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 50 }, { x: 0, y: 50 }];
  const span = .9, step = .34, pixelsPerDistance = 80;
  const options = {
    worldSpan: span, pixelsPerLane: 90, pixelsPerDistance,
    worldOffset: 4, centerX: 10, centerY: 300,
  };

  assert.equal(art.drawSoilQuad(ctx, points, options), true);
  assert.equal(art.drawSoilQuad(ctx, points, {
    ...options, worldOffset: options.worldOffset + step,
    centerY: options.centerY - pixelsPerDistance * step,
  }), true);
  assert.equal(art.drawGrassQuad(ctx, points, options), true);
  assert.equal(art.drawGrassQuad(ctx, points, options), true);
  assert.equal(transforms.length, 4);
  assert.deepEqual(patternImages, [art.images.soil, art.images.grass],
    'soil and grass keep separate cached patterns on the same compositor context');
  assert.ok(Math.abs(transforms[1].f - transforms[0].f) < 1e-9,
    'the same world texture lattice continues as the projection moves toward the viewer');
});
