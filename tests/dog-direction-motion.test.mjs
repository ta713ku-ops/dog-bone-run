import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  directionMaskGeometry,
  directionScratchOrigin,
  interpolateDirectionControls,
  safeDirectionAmount,
  shiftDirectionControlsToEyeMid,
  triangleAffine,
  triangulatePoints,
  validateDirectionMetadata,
  DirectionalHeadPainter,
} from '../src/dog-direction-motion.js';

const metadata = JSON.parse(await readFile(new URL('../art/dog-direction/metadata.json', import.meta.url), 'utf8'));
const signedArea = (points, [a, b, c]) => {
  const p = points[a], q = points[b], r = points[c];
  return ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
};

test('direction metadata loads as one bounded canonical head mesh', () => {
  const normalized = validateDirectionMetadata(metadata);
  assert.ok(normalized);
  assert.deepEqual(normalized.rect, { left: 60, top: 18, width: 252, height: 240 });
  assert.equal(normalized.controls.front.length, 21);
  assert.equal(normalized.triangles.length, 32);
  assert.equal(normalized.sheet.width * normalized.sheet.height * 4, 401_408);
  for (const points of [normalized.controls.front, normalized.controls.left, normalized.controls.right]) {
    for (const triangle of normalized.triangles) assert.ok(Math.abs(signedArea(points, triangle)) > 1e-5);
  }
});

test('front controls follow the live eye midpoint and preserve per-eye frame tilt', () => {
  const eyes = [{ x: 174.5, y: 142.25 }, { x: 226.25, y: 137.75 }];
  const front = shiftDirectionControlsToEyeMid(metadata.controls.front, eyes);
  const expectedMid = { x: 200.375, y: 140 };
  assert.ok(Math.abs((front[13].x + front[14].x) / 2 - expectedMid.x) < 1e-10);
  assert.ok(Math.abs((front[13].y + front[14].y) / 2 - expectedMid.y) < 1e-10);
  front[13] = eyes[0];
  front[14] = eyes[1];
  assert.deepEqual(front.slice(13, 15), eyes);
  assert.deepEqual(shiftDirectionControlsToEyeMid(metadata.controls.front, null), []);
});

test('reclined head scratch follows live eyes while the soft replacement mask ends above the feet', () => {
  const stored = { x: metadata.rect.left - 19, y: metadata.rect.top - 19 };
  const eyes = { x: 200.375, y: 267 };
  const origin = directionScratchOrigin(stored, eyes);
  assert.deepEqual(origin, { x: stored.x + 17.375, y: stored.y + 139.5 });
  const mask = directionMaskGeometry(eyes, origin);
  assert.ok(mask);
  assert.equal(mask.leftFull + origin.x, eyes.x - 80);
  assert.equal(mask.rightFull + origin.x, eyes.x + 80);
  assert.equal(mask.leftZero + origin.x, eyes.x - 105);
  assert.equal(mask.rightZero + origin.x, eyes.x + 105);
  assert.equal(mask.bottomZero + origin.y, 344);
  assert.ok(mask.bottomFull < mask.bottomZero);
  assert.ok(mask.bottomZero < 350, 'the body-removal mask is fully clear before grounded foot rows');
  assert.equal(directionScratchOrigin(stored, null), null);
  assert.equal(directionMaskGeometry(null, origin), null);
});

test('yaw interpolation clamps to endpoints and generated triangles never invert', () => {
  for (const side of ['left', 'right']) {
    assert.deepEqual(interpolateDirectionControls(metadata.controls.front, metadata.controls[side], -1),
      metadata.controls.front.map(([x, y]) => ({ x, y })));
    assert.deepEqual(interpolateDirectionControls(metadata.controls.front, metadata.controls[side], 1),
      metadata.controls[side].map(([x, y]) => ({ x, y })));
    for (let step = 0; step <= 100; step++) {
      const request = step / 100;
      const amount = safeDirectionAmount(metadata.controls.front, metadata.controls[side], metadata.controls.triangles, request);
      assert.ok(amount >= 0 && amount <= request + 1e-10);
      const points = interpolateDirectionControls(metadata.controls.front, metadata.controls[side], amount);
      for (let index = 0; index < metadata.controls.triangles.length; index++) {
        const triangle = metadata.controls.triangles[index];
        assert.ok(signedArea(points, triangle) > 1e-5, `${side} triangle ${index} remains positively oriented at ${amount}`);
      }
    }
  }
});

test('safe yaw stops before an intermediate triangle collapses or flips', () => {
  const front = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const turned = [{ x: 0, y: 0 }, { x: -10, y: 0 }, { x: 0, y: 10 }];
  const amount = safeDirectionAmount(front, turned, [[0, 1, 2]], 1);
  assert.ok(amount > 0 && amount < 0.5);
  assert.ok(signedArea(interpolateDirectionControls(front, turned, amount), [0, 1, 2]) > 1e-5);
  assert.equal(safeDirectionAmount(front, turned, [[0, 1, 2]], 0), 0);
});

test('triangle affine mapping is finite and lands exactly on all target vertices', () => {
  const source = [{ x: 2, y: 3 }, { x: 20, y: 4 }, { x: 5, y: 28 }];
  const destination = [{ x: 31, y: 12 }, { x: 63, y: 21 }, { x: 38, y: 55 }];
  const affine = triangleAffine(source, destination);
  assert.ok(affine);
  for (let index = 0; index < 3; index++) {
    const p = source[index];
    const actual = {
      x: affine.a * p.x + affine.c * p.y + affine.e,
      y: affine.b * p.x + affine.d * p.y + affine.f,
    };
    assert.ok(Math.hypot(actual.x - destination[index].x, actual.y - destination[index].y) < 1e-9);
  }
  assert.equal(triangleAffine([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], destination), null);
});

test('generated triangulation is deterministic and excludes degenerate faces', () => {
  const points = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 4]];
  const first = triangulatePoints(points), second = triangulatePoints(points);
  assert.deepEqual(first, second);
  assert.ok(first.length >= 4);
  for (const triangle of first) assert.ok(Math.abs(signedArea(points.map(([x, y]) => ({ x, y })), triangle)) > 1e-5);
});

test('an unavailable direction pack resolves its optional load without blocking', async () => {
  const painter = new DirectionalHeadPainter({ timeoutMs: 8, fetcher: () => new Promise(() => {}) });
  assert.equal(await painter.ready, false);
  assert.equal(painter.available, false);
  assert.deepEqual(painter.stats, { decodedBytes: 0, scratchBytes: 0, maskBytes: 0, peakCachedBytes: 0, available: false });
});

test('disposing a pending optional pack resolves readiness and never starts a late image request', async () => {
  let finishMetadata;
  const painter=new DirectionalHeadPainter({timeoutMs:1000,fetcher:()=>new Promise(resolve=>{finishMetadata=resolve;})});
  painter.dispose();
  assert.equal(await painter.ready,false);
  finishMetadata({ok:true,json:async()=>metadata});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(painter.available,false);
  assert.equal(painter.image,null);
  assert.equal(painter.stats.decodedBytes,0);
});
