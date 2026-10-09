import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPosturePath } from '../src/dog-posture-path.js';

const metadata = JSON.parse(readFileSync(new URL('../art/dog-home-continuity.json', import.meta.url), 'utf8'));
const productionFeatures = {
  liedown: metadata.atlases.liedown.frames.map(frame => frame.landmarks),
};

function midpointAt(features, index) {
  const frames = features.liedown;
  const lower = Math.floor(index);
  const upper = Math.min(frames.length - 1, lower + 1);
  const fraction = index - lower;
  const midpoint = frame => (frame.eyes[0].y + frame.eyes[1].y) / 2;
  return midpoint(frames[lower]) + (midpoint(frames[upper]) - midpoint(frames[lower])) * fraction;
}

function singleLieLayer(index, weight = 1) {
  return [{ atlas: 'liedown', index, weight }];
}

function adjacentLieLayersAt(index, last = productionFeatures.liedown.length - 1) {
  const lower = Math.floor(index);
  const upper = Math.min(last, lower + 1);
  const mix = index - lower;
  return upper === lower
    ? [{ atlas: 'liedown', index: lower, weight: 1 }]
    : [
      { atlas: 'liedown', index: lower, weight: 1 - mix },
      { atlas: 'liedown', index: upper, weight: mix },
    ].filter(layer => layer.weight > 0);
}

function rawLieMixtureCorrection(layers, path) {
  const totalWeight = layers.reduce((sum, layer) => sum + layer.weight, 0);
  const meanIndex = layers.reduce((sum, layer) => sum + layer.index * layer.weight, 0) / totalWeight;
  const weightedActualY = layers.reduce((sum, layer) =>
    sum + midpointAt(productionFeatures, layer.index) * layer.weight, 0) / totalWeight;
  const desiredY = midpointAt(productionFeatures, meanIndex) - path.sample(singleLieLayer(meanIndex));
  return weightedActualY - desiredY;
}

test('production 48-frame lie landmarks become a monotone C1 path within the lift bound', () => {
  const path = createPosturePath(productionFeatures);
  assert.equal(path.debug.enabled, true);
  assert.equal(path.debug.knots.length, 5);
  assert.ok(path.debug.maxCorrectionPx <= 20);
  assert.equal(path.sample(singleLieLayer(0)), 0);
  assert.equal(path.sample(singleLieLayer(47)), 0);

  const correctedAt = index => midpointAt(productionFeatures, index) - path.sample(adjacentLieLayersAt(index));
  let previous = correctedAt(0);
  for (let step = 1; step <= 4700; step += 1) {
    const index = 47 * step / 4700;
    const current = correctedAt(index);
    assert.ok(current >= previous - 1e-8, `corrected lie path reverses near frame ${index}`);
    assert.ok(Math.abs(path.sample(singleLieLayer(index))) <= 20, `lift exceeds 20px near frame ${index}`);
    previous = current;
  }

  for (const knotIndex of [8, 20, 30]) {
    const epsilon = 1e-3;
    const value = correctedAt(knotIndex);
    const leftSlope = (value - correctedAt(knotIndex - epsilon)) / epsilon;
    const rightSlope = (correctedAt(knotIndex + epsilon) - value) / epsilon;
    assert.ok(Math.abs(leftSlope - rightSlope) < 0.02,
      `the path derivative changes at frame ${knotIndex}: ${leftSlope} vs ${rightSlope}`);
  }

  const endpointEpsilon = 1e-3;
  const startSlope = (correctedAt(endpointEpsilon) - correctedAt(0)) / endpointEpsilon;
  const endSlope = (correctedAt(47) - correctedAt(47 - endpointEpsilon)) / endpointEpsilon;
  assert.ok(Math.abs(startSlope) < 0.01, `start slope is not zero: ${startSlope}`);
  assert.ok(Math.abs(endSlope) < 0.01, `end slope is not zero: ${endSlope}`);
});

test('path uses proportional landmark knots for non-48 frame atlases', () => {
  const source = productionFeatures.liedown;
  const liedown = Array.from({ length: 32 }, (_, index) => {
    const sourceIndex = index * 47 / 31;
    const low = Math.floor(sourceIndex);
    const high = Math.min(source.length - 1, low + 1);
    const mix = sourceIndex - low;
    return {
      eyes: [0, 1].map(eye => ({
        x: source[low].eyes[eye].x + (source[high].eyes[eye].x - source[low].eyes[eye].x) * mix,
        y: source[low].eyes[eye].y + (source[high].eyes[eye].y - source[low].eyes[eye].y) * mix,
      })),
    };
  });
  const path = createPosturePath({ liedown });
  assert.equal(path.debug.enabled, true);
  assert.deepEqual(path.debug.knots.map(knot => knot.index), [0, 5, 13, 20, 31]);
});

test('mixed layers apply only the normalized liedown correction', () => {
  const path = createPosturePath(productionFeatures);
  const lieCorrection = path.sample(singleLieLayer(44));
  assert.notEqual(lieCorrection, 0);
  assert.equal(path.sample([{ atlas: 'sitdown', index: 44, weight: 1 }]), 0);
  assert.ok(Math.abs(path.sample([
    { atlas: 'liedown', index: 44, weight: 0.25 },
    { atlas: 'sitdown', index: 12, weight: 0.75 },
  ]) - lieCorrection * 0.25) < 1e-10);
  assert.ok(Math.abs(path.sample([
    { atlas: 'liedown', index: 44, weight: 0.2 },
    { atlas: 'sitdown', index: 12, weight: 0.6 },
  ]) - lieCorrection * 0.25) < 1e-10, 'unnormalized blends are normalized by total weight');
  assert.ok(Math.abs(path.sample([
    { atlas: 'liedown', index: 44, weight: 0.5 },
    { atlas: 'liedown', index: 45, weight: 0.5 },
  ]) - path.sample(singleLieLayer(44.5))) < 1e-10,
  'adjacent lie frames use the desired spline at their weighted mean index');
  assert.ok(Math.abs(path.sample([
    { atlas: 'liedown', index: 44, weight: 0.5 },
    { atlas: 'liedown', index: 45, weight: 0.5 },
  ])) < 20, 'the validated adjacent-frame correction stays below the clamp');
});

test('broad two-to-four-layer mixtures clamp continuously at the correction bound', () => {
  const path = createPosturePath(productionFeatures);
  const onset = Math.max(18, path.debug.maxCorrectionPx + (20 - path.debug.maxCorrectionPx) * 0.1);
  const shoulderWidth = 2 * (20 - onset);
  const shoulderEnd = onset + shoulderWidth;
  const extraLayers = [
    [],
    [{ atlas: 'liedown', index: 47, weight: 0.001 }],
    [
      { atlas: 'liedown', index: 47, weight: 0.001 },
      { atlas: 'liedown', index: 8, weight: 0.001 },
    ],
  ];

  for (const extras of extraLayers) {
    const layersAt = weight27 => [
      { atlas: 'liedown', index: 0, weight: 0.505 },
      { atlas: 'liedown', index: 27, weight: weight27 },
      ...extras,
    ];
    const citedMix = layersAt(0.51);
    assert.ok(rawLieMixtureCorrection(citedMix, path) > 20,
      'the 0/27 blend around weights 0.505 and 0.51 exceeds the raw bound');
    assert.ok(path.sample(citedMix) > onset && path.sample(citedMix) < 20,
      'the C1 shoulder preserves the raw value through its onset and eases toward 20px');

    let previous = null;
    let crossedBound = false;
    let stayedBelowBound = false;
    for (let step = 0; step <= 100; step += 1) {
      const weight27 = 0.15 + step * 0.001;
      const correction = path.sample(layersAt(weight27));
      assert.ok(Math.abs(correction) <= 20);
      if (previous !== null) {
        assert.ok(Math.abs(correction - previous) < 0.2,
          `correction jumps ${previous} -> ${correction} at weight ${weight27}`);
      }
      if (correction === 20) crossedBound = true;
      if (correction < 20) stayedBelowBound = true;
      previous = correction;
    }
    assert.equal(crossedBound, true, 'the sweep reaches the saturated side');
    assert.equal(stayedBelowBound, true, 'the sweep includes unsaturated corrections');

    const weightForRaw = target => {
      let low = 0.15;
      let high = 0.3;
      for (let iteration = 0; iteration < 60; iteration += 1) {
        const middle = (low + high) / 2;
        if (rawLieMixtureCorrection(layersAt(middle), path) < target) low = middle;
        else high = middle;
      }
      return (low + high) / 2;
    };
    const assertC1AtRaw = target => {
      const weight = weightForRaw(target);
      const epsilon = 1e-5;
      const output = value => path.sample(layersAt(value));
      const center = output(weight);
      const leftSlope = (center - output(weight - epsilon)) / epsilon;
      const rightSlope = (output(weight + epsilon) - center) / epsilon;
      assert.ok(Math.abs(leftSlope - rightSlope) < 0.1,
        `the shoulder derivative changes near raw correction ${target}: ${leftSlope} vs ${rightSlope}`);
    };
    assertC1AtRaw(onset);
    assertC1AtRaw(shoulderEnd);
  }
});

test('sampling is independent of 30, 60, and 120Hz frame cadence', () => {
  const path = createPosturePath(productionFeatures);
  const durationSeconds = 2;
  const valuesByRate = new Map();
  for (const rate of [30, 60, 120]) {
    const values = [];
    for (let commonFrame = 0; commonFrame <= durationSeconds * 30; commonFrame += 1) {
      const frame = commonFrame * (rate / 30);
      const seconds = frame / rate;
      const index = 47 * seconds / durationSeconds;
      values.push(path.sample(adjacentLieLayersAt(index)));
    }
    valuesByRate.set(rate, values);
  }
  for (let commonFrame = 0; commonFrame <= durationSeconds * 30; commonFrame += 1) {
    const at30 = valuesByRate.get(30)[commonFrame];
    const at60 = valuesByRate.get(60)[commonFrame];
    const at120 = valuesByRate.get(120)[commonFrame];
    assert.equal(at30, at60, `${commonFrame / 30}s differs at 30 and 60Hz`);
    assert.equal(at60, at120, `${commonFrame / 30}s differs at 60 and 120Hz`);
  }
});

test('malformed weights, bad features, decreasing endpoints, and over-limit paths safely return zero', () => {
  const path = createPosturePath(productionFeatures);
  for (const layers of [null, {}, [{ atlas: 'liedown', index: 44, weight: NaN }],
    [{ atlas: 'liedown', index: 44, weight: -0.1 }],
    [{ atlas: 'liedown', index: 44, weight: 1.1 }],
    [{ atlas: 'liedown', index: 48, weight: 1 }]]) {
    assert.equal(path.sample(layers), 0);
  }

  const invalidFeaturePath = createPosturePath({ liedown: [{ eyes: [{ x: 1, y: 2 }] }] });
  assert.equal(invalidFeaturePath.debug.enabled, false);
  assert.equal(invalidFeaturePath.sample(singleLieLayer(0)), 0);

  const decreasing = structuredClone(productionFeatures);
  const startY = midpointAt(decreasing, 0);
  for (const eye of decreasing.liedown.at(-1).eyes) eye.y = startY - 1;
  const decreasingPath = createPosturePath(decreasing);
  assert.equal(decreasingPath.debug.reason, 'invalid-endpoints');
  assert.equal(decreasingPath.sample(singleLieLayer(47)), 0);

  const overLimit = structuredClone(productionFeatures);
  for (const eye of overLimit.liedown[44].eyes) eye.y += 60;
  const overLimitPath = createPosturePath(overLimit);
  assert.equal(overLimitPath.debug.reason, 'correction-limit');
  assert.equal(overLimitPath.sample(singleLieLayer(44)), 0);
});
