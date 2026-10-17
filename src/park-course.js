import { CONFIG } from './config.js';
import { PARK_FALLBACK_COURSE } from './park-fallback-course.js';

const PARK_DURATION_MS = 30_000;
const PARK_SPEED = 1.1;
const GOLD_TARGETS_MS = Object.freeze([8_000, 17_000, 26_000]);
const LANES = Object.freeze([-1, 0, 1]);
const PARK_RULE_VERSION = 'park30-level2-v2';
const PARK_COURSE_VERSION = 'park-level2-course-2';
const CONTACT_HALF_MS = (CONFIG.dogHalfLength + CONFIG.obstacleHalfLength) * 1000 / PARK_SPEED;
const LATERAL_CONTACT = CONFIG.dogHalfWidth + CONFIG.obstacleHalfWidth;
const VISIBLE_LEAD_MS = 1_800;
const PASS_MARGIN_MS = CONTACT_HALF_MS;
const TEMPLATE_COUNT = 16;
const FALLBACK_LAYOUT_SEED = 0;
const PARK_DEBUG = Boolean(globalThis.process?.env?.PARK_DEBUG);

function rejectBuild(reason) {
  if (PARK_DEBUG) console.error(`park build rejected: ${reason}`);
  return null;
}

// The wider gaps are the six windows where a safe route leaves the bone lane,
// waits out a hazard, and returns before the next bone.
const SEGMENT_BONE_TIMES = Object.freeze([
  Object.freeze([1_600, 2_400]),
  Object.freeze([3_000, 3_900, 4_800, 5_300, 5_800, 6_700, 7_200, 8_100, 8_600, 9_100, 9_600]),
  Object.freeze([10_100, 10_600, 11_100, 11_600, 12_100, 12_600, 13_100, 13_600, 14_100, 14_600,
    15_100, 15_600, 16_100, 16_600, 17_100, 17_600, 18_100, 19_050]),
  Object.freeze([20_000, 20_500, 21_000, 21_500, 22_000, 22_500, 23_000, 23_800, 24_300, 24_800,
    25_300, 25_800, 26_300, 26_800, 27_600, 28_100, 29_000]),
]);

const SCENES = Object.freeze([
  // 3–10s: four single-puddle trap scenes and the first two crows.
  { arrivalMs: 3_450, kind: 'puddle-trap', trapEdge: 2 },
  { arrivalMs: 4_200, kind: 'puddle-trap', trapEdge: 3 },
  { arrivalMs: 5_400, kind: 'crow' },
  { arrivalMs: 6_150, kind: 'puddle-trap', trapEdge: 6 },
  { arrivalMs: 7_650, kind: 'puddle-trap', trapEdge: 8 },
  { arrivalMs: 8_400, kind: 'crow' },
  // 10–20s: three puddle pairs and one single, with three crows and balls.
  { arrivalMs: 10_000, kind: 'puddle-pair' },
  { arrivalMs: 10_750, kind: 'ball' },
  { arrivalMs: 11_950, kind: 'crow' },
  { arrivalMs: 12_700, kind: 'puddle-pair' },
  { arrivalMs: 13_900, kind: 'ball' },
  { arrivalMs: 14_650, kind: 'crow' },
  { arrivalMs: 15_850, kind: 'puddle-pair' },
  { arrivalMs: 16_600, kind: 'ball' },
  { arrivalMs: 17_800, kind: 'crow' },
  { arrivalMs: 18_550, kind: 'puddle-trap', trapEdge: 29 },
  // 20–30s: three pairs and one single; the final scene is before 28.6s.
  { arrivalMs: 20_000, kind: 'puddle-pair' },
  { arrivalMs: 20_750, kind: 'ball' },
  { arrivalMs: 21_950, kind: 'crow' },
  { arrivalMs: 22_700, kind: 'puddle-pair' },
  { arrivalMs: 23_900, kind: 'ball' },
  { arrivalMs: 24_650, kind: 'crow' },
  { arrivalMs: 25_850, kind: 'puddle-pair' },
  { arrivalMs: 26_600, kind: 'ball' },
  { arrivalMs: 27_800, kind: 'crow' },
  { arrivalMs: 28_550, kind: 'puddle-trap', trapEdge: 46 },
]);

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

function mirrorLane(lane, mirror) { return mirror ? -lane : lane; }

function allBoneTimes() {
  return SEGMENT_BONE_TIMES.flat();
}

function safeBoneInputWindows(times, edge) {
  const lower = times[edge] - 8;
  const upper = times[edge + 1] - 260;
  if (lower > upper) return [];
  let windows = [[lower, upper]];
  for (const scene of SCENES.filter(item => item.kind !== 'puddle-trap')) {
    // A lane change must cross the contact window outside its lateral hitbox.
    // The independent ±60 ms input margin is applied to the midpoint bounds.
    // Balls cross lanes during their full movement, so keep the more
    // conservative whole-move exclusion for them. Puddle traps are excluded
    // here because their explicit avoid/return inputs have separate windows.
    const blockedStart = scene.arrivalMs - CONTACT_HALF_MS -
      (scene.kind === 'ball' ? CONFIG.moveMs : CONFIG.moveMs / 2) - 60;
    const blockedEnd = scene.arrivalMs + CONTACT_HALF_MS -
      (scene.kind === 'ball' ? 0 : CONFIG.moveMs / 2) + 60;
    windows = windows.flatMap(([start, end]) => {
      if (end < blockedStart - 1e-9 || start > blockedEnd + 1e-9) return [[start, end]];
      const split = [];
      if (start < blockedStart - 1e-6) split.push([start, blockedStart - 1e-3]);
      if (end > blockedEnd + 1e-6) split.push([blockedEnd + 1e-3, end]);
      return split.filter(([a, b]) => a <= b);
    });
    if (!windows.length) return [];
  }
  return windows;
}

function makeBoneLanes(random, mirror) {
  const times = allBoneTimes();
  const detourEdges = new Set(SCENES.filter(scene => scene.trapEdge !== undefined).map(scene => scene.trapEdge));
  const laneHoldEdges = new Set(detourEdges);
  const allowed = times.map(() => [...LANES]);
  for (const scene of SCENES.filter(item => item.kind === 'ball')) {
    const preferredLane = random() < 0.5 ? -1 : 1;
    const contactStart = scene.arrivalMs - CONTACT_HALF_MS;
    const contactEnd = scene.arrivalMs + CONTACT_HALF_MS;
    let laneIndex = 0;
    for (let index = 0; index < times.length; index++) {
      if (times[index] <= contactStart) laneIndex = index;
      else break;
    }
    let releaseIndex = laneIndex;
    while (releaseIndex < times.length - 1 && times[releaseIndex + 1] <= contactEnd) releaseIndex++;
    for (let index = laneIndex; index <= releaseIndex; index++) allowed[index] = [preferredLane];
  }
  for (let edge = 0; edge < times.length - 1; edge++) {
    if (!safeBoneInputWindows(times, edge).length) laneHoldEdges.add(edge);
  }
  allowed[0] = [0];

  const targetChangeCounts = Array.from({ length: 9 }, (_, index) => index + 26);
  const memo = new Map();
  const ways = (index, previousLane, remainingChanges) => {
    if (remainingChanges < 0 || remainingChanges > times.length - index) return 0n;
    if (index === times.length) return remainingChanges === 0 ? 1n : 0n;
    const key = `${index}:${previousLane}:${remainingChanges}`;
    if (memo.has(key)) return memo.get(key);
    let total = 0n;
    for (const lane of allowed[index]) {
      if (Math.abs(lane - previousLane) > 1) continue;
      if (laneHoldEdges.has(index - 1) && lane !== previousLane) continue;
      total += ways(index + 1, lane, remainingChanges - Number(lane !== previousLane));
    }
    memo.set(key, total);
    return total;
  };
  const possibleCounts = targetChangeCounts.filter(candidate => ways(1, 0, candidate) > 0n);
  if (!possibleCounts.length) {
    if (PARK_DEBUG) {
      const reachable = Array.from({ length: times.length }, (_, candidate) => candidate)
        .filter(candidate => ways(1, 0, candidate) > 0n);
      console.error(`no target lane counts; reachable ${reachable.join(',')}`);
    }
    return { lanes: [], detourEdges, changeCount: 0 };
  }
  const changeCount = possibleCounts[Math.floor(random() * possibleCounts.length)];
  const sourceLanes = [0];
  let previousLane = 0;
  let remainingChanges = changeCount;
  for (let index = 1; index < times.length; index++) {
    const choices = allowed[index].filter(lane => Math.abs(lane - previousLane) <= 1 &&
      !(laneHoldEdges.has(index - 1) && lane !== previousLane));
    const feasible = choices.map(lane => ({ lane, weight: ways(index + 1, lane, remainingChanges - Number(lane !== previousLane)) }))
      .filter(choice => choice.weight > 0n);
    if (!feasible.length) return { lanes: [], detourEdges, changeCount: 0 };
    const totalWeight = feasible.reduce((total, choice) => total + Number(choice.weight), 0);
    let roll = random() * totalWeight;
    const selected = feasible.find(choice => (roll -= Number(choice.weight)) < 0) ?? feasible.at(-1);
    sourceLanes.push(selected.lane);
    remainingChanges -= Number(selected.lane !== previousLane);
    previousLane = selected.lane;
  }
  return { lanes: sourceLanes.map(lane => mirrorLane(lane, mirror)), detourEdges, changeCount };
}

function makeSafeInputs(bones, detourEdges, random, mirror) {
  const inputs = [];
  const boneTimes = bones.map(bone => bone.timeMs);
  for (let index = 0; index < bones.length; index++) {
    const bone = bones[index];
    if (index > 0 && bone.lane !== bones[index - 1].lane) {
      const windows = safeBoneInputWindows(boneTimes, index - 1);
      if (!windows.length) return [];
      const preferred = bone.timeMs - 300;
      const distances = windows.map(([start, end]) => Math.max(start, Math.min(end, preferred)));
      const distance = Math.min(...distances.map(timeMs => Math.abs(timeMs - preferred)));
      const candidates = distances.filter(timeMs => Math.abs(Math.abs(timeMs - preferred) - distance) < 1e-6);
      const timeMs = candidates[Math.floor(random() * candidates.length)];
      inputs.push({ timeMs, direction: Math.sign(bone.lane - bones[index - 1].lane), reason: 'bone' });
    }
    if (!detourEdges.has(index) || index === bones.length - 1) continue;
    const lane = bone.lane;
    let detourLane = lane === 0 ? (random() < 0.5 ? -1 : 1) : 0;
    detourLane = mirrorLane(detourLane, mirror);
    const scene = SCENES.find(item => item.trapEdge === index);
    if (!scene) return [];
    inputs.push({ timeMs: scene.arrivalMs - 350, direction: Math.sign(detourLane - lane), reason: 'avoid' });
    inputs.push({ timeMs: scene.arrivalMs + 120, direction: Math.sign(lane - detourLane), reason: 'return' });
  }
  inputs.sort((a, b) => a.timeMs - b.timeMs || a.direction - b.direction);
  return inputs;
}

function routeSegments(safeInputs) {
  let lane = 0;
  let cursorMs = 0;
  const segments = [];
  for (const input of safeInputs) {
    const to = lane + input.direction;
    if (input.timeMs < cursorMs - 1e-8 || !LANES.includes(to)) return null;
    segments.push({ startMs: cursorMs, endMs: input.timeMs, fromLane: lane, toLane: lane });
    segments.push({ startMs: input.timeMs, endMs: input.timeMs + CONFIG.moveMs, fromLane: lane, toLane: to });
    lane = to;
    cursorMs = input.timeMs + CONFIG.moveMs;
  }
  segments.push({ startMs: cursorMs, endMs: PARK_DURATION_MS, fromLane: lane, toLane: lane });
  return segments;
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

function minRelativeLaneDistance(segments, obstacle, startMs, endMs) {
  const points = new Set([startMs, endMs]);
  for (const segment of segments) {
    if (segment.startMs > startMs && segment.startMs < endMs) points.add(segment.startMs);
    if (segment.endMs > startMs && segment.endMs < endMs) points.add(segment.endMs);
  }
  if (obstacle.type === 'ball') {
    if (obstacle.moveStartMs > startMs && obstacle.moveStartMs < endMs) points.add(obstacle.moveStartMs);
    if (obstacle.moveEndMs > startMs && obstacle.moveEndMs < endMs) points.add(obstacle.moveEndMs);
  }
  const sorted = [...points].sort((a, b) => a - b);
  let closest = Infinity;
  for (let index = 0; index < sorted.length - 1; index++) {
    const a = sorted[index], b = sorted[index + 1];
    const dogA = routeLaneAt(segments, a), dogB = routeLaneAt(segments, b);
    const obstacleA = parkObstacleLaneAt(obstacle, a), obstacleB = parkObstacleLaneAt(obstacle, b);
    const relA = dogA - obstacleA, relB = dogB - obstacleB;
    closest = Math.min(closest, Math.abs(relA), Math.abs(relB));
    if (relA === relB) continue;
    const crossing = -relA / (relB - relA);
    if (crossing >= 0 && crossing <= 1) closest = 0;
  }
  if (startMs === endMs) return Math.abs(routeLaneAt(segments, startMs) - parkObstacleLaneAt(obstacle, startMs));
  return closest;
}

function minDistanceToLane(segments, lane, startMs, endMs) {
  let closest = Infinity;
  for (const segment of segments) {
    const start = Math.max(startMs, segment.startMs), end = Math.min(endMs, segment.endMs);
    if (start > end) continue;
    const x0 = routeLaneAt(segments, start), x1 = routeLaneAt(segments, end);
    if (lane >= Math.min(x0, x1) && lane <= Math.max(x0, x1)) return 0;
    closest = Math.min(closest, Math.abs(x0 - lane), Math.abs(x1 - lane));
  }
  return closest;
}

function makeBoneRows(lanes) {
  let index = 0;
  return SEGMENT_BONE_TIMES.flatMap(group => group.map(timeMs => ({ timeMs, lane: lanes[index++] })));
}

function createStaticObstacle(scene, lane, eventIndex, obstacleIndex) {
  const type = scene.kind === 'crow' ? 'crow' : 'puddle';
  const visibleStartMs = scene.arrivalMs - VISIBLE_LEAD_MS;
  const obstacle = {
    id: `park-obstacle-${String(obstacleIndex).padStart(3, '0')}`,
    eventId: `park-event-${String(eventIndex).padStart(2, '0')}`,
    type,
    lane,
    arrivalMs: scene.arrivalMs,
    visibleStartMs,
    // Retained as a data alias for existing numeric diagnostics during the
    // transition. It is a body-visible timestamp, never a warning cue.
    warningStartMs: visibleStartMs,
    distance: scene.arrivalMs * PARK_SPEED / 1000,
  };
  if (type === 'crow') {
    obstacle.groundedStartMs = visibleStartMs;
    obstacle.departureMs = scene.arrivalMs + 400;
  }
  return obstacle;
}

function chooseSafeLane(lanes, random) {
  if (!lanes.length) return null;
  return lanes[Math.floor(random() * lanes.length)];
}

function assignSceneLanes(scene, eventIndex, segments, random, nextObstacleIndex) {
  const startMs = scene.arrivalMs - CONTACT_HALF_MS;
  const endMs = scene.arrivalMs + CONTACT_HALF_MS;
  const clearLanes = LANES.filter(lane => minDistanceToLane(segments, lane, startMs, endMs) > LATERAL_CONTACT + 1e-9);
  if (!clearLanes.length) return null;
  if (scene.kind === 'puddle-trap') {
    const edge = scene.trapEdge;
    const obstacleLane = edge === undefined ? null : edge;
    // The edge carries course identity; the blocking lane comes from the bone route.
    return { lanes: [], nextObstacleIndex, trap: true, boneEdge: edge };
  }
  if (scene.kind === 'puddle-pair') {
    if (clearLanes.length < 2) return null;
    const blocked = shuffled(clearLanes, random).slice(0, 2);
    const obstacles = blocked.map((lane, offset) => createStaticObstacle(scene, lane, eventIndex, nextObstacleIndex + offset));
    return { lanes: obstacles, nextObstacleIndex: nextObstacleIndex + 2, trap: false };
  }
  if (scene.kind === 'crow') {
    const lane = chooseSafeLane(clearLanes, random);
    if (lane === null) return null;
    return { lanes: [createStaticObstacle(scene, lane, eventIndex, nextObstacleIndex)], nextObstacleIndex: nextObstacleIndex + 1, trap: false };
  }
  if (scene.kind === 'ball') {
    const paths = [[-1, 0], [0, 1]].flatMap(([fromLane, toLane]) => [[fromLane, toLane], [toLane, fromLane]]);
    const safePaths = paths.filter(([fromLane, toLane]) => {
      const visibleStartMs = scene.arrivalMs - VISIBLE_LEAD_MS;
      const ball = { type: 'ball', fromLane, toLane, moveStartMs: visibleStartMs, moveEndMs: scene.arrivalMs + 300 };
      return minRelativeLaneDistance(segments, ball, startMs, endMs) > LATERAL_CONTACT + 1e-9;
    });
    if (!safePaths.length) return null;
    const [fromLane, toLane] = safePaths[Math.floor(random() * safePaths.length)];
    const obstacle = {
      id: `park-obstacle-${String(nextObstacleIndex).padStart(3, '0')}`,
      eventId: `park-event-${String(eventIndex).padStart(2, '0')}`,
      type: 'ball',
      lane: fromLane,
      fromLane,
      toLane,
      arrivalMs: scene.arrivalMs,
      visibleStartMs: scene.arrivalMs - VISIBLE_LEAD_MS,
      warningStartMs: scene.arrivalMs - VISIBLE_LEAD_MS,
      moveStartMs: scene.arrivalMs - VISIBLE_LEAD_MS,
      moveEndMs: scene.arrivalMs + 300,
      distance: scene.arrivalMs * PARK_SPEED / 1000,
    };
    return { lanes: [obstacle], nextObstacleIndex: nextObstacleIndex + 1, trap: false };
  }
  return null;
}

function buildParkCourse(seed, attempt, { forceMirror } = {}) {
  const classSeed = seed % TEMPLATE_COUNT;
  const templateRandom = seededRandom((classSeed ^ Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
  const mirror = forceMirror ?? Boolean(Math.floor(seed / TEMPLATE_COUNT) % 2);
  const { lanes: boneLanes, detourEdges, changeCount } = makeBoneLanes(templateRandom, mirror);
  if (boneLanes.length !== allBoneTimes().length) return rejectBuild('no lane sequence satisfies protected windows');
  const boneRows = makeBoneRows(boneLanes);
  const bones = boneRows.map((bone, index) => ({
    id: `park-bone-${String(index + 1).padStart(3, '0')}`,
    lane: bone.lane,
    timeMs: bone.timeMs,
    distance: bone.timeMs * PARK_SPEED / 1000,
    kind: 'normal',
  }));
  const goldIds = GOLD_TARGETS_MS.map(target => {
    const bone = bones.reduce((closest, current) =>
      Math.abs(current.timeMs - target) < Math.abs(closest.timeMs - target) ? current : closest);
    bone.kind = 'gold';
    return bone.id;
  });
  const safeInputsWithReasons = makeSafeInputs(bones, detourEdges, templateRandom, mirror);
  const safeInputs = safeInputsWithReasons.map(({ timeMs, direction }) => ({ timeMs, direction }));
  const segments = routeSegments(safeInputsWithReasons);
  if (!segments) return rejectBuild('route segments');

  const obstacles = [];
  let obstacleIndex = 1;
  for (let index = 0; index < SCENES.length; index++) {
    const scene = SCENES[index];
    let assignment = assignSceneLanes(scene, index + 1, segments, templateRandom, obstacleIndex);
    if (!assignment) return rejectBuild(`no safe lane for scene ${scene.arrivalMs} ${scene.kind}`);
    if (assignment.trap) {
      const edge = assignment.boneEdge;
      const blockingLane = bones[edge].lane;
      const detourInput = safeInputsWithReasons.find(input => input.reason === 'avoid' &&
        input.timeMs === scene.arrivalMs - 350);
      if (!detourInput) return rejectBuild(`missing detour for scene ${scene.arrivalMs}`);
      const detourLane = bones[edge].lane + detourInput.direction;
      if (Math.abs(blockingLane - detourLane) < 1) return rejectBuild(`detour lane for scene ${scene.arrivalMs}`);
      assignment = {
        lanes: [createStaticObstacle(scene, blockingLane, index + 1, obstacleIndex)],
        nextObstacleIndex: obstacleIndex + 1,
        trap: false,
      };
    }
    obstacles.push(...assignment.lanes);
    obstacleIndex = assignment.nextObstacleIndex;
  }
  obstacles.sort((a, b) => a.arrivalMs - b.arrivalMs || a.lane - b.lane || a.id.localeCompare(b.id));

  const normalCollected = bones.filter(bone => bone.kind !== 'gold').length;
  if (bones.length !== 48 || goldIds.length !== 3 || normalCollected !== 45 || obstacles.length !== 32) return rejectBuild('course counts');
  const arrivalCounts = new Map();
  for (const obstacle of obstacles) arrivalCounts.set(obstacle.eventId, (arrivalCounts.get(obstacle.eventId) ?? 0) + 1);
  if (arrivalCounts.size !== 26) return rejectBuild('event count');
  if (safeInputs.length < 38 || safeInputs.length > 46) return rejectBuild(`input count ${safeInputs.length}`);

  const result = {
    seed,
    ruleVersion: PARK_RULE_VERSION,
    courseVersion: PARK_COURSE_VERSION,
    bones,
    obstacles,
    goldCandidates: [...goldIds],
    goldIds,
    safeInputs,
    generation: {
      templateId: classSeed,
      mirror,
      attempts: attempt + 1,
      fallback: false,
      fallbackReason: null,
      safeInputCount: safeInputs.length,
      boneLaneChanges: changeCount,
    },
  };
  if (!validateParkTemplate(result, { segments, safeInputsWithReasons })) return rejectBuild('template validation');
  return result;
}

function validateParkTemplate(course, { segments, safeInputsWithReasons }) {
  const { bones, obstacles } = course;
  const fail = reason => {
    if (PARK_DEBUG) console.error(`park validation rejected: ${reason}`);
    return false;
  };
  if (bones.some((bone, index) => index && (bone.timeMs - bones[index - 1].timeMs < 500 || bone.timeMs - bones[index - 1].timeMs > 950))) return fail('bone spacing');
  const counts = [
    bones.filter(bone => bone.timeMs < 3_000).length,
    bones.filter(bone => bone.timeMs >= 3_000 && bone.timeMs < 10_000).length,
    bones.filter(bone => bone.timeMs >= 10_000 && bone.timeMs < 20_000).length,
    bones.filter(bone => bone.timeMs >= 20_000 && bone.timeMs < 30_000).length,
  ];
  if (counts.join(',') !== '2,11,18,17') return fail('bone stage counts');
  for (const [target, min, max] of [[8_000, 7_500, 8_500], [17_000, 16_500, 17_500], [26_000, 25_500, 26_500]]) {
    const bone = bones.find(item => item.id === course.goldIds[GOLD_TARGETS_MS.indexOf(target)]);
    if (!bone || bone.timeMs < min || bone.timeMs > max) return fail(`gold target ${target}`);
  }
  for (let index = 1; index < safeInputsWithReasons.length; index++) {
    const previous = safeInputsWithReasons[index - 1], current = safeInputsWithReasons[index];
    if (current.timeMs - previous.timeMs < CONFIG.cooldownMs - 1e-9) return fail('input cooldown');
    if (current.timeMs < previous.timeMs + CONFIG.moveMs - 1e-9) return fail('overlapping safe inputs');
  }

  const sortedScenes = SCENES.map((scene, index) => ({ ...scene, eventIndex: index + 1 }))
    .sort((a, b) => a.arrivalMs - b.arrivalMs);
  const countScenes = (from, to, kind) => sortedScenes.filter(scene => scene.arrivalMs >= from && scene.arrivalMs < to &&
    (kind === 'puddle' ? scene.kind.startsWith('puddle-') : scene.kind === kind)).length;
  if (countScenes(0, 3_000, 'puddle') !== 0 || countScenes(3_000, 10_000, 'puddle') !== 4 ||
    countScenes(10_000, 20_000, 'puddle') !== 4 || countScenes(20_000, 30_000, 'puddle') !== 4 ||
    countScenes(3_000, 10_000, 'crow') !== 2 || countScenes(10_000, 20_000, 'crow') !== 3 ||
    countScenes(20_000, 30_000, 'crow') !== 3 || countScenes(0, 10_000, 'ball') !== 0 ||
    countScenes(10_000, 20_000, 'ball') !== 3 || countScenes(20_000, 30_000, 'ball') !== 3) return fail('scene distribution');
  const pairScenes = sortedScenes.filter(scene => scene.kind === 'puddle-pair');
  const trapScenes = sortedScenes.filter(scene => scene.kind === 'puddle-trap');
  if (pairScenes.length !== 6 || trapScenes.length !== 6 || pairScenes.some(scene => scene.arrivalMs < 10_000)) return fail('pair/trap counts');
  if (pairScenes.filter(scene => scene.arrivalMs < 20_000).length !== 3 || pairScenes.filter(scene => scene.arrivalMs >= 20_000).length !== 3 ||
    trapScenes.filter(scene => scene.arrivalMs < 10_000).length !== 4 || trapScenes.filter(scene => scene.arrivalMs >= 10_000 && scene.arrivalMs < 20_000).length !== 1 ||
    trapScenes.filter(scene => scene.arrivalMs >= 20_000).length !== 1) return fail('pair/trap distribution');
  for (let index = 1; index < sortedScenes.length; index++) {
    if (sortedScenes[index].arrivalMs - sortedScenes[index - 1].arrivalMs < 750) return fail('minimum event gap');
  }
  if (sortedScenes.at(-1)?.arrivalMs > 28_600) return fail('last event too late');
  const ballTimes = sortedScenes.filter(scene => scene.kind === 'ball').map(scene => scene.arrivalMs);
  if (ballTimes.some((timeMs, index) => index > 0 && timeMs - ballTimes[index - 1] < 2_500)) return fail('ball spacing');
  const eventWindows = sortedScenes.map(scene => ({ start: scene.arrivalMs - VISIBLE_LEAD_MS, end: scene.arrivalMs + CONTACT_HALF_MS }));
  const boundaries = [...new Set(eventWindows.flatMap(window => [window.start, window.end]))].sort((a, b) => a - b);
  for (const timeMs of boundaries) {
    const activeWindows = eventWindows.filter(window => window.start <= timeMs + 1e-9 && window.end >= timeMs - 1e-9);
    if (activeWindows.length > 2) return fail(`visible event overlap ${timeMs} [${activeWindows.map(item => item.start + VISIBLE_LEAD_MS).join(',')}]`);
  }

  const trackingInputs = [];
  for (let index = 1; index < bones.length; index++) {
    if (bones[index].lane !== bones[index - 1].lane) {
      trackingInputs.push({ timeMs: bones[index].timeMs - 300, direction: Math.sign(bones[index].lane - bones[index - 1].lane) });
    }
  }
  const trackingSegments = routeSegments(trackingInputs);
  if (!trackingSegments) return fail('tracking route');
  let trapCount = 0;
  for (const scene of SCENES.filter(item => item.kind === 'puddle-trap')) {
    const obstacle = obstacles.find(item => item.eventId === `park-event-${String(SCENES.indexOf(scene) + 1).padStart(2, '0')}`);
    if (!obstacle) return fail('missing trap obstacle');
    const start = scene.arrivalMs - CONTACT_HALF_MS, end = scene.arrivalMs + CONTACT_HALF_MS;
    if (minDistanceToLane(segments, obstacle.lane, start, end) <= LATERAL_CONTACT + 1e-9) return fail(`safe route hits trap ${scene.arrivalMs}`);
    const edge = scene.trapEdge;
    const leftBone = bones[edge];
    if (leftBone.lane !== bones[edge + 1].lane) return fail(`trap edge changes lane ${scene.arrivalMs}`);
    if (minDistanceToLane(trackingSegments, obstacle.lane, start, end) > LATERAL_CONTACT + 1e-9) return fail(`follow misses trap ${scene.arrivalMs}`);
    trapCount++;
  }
  if (trapCount < 6) return fail('trap follow count');

  for (const obstacle of obstacles) {
    const start = obstacle.arrivalMs - CONTACT_HALF_MS;
    const end = obstacle.arrivalMs + CONTACT_HALF_MS;
    if (obstacle.type === 'ball') {
      if (minRelativeLaneDistance(segments, obstacle, start, end) <= LATERAL_CONTACT + 1e-9) return fail(`safe route hits ball ${obstacle.arrivalMs}`);
    } else if (minDistanceToLane(segments, obstacle.lane, start, end) <= LATERAL_CONTACT + 1e-9) return fail(`safe route hits static ${obstacle.arrivalMs}`);
  }
  return true;
}

function fixedFallbackCourse(seed, attempts) {
  // No dependence on the failed generator: preserve the verified backup data.
  const candidate = JSON.parse(JSON.stringify(PARK_FALLBACK_COURSE));
  candidate.seed = seed;
  candidate.ruleVersion = PARK_RULE_VERSION;
  candidate.courseVersion = PARK_COURSE_VERSION;
  candidate.generation = { ...candidate.generation, templateId: 'fallback-0', attempts, fallback: true,
    fallbackReason: attempts === 0 ? 'generation disabled for verification' : 'seeded generation exhausted attempts' };
  return candidate;
}

export function createParkCourse(seed = 1, { maxAttempts = 20 } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 20) throw new RangeError('maxAttempts must be 0..20');
  const normalizedSeed = normalizeSeed(seed);
  const templateSeed = normalizedSeed % TEMPLATE_COUNT;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const course = buildParkCourse(templateSeed, attempt, { forceMirror: Boolean(Math.floor(normalizedSeed / TEMPLATE_COUNT) % 2) });
    if (course) {
      course.seed = normalizedSeed;
      course.generation.templateId = templateSeed;
      return course;
    }
  }
  return fixedFallbackCourse(normalizedSeed, maxAttempts);
}

export function parkObstacleLaneAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return obstacle?.lane ?? 0;
  if (obstacle.type !== 'ball' || !Number.isFinite(obstacle.moveStartMs) || !Number.isFinite(obstacle.moveEndMs)) return obstacle.lane ?? 0;
  if (timeMs <= obstacle.moveStartMs) return obstacle.fromLane;
  if (timeMs >= obstacle.moveEndMs) return obstacle.toLane;
  const progress = (timeMs - obstacle.moveStartMs) / (obstacle.moveEndMs - obstacle.moveStartMs);
  return obstacle.fromLane + (obstacle.toLane - obstacle.fromLane) * progress;
}

// Active gates collision eligibility. Collision additionally
// checks longitudinal overlap and crow ground state; ball drawing may outlive it.
export function parkObstacleActiveAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return false;
  const visibleStartMs = obstacle.visibleStartMs ?? obstacle.warningStartMs ?? -Infinity;
  if (obstacle.type === 'puddle') return timeMs >= visibleStartMs && timeMs <= obstacle.arrivalMs + PASS_MARGIN_MS;
  if (obstacle.type === 'crow') return timeMs >= visibleStartMs && timeMs <= obstacle.departureMs;
  if (obstacle.type === 'ball') return timeMs >= visibleStartMs && timeMs <= obstacle.arrivalMs + PASS_MARGIN_MS;
  return false;
}

// A ball completes its continuous roll and briefly holds its endpoint even
// after the inclusive collision window has passed. Visual lifetime never
// extends collision lifetime.
export function parkObstacleVisibleAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return false;
  const visibleStartMs = obstacle.visibleStartMs ?? obstacle.warningStartMs ?? -Infinity;
  if (obstacle.type === 'ball') return timeMs >= visibleStartMs && timeMs <= obstacle.moveEndMs + 150;
  if (obstacle.type === 'puddle') return timeMs >= visibleStartMs && parkObstacleActiveAt(obstacle, timeMs);
  return parkObstacleActiveAt(obstacle, timeMs);
}

export const PARK_LEVEL2 = Object.freeze({
  durationMs: PARK_DURATION_MS,
  speed: PARK_SPEED,
  ruleVersion: PARK_RULE_VERSION,
  courseVersion: PARK_COURSE_VERSION,
  boneCount: 48,
  goldCount: 3,
  eventCount: 26,
  obstacleCount: 32,
  layoutClasses: TEMPLATE_COUNT * 2,
});
