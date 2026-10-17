import test from 'node:test';
import assert from 'node:assert/strict';
import { getWalkLevel } from '../src/walk-levels.js';
import { PARK_LEVEL2, createParkCourse, parkObstacleActiveAt, parkObstacleLaneAt, parkObstacleVisibleAt } from '../src/park-course.js';

function eventGroups(obstacles) {
  const groups = new Map();
  for (const obstacle of obstacles) {
    const group = groups.get(obstacle.eventId) ?? [];
    group.push(obstacle);
    groups.set(obstacle.eventId, group);
  }
  return [...groups.values()];
}

test('walk level 2 publishes its versioned 30-second park contract', () => {
  assert.deepEqual(getWalkLevel(2), {
    id: 2,
    name: 'こうえんのおさんぽ',
    theme: 'park',
    durationMs: 30_000,
    speed: 1.1,
    layoutClasses: 32,
    ruleVersion: 'park30-level2-v2',
    courseVersion: 'park-level2-course-2',
  });
  assert.equal(getWalkLevel('2').id, 2);
  assert.equal(getWalkLevel(0).id, 1);
});

test('park courses follow the planned bone and obstacle distribution with deterministic metadata', () => {
  for (const seed of [0, 1, 15, 16, 31, 42, 137]) {
    const course = createParkCourse(seed);
    assert.deepEqual(createParkCourse(seed), course, `deterministic seed ${seed}`);
    assert.equal(course.seed, seed);
    assert.equal(course.ruleVersion, PARK_LEVEL2.ruleVersion);
    assert.equal(course.courseVersion, PARK_LEVEL2.courseVersion);
    assert.equal(course.bones.length, 48);
    assert.equal(course.bones.filter(bone => bone.kind === 'gold').length, 3);
    assert.equal(course.bones.filter(bone => bone.kind !== 'gold').length, 45);
    assert.equal(course.goldIds.length, 3);
    assert.equal(course.goldCandidates.length, 3);
    assert.equal(course.obstacles.length, 32);
    assert.equal(new Set(course.obstacles.map(obstacle => obstacle.eventId)).size, 26);
    assert.deepEqual(Object.fromEntries(['puddle', 'crow', 'ball'].map(type => [
      type, course.obstacles.filter(obstacle => obstacle.type === type).length,
    ])), { puddle: 18, crow: 8, ball: 6 });

    assert.deepEqual([
      course.bones.filter(bone => bone.timeMs < 3_000).length,
      course.bones.filter(bone => bone.timeMs >= 3_000 && bone.timeMs < 10_000).length,
      course.bones.filter(bone => bone.timeMs >= 10_000 && bone.timeMs < 20_000).length,
      course.bones.filter(bone => bone.timeMs >= 20_000 && bone.timeMs < 30_000).length,
    ], [2, 11, 18, 17]);
    assert.ok(course.bones.at(-1).timeMs <= 29_200);
    for (let index = 1; index < course.bones.length; index++) {
      const gap = course.bones[index].timeMs - course.bones[index - 1].timeMs;
      assert.ok(gap >= 500 && gap <= 950, `bone spacing ${seed}:${index}=${gap}`);
    }
    for (const target of [8_000, 17_000, 26_000]) {
      const bone = course.bones.find(item => Math.abs(item.timeMs - target) ===
        Math.min(...course.bones.map(candidate => Math.abs(candidate.timeMs - target))));
      assert.ok(Math.abs(bone.timeMs - target) <= 500, `gold target ${target}`);
    }

    const groups = eventGroups(course.obstacles);
    assert.equal(groups.filter(group => group[0].type === 'puddle' && group.length === 2).length, 6);
    assert.equal(groups.filter(group => group[0].type === 'puddle' && group.length === 1).length, 6);
    assert.equal(groups.filter(group => group[0].type === 'crow').length, 8);
    assert.equal(groups.filter(group => group[0].type === 'ball').length, 6);
    const eventRows = groups.map(group => ({ arrivalMs: group[0].arrivalMs, type: group[0].type }))
      .sort((a, b) => a.arrivalMs - b.arrivalMs);
    assert.equal(eventRows.filter(event => event.arrivalMs >= 10_000 && event.arrivalMs < 20_000 && event.type === 'puddle').length, 4);
    assert.equal(eventRows.filter(event => event.arrivalMs >= 20_000 && event.type === 'puddle').length, 4);
    assert.equal(eventRows.filter(event => event.arrivalMs >= 10_000 && event.arrivalMs < 20_000 && event.type === 'ball').length, 3);
    assert.equal(eventRows.filter(event => event.arrivalMs >= 20_000 && event.type === 'ball').length, 3);
    assert.ok(eventRows.at(-1).arrivalMs <= 28_600);
    for (let index = 1; index < eventRows.length; index++) {
      assert.ok(eventRows[index].arrivalMs - eventRows[index - 1].arrivalMs >= 750);
    }
    const balls = eventRows.filter(event => event.type === 'ball');
    for (let index = 1; index < balls.length; index++) {
      assert.ok(balls[index].arrivalMs - balls[index - 1].arrivalMs >= 2_500);
    }

    assert.ok(course.safeInputs.length >= 38 && course.safeInputs.length <= 46);
    assert.deepEqual(course.safeInputs, [...course.safeInputs].sort((a, b) => a.timeMs - b.timeMs));
    assert.ok(course.safeInputs.every(input => Object.keys(input).sort().join(',') === 'direction,timeMs'));
    for (let index = 1; index < course.safeInputs.length; index++) {
      assert.ok(course.safeInputs[index].timeMs - course.safeInputs[index - 1].timeMs >= 100);
    }
    for (const obstacle of course.obstacles) {
      assert.ok(obstacle.id && obstacle.eventId);
      assert.ok(Number.isFinite(obstacle.arrivalMs) && Number.isFinite(obstacle.visibleStartMs));
      assert.equal(obstacle.visibleStartMs, obstacle.arrivalMs - 1_800);
      assert.equal(obstacle.warningStartMs, obstacle.visibleStartMs, 'legacy numeric alias points to body visibility');
      if (obstacle.type === 'crow') {
        assert.equal(obstacle.groundedStartMs, obstacle.visibleStartMs);
        assert.equal(Object.hasOwn(obstacle, 'landingMs'), false, 'generated crows have no later landing trigger');
        assert.equal(obstacle.departureMs, obstacle.arrivalMs + 400);
      }
      if (obstacle.type === 'ball') {
        for (const field of ['moveStartMs', 'moveEndMs', 'fromLane', 'toLane']) assert.ok(Number.isFinite(obstacle[field]));
        assert.equal(obstacle.moveStartMs, obstacle.visibleStartMs);
        assert.equal(obstacle.moveEndMs, obstacle.arrivalMs + 300);
        assert.equal(obstacle.moveEndMs - obstacle.moveStartMs, 2_100);
      }
    }
    assert.equal(course.generation.safeInputCount, course.safeInputs.length);
    assert.equal(course.generation.fallback, false);
  }
});

test('visible event windows never overlap more than two distinct events', () => {
  const course = createParkCourse(42);
  const events = eventGroups(course.obstacles).map(group => ({
    start: group[0].visibleStartMs,
    end: group[0].arrivalMs + 145.45454545454547,
  }));
  const boundaries = [...new Set(events.flatMap(event => [event.start, event.end]))];
  for (const timeMs of boundaries) {
    assert.ok(events.filter(event => event.start <= timeMs && event.end >= timeMs).length <= 2);
  }
});

test('obstacle lane and visual lifecycle APIs share the visible ball trajectory', () => {
  const course = createParkCourse(42);
  const ball = course.obstacles.find(obstacle => obstacle.type === 'ball');
  assert.equal(parkObstacleVisibleAt(ball, ball.moveStartMs - 1), false);
  assert.equal(parkObstacleLaneAt(ball, ball.moveStartMs - 1), ball.fromLane);
  assert.equal(parkObstacleLaneAt(ball, ball.moveStartMs), ball.fromLane);
  assert.equal(parkObstacleLaneAt(ball, (ball.moveStartMs + ball.moveEndMs) / 2), (ball.fromLane + ball.toLane) / 2);
  assert.equal(parkObstacleLaneAt(ball, ball.moveEndMs), ball.toLane);
  assert.equal(parkObstacleLaneAt(ball, ball.moveEndMs + 1), ball.toLane);
  assert.equal(parkObstacleActiveAt(ball, ball.visibleStartMs - 1), false);
  assert.equal(parkObstacleActiveAt(ball, ball.visibleStartMs), true);
  assert.equal(parkObstacleVisibleAt(ball, ball.visibleStartMs), true);
  assert.equal(parkObstacleActiveAt(ball, ball.moveStartMs), true);

  const crow = course.obstacles.find(obstacle => obstacle.type === 'crow');
  assert.equal(parkObstacleActiveAt(crow, crow.visibleStartMs - 1), false);
  assert.equal(parkObstacleActiveAt(crow, crow.visibleStartMs), true);
  assert.equal(parkObstacleVisibleAt(crow, crow.visibleStartMs), true);
  assert.equal(parkObstacleActiveAt(crow, crow.departureMs), true);
  assert.equal(parkObstacleActiveAt(crow, crow.departureMs + 1), false);

  const puddle = course.obstacles.find(obstacle => obstacle.type === 'puddle');
  assert.equal(parkObstacleActiveAt(puddle, puddle.visibleStartMs - 1), false);
  assert.equal(parkObstacleActiveAt(puddle, puddle.visibleStartMs), true);
  assert.equal(parkObstacleActiveAt(puddle, puddle.arrivalMs), true);
  assert.equal(parkObstacleActiveAt(puddle, puddle.arrivalMs + 150), false);
});
