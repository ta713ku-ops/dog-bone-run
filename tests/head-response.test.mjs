import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bodyShiftOffsetAt, createHeadMotionRegion, gazeOffsetAt, headMotionPoint,
  pawAdjustOffsetAt, rasterWorkBounds, warpHeadPixels,
} from '../src/dog-natural-motion.js';

const homeAtlases = JSON.parse(readFileSync(new URL('../art/dog-home-continuity.json', import.meta.url), 'utf8')).atlases;
const poses = [
  { name: 'standing', ...homeAtlases.greet.frames[0].landmarks },
  { name: 'sitting', ...homeAtlases.sitdown.frames.at(-1).landmarks },
  { name: 'lying', ...homeAtlases.liedown.frames.at(-1).landmarks },
];

test('raster work bounds include low-alpha fur fringe and bounded motion padding', () => {
  const width = 64, height = 48;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.set([92, 54, 31, 255], (12 * width + 15) * 4);
  pixels.set([92, 54, 31, 1], (32 * width + 45) * 4);

  assert.deepEqual(rasterWorkBounds(pixels, width, height, 8), {
    left: 7, right: 54, top: 4, bottom: 41,
  }, 'alpha 1 fringe pixels define the exact source support before motion padding');
  assert.equal(rasterWorkBounds(new Uint8ClampedArray(width * height * 4), width, height), null,
    'an empty raster has no work area');
  assert.equal(rasterWorkBounds(pixels, width, height - 1), null,
    'invalid raster dimensions fall back to the full sampler');

  const lying = poses.find(pose => pose.name === 'lying');
  const framePixels = new Uint8ClampedArray(384 * 384 * 4);
  const fringeX = Math.max(0, lying.left - 2), fringeY = lying.top + 3;
  framePixels[(fringeY * 384 + fringeX) * 4 + 3] = 1;
  const bounds = rasterWorkBounds(framePixels);
  assert.ok(bounds.left <= fringeX && bounds.right > fringeX,
    'raster-derived bounds include alpha that sits outside the landmark threshold');
  assert.ok(bounds.top <= fringeY && bounds.bottom > fringeY);
  assert.ok((bounds.right - bounds.left) * (bounds.bottom - bounds.top) < 384 * 384,
    'the padded work area stays smaller than a full-canvas pass');
});

test('head response tilts and lifts around the neck pivot in every home posture', () => {
  for (const pose of poses) {
    const region = createHeadMotionRegion(pose);
    const beforeY = (pose.eyes[0].y + pose.eyes[1].y) / 2;
    const beforeEyeSlope = pose.eyes[0].y - pose.eyes[1].y;
    const eyes = pose.eyes.map(eye => headMotionPoint(eye.x, eye.y, region, 0.055, 4));
    const afterY = (eyes[0].y + eyes[1].y) / 2;
    const afterEyeSlope = eyes[0].y - eyes[1].y;

    assert.ok(eyes.every(eye => Number.isFinite(eye.x) && Number.isFinite(eye.y)), `${pose.name} eyes stay finite`);
    assert.ok(afterY < beforeY - 3.8 && afterY > beforeY - 4.3,
      `${pose.name} head lifts about four 384px-canvas pixels`);
    assert.ok(Math.abs(afterEyeSlope - beforeEyeSlope) > 2 && Math.abs(afterEyeSlope - beforeEyeSlope) < 3.5,
      `${pose.name} head tilt is visible but small`);

    const chest = headMotionPoint(region.centerX, region.fadeEndY + 8, region, 0.055, 4);
    assert.deepEqual(chest, { x: region.centerX, y: region.fadeEndY + 8 },
      `${pose.name} chest and lower body stay still below the neck fade`);
  }
});

test('head raster warp stays local, preserves its input, and samples alpha without color fringes', () => {
  const region = createHeadMotionRegion(poses.find(pose => pose.name === 'lying'));
  const source = new Uint8ClampedArray(384 * 384 * 4);
  const output = new Uint8ClampedArray(source.length);
  for (let p = 0; p < source.length; p += 4) source.set([255, 0, 255, 0], p);

  const bodyTop = region.eyeY + 18;
  for (let y = 0; y < 384; y++) {
    for (let x = 0; x < 384; x++) {
      const head = ((x - region.centerX) / 72) ** 2 + ((y - (region.eyeY - 10)) / 70) ** 2 <= 1;
      const bodyHalfWidth = Math.max(24, 86 - Math.max(0, y - bodyTop) * 0.12);
      const body = y >= bodyTop && y < 376 && Math.abs(x - region.centerX) <= bodyHalfWidth;
      if (head || body) source.set([24, 196, 74, 255], (y * 384 + x) * 4);
    }
  }
  const original = source.slice();

  assert.equal(warpHeadPixels(source, region, 0, 0, output), source,
    'zero response uses the immutable cached raster directly');
  assert.equal(warpHeadPixels(source, region, 0.055, 4, output), output);
  assert.deepEqual(source, original, 'head preparation never mutates its source raster');

  let changedInside = 0, changedOutside = 0, partialAlpha = 0;
  const { left, right, top, bottom } = region.bounds;
  for (let y = 0; y < 384; y++) {
    for (let x = 0; x < 384; x++) {
      const p = (y * 384 + x) * 4;
      const changed = source[p] !== output[p] || source[p + 1] !== output[p + 1]
        || source[p + 2] !== output[p + 2] || source[p + 3] !== output[p + 3];
      if (changed) {
        if (x >= left && x < right && y >= top && y < bottom) changedInside++;
        else changedOutside++;
      }
      if (output[p + 3] === 0) continue;
      if (output[p + 3] < 255) partialAlpha++;
      assert.ok(output[p] < 30 && output[p + 2] < 80 && output[p + 1] > 185,
        `transparent magenta cannot bleed into the dog edge at ${x},${y}`);
    }
  }
  assert.ok(changedInside > 1_000, 'actual lying-pose landmarks produce a clearly visible head response');
  assert.equal(changedOutside, 0, 'pixels outside the padded head support stay byte-identical');
  assert.ok(partialAlpha > 0, 'subpixel sampling preserves antialiased alpha edges');

  let changedFeet = 0;
  for (let y = 350; y < 384; y++) {
    for (let x = 0; x < 384; x++) {
      const p = (y * 384 + x) * 4;
      if (source[p] !== output[p] || source[p + 1] !== output[p + 1]
        || source[p + 2] !== output[p + 2] || source[p + 3] !== output[p + 3]) changedFeet++;
    }
  }
  assert.equal(changedFeet, 0, 'pixels at y=350 and below, including the feet, stay byte-identical');
});

test('head point transforms clamp motion and keep invalid samples finite', () => {
  const region = createHeadMotionRegion(poses[0]);
  const eye = poses[0].eyes[0];
  const bounded = headMotionPoint(eye.x, eye.y, region, 9, 100);
  const atLimit = headMotionPoint(eye.x, eye.y, region, 0.055, 4);
  const invalid = headMotionPoint(eye.x, eye.y, region, Number.NaN, Number.POSITIVE_INFINITY);

  assert.ok(Number.isFinite(bounded.x) && Number.isFinite(bounded.y));
  assert.deepEqual(bounded, atLimit, 'large inputs clamp to the 0.055rad and 4px limits');
  assert.deepEqual(invalid, { x: eye.x, y: eye.y }, 'nonfinite inputs resolve to a still head');
});

test('head rest lowers the face rigidly while preserving the independent headLift contract', () => {
  const pose = poses.find(candidate => candidate.name === 'lying');
  const region = createHeadMotionRegion(pose);
  const eye = pose.eyes[0];
  const atRest = headMotionPoint(eye.x, eye.y, region, 0, 0, 1);
  const withLift = headMotionPoint(eye.x, eye.y, region, 0, 4, 1);

  assert.ok(Math.abs(atRest.y - eye.y - 14) < 1e-8, 'headRest adds at most fourteen canonical pixels downward');
  assert.ok(Math.abs(withLift.y - eye.y - 10) < 1e-8, 'headLift still subtracts its existing four-pixel maximum');
  const unchanged = headMotionPoint(eye.x, eye.y, region, 0, 0, 0);
  assert.deepEqual(unchanged, { x: eye.x, y: eye.y },
    'the new channel defaults to the original face coordinates');
});

test('body shift, gaze and paw adjustment stay inside their small local supports', () => {
  const pose = poses.find(candidate => candidate.name === 'sitting');
  const eyeY = (pose.eyes[0].y + pose.eyes[1].y) / 2;
  const ground = 372;
  assert.equal(bodyShiftOffsetAt(eyeY + 36, eyeY, ground, 1), 3);
  assert.equal(bodyShiftOffsetAt(ground - 22, eyeY, ground, 1), 0);
  assert.ok(bodyShiftOffsetAt(350, eyeY, ground, -1) === 0,
    'the body shift is zero throughout strict foot rows at or below 350');

  const gaze = [0, 0];
  gazeOffsetAt(pose.eyes[0].x, pose.eyes[0].y, pose.eyes, 1, gaze);
  assert.deepEqual(gaze, [1, 0], 'gaze reaches one canonical pixel at the eye center');
  gazeOffsetAt(pose.eyes[0].x + 16, pose.eyes[0].y, pose.eyes, 1, gaze);
  assert.deepEqual(gaze, [0, 0], 'gaze returns to zero outside its feathered eye patch');
  gazeOffsetAt(10, 100, [{ x: 0, y: 100 }, { x: 20, y: 100 }], -1, gaze);
  assert.deepEqual(gaze, [-1, 0], 'overlapping eye supports still obey the one-pixel contract in either direction');

  const eyeMidX = (pose.eyes[0].x + pose.eyes[1].x) / 2;
  const eyeHalfSpan = Math.abs(pose.eyes[1].x - pose.eyes[0].x) / 2;
  const pawX = eyeMidX - eyeHalfSpan * 1.9;
  const pawY = ground - 26;
  const paw = [0, 0];
  pawAdjustOffsetAt(pawX, pawY, pose, ground, 1, paw);
  assert.deepEqual(paw, [2, -1], 'paw adjustment reaches only two pixels right and one pixel up');
  pawAdjustOffsetAt(pawX + 17, pawY, pose, ground, 1, paw);
  assert.deepEqual(paw, [0, 0], 'paw adjustment returns to zero outside its feathered paw patch');
});

test('head-rest raster warp leaves every foot row byte-identical', () => {
  const pose = poses.find(candidate => candidate.name === 'lying');
  const region = createHeadMotionRegion(pose);
  const source = new Uint8ClampedArray(384 * 384 * 4);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < 384; y++) {
    for (let x = 0; x < 384; x++) {
      const pixel = (y * 384 + x) * 4;
      source.set([x % 251, y % 251, (x + y) % 251, 255], pixel);
    }
  }
  assert.equal(warpHeadPixels(source, region, 0, 0, output, 1), output);
  for (let y = 350 * 384 * 4; y < source.length; y++) {
    assert.equal(output[y], source[y], `head rest cannot change row ${Math.floor(y / (384 * 4))}`);
  }
});
