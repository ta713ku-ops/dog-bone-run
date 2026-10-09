import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOG_BEHAVIORS,
  FRONT_EXPRESSIONS,
  SIDE_EXPRESSIONS,
  resolveExpression,
  validateAssetGraph,
} from '../src/asset-contract.js';

const ASSETS_HASH = 'd'.repeat(64);
const FRAME_ASSET_HASH = 'a'.repeat(64);

function makePixels({ partialWhite = false } = {}) {
  const width = 20;
  const height = 20;
  const data = new Uint8Array(width * height * 4);
  for (let y = 2; y <= 17; y++) {
    for (let x = 2; x <= 17; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = partialWhite ? 255 : 80;
      data[offset + 1] = partialWhite ? 255 : 100;
      data[offset + 2] = partialWhite ? 255 : 120;
      data[offset + 3] = partialWhite && x === 2 ? 128 : 255;
    }
  }
  return { decoded: true, width, height, channels: 4, format: 'png', hasAlpha: true, hash: 'f'.repeat(64), pixelData: data };
}

function frame() {
  return {
    imageId: 'sheet',
    crop: { x: 0, y: 0, width: 20, height: 20 },
    durationMs: 100,
    anchorX: 10,
    anchorY: 15,
    groundY: 15,
    bodyScale: 1,
    bodyLandmarks: [{ id: 'shoulder', x: 8, y: 6 }, { id: 'hip', x: 12, y: 12 }],
    contactFeet: [{ footId: 'left', x: 8, y: 15, state: 'stance' }],
  };
}

function validFixture({ partialWhite = false } = {}) {
  const assets = {};
  const motions = {};
  const behaviors = {};
  const assetHashes = {};
  for (const behavior of DOG_BEHAVIORS) {
    const assetId = `${behavior}-front`;
    const count = behavior === 'walk' || behavior === 'run' ? 6
      : ['eat', 'tug', 'plushShake'].includes(behavior) ? 4
        : ['idle', 'sleep', 'insideHouse', 'sitWait', 'lookPlayer', 'lookFood'].includes(behavior) ? 1 : 3;
    const frames = Array.from({ length: count }, frame);
    const durationMs = count * 100;
    assets[assetId] = {
      id: assetId,
      behavior,
      direction: 'front',
      imageId: 'sheet',
      frames,
      frameCount: count,
      minimumFrameCount: count,
      sourceStatus: 'final',
      requiredForRelease: true,
      loop: behavior === 'walk' || behavior === 'run',
      ...(behavior === 'walk' || behavior === 'run' ? { cycleDurationMs: durationMs, strideLength: 1 } : {}),
      durationMs,
      maxCssHeight: 4,
      renderDprCap: 2,
      faceOverlay: false,
      locomotionMode: 'inPlace',
      normalizedBodyScale: 1,
      landmarksReviewed: true,
      stanceFootEvidence: {
        assetHash: FRAME_ASSET_HASH,
        rendererBuildHash: 'b'.repeat(64),
        testVersion: 'motion-fixture-v1',
        evidence: [{ path: 'test-results/release-evidence/motion-fixture.json', sha256: 'e'.repeat(64) }],
        samples: [{ footId: 'left', sampleCount: 8, maxDriftCssPx: 1 }],
      },
    };
    assetHashes[assetId] = FRAME_ASSET_HASH;
    motions[`${behavior}-motion`] = { assetId };
    behaviors[behavior] = { directions: ['front'], motionByDirection: { front: `${behavior}-motion` }, directionFallback: {} };
  }

  const expressions = { front: {}, side: {} };
  for (const [direction, names] of [['front', FRONT_EXPRESSIONS], ['side', SIDE_EXPRESSIONS]]) {
    for (const expression of names) {
      const id = `expression-${direction}-${expression}`;
      assets[id] = {
        id, behavior: 'idle', direction, imageId: 'sheet', frames: [frame()], frameCount: 1,
        minimumFrameCount: 1, sourceStatus: 'final', requiredForRelease: true, loop: false,
        durationMs: 100, maxCssHeight: 4, renderDprCap: 2, faceOverlay: false,
        locomotionMode: 'inPlace', normalizedBodyScale: 1, landmarksReviewed: true,
        stanceFootEvidence: {
          assetHash: FRAME_ASSET_HASH,
          rendererBuildHash: 'b'.repeat(64),
          testVersion: 'motion-fixture-v1',
          evidence: [{ path: 'test-results/release-evidence/motion-fixture.json', sha256: 'e'.repeat(64) }],
          samples: [{ footId: 'left', sampleCount: 4, maxDriftCssPx: 1 }],
        },
      };
      assetHashes[id] = FRAME_ASSET_HASH;
      expressions[direction][expression] = id;
    }
  }
  const manifest = { schemaVersion: 2, inventory: [...DOG_BEHAVIORS], images: { sheet: 'art/sheet.png' }, behaviors, motions, assets, expressions };
  const imageInfo = { sheet: makePixels({ partialWhite }) };
  const humanDogReview = {
    status: 'PASS',
    reviewedAssetsHash: ASSETS_HASH,
    reviewer: 'human-reviewer',
    evidence: [{ path: 'art/human-review/dog.png', sha256: 'e'.repeat(64) }],
  };
  return { manifest, imageInfo, assetHashes, humanDogReview };
}

function scopedOptions(fixture) {
  return {
    assetsHash: ASSETS_HASH,
    assetHashes: fixture.assetHashes,
    rendererBuildHash: 'b'.repeat(64),
    verifiedStanceEvidence: Object.fromEntries(Object.keys(fixture.assetHashes).map(id => [id, 'PASS'])),
    humanDogReview: fixture.humanDogReview,
  };
}

test('expression fallbacks terminate in the expected face or body behavior', () => {
  assert.deepEqual(resolveExpression('side', 'eating'), { kind: 'face', id: 'want' });
  assert.deepEqual(resolveExpression('back', 'happy'), { kind: 'body', id: 'petHappy' });
  for (const expression of ['normal', 'eating', 'relaxed', 'surprised']) assert.equal(resolveExpression('back', expression).kind, 'body');
});

test('a complete scoped final fixture passes only with decoded pixel, foot-drift, and human review proof', () => {
  const fixture = validFixture();
  const result = validateAssetGraph(fixture.manifest, fixture.imageInfo, scopedOptions(fixture));
  assert.equal(result.ok, true, JSON.stringify({ failures: result.failures.slice(0, 3), pending: result.pending.slice(0, 3) }));
  assert.equal(result.productionAssetIds.length, Object.keys(fixture.manifest.assets).length);
  assert.equal(result.clips['run-front'].finalEligible, true);
});

test('self-declared final and required fields cannot hide missing feet, decoded pixels, or current human proof', () => {
  const fixture = validFixture();
  const idle = fixture.manifest.assets['idle-front'];
  idle.frames[0].contactFeet = [];
  const run = fixture.manifest.assets['run-front'];
  run.frames[0].contactFeet = [];
  fixture.imageInfo.sheet = { decoded: true, width: 20, height: 20, format: 'png', hasAlpha: true };
  const result = validateAssetGraph(fixture.manifest, fixture.imageInfo, {
    ...scopedOptions(fixture),
    humanDogReview: { ...fixture.humanDogReview, reviewedAssetsHash: '0'.repeat(64) },
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.path === 'idle-front' && item.reason === 'contact_feet_missing:0'));
  assert.ok(result.failures.some(item => item.path === 'run-front' && item.reason === 'decoded_pixel_data_missing'));
  assert.equal(result.clips['run-front'].finalEligible, false);
  assert.ok(result.pending.some(item => item.reason === 'human_dog_review_hash_pending'));
});

test('image alpha fringe detection reports review candidates and does not call them a technical pass', () => {
  const fixture = validFixture({ partialWhite: true });
  const result = validateAssetGraph(fixture.manifest, fixture.imageInfo, scopedOptions(fixture));
  assert.equal(result.ok, true, 'a reviewed fringe candidate is not an automatic rejection');
  assert.ok(result.clips['idle-front'].alphaFringeCandidates.length > 0);
  assert.ok(result.clips['idle-front'].alphaFringeCandidates[0].whitePixels > 0);
});

test('missing scoped stance drift evidence stays PENDING even when source and human review say final', () => {
  const fixture = validFixture();
  delete fixture.manifest.assets['walk-front'].stanceFootEvidence;
  const result = validateAssetGraph(fixture.manifest, fixture.imageInfo, scopedOptions(fixture));
  assert.equal(result.clips['walk-front'].sourceStatus, 'final');
  assert.equal(result.clips['walk-front'].technicalStatus, 'PENDING');
  assert.equal(result.clips['walk-front'].finalEligible, false);
  assert.ok(result.pending.some(item => item.path === 'walk-front' && item.reason === 'stance_world_drift_evidence_pending'));
});

test('crop overflow, empty stance declarations, and unmatched reference paths block eligibility', () => {
  const fixture = validFixture();
  fixture.manifest.assets['idle-front'].frames[0].crop.width = 19;
  fixture.manifest.assets['run-front'].frames[0].contactFeet = [];
  fixture.manifest.behaviors.walk.motionByDirection.front = 'missing-motion';
  const result = validateAssetGraph(fixture.manifest, fixture.imageInfo, scopedOptions(fixture));
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.path === 'idle-front' && item.reason === 'transparent_margin:0'));
  assert.ok(result.failures.some(item => item.path === 'run-front' && item.reason === 'contact_feet_missing:0'));
  assert.ok(result.failures.some(item => item.reason === 'motion_missing'));
  assert.equal(result.clips['idle-front'].finalEligible, false);
});
