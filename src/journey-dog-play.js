const PLAY_SPECS = Object.freeze({
  bed: Object.freeze({ kind: 'bed', durationMs: 2_400 }),
  starterBall: Object.freeze({ kind: 'ball', durationMs: 5_600 }),
  plush: Object.freeze({ kind: 'plush', durationMs: 4_300 }),
  rope: Object.freeze({ kind: 'rope', durationMs: 3_800 }),
});

const DISCOVERY_KINDS = Object.freeze({
  scent: 'scent', animal: 'animal', water: 'water', light: 'light', object: 'object',
  plant: 'object', detail: 'light', landmark: 'light', sound: 'animal',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const playSpec = itemId => Object.hasOwn(PLAY_SPECS, itemId) ? PLAY_SPECS[itemId] : null;
const discoveryKind = kind => Object.hasOwn(DISCOVERY_KINDS, kind) ? DISCOVERY_KINDS[kind] : null;
const smooth = value => {
  const t = clamp(finiteOr(value), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (from, to, amount) => from + (to - from) * smooth(amount);

function interval(age, start, end) {
  return smooth((age - start) / Math.max(Number.EPSILON, end - start));
}

/** Create a deterministic, bounded home-play action. Times use the renderer's home clock. */
export function createJourneyDogPlay(itemId, startedAt, options = {}) {
  const spec = playSpec(itemId);
  if (!spec) return null;
  const startDogOffset = options && typeof options === 'object' ? options.startDogOffset : 0;
  return {
    itemId,
    kind: spec.kind,
    startedAt: Math.max(0, finiteOr(startedAt)),
    durationMs: spec.durationMs,
    startDogOffset: clamp(finiteOr(startDogOffset), -.55, .55),
    status: 'running',
  };
}

function idleSample(play, progress, phase, dogOffset, itemId = play?.itemId) {
  const spec = playSpec(itemId);
  return {
    itemId: spec ? itemId : null,
    kind: spec?.kind ?? 'idle',
    progress: clamp(finiteOr(progress), 0, 1),
    phase,
    active: false,
    dogOffset: clamp(finiteOr(dogOffset), -.55, .55),
    dogLean: 0,
    pawAdjust: 0,
    bodyShift: 0,
    headAngle: 0,
    headLift: 0,
    headRest: 0,
    eyeRest: 0,
    gazeX: 0,
    earLeft: 0,
    earRight: 0,
    propMode: 'slot',
    propOffsetX: 0,
    propLift: 0,
    propRotation: 0,
    carryOffsetX: .015,
    // The front sprite's muzzle sits around the lower half of the head.
    // Keeping carried toys at .68 puts them across the eyes on phone-sized
    // canvases; .54 lands the toy at the visible mouth/tongue instead.
    carryOffsetY: .54,
    attached: false,
  };
}

function finalizeSample(sample) {
  sample.attached = sample.propMode === 'carried';
  return sample;
}

/**
 * Sample a home action from absolute time. Positions are fractions of the
 * existing dog size; renderers can scale them to any supported viewport.
 * `toyOffset` is the equipped toy slot center relative to the dog's home X.
 */
export function sampleJourneyDogPlay(play, timeMs, options = {}) {
  const spec = playSpec(play?.itemId);
  const safeOptions = options && typeof options === 'object' ? options : {};
  const toyOffset = safeOptions.toyOffset;
  const reducedMotion = Boolean(safeOptions.reducedMotion);
  const startedAt = finiteOr(play?.startedAt);
  const durationMs = spec?.durationMs ?? 1;
  const age = Math.max(0, finiteOr(timeMs) - startedAt);
  const progress = clamp(age / durationMs, 0, 1);
  const from = clamp(finiteOr(play?.startDogOffset), -.55, .55);
  const slotOffset = clamp(finiteOr(toyOffset, .55), -.8, .8);
  const result = idleSample(play, progress, 'settled', from);
  result.active = Boolean(spec) && age < durationMs && !reducedMotion;

  if (!spec) return finalizeSample(result);
  if (reducedMotion) {
    result.phase = 'reduced-motion';
    result.headRest = play.itemId === 'bed' || play.itemId === 'plush' ? .82 : 0;
    result.eyeRest = play.itemId === 'bed' || play.itemId === 'plush' ? .86 : 0;
    result.gazeX = play.itemId === 'starterBall' ? .24 : 0;
    result.progress = 1;
    return finalizeSample(result);
  }

  const reach = clamp(slotOffset - .8, -.55, .55);

  if (play.itemId === 'bed') {
    result.phase = progress >= 1 ? 'settled' : 'settling';
    result.dogOffset = mix(from, 0, progress);
    result.bodyShift = .10 * interval(progress, 0, .65);
    result.headRest = .82 * progress;
    result.eyeRest = .86 * progress;
    return finalizeSample(result);
  }

  if (play.itemId === 'plush') {
    const approachEnd = .24, sniffEnd = .46;
    // The toy sits beyond the dog's touch target near the edge of a portrait
    // canvas. Keep the dog's broad photo silhouette in-frame while it leans
    // toward the plush; the larger offset clips the tail on phone widths.
    const restOffset = clamp(slotOffset - .22, -.12, .15);
    result.phase = progress < approachEnd ? 'approach' : progress < sniffEnd ? 'sniff' : progress < 1 ? 'rest' : 'settled';
    result.dogOffset = progress < approachEnd
      ? mix(from, restOffset, progress / approachEnd)
      : restOffset;
    result.gazeX = .30 * (progress < .76 ? 1 : 1 - interval(progress, .76, 1));
    result.headAngle = -.014 * interval(progress, .15, .34);
    result.headLift = -.4 * interval(progress, .22, .42);
    result.headRest = progress < sniffEnd ? .16 * interval(progress, approachEnd, sniffEnd) : mix(.16, .82, (progress - sniffEnd) / (1 - sniffEnd));
    result.eyeRest = progress < sniffEnd ? 0 : .86 * interval(progress, sniffEnd, 1);
    result.earLeft = .12 * (1 - interval(progress, .25, .65));
    result.earRight = .18 * (1 - interval(progress, .25, .65));
    return finalizeSample(result);
  }

  if (play.itemId === 'starterBall') {
    const anticipationEnd = .10, rollEnd = .27, chaseEnd = .49, pickupEnd = .57, returnEnd = .81, releaseEnd = .93;
    const launchOffset = -.8;
    const mouthCatch = clamp(reach, -.55, .55);
    if (progress < anticipationEnd) {
      result.phase = 'anticipate';
      result.dogOffset = mix(from, from + .035, progress / anticipationEnd);
      result.gazeX = .34 * interval(progress, 0, .08);
      result.headAngle = .012 * interval(progress, 0, .09);
      result.earLeft = .08 * interval(progress, .01, .09);
      result.earRight = .13 * interval(progress, .01, .09);
    } else if (progress < rollEnd) {
      const t = (progress - anticipationEnd) / (rollEnd - anticipationEnd);
      result.phase = 'roll';
      result.dogOffset = mix(from + .035, from + .09, t);
      result.propMode = 'offset';
      result.propOffsetX = launchOffset * smooth(t);
      result.propLift = .014 * Math.sin(t * Math.PI);
      result.propRotation = -2.8 * t;
      result.gazeX = .32;
      result.headAngle = .012;
      result.pawAdjust = .22 * Math.sin(t * Math.PI);
    } else if (progress < chaseEnd) {
      const t = (progress - rollEnd) / (chaseEnd - rollEnd);
      result.phase = 'chase';
      result.dogOffset = mix(from + .09, mouthCatch, t);
      result.propMode = 'offset';
      result.propOffsetX = launchOffset;
      result.propRotation = -2.8 - 1.2 * t;
      result.pawAdjust = .62 * Math.sin(t * Math.PI);
      result.bodyShift = -.28 * Math.sin(t * Math.PI);
      result.dogLean = -.035 * Math.sin(t * Math.PI);
      result.gazeX = .22 * (1 - t) - .12 * t;
      result.headLift = .4 * Math.sin(t * Math.PI);
    } else if (progress < pickupEnd) {
      const t = (progress - chaseEnd) / (pickupEnd - chaseEnd);
      result.phase = 'pickup';
      result.dogOffset = mouthCatch;
      result.propMode = t < .99 ? 'offset' : 'carried';
      result.propOffsetX = launchOffset;
      result.propLift = interval(t, 0, 1);
      result.propRotation = mix(-4, 0, t);
      result.pawAdjust = .25 * (1 - t);
      result.headLift = -.35 * interval(t, .15, .8);
      result.headRest = .12 * interval(t, .2, .8);
    } else if (progress < returnEnd) {
      const t = (progress - pickupEnd) / (returnEnd - pickupEnd);
      result.phase = 'return';
      result.dogOffset = mix(mouthCatch, from, t);
      result.propMode = 'carried';
      result.pawAdjust = .30 * Math.sin(t * Math.PI * 3) * (1 - t);
      result.bodyShift = .18 * Math.sin(t * Math.PI * 2) * (1 - t);
      result.headLift = -.22 * (1 - t);
      result.gazeX = -.08 * (1 - t);
    } else if (progress < releaseEnd) {
      const t = (progress - returnEnd) / (releaseEnd - returnEnd);
      result.phase = 'release';
      result.dogOffset = from;
      result.propMode = 'offset';
      const attachedOffsetFromSlot = from + result.carryOffsetX - slotOffset;
      result.propOffsetX = mix(attachedOffsetFromSlot, 0, t);
      result.propLift = 1 - smooth(t);
      result.propRotation = 0;
      result.headRest = .08 * Math.sin(t * Math.PI);
      result.gazeX = -.12 * Math.sin(t * Math.PI);
    } else {
      result.phase = progress < 1 ? 'settle' : 'settled';
      result.dogOffset = from;
    }
    return finalizeSample(result);
  }

  if (play.itemId === 'rope') {
    const approachEnd = .20, grabEnd = .32, tugEnd = .75, releaseEnd = .9;
    // The right-hand toy slot is close to the viewport edge in portrait.
    // Keep the photo dog inside the canvas while the rope itself travels to
    // the mouth; the previous .36 cap clipped its tail during the tug.
    const tugOffset = clamp(slotOffset - .32, -.30, .15);
    const tugWave = Math.sin(((progress - grabEnd) / (tugEnd - grabEnd)) * Math.PI * 2 * 4);
    if (progress < approachEnd) {
      result.phase = 'approach';
      result.dogOffset = mix(from, tugOffset, progress / approachEnd);
      result.gazeX = .22;
      result.headAngle = -.01 * interval(progress, 0, approachEnd);
      result.pawAdjust = .12 * Math.sin(progress / approachEnd * Math.PI);
    } else if (progress < grabEnd) {
      const t = (progress - approachEnd) / (grabEnd - approachEnd);
      result.phase = 'grab';
      result.dogOffset = tugOffset;
      result.propMode = 'offset';
      result.propOffsetX = (tugOffset + result.carryOffsetX - slotOffset) * smooth(t);
      result.propLift = smooth(t);
      result.propRotation = .12 * (1 - smooth(t));
      result.headLift = -.22 * t;
      result.gazeX = .16;
    } else if (progress < tugEnd) {
      const t = (progress - grabEnd) / (tugEnd - grabEnd);
      result.phase = 'tug';
      result.dogOffset = tugOffset + .035 * tugWave;
      result.propMode = 'carried';
      result.carryOffsetX = .015 + .09 * tugWave;
      result.carryOffsetY = .54 + .025 * Math.abs(tugWave);
      result.propRotation = .28 * tugWave;
      result.pawAdjust = .18 * Math.abs(tugWave);
      result.bodyShift = .16 * tugWave;
      result.headLift = -.18 + .08 * Math.abs(tugWave);
      result.gazeX = .12;
      result.dogLean = .016 * tugWave;
    } else if (progress < releaseEnd) {
      const t = (progress - tugEnd) / (releaseEnd - tugEnd);
      result.phase = 'release';
      result.dogOffset = mix(tugOffset, from, t);
      result.propMode = 'offset';
      const attachedOffsetFromSlot = tugOffset + result.carryOffsetX - slotOffset;
      result.propOffsetX = mix(attachedOffsetFromSlot, 0, t);
      result.propRotation = 0;
      result.propLift = 1 - smooth(t);
      result.gazeX = .12 * (1 - t);
    } else {
      result.phase = progress < 1 ? 'settle' : 'settled';
      result.dogOffset = from;
    }
    return finalizeSample(result);
  }

  return finalizeSample(result);
}

/** Start a short, target-specific response to a walk discovery. */
export function createJourneyDiscoveryReaction(discovery, startedAt = 0) {
  const kind = discoveryKind(discovery?.kind);
  if (!kind || typeof discovery?.id !== 'string' || !discovery.id) return null;
  return {
    id: discovery.id,
    sourceKind: discovery.kind,
    kind,
    lane: clamp(finiteOr(discovery.lane), -1, 1),
    startedAt: Math.max(0, finiteOr(startedAt)),
    durationMs: kind === 'scent' ? 2_200 : 1_900,
  };
}

/** Pure finite response channels for the existing runner/home dog renderer. */
export function sampleJourneyDiscoveryReaction(reaction, timeMs, options = {}) {
  const reducedMotion = Boolean(options && typeof options === 'object' && options.reducedMotion);
  const durationMs = Math.max(1, finiteOr(reaction?.durationMs, 1_900));
  const age = Math.max(0, finiteOr(timeMs) - finiteOr(reaction?.startedAt));
  const progress = reducedMotion ? 1 : clamp(age / durationMs, 0, 1);
  const envelope = reducedMotion ? 1 : Math.sin(Math.PI * progress) ** 1.2;
  const kind = discoveryKind(reaction?.kind) ?? discoveryKind(reaction?.sourceKind) ?? 'object';
  const direction = Math.sign(finiteOr(reaction?.lane));
  const sample = {
    id: typeof reaction?.id === 'string' ? reaction.id : null,
    kind,
    progress,
    active: Boolean(reaction?.id) && (reducedMotion || age < durationMs),
    headLift: 0,
    headRest: 0,
    headAngle: 0,
    gazeX: 0,
    earLeft: 0,
    earRight: 0,
    bodyShift: 0,
    pawAdjust: 0,
    step: 0,
    turn: 0,
  };
  if (!sample.active) return sample;

  sample.turn = direction * .032 * envelope;
  sample.gazeX = direction * .34 * envelope;
  if (kind === 'scent') {
    sample.headRest = .22 * envelope;
    sample.headAngle = .014 * envelope;
    sample.pawAdjust = .12 * envelope;
    sample.step = .05 * envelope;
  } else if (kind === 'animal') {
    sample.headLift = .9 * envelope;
    sample.earLeft = .25 * envelope;
    sample.earRight = .34 * envelope;
    sample.step = .12 * envelope;
  } else if (kind === 'water') {
    sample.headAngle = -.012 * envelope;
    sample.headLift = .25 * envelope;
    sample.pawAdjust = .22 * envelope;
    sample.step = .18 * envelope;
  } else if (kind === 'light') {
    sample.headLift = 1.8 * envelope;
    sample.earLeft = .17 * envelope;
    sample.earRight = .17 * envelope;
  } else {
    sample.headRest = .10 * envelope;
    sample.headLift = .3 * envelope;
    sample.pawAdjust = .16 * envelope;
    sample.step = .10 * envelope;
  }
  sample.bodyShift = sample.step * (direction || 1);
  return sample;
}
