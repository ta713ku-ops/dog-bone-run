import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/game.js';
import {
  MOUNTAIN_LEVEL3,
  createMountainCourse,
  mountainObstacleActiveAt,
  mountainObstacleLaneAt,
  mountainObstacleVisibleAt,
} from '../src/mountain-course.js';

const LANES = [-1, 0, 1];
const MOVE_MS = CONFIG.moveMs;
const SPEED = MOUNTAIN_LEVEL3.speed;
const BONE_HALF_MS = (CONFIG.dogHalfLength + CONFIG.boneHalfLength) * 1000 / SPEED;
const OBSTACLE_HALF_MS = (CONFIG.dogHalfLength + CONFIG.obstacleHalfLength) * 1000 / SPEED;
const BONE_LATERAL = CONFIG.dogHalfWidth + CONFIG.boneHalfWidth;
const OBSTACLE_LATERAL = CONFIG.dogHalfWidth + CONFIG.obstacleHalfWidth;

function eventGroups(obstacles) {
  const groups = new Map();
  for (const obstacle of obstacles) groups.set(obstacle.eventId, [...(groups.get(obstacle.eventId) ?? []), obstacle]);
  return [...groups.values()];
}

function boneOnlyInputs(bones) {
  const inputs = [];
  let lane = 0;
  for (const bone of bones) {
    const delta = bone.lane - lane;
    const moveCount = Math.abs(delta);
    for (let step = 0; step < moveCount; step++) {
      inputs.push({
        timeMs: bone.timeMs - (moveCount - step) * MOVE_MS,
        direction: Math.sign(delta),
      });
    }
    lane = bone.lane;
  }
  return inputs;
}

function routeSegments(inputs) {
  let lane = 0;
  let cursorMs = 0;
  const segments = [];
  for (const input of inputs) {
    const toLane = lane + input.direction;
    assert.ok(LANES.includes(toLane), `input leaves the three lanes: ${JSON.stringify(input)}`);
    assert.ok(input.timeMs >= cursorMs, `overlapping route input: ${JSON.stringify(input)}`);
    if (input.timeMs > cursorMs) segments.push({ startMs: cursorMs, endMs: input.timeMs, fromLane: lane, toLane: lane });
    segments.push({ startMs: input.timeMs, endMs: input.timeMs + MOVE_MS, fromLane: lane, toLane });
    lane = toLane;
    cursorMs = input.timeMs + MOVE_MS;
  }
  segments.push({ startMs: cursorMs, endMs: MOUNTAIN_LEVEL3.durationMs, fromLane: lane, toLane: lane });
  return segments;
}

function laneAt(segments, timeMs) {
  for (const segment of segments) {
    if (timeMs < segment.startMs - 1e-8 || timeMs > segment.endMs + 1e-8) continue;
    const progress = segment.endMs === segment.startMs ? 1 : (timeMs - segment.startMs) / (segment.endMs - segment.startMs);
    return segment.fromLane + (segment.toLane - segment.fromLane) * progress;
  }
  return timeMs < 0 ? 0 : segments.at(-1).toLane;
}

function breakpoints(segments, obstacle, startMs, endMs) {
  const points = new Set([startMs, endMs]);
  for (const segment of segments) {
    if (segment.startMs > startMs && segment.startMs < endMs) points.add(segment.startMs);
    if (segment.endMs > startMs && segment.endMs < endMs) points.add(segment.endMs);
  }
  if (obstacle?.type === 'rollingStone') {
    if (obstacle.moveStartMs > startMs && obstacle.moveStartMs < endMs) points.add(obstacle.moveStartMs);
    if (obstacle.moveEndMs > startMs && obstacle.moveEndMs < endMs) points.add(obstacle.moveEndMs);
  }
  return [...points].sort((a, b) => a - b);
}

function minDistanceToBoneLane(segments, lane, startMs, endMs) {
  let closest = Infinity;
  for (const segment of segments) {
    const start = Math.max(startMs, segment.startMs), end = Math.min(endMs, segment.endMs);
    if (start > end) continue;
    const x0 = laneAt(segments, start), x1 = laneAt(segments, end);
    closest = Math.min(closest, Math.abs(x0 - lane), Math.abs(x1 - lane));
    if (lane >= Math.min(x0, x1) && lane <= Math.max(x0, x1)) return 0;
  }
  return closest;
}

function minRelativeLaneDistance(segments, obstacle, startMs, endMs) {
  const points = breakpoints(segments, obstacle, startMs, endMs);
  let closest = Infinity;
  for (let index = 0; index < points.length; index++) {
    const timeMs = points[index];
    const relative = laneAt(segments, timeMs) - mountainObstacleLaneAt(obstacle, timeMs);
    closest = Math.min(closest, Math.abs(relative));
    if (index === points.length - 1) continue;
    const next = laneAt(segments, points[index + 1]) - mountainObstacleLaneAt(obstacle, points[index + 1]);
    if (relative === next) continue;
    const crossing = -relative / (next - relative);
    if (crossing >= 0 && crossing <= 1) closest = 0;
  }
  return closest;
}

function assertSafeRoute(course, perturb = null) {
  const inputs = course.safeInputs.map((input, index) => ({
    ...input,
    timeMs: input.timeMs + (perturb?.index === index ? perturb.offsetMs : 0),
  }));
  const segments = routeSegments(inputs);
  for (const bone of course.bones) {
    const closest = minDistanceToBoneLane(segments, bone.lane,
      bone.timeMs - BONE_HALF_MS, bone.timeMs + BONE_HALF_MS);
    assert.ok(closest <= BONE_LATERAL + 1e-9,
      `seed ${course.seed} misses ${bone.id} at ${bone.timeMs} by ${closest}`);
  }
  for (const obstacle of course.obstacles) {
    const closest = minRelativeLaneDistance(segments, obstacle,
      obstacle.arrivalMs - OBSTACLE_HALF_MS, obstacle.arrivalMs + OBSTACLE_HALF_MS);
    assert.ok(closest > OBSTACLE_LATERAL + 1e-9,
      `seed ${course.seed} contacts ${obstacle.id} at ${obstacle.arrivalMs} (relative lane ${closest})`);
  }
}

test('mountain Level 3 publishes the planned 30-second contract and deterministic course counts', () => {
  assert.deepEqual(MOUNTAIN_LEVEL3, {
    durationMs: 30_000,
    speed: 1.25,
    ruleVersion: 'mountain30-level3-v1',
    courseVersion: 'mountain-level3-course-1',
    eventCount: 39,
    obstacleCount: 57,
  });

  for (const seed of [0, 1, 16, 42, 137]) {
    const course = createMountainCourse(seed);
    assert.deepEqual(createMountainCourse(seed), course, `deterministic seed ${seed}`);
    assert.equal(course.seed, seed);
    assert.equal(course.ruleVersion, MOUNTAIN_LEVEL3.ruleVersion);
    assert.equal(course.courseVersion, MOUNTAIN_LEVEL3.courseVersion);
    assert.equal(course.bones.length, 48);
    assert.equal(course.bones.filter(bone => bone.kind === 'gold').length, 3);
    assert.equal(course.goldIds.length, 3);
    assert.equal(course.goldCandidates.length, 3);
    assert.equal(course.obstacles.length, 57);

    const groups = eventGroups(course.obstacles);
    assert.equal(groups.length, 39);
    assert.equal(groups.filter(group => group.length === 2 && group.every(item => item.type !== 'rollingStone')).length, 18);
    assert.equal(groups.filter(group => group.length === 1 && group[0].type === 'rollingStone').length, 12);
    assert.equal(groups.filter(group => group.length === 1 && group[0].type !== 'rollingStone').length, 9);
    assert.equal(course.obstacles.filter(item => ['root', 'rock', 'log'].includes(item.type)).length, 45);
    assert.equal(course.obstacles.filter(item => item.type === 'rollingStone').length, 12);
    assert.deepEqual([...new Set(course.obstacles.filter(item => item.type !== 'rollingStone').map(item => item.type))].sort(),
      ['log', 'rock', 'root']);

    const arrivals = groups.map(group => group[0].arrivalMs).sort((a, b) => a - b);
    assert.ok(arrivals[0] >= 2_500);
    assert.ok(arrivals.at(-1) < 29_000);
    assert.ok(course.bones.at(-1).timeMs < 29_000);
    for (const obstacle of course.obstacles) {
      assert.equal(obstacle.distance, obstacle.arrivalMs * MOUNTAIN_LEVEL3.speed / 1000);
      assert.ok(obstacle.visibleStartMs < obstacle.arrivalMs);
      if (obstacle.type === 'rollingStone') {
        assert.equal(obstacle.moveStartMs, obstacle.visibleStartMs);
        assert.ok([200, 300].includes(obstacle.moveEndMs - obstacle.arrivalMs));
        assert.equal(Math.abs(obstacle.fromLane - obstacle.toLane), 1, 'stone only crosses adjacent lanes');
      }
    }
    for (const bone of course.bones) assert.equal(bone.distance, bone.timeMs * MOUNTAIN_LEVEL3.speed / 1000);
    assert.equal(course.generation.safeInputCount, course.safeInputs.length);
    assert.equal(course.generation.fallback, false);
    assert.ok(course.safeInputs.every(input => Object.keys(input).sort().join(',') === 'direction,timeMs'));
    assert.equal(course.safeInputs.length, 50, 'safe play requires the planned route changes and hazard detours');
    assert.equal(course.generation.twoStepDetourCount, 11, 'eleven gaps require crossing both adjacent lanes');
    assert.ok(course.generation.boneLaneChanges >= 45, 'bone lanes vary throughout the route');
  }
  assert.notDeepEqual(createMountainCourse(0).obstacles, createMountainCourse(1).obstacles,
    'seed changes lane layout and obstacle arrangement');
  assert.notDeepEqual(createMountainCourse(0).safeInputs, createMountainCourse(1).safeInputs,
    'seed changes the safe route');
});

test('rolling stones move continuously while visible and use a separate contact lifetime', () => {
  const course = createMountainCourse(42);
  const stone = course.obstacles.find(obstacle => obstacle.type === 'rollingStone');
  const middle = (stone.moveStartMs + stone.moveEndMs) / 2;
  assert.equal(mountainObstacleVisibleAt(stone, stone.visibleStartMs - 1), false);
  assert.equal(mountainObstacleVisibleAt(stone, stone.visibleStartMs), true);
  assert.equal(mountainObstacleLaneAt(stone, stone.moveStartMs), stone.fromLane);
  assert.equal(mountainObstacleLaneAt(stone, middle), (stone.fromLane + stone.toLane) / 2);
  assert.equal(mountainObstacleLaneAt(stone, stone.moveEndMs), stone.toLane);
  assert.equal(mountainObstacleLaneAt(stone, stone.moveEndMs + 1), stone.toLane);
  assert.equal(mountainObstacleVisibleAt(stone, stone.moveEndMs), true);
  assert.equal(mountainObstacleVisibleAt(stone, stone.moveEndMs + 1), true);
  assert.equal(mountainObstacleVisibleAt(stone, stone.arrivalMs + 600), true);
  assert.equal(mountainObstacleVisibleAt(stone, stone.arrivalMs + 601), false);
  assert.equal(mountainObstacleActiveAt(stone, stone.visibleStartMs), true);
  assert.equal(mountainObstacleActiveAt(stone, stone.arrivalMs + OBSTACLE_HALF_MS), true);
  assert.equal(mountainObstacleActiveAt(stone, stone.arrivalMs + OBSTACLE_HALF_MS + 1), false);

  const staticObstacle = course.obstacles.find(obstacle => obstacle.type !== 'rollingStone');
  assert.equal(mountainObstacleVisibleAt(staticObstacle, staticObstacle.visibleStartMs - 1), false);
  assert.equal(mountainObstacleVisibleAt(staticObstacle, staticObstacle.visibleStartMs), true);
  assert.equal(mountainObstacleVisibleAt(staticObstacle, staticObstacle.arrivalMs + OBSTACLE_HALF_MS), true);
  assert.equal(mountainObstacleVisibleAt(staticObstacle, staticObstacle.arrivalMs + OBSTACLE_HALF_MS + 1), false);
});

test('every generated route collects all bones and clears every obstacle with each input shifted by 40 ms', () => {
  for (const seed of [0, 1, 42, 137]) {
    const course = createMountainCourse(seed);
    assertSafeRoute(course);
    for (let index = 0; index < course.safeInputs.length; index++) {
      for (const offsetMs of [-40, 40]) assertSafeRoute(course, { index, offsetMs });
    }
  }
});

test('the integrated Game collects all 48 bones with no contacts for every individual input shift', () => {
  for (const seed of [0, 1, 42]) {
    const course = createMountainCourse(seed);
    const scenarios = [null, ...course.safeInputs.flatMap((_, index) => [-40, 40].map(offsetMs => ({ index, offsetMs })) )];
    for (const perturb of scenarios) {
      const game = new Game({ phase: 4, walkLevel: 3, seed });
      assert.equal(game.start(), true);
      let cursorMs = 0;
      for (let index = 0; index < course.safeInputs.length; index++) {
        const input = course.safeInputs[index];
        const timeMs = input.timeMs + (perturb?.index === index ? perturb.offsetMs : 0);
        game.advance(timeMs - cursorMs);
        cursorMs = timeMs;
        assert.equal(game.command(input.direction), true, `seed ${seed}, input ${index}, perturb ${JSON.stringify(perturb)}`);
      }
      game.advance(MOUNTAIN_LEVEL3.durationMs - cursorMs);
      assert.equal(game.state, 'result', `seed ${seed}, perturb ${JSON.stringify(perturb)}`);
      assert.equal(game.collected, 48, `seed ${seed}, perturb ${JSON.stringify(perturb)}`);
      assert.equal(game.contactCount, 0, `seed ${seed}, perturb ${JSON.stringify(perturb)}`);
      assert.equal(game.contactEventCount, 0, `seed ${seed}, perturb ${JSON.stringify(perturb)}`);
    }
  }
});

test('a bone-only chase collects bones but repeatedly hits hazards', () => {
  for (const seed of [0, 1, 42, 137, 2026]) {
    const course = createMountainCourse(seed);
    const game = new Game({ phase: 4, walkLevel: 3, seed });
    assert.equal(game.start(), true);
    let cursorMs = 0;
    for (const input of boneOnlyInputs(course.bones)) {
      assert.ok(input.timeMs >= cursorMs, `bone-only inputs overlap for seed ${seed}`);
      game.advance(input.timeMs - cursorMs);
      cursorMs = input.timeMs;
      assert.equal(game.command(input.direction), true, `bone-only input rejected for seed ${seed}`);
    }
    game.advance(MOUNTAIN_LEVEL3.durationMs - cursorMs);
    assert.equal(game.collected, 48, `bone-only chase should still reach every bone for seed ${seed}`);
    assert.ok(game.contactCount >= 12,
      `obstacle-blind bone chasing should incur repeated contacts, seed ${seed}: ${game.contactCount}`);
  }
});
