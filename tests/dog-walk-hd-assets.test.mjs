import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DogSprites, upgradeWalkAtlas } from '../src/dog-sprites.js';
import { sampleWalk } from '../src/sprite-animation.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = path => readFile(resolve(projectRoot, path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hdMetadata = JSON.parse((await read('art/dog-walk-hd.json')).toString('utf8'));
const baseMetadata = JSON.parse((await read('art/dog-image-animation.json')).toString('utf8'));
const homeMetadata = JSON.parse((await read('art/dog-home-continuity.json')).toString('utf8'));

test('walk HD atlas is generated from the original source at twice the authored reference resolution', async () => {
  const { walk } = hdMetadata.atlases;
  const atlasBytes = await read(walk.path);
  assert.equal(hdMetadata.mode, 'authored-walk-animation-hd');
  assert.equal(hdMetadata.strideLength, baseMetadata.strideLength);
  assert.equal(walk.width, 2048);
  assert.equal(walk.height, 1024);
  assert.equal(walk.cell, 512);
  assert.equal(walk.frames.length, 8);
  assert.equal(walk.referenceHeight, baseMetadata.atlases.walk.referenceHeight * 2);
  assert.equal(walk.sourceRef, baseMetadata.atlases.walk.sourceRef);
  assert.equal(walk.bytes, atlasBytes.byteLength);
  assert.equal(walk.sha256, digest(atlasBytes));
  assert.equal(atlasBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(atlasBytes.readUInt32BE(16), walk.width);
  assert.equal(atlasBytes.readUInt32BE(20), walk.height);
  assert.equal(walk.edgeOpaque, 0);
  assert.equal(hdMetadata.textureBytes, walk.width * walk.height * 4);
  assert.equal(hdMetadata.compressedBytes, atlasBytes.byteLength);
  assert.ok(atlasBytes.byteLength <= 2_500_000, `HD walk download uses ${atlasBytes.byteLength} bytes`);
  assert.ok(hdMetadata.textureBytes < 9_000_000);

  for (let index = 0; index < walk.frames.length; index += 1) {
    const high = walk.frames[index], low = baseMetadata.atlases.walk.frames[index];
    assert.deepEqual(high.sourceBounds, low.sourceBounds, `pose ${index} keeps its original source crop`);
    assert.equal(high.x, low.x * 2);
    assert.equal(high.y, low.y * 2);
    assert.equal(high.width, low.width * 2);
    assert.equal(high.height, low.height * 2);
    assert.equal(high.anchorX, low.anchorX * 2);
    assert.equal(high.anchorY, low.anchorY * 2);
    assert.equal(high.anchorY, 488);
    assert.equal(high.referenceHeight, low.referenceHeight * 2);
    assert.ok(high.sourceBounds.height >= 396, `pose ${index} retains original fine detail`);
  }
});

test('walk HD provenance records the untouched source and its generator', async () => {
  for (const item of [...Object.values(hdMetadata.sourceSheets), hdMetadata.generator]) {
    assert.equal(digest(await read(item.path)), item.sha256, `${item.path} is the recorded input`);
  }
  assert.equal(hdMetadata.sourceSheets.walk.width, 1774);
  assert.equal(hdMetadata.sourceSheets.walk.height, 887);
});

function walkFixture() {
  const animation = structuredClone(baseMetadata);
  const oldImage = { width: 1024, height: 512, src: 'legacy-walk-atlas' };
  const images = { walk: oldImage };
  const stats = {
    decodedBytes: baseMetadata.textureBytes,
    compressedBytes: baseMetadata.compressedBytes,
    textureSizes: Object.values(baseMetadata.atlases).map(atlas => [atlas.width, atlas.height]),
    textureCount: 3,
  };
  return { animation, images, oldImage, stats };
}

function response(bytes, ok = true) {
  return { ok, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

test('DogSprites upgrades only walk, releases the old texture, and stays under the combined 80 MB budget', async () => {
  const { animation, images, oldImage, stats } = walkFixture();
  const metadataBytes = await read('art/dog-walk-hd.json');
  const atlasBytes = await read('art/dog-walk-hd.png');
  const upgradedImage = { width: 2048, height: 1024, src: 'decoded-hd-walk' };
  const loaded = await upgradeWalkAtlas({
    animation, images, stats,
    fetchResource: async url => String(url).endsWith('.json') ? response(metadataBytes) : response(atlasBytes),
    decodeImage: async () => upgradedImage,
  });

  assert.equal(loaded, true);
  assert.equal(images.walk, upgradedImage);
  assert.equal(oldImage.src, '', 'legacy texture is released once HD decode succeeds');
  assert.equal(animation.atlases.walk.referenceHeight, 416);
  assert.equal(animation.textureBytes, stats.decodedBytes);
  assert.equal(animation.compressedBytes, baseMetadata.compressedBytes - baseMetadata.atlases.walk.bytes + hdMetadata.atlases.walk.bytes);
  assert.equal(stats.walkHdReady, true);
  assert.deepEqual(stats.textureSizes[0], [2048, 1024]);
  assert.equal(stats.textureCount, 3, 'the optional sheet replaces one texture');

  const oldWalkBytes = 1024 * 512 * 4;
  const expectedWalkRuntimeBytes = baseMetadata.textureBytes - oldWalkBytes + hdMetadata.textureBytes;
  const combinedWithContinuity = expectedWalkRuntimeBytes + homeMetadata.textureBytes;
  assert.equal(stats.decodedBytes, expectedWalkRuntimeBytes);
  assert.equal(combinedWithContinuity, 79_472_384);
  assert.ok(combinedWithContinuity < 80_000_000);
});

test('an unavailable or invalid optional HD pack keeps the legacy walk atlas usable', async () => {
  for (const scenario of ['unavailable', 'wrong-dimensions', 'over-budget']) {
    const { animation, images, oldImage, stats } = walkFixture();
    const originalAtlas = animation.atlases.walk;
    const metadataBytes = await read('art/dog-walk-hd.json');
    const atlasBytes = await read('art/dog-walk-hd.png');
    if (scenario === 'over-budget') stats.decodedBytes = 79_000_000;
    const loaded = await upgradeWalkAtlas({
      animation, images, stats,
      fetchResource: async url => {
        if (scenario === 'unavailable' && String(url).endsWith('.png')) return response(Buffer.alloc(0), false);
        return String(url).endsWith('.json') ? response(metadataBytes) : response(atlasBytes);
      },
      decodeImage: async () => ({ width: scenario === 'wrong-dimensions' ? 1024 : 2048, height: 1024, src: 'candidate' }),
    });
    assert.equal(loaded, false, scenario);
    assert.equal(images.walk, oldImage, scenario);
    assert.equal(oldImage.src, 'legacy-walk-atlas', scenario);
    assert.equal(animation.atlases.walk, originalAtlas, scenario);
    assert.equal(stats.walkHdReady, false, scenario);
    assert.ok(stats.walkHdFallbackReason, scenario);
  }
});

test('optional HD fetch, body reads, and decode time out and abort without delaying the legacy walk', {timeout: 1_000}, async () => {
  const metadataBytes = await read('art/dog-walk-hd.json');
  const atlasBytes = await read('art/dog-walk-hd.png');
  for (const scenario of ['fetch', 'body', 'decode']) {
    const { animation, images, oldImage, stats } = walkFixture();
    const originalAtlas = animation.atlases.walk;
    const originalDecodedBytes = stats.decodedBytes;
    const signals = [];
    const fetchResource = async (_url, options) => {
      if (options?.signal) signals.push(options.signal);
      if (scenario === 'fetch') return new Promise(() => {});
      if (scenario === 'body') return {ok: true, arrayBuffer: () => new Promise(() => {})};
      return response(String(_url).endsWith('.json') ? metadataBytes : atlasBytes);
    };
    const loaded = await upgradeWalkAtlas({
      animation, images, stats, timeoutMs: 15, fetchResource,
      decodeImage: () => new Promise(() => {}),
    });

    assert.equal(loaded, false, scenario);
    assert.ok(signals.length > 0, scenario);
    assert.ok(signals.every(signal => signal.aborted), `${scenario} requests are aborted`);
    assert.equal(images.walk, oldImage, scenario);
    assert.equal(oldImage.src, 'legacy-walk-atlas', scenario);
    assert.equal(animation.atlases.walk, originalAtlas, scenario);
    assert.equal(stats.decodedBytes, originalDecodedBytes, scenario);
    assert.match(stats.walkHdFallbackReason, /timed out/);
  }
});

test('a decoder that resolves after timeout releases its candidate and cannot replace the old atlas', {timeout: 1_000}, async () => {
  const { animation, images, oldImage, stats } = walkFixture();
  const originalAtlas = animation.atlases.walk;
  const metadataBytes = await read('art/dog-walk-hd.json');
  const atlasBytes = await read('art/dog-walk-hd.png');
  let resolveDecode;
  const lateDecode = new Promise(resolve => { resolveDecode = resolve; });
  const loaded = await upgradeWalkAtlas({
    animation, images, stats, timeoutMs: 15,
    fetchResource: async url => String(url).endsWith('.json') ? response(metadataBytes) : response(atlasBytes),
    decodeImage: () => lateDecode,
  });
  assert.equal(loaded, false);
  const lateCandidate = {width: 2048, height: 1024, src: 'pending-hd-image'};
  resolveDecode(lateCandidate);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateCandidate.src, '', 'the late decoded image is released');
  assert.equal(images.walk, oldImage);
  assert.equal(oldImage.src, 'legacy-walk-atlas');
  assert.equal(animation.atlases.walk, originalAtlas);
  assert.equal(stats.walkHdReady, false);
});

test('HD walk rendering keeps the authored frame phase, CSS size, and reduced-motion hold', () => {
  const hdImage = { width: 2048, height: 1024 };
  const sprite = Object.create(DogSprites.prototype);
  sprite.animation = { atlases: hdMetadata.atlases };
  sprite.images = { walk: hdImage };
  sprite.buffers = new Map();
  sprite.stats = {};
  const drawCalls = [];
  const context = { drawImage: (...args) => drawCalls.push(args) };
  const drawAt = sample => sprite.drawAnimated(context, {
    x: 200, foot: 300, size: 116, sample: { atlas: 'walk', ...sample },
  });

  const moving = sampleWalk({ distance: hdMetadata.strideLength * 6 / 8, strideLength: hdMetadata.strideLength });
  assert.equal(drawAt(moving), true);
  assert.equal(drawCalls[0][0], hdImage);
  assert.equal(drawCalls[0][1], (6 % 4) * 512);
  assert.equal(drawCalls[0][2], 512);
  assert.equal(drawCalls[0][3], 512);
  assert.ok(Math.abs(drawCalls[0][8] - 512 * 116 / 416) < 1e-9);
  assert.ok(Math.abs(drawCalls[0][8] - 256 * 116 / 208) < 1e-9, 'the dog remains the same CSS size');

  drawCalls.length = 0;
  const held = sampleWalk({ distance: 99, strideLength: hdMetadata.strideLength, reducedMotion: true });
  assert.equal(drawAt(held), true);
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0][1], 0, 'reduced motion continues to hold frame zero');
});
