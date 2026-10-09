import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DOG_BEHAVIORS } from '../src/asset-contract.js';
import { buildDog3DModel } from '../src/dog-3d-model.js';
import {
  LEGACY_DOG_INVENTORY_BACKUP,
  LIVE_DOG_SOURCE_FILES,
  validateLiveDogContract,
} from '../src/live-dog-contract.js';
import { generateDogAssetReport } from '../scripts/validate-dog-assets.mjs';

const directions = { front: 0, right: Math.PI / 2, back: Math.PI, left: Math.PI * 1.5 };

function manifestFor(model = buildDog3DModel()) {
  return {
    schemaVersion: 3,
    rendererKind: 'articulated3d',
    sourceStatus: 'candidate',
    legacyInventoryBackup: LEGACY_DOG_INVENTORY_BACKUP,
    inventory: [...DOG_BEHAVIORS],
    sourceFiles: { ...LIVE_DOG_SOURCE_FILES },
    modelVersion: model.modelVersion,
    rigVersion: model.rigVersion,
    standingHeight: model.standingHeight,
    groundPlaneY: model.groundPlaneY,
    directions,
    limits: { triangles: 15_000, joints: 24, materials: 1, maxStanceFootDriftCssPx: 3 },
    skinning: 'single-joint-weight-one',
    humanApproval: { required: true, bindsTo: 'assetsHash' },
    integrationChecks: { houseOcclusion: 'required', toyMouthFollow: 'required', homeRunResultRenderer: 'required' },
    behaviors: Object.fromEntries(DOG_BEHAVIORS.map(action => [action, { action }])),
  };
}

async function rendererText() {
  return readFile(new URL('../src/dog-3d-renderer.js', import.meta.url), 'utf8');
}

function copyModel(model = buildDog3DModel()) {
  return {
    ...model,
    positions: new Float32Array(model.positions),
    normals: new Float32Array(model.normals),
    colors: new Uint8Array(model.colors),
    joints: new Uint8Array(model.joints),
    indices: new Uint16Array(model.indices),
  };
}

test('schema-3 technical gate checks real 3D buffers, all required actions, four yaws, and rendered paw-matrix contact', async () => {
  const result = validateLiveDogContract({ manifest: manifestFor(), rendererSource: await rendererText() });
  assert.equal(result.status, 'PASS', JSON.stringify(result.failures.slice(0, 12), null, 2));
  assert.equal(result.ok, true);
  assert.equal(result.triangleCount, buildDog3DModel().indices.length / 3);
  assert.equal(result.jointCount, 24);
  assert.equal(Object.keys(result.actionCoverage).length, 33);
  assert.ok(Object.values(result.actionCoverage).every(Boolean));
  assert.ok(Object.values(result.stanceDrift).every(value => value <= 3), JSON.stringify(result.stanceDrift));
  assert.ok(result.verificationScope.verified.some(item => item.includes('actual rendered paw vertices')));
  assert.ok(result.verificationScope.notVerified.some(item => item.includes('human judgment')));
});

test('bad positions, indices, and bone IDs fail based on the actual arrays', async () => {
  const source = await rendererText();
  const nonFinite = copyModel();
  nonFinite.positions[0] = Number.NaN;
  const badPosition = validateLiveDogContract({ manifest: manifestFor(nonFinite), model: nonFinite, rendererSource: source });
  assert.ok(badPosition.failures.some(item => item.reason === 'non_finite_vertex_position'));

  const invalidIndex = copyModel();
  invalidIndex.indices[0] = invalidIndex.positions.length / 3;
  const badIndex = validateLiveDogContract({ manifest: manifestFor(invalidIndex), model: invalidIndex, rendererSource: source });
  assert.ok(badIndex.failures.some(item => item.reason === 'triangle_index_out_of_range'));

  const invalidJoint = copyModel();
  invalidJoint.joints[0] = 255;
  const badJoint = validateLiveDogContract({ manifest: manifestFor(invalidJoint), model: invalidJoint, rendererSource: source });
  assert.ok(badJoint.failures.some(item => item.reason === 'invalid_vertex_bone_id'));
});

test('missing behavior binding and renderer upload path cannot claim technical PASS', async () => {
  const manifest = manifestFor();
  delete manifest.behaviors.plushCuddle;
  const result = validateLiveDogContract({ manifest, rendererSource: (await rendererText()).replace('flattenJointMatrices(pose.jointMatrices)', 'flattenJointMatrices([])') });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.failures.some(item => item.path === 'plushCuddle' && item.reason === 'behavior_action_binding_missing'));
  assert.ok(result.failures.some(item => item.path === 'renderer' && item.reason === 'renderer_not_proven_to_draw_the_validated_3d_pose'));
});

test('the existing asset CLI takes the schema-3 branch before loading Sharp and hashes source bytes into the candidate', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'live-dog-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'art'), { recursive: true });
  const model = buildDog3DModel();
  const manifest = manifestFor(model);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(root, 'art/dog-asset-inventory.json'), manifestBytes);
  await writeFile(path.join(root, LEGACY_DOG_INVENTORY_BACKUP), await readFile(new URL('../art/dog-asset-inventory-v5.1.json', import.meta.url)));
  for (const relative of Object.values(LIVE_DOG_SOURCE_FILES)) {
    await writeFile(path.join(root, relative), await readFile(new URL(`../${relative}`, import.meta.url)));
  }
  await writeFile(path.join(root, 'src/live-dog-contract.js'), await readFile(new URL('../src/live-dog-contract.js', import.meta.url)));
  await writeFile(path.join(root, 'scripts/validate-live-dog.mjs'), await readFile(new URL('../scripts/validate-live-dog.mjs', import.meta.url)));
  await writeFile(path.join(root, 'scripts/validate-dog-assets.mjs'), await readFile(new URL('../scripts/validate-dog-assets.mjs', import.meta.url)));

  const first = await generateDogAssetReport({ root, writeReport: false, humanApprovals: null });
  assert.equal(first.status, 'PASS', JSON.stringify(first.failures.slice(0, 8), null, 2));
  assert.equal(first.technicalChecks.status, 'PASS');
  assert.equal(first.humanDogReview, 'PENDING');
  assert.equal(first.ok, true, 'human visual approval is recorded separately from automatic technical validation');
  assert.equal(first.buildHash, first.assetsHash);
  assert.match(first.buildHash, /^[a-f0-9]{64}$/);
  assert.equal(first.finalAssetsPending.length, 33);
  assert.equal(first.clips.idle.sourceStatus, 'candidate');
  assert.equal(first.clips.idle.technicalStatus, 'PASS');
  assert.equal(first.clips.idle.finalEligible, false);
  assert.equal(first.summary.requiredBehaviors, 33);
  assert.match(first.legacyInventoryHash, /^[a-f0-9]{64}$/);
  assert.equal(first.technicalChecks.integrationChecks.houseOcclusion.status, 'PENDING');

  const rendererPath = path.join(root, LIVE_DOG_SOURCE_FILES.renderer);
  await writeFile(rendererPath, `${await readFile(rendererPath, 'utf8')}\n// source-byte change\n`);
  const second = await generateDogAssetReport({ root, writeReport: false, humanApprovals: null });
  assert.notEqual(second.buildHash, first.buildHash, 'renderer bytes are part of the candidate build hash');
  assert.equal(second.manifestHash, first.manifestHash);

  const evidenceBytes = Buffer.from('human-reviewed-current-candidate');
  await mkdir(path.join(root, 'art/dog-review'), { recursive: true });
  await writeFile(path.join(root, 'art/dog-review/review.json'), evidenceBytes);
  const reviewed = await generateDogAssetReport({
    root,
    writeReport: false,
    humanApprovals: {
      gates: {
        humanDog: {
          gateId: 'humanDog',
          status: 'PASS',
          reviewedAssetsHash: second.assetsHash,
          reviewer: 'reviewer',
          testVersion: 'visual-3d-v1',
          executedAt: '2026-10-04T11:00:00.000Z',
          evidence: [{ path: 'art/dog-review/review.json', sha256: createHash('sha256').update(evidenceBytes).digest('hex') }],
        },
      },
    },
  });
  assert.equal(reviewed.humanDogReview, 'PASS');
  assert.equal(reviewed.checks.humanVisualApproval.status, 'PASS');
  assert.equal(reviewed.clips.idle.sourceStatus, 'candidate');
  assert.equal(reviewed.clips.idle.finalEligible, false, 'a source still marked candidate never becomes final through the validator');

  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist/index.js'), 'actual distribution bundle');
  const withDist = await generateDogAssetReport({ root, writeReport: false, humanApprovals: null });
  assert.notEqual(withDist.buildHash, withDist.assetsHash, 'when a dist build exists, buildHash covers its actual files');
  assert.equal(withDist.modelBundleHash, withDist.assetsHash);
  assert.equal(withDist.rendererBuildHash, withDist.buildHash);
});

test('schema-2 inventory still follows the legacy image validator and retains its original failure surface', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'legacy-dog-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'art'), { recursive: true });
  const original = await readFile(new URL('../art/dog-asset-inventory-v5.1.json', import.meta.url));
  const legacyManifest = JSON.parse(original);
  assert.equal(legacyManifest.schemaVersion, 2);
  assert.ok(legacyManifest.images.front);
  await writeFile(path.join(root, 'art/dog-asset-inventory.json'), original);
  const report = await generateDogAssetReport({ root, writeReport: false, sharp: () => ({}) });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.decodeErrors.length > 0);
  assert.ok(report.failures.length > 0);
});
