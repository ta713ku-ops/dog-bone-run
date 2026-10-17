import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAVE_BAT_BODY_HITBOX,
  CAVE_BAT_VISUAL_WINGSPAN,
  CaveArt, drawHangingStalactite,
} from '../src/cave-art.js';
import { drawCaveObstacle } from '../src/cave-scene.js';

class MockContext {
  constructor() { this.globalAlpha = 1; this.images = []; this.paths = 0; }
  save() {}
  restore() {}
  beginPath() { this.paths++; }
  moveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  ellipse() {}
  fillRect() {}
  clip() {}
  translate() {}
  scale() {}
  rotate() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  drawImage(...args) { this.images.push(args); }
}

function renderer(art = null) {
  const ctx = new MockContext();
  return {
    width: 390,
    height: 844,
    ctx,
    reducedMotion: false,
    caveScene: art ? { art, ceilingHeight: 4.9 } : { ceilingHeight: 4.9 },
    path(points, fill, stroke = null) {
      ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath(); ctx.fill(); if (stroke) ctx.stroke();
    },
    ellipse(...args) { ctx.ellipse(...args); },
  };
}

function nextTurn() { return new Promise(resolve => setImmediate(resolve)); }

test('cave atlases stay loading until decode finishes, then expose separate sprite and material status', async () => {
  const decodeResolvers = [];
  class DelayedImage {
    naturalWidth = 1536;
    naturalHeight = 1024;
    set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
    decode() { return new Promise(resolve => decodeResolvers.push(resolve)); }
  }
  const art = new CaveArt({ ImageCtor: DelayedImage, documentRef: null, timeoutMs: 500 });
  await nextTurn();
  assert.equal(art.stats.atlas, 'loading');
  assert.equal(art.stats.materials, 'loading');
  assert.equal(decodeResolvers.length, 3);
  decodeResolvers.forEach(resolve => resolve());
  assert.equal(await art.ready, art);
  assert.equal(art.stats.atlas, 'ready');
  assert.equal(art.stats.materials, 'ready');
  assert.equal(art.stats.hanging, 'ready');
  assert.equal(art.stats.batFrames, 3);
});

test('bat sprites flap through three decoded frames while their body hitbox stays narrower than the wings', async () => {
  class ImageMock {
    naturalWidth = 1536;
    naturalHeight = 1024;
    set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
    async decode() {}
  }
  const art = new CaveArt({ ImageCtor: ImageMock, documentRef: null });
  await art.ready;
  const r = renderer(art);
  assert.equal(drawCaveObstacle(r, { type: 'bat' }, 195, 620, .8, 0), true);
  assert.equal(drawCaveObstacle(r, { type: 'bat' }, 195, 620, .8, 150), true);
  assert.equal(r.ctx.images.length, 2);
  assert.notEqual(r.ctx.images[0][1], r.ctx.images[1][1], 'the next wing pose uses a distinct atlas cell');
  assert.ok(CAVE_BAT_BODY_HITBOX.width < CAVE_BAT_VISUAL_WINGSPAN);
  assert.ok(CAVE_BAT_BODY_HITBOX.height < CAVE_BAT_VISUAL_WINGSPAN);

  r.reducedMotion = true;
  r.ctx.images.length = 0;
  assert.equal(drawCaveObstacle(r, { type: 'bat' }, 195, 620, .8, 900), true);
  assert.equal(drawCaveObstacle(r, { type: 'bat' }, 195, 620, .8, 2_400), true);
  assert.equal(r.ctx.images[0][1], r.ctx.images[1][1], 'reduced motion holds one flap pose');
});

test('low stalactite art connects to the projected roof and ends at dog body height', async () => {
  class ImageMock {
    naturalWidth = 1536;
    naturalHeight = 1024;
    set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
    async decode() {}
  }
  const art = new CaveArt({ ImageCtor: ImageMock, documentRef: null });
  await art.ready;
  const r = renderer(art);
  const y = 620, scale = .8;
  const artScale = scale * r.width * .235 / 100;
  assert.equal(drawCaveObstacle(r, { type: 'stalactite' }, 195, y, scale, 5_000), true);
  const bounds=drawHangingStalactite(r,195,y,artScale,art);
  const top=bounds.top,height=bounds.bottom-bounds.top;
  const roofOffset = r.caveScene.ceilingHeight * 100 * artScale;
  const bodyOffset = 78 * artScale;
  assert.ok(Math.abs(top - (y - roofOffset)) < .01, 'formation starts at the ceiling plane');
  assert.ok(Math.abs(top + height - (y - bodyOffset)) < .01, 'point reaches the dog body band');
});

test('missing or undecodable images preserve same-size Canvas obstacle fallbacks', async () => {
  const unavailable = new CaveArt({ ImageCtor: null });
  assert.equal(await unavailable.ready, unavailable);
  assert.equal(unavailable.stats.atlas, 'fallback');
  assert.equal(unavailable.stats.materials, 'fallback');
  assert.equal(unavailable.stats.decodedBytes, 0);

  class BrokenImage {
    naturalWidth = 1536;
    naturalHeight = 1024;
    set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
    async decode() { throw Error('decode_failed'); }
  }
  const broken = new CaveArt({ ImageCtor: BrokenImage, documentRef: null });
  await broken.ready;
  assert.deepEqual({ ...broken.stats.fallbackReasons }, { atlas: 'decode_failed', materials: 'decode_failed', hanging: 'decode_failed' });

  const r = renderer();
  for (const type of ['stalagmite', 'stalactite', 'caveRock', 'bat']) {
    assert.equal(drawCaveObstacle(r, { type }, 195, 620, .8, 4_000), true);
  }
  assert.equal(drawCaveObstacle(r, { type: 'unknown' }, 195, 620, .8, 4_000), false);
  assert.ok(r.ctx.paths > 0, 'fallbacks render detailed Canvas silhouettes');
});
