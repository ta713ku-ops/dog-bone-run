const IDLE_CYCLE_MS = 36_000;
const BREATH_PERIOD_MS = 4_800;
const TAU = Math.PI * 2;

const IDLE_SEQUENCE = Object.freeze([
  { start: 0, end: 6_400, action: 'idle' },
  { start: 6_400, end: 6_600, action: 'blink', blendMs: 70 },
  { start: 6_600, end: 11_400, action: 'idle' },
  { start: 11_400, end: 14_000, action: 'look', blendMs: 350 },
  { start: 14_000, end: 19_000, action: 'idle' },
  { start: 19_000, end: 19_200, action: 'blink', blendMs: 70 },
  { start: 19_200, end: 25_400, action: 'idle' },
  { start: 25_400, end: 27_800, action: 'bow', blendMs: 450 },
  { start: 27_800, end: 32_600, action: 'idle' },
  { start: 32_600, end: 35_000, action: 'paw', blendMs: 450 },
  { start: 35_000, end: IDLE_CYCLE_MS, action: 'idle' },
]);

const finiteNonNegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

function blendWeight(elapsedMs, durationMs, blendMs) {
  return smoothstep(elapsedMs / blendMs) * smoothstep((durationMs - elapsedMs) / blendMs);
}

function idlePose(timeMs) {
  const cycleTime = timeMs % IDLE_CYCLE_MS;
  const cycleNumber = Math.floor(timeMs / IDLE_CYCLE_MS);
  const segment = IDLE_SEQUENCE.find(item => cycleTime >= item.start && cycleTime < item.end)
    ?? IDLE_SEQUENCE[IDLE_SEQUENCE.length - 1];
  const segmentTime = cycleTime - segment.start;
  const durationMs = segment.end - segment.start;
  const action = segment.action === 'look'
    ? cycleNumber % 2 === 0 ? 'lookLeft' : 'lookRight'
    : segment.action;
  const poseWeight = segment.blendMs ? blendWeight(segmentTime, durationMs, segment.blendMs) : 0;

  // Breathing uses its own clock so the 4.8s rhythm continues smoothly across
  // the 36s pose cycle boundary.
  const breath = Math.sin(TAU * (timeMs % BREATH_PERIOD_MS) / BREATH_PERIOD_MS);
  const bodySway = Math.sin(TAU * cycleTime / IDLE_CYCLE_MS);
  let rotation = bodySway * 0.006;
  if (segment.action === 'bow') rotation -= 0.008 * poseWeight;
  if (segment.action === 'paw') rotation += 0.006 * poseWeight;
  if (segment.action === 'look') rotation += (cycleNumber % 2 === 0 ? -1 : 1) * 0.003 * poseWeight;

  const scaleY = 1 + 0.008 * breath;
  return {
    action,
    poseTimeMs: segmentTime,
    poseWeight,
    scaleX: 1 + 0.004 * breath,
    scaleY,
    rotation,
    lift: 0,
    shadowScale: 1 - 0.72 * (scaleY - 1),
    accent: null,
  };
}

function tapPose(timeMs, reactionMs) {
  const base = idlePose(timeMs);
  const elapsed = finiteNonNegative(reactionMs);
  const pawDurationMs = 1_500;
  const hop = smoothstep(elapsed / 400) * (1 - smoothstep((elapsed - 400) / 500));
  const inPaw = elapsed < pawDurationMs;

  return {
    ...base,
    action: inPaw ? 'paw' : 'idle',
    poseTimeMs: inPaw ? elapsed : 0,
    poseWeight: inPaw ? blendWeight(elapsed, pawDurationMs, 350) : 0,
    scaleX: base.scaleX + 0.003 * hop,
    scaleY: base.scaleY + 0.006 * hop,
    rotation: base.rotation + 0.004 * hop,
    lift: 3 * hop,
    shadowScale: base.shadowScale - 0.018 * hop,
    accent: 'tap',
  };
}

function recoverIdlePose(timeMs, recoveryMs) {
  const pose = idlePose(timeMs);
  return {
    ...pose,
    // A gesture already in progress when the tap ends fades back in from the
    // neutral idle pose, instead of appearing at full strength in one frame.
    poseWeight: pose.poseWeight * smoothstep(recoveryMs / 350),
  };
}

function reducedIdlePose(timeMs) {
  const now = finiteNonNegative(timeMs);
  const cycleTime = now % IDLE_CYCLE_MS;
  const segment = IDLE_SEQUENCE.find(item => cycleTime >= item.start && cycleTime < item.end);
  const blinking = segment?.action === 'blink';
  const breath = Math.sin(TAU * (now % BREATH_PERIOD_MS) / BREATH_PERIOD_MS);
  const poseTimeMs = blinking ? cycleTime - segment.start : 0;
  return {
    action: blinking ? 'blink' : 'idle',
    poseTimeMs,
    poseWeight: blinking ? blendWeight(poseTimeMs, segment.end - segment.start, segment.blendMs) : 0,
    scaleX: 1 + 0.0015 * breath,
    scaleY: 1 + 0.003 * breath,
    rotation: 0,
    lift: 0,
    shadowScale: 1 - 0.35 * 0.003 * breath,
    accent: null,
  };
}

/**
 * Resolve the front-facing dog's home/result pose from elapsed time alone.
 * `reactionMs` is elapsed time since the latest dog tap, in milliseconds.
 */
export function getDogMotion(timeMs, { reducedMotion = false, celebrate = false, reactionMs = null, paused = false } = {}) {
  if (paused) {
    return {
      action: 'idle', poseTimeMs: 0, poseWeight: 0, scaleX: 1, scaleY: 1,
      rotation: 0, lift: 0, shadowScale: 1, accent: null,
    };
  }
  if (reducedMotion) {
    const pose = reducedIdlePose(timeMs);
    return celebrate ? { ...pose, action: 'finish', poseTimeMs: 0, poseWeight: 1 } : pose;
  }

  const now = finiteNonNegative(timeMs);
  if (celebrate) {
    const pose = idlePose(now);
    return {
      ...pose,
      action: 'finish',
      poseTimeMs: now,
      poseWeight: 1,
      accent: 'celebrate',
    };
  }

  if (Number.isFinite(reactionMs) && reactionMs >= 0) {
    if (reactionMs < 1_800) return tapPose(now, reactionMs);
    if (reactionMs < 2_150) return recoverIdlePose(now, reactionMs - 1_800);
  }

  return idlePose(now);
}
