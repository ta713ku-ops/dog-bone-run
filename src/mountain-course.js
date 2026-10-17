import { CONFIG } from './config.js';

const DURATION_MS = 30_000;
const SPEED = 1.25;
const RULE_VERSION = 'mountain30-level3-v1';
const COURSE_VERSION = 'mountain-level3-course-1';
const LANES = Object.freeze([-1, 0, 1]);
const EVENT_COUNT = 39;
const EVENT_START_MS = 2_600;
const EVENT_END_MS = 28_440;
// The eleven two-step edge-to-edge transitions get a wider window. The
// remaining gaps stay long enough for one lane change with an individual
// +/-40ms timing error and leave additional room for frame scheduling.
const STONE_PAIR_GAP_MS = 900;
const NORMAL_GAP_COUNT = 27;
const NORMAL_GAP_MS = (EVENT_END_MS - EVENT_START_MS - 11 * STONE_PAIR_GAP_MS) / NORMAL_GAP_COUNT;
const VISIBLE_LEAD_MS = 1_400;
const STONE_PASS_MARGIN_MS = (CONFIG.dogHalfLength + CONFIG.obstacleHalfLength) * 1000 / SPEED;
const BONE_PASS_MARGIN_MS = (CONFIG.dogHalfLength + CONFIG.boneHalfLength) * 1000 / SPEED;
const LATERAL_CONTACT = CONFIG.dogHalfWidth + CONFIG.obstacleHalfWidth;

function normalizeSeed(seed) {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function makeEvents(seed, random) {
  const stoneEventIndices = Array.from({ length: 12 }, (_, index) => 2 + index * 3);
  const stoneEvents = new Set(stoneEventIndices);
  const staticIndices = Array.from({ length: EVENT_COUNT }, (_, index) => index).filter(index => !stoneEvents.has(index));
  const pairEvents = new Set(shuffled(staticIndices, random).slice(0, 18));
  const stoneSafeLanes = new Map(stoneEventIndices.map(index => [index, random() < 0.5 ? -1 : 1]));
  const safeLanes = Array(EVENT_COUNT).fill(null);
  safeLanes[0] = -stoneSafeLanes.get(stoneEventIndices[0]);
  safeLanes[1] = 0;
  for (let ordinal = 0; ordinal < stoneEventIndices.length - 1; ordinal++) {
    const index = stoneEventIndices[ordinal];
    const current = stoneSafeLanes.get(index);
    const nextIndex = stoneEventIndices[ordinal + 1];
    const next = stoneSafeLanes.get(nextIndex);
    safeLanes[index] = current;
    if (next === current) {
      safeLanes[index + 1] = -current;
      safeLanes[index + 2] = 0;
    } else {
      safeLanes[index + 1] = 0;
      safeLanes[index + 2] = current;
    }
  }
  const lastStoneIndex = stoneEventIndices.at(-1);
  const lastStoneLane = stoneSafeLanes.get(lastStoneIndex);
  safeLanes[lastStoneIndex] = lastStoneLane;
  safeLanes[lastStoneIndex + 1] = 0;
  safeLanes[lastStoneIndex + 2] = lastStoneLane;
  safeLanes[lastStoneIndex + 3] = 0;

  const wideGapIndices = [];
  for (let ordinal = 0; ordinal < stoneEventIndices.length - 1; ordinal++) {
    const index = stoneEventIndices[ordinal];
    const current = stoneSafeLanes.get(index);
    const next = stoneSafeLanes.get(stoneEventIndices[ordinal + 1]);
    wideGapIndices.push(next === current ? index : index + 2);
  }
  const wideGaps = new Set(wideGapIndices);
  const arrivals = [EVENT_START_MS];
  for (let index = 0; index < EVENT_COUNT - 1; index++) {
    const gapMs = wideGaps.has(index) ? STONE_PAIR_GAP_MS : NORMAL_GAP_MS;
    arrivals.push(arrivals.at(-1) + gapMs);
  }

  const events = Array.from({ length: EVENT_COUNT }, (_, index) => {
    const arrivalMs = arrivals[index];
    if (stoneEvents.has(index)) {
      const safeLane = stoneSafeLanes.get(index);
      const otherLanes = safeLane < 0 ? [0, 1] : [-1, 0];
      const reverse = random() < 0.5;
      const fromLane = reverse ? otherLanes[1] : otherLanes[0];
      const toLane = reverse ? otherLanes[0] : otherLanes[1];
      const moveEndMs = arrivalMs + (random() < 0.5 ? 200 : 300);
      return { index, arrivalMs, kind: 'rollingStone', safeLane, fromLane, toLane, moveEndMs };
    }
    return {
      index,
      arrivalMs,
      kind: pairEvents.has(index) ? 'pair' : 'single',
      safeLane: safeLanes[index],
    };
  });
  return { events, stoneEventIndices, pairEvents, wideGapIndices };
}

function makeSafeRoute(events) {
  const eventLanes = events.map(event => event.safeLane);
  const safeInputs = [];
  let previousLane = 0;
  if (eventLanes[0] !== previousLane) {
    safeInputs.push({ timeMs: events[0].arrivalMs - 500, direction: eventLanes[0] });
    previousLane = eventLanes[0];
  }
  for (let index = 0; index < events.length - 1; index++) {
    const lane = eventLanes[index + 1];
    const gapMs = events[index + 1].arrivalMs - events[index].arrivalMs;
    const direction = Math.sign(lane - previousLane);
    if (Math.abs(lane - previousLane) === 2) {
      safeInputs.push({ timeMs: events[index].arrivalMs + 210, direction: -previousLane });
      safeInputs.push({ timeMs: events[index].arrivalMs + 460, direction: lane });
    } else if (lane !== previousLane) {
      safeInputs.push({ timeMs: events[index].arrivalMs + (gapMs - CONFIG.moveMs) / 2, direction });
    }
    previousLane = lane;
  }
  return { eventLanes, safeInputs };
}

function makeBoneTimes(events, eventLanes, wideGapIndices, random) {
  const rows = [{ timeMs: 1_700, lane: 0, source: 'intro' }];
  for (let index = 0; index < events.length; index++) {
    rows.push({ timeMs: events[index].arrivalMs, lane: eventLanes[index], source: 'event' });
  }
  for (const index of shuffled(wideGapIndices, random).slice(0, 8)) {
    rows.push({
      timeMs: events[index].arrivalMs + 400,
      lane: 0,
      source: 'detour',
    });
  }
  rows.sort((a, b) => a.timeMs - b.timeMs);
  return rows.map((bone, index) => ({
    id: `mountain-bone-${String(index + 1).padStart(3, '0')}`,
    lane: bone.lane,
    timeMs: bone.timeMs,
    distance: bone.timeMs * SPEED / 1000,
    kind: 'normal',
  }));
}

function assignGold(bones) {
  const targets = [8_000, 17_000, 26_000];
  const selected = new Set();
  for (const target of targets) {
    const bone = bones.reduce((closest, current) => {
      if (selected.has(current.id)) return closest;
      return Math.abs(current.timeMs - target) < Math.abs(closest.timeMs - target) ? current : closest;
    }, bones.find(item => !selected.has(item.id)));
    bone.kind = 'gold';
    selected.add(bone.id);
  }
  return [...selected];
}

function createStaticObstacles(event, eventIndex, obstacleIndex, random) {
  const blockedLanes = LANES.filter(lane => lane !== event.safeLane);
  const obstacleLanes = event.kind === 'pair' ? blockedLanes : [blockedLanes[Math.floor(random() * blockedLanes.length)]];
  const types = shuffled(['root', 'rock', 'log'], random);
  return obstacleLanes.map((lane, offset) => ({
    id: `mountain-obstacle-${String(obstacleIndex + offset).padStart(3, '0')}`,
    eventId: `mountain-event-${String(eventIndex + 1).padStart(2, '0')}`,
    type: types[offset % types.length],
    lane,
    arrivalMs: event.arrivalMs,
    visibleStartMs: event.arrivalMs - VISIBLE_LEAD_MS,
    distance: event.arrivalMs * SPEED / 1000,
  }));
}

function createRollingStone(event, eventIndex, obstacleIndex) {
  const visibleStartMs = event.arrivalMs - VISIBLE_LEAD_MS;
  return {
    id: `mountain-obstacle-${String(obstacleIndex).padStart(3, '0')}`,
    eventId: `mountain-event-${String(eventIndex + 1).padStart(2, '0')}`,
    type: 'rollingStone',
    lane: event.fromLane,
    fromLane: event.fromLane,
    toLane: event.toLane,
    arrivalMs: event.arrivalMs,
    visibleStartMs,
    moveStartMs: visibleStartMs,
    moveEndMs: event.moveEndMs,
    distance: event.arrivalMs * SPEED / 1000,
  };
}

function routeLaneAt(segments, timeMs) {
  for (const segment of segments) {
    if (timeMs < segment.startMs - 1e-8 || timeMs > segment.endMs + 1e-8) continue;
    if (segment.endMs === segment.startMs) return segment.toLane;
    const progress = Math.max(0, Math.min(1, (timeMs - segment.startMs) / (segment.endMs - segment.startMs)));
    return segment.fromLane + (segment.toLane - segment.fromLane) * progress;
  }
  return timeMs < 0 ? 0 : (segments.at(-1)?.toLane ?? 0);
}

function routeSegments(safeInputs) {
  const segments = [];
  let lane = 0;
  let cursorMs = 0;
  for (const input of safeInputs) {
    const toLane = lane + input.direction;
    if (!LANES.includes(toLane) || input.timeMs < cursorMs - 1e-8) return null;
    if (input.timeMs > cursorMs) segments.push({ startMs: cursorMs, endMs: input.timeMs, fromLane: lane, toLane: lane });
    segments.push({ startMs: input.timeMs, endMs: input.timeMs + CONFIG.moveMs, fromLane: lane, toLane });
    lane = toLane;
    cursorMs = input.timeMs + CONFIG.moveMs;
  }
  segments.push({ startMs: cursorMs, endMs: DURATION_MS, fromLane: lane, toLane: lane });
  return segments;
}

function minRelativeLaneDistance(segments, obstacle, startMs, endMs) {
  const points = new Set([startMs, endMs]);
  for (const segment of segments) {
    if (segment.startMs > startMs && segment.startMs < endMs) points.add(segment.startMs);
    if (segment.endMs > startMs && segment.endMs < endMs) points.add(segment.endMs);
  }
  if (obstacle.type === 'rollingStone') {
    if (obstacle.moveStartMs > startMs && obstacle.moveStartMs < endMs) points.add(obstacle.moveStartMs);
    if (obstacle.moveEndMs > startMs && obstacle.moveEndMs < endMs) points.add(obstacle.moveEndMs);
  }
  const sorted = [...points].sort((a, b) => a - b);
  let closest = Infinity;
  for (let index = 0; index < sorted.length; index++) {
    const timeMs = sorted[index];
    const relative = routeLaneAt(segments, timeMs) - mountainObstacleLaneAt(obstacle, timeMs);
    closest = Math.min(closest, Math.abs(relative));
    if (index === sorted.length - 1) continue;
    const nextTimeMs = sorted[index + 1];
    const nextRelative = routeLaneAt(segments, nextTimeMs) - mountainObstacleLaneAt(obstacle, nextTimeMs);
    if (relative === nextRelative) continue;
    const crossing = -relative / (nextRelative - relative);
    if (crossing >= 0 && crossing <= 1) closest = 0;
  }
  return closest;
}

function validateCourse(course) {
  const { bones, obstacles, safeInputs } = course;
  if (bones.length !== 48 || bones.filter(bone => bone.kind === 'gold').length !== 3) return false;
  if (obstacles.length !== 57 || new Set(obstacles.map(item => item.eventId)).size !== 39) return false;
  const groups = new Map();
  for (const obstacle of obstacles) groups.set(obstacle.eventId, [...(groups.get(obstacle.eventId) ?? []), obstacle]);
  if ([...groups.values()].filter(items => items.length === 2 && items.every(item => item.type !== 'rollingStone')).length !== 18) return false;
  if ([...groups.values()].filter(items => items.length === 1 && items[0].type === 'rollingStone').length !== 12) return false;
  if ([...groups.values()].filter(items => items.length === 1 && items[0].type !== 'rollingStone').length !== 9) return false;

  const segments = routeSegments(safeInputs);
  if (!segments) return false;
  for (const bone of bones) {
    const startMs = bone.timeMs - BONE_PASS_MARGIN_MS;
    const endMs = bone.timeMs + BONE_PASS_MARGIN_MS;
    const points = new Set([startMs, endMs]);
    for (const segment of segments) {
      if (segment.startMs > startMs && segment.startMs < endMs) points.add(segment.startMs);
      if (segment.endMs > startMs && segment.endMs < endMs) points.add(segment.endMs);
    }
    const closest = Math.min(...[...points].map(timeMs => Math.abs(routeLaneAt(segments, timeMs) - bone.lane)));
    if (closest > CONFIG.dogHalfWidth + CONFIG.boneHalfWidth + 1e-9) return false;
  }
  for (const obstacle of obstacles) {
    const startMs = obstacle.arrivalMs - STONE_PASS_MARGIN_MS;
    const endMs = obstacle.arrivalMs + STONE_PASS_MARGIN_MS;
    if (minRelativeLaneDistance(segments, obstacle, startMs, endMs) <= LATERAL_CONTACT + 1e-9) return false;
  }
  return true;
}

export function createMountainCourse(seed = 1) {
  const normalizedSeed = normalizeSeed(seed);
  const random = seededRandom(normalizedSeed);
  const { events, stoneEventIndices, pairEvents, wideGapIndices } = makeEvents(normalizedSeed, random);
  const { eventLanes, safeInputs } = makeSafeRoute(events);
  const bones = makeBoneTimes(events, eventLanes, wideGapIndices, random);
  const goldIds = assignGold(bones);
  const obstacles = [];
  let obstacleIndex = 1;
  for (const event of events) {
    const rows = event.kind === 'rollingStone'
      ? [createRollingStone(event, event.index, obstacleIndex)]
      : createStaticObstacles(event, event.index, obstacleIndex, random);
    obstacles.push(...rows);
    obstacleIndex += rows.length;
  }

  const course = {
    seed: normalizedSeed,
    ruleVersion: RULE_VERSION,
    courseVersion: COURSE_VERSION,
    bones,
    obstacles,
    goldCandidates: [...goldIds],
    goldIds,
    safeInputs,
    generation: {
      generator: 'seeded-mountain-route-v1',
      attempts: 1,
      fallback: false,
      fallbackReason: null,
      safeInputCount: safeInputs.length,
      boneLaneChanges: bones.reduce((count, bone, index) => count + Number(index > 0 && bone.lane !== bones[index - 1].lane), 0),
      pairEventCount: pairEvents.size,
      movingStoneCount: stoneEventIndices.length,
      singleEventCount: EVENT_COUNT - stoneEventIndices.length - pairEvents.size,
      twoStepDetourCount: wideGapIndices.length,
    },
  };
  if (!validateCourse(course)) throw new Error(`generated mountain course failed validation for seed ${normalizedSeed}`);
  return course;
}

export function mountainObstacleLaneAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return obstacle?.lane ?? 0;
  if (obstacle.type !== 'rollingStone' || !Number.isFinite(obstacle.moveStartMs) || !Number.isFinite(obstacle.moveEndMs)) {
    return obstacle.lane ?? 0;
  }
  if (timeMs <= obstacle.moveStartMs) return obstacle.fromLane;
  if (timeMs >= obstacle.moveEndMs) return obstacle.toLane;
  const progress = (timeMs - obstacle.moveStartMs) / (obstacle.moveEndMs - obstacle.moveStartMs);
  return obstacle.fromLane + (obstacle.toLane - obstacle.fromLane) * progress;
}

export function mountainObstacleActiveAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return false;
  const visibleStartMs = obstacle.visibleStartMs ?? -Infinity;
  return timeMs >= visibleStartMs && timeMs <= obstacle.arrivalMs + STONE_PASS_MARGIN_MS;
}

export function mountainObstacleVisibleAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return false;
  const visibleStartMs = obstacle.visibleStartMs ?? -Infinity;
  const visibleEndMs = obstacle.type === 'rollingStone'
    // Keep the stone after its lateral roll. Forward travel then carries the
    // complete body below the viewport instead of removing it at the feet.
    ? Math.max(obstacle.moveEndMs, obstacle.arrivalMs + 600)
    : obstacle.arrivalMs + STONE_PASS_MARGIN_MS;
  return timeMs >= visibleStartMs && timeMs <= visibleEndMs;
}

export const MOUNTAIN_LEVEL3 = Object.freeze({
  durationMs: DURATION_MS,
  speed: SPEED,
  ruleVersion: RULE_VERSION,
  courseVersion: COURSE_VERSION,
  eventCount: EVENT_COUNT,
  obstacleCount: 57,
});
