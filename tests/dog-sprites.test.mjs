import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DogSprites } from '../src/dog-sprites.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const metadataBytes = await readFile(resolve(projectRoot, 'art/dog-faithful-atlas.json'));
const metadata = JSON.parse(metadataBytes.toString('utf8'));
const atlasDimensions = { front: [1024, 1024], back: [1024, 1024] };
const cellSizes = { front: 512, back: 256 };
const requiredActions = [
  ['front', 'idle'], ['front', 'finish'], ['back', 'idle'], ['back', 'run'],
  ['back', 'leanLeft'], ['back', 'leanRight'], ['back', 'collect'], ['back', 'gold'],
  ['back', 'hit'], ['back', 'fall'], ['back', 'finish'], ['side', 'idle'], ['side', 'run'],
];

function collectFrames(value, found = []) {
  if (Array.isArray(value)) { for (const child of value) collectFrames(child, found); return found; }
  if (!value || typeof value !== 'object') return found;
  if (Number.isInteger(value.x) && Number.isInteger(value.y) && Number.isInteger(value.width) && Number.isInteger(value.height)) {
    found.push(value); return found;
  }
  for (const child of Object.values(value)) collectFrames(child, found);
  return found;
}

test('faithful atlases stay within the runtime texture and compressed-byte budgets', async () => {
  assert.equal(metadata.mode, 'photo-reference-sprites');
  assert.equal(metadata.triangleCount, 0);
  assert.equal(metadata.materials, 0);
  assert.equal(metadata.textureCount, 2);
  assert.deepEqual(metadata.textureSizes, [[1024, 1024], [1024, 1024]]);

  let actualBytes = metadataBytes.byteLength;
  for (const atlas of ['front', 'back']) {
    const png = await readFile(resolve(projectRoot, `art/dog-faithful-${atlas}.png`));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), atlasDimensions[atlas][0]);
    assert.equal(png.readUInt32BE(20), atlasDimensions[atlas][1]);
    actualBytes += png.byteLength;
  }
  assert.equal(metadata.compressedBytes, actualBytes);
  assert.ok(actualBytes <= 3_000_000, `runtime assets use ${actualBytes} bytes`);
});

test('front, back, and side actions use in-cell crops with measured foot anchors', () => {
  for (const [view, action] of requiredActions) {
    const descriptor = metadata.poses[view]?.[action];
    assert.ok(descriptor, `${view}.${action} is available`);
    assert.ok(collectFrames(descriptor).length > 0, `${view}.${action} has frame crops`);
  }
  assert.equal(metadata.poses.front.idle.frames.length, 2);
  assert.equal(metadata.poses.front.finish.frames.length, 2);
  assert.equal(metadata.poses.back.run.frames.length, 4);
  assert.equal(metadata.poses.back.fall.frames.length, 3);

  const frames = collectFrames(metadata.poses);
  assert.equal(frames.length, 20);
  for (const frame of frames) {
    const dimensions = atlasDimensions[frame.atlas], cellSize = cellSizes[frame.atlas];
    assert.ok(dimensions, `known atlas ${frame.atlas}`);
    assert.ok(frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0);
    assert.ok(frame.x + frame.width <= dimensions[0], `${frame.atlas} crop x extent`);
    assert.ok(frame.y + frame.height <= dimensions[1], `${frame.atlas} crop y extent`);
    assert.ok(Array.isArray(frame.cell) && frame.cell.length === 2);
    const [row, col] = frame.cell;
    assert.ok(frame.x >= col * cellSize && frame.x + frame.width <= (col + 1) * cellSize, `${frame.atlas} crop stays inside its cell`);
    assert.ok(frame.y >= row * cellSize && frame.y + frame.height <= (row + 1) * cellSize, `${frame.atlas} crop stays inside its cell`);
    assert.ok(Number.isFinite(frame.anchorX) && frame.anchorX > 0 && frame.anchorX < frame.width, `${frame.atlas} foot-band centroid`);
  }
});

function fixedSpriteFixture() {
  const sprites = Object.create(DogSprites.prototype);
  sprites.stats = {ready: true};
  sprites.images = {front: {name: 'original-front'}, back: {name: 'original-back'}};
  sprites.crops = {front: metadata.poses.front.idle.frames[0], back: metadata.poses.back.idle};
  return sprites;
}

test('fallback renderer keeps the original crop through time, direction, and action changes', () => {
  const sprites = fixedSpriteFixture();
  const calls = [];
  const ctx = {drawImage: (...args) => calls.push(args), scale: () => assert.fail('no mirroring'), transform: () => assert.fail('no mesh warp')};
  for (const action of ['idle', 'run', 'lean', 'collect', 'gold', 'hit', 'fall', 'finish']) {
    for (const timeMs of [0, 200, 700, 1600, 30000]) {
      assert.equal(sprites.draw(ctx, {view: 'back', action, timeMs, direction: -1, x: 140, foot: 205, size: 108}), true);
    }
  }
  assert.ok(calls.every(call => JSON.stringify(call) === JSON.stringify(calls[0])));
  const crop = sprites.crops.back;
  assert.deepEqual(calls[0].slice(1,5), [crop.x,crop.y,crop.width,crop.height]);
});

test('fallback menu and result use the original dog; missing images are never fabricated', () => {
  const sprites = fixedSpriteFixture(), calls = [];
  const ctx = {drawImage: (...args) => calls.push(args)};
  sprites.draw(ctx, {view: 'front', action: 'idle', timeMs: 0, size: 180});
  sprites.draw(ctx, {view: 'front', action: 'finish', timeMs: 12000, size: 180});
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(sprites.draw(ctx, {view: 'side', size: 180}), false);
  assert.equal(sprites.draw(ctx, {view: 'front', size: NaN}), false);
  sprites.stats.ready = false;
  assert.equal(sprites.draw(ctx, {view: 'front', size: 180}), false);
  assert.equal(calls.length, 2);
});
