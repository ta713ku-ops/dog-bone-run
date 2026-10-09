const DEFAULT_STRIDE_LENGTH = 0.78;
const DEFAULT_FRAME_COUNT = 8;
const MAX_FRAME_COUNT = 4096;

export const HOME_CYCLE_MS = 36_000;
export const CONTINUOUS_HOME_CYCLE_MS = 72_000;
const INTERACTION_ENTER_MS = 200;
const INTERACTION_EXIT_MS = 200;
const DETAILED_EDGE_BLEND_MS = 120;
const INTERACTION_DURATIONS = Object.freeze({ sit: 4_600, lie: 7_000, greet: 1_600 });
const NATURAL_BREATH_PERIOD_MS = 4_500;
const NATURAL_BLINK_PERIOD_MS = 4_500;
const NATURAL_BLINK_DURATION_MS = 220;

const HOME_TIMELINE = Object.freeze({
  standEnd: 8_000,
  sitEnd: 9_200,
  seatedEnd: 17_200,
  lieEnd: 18_400,
  lyingEnd: 33_600,
  riseToSitEnd: 34_800,
});

const CONTINUOUS_HOME_TIMELINE = Object.freeze({
  standEnd: 16_800,
  sitEnd: 18_400,
  seatedEnd: 31_200,
  lieEnd: 32_800,
  lyingEnd: 49_600,
  riseToSitEnd: 51_200,
  standStart: 52_800,
});
const DEFAULT_HOME_CLIP_FRAME_COUNT = 16;
const CONTINUOUS_BLINK_COUNT = 14;
const CONTINUOUS_BLINK_MIN_GAP_MS = 3_000;
const CONTINUOUS_BLINK_MAX_GAP_MS = 7_000;
const CONTINUOUS_BLINK_MIN_DURATION_MS = 180;
const CONTINUOUS_BLINK_MAX_DURATION_MS = 260;
const CONTINUOUS_BREATH_PERIOD_MS = 4_800;
const CONTINUOUS_BREATH_AMPLITUDE = 0.48;
const CONTINUOUS_EAR_INTERACTION_EXIT_MS = 320;
const CONTINUOUS_BLINK_SCHEDULE_CACHE = new Map();
const CONTINUOUS_EAR_SCHEDULE_CACHE = new Map();
const CONTINUOUS_EAR_SEGMENTS = Object.freeze([
  { startMs: 0, endMs: 16_800, count: 2 },
  { startMs: 18_400, endMs: 31_200, count: 1 },
  { startMs: 32_800, endMs: 49_600, count: 2 },
  { startMs: 52_800, endMs: 72_000, count: 2 },
]);

const EXPRESSION_ACTIONS = Object.freeze([
  'stand-idle',
  'blink-half',
  'blink-closed',
  'head-tilt-left',
  'head-tilt-right',
  'paw-lift',
  'soft-smile',
  'delighted',
]);

const POSTURE_ACTIONS = Object.freeze([
  'stand-neutral',
  'lowering-haunches',
  'nearly-sitting',
  'fully-sitting',
  'sit-blink',
  'sit-paw',
  'preparing-to-lie',
  'half-down',
  'lie-head-up',
  'lie-blink',
  'lie-sleep',
  'lie-head-rest',
]);

const SIT_DOWN = Object.freeze([0, 1, 2, 3]);
const SIT_TO_LIE = Object.freeze([3, 6, 7, 8]);
const LIE_TO_SIT = Object.freeze([8, 7, 6, 3]);
const SIT_TO_STAND = Object.freeze([3, 2, 1, 0]);

const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const positiveModulo = (value, modulus) => ((value % modulus) + modulus) % modulus;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function frameCountOrDefault(value) {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_FRAME_COUNT;
  return Math.min(MAX_FRAME_COUNT, Math.max(1, Math.floor(value)));
}

function boundedHomeClipFrameCount(value) {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_HOME_CLIP_FRAME_COUNT;
  return Math.min(MAX_FRAME_COUNT, Math.max(1, Math.floor(value)));
}

function homeClipFrameCount(atlas, frameCounts = null) {
  const value = frameCounts && typeof frameCounts === 'object' ? frameCounts[atlas] : undefined;
  return boundedHomeClipFrameCount(value);
}

function authoredPath(path, elapsedMs, durationMs, blendMs = 120) {
  if (path.length <= 1 || durationMs <= 0) {
    const index = path[0] ?? 0;
    return { index, nextIndex: index, mix: 0 };
  }

  const stepMs = durationMs / (path.length - 1);
  const boundedTime = clamp(elapsedMs, 0, durationMs);
  if (boundedTime >= durationMs) {
    const index = path[path.length - 1];
    return { index, nextIndex: index, mix: 0 };
  }

  const step = Math.min(path.length - 2, Math.floor(boundedTime / stepMs));
  const blendStart = (step + 1) * stepMs - Math.min(blendMs, stepMs);
  if (boundedTime >= blendStart) {
    return {
      index: path[step],
      nextIndex: path[step + 1],
      mix: clamp((boundedTime - blendStart) / Math.min(blendMs, stepMs), 0, 1),
    };
  }
  return { index: path[step], nextIndex: path[step], mix: 0 };
}

function homeFrame(atlas, index, nextIndex = index, mix = 0, action = '', nextAtlas = null) {
  const frame = { atlas, index, nextIndex, mix, action };
  if (nextAtlas) frame.nextAtlas = nextAtlas;
  return frame;
}

function crossAtlasFrame(fromAtlas, fromIndex, toAtlas, toIndex, mix, action) {
  return homeFrame(fromAtlas, fromIndex, toIndex, mix, action, fromAtlas === toAtlas ? null : toAtlas);
}

function frameLayers(frame) {
  if (Array.isArray(frame.layers)) return normalizeLayers(frame.layers);
  const mix = Number.isFinite(frame.mix) ? clamp(frame.mix, 0, 1) : 0;
  const nextAtlas = frame.nextAtlas ?? frame.atlas;
  const first = { atlas: frame.atlas, index: frame.index, weight: 1 - mix };
  const second = { atlas: nextAtlas, index: frame.nextIndex, weight: mix };
  if (first.atlas === second.atlas && first.index === second.index) return [{ ...first, weight: 1 }];
  if (mix <= 0) return [{ atlas: first.atlas, index: first.index, weight: 1 }];
  if (mix >= 1) return [{ atlas: second.atlas, index: second.index, weight: 1 }];
  return [first, second];
}

function normalizeLayers(layers) {
  const merged = [];
  for (const layer of layers) {
    if (!Number.isFinite(layer.weight) || layer.weight <= 0) continue;
    const existing = merged.find(item => item.atlas === layer.atlas && item.index === layer.index);
    if (existing) existing.weight += layer.weight;
    else merged.push({ atlas: layer.atlas, index: layer.index, weight: layer.weight });
  }
  const total = merged.reduce((sum, layer) => sum + layer.weight, 0);
  if (total <= 0) return [];
  const normalized = merged.map(layer => ({ ...layer, weight: layer.weight / total }));
  let prefix = 0;
  for (let index = 0; index < normalized.length - 1; index += 1) prefix += normalized[index].weight;
  normalized[normalized.length - 1].weight = 1 - prefix;
  return normalized;
}

function blendLayers(fromLayers, toLayers, mix) {
  const amount = clamp(mix, 0, 1);
  if (amount <= 0) return fromLayers.map(layer => ({ ...layer }));
  if (amount >= 1) return toLayers.map(layer => ({ ...layer }));
  return normalizeLayers([
    ...fromLayers.map(layer => ({ ...layer, weight: layer.weight * (1 - amount) })),
    ...toLayers.map(layer => ({ ...layer, weight: layer.weight * amount })),
  ]);
}

function interactionBlendFrame(fromFrame, toFrame, mix, action) {
  const frame = crossAtlasFrame(fromFrame.atlas, fromFrame.index, toFrame.atlas, toFrame.index, mix, action);
  frame.layers = blendLayers(frameLayers(fromFrame), frameLayers(toFrame), mix);
  return frame;
}

function postureTransition(path, elapsedMs, durationMs, actionForPair) {
  const frame = authoredPath(path, elapsedMs, durationMs, 120);
  const action = frame.index === frame.nextIndex
    ? POSTURE_ACTIONS[frame.index] ?? actionForPair
    : actionForPair(frame.index, frame.nextIndex);
  return homeFrame('postures', frame.index, frame.nextIndex, frame.mix, action);
}

function transitionAction(from, to) {
  if (from === 0 && to === 1) return 'lowering-haunches';
  if (from === 1 && to === 2) return 'nearly-sitting';
  if (from === 2 && to === 3) return 'fully-sitting';
  if (from === 3 && to === 6) return 'preparing-to-lie';
  if (from === 6 && to === 7) return 'half-down';
  if (from === 7 && to === 8) return 'lie-head-up';
  if (from === 8 && to === 7) return 'half-down';
  if (from === 7 && to === 6) return 'preparing-to-lie';
  if (from === 6 && to === 3) return 'fully-sitting';
  if (from === 3 && to === 2) return 'nearly-sitting';
  if (from === 2 && to === 1) return 'lowering-haunches';
  if (from === 1 && to === 0) return 'stand-neutral';
  return POSTURE_ACTIONS[to] ?? 'posture-transition';
}

function smoothstep(value) {
  const bounded = clamp(value, 0, 1);
  return bounded * bounded * (3 - 2 * bounded);
}

function clipFrame(atlas, elapsedMs, durationMs, { reverse = false, action = '', frameCount = DEFAULT_HOME_CLIP_FRAME_COUNT } = {}) {
  const elapsed = clamp(finiteOr(elapsedMs, 0), 0, Math.max(0, durationMs));
  const progress = durationMs > 0 ? smoothstep(elapsed / durationMs) : 1;
  const lastIndex = boundedHomeClipFrameCount(frameCount) - 1;
  const position = (reverse ? 1 - progress : progress) * lastIndex;
  const index = Math.min(lastIndex, Math.floor(position));
  const nextIndex = Math.min(lastIndex, index + 1);
  const mix = nextIndex === index ? 0 : clamp(position - index, 0, 1);
  return homeFrame(atlas, index, nextIndex, mix, action);
}

function blendFrameLayers(fromFrame, toFrame, mix, action) {
  const frame = homeFrame(toFrame.atlas, toFrame.index, toFrame.nextIndex, toFrame.mix, action, toFrame.nextAtlas);
  frame.layers = blendLayers(frameLayers(fromFrame), frameLayers(toFrame), mix);
  return frame;
}

function clipWithEdgeBlends(atlas, elapsedMs, durationMs, startFrame, endFrame, action, reverse = false, frameCount = DEFAULT_HOME_CLIP_FRAME_COUNT) {
  const elapsed = clamp(finiteOr(elapsedMs, 0), 0, durationMs);
  const moving = clipFrame(atlas, elapsed, durationMs, { reverse, action, frameCount });
  const edge = Math.min(DETAILED_EDGE_BLEND_MS, durationMs / 2);
  if (elapsed < edge) {
    return blendFrameLayers(startFrame, moving, smoothstep(elapsed / edge), action);
  }
  if (elapsed >= durationMs - edge) {
    return blendFrameLayers(moving, endFrame, smoothstep((elapsed - (durationMs - edge)) / edge), action);
  }
  return moving;
}

function oscillatingClipWithEdgeBlends(atlas, elapsedMs, durationMs, neutralFrame, action, frameCount = DEFAULT_HOME_CLIP_FRAME_COUNT) {
  const elapsed = clamp(finiteOr(elapsedMs, 0), 0, durationMs);
  const half = durationMs / 2;
  const moving = elapsed <= half
    ? clipFrame(atlas, elapsed, half, { action, frameCount })
    : clipFrame(atlas, elapsed - half, half, { reverse: true, action, frameCount });
  const edge = Math.min(DETAILED_EDGE_BLEND_MS, durationMs / 4);
  if (elapsed < edge) {
    return blendFrameLayers(neutralFrame, moving, smoothstep(elapsed / edge), action);
  }
  if (elapsed >= durationMs - edge) {
    return blendFrameLayers(moving, neutralFrame, smoothstep((elapsed - (durationMs - edge)) / edge), 'stand-idle');
  }
  return moving;
}

function detailedHeadTiltAt(elapsedMs, start, end, atlas, action, frameCount = DEFAULT_HOME_CLIP_FRAME_COUNT) {
  const neutral = homeFrame('sitdown', 0, 0, 0, 'stand-idle');
  return oscillatingClipWithEdgeBlends(atlas, elapsedMs - start, end - start, neutral, action, frameCount);
}

function expressionAt(elapsedMs) {
  const blinkStart = 1_900;
  const blinkStepMs = 70;
  const blinkPath = [0, 1, 2, 1, 0];
  const blinkEnd = blinkStart + blinkStepMs * (blinkPath.length - 1);
  if (elapsedMs >= blinkStart && elapsedMs < blinkEnd) {
    const frame = authoredPath(blinkPath, elapsedMs - blinkStart, blinkEnd - blinkStart, blinkStepMs);
    const action = frame.index === 0 && frame.nextIndex === 1 ? 'blink-half'
      : frame.index === 1 && frame.nextIndex === 2 ? 'blink-closed'
        : frame.index === 2 && frame.nextIndex === 1 ? 'blink-closed'
          : frame.index === 1 ? 'blink-half' : 'stand-idle';
    return homeFrame('expressions', frame.index, frame.nextIndex, frame.mix, action);
  }

  const events = [
    { start: 3_200, end: 3_900, index: 3, action: 'head-tilt-left', blendMs: 160 },
    { start: 4_400, end: 5_100, index: 4, action: 'head-tilt-right', blendMs: 160 },
    { start: 5_650, end: 6_350, index: 5, action: 'paw-lift', blendMs: 180 },
    { start: 6_500, end: 7_150, index: 6, action: 'soft-smile', blendMs: 160 },
    { start: 7_150, end: 7_800, index: 7, action: 'delighted', blendMs: 160 },
  ];
  const event = events.find(({ start, end }) => elapsedMs >= start && elapsedMs < end);
  if (event) {
    const { start, end, index, action, blendMs } = event;
    if (elapsedMs < start + blendMs) {
      return homeFrame('expressions', 0, index, clamp((elapsedMs - start) / blendMs, 0, 1), action);
    }
    if (elapsedMs >= end - blendMs) {
      return homeFrame('expressions', index, 0, clamp((elapsedMs - (end - blendMs)) / blendMs, 0, 1), 'stand-idle');
    }
    return homeFrame('expressions', index, index, 0, action);
  }

  return homeFrame('expressions', 0, 0, 0, EXPRESSION_ACTIONS[0]);
}

function seatedAt(elapsedMs) {
  const blinkStart = 2_000;
  const blinkStepMs = 70;
  const blinkPath = [3, 4, 3];
  const blinkEnd = blinkStart + blinkStepMs * 2;
  if (elapsedMs >= blinkStart && elapsedMs < blinkEnd) {
    const frame = authoredPath(blinkPath, elapsedMs - blinkStart, blinkStepMs * 2, blinkStepMs);
    return homeFrame('postures', frame.index, frame.nextIndex, frame.mix, frame.nextIndex === 4 ? 'sit-blink' : 'fully-sitting');
  }

  const pawStart = 4_600;
  const pawEnd = 5_700;
  const blendMs = 180;
  if (elapsedMs >= pawStart && elapsedMs < pawEnd) {
    if (elapsedMs < pawStart + blendMs) {
      return homeFrame('postures', 3, 5, clamp((elapsedMs - pawStart) / blendMs, 0, 1), 'sit-paw');
    }
    if (elapsedMs >= pawEnd - blendMs) {
      return homeFrame('postures', 5, 3, clamp((elapsedMs - (pawEnd - blendMs)) / blendMs, 0, 1), 'fully-sitting');
    }
    return homeFrame('postures', 5, 5, 0, 'sit-paw');
  }
  return homeFrame('postures', 3, 3, 0, 'fully-sitting');
}

function lyingAt(elapsedMs) {
  const blinkStart = 2_300;
  const blinkStepMs = 70;
  const blinkPath = [8, 9, 8];
  const blinkEnd = blinkStart + blinkStepMs * 2;
  if (elapsedMs >= blinkStart && elapsedMs < blinkEnd) {
    const frame = authoredPath(blinkPath, elapsedMs - blinkStart, blinkStepMs * 2, blinkStepMs);
    return homeFrame('postures', frame.index, frame.nextIndex, frame.mix, frame.nextIndex === 9 ? 'lie-blink' : 'lie-head-up');
  }

  const headRest = pairedPostureEvent(elapsedMs, 5_000, 6_500, 8, 11, 'lie-head-up', 'lie-head-rest', 200);
  if (headRest) return headRest;
  const sleep = pairedPostureEvent(elapsedMs, 7_300, 13_300, 8, 10, 'lie-head-up', 'lie-sleep', 200);
  if (sleep) return sleep;
  return homeFrame('postures', 8, 8, 0, 'lie-head-up');
}

function pairedPostureEvent(elapsedMs, start, end, baseIndex, targetIndex, baseAction, targetAction, blendMs) {
  if (elapsedMs < start || elapsedMs >= end) return null;
  if (elapsedMs < start + blendMs) {
    return homeFrame('postures', baseIndex, targetIndex, clamp((elapsedMs - start) / blendMs, 0, 1), targetAction);
  }
  if (elapsedMs >= end - blendMs) {
    return homeFrame('postures', targetIndex, baseIndex, clamp((elapsedMs - (end - blendMs)) / blendMs, 0, 1), baseAction);
  }
  return homeFrame('postures', targetIndex, targetIndex, 0, targetAction);
}

function sampleAutomaticHome(timeMs) {
  const time = positiveModulo(Math.max(0, finiteOr(timeMs, 0)), HOME_CYCLE_MS);
  const { standEnd, sitEnd, seatedEnd, lieEnd, lyingEnd, riseToSitEnd } = HOME_TIMELINE;

  if (time < standEnd) return expressionAt(time);
  if (time < sitEnd) {
    return postureTransition(SIT_DOWN, time - standEnd, sitEnd - standEnd, transitionAction);
  }
  if (time < seatedEnd) return seatedAt(time - sitEnd);
  if (time < lieEnd) {
    return postureTransition(SIT_TO_LIE, time - seatedEnd, lieEnd - seatedEnd, transitionAction);
  }
  if (time < lyingEnd) return lyingAt(time - lieEnd);
  if (time < riseToSitEnd) {
    return postureTransition(LIE_TO_SIT, time - lyingEnd, riseToSitEnd - lyingEnd, transitionAction);
  }
  return postureTransition(SIT_TO_STAND, time - riseToSitEnd, HOME_CYCLE_MS - riseToSitEnd, transitionAction);
}

function sampleDetailedAutomaticHome(timeMs, frameCounts = null) {
  const time = positiveModulo(Math.max(0, finiteOr(timeMs, 0)), HOME_CYCLE_MS);
  const { standEnd, sitEnd, seatedEnd, lieEnd, lyingEnd, riseToSitEnd } = HOME_TIMELINE;
  const sitLast = homeClipFrameCount('sitdown', frameCounts) - 1;
  const lieLast = homeClipFrameCount('liedown', frameCounts) - 1;
  const standing = homeFrame('sitdown', 0, 0, 0, 'stand-idle');
  const seated = homeFrame('sitdown', sitLast, sitLast, 0, 'fully-sitting');
  const lying = homeFrame('liedown', lieLast, lieLast, 0, 'lie-head-up');

  if (time < standEnd) {
    if (time >= 2_800 && time < 4_000) {
      return detailedHeadTiltAt(time, 2_800, 4_000, 'tiltleft', 'head-tilt-left', homeClipFrameCount('tiltleft', frameCounts));
    }
    if (time >= 4_400 && time < 5_600) {
      return detailedHeadTiltAt(time, 4_400, 5_600, 'tiltright', 'head-tilt-right', homeClipFrameCount('tiltright', frameCounts));
    }
    if (time >= 5_650 && time < 7_250) {
      return oscillatingClipWithEdgeBlends('greet', time - 5_650, 1_600,
        standing, 'paw-lift', homeClipFrameCount('greet', frameCounts));
    }
    return standing;
  }
  if (time < sitEnd) {
    return clipWithEdgeBlends('sitdown', time - standEnd, sitEnd - standEnd,
      standing, seated, 'home-sit-down', false, homeClipFrameCount('sitdown', frameCounts));
  }
  if (time < seatedEnd) return seated;
  if (time < lieEnd) {
    return clipWithEdgeBlends('liedown', time - seatedEnd, lieEnd - seatedEnd,
      seated, lying, 'home-lie-down', false, homeClipFrameCount('liedown', frameCounts));
  }
  if (time < lyingEnd) return lying;
  if (time < riseToSitEnd) {
    return clipWithEdgeBlends('liedown', time - lyingEnd, riseToSitEnd - lyingEnd,
      lying, seated, 'home-rise-to-sit', true, homeClipFrameCount('liedown', frameCounts));
  }
  return clipWithEdgeBlends('sitdown', time - riseToSitEnd, HOME_CYCLE_MS - riseToSitEnd,
    seated, standing, 'home-rise-to-stand', true, homeClipFrameCount('sitdown', frameCounts));
}

function reversePath(path) {
  return [...path].reverse();
}

function interactionRoute(action, anchor) {
  const actionName = String(anchor.action || '');
  const isLying = anchor.atlas === 'postures' && (anchor.index >= 6 || actionName.startsWith('lie-') || actionName === 'half-down' || actionName === 'preparing-to-lie');
  const isSitting = anchor.atlas === 'postures' && anchor.index >= 3 && anchor.index <= 5;

  if (action === 'greet') {
    const greetingIndex = isLying ? 8 : anchor.atlas === 'postures' ? 5 : 5;
    return {
      atlas: anchor.atlas === 'postures' ? 'postures' : 'expressions',
      path: [greetingIndex],
      targetIndex: greetingIndex,
      outMs: 0,
      holdMs: 1_200,
      returnMs: 0,
      greetingKind: isLying ? 'lie' : 'paw',
    };
  }

  if (action === 'sit') {
    const path = isLying ? LIE_TO_SIT : isSitting ? [3] : SIT_DOWN;
    return { atlas: 'postures', path, targetIndex: 3, outMs: 1_200, holdMs: 1_800, returnMs: 1_200 };
  }

  if (action === 'lie') {
    const path = isLying ? [8] : isSitting ? SIT_TO_LIE : [...SIT_DOWN, 6, 7, 8];
    return { atlas: 'postures', path, targetIndex: 8, outMs: 2_400, holdMs: 1_800, returnMs: 2_400 };
  }

  return null;
}

function detailedPoseCategory(startedAt) {
  const time = positiveModulo(Math.max(0, finiteOr(startedAt, 0)), HOME_CYCLE_MS);
  const { standEnd, sitEnd, seatedEnd, lieEnd, lyingEnd, riseToSitEnd } = HOME_TIMELINE;

  if (time < standEnd) return 'standing';
  if (time < sitEnd) return time - standEnd >= (sitEnd - standEnd) / 2 ? 'sitting' : 'standing';
  if (time < seatedEnd) return 'sitting';
  if (time < lieEnd) return time - seatedEnd >= (lieEnd - seatedEnd) / 2 ? 'lying' : 'sitting';
  if (time < lyingEnd) return 'lying';
  if (time < riseToSitEnd) return time - lyingEnd < (riseToSitEnd - lyingEnd) / 2 ? 'lying' : 'sitting';
  return time - riseToSitEnd < (HOME_CYCLE_MS - riseToSitEnd) / 2 ? 'sitting' : 'standing';
}

function motionEndpoint(motion, atEnd = false, action = 'interaction-motion', frameCounts = null) {
  const lastIndex = homeClipFrameCount(motion.atlas, frameCounts) - 1;
  const index = (motion.reverse !== atEnd) ? lastIndex : 0;
  return homeFrame(motion.atlas, index, index, 0, action);
}

function detailedInteractionRoute(action, category, frameCounts = null) {
  const targetAtlas = action === 'sit' ? 'sitdown' : 'liedown';
  const targetIndex = homeClipFrameCount(targetAtlas, frameCounts) - 1;
  const targetAction = action === 'sit' ? 'fully-sitting' : 'lie-head-up';
  const targetFrame = homeFrame(targetAtlas, targetIndex, targetIndex, 0, targetAction);
  let motions = [];
  let outMs = 0;
  let returnMs = 0;
  const holdMs = 1_800;

  if (action === 'sit') {
    outMs = returnMs = 1_200;
    if (category === 'lying') motions = [{ atlas: 'liedown', reverse: true }];
    else if (category === 'standing') motions = [{ atlas: 'sitdown', reverse: false }];
  } else if (action === 'lie') {
    outMs = returnMs = 2_400;
    if (category === 'sitting') motions = [{ atlas: 'liedown', reverse: false }];
    else if (category === 'standing') {
      motions = [
        { atlas: 'sitdown', reverse: false },
        { atlas: 'liedown', reverse: false },
      ];
    }
  }

  const returnMotions = [...motions].reverse().map(motion => ({ ...motion, reverse: !motion.reverse }));
  const routeStartFrame = motions.length ? motionEndpoint(motions[0], false, 'interaction-motion', frameCounts) : targetFrame;
  return { motions, returnMotions, outMs, returnMs, holdMs, targetFrame, routeStartFrame };
}

function sampleMotionPlan(motions, elapsedMs, durationMs, startFrame, endFrame, action, frameCounts = null) {
  if (!motions.length || durationMs <= 0) return endFrame;
  const elapsed = clamp(finiteOr(elapsedMs, 0), 0, durationMs);
  if (elapsed >= durationMs) return endFrame;

  const segmentDuration = durationMs / motions.length;
  const segmentIndex = Math.min(motions.length - 1, Math.floor(elapsed / segmentDuration));
  const localElapsed = elapsed - segmentIndex * segmentDuration;
  const motion = motions[segmentIndex];
  const moving = clipFrame(motion.atlas, localElapsed, segmentDuration, {
    reverse: motion.reverse,
    action,
    frameCount: homeClipFrameCount(motion.atlas, frameCounts),
  });
  const edge = Math.min(DETAILED_EDGE_BLEND_MS, segmentDuration / 2);

  if (localElapsed < edge) {
    const source = segmentIndex === 0
      ? startFrame
      : motionEndpoint(motions[segmentIndex - 1], true, action, frameCounts);
    return blendFrameLayers(source, moving, smoothstep(localElapsed / edge), action);
  }
  if (segmentIndex === motions.length - 1 && localElapsed >= segmentDuration - edge) {
    return blendFrameLayers(moving, endFrame,
      smoothstep((localElapsed - (segmentDuration - edge)) / edge), action);
  }
  return moving;
}

function sampleDetailedGreeting(anchor, category, elapsedMs, frameCounts = null) {
  const duration = INTERACTION_DURATIONS.greet;
  if (category === 'standing') {
    const neutral = homeFrame('greet', 0, 0, 0, 'interaction-greet');
    const moving = oscillatingClipWithEdgeBlends('greet', elapsedMs, duration,
      neutral, 'interaction-greet', homeClipFrameCount('greet', frameCounts));
    if (elapsedMs < DETAILED_EDGE_BLEND_MS) {
      return blendFrameLayers(anchor, moving,
        smoothstep(elapsedMs / DETAILED_EDGE_BLEND_MS), 'interaction-greet-enter');
    }
    if (elapsedMs >= duration - DETAILED_EDGE_BLEND_MS) {
      return blendFrameLayers(moving, anchor,
        smoothstep((elapsedMs - (duration - DETAILED_EDGE_BLEND_MS)) / DETAILED_EDGE_BLEND_MS),
        'interaction-greet-return');
    }
    return moving;
  }

  return {
    ...anchor,
    action: 'interaction-greet-attention',
    layers: frameLayers(anchor),
  };
}

function hasCanonicalStationaryPose(frame, frameCounts = null) {
  const layers = frameLayers(frame);
  if (layers.length !== 1 || layers[0].weight !== 1) return false;
  const { atlas, index } = layers[0];
  const canonicalPose = (atlas === 'sitdown' && (index === 0 || index === homeClipFrameCount('sitdown', frameCounts) - 1))
    || (atlas === 'liedown' && index === homeClipFrameCount('liedown', frameCounts) - 1);
  return canonicalPose && ['stand-idle', 'fully-sitting', 'lie-head-up', 'interaction-greet-attention']
    .includes(frame.action);
}

function normalizeSeed(seed) {
  return Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 42;
}

function seededRandom(seed) {
  let state = normalizeSeed(seed);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function cycleSeed(seed, cycleIndex, salt = 0) {
  return (normalizeSeed(seed) ^ Math.imul((cycleIndex + 1) >>> 0, 0x9E3779B1) ^ salt) >>> 0;
}

function sampleContinuousAutomaticHome(timeMs, frameCounts, seed) {
  const clock = Math.max(0, finiteOr(timeMs, 0));
  const time = positiveModulo(clock, CONTINUOUS_HOME_CYCLE_MS);
  const { standEnd, sitEnd, seatedEnd, lieEnd, lyingEnd, riseToSitEnd, standStart } = CONTINUOUS_HOME_TIMELINE;
  const sitCount = homeClipFrameCount('sitdown', frameCounts);
  const lieCount = homeClipFrameCount('liedown', frameCounts);
  const standing = homeFrame('sitdown', 0, 0, 0, 'stand-idle');
  const seatedIndex = sitCount - 1;
  const lyingIndex = lieCount - 1;
  const seated = homeFrame('sitdown', seatedIndex, seatedIndex, 0, 'fully-sitting');
  const lying = homeFrame('liedown', lyingIndex, lyingIndex, 0, 'lie-head-up');

  if (time < standEnd) return standing;
  if (time < sitEnd) {
    return clipWithEdgeBlends('sitdown', time - standEnd, sitEnd - standEnd,
      standing, seated, 'home-sit-down', false, sitCount);
  }
  if (time < seatedEnd) return seated;
  if (time < lieEnd) {
    return clipWithEdgeBlends('liedown', time - seatedEnd, lieEnd - seatedEnd,
      seated, lying, 'home-lie-down', false, lieCount);
  }
  if (time < lyingEnd) return lying;
  if (time < riseToSitEnd) {
    return clipWithEdgeBlends('liedown', time - lyingEnd, riseToSitEnd - lyingEnd,
      lying, seated, 'home-rise-to-sit', true, lieCount);
  }
  if (time < standStart) {
    return clipWithEdgeBlends('sitdown', time - riseToSitEnd, standStart - riseToSitEnd,
      seated, standing, 'home-rise-to-stand', true, sitCount);
  }
  return standing;
}

function continuousPoseCategory(startedAt) {
  const time = positiveModulo(Math.max(0, finiteOr(startedAt, 0)), CONTINUOUS_HOME_CYCLE_MS);
  const { standEnd, sitEnd, seatedEnd, lieEnd, lyingEnd, riseToSitEnd, standStart } = CONTINUOUS_HOME_TIMELINE;
  if (time < standEnd) return 'standing';
  if (time < sitEnd) return time - standEnd >= (sitEnd - standEnd) / 2 ? 'sitting' : 'standing';
  if (time < seatedEnd) return 'sitting';
  if (time < lieEnd) return time - seatedEnd >= (lieEnd - seatedEnd) / 2 ? 'lying' : 'sitting';
  if (time < lyingEnd) return 'lying';
  if (time < riseToSitEnd) return time - lyingEnd < (riseToSitEnd - lyingEnd) / 2 ? 'lying' : 'sitting';
  if (time < standStart) return time - riseToSitEnd < (standStart - riseToSitEnd) / 2 ? 'sitting' : 'standing';
  return 'standing';
}

function sampleContinuousInteraction(timeMs, interaction, frameCounts, seed) {
  if (!interaction || !['sit', 'lie', 'greet'].includes(interaction.action)
    || !Number.isFinite(interaction.startedAt) || interaction.startedAt < 0) return null;

  const elapsedMs = timeMs - interaction.startedAt;
  if (elapsedMs < 0) return null;
  const duration = homeInteractionDuration(interaction.action);
  if (elapsedMs >= duration) {
    return sampleContinuousAutomaticHome(timeMs - duration, frameCounts, seed);
  }

  const anchor = sampleContinuousAutomaticHome(interaction.startedAt, frameCounts, seed);
  const category = continuousPoseCategory(interaction.startedAt);
  if (interaction.action === 'greet') {
    return sampleDetailedGreeting(anchor, category, elapsedMs, frameCounts);
  }

  const route = detailedInteractionRoute(interaction.action, category, frameCounts);
  const routeStart = route.routeStartFrame;
  if (elapsedMs < INTERACTION_ENTER_MS) {
    return interactionBlendFrame(anchor, routeStart,
      smoothstep(elapsedMs / INTERACTION_ENTER_MS), `interaction-${interaction.action}-enter`);
  }

  const routeElapsed = elapsedMs - INTERACTION_ENTER_MS;
  if (routeElapsed < route.outMs) {
    return sampleMotionPlan(route.motions, routeElapsed, route.outMs,
      routeStart, route.targetFrame, `interaction-${interaction.action}`, frameCounts);
  }
  if (routeElapsed < route.outMs + route.holdMs) return route.targetFrame;

  const returnElapsed = routeElapsed - route.outMs - route.holdMs;
  if (returnElapsed < route.returnMs) {
    return sampleMotionPlan(route.returnMotions, returnElapsed, route.returnMs,
      route.targetFrame, routeStart, `interaction-${interaction.action}-return`, frameCounts);
  }

  return interactionBlendFrame(routeStart, anchor,
    smoothstep((returnElapsed - route.returnMs) / INTERACTION_EXIT_MS),
    `interaction-${interaction.action}-return`);
}

function continuousBlinkSchedule(seed) {
  const normalized = normalizeSeed(seed);
  if (CONTINUOUS_BLINK_SCHEDULE_CACHE.has(normalized)) return CONTINUOUS_BLINK_SCHEDULE_CACHE.get(normalized);
  const random = seededRandom(cycleSeed(normalized, 0, 0xB11A));
  const targetGapSeconds = CONTINUOUS_HOME_CYCLE_MS / 1_000 / CONTINUOUS_BLINK_COUNT;
  const rawGaps = Array.from({ length: CONTINUOUS_BLINK_COUNT }, () => 3.5 + random() * 3);
  const mean = rawGaps.reduce((sum, gap) => sum + gap, 0) / rawGaps.length;
  const deviations = rawGaps.map(gap => gap - mean);
  const minDeviation = Math.min(...deviations);
  const maxDeviation = Math.max(...deviations);
  const permittedScale = Math.min(
    minDeviation < 0 ? (targetGapSeconds - CONTINUOUS_BLINK_MIN_GAP_MS / 1_000) / -minDeviation : 1,
    maxDeviation > 0 ? (CONTINUOUS_BLINK_MAX_GAP_MS / 1_000 - targetGapSeconds) / maxDeviation : 1,
    0.95,
  );
  const gaps = deviations.map(value => targetGapSeconds + value * permittedScale);
  gaps[gaps.length - 1] = CONTINUOUS_HOME_CYCLE_MS / 1_000
    - gaps.slice(0, -1).reduce((sum, gap) => sum + gap, 0);

  const events = [];
  let cursor = random() * CONTINUOUS_HOME_CYCLE_MS;
  for (const gap of gaps) {
    events.push({
      startMs: positiveModulo(cursor, CONTINUOUS_HOME_CYCLE_MS),
      durationMs: CONTINUOUS_BLINK_MIN_DURATION_MS
        + random() * (CONTINUOUS_BLINK_MAX_DURATION_MS - CONTINUOUS_BLINK_MIN_DURATION_MS),
    });
    cursor += gap * 1_000;
  }
  const schedule = events.sort((a, b) => a.startMs - b.startMs);
  if (CONTINUOUS_BLINK_SCHEDULE_CACHE.size >= 16) {
    CONTINUOUS_BLINK_SCHEDULE_CACHE.delete(CONTINUOUS_BLINK_SCHEDULE_CACHE.keys().next().value);
  }
  CONTINUOUS_BLINK_SCHEDULE_CACHE.set(normalized, schedule);
  return schedule;
}

function continuousBlinkAt(timeMs, seed) {
  const phase = positiveModulo(Math.max(0, finiteOr(timeMs, 0)), CONTINUOUS_HOME_CYCLE_MS);
  for (const event of continuousBlinkSchedule(seed)) {
    const elapsed = positiveModulo(phase - event.startMs, CONTINUOUS_HOME_CYCLE_MS);
    if (elapsed >= event.durationMs) continue;
    const half = event.durationMs / 2;
    return elapsed <= half
      ? smoothstep(elapsed / half)
      : smoothstep((event.durationMs - elapsed) / half);
  }
  return 0;
}

function continuousEarSchedule(seed) {
  const normalized = normalizeSeed(seed);
  if (CONTINUOUS_EAR_SCHEDULE_CACHE.has(normalized)) {
    return CONTINUOUS_EAR_SCHEDULE_CACHE.get(normalized);
  }

  const random = seededRandom(cycleSeed(normalized, 0, 0xEA271));
  const schedule = [];
  for (const segment of CONTINUOUS_EAR_SEGMENTS) {
    const span = segment.endMs - segment.startMs;
    const interval = span / (segment.count + 1);
    for (let index = 0; index < segment.count; index += 1) {
      const jitter = (random() - 0.5) * interval * 0.36;
      const startMs = clamp(
        segment.startMs + interval * (index + 1) + jitter,
        segment.startMs + 800,
        segment.endMs - 1_400,
      );
      const direction = random() < 0.5 ? -1 : 1;
      schedule.push({
        startMs,
        durationMs: 600 + random() * 140,
        ear: random() < 0.5 ? 'left' : 'right',
        amount: direction * (0.72 + random() * 0.22),
      });
    }
  }

  schedule.sort((a, b) => a.startMs - b.startMs);
  if (CONTINUOUS_EAR_SCHEDULE_CACHE.size >= 16) {
    CONTINUOUS_EAR_SCHEDULE_CACHE.delete(CONTINUOUS_EAR_SCHEDULE_CACHE.keys().next().value);
  }
  CONTINUOUS_EAR_SCHEDULE_CACHE.set(normalized, schedule);
  return schedule;
}

function continuousEarsAt(timeMs, seed) {
  const phase = positiveModulo(Math.max(0, finiteOr(timeMs, 0)), CONTINUOUS_HOME_CYCLE_MS);
  for (const event of continuousEarSchedule(seed)) {
    const elapsed = positiveModulo(phase - event.startMs, CONTINUOUS_HOME_CYCLE_MS);
    if (elapsed >= event.durationMs) continue;
    const attackMs = event.durationMs * 0.4;
    const envelope = elapsed < attackMs
      ? smoothstep(elapsed / attackMs)
      : 1 - smoothstep((elapsed - attackMs) / (event.durationMs - attackMs));
    const amount = event.amount * envelope;
    return event.ear === 'left'
      ? { left: amount, right: 0 }
      : { left: 0, right: amount };
  }
  return { left: 0, right: 0 };
}

function continuousAttentionAt(timeMs, interaction) {
  if (interaction?.action !== 'greet' || !Number.isFinite(interaction.startedAt)) return null;
  const elapsed = timeMs - interaction.startedAt;
  if (elapsed < 0 || elapsed >= INTERACTION_DURATIONS.greet
    || continuousPoseCategory(interaction.startedAt) === 'standing') return null;
  const enter = smoothstep(elapsed / INTERACTION_ENTER_MS);
  const exit = smoothstep((INTERACTION_DURATIONS.greet - elapsed) / INTERACTION_EXIT_MS);
  const holdElapsed = clamp(elapsed - INTERACTION_ENTER_MS, 0, 1_200);
  return 0.18 * Math.sin((holdElapsed / 1_200) * Math.PI * 2) * Math.min(enter, exit);
}

function decorateContinuousSample(frame, timeMs, interaction, frameCounts, seed) {
  const validInteraction = interaction && ['sit', 'lie', 'greet'].includes(interaction.action)
    && Number.isFinite(interaction.startedAt) && interaction.startedAt >= 0;
  const elapsed = validInteraction
    ? timeMs - interaction.startedAt
    : -1;
  const interactionDuration = validInteraction ? homeInteractionDuration(interaction.action) : 0;
  const inInteraction = elapsed >= 0 && elapsed < interactionDuration;
  const idleClock = elapsed >= interactionDuration && interactionDuration > 0
    ? timeMs - interactionDuration
    : timeMs;
  const blink = !inInteraction && hasCanonicalStationaryPose(frame, frameCounts)
    ? continuousBlinkAt(idleClock, seed)
    : 0;
  let ears = !inInteraction && hasCanonicalStationaryPose(frame, frameCounts)
    ? continuousEarsAt(idleClock, seed)
    : { left: 0, right: 0 };
  if (inInteraction) {
    const anchor = sampleContinuousAutomaticHome(interaction.startedAt, frameCounts, seed);
    const anchorEars = hasCanonicalStationaryPose(anchor, frameCounts)
      ? continuousEarsAt(interaction.startedAt, seed)
      : { left: 0, right: 0 };
    let weight = 0;
    if (elapsed < INTERACTION_ENTER_MS) {
      weight = 1 - smoothstep(elapsed / INTERACTION_ENTER_MS);
    } else if (elapsed >= interactionDuration - CONTINUOUS_EAR_INTERACTION_EXIT_MS) {
      weight = smoothstep((elapsed - (interactionDuration - CONTINUOUS_EAR_INTERACTION_EXIT_MS))
        / CONTINUOUS_EAR_INTERACTION_EXIT_MS);
    }
    ears = weight === 0
      ? { left: 0, right: 0 }
      : { left: anchorEars.left * weight, right: anchorEars.right * weight };
  }
  const breathAt = clock => Math.sin(2 * Math.PI * positiveModulo(Math.max(0, finiteOr(clock, 0)), CONTINUOUS_BREATH_PERIOD_MS) / CONTINUOUS_BREATH_PERIOD_MS) * CONTINUOUS_BREATH_AMPLITUDE;
  let breath = breathAt(idleClock);
  if (inInteraction) {
    // Bring local motion back to the suspended automatic clock as the command
    // finishes; completion can then resume without a one-frame breath jump.
    const returning = smoothstep((elapsed - (interactionDuration - 320)) / 320);
    breath = breath * (1 - returning) + breathAt(interaction.startedAt) * returning;
  }
  const layers = frameLayers(frame);
  const attention = continuousAttentionAt(timeMs, interaction);
  return {
    ...frame,
    layers,
    natural: true,
    prealigned: true,
    blink,
    breath: Math.abs(breath) < 1e-12 ? 0 : breath,
    earLeft: ears.left,
    earRight: ears.right,
    ...(attention === null ? {} : { attention }),
  };
}

function detailedAttentionAt(timeMs, interaction) {
  if (interaction?.action !== 'greet' || !Number.isFinite(interaction.startedAt)) return null;
  const elapsed = timeMs - interaction.startedAt;
  if (elapsed < 0 || elapsed >= INTERACTION_DURATIONS.greet) return null;
  const category = detailedPoseCategory(interaction.startedAt);
  if (category === 'standing') return null;

  const enter = smoothstep(elapsed / INTERACTION_ENTER_MS);
  const exit = smoothstep((INTERACTION_DURATIONS.greet - elapsed) / INTERACTION_EXIT_MS);
  const holdElapsed = clamp(elapsed - INTERACTION_ENTER_MS, 0, 1_200);
  return 0.18 * Math.sin((holdElapsed / 1_200) * Math.PI * 2) * Math.min(enter, exit);
}

function decorateDetailedSample(frame, timeMs, interaction) {
  const cycleTime = positiveModulo(Math.max(0, finiteOr(timeMs, 0)), HOME_CYCLE_MS);
  const breathPhase = 2 * Math.PI * cycleTime / NATURAL_BREATH_PERIOD_MS;
  const blinkPhase = positiveModulo(cycleTime, NATURAL_BLINK_PERIOD_MS);
  const interactionElapsed = interaction && Number.isFinite(interaction.startedAt)
    ? timeMs - interaction.startedAt
    : -1;
  const inInteraction = ['sit', 'lie', 'greet'].includes(interaction?.action)
    && interactionElapsed >= 0
    && interactionElapsed < homeInteractionDuration(interaction.action);
  let blink = 0;
  if (!inInteraction && hasCanonicalStationaryPose(frame)
    && blinkPhase < NATURAL_BLINK_DURATION_MS) {
    const halfDuration = NATURAL_BLINK_DURATION_MS / 2;
    blink = blinkPhase <= halfDuration
      ? smoothstep(blinkPhase / halfDuration)
      : smoothstep((NATURAL_BLINK_DURATION_MS - blinkPhase) / halfDuration);
  }

  const attention = detailedAttentionAt(timeMs, interaction);
  const breath = Math.sin(breathPhase);
  return {
    ...frame,
    natural: true,
    blink,
    breath: Math.abs(breath) < 1e-12 ? 0 : breath,
    earLeft: 0,
    earRight: 0,
    ...(attention === null ? {} : { attention }),
  };
}

function sampleDetailedInteraction(timeMs, interaction) {
  if (!interaction || !['sit', 'lie', 'greet'].includes(interaction.action)
    || !Number.isFinite(interaction.startedAt) || interaction.startedAt < 0) return null;

  const elapsedMs = timeMs - interaction.startedAt;
  if (elapsedMs < 0) return null;
  const anchor = sampleDetailedAutomaticHome(interaction.startedAt);
  const duration = homeInteractionDuration(interaction.action);
  if (elapsedMs >= duration) {
    const resumed = sampleDetailedAutomaticHome(interaction.startedAt + elapsedMs - duration);
    if (elapsedMs === duration) resumed.layers = frameLayers(resumed);
    return resumed;
  }

  const category = detailedPoseCategory(interaction.startedAt);
  if (interaction.action === 'greet') return sampleDetailedGreeting(anchor, category, elapsedMs);

  const route = detailedInteractionRoute(interaction.action, category);
  const routeStart = route.routeStartFrame;
  if (elapsedMs < INTERACTION_ENTER_MS) {
    return interactionBlendFrame(anchor, routeStart,
      smoothstep(elapsedMs / INTERACTION_ENTER_MS), `interaction-${interaction.action}-enter`);
  }

  const routeElapsed = elapsedMs - INTERACTION_ENTER_MS;
  if (routeElapsed < route.outMs) {
    return sampleMotionPlan(route.motions, routeElapsed, route.outMs,
      routeStart, route.targetFrame, `interaction-${interaction.action}`);
  }
  if (routeElapsed < route.outMs + route.holdMs) return route.targetFrame;

  const returnElapsed = routeElapsed - route.outMs - route.holdMs;
  if (returnElapsed < route.returnMs) {
    return sampleMotionPlan(route.returnMotions, returnElapsed, route.returnMs,
      route.targetFrame, routeStart, `interaction-${interaction.action}-return`);
  }

  return interactionBlendFrame(routeStart, anchor,
    smoothstep((returnElapsed - route.returnMs) / INTERACTION_EXIT_MS),
    `interaction-${interaction.action}-return`);
}

function sampleInteraction(timeMs, interaction) {
  if (!interaction || !['sit', 'lie', 'greet'].includes(interaction.action) || !Number.isFinite(interaction.startedAt) || interaction.startedAt < 0) return null;

  const elapsedMs = timeMs - interaction.startedAt;
  if (elapsedMs < 0) return null;
  const anchor = sampleAutomaticHome(interaction.startedAt);
  const route = interactionRoute(interaction.action, anchor);
  if (!route) return null;
  const durationMs = homeInteractionDuration(interaction.action);

  if (elapsedMs >= durationMs) {
    const resumed = sampleAutomaticHome(interaction.startedAt + elapsedMs - durationMs);
    if (elapsedMs === durationMs) resumed.layers = frameLayers(resumed);
    return resumed;
  }

  if (interaction.action === 'greet') {
    const target = homeFrame(route.atlas, route.targetIndex, route.targetIndex, 0, 'interaction-greet');
    if (elapsedMs < INTERACTION_ENTER_MS) {
      return interactionBlendFrame(anchor, target,
        clamp(elapsedMs / INTERACTION_ENTER_MS, 0, 1), 'interaction-greet-enter');
    }
    if (elapsedMs < INTERACTION_ENTER_MS + route.holdMs) {
      const holdElapsedMs = elapsedMs - INTERACTION_ENTER_MS;
      if (route.greetingKind === 'lie' && holdElapsedMs >= 460 && holdElapsedMs < 600) {
        const blink = authoredPath([8, 9, 8], holdElapsedMs - 460, 140, 70);
        return homeFrame('postures', blink.index, blink.nextIndex, blink.mix, 'interaction-greet-blink');
      }
      return target;
    }
    return interactionBlendFrame(target, anchor,
      clamp((elapsedMs - INTERACTION_ENTER_MS - route.holdMs) / INTERACTION_EXIT_MS, 0, 1), 'interaction-greet-return');
  }

  const routeStart = homeFrame(route.atlas, route.path[0], route.path[0], 0, 'interaction-enter-pose');
  if (elapsedMs < INTERACTION_ENTER_MS) {
    return interactionBlendFrame(anchor, routeStart,
      clamp(elapsedMs / INTERACTION_ENTER_MS, 0, 1), `interaction-${interaction.action}-enter`);
  }

  const routeElapsedMs = elapsedMs - INTERACTION_ENTER_MS;
  if (routeElapsedMs < route.outMs) {
    return postureTransition(route.path, routeElapsedMs, route.outMs, transitionAction);
  }
  if (routeElapsedMs < route.outMs + route.holdMs) {
    return homeFrame(route.atlas, route.targetIndex, route.targetIndex, 0, `interaction-${interaction.action}`);
  }

  const returnElapsedMs = routeElapsedMs - route.outMs - route.holdMs;
  if (returnElapsedMs < route.returnMs) {
    return postureTransition(reversePath(route.path), returnElapsedMs, route.returnMs, transitionAction);
  }
  const sourceIndex = route.path[0];
  const exitElapsedMs = returnElapsedMs - route.returnMs;
  const routeStartPose = homeFrame(route.atlas, sourceIndex, sourceIndex, 0, `interaction-${interaction.action}-return`);
  return interactionBlendFrame(routeStartPose, anchor,
    clamp(exitElapsedMs / INTERACTION_EXIT_MS, 0, 1), `interaction-${interaction.action}-return`);
}

/** Samples a cyclic walk clip from traveled distance. `phase` is normalized to [0, 1). */
export function sampleWalk(options = {}) {
  const { distance = 0, strideLength = DEFAULT_STRIDE_LENGTH, frameCount = DEFAULT_FRAME_COUNT, reducedMotion = false } =
    options && typeof options === 'object' ? options : {};
  const count = frameCountOrDefault(frameCount);
  const distanceValue = finiteOr(distance, 0);
  const strideValue = Number.isFinite(strideLength) && strideLength > 0
    ? strideLength
    : DEFAULT_STRIDE_LENGTH;
  if (reducedMotion || count === 1) {
    return { index: 0, nextIndex: 0, mix: 0, phase: 0 };
  }

  const wrappedDistance = positiveModulo(distanceValue, strideValue);
  const phase = Math.min(1 - Number.EPSILON, wrappedDistance / strideValue);
  const framePosition = phase * count;
  const nearestFrame = Math.round(framePosition);
  const stableFramePosition = Math.abs(framePosition - nearestFrame) < 1e-12 ? nearestFrame : framePosition;
  const index = Math.min(count - 1, Math.floor(stableFramePosition));
  const rawMix = stableFramePosition - index;
  const mix = rawMix < 1e-12 ? 0 : rawMix;
  return { index, nextIndex: (index + 1) % count, mix, phase };
}

export function homeInteractionDuration(action) {
  return INTERACTION_DURATIONS[action] ?? 0;
}

/** Samples the legacy, detailed, or optional 72-second continuous home loop. */
export function sampleHome(timeMs, options = {}) {
  const { reducedMotion = false, interaction = null, detailedMotion = false,
    continuousMotion = false, frameCounts = null, seed = 42, heldFrame = null } =
    options && typeof options === 'object' ? options : {};
  const time = finiteOr(timeMs, 0);
  if (reducedMotion) {
    if (continuousMotion === true) {
      if (heldFrame && typeof heldFrame === 'object') {
        return {
          ...heldFrame,
          layers: frameLayers(heldFrame),
          natural: true,
          prealigned: true,
          blink: 0,
          breath: 0,
          earLeft: 0,
          earRight: 0,
          headAngle: 0,
          headLift: 0,
        };
      }
      return {
        ...homeFrame('sitdown', 0, 0, 0, 'stand-idle'),
        layers: [{ atlas: 'sitdown', index: 0, weight: 1, prealigned: true }],
        natural: true,
        prealigned: true,
        blink: 0,
        breath: 0,
        earLeft: 0,
        earRight: 0,
      };
    }
    return homeFrame('expressions', 0, 0, 0, 'stand-idle');
  }
  if (continuousMotion === true) {
    const frame = heldFrame && typeof heldFrame === 'object'
      ? heldFrame
      : sampleContinuousInteraction(time, interaction, frameCounts, seed)
        ?? sampleContinuousAutomaticHome(time, frameCounts, seed);
    return decorateContinuousSample(frame, time, heldFrame ? null : interaction, frameCounts, seed);
  }
  if (detailedMotion === true) {
    const frame = sampleDetailedInteraction(time, interaction) ?? sampleDetailedAutomaticHome(time);
    return decorateDetailedSample(frame, time, interaction);
  }
  return sampleInteraction(time, interaction) ?? sampleAutomaticHome(time);
}
