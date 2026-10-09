const TAU = Math.PI * 2;
const BREATH_PERIOD_MS = 4_800;
const WALK_STRIDE_LENGTH = 0.52;
const RUN_STRIDE_LENGTH = 0.76;
const STANCE_RATIO = Object.freeze({ walk: 0.64, run: 0.52 });
const GAIT_BLEND_SPEED = 0.95;
const FOOT_LANDMARKS = Object.freeze({ left: 0.25, right: 0.75, y: 1 });

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

export const DOG_RIG_DIAGNOSTICS = Object.freeze({
  status: 'prototype',
  landmarks: 'estimated-from-back-idle-crop; source metadata has no bodyLandmarks or contactFeet',
  gaitCalibration: 'provisional world units per cycle; not measured from a final authored clip',
  artReview: 'pending',
  grid: Object.freeze({ columns: 8, rows: 12 }),
  trianglesPerFrame: 8 * 12 * 2,
});

export const DOG_GAIT = Object.freeze({
  walkStrideLength: WALK_STRIDE_LENGTH,
  runStrideLength: RUN_STRIDE_LENGTH,
  stanceRatio: STANCE_RATIO,
  blendSpeed: GAIT_BLEND_SPEED,
});

function footState(phase, gait, gaitWeight) {
  if (!gait || gaitWeight <= 0) {
    return Object.freeze({ phase: 0, stance: true, swing: 0, lift: 0, weight: 0 });
  }
  const stanceEnd = STANCE_RATIO[gait];
  const stance = phase < stanceEnd;
  const swing = stance ? 0 : clamp((phase - stanceEnd) / (1 - stanceEnd), 0, 1);
  const lift = stance ? 0 : Math.sin(Math.PI * swing) * (gait === 'run' ? 0.052 : 0.034);
  return Object.freeze({ phase, stance, swing, lift, weight: gaitWeight });
}

function resolveReaction(reaction, action, timeMs) {
  const implicitType = ['collect', 'gold', 'hit', 'headNod', 'tailWag'].includes(action) ? action : null;
  const input = typeof reaction === 'string' ? { type: reaction } : reaction;
  const type = input?.type ?? implicitType;
  if (!['collect', 'gold', 'hit', 'headNod', 'tailWag'].includes(type)) {
    return Object.freeze({ type: null, weight: 0, pulse: 0, elapsedMs: 0 });
  }
  const weight = clamp(finite(input?.weight, 1), 0, 1);
  const elapsedMs = Math.max(0, finite(input?.ageMs, timeMs));
  const duration = type === 'hit' ? 380 : type === 'gold' ? 520 : type === 'headNod' ? 760 : type === 'tailWag' ? 900 : 420;
  const pulse = type === 'tailWag'
    ? (input?.ageMs === undefined ? 1 : 1 - smoothstep(elapsedMs / duration)) * weight
    : Math.sin(Math.PI * clamp(elapsedMs / duration, 0, 1)) * weight;
  return Object.freeze({ type, weight, pulse, elapsedMs });
}

/**
 * Resolve a deterministic procedural pose. Translation phase is spatial:
 * `groundDistance / strideLength`, so a stopped or slowed course stops or
 * slows the paws even when frames continue to render.
 */
export function getDogAnimationPose({
  action = 'idle', timeMs = 0, groundDistance = 0, velocity = 0,
  moveLean = 0, headNod = 0, tailWag = 0, reducedMotion = false,
  reaction = null, view = 'back', rigMode = 'runner',
} = {}) {
  const now = Math.max(0, finite(timeMs));
  const distance = finite(groundDistance);
  const speed = Math.abs(finite(velocity));
  const requestedGait = action === 'walk' || action === 'run' ? action : null;
  const gait = requestedGait ?? (speed > 0.01 ? (speed >= 0.72 ? 'run' : 'walk') : null);
  const strideLength = gait === 'run' ? RUN_STRIDE_LENGTH : WALK_STRIDE_LENGTH;
  const gaitPhase = gait ? positiveModulo(distance / strideLength, 1) : 0;
  const motionWeight = gait ? smoothstep(speed / GAIT_BLEND_SPEED) : 0;
  const gaitWeight = motionWeight * (reducedMotion ? 0.58 : 1);
  const leftPhase = gaitPhase;
  const rightPhase = positiveModulo(gaitPhase + 0.5, 1);
  const breath = Math.sin(TAU * positiveModulo(now, BREATH_PERIOD_MS) / BREATH_PERIOD_MS)
    * (reducedMotion ? 0.48 : 1);
  const resolvedReaction = resolveReaction(reaction, action, now);

  return Object.freeze({
    action,
    timeMs: now,
    view,
    rigMode,
    gait,
    strideLength,
    groundDistance: distance,
    gaitPhase,
    gaitWeight,
    breath,
    moveLean: clamp(finite(moveLean), -1, 1),
    headNod: clamp(finite(headNod), -1, 1),
    tailWag: clamp(finite(tailWag), -1, 1),
    reducedMotion: Boolean(reducedMotion),
    reaction: resolvedReaction,
    feet: Object.freeze({
      left: footState(leftPhase, gait, gaitWeight),
      right: footState(rightPhase, gait, gaitWeight),
    }),
  });
}

/**
 * Stateful wrapper used by drawRigged. The first paused frame captures the
 * current procedural pose; subsequent calls return it unchanged until resume.
 */
export class DogAnimationController {
  constructor() {
    this.lastPose = null;
    this.pausedPose = null;
  }

  sample(args = {}) {
    if (args.paused) {
      if (!this.pausedPose) {
        this.pausedPose = this.lastPose ?? getDogAnimationPose(args);
      }
      return this.pausedPose;
    }
    this.pausedPose = null;
    this.lastPose = getDogAnimationPose(args);
    return this.lastPose;
  }

  reset() {
    this.lastPose = null;
    this.pausedPose = null;
  }
}

function region(value, center, radius) {
  return 1 - smoothstep(Math.abs(value - center) / radius);
}

function footForPosition(u, pose) {
  return Math.abs(u - FOOT_LANDMARKS.left) <= Math.abs(u - FOOT_LANDMARKS.right)
    ? { key: 'left', center: FOOT_LANDMARKS.left, state: pose.feet.left }
    : { key: 'right', center: FOOT_LANDMARKS.right, state: pose.feet.right };
}

/**
 * Sample the local CSS-pixel deformation field for a point in the idle crop.
 * The normalized coordinates are useful to map this same pose onto another
 * home-dog mesh; the current prototype landmarks are explicitly estimated.
 */
export function sampleDogDeformation(u, v, pose, size = 1, { view = pose.view ?? 'back', rigMode = pose.rigMode ?? 'runner' } = {}) {
  const x = clamp(finite(u), 0, 1), y = clamp(finite(v), 0, 1);
  const scale = Math.max(0, finite(size, 1));
  const torso = region(y, 0.56, 0.48);
  const upper = region(y, 0.28, 0.32);
  const breath = pose.breath;
  let dx = (x - 0.5) * breath * scale * 0.008 * torso;
  let dy = -breath * scale * 0.006 * torso;

  // A small chest settle and upper-body bob follow the same spatial gait.
  const gaitWave = Math.sin(TAU * pose.gaitPhase);
  const gaitLift = Math.abs(Math.sin(Math.PI * pose.gaitPhase * 2));
  dy += -gaitLift * pose.gaitWeight * scale * 0.009 * upper;
  dx += gaitWave * pose.gaitWeight * scale * 0.004 * (x - 0.5) * torso;

  // Lean is an upper-body shear; the crop's bottom edge remains the ground
  // reference so changing lane intent never drags a planted foot.
  const lean = pose.moveLean;
  dx += lean * scale * 0.045 * (1 - y) ** 1.3;
  dy += lean * (x - 0.5) * scale * 0.018 * torso;

  // The tail tuft is only an approximate control zone until art landmarks are
  // authored. Keep the motion small enough to avoid visible texture tearing.
  const tail = region(x, 0.48, 0.28) * region(y, 0.19, 0.20);
  dx += Math.sin(TAU * pose.gaitPhase + Math.PI / 2) * pose.gaitWeight * scale * 0.012 * tail;
  dx += Math.sin(TAU * finite(pose.groundDistance) / 0.44) * scale * 0.0025 * tail;

  const headCenterX = view === 'side' ? 0.78 : 0.5;
  const tailCenterX = view === 'side' ? 0.14 : 0.5;
  const headZone = region(x, headCenterX, 0.31) * region(y, 0.22, 0.26);
  const tailZone = region(x, tailCenterX, view === 'side' ? 0.26 : 0.31) * region(y, 0.24, 0.24);
  const microScale = pose.reducedMotion ? 0.55 : 1;
  if (pose.action === 'headNod' || pose.reaction.type === 'headNod') {
    const nodPhase = TAU * positiveModulo(pose.timeMs, 760) / 760;
    const weight = pose.action === 'headNod' ? 1 : pose.reaction.pulse;
    dy += Math.sin(nodPhase) * scale * 0.018 * headZone * weight * microScale;
    dx += Math.sin(nodPhase + Math.PI / 2) * scale * 0.009 * headZone * weight * microScale;
  }
  if (pose.action === 'tailWag' || pose.reaction.type === 'tailWag') {
    const wagPhase = TAU * positiveModulo(pose.timeMs, 300) / 300;
    const weight = pose.action === 'tailWag' ? 1 : pose.reaction.pulse;
    dx += Math.sin(wagPhase) * scale * 0.02 * tailZone * weight * microScale;
    dy += Math.cos(wagPhase * 2) * scale * 0.004 * tailZone * weight * microScale;
  }
  dy += pose.headNod * scale * 0.12 * headZone * microScale;
  dx += pose.tailWag * scale * 0.04 * tailZone * microScale;

  const reaction = pose.reaction;
  if (reaction.weight > 0 && reaction.pulse > 0) {
    const body = region(y, 0.52, 0.53);
    const head = region(y, 0.21, 0.24);
    if (reaction.type === 'collect' || reaction.type === 'gold') {
      dy -= reaction.pulse * scale * (reaction.type === 'gold' ? 0.017 : 0.011) * body;
      dx += Math.sin(reaction.elapsedMs / 120) * reaction.pulse * scale * 0.006 * head;
    } else if (reaction.type === 'hit') {
      const side = Math.sin(reaction.elapsedMs / 55) || 1;
      dx += side * reaction.pulse * scale * 0.014 * body;
      dy += reaction.pulse * scale * 0.008 * body;
    }
  }

  // Feet are estimated at normalized x=.25/.75 and the crop's bottom edge.
  // Pin their y and x during stance after all body overlays have been applied.
  const foot = footForPosition(x, pose);
  const isFootVertex = y === FOOT_LANDMARKS.y && Math.abs(x - foot.center) < 1e-9;
  if (isFootVertex && rigMode !== 'home') {
    if (foot.state.stance || pose.gaitWeight <= 0) {
      dx = 0;
      dy = 0;
    } else {
      const swingEnvelope = Math.sin(Math.PI * foot.state.swing);
      dx *= swingEnvelope;
      dy *= swingEnvelope;
      const forward = Math.sin(Math.PI * foot.state.swing);
      dx += (foot.key === 'left' ? 1 : -1) * forward * pose.gaitWeight * scale * 0.012;
      dy -= foot.state.lift * pose.gaitWeight * scale;
    }
  } else if (y > 0.78) {
    const weight = Math.max(
      region(x, FOOT_LANDMARKS.left, 0.31) * pose.feet.left.lift,
      region(x, FOOT_LANDMARKS.right, 0.31) * pose.feet.right.lift,
    ) * region(y, 0.98, 0.22);
    dy -= weight * pose.gaitWeight * scale;
    dx += (x - 0.5) * weight * pose.gaitWeight * scale * 0.025;
    // Distribute the body fields into the two estimated paw pins smoothly.
    if (y > 0.92 && (pose.feet.left.stance || pose.feet.right.stance)) {
      const pin = Math.max(region(x, FOOT_LANDMARKS.left, 0.24), region(x, FOOT_LANDMARKS.right, 0.24));
      dx *= 1 - pin;
      dy *= 1 - pin;
    }
  }

  return Object.freeze({ dx, dy });
}

/** Build the 8x12, two-triangle-per-cell mesh used by DogSprites.drawRigged. */
export function buildDogRigMesh({ crop, x = 0, foot = 0, size = 140, pose } = {}) {
  if (!crop || !pose || ![crop.x, crop.y, crop.width, crop.height, x, foot, size].every(Number.isFinite)
    || crop.width <= 0 || crop.height <= 0 || size <= 0) {
    throw new TypeError('A valid source crop, pose, and positive size are required.');
  }
  const columns = DOG_RIG_DIAGNOSTICS.grid.columns;
  const uniformY = Array.from({ length: DOG_RIG_DIAGNOSTICS.grid.rows + 1 }, (_, index) => index / DOG_RIG_DIAGNOSTICS.grid.rows);
  const groundV = clamp(finite(crop.groundY, crop.height) / crop.height, 0, 1);
  const yStops = pose.rigMode === 'home' && !uniformY.some(value => Math.abs(value - groundV) < 1e-9)
    ? [...uniformY, groundV].sort((a, b) => a - b)
    : uniformY;
  const rows = yStops.length - 1;
  const scale = size / crop.height;
  const outputWidth = crop.width * scale;
  const anchorX = Number.isFinite(crop.anchorX) ? crop.anchorX : crop.width / 2;
  const left = x - anchorX * scale;
  const top = foot - groundV * size;
  const vertices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns, v = yStops[row];
      const sampled = sampleDogDeformation(u, v, pose, size);
      const deformation = pose.rigMode === 'home' && Math.abs(v - groundV) < 1e-9
        ? { ...sampled, dy: 0 }
        : sampled;
      vertices.push(Object.freeze({
        u, v,
        sx: crop.x + u * crop.width,
        sy: crop.y + v * crop.height,
        x: left + u * outputWidth + deformation.dx,
        y: top + v * size + deformation.dy,
      }));
    }
  }
  const triangles = [];
  const rowStride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = row * rowStride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + rowStride;
      const bottomRight = bottomLeft + 1;
      if ((row + column) % 2) {
        triangles.push(Object.freeze([topLeft, topRight, bottomLeft]));
        triangles.push(Object.freeze([topRight, bottomRight, bottomLeft]));
      } else {
        triangles.push(Object.freeze([topLeft, topRight, bottomRight]));
        triangles.push(Object.freeze([topLeft, bottomRight, bottomLeft]));
      }
    }
  }
  return Object.freeze({ vertices: Object.freeze(vertices), triangles: Object.freeze(triangles) });
}
