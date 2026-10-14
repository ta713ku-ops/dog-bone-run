import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BUILDING_CELLS, NeighborhoodArt } from '../src/neighborhood-art.js';

test('house atlas readiness waits for decode and keeps game startup non-blocking', async () => {
  const images = [];
  class DelayedImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 1024;
      this.naturalHeight = 1024;
      images.push(this);
    }
    set src(value) {
      this.url = value;
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    }
    decode() { return new Promise(resolve => { this.finishDecode = resolve; }); }
  }

  const art = new NeighborhoodArt({ ImageCtor: DelayedImage, timeoutMs: 500 });
  assert.equal(art.housesReady, false, 'constructing the art loader must not block rendering');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(images.length, 3);
  assert.match(images[0].url, /art\/neighborhood-v24\/houses\.webp/);
  assert.match(images[1].url, /art\/neighborhood-v24\/asphalt\.webp/);
  assert.match(images[2].url, /art\/street-v25\/buildings\.webp/);
  assert.deepEqual(art.stats, { houses: 'pending', asphalt: 'pending', buildings: 'pending' });
  images.forEach(image => image.finishDecode());
  await art.ready;
  assert.equal(art.housesReady, true);
  assert.equal(art.asphaltReady, true);
  assert.equal(art.buildingsReady, true);
  assert.deepEqual(art.stats, { houses: 'ready', asphalt: 'ready', buildings: 'ready' });
});

test('a stalled decode resolves within the bound and selects the vector fallback', async () => {
  class StalledImage {
    constructor() { this.complete = false; this.naturalWidth = 1024; this.naturalHeight = 1024; }
    set src(_) { this.complete = true; queueMicrotask(() => this.onload?.()); }
    decode() { return new Promise(() => {}); }
  }
  const art = new NeighborhoodArt({ ImageCtor: StalledImage, timeoutMs: 100 });
  await art.ready;
  assert.equal(art.housesReady, false);
  assert.equal(art.asphaltReady, false);
  assert.equal(art.buildingsReady, false);
  assert.deepEqual(art.stats, { houses: 'fallback', asphalt: 'fallback', buildings: 'fallback' });
});

test('a commercial image failure is isolated and resolves to the vector fallback', async () => {
  class SelectiveFailureImage {
    constructor() { this.complete = false; this.naturalWidth = 640; this.naturalHeight = 960; }
    set src(value) {
      this.url = value;
      if (value.includes('/street-v25/buildings.webp')) {
        queueMicrotask(() => this.onerror?.());
        return;
      }
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    }
    decode() { return Promise.resolve(); }
  }

  const art = new NeighborhoodArt({ ImageCtor: SelectiveFailureImage, timeoutMs: 200 });
  await art.ready;
  assert.equal(art.housesReady, true);
  assert.equal(art.asphaltReady, true);
  assert.equal(art.buildingsReady, false);
  assert.deepEqual(art.stats, { houses: 'ready', asphalt: 'ready', buildings: 'fallback' });
  assert.equal(art.drawBuilding({ drawImage() {} }, 'convenience-left', 0, 0, 40, 40), false);
});

test('measured atlas crops and roots place each house at its projected baseline', () => {
  const art = new NeighborhoodArt({ ImageCtor: null });
  art.images.houses = { complete: true, naturalWidth: 1024, naturalHeight: 1024 };
  const calls = [];
  const ctx = { save() {}, restore() {}, drawImage(...args) { calls.push(args); } };
  const variants = [
    ['cream-left', [16, 37, 494, 456], [263, 490]],
    ['timber-left', [526, 28, 482, 463], [767, 488]],
    ['cream-right', [14, 517, 498, 465], [263, 979]],
    ['brick-right', [512, 519, 508, 461], [766, 977]],
  ];

  for (const [name, crop, root] of variants) {
    assert.equal(art.drawHouse(ctx, name, 120, 300, 140, 130), true);
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls.at(-1);
    assert.deepEqual([sx, sy, sw, sh], crop, `${name} uses the measured metadata crop`);
    const geometry = art.houseGeometry(name);
    assert.ok(Math.abs(dx + geometry.anchorX * dw - 120) < 1e-9);
    assert.ok(Math.abs(dy + geometry.anchorY * dh - 300) < 1e-9);
    assert.ok(Math.abs(geometry.anchorX - (root[0] - crop[0]) / crop[2]) < 1e-9);
    assert.ok(Math.abs(geometry.anchorY - (root[1] - crop[1]) / crop[3]) < 1e-9);
    assert.deepEqual(geometry.crop, crop);
  }
});

test('measured v25 commercial crops and roots place every facade on its baseline', () => {
  const art = new NeighborhoodArt({ ImageCtor: null });
  art.images.buildings = { complete: true, naturalWidth: 640, naturalHeight: 960 };
  const calls = [];
  const ctx = { save() {}, restore() {}, drawImage(...args) { calls.push(args); } };
  const measured = {
    'convenience-left': { crop: [10, 129, 300, 179], rootAnchor: [160, 306] },
    'convenience-right': { crop: [330, 127, 300, 181], rootAnchor: [480, 306] },
    'shop-left': { crop: [10, 352, 300, 276], rootAnchor: [160, 626] },
    'shop-right': { crop: [330, 348, 300, 280], rootAnchor: [480, 626] },
    'apartment-left': { crop: [36, 648, 248, 300], rootAnchor: [160, 946] },
    'apartment-right': { crop: [353, 648, 253, 300], rootAnchor: [479.5, 946] },
  };

  assert.deepEqual(DEFAULT_BUILDING_CELLS, measured, 'runtime crop constants match the measured v25 metadata');
  for (const [name, cell] of Object.entries(measured)) {
    assert.equal(art.drawBuilding(ctx, name, 140, 320, 240, 180), true);
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls.at(-1);
    assert.deepEqual([sx, sy, sw, sh], cell.crop, `${name} uses the measured v25 crop`);
    const geometry = art.buildingGeometry(name);
    assert.ok(Math.abs(dx + geometry.anchorX * dw - 140) < 1e-9);
    assert.ok(Math.abs(dy + geometry.anchorY * dh - 320) < 1e-9);
    assert.deepEqual(geometry.crop, cell.crop);
  }
});

test('asphalt texture coordinates remain attached across adjacent projected road strips', () => {
  const art = new NeighborhoodArt({ ImageCtor: null });
  art.images.asphalt = { complete: true, naturalWidth: 384, naturalHeight: 384 };
  const transforms = [];
  const ctx = {
    globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fillRect() {},
    createPattern() { return { setTransform(transform) { transforms.push(transform); } }; },
  };
  const points = [{ x: 0, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 50 }, { x: 0, y: 50 }];
  const span = 1.1, step = .36, pixelsPerDistance = 76;
  const options = {
    worldSpan: span, pixelsPerLane: 110, pixelsPerDistance,
    worldOffset: 2.8, centerX: 10, centerY: 400,
  };
  assert.equal(art.drawAsphaltQuad(ctx, points, options), true);
  assert.equal(art.drawAsphaltQuad(ctx, points, {
    ...options, worldOffset: options.worldOffset + step,
    centerY: options.centerY - pixelsPerDistance * step,
  }), true);
  assert.equal(transforms.length, 2);
  assert.ok(Math.abs(transforms[1].f - transforms[0].f) < 1e-9,
    'the same asphalt lattice continues as adjacent strips move toward the viewer');
});

test('a lazy neighborhood atlas creates no images before load and starts only once', async () => {
  const images = [];
  class CountingImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 1024;
      this.naturalHeight = 1024;
      images.push(this);
    }
    set src(value) {
      this.url = value;
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    }
    decode() { return Promise.resolve(); }
  }

  const art = new NeighborhoodArt({ ImageCtor: CountingImage, lazy: true, timeoutMs: 500 });
  assert.equal(images.length, 0, 'lazy construction does not create image requests');
  assert.deepEqual(art.stats, { houses: 'pending', asphalt: 'pending', buildings: 'pending' });
  assert.equal(await art.ready, art, 'dormant readiness resolves immediately for legacy callers');
  assert.equal(images.length, 0);

  const ready = art.load();
  assert.equal(images.length, 3, 'the explicit load starts the three optional images');
  assert.strictEqual(art.load(), ready, 'repeated load calls share the same promise');
  assert.strictEqual(art.ready, ready, 'ready switches to the active decode promise');
  await ready;

  assert.deepEqual(art.stats, { houses: 'ready', asphalt: 'ready', buildings: 'ready' });
  assert.match(images[0].url, /art\/neighborhood-v24\/houses\.webp/);
  assert.match(images[1].url, /art\/neighborhood-v24\/asphalt\.webp/);
  assert.match(images[2].url, /art\/street-v25\/buildings\.webp/);
});

test('lazy load settles every failed atlas to fallback and remains idempotent', async () => {
  const images = [];
  class MissingImage {
    constructor() { this.complete = false; images.push(this); }
    set src(_value) { queueMicrotask(() => this.onerror?.()); }
  }

  const art = new NeighborhoodArt({ ImageCtor: MissingImage, lazy: true, timeoutMs: 500 });
  assert.equal(images.length, 0);
  const ready = art.load();
  assert.strictEqual(art.load(), ready);
  await ready;

  assert.equal(images.length, 3);
  assert.deepEqual(art.stats, { houses: 'fallback', asphalt: 'fallback', buildings: 'fallback' });
  assert.equal(art.housesReady, false);
  assert.equal(art.asphaltReady, false);
  assert.equal(art.buildingsReady, false);
  assert.strictEqual(art.ready, ready);
});
