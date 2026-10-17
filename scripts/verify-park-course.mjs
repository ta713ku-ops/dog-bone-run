import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/game.js';
import { createParkCourse, parkObstacleLaneAt } from '../src/park-course.js';

const SEED_COUNT = 1_000;
const TEMPLATE_CLASS_COUNT = 32;
const CONTACT_HALF_MS = (CONFIG.dogHalfLength + CONFIG.obstacleHalfLength) * 1000 / 1.1;
const LATERAL_CONTACT = CONFIG.dogHalfWidth + CONFIG.obstacleHalfWidth;
const ESCAPE_SEARCH_STEP_MS = 10;
const BOUNDARY_EPSILON_MS = 0.01;

function replaySafeRoute(seed, course, { inputIndex = -1, offsetMs = 0, endMs = 30_000 } = {}) {
  const events = [];
  const game = new Game({ phase: 4, seed, walkLevel: 2, onEvent: event => events.push(event) });
  const rejected = [];
  game.start();
  for (let index = 0; index < course.safeInputs.length; index++) {
    const input = course.safeInputs[index];
    const timeMs = input.timeMs + (index === inputIndex ? offsetMs : 0);
    assert.ok(timeMs >= game.timeMs - 1e-7, `input order seed ${seed}, index ${index}, offset ${offsetMs}`);
    game.advance(timeMs - game.timeMs);
    if (!game.command(input.direction, 'park-verification')) rejected.push({ index, timeMs });
  }
  game.advance(Math.max(0, endMs - game.timeMs));
  return { game, events, rejected };
}

function assertSafeResult(run, context) {
  assert.equal(run.game.state, 'result', `${context}: game did not finish`);
  assert.equal(run.game.timeMs, 30_000, `${context}: wrong end time`);
  assert.equal(run.game.collected, 48, `${context}: missed a bone`);
  assert.equal(run.game.normalCollected, 45, `${context}: normal count`);
  assert.equal(run.game.goldCollected, 3, `${context}: gold count`);
  assert.equal(run.game.contactCount, 0, `${context}: obstacle contact`);
  assert.equal(run.game.contactEventCount, 0, `${context}: contact event`);
  assert.deepEqual(run.rejected, [], `${context}: input rejection`);
}

function canonicalCourse(course) {
  return JSON.stringify({
    ruleVersion: course.ruleVersion,
    courseVersion: course.courseVersion,
    bones: course.bones,
    obstacles: course.obstacles,
    goldIds: course.goldIds,
    safeInputs: course.safeInputs,
    generation: course.generation,
  });
}

function getBoundaryOffsets(course, inputIndex) {
  const input = course.safeInputs[inputIndex];
  const offsets = new Set();
  const addWithNeighbors = value => {
    if (!Number.isFinite(value) || Math.abs(value) > 60 + 1e-7) return;
    for (const epsilon of [-BOUNDARY_EPSILON_MS, 0, BOUNDARY_EPSILON_MS]) {
      const candidate = value + epsilon;
      if (candidate >= -60 && candidate <= 60) offsets.add(Number(candidate.toFixed(3)));
    }
  };

  // Besides the complete 10 ms sweep, align the move's start, lateral
  // midpoint/edge, and end with every collision or body-visibility boundary.
  const obstacleBoundaries = new Set();
  for (const obstacle of course.obstacles) {
    obstacleBoundaries.add(obstacle.visibleStartMs);
    obstacleBoundaries.add(obstacle.arrivalMs - CONTACT_HALF_MS);
    obstacleBoundaries.add(obstacle.arrivalMs + CONTACT_HALF_MS);
    for (const key of ['groundedStartMs', 'departureMs', 'moveStartMs', 'moveEndMs']) {
      if (Number.isFinite(obstacle[key])) obstacleBoundaries.add(obstacle[key]);
    }
  }
  for (const boundary of obstacleBoundaries) {
    for (const moveOffset of [0, 50, 100, 150, CONFIG.moveMs]) {
      addWithNeighbors(boundary - moveOffset - input.timeMs);
    }
  }

  // Check exact queue and cooldown boundaries against the adjacent scheduled
  // input while keeping all other input times fixed.
  for (const neighborIndex of [inputIndex - 1, inputIndex + 1]) {
    const neighbor = course.safeInputs[neighborIndex];
    if (!neighbor) continue;
    for (const interval of [CONFIG.cooldownMs, CONFIG.moveMs]) {
      addWithNeighbors(neighbor.timeMs + interval - input.timeMs);
      addWithNeighbors(neighbor.timeMs - interval - input.timeMs);
    }
  }
  return [...offsets];
}

function verifyVisibleOverlap(course) {
  const groups = new Map();
  for (const obstacle of course.obstacles) {
    const group = groups.get(obstacle.eventId) ?? [];
    group.push(obstacle);
    groups.set(obstacle.eventId, group);
  }
  assert.equal(groups.size, 26);
  const intervals = [...groups.values()].map(group => ({
    startMs: group[0].visibleStartMs,
    endMs: group[0].arrivalMs + CONTACT_HALF_MS,
  }));
  const endpoints = new Set(intervals.flatMap(interval => [interval.startMs, interval.endMs]));
  for (const timeMs of endpoints) {
    assert.ok(intervals.filter(interval => interval.startMs <= timeMs + 1e-8 && interval.endMs >= timeMs - 1e-8).length <= 2,
      `more than two visible events overlap at ${timeMs}`);
  }
}

function verifySimpleFollower(seed) {
  const events = [];
  const game = new Game({ phase: 4, seed, walkLevel: 2, onEvent: event => events.push(event) });
  game.start();
  for (let index = 1; index < game.course.length; index++) {
    const prior = game.course[index - 1], bone = game.course[index];
    if (bone.lane === prior.lane) continue;
    const inputMs = bone.timeMs - 300;
    game.advance(inputMs - game.timeMs);
    game.command(Math.sign(bone.lane - prior.lane), 'simple-bone-follower');
  }
  game.advance(game.durationMs - game.timeMs);
  return { contacts: game.contactCount, contactEvents: game.contactEventCount, events };
}

function verifyLevel1SimpleFollower(seed) {
  const events = [];
  const game = new Game({ phase: 4, seed, walkLevel: 1, onEvent: event => events.push(event) });
  game.start();
  for (let index = 1; index < game.course.length; index++) {
    const prior = game.course[index - 1], bone = game.course[index];
    if (bone.lane === prior.lane) continue;
    const inputMs = bone.timeMs - 300;
    game.advance(inputMs - game.timeMs);
    game.command(Math.sign(bone.lane - prior.lane), 'simple-bone-follower');
  }
  game.advance(game.durationMs - game.timeMs);
  return { contacts: game.contactCount, contactEvents: game.contactEventCount };
}

function verifyStaticLane(seed, walkLevel, lane) {
  const game = new Game({ phase: 4, seed, walkLevel });
  game.x = lane;
  game.lane = lane;
  game.start();
  game.advance(game.durationMs);
  return { contacts: game.contactCount, contactEvents: game.contactEventCount };
}

function movingDogX(state, timeMs) {
  if (!state.move) return state.x;
  const progress = Math.max(0, Math.min(1, (timeMs - state.move.startMs) / CONFIG.moveMs));
  return state.move.from + (state.move.to - state.move.from) * progress;
}

function hasWorldContact(obstacles, xAt, startMs, endMs) {
  for (const obstacle of obstacles) {
    const contactStart = Math.max(startMs, obstacle.arrivalMs - CONTACT_HALF_MS,
      obstacle.type === 'crow' ? obstacle.groundedStartMs ?? obstacle.visibleStartMs : -Infinity);
    const contactEnd = Math.min(endMs, obstacle.arrivalMs + CONTACT_HALF_MS,
      obstacle.type === 'crow' ? obstacle.departureMs : Infinity);
    if (contactStart > contactEnd + 1e-7) continue;
    const points = [contactStart, contactEnd];
    if (obstacle.type === 'ball') {
      for (const boundary of [obstacle.moveStartMs, obstacle.moveEndMs]) {
        if (boundary > contactStart && boundary < contactEnd) points.push(boundary);
      }
    }
    points.sort((a, b) => a - b);
    const relative = timeMs => xAt(timeMs) - parkObstacleLaneAt(obstacle, timeMs);
    for (const timeMs of points) {
      if (Math.abs(relative(timeMs)) <= LATERAL_CONTACT + 1e-7) return true;
    }
    for (let index = 1; index < points.length; index++) {
      const relA = relative(points[index - 1]), relB = relative(points[index]);
      if (relA * relB < 0) return true;
      if (Math.min(Math.abs(relA), Math.abs(relB)) <= LATERAL_CONTACT + 1e-7) return true;
    }
  }
  return false;
}

function nodeKey(state, timeMs) {
  const cooldownRemaining = Number.isFinite(state.lastAcceptedMs)
    ? Math.max(0, CONFIG.cooldownMs - (timeMs - state.lastAcceptedMs)) : 0;
  return [
    state.x.toFixed(4), state.lane,
    state.move ? `${state.move.from}:${state.move.to}:${(state.move.endMs - timeMs).toFixed(3)}` : '-',
    state.queue ?? '-', cooldownRemaining.toFixed(3),
  ].join('|');
}

function applySearchAction(state, timeMs, direction) {
  const next = {
    x: state.x,
    lane: state.lane,
    move: state.move ? { ...state.move } : null,
    queue: state.queue,
    lastAcceptedMs: state.lastAcceptedMs,
    inputs: state.inputs,
  };
  if (direction === null) return next;
  if (Number.isFinite(next.lastAcceptedMs) && timeMs - next.lastAcceptedMs < CONFIG.cooldownMs - 1e-7) return null;
  if (next.queue !== null) return null;
  const base = next.move ? next.move.to : next.lane;
  const target = base + direction;
  if (target < -1 || target > 1) return null;
  next.lastAcceptedMs = timeMs;
  next.inputs = [...state.inputs, { timeMs, direction }];
  if (next.move) next.queue = target;
  else next.move = { from: next.x, to: target, startMs: timeMs, endMs: timeMs + CONFIG.moveMs };
  return next;
}

function advanceSearchState(state, startMs, endMs, obstacles, direction) {
  const next = applySearchAction(state, startMs, direction);
  if (!next) return null;
  const xAt = timeMs => movingDogX(next, timeMs);
  if (hasWorldContact(obstacles, xAt, startMs, endMs)) return null;
  if (next.move && next.move.endMs <= endMs + 1e-7) {
    next.x = next.move.to;
    next.lane = next.move.to;
    const completedAt = next.move.endMs;
    next.move = null;
    if (next.queue !== null) {
      next.move = { from: next.x, to: next.queue, startMs: completedAt, endMs: completedAt + CONFIG.moveMs };
      next.queue = null;
    }
  } else {
    next.x = xAt(endMs);
  }
  return next;
}

function expandSearchStates(states, startMs, endMs, obstacles) {
  const nextStates = new Map();
  for (const state of states) {
    for (const direction of [null, -1, 1]) {
      const next = advanceSearchState(state, startMs, endMs, obstacles, direction);
      if (!next) continue;
      nextStates.set(nodeKey(next, endMs), next);
    }
  }
  return [...nextStates.values()];
}

function findReachableStationaryLanes(course) {
  const visibleTimes = new Map();
  for (const obstacle of course.obstacles) {
    const list = visibleTimes.get(obstacle.visibleStartMs) ?? [];
    list.push(obstacle.eventId);
    visibleTimes.set(obstacle.visibleStartMs, list);
  }
  const maxVisibleMs = Math.max(...visibleTimes.keys());
  assert.ok(Math.abs(maxVisibleMs / ESCAPE_SEARCH_STEP_MS - Math.round(maxVisibleMs / ESCAPE_SEARCH_STEP_MS)) < 1e-8,
    'visible starts must align with escape search step');

  let states = [{ x: 0, lane: 0, move: null, queue: null, lastAcceptedMs: -Infinity, inputs: [] }];
  const reachable = new Map([...visibleTimes.keys()].map(timeMs => [timeMs, new Map()]));
  for (let timeMs = 0; timeMs <= maxVisibleMs; timeMs += ESCAPE_SEARCH_STEP_MS) {
    if (visibleTimes.has(timeMs)) {
      const lanes = reachable.get(timeMs);
      for (const state of states) {
        if (state.move || state.queue !== null || ![-1, 0, 1].includes(state.x) || state.x !== state.lane) continue;
        if (!lanes.has(state.lane)) lanes.set(state.lane, state.inputs);
      }
    }
    if (timeMs === maxVisibleMs) break;
    states = expandSearchStates(states, timeMs, timeMs + ESCAPE_SEARCH_STEP_MS, course.obstacles);
    assert.ok(states.length > 0, `no contact-free states by ${timeMs + ESCAPE_SEARCH_STEP_MS} ms`);
  }
  return reachable;
}

function overlappingEventPassEnd(course, eventId) {
  const groups = new Map();
  for (const obstacle of course.obstacles) {
    const group = groups.get(obstacle.eventId) ?? [];
    group.push(obstacle);
    groups.set(obstacle.eventId, group);
  }
  const current = groups.get(eventId);
  const startMs = Math.min(...current.map(obstacle => obstacle.arrivalMs - CONTACT_HALF_MS));
  let endMs = Math.max(...current.map(obstacle => obstacle.arrivalMs + CONTACT_HALF_MS));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [otherId, group] of groups) {
      if (otherId === eventId) continue;
      const otherStart = Math.min(...group.map(obstacle => obstacle.arrivalMs - CONTACT_HALF_MS));
      const otherEnd = Math.max(...group.map(obstacle => obstacle.arrivalMs + CONTACT_HALF_MS));
      if (otherStart <= endMs + 1e-7 && otherEnd >= startMs - 1e-7 && otherEnd > endMs) {
        endMs = otherEnd;
        changed = true;
      }
    }
  }
  return endMs;
}

function findEscapeInputs(course, lane, startMs, endMs) {
  let states = [{ x: lane, lane, move: null, queue: null, lastAcceptedMs: -Infinity, inputs: [] }];
  let timeMs = startMs;
  while (timeMs < endMs - 1e-7) {
    const nextMs = Math.min(endMs, timeMs + ESCAPE_SEARCH_STEP_MS);
    states = expandSearchStates(states, timeMs, nextMs, course.obstacles);
    if (!states.length) return null;
    timeMs = nextMs;
  }
  return states[0]?.inputs ?? null;
}

function replayEscape(seed, course, prefixInputs, eventId, visibleStartMs, lane, suffixInputs, endMs) {
  const waitEndMs = visibleStartMs + 500;
  const events = [];
  const game = new Game({ phase: 4, seed, walkLevel: 2, course: [], obstacles: course.obstacles, onEvent: event => events.push(event) });
  const accepted = [];
  game.start();
  if (prefixInputs) {
    for (const input of prefixInputs) {
      if (input.timeMs < game.timeMs - 1e-7) continue;
      game.advance(input.timeMs - game.timeMs);
      accepted.push(game.command(input.direction, 'park-escape-prefix'));
    }
    game.advance(visibleStartMs - game.timeMs);
  } else {
    // Testing an unreachable lane as well is a conservative extension: every
    // reachable stationary state must be one of these three lane centers.
    const distance = visibleStartMs * 1.1 / 1000;
    game.timeMs = visibleStartMs;
    game.distance = distance;
    game.distanceAnchor = distance;
    game.distanceAnchorMs = visibleStartMs;
    game.x = lane;
    game.lane = lane;
  }
  assert.equal(game.x, lane, `escape prefix did not reach lane ${lane} at ${visibleStartMs}`);
  assert.equal(game.move, null);
  assert.equal(game.queue, null);
  game.advance(waitEndMs - game.timeMs);
  for (const input of suffixInputs) {
    game.advance(input.timeMs - game.timeMs);
    accepted.push(game.command(input.direction, 'park-escape'));
  }
  game.advance(endMs - game.timeMs);
  assert.ok(accepted.every(Boolean), `escape path rejected an input for ${eventId} at lane ${lane}`);
  assert.equal(game.contactCount, 0, `escape path contacted an obstacle for ${eventId} at lane ${lane}`);
  return events;
}

function verifyEscapePaths(seed, course) {
  const reachable = findReachableStationaryLanes(course);
  let reachableStates = 0;
  let waitEligibleStates = 0;
  let gameValidatedStates = 0;
  for (const [visibleStartMs, lanes] of reachable) {
    for (const [lane, prefixInputs] of lanes) {
      reachableStates++;
      const waitEndMs = visibleStartMs + 500;
      const stationaryX = () => lane;
      if (hasWorldContact(course.obstacles, stationaryX, visibleStartMs, waitEndMs)) continue;
      waitEligibleStates++;
      const eventId = course.obstacles.find(obstacle => obstacle.visibleStartMs === visibleStartMs).eventId;
      const endMs = overlappingEventPassEnd(course, eventId);
      const suffixInputs = findEscapeInputs(course, lane, waitEndMs, endMs);
      assert.ok(suffixInputs, `no 500 ms escape from event ${eventId}, lane ${lane}`);
      replayEscape(seed, course, prefixInputs, eventId, visibleStartMs, lane, suffixInputs, endMs);
      gameValidatedStates++;
    }
  }
  assert.ok(reachableStates > 0, `no reachable stationary states for seed ${seed}`);
  assert.ok(waitEligibleStates > 0, `no 500 ms wait-eligible states for seed ${seed}`);
  assert.equal(gameValidatedStates, waitEligibleStates);
  return { reachableStates, waitEligibleStates, gameValidatedStates };
}

const representativeCourses = Array.from({ length: TEMPLATE_CLASS_COUNT }, (_, seed) => createParkCourse(seed));
for (let seed = 0; seed < SEED_COUNT; seed++) {
  const course = createParkCourse(seed);
  assert.equal(course.seed, seed);
  assert.equal(course.ruleVersion, 'park30-level2-v2');
  assert.equal(course.courseVersion, 'park-level2-course-2');
  assert.equal(course.bones.length, 48);
  assert.equal(course.bones.filter(bone => bone.kind === 'gold').length, 3);
  assert.equal(course.obstacles.length, 32);
  assert.ok(course.safeInputs.length >= 38 && course.safeInputs.length <= 46,
    `safe route input count ${course.safeInputs.length} for seed ${seed}`);
  assert.equal(course.generation.fallback, false, `fallback used for seed ${seed}`);
  assert.equal(canonicalCourse(course), canonicalCourse(representativeCourses[seed % TEMPLATE_CLASS_COUNT]),
    `seed ${seed} escaped its verified layout class`);

  const run = replaySafeRoute(seed, course);
  assertSafeResult(run, `safe route seed ${seed}`);
  const visibilityEvents = run.events.filter(event => event.type === 'obstacle_visible');
  assert.equal(visibilityEvents.length, 26, `visibility event count seed ${seed}`);
  assert.equal(new Set(visibilityEvents.map(event => event.eventId)).size, 26, `duplicate visibility event seed ${seed}`);
  assert.equal(run.events.some(event => event.type === 'obstacle_warning'), false, `warning event emitted for seed ${seed}`);

  if ((seed + 1) % 100 === 0) console.log(`verified full Game safe routes: ${seed + 1}/${SEED_COUNT}`);
}

let perturbRuns = 0;
let boundaryRuns = 0;
let escapeReachableStates = 0;
let escapeWaitEligibleStates = 0;
let escapeGameValidations = 0;
for (let seed = 0; seed < TEMPLATE_CLASS_COUNT; seed++) {
  const course = representativeCourses[seed];
  verifyVisibleOverlap(course);
  const escape = verifyEscapePaths(seed, course);
  escapeReachableStates += escape.reachableStates;
  escapeWaitEligibleStates += escape.waitEligibleStates;
  escapeGameValidations += escape.gameValidatedStates;
  console.log(`verified 500 ms escape class ${seed + 1}/${TEMPLATE_CLASS_COUNT}: ${escape.gameValidatedStates} reachable/wait-safe states`);
  for (let inputIndex = 0; inputIndex < course.safeInputs.length; inputIndex++) {
    for (let offsetMs = -60; offsetMs <= 60; offsetMs += 10) {
      const run = replaySafeRoute(seed, course, { inputIndex, offsetMs });
      assertSafeResult(run, `±60 ms perturb seed ${seed}, input ${inputIndex}, offset ${offsetMs}`);
      perturbRuns++;
    }
    for (const offsetMs of getBoundaryOffsets(course, inputIndex)) {
      // The regular 10 ms sweep already covers some of these points.
      if (Number.isInteger(offsetMs / 10)) continue;
      const run = replaySafeRoute(seed, course, { inputIndex, offsetMs });
      assertSafeResult(run, `boundary perturb seed ${seed}, input ${inputIndex}, offset ${offsetMs}`);
      boundaryRuns++;
    }
  }
  console.log(`verified input robustness class ${seed + 1}/${TEMPLATE_CLASS_COUNT}`);
}

const level2FollowerEvents = [];
const level1FollowerEvents = [];
const level2StaticEvents = [];
const level1StaticEvents = [];
for (let seed = 0; seed < 32; seed++) {
  const level2 = verifySimpleFollower(seed);
  const level1 = verifyLevel1SimpleFollower(seed);
  level2FollowerEvents.push(level2.contactEvents);
  level1FollowerEvents.push(level1.contactEvents);
  for (const lane of [-1, 0, 1]) {
    level2StaticEvents.push(verifyStaticLane(seed, 2, lane).contactEvents);
    level1StaticEvents.push(verifyStaticLane(seed, 1, lane).contactEvents);
  }
}
assert.ok(Math.min(...level2FollowerEvents) >= 6, `simple follower contacts: ${level2FollowerEvents.join(',')}`);
assert.equal(Math.max(...level1FollowerEvents), 0, `Level 1 simple follower changed: ${level1FollowerEvents.join(',')}`);

console.log(JSON.stringify({
  seeds: SEED_COUNT,
  uniqueLayoutClasses: TEMPLATE_CLASS_COUNT,
  fallbackCount: 0,
  safeRouteGameReplays: SEED_COUNT,
  perturbRuns,
  boundaryRuns,
  escapeReachableStates,
  escapeWaitEligibleStates,
  escapeGameValidations,
  level2SimpleFollowerMinContactEvents: Math.min(...level2FollowerEvents),
  level2SimpleFollowerMaxContactEvents: Math.max(...level2FollowerEvents),
  level1SimpleFollowerMaxContactEvents: Math.max(...level1FollowerEvents),
  level2StaticLaneMinContactEvents: Math.min(...level2StaticEvents),
  level2StaticLaneMaxContactEvents: Math.max(...level2StaticEvents),
  level1StaticLaneMinContactEvents: Math.min(...level1StaticEvents),
  level1StaticLaneMaxContactEvents: Math.max(...level1StaticEvents),
}, null, 2));
