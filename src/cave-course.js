const DURATION_MS = 30_000;
const SPEED = 1.45;
const RULE_VERSION = 'cave30-level4-v1';
const COURSE_VERSION = 'cave-level4-course-1';
const LANES = Object.freeze([-1, 0, 1]);
const EVENT_COUNT = 54;
const EVENT_START_MS = 2_200;
const VISIBLE_LEAD_MS = 1_250;
const SHORT_GAP_MS = 380;
const WIDE_GAP_MS = 720;

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

function makeEvents(random) {
  const arrivals = [EVENT_START_MS];
  for (let index = 0; index < EVENT_COUNT - 1; index++) {
    arrivals.push(arrivals.at(-1) + (index % 3 === 0 ? WIDE_GAP_MS : SHORT_GAP_MS));
  }

  const movingKinds = shuffled([
    ...Array(18).fill('bat'),
    ...Array(18).fill('mixed'),
  ], random);
  let movingIndex = 0;
  const events = [];
  for (let group = 0; group < 18; group++) {
    const firstOuter = random() < 0.5 ? -1 : 1;
    const firstIndex = group * 3;
    events.push({
      index: firstIndex,
      arrivalMs: arrivals[firstIndex],
      kind: movingKinds[movingIndex++],
      safeLane: firstOuter,
    });
    events.push({
      index: firstIndex + 1,
      arrivalMs: arrivals[firstIndex + 1],
      kind: movingKinds[movingIndex++],
      safeLane: -firstOuter,
    });
    events.push({
      index: firstIndex + 2,
      arrivalMs: arrivals[firstIndex + 2],
      kind: 'staticPair',
      safeLane: 0,
    });
  }
  return events;
}

function makeSafeInputs(events) {
  const safeInputs = [{ timeMs: 1_700, direction: events[0].safeLane }];
  for (let index = 0; index < events.length - 1; index++) {
    const current = events[index];
    const next = events[index + 1];
    if (next.arrivalMs - current.arrivalMs === WIDE_GAP_MS) {
      // An outer-to-outer crossing uses the center as its intermediate lane.
      safeInputs.push({ timeMs: current.arrivalMs + 100, direction: -current.safeLane });
      safeInputs.push({ timeMs: current.arrivalMs + 340, direction: next.safeLane });
    } else if (current.kind === 'staticPair') {
      safeInputs.push({ timeMs: current.arrivalMs + 70, direction: next.safeLane });
    } else {
      safeInputs.push({ timeMs: current.arrivalMs + 100, direction: -current.safeLane });
    }
  }
  return safeInputs;
}

function createStaticObstacle(event, obstacleIndex, lane, type) {
  return {
    id: `cave-obstacle-${String(obstacleIndex).padStart(3, '0')}`,
    eventId: `cave-event-${String(event.index + 1).padStart(2, '0')}`,
    eventIndex: event.index,
    eventKind: event.kind,
    type,
    lane,
    arrivalMs: event.arrivalMs,
    visibleStartMs: event.arrivalMs - VISIBLE_LEAD_MS,
    distance: event.arrivalMs * SPEED / 1_000,
  };
}

function createBat(event, obstacleIndex, safeLane, mixed, random) {
  const blockedOuterLane = -safeLane;
  const visibleStartMs = event.arrivalMs - VISIBLE_LEAD_MS;
  const movingTowardCenter = random() < 0.5;
  const fromLane = movingTowardCenter ? blockedOuterLane : 0;
  const toLane = movingTowardCenter ? 0 : blockedOuterLane;
  return {
    id: `cave-obstacle-${String(obstacleIndex).padStart(3, '0')}`,
    eventId: `cave-event-${String(event.index + 1).padStart(2, '0')}`,
    eventIndex: event.index,
    eventKind: event.kind,
    type: 'bat',
    lane: fromLane,
    fromLane,
    toLane,
    safeLane,
    arrivalMs: event.arrivalMs,
    visibleStartMs,
    moveStartMs: visibleStartMs,
    moveEndMs: event.arrivalMs + 100,
    distance: event.arrivalMs * SPEED / 1_000,
    ...(mixed ? { mixed: true } : {}),
  };
}

function makeObstacles(events, random) {
  const mixedStaticTypes = shuffled([
    ...Array(6).fill('stalagmite'),
    ...Array(6).fill('stalactite'),
    ...Array(6).fill('caveRock'),
  ], random);
  const pairStaticTypes = shuffled([
    ...Array(12).fill('stalagmite'),
    ...Array(12).fill('stalactite'),
    ...Array(12).fill('caveRock'),
  ], random);
  let mixedTypeIndex = 0;
  let pairTypeIndex = 0;
  let obstacleIndex = 1;
  const obstacles = [];

  for (const event of events) {
    if (event.kind === 'staticPair') {
      for (const lane of [-1, 1]) {
        obstacles.push(createStaticObstacle(event, obstacleIndex++, lane, pairStaticTypes[pairTypeIndex++]));
      }
      continue;
    }

    if (event.kind === 'mixed') {
      const blockedOuterLane = -event.safeLane;
      obstacles.push(createStaticObstacle(event, obstacleIndex++, blockedOuterLane, mixedStaticTypes[mixedTypeIndex++]));
      obstacles.push(createBat(event, obstacleIndex++, event.safeLane, true, random));
      continue;
    }

    obstacles.push(createBat(event, obstacleIndex++, event.safeLane, false, random));
  }
  return obstacles;
}

function makeBones(events, random) {
  const rows = [{ timeMs: 1_000, lane: 0, source: 'intro' }];
  const omittedEventIndices = new Set([3, 10, 17, 24, 31, 38, 45]);
  for (const event of events) {
    if (omittedEventIndices.has(event.index)) continue;
    rows.push({ timeMs: event.arrivalMs, lane: event.safeLane, source: 'event' });
  }
  rows.sort((a, b) => a.timeMs - b.timeMs);
  const bones = rows.map((bone, index) => ({
    id: `cave-bone-${String(index + 1).padStart(3, '0')}`,
    lane: bone.lane,
    timeMs: bone.timeMs,
    distance: bone.timeMs * SPEED / 1_000,
    kind: 'normal',
    source: bone.source,
  }));
  const goldIds = assignGold(bones, random);
  return { bones, goldIds };
}

function assignGold(bones, random) {
  const targets = [8_000, 17_000, 26_000];
  const selected = new Set();
  for (const target of targets) {
    const candidates = bones.filter(bone => !selected.has(bone.id));
    const bestDistance = Math.min(...candidates.map(bone => Math.abs(bone.timeMs - target)));
    const nearest = candidates.filter(bone => Math.abs(bone.timeMs - target) === bestDistance);
    const bone = nearest[Math.floor(random() * nearest.length)];
    bone.kind = 'gold';
    selected.add(bone.id);
  }
  return [...selected];
}

function validateCourse(course) {
  if (course.bones.length !== 48 || course.bones.filter(bone => bone.kind === 'gold').length !== 3) return false;
  if (course.obstacles.length !== 90 || course.safeInputs.length !== 72) return false;
  if (course.events.length !== EVENT_COUNT) return false;

  const eventGroups = new Map();
  for (const obstacle of course.obstacles) {
    const group = eventGroups.get(obstacle.eventId) ?? [];
    group.push(obstacle);
    eventGroups.set(obstacle.eventId, group);
  }
  if (eventGroups.size !== EVENT_COUNT) return false;
  if ([...eventGroups.values()].filter(items => items.length === 2 && items.every(item => item.type !== 'bat')).length !== 18) return false;
  if ([...eventGroups.values()].filter(items => items.length === 1 && items[0].type === 'bat').length !== 18) return false;
  if ([...eventGroups.values()].filter(items => items.length === 2 && items.some(item => item.type === 'bat')).length !== 18) return false;
  if (course.obstacles.filter(item => item.type === 'bat').length !== 36) return false;
  for (const type of ['stalagmite', 'stalactite', 'caveRock']) {
    if (course.obstacles.filter(item => item.type === type).length !== 18) return false;
  }

  const gaps = course.events.slice(1).map((event, index) => event.arrivalMs - course.events[index].arrivalMs);
  if (gaps.filter(gap => gap === WIDE_GAP_MS).length !== 18) return false;
  if (gaps.filter(gap => gap === SHORT_GAP_MS).length !== 35) return false;
  if (course.events[0].arrivalMs !== 2_200 || course.events.at(-1).arrivalMs !== 28_460) return false;

  for (const event of course.events) {
    const group = eventGroups.get(`cave-event-${String(event.index + 1).padStart(2, '0')}`) ?? [];
    if (event.kind === 'mixed') {
      const staticItem = group.find(item => item.type !== 'bat');
      const bat = group.find(item => item.type === 'bat');
      if (!staticItem || !bat || ![-1, 1].includes(staticItem.lane) || staticItem.lane !== -event.safeLane) return false;
      if (![bat.fromLane, bat.toLane].includes(0) || ![bat.fromLane, bat.toLane].includes(staticItem.lane)) return false;
    }
    if (event.kind === 'bat') {
      const bat = group[0];
      if (group.length !== 1 || bat.type !== 'bat' || Math.abs(bat.fromLane - bat.toLane) !== 1) return false;
      if (LANES.includes(event.safeLane) === false || [bat.fromLane, bat.toLane].includes(event.safeLane)) return false;
    }
  }
  return true;
}

export function createCaveCourse(seed = 1) {
  const normalizedSeed = normalizeSeed(seed);
  const random = seededRandom(normalizedSeed);
  const events = makeEvents(random);
  const safeInputs = makeSafeInputs(events);
  const obstacles = makeObstacles(events, random);
  const { bones, goldIds } = makeBones(events, random);
  const course = {
    seed: normalizedSeed,
    ruleVersion: RULE_VERSION,
    courseVersion: COURSE_VERSION,
    events,
    bones,
    obstacles,
    goldCandidates: [...goldIds],
    goldIds,
    safeInputs,
    generation: {
      generator: 'seeded-cave-route-v1',
      attempts: 1,
      fallback: false,
      fallbackReason: null,
      safeInputCount: safeInputs.length,
      boneLaneChanges: bones.reduce((count, bone, index) => count + Number(index > 0 && bone.lane !== bones[index - 1].lane), 0),
      staticPairEventCount: 18,
      singleBatEventCount: 18,
      mixedEventCount: 18,
      batCount: obstacles.filter(item => item.type === 'bat').length,
      edgeCrossingCount: 18,
      wideGapCount: 18,
    },
  };
  if (!validateCourse(course)) throw new Error(`generated cave course failed validation for seed ${normalizedSeed}`);
  return course;
}

export function caveObstacleLaneAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return obstacle?.lane ?? 0;
  if (obstacle.type !== 'bat' || !Number.isFinite(obstacle.moveStartMs) || !Number.isFinite(obstacle.moveEndMs)) {
    return obstacle.lane ?? 0;
  }
  if (timeMs <= obstacle.moveStartMs) return obstacle.fromLane;
  if (timeMs >= obstacle.moveEndMs) return obstacle.toLane;
  const progress = (timeMs - obstacle.moveStartMs) / (obstacle.moveEndMs - obstacle.moveStartMs);
  return obstacle.fromLane + (obstacle.toLane - obstacle.fromLane) * progress;
}

export function caveObstacleVisibleAt(obstacle, timeMs) {
  if (!obstacle || !Number.isFinite(timeMs)) return false;
  const visibleStartMs = obstacle.visibleStartMs ?? -Infinity;
  const visibleEndMs = Math.max(obstacle.moveEndMs ?? -Infinity, obstacle.arrivalMs + 600);
  return timeMs >= visibleStartMs && timeMs <= visibleEndMs;
}

export const CAVE_LEVEL4 = Object.freeze({
  durationMs: DURATION_MS,
  speed: SPEED,
  ruleVersion: RULE_VERSION,
  courseVersion: COURSE_VERSION,
  eventCount: EVENT_COUNT,
  obstacleCount: 90,
});
