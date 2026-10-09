const MAX_CORRECTION_PX = 20;
const DENSE_VALIDATION_STEPS = 4096;
const REFERENCE_KNOTS = [0, 8, 20, 30, 47];

function disabledPath(reason) {
  return Object.freeze({
    sample: () => 0,
    debug: Object.freeze({ enabled: false, reason, maxCorrectionPx: 0, knots: [] }),
  });
}

function readMidpointYs(features) {
  const frames = features?.liedown;
  if (!Array.isArray(frames) || frames.length < 2) return null;

  const midpointYs = [];
  for (const frame of frames) {
    const eyes = frame?.eyes;
    if (!Array.isArray(eyes) || eyes.length !== 2
      || eyes.some(eye => !Number.isFinite(eye?.x) || !Number.isFinite(eye?.y))) return null;
    midpointYs.push((eyes[0].y + eyes[1].y) / 2);
  }
  return midpointYs.every(Number.isFinite) ? midpointYs : null;
}

function makeKnots(midpointYs) {
  const last = midpointYs.length - 1;
  const indices = [...new Set(REFERENCE_KNOTS.map(reference =>
    reference === 47 ? last : Math.round(reference * last / 47)))];
  if (indices[0] !== 0) indices.unshift(0);
  if (indices.at(-1) !== last) indices.push(last);
  return indices.map(index => ({ x: index, y: midpointYs[index] }));
}

function monotoneTangents(knots) {
  const count = knots.length;
  const secants = [];
  const widths = [];
  for (let index = 0; index < count - 1; index += 1) {
    const width = knots[index + 1].x - knots[index].x;
    widths.push(width);
    secants.push((knots[index + 1].y - knots[index].y) / width);
  }

  const tangents = Array(count).fill(0);
  // A weighted harmonic mean gives a monotone PCHIP slope where both adjacent
  // secants rise. Zero slopes at the ends keep the path C1 and stationary there.
  for (let index = 1; index < count - 1; index += 1) {
    const before = secants[index - 1];
    const after = secants[index];
    if (before <= 0 || after <= 0) continue;
    const hBefore = widths[index - 1];
    const hAfter = widths[index];
    const wBefore = 2 * hAfter + hBefore;
    const wAfter = hAfter + 2 * hBefore;
    tangents[index] = (wBefore + wAfter) / (wBefore / before + wAfter / after);
  }

  // Apply the Fritsch-Carlson circle limiter per segment. It can only reduce
  // shared knot slopes, so neighboring segments retain the same C1 derivative.
  for (let index = 0; index < count - 1; index += 1) {
    const secant = secants[index];
    if (secant <= 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const alpha = tangents[index] / secant;
    const beta = tangents[index + 1] / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * alpha * secant;
      tangents[index + 1] = scale * beta * secant;
    }
  }
  return tangents;
}

function splineAt(position, knots, tangents) {
  const lastKnot = knots.length - 1;
  if (position <= knots[0].x) return knots[0].y;
  if (position >= knots[lastKnot].x) return knots[lastKnot].y;

  let segment = 0;
  while (position > knots[segment + 1].x) segment += 1;
  const start = knots[segment];
  const end = knots[segment + 1];
  const width = end.x - start.x;
  const t = (position - start.x) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * start.y
    + (t3 - 2 * t2 + t) * width * tangents[segment]
    + (-2 * t3 + 3 * t2) * end.y
    + (t3 - t2) * width * tangents[segment + 1];
}

function actualAt(position, midpointYs) {
  const last = midpointYs.length - 1;
  const lower = Math.floor(position);
  const upper = Math.min(last, lower + 1);
  const fraction = position - lower;
  return midpointYs[lower] + (midpointYs[upper] - midpointYs[lower]) * fraction;
}

/**
 * Build a fixed, monotone C1 lift path from the lying atlas landmarks.
 * The returned lift is in canonical 384px painter coordinates and is zero
 * for all non-liedown layers.
 */
export function createPosturePath(features) {
  const midpointYs = readMidpointYs(features);
  if (!midpointYs) return disabledPath('invalid-features');

  const knots = makeKnots(midpointYs);
  if (!(knots.at(-1).y > knots[0].y)) return disabledPath('invalid-endpoints');
  for (let index = 1; index < knots.length; index += 1) {
    if (knots[index].y < knots[index - 1].y) return disabledPath('non-monotone-knots');
  }

  const tangents = monotoneTangents(knots);
  let maxCorrectionPx = 0;
  let previousDesired = -Infinity;
  for (let step = 0; step <= DENSE_VALIDATION_STEPS; step += 1) {
    const position = (midpointYs.length - 1) * step / DENSE_VALIDATION_STEPS;
    const desired = splineAt(position, knots, tangents);
    if (desired < previousDesired - 1e-8) return disabledPath('non-monotone-path');
    previousDesired = desired;
    maxCorrectionPx = Math.max(maxCorrectionPx, Math.abs(actualAt(position, midpointYs) - desired));
  }
  // Include every authored frame exactly as runtime emits adjacent integer layers.
  for (let index = 0; index < midpointYs.length; index += 1) {
    maxCorrectionPx = Math.max(maxCorrectionPx,
      Math.abs(midpointYs[index] - splineAt(index, knots, tangents)));
  }
  // Disable the whole path when it would exceed the design limit. Clamping a
  // spline locally could reintroduce a reversal in the corrected trajectory.
  if (maxCorrectionPx >= MAX_CORRECTION_PX) return disabledPath('correction-limit');

  const last = midpointYs.length - 1;
  const clampOnsetPx = Math.max(18, maxCorrectionPx + (MAX_CORRECTION_PX - maxCorrectionPx) * 0.1);
  const clampShoulderWidthPx = 2 * (MAX_CORRECTION_PX - clampOnsetPx);
  const sample = layers => {
    if (!Array.isArray(layers)) return 0;
    let totalWeight = 0;
    let lieWeight = 0;
    let weightedActualY = 0;
    let weightedIndex = 0;
    for (const layer of layers) {
      if (!layer || !Number.isFinite(layer.weight) || layer.weight < 0 || layer.weight > 1) return 0;
      if (layer.weight === 0) continue;
      if (typeof layer.atlas !== 'string') return 0;
      totalWeight += layer.weight;
      if (layer.atlas !== 'liedown') continue;
      if (!Number.isFinite(layer.index) || layer.index < 0 || layer.index > last) return 0;
      lieWeight += layer.weight;
      weightedActualY += layer.weight * actualAt(layer.index, midpointYs);
      weightedIndex += layer.weight * layer.index;
    }
    if (!(totalWeight > 0) || !Number.isFinite(totalWeight) || !Number.isFinite(lieWeight)
      || !Number.isFinite(weightedActualY) || !Number.isFinite(weightedIndex)) return 0;
    if (lieWeight === 0) return 0;
    const meanIndex = Math.min(last, Math.max(0, weightedIndex / lieWeight));
    const correction = (weightedActualY - lieWeight * splineAt(meanIndex, knots, tangents)) / totalWeight;
    if (!Number.isFinite(correction)) return 0;
    // The authored adjacent-frame path has already passed the 20px construction
    // check, so it never reaches this clamp. Valid blends spanning distant frames
    // can exceed the bound because the spline is nonlinear. This C1 shoulder
    // preserves the raw value through onset, then eases its derivative to zero
    // at 20px instead of introducing a kink or weight discontinuity.
    const magnitude = Math.abs(correction);
    if (magnitude <= clampOnsetPx) return correction;
    const shoulder = Math.min(clampShoulderWidthPx, magnitude - clampOnsetPx);
    const boundedMagnitude = clampOnsetPx + shoulder - shoulder * shoulder / (2 * clampShoulderWidthPx);
    return Math.sign(correction) * boundedMagnitude;
  };

  return Object.freeze({
    sample,
    debug: Object.freeze({
      enabled: true,
      reason: null,
      maxCorrectionPx,
      knots: knots.map(({ x, y }) => Object.freeze({ index: x, midpointY: y })),
    }),
  });
}
