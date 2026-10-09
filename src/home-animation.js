const DEFAULT_DURATION_MS = 4_000;
const TAU = Math.PI * 2;

const clamp01 = value => Math.max(0, Math.min(1, value));

/** A C2 ease with zero velocity and acceleration at both ends. */
function easeQuint(value) {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function easeQuintDerivative(value) {
  const t = clamp01(value);
  return 30 * t * t * (1 - t) * (1 - t);
}

function normalizedTime(elapsedMs, durationMs) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const duration = Number.isFinite(durationMs) && durationMs > 0
    ? Math.max(1, durationMs)
    : DEFAULT_DURATION_MS;
  return { elapsed, duration, progress: clamp01(elapsed / duration) };
}

function cyclePhase(elapsed, periodMs) {
  return TAU * ((elapsed % periodMs) / periodMs);
}

function finiteActionBlend(progress) {
  const enter = easeQuint(progress / 0.1);
  const leave = 1 - easeQuint((progress - 0.9) / 0.1);
  return enter * leave;
}

function phaseAt(progress, phases) {
  const index = phases.findIndex((phase, phaseIndex) =>
    progress < phase.to || phaseIndex === phases.length - 1,
  );
  const phase = phases[Math.max(0, index)];
  const local = clamp01((progress - phase.from) / (phase.to - phase.from));
  // Let the pose blend settle at each hand-off instead of popping between keys.
  const edge = 0.12;
  const blendIn = easeQuint(local / edge);
  const blendOut = 1 - easeQuint((local - (1 - edge)) / edge);
  return { key: phase.key, local, transition: blendIn * blendOut };
}

function hiddenToy() {
  return { x: 0, y: 0, visible: false, held: false, type: null };
}

function idleResult() {
  return {
    rootOffsetX: 0,
    rootOffsetY: 0,
    facing: 'front',
    direction: 0,
    gaitDistance: 0,
    gaitSpeed: 0,
    headNod: 0,
    tailWag: 0,
    poseKey: 'idle',
    transition: 0,
    toy: hiddenToy(),
  };
}

const FETCH_PHASES = Object.freeze([
  Object.freeze({ from: 0, to: 0.12, key: 'windup' }),
  Object.freeze({ from: 0.12, to: 0.34, key: 'throw' }),
  Object.freeze({ from: 0.34, to: 0.66, key: 'chase' }),
  Object.freeze({ from: 0.66, to: 0.74, key: 'pickup' }),
  Object.freeze({ from: 0.74, to: 1, key: 'return' }),
]);

const FEED_PHASES = Object.freeze([
  Object.freeze({ from: 0, to: 0.22, key: 'sniff' }),
  Object.freeze({ from: 0.22, to: 0.8, key: 'eat' }),
  Object.freeze({ from: 0.8, to: 1, key: 'lick' }),
]);

function resolveFetch({ toyId, elapsed, duration, progress, reducedMotion }) {
  const family = toyId === 'frisbee' ? 'frisbee' : 'ball';
  const phase = phaseAt(progress, FETCH_PHASES);
  const reach = family === 'frisbee' ? 1.2 : 0.96;
  const launchX = 0.3;
  const groundY = 0.1;
  const mouthY = 0.43;
  const rootScale = reducedMotion ? 0 : 1;
  const durationSeconds = duration / 1_000;

  let rootPathX = 0;
  let routeDistance = 0;
  let gaitSpeed = 0;
  let routeSpeedFactor = 0;
  let direction = 1;

  if (progress >= 0.34 && progress < 0.66) {
    const local = (progress - 0.34) / 0.32;
    const eased = easeQuint(local);
    const derivative = easeQuintDerivative(local);
    rootPathX = reach * eased;
    routeDistance = reach * eased;
    gaitSpeed = reach * derivative / (durationSeconds * 0.32);
    routeSpeedFactor = derivative / 1.875;
  } else if (progress >= 0.66 && progress < 0.74) {
    rootPathX = reach;
    routeDistance = reach;
  } else if (progress >= 0.74) {
    const local = (progress - 0.74) / 0.26;
    const eased = easeQuint(local);
    const derivative = easeQuintDerivative(local);
    rootPathX = reach * (1 - eased);
    routeDistance = reach + reach * eased;
    gaitSpeed = reach * derivative / (durationSeconds * 0.26);
    routeSpeedFactor = derivative / 1.875;
    direction = -1;
  }

  const rootOffsetX = rootPathX * rootScale;
  const gaitDistance = routeDistance * rootScale;
  if (reducedMotion) gaitSpeed = 0;
  const stepPhase = TAU * routeDistance / reach;
  const rootOffsetY = reducedMotion
    ? 0
    : 0.045 * (0.5 - 0.5 * Math.cos(stepPhase)) * clamp01(routeSpeedFactor);

  let toy;
  if (progress < 0.12) {
    toy = { x: launchX, y: mouthY, visible: true, held: true, type: toyId };
  } else if (progress < 0.34) {
    const local = (progress - 0.12) / 0.22;
    const eased = easeQuint(local);
    toy = {
      x: launchX + (reach - launchX) * eased,
      y: mouthY + (groundY - mouthY) * eased + 0.5 * 16 * local * local * (1 - local) * (1 - local),
      visible: true,
      held: false,
      type: toyId,
    };
  } else if (progress < 0.66) {
    toy = { x: reach, y: groundY, visible: true, held: false, type: toyId };
  } else if (progress < 0.74) {
    const local = (progress - 0.66) / 0.08;
    const eased = easeQuint(local);
    toy = {
      x: reach + (rootPathX + launchX - reach) * eased,
      y: groundY + (mouthY - groundY) * eased,
      visible: true,
      held: false,
      type: toyId,
    };
  } else {
    toy = { x: rootPathX + launchX, y: mouthY, visible: true, held: true, type: toyId };
  }

  let headNod = 0;
  if (progress < 0.12) {
    headNod = -0.16 * easeQuint(progress / 0.12);
  } else if (progress < 0.34) {
    headNod = -0.16 * (1 - easeQuint((progress - 0.12) / 0.22));
  } else if (progress < 0.66) {
    headNod = 0.055 * Math.sin(stepPhase);
  } else if (progress < 0.74) {
    headNod = -0.2 * Math.sin(Math.PI * easeQuint((progress - 0.66) / 0.08));
  } else {
    headNod = 0.035 * Math.sin(stepPhase);
  }

  return {
    rootOffsetX,
    rootOffsetY,
    facing: 'side',
    direction,
    gaitDistance,
    gaitSpeed,
    headNod: headNod * (reducedMotion ? 0.55 : 1),
    tailWag: 0.58 * Math.sin(cyclePhase(elapsed, 420)),
    poseKey: `play-${family}-${phase.key}`,
    transition: phase.transition,
    toy,
  };
}

function resolveRope({ elapsed, progress, reducedMotion }) {
  const transition = finiteActionBlend(progress);
  const tugPhase = TAU * 2 * progress;
  const expressiveScale = reducedMotion ? 0.55 : 1;
  const rootOffsetX = 0.07 * Math.sin(tugPhase) * transition;
  const rootOffsetY = 0.018 * (1 - Math.cos(tugPhase)) * transition;
  return {
    rootOffsetX,
    rootOffsetY,
    facing: 'side',
    direction: -1,
    gaitDistance: 0,
    gaitSpeed: 0,
    headNod: 0.16 * Math.sin(tugPhase) * expressiveScale,
    tailWag: 0.48 * Math.sin(TAU * 3 * progress) * expressiveScale,
    poseKey: 'play-rope-tug',
    transition,
    toy: {
      x: rootOffsetX - 0.34 - 0.1 * (0.5 - 0.5 * Math.cos(tugPhase)),
      y: rootOffsetY + 0.13 + 0.035 * Math.sin(tugPhase),
      visible: true,
      held: true,
      type: 'rope',
    },
  };
}

function resolvePlush({ elapsed, progress, reducedMotion }) {
  const transition = finiteActionBlend(progress);
  const expressiveScale = reducedMotion ? 0.55 : 1;
  const cradle = easeQuint(progress / 0.18) * (1 - easeQuint((progress - 0.84) / 0.16));
  const rootOffsetX = 0.018 * Math.sin(cyclePhase(elapsed, 2_400)) * transition;
  const rootOffsetY = -0.12 * cradle;
  return {
    rootOffsetX,
    rootOffsetY,
    facing: 'front',
    direction: 0,
    gaitDistance: 0,
    gaitSpeed: 0,
    headNod: 0.045 * Math.sin(cyclePhase(elapsed, 1_900)) * expressiveScale,
    tailWag: 0.12 * Math.sin(cyclePhase(elapsed, 1_200)) * expressiveScale,
    poseKey: 'play-plush-cuddle',
    transition,
    toy: {
      x: rootOffsetX + 0.22,
      y: rootOffsetY + 0.16,
      visible: true,
      held: true,
      type: 'plush',
    },
  };
}

function resolveFeed({ elapsed, progress, reducedMotion }) {
  const phase = phaseAt(progress, FEED_PHASES);
  let headNod;
  if (progress < 0.22) {
    headNod = -0.2 * easeQuint(progress / 0.22);
  } else if (progress < 0.8) {
    const local = (progress - 0.22) / 0.58;
    headNod = -0.2 + 0.045 * Math.sin(TAU * 3 * local);
  } else {
    const local = (progress - 0.8) / 0.2;
    headNod = -0.2 + 0.32 * easeQuint(local);
  }
  const expressiveScale = reducedMotion ? 0.55 : 1;
  return {
    rootOffsetX: 0,
    rootOffsetY: 0,
    facing: 'front',
    direction: 0,
    gaitDistance: 0,
    gaitSpeed: 0,
    headNod: headNod * expressiveScale,
    tailWag: 0.13 * Math.sin(cyclePhase(elapsed, 700)) * expressiveScale,
    poseKey: `feed-${phase.key}`,
    transition: phase.transition,
    toy: hiddenToy(),
  };
}

function resolveRest({ kind, elapsed, duration, reducedMotion }) {
  const settlingMs = Math.min(900, duration * 0.2);
  const transition = easeQuint(elapsed / settlingMs);
  const expressiveScale = reducedMotion ? 0.5 : 1;
  const breath = kind === 'sleep' ? 3_100 : 2_500;
  return {
    rootOffsetX: 0,
    rootOffsetY: -0.1 * transition,
    facing: 'front',
    direction: 0,
    gaitDistance: 0,
    gaitSpeed: 0,
    headNod: 0.018 * Math.sin(cyclePhase(elapsed, breath)) * expressiveScale,
    tailWag: 0.025 * Math.sin(cyclePhase(elapsed, breath * 1.4)) * expressiveScale,
    poseKey: kind === 'sleep' ? 'sleep-lie' : 'rest-lie',
    transition,
    toy: hiddenToy(),
  };
}

/**
 * Resolve an action from absolute elapsed time so rendering cadence cannot change it.
 * Coordinates use standing-dog-height units: x is right, y is up, and the idle anchor is (0, 0).
 * Toy coordinates share that idle-anchor space, so a held toy already includes the dog's root offset.
 * `transition` blends the active pose key; `headNod` and `tailWag` are signed normalized offsets.
 * The caller freezes elapsedMs while paused or hidden; this function owns no clock or save state.
 */
export function resolveHomeAction({
  kind = 'idle',
  toyId = 'starterBall',
  elapsedMs = 0,
  durationMs = DEFAULT_DURATION_MS,
  reducedMotion = false,
} = {}) {
  const { elapsed, duration, progress } = normalizedTime(elapsedMs, durationMs);
  const reduced = reducedMotion === true;

  if (kind === 'play') {
    const resolvedToyId = typeof toyId === 'string' && toyId.length > 0 ? toyId : 'starterBall';
    if (resolvedToyId === 'rope') {
      return resolveRope({ elapsed, progress, reducedMotion: reduced });
    }
    if (resolvedToyId === 'plush') {
      return resolvePlush({ elapsed, progress, reducedMotion: reduced });
    }
    return resolveFetch({
      toyId: resolvedToyId,
      elapsed,
      duration,
      progress,
      reducedMotion: reduced,
    });
  }
  if (kind === 'feed') return resolveFeed({ elapsed, progress, reducedMotion: reduced });
  if (kind === 'rest' || kind === 'sleep') {
    return resolveRest({ kind, elapsed, duration, reducedMotion: reduced });
  }
  return idleResult();
}
