import { sampleHome } from './sprite-animation.js';

const DEFAULT_FRAME_COUNT = 16;
const MAX_FRAME_COUNT = 4096;
const GREET_DURATION_MS = 3_000;
const SIT_DURATION_MS = 1_600;
const LYING_RISE_DURATION_MS = 1_500;
const LIE_DESCENT_DURATION_MS = 1_800;
const STAND_TO_LIE_DURATION_MS = 2_800;
const LOCAL_MOTION_HANDOFF_MS = 320;
const NO_MOTION_DISTANCE = 1e-8;
const MIN_PARTIAL_MOTION_MS = 240;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function normalizedFrameCount(frameCounts, atlas) {
  const value = frameCounts && typeof frameCounts === 'object' ? frameCounts[atlas] : undefined;
  if (!Number.isFinite(value) || value < 1) return DEFAULT_FRAME_COUNT;
  return Math.min(MAX_FRAME_COUNT, Math.max(1, Math.floor(value)));
}

function normalizeLayers(layers) {
  const merged = [];
  for (const layer of layers) {
    if (!layer || !Number.isFinite(layer.weight) || layer.weight <= 0) continue;
    const existing = merged.find(item => item.atlas === layer.atlas && item.index === layer.index);
    if (existing) existing.weight += layer.weight;
    else merged.push({ atlas: layer.atlas, index: layer.index, weight: layer.weight });
  }
  const total = merged.reduce((sum, layer) => sum + layer.weight, 0);
  if (total <= 0) return [];
  const result = merged.map(layer => ({ ...layer, weight: layer.weight / total }));
  let prefix = 0;
  for (let index = 0; index < result.length - 1; index += 1) prefix += result[index].weight;
  result[result.length - 1].weight = 1 - prefix;
  return result;
}

function frameLayers(frame) {
  if (!frame || typeof frame !== 'object') return [];
  if (Array.isArray(frame.layers)) return normalizeLayers(frame.layers);
  const mix = Number.isFinite(frame.mix) ? clamp(frame.mix, 0, 1) : 0;
  const nextAtlas = frame.nextAtlas ?? frame.atlas;
  return normalizeLayers([
    { atlas: frame.atlas, index: frame.index, weight: 1 - mix },
    { atlas: nextAtlas, index: frame.nextIndex, weight: mix },
  ]);
}

function poseForLayer(layer, frameCounts) {
  const { atlas, index } = layer;
  if (atlas === 'sitdown') {
    const last = normalizedFrameCount(frameCounts, atlas) - 1;
    return last === 0 ? 0 : clamp(index / last, 0, 1);
  }
  if (atlas === 'liedown') {
    const last = normalizedFrameCount(frameCounts, atlas) - 1;
    return last === 0 ? 1 : 1 + clamp(index / last, 0, 1);
  }
  if (atlas === 'postures') {
    const value = clamp(index, 0, 11);
    if (value <= 3) return value / 3;
    if (value <= 5) return 1;
    if (value <= 8) return 1 + (value - 6) / 2;
    return 2;
  }
  // The continuous home timeline starts in the standing expression atlas.
  return 0;
}

function weightedPose(layers, frameCounts) {
  const total = layers.reduce((sum, layer) => sum + layer.weight, 0);
  if (total <= 0) return 0;
  return clamp(layers.reduce((sum, layer) => sum + poseForLayer(layer, frameCounts) * layer.weight, 0) / total, 0, 2);
}

function frameAtPose(pose, frameCounts, action) {
  const value = clamp(finiteOr(pose, 0), 0, 2);
  const atlas = value <= 1 ? 'sitdown' : 'liedown';
  const count = normalizedFrameCount(frameCounts, atlas);
  const last = count - 1;
  const position = atlas === 'sitdown' ? value * last : (value - 1) * last;
  const index = Math.min(last, Math.floor(position));
  const nextIndex = Math.min(last, index + 1);
  const mix = nextIndex === index ? 0 : clamp(position - index, 0, 1);
  return { atlas, index, nextIndex, mix, action };
}

function canonicalFrameAtPose(pose, frameCounts) {
  const value = clamp(pose, 0, 2);
  if (value <= 0) {
    return { atlas: 'sitdown', index: 0, nextIndex: 0, mix: 0, action: 'stand-idle', layers: [{ atlas: 'sitdown', index: 0, weight: 1 }] };
  }
  if (value <= 1) {
    const index = normalizedFrameCount(frameCounts, 'sitdown') - 1;
    return { atlas: 'sitdown', index, nextIndex: index, mix: 0, action: 'fully-sitting', layers: [{ atlas: 'sitdown', index, weight: 1 }] };
  }
  const index = normalizedFrameCount(frameCounts, 'liedown') - 1;
  return { atlas: 'liedown', index, nextIndex: index, mix: 0, action: 'lie-head-up', layers: [{ atlas: 'liedown', index, weight: 1 }] };
}

function targetFrameFor(action, anchor, frameCounts, targetPose, distance) {
  if (action === 'greet' && distance <= NO_MOTION_DISTANCE) {
    return { ...anchor, layers: frameLayers(anchor) };
  }
  if (!['stand', 'sit', 'lie', 'greet'].includes(action)) return { ...anchor, layers: frameLayers(anchor) };
  return canonicalFrameAtPose(targetPose, frameCounts);
}

function routeSegments(action, sourcePose, targetPose, durationMs) {
  if (durationMs <= 0 || action === 'greet') return [];
  const boundaries = [sourcePose];
  if ((sourcePose < 1 && targetPose > 1) || (sourcePose > 1 && targetPose < 1)) boundaries.push(1);
  boundaries.push(targetPose);
  const span = Math.abs(targetPose - sourcePose) || 1;
  let consumed = 0;
  return boundaries.slice(0, -1).map((fromPose, index) => {
    const toPose = boundaries[index + 1];
    const segmentMs = durationMs * Math.abs(toPose - fromPose) / span;
    const segment = {
      atlas: (fromPose + toPose) / 2 <= 1 ? 'sitdown' : 'liedown',
      fromPose,
      toPose,
      startMs: consumed,
      durationMs: segmentMs,
      reverse: toPose < fromPose,
    };
    consumed += segmentMs;
    return segment;
  });
}

function chooseDuration(action, sourcePose, distance) {
  if (action === 'greet') return GREET_DURATION_MS;
  if (distance <= NO_MOTION_DISTANCE) return 0;
  if (action === 'stand') {
    return Math.max(MIN_PARTIAL_MOTION_MS, Math.round((sourcePose > 1 ? 2_600 : 1_450) * Math.sqrt(clamp(distance / (sourcePose > 1 ? 2 : 1), 0, 1))));
  }
  if (action === 'sit') {
    const base = sourcePose > 1 ? LYING_RISE_DURATION_MS : SIT_DURATION_MS;
    return Math.max(MIN_PARTIAL_MOTION_MS, Math.round(base * Math.sqrt(clamp(distance, 0, 1))));
  }
  if (action === 'lie') {
    if (sourcePose >= 1) {
      return Math.max(MIN_PARTIAL_MOTION_MS,
        Math.round(LIE_DESCENT_DURATION_MS * Math.sqrt(clamp(distance, 0, 1))));
    }
    return Math.round(STAND_TO_LIE_DURATION_MS - 1_000 * sourcePose);
  }
  return 0;
}

function easingProfile(action, sourcePose, targetPose) {
  if (action === 'greet' && targetPose === sourcePose) return { attackPower: 1, settlePower: 1 };
  if (action === 'greet') action = targetPose < sourcePose ? 'sit' : 'lie';
  if ((action === 'stand' || action === 'sit') && sourcePose > targetPose) return { attackPower: 1.22, settlePower: 1.7 };
  if (action === 'lie' && sourcePose < targetPose) {
    return sourcePose < 1
      ? { attackPower: 1.45, settlePower: 1.62 }
      : { attackPower: 1.85, settlePower: 1.28 };
  }
  return { attackPower: 1.72, settlePower: 1.28 };
}

function greetTargetPose(anchor, sourcePose) {
  switch (anchor.action) {
    case 'home-sit-down':
    case 'home-rise-to-sit':
      return 1;
    case 'home-lie-down':
      return 2;
    case 'home-rise-to-stand':
      return 0;
    default:
      return sourcePose;
  }
}

function asymmetricEase(progress, profile) {
  const time = clamp(progress, 0, 1);
  if (time === 0 || time === 1) return time;
  const attack = time ** profile.attackPower;
  const settle = (1 - time) ** profile.settlePower;
  return attack / (attack + settle);
}

function copyAnchor(anchor, startedAt, frameCounts) {
  const resolved = anchor && typeof anchor === 'object'
    ? anchor
    : sampleHome(startedAt, { continuousMotion: true, frameCounts });
  const exactLayers = Array.isArray(resolved.layers)
    ? resolved.layers.map(layer => ({ ...layer }))
    : null;
  const exactTotal = exactLayers?.reduce((sum, layer) => sum + (Number.isFinite(layer.weight) ? layer.weight : 0), 0) ?? 0;
  const layers = exactLayers?.length && exactLayers.every(layer =>
    layer && typeof layer.atlas === 'string' && Number.isInteger(layer.index)
      && Number.isFinite(layer.weight) && layer.weight >= 0)
    && Math.abs(exactTotal - 1) < 1e-8
    ? exactLayers
    : frameLayers(resolved);
  if (!layers.length) {
    const fallback = sampleHome(startedAt, { continuousMotion: true, frameCounts });
    return { ...fallback, layers: frameLayers(fallback) };
  }
  return { ...resolved, layers };
}

function composedPoseFrame(anchorLayers, progress, targetPose, frameCounts, action) {
  const layers = [];
  let poseSum = 0;
  let weightSum = 0;
  for (const source of anchorLayers) {
    const sourcePose = poseForLayer(source, frameCounts);
    const pose = sourcePose + (targetPose - sourcePose) * progress;
    const frame = frameAtPose(pose, frameCounts, action);
    for (const layer of frameLayers(frame)) {
      const weight = source.weight * layer.weight;
      layers.push({ ...layer, weight });
      poseSum += poseForLayer(layer, frameCounts) * weight;
      weightSum += weight;
    }
  }
  const averagePose = weightSum > 0 ? poseSum / weightSum : targetPose;
  return {
    ...frameAtPose(averagePose, frameCounts, action),
    layers: normalizeLayers(layers),
  };
}

function smoothstep(value) {
  const time = clamp(value, 0, 1);
  return time * time * (3 - 2 * time);
}

function stagedEnvelope(elapsedMs, startMs, attackEndMs, releaseStartMs, releaseEndMs) {
  if (elapsedMs <= startMs || elapsedMs >= releaseEndMs) return 0;
  if (elapsedMs < attackEndMs) {
    return smoothstep((elapsedMs - startMs) / (attackEndMs - startMs));
  }
  if (elapsedMs < releaseStartMs) return 1;
  return 1 - smoothstep((elapsedMs - releaseStartMs) / (releaseEndMs - releaseStartMs));
}

function greetResponse(elapsedMs) {
  return {
    earLeft: 0.32 * stagedEnvelope(elapsedMs, 0, 500, 1_600, 2_700),
    earRight: 0.2 * stagedEnvelope(elapsedMs, 35, 535, 1_680, 2_780),
    headLift: 4 * stagedEnvelope(elapsedMs, 120, 820, 1_780, 2_900),
    headAngle: 0.055 * stagedEnvelope(elapsedMs, 300, 1_090, 1_900, 2_980),
  };
}

function localHandoffWeight(elapsedMs, durationMs) {
  if (elapsedMs < 0) return 0;
  const duration = Math.min(LOCAL_MOTION_HANDOFF_MS, Math.max(0, durationMs));
  if (duration === 0) return elapsedMs === 0 ? 1 : 0;
  return 1 - smoothstep(elapsedMs / duration);
}

function decorate(frame, timeMs, frameCounts, seed, reducedMotion) {
  return sampleHome(timeMs, {
    continuousMotion: true,
    heldFrame: frame,
    frameCounts,
    seed,
    reducedMotion,
  });
}

function captureAnchorLocalMotion(anchor, startedAt, frameCounts) {
  const base = decorate(anchor, startedAt, frameCounts, 42, false);
  const motion = {
    headAngle: clamp(finiteOr(anchor.headAngle, base.headAngle ?? 0), -0.055, 0.055),
    headLift: clamp(finiteOr(anchor.headLift, base.headLift ?? 0), 0, 4),
    earLeft: clamp(finiteOr(anchor.earLeft, base.earLeft ?? 0), -1, 1),
    earRight: clamp(finiteOr(anchor.earRight, base.earRight ?? 0), -1, 1),
    headRest: clamp(finiteOr(anchor.headRest,0),0,1),
    eyeRest: clamp(finiteOr(anchor.eyeRest,0),0,1),
    bodyShift: clamp(finiteOr(anchor.bodyShift,0),-1,1),
    pawAdjust: clamp(finiteOr(anchor.pawAdjust,0),0,1),
    gazeX: clamp(finiteOr(anchor.gazeX,0),-1,1),
    blink: clamp(finiteOr(anchor.blink,base.blink??0),0,1),
    headYaw: clamp(finiteOr(anchor.headYaw,base.headYaw??0),-1,1),
  };
  const hasHeadYaw = Math.abs(motion.headYaw) > NO_MOTION_DISTANCE;
  const hasLocalMotion = hasHeadYaw || Object.keys(motion).some(field =>
    Math.abs(motion[field] - finiteOr(base[field], 0)) > NO_MOTION_DISTANCE);
  return { motion, hasLocalMotion, hasHeadYaw };
}

/** Build a one-shot posture or local attention command from the exact current layers. */
export function createHomeCommand(action, startedAt, anchor, frameCounts = null) {
  const time = Math.max(0, finiteOr(startedAt, 0));
  const resolvedAction = ['stand', 'sit', 'lie', 'greet'].includes(action) ? action : String(action ?? 'idle');
  const start = copyAnchor(anchor, time, frameCounts);
  const anchorLayers = frameLayers(start);
  const sourcePose = weightedPose(anchorLayers, frameCounts);
  const targetPose = resolvedAction === 'stand' ? 0 : resolvedAction === 'sit'
    ? 1
    : resolvedAction === 'lie'
      ? 2
      : resolvedAction === 'greet'
        ? greetTargetPose(start, sourcePose)
        : sourcePose;
  const distance = Math.abs(targetPose - sourcePose);
  const anchorMotion = captureAnchorLocalMotion(start, time, frameCounts);
  const noPoseMotion = resolvedAction !== 'greet' && distance <= NO_MOTION_DISTANCE;
  const durationMs = noPoseMotion && anchorMotion.hasLocalMotion
    ? Math.max(LOCAL_MOTION_HANDOFF_MS, anchorMotion.hasHeadYaw ? 700 : 0, chooseDuration(resolvedAction, sourcePose, distance))
    : chooseDuration(resolvedAction, sourcePose, distance);
  const targetFrame = noPoseMotion
    ? canonicalFrameAtPose(targetPose, frameCounts)
    : targetFrameFor(resolvedAction, start, frameCounts, targetPose, distance);
  const profile = easingProfile(resolvedAction, sourcePose, targetPose);
  const postureMotions = distance > NO_MOTION_DISTANCE
    ? routeSegments(resolvedAction === 'greet' ? 'greet-route' : resolvedAction,
      sourcePose, targetPose, durationMs)
    : [];
  const motions = resolvedAction === 'greet'
    ? [...postureMotions, { kind: 'local-attention', durationMs,
      channels: { ears: [0, 535, 1_600, 2_780], lift: [120, 820, 1_780, 2_900], tilt: [300, 1_090, 1_900, 2_980] } }]
    : postureMotions;

  return {
    action: resolvedAction,
    startedAt: time,
    durationMs,
    anchor: start,
    anchorLocalMotion: anchorMotion.motion,
    targetFrame,
    motions,
    sourcePose,
    targetPose: noPoseMotion ? sourcePose : targetPose,
    frameCounts: frameCounts && typeof frameCounts === 'object' ? { ...frameCounts } : null,
    profile,
  };
}

/** Sample a home command at absolute time; completed posture commands keep their target. */
export function sampleHomeCommand(timeMs, command, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  if (!command || typeof command !== 'object') {
    const time = finiteOr(timeMs, 0);
    const empty = sampleHome(time, { continuousMotion: true, frameCounts: settings.frameCounts });
    return { ...empty, headAngle: 0, headLift: 0 };
  }

  const time = finiteOr(timeMs, command.startedAt);
  const frameCounts = settings.frameCounts ?? command.frameCounts ?? null;
  const seed = Number.isFinite(settings.seed) ? settings.seed : 42;
  const reducedMotion = settings.reducedMotion === true;
  const elapsed = time - command.startedAt;
  const action = command.action;
  let frame = command.anchor;

  if (reducedMotion) {
    frame = command.targetFrame;
  } else if (action === 'stand' || action === 'sit' || action === 'lie') {
    if (elapsed <= 0) {
      frame = command.anchor;
    } else if (command.durationMs <= 0 || elapsed >= command.durationMs) {
      frame = command.targetFrame;
    } else {
      const progress = asymmetricEase(elapsed / command.durationMs, command.profile);
      frame = composedPoseFrame(command.anchor.layers, progress, command.targetPose,
        frameCounts, `interaction-${action}`);
    }
  } else if (action === 'greet') {
    if (elapsed >= 0 && elapsed < command.durationMs) {
      if (Math.abs(command.targetPose - command.sourcePose) > NO_MOTION_DISTANCE) {
        const progress = asymmetricEase(elapsed / command.durationMs, command.profile);
        frame = composedPoseFrame(command.anchor.layers, progress, command.targetPose,
          frameCounts, 'interaction-greet-attention');
      }
    } else if (elapsed >= command.durationMs) {
      frame = command.targetFrame;
    }
  } else if (elapsed >= command.durationMs) {
    frame = command.targetFrame;
  }

  const result = decorate(frame, time, frameCounts, seed, reducedMotion);
  const resting = (command.anchorLocalMotion?.headRest??0)>0;
  const handoff = reducedMotion
    ? 0
    : resting ? 1-smoothstep(Math.max(0,elapsed)/Math.min(1000,command.durationMs||1000))
      : localHandoffWeight(elapsed, command.durationMs);
  const targetWeight = 1 - handoff;
  const response = !reducedMotion && action === 'greet' && elapsed >= 0 && elapsed < command.durationMs
    ? greetResponse(elapsed)
    : { earLeft: 0, earRight: 0, headAngle: 0, headLift: 0 };
  const anchorLocal = command.anchorLocalMotion ?? { earLeft: 0, earRight: 0, headAngle: 0, headLift: 0 };
  const anchorYaw = finiteOr(anchorLocal.headYaw, 0);
  const yaw = reducedMotion ? anchorYaw : anchorYaw * (1 - smoothstep(Math.max(0, elapsed) / 700));
  return {
    ...result,
    ...(elapsed <= 0 && !reducedMotion && Array.isArray(command.anchor.layers)
      ? { layers: command.anchor.layers.map(layer => ({ ...layer })) }
      : {}),
    headAngle: anchorLocal.headAngle * handoff + response.headAngle * targetWeight,
    headLift: anchorLocal.headLift * handoff + response.headLift * targetWeight,
    headRest:(anchorLocal.headRest??0)*handoff,
    eyeRest:(anchorLocal.eyeRest??0)*handoff,
    bodyShift:(anchorLocal.bodyShift??0)*handoff,
    pawAdjust:(anchorLocal.pawAdjust??0)*handoff,
    gazeX:(anchorLocal.gazeX??0)*handoff,
    blink:(anchorLocal.blink??result.blink??0)*handoff+(result.blink??0)*targetWeight,
    earLeft: clamp(anchorLocal.earLeft * handoff + ((result.earLeft ?? 0) + response.earLeft) * targetWeight, -1, 1),
    earRight: clamp(anchorLocal.earRight * handoff + ((result.earRight ?? 0) + response.earRight) * targetWeight, -1, 1),
    headYaw: Math.abs(yaw) < 1e-12 ? 0 : yaw,
  };
}
