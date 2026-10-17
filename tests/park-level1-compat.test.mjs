import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSprintCourse } from '../src/sprint-course.js';
import { Game } from '../src/game.js';

const baseline = JSON.parse(readFileSync(new URL('./park-level1-baseline.json', import.meta.url), 'utf8'));

function courseSnapshot(course) {
  return {
    seed: course.seed,
    bones: course.bones,
    obstacles: course.obstacles,
    goldCandidates: course.goldCandidates,
    goldIds: course.goldIds,
  };
}

function eventSnapshot(events) {
  const inputs = events.filter(event => event.type === 'input').map(event => ({
    activeMs: event.activeMs,
    direction: event.direction,
    accepted: event.accepted,
    reason: event.reason ?? null,
    queued: Boolean(event.queued),
  }));
  const resolution = events.filter(event => ['collect', 'miss', 'obstacle_contact'].includes(event.type)).map(event => {
    if (event.type === 'collect') return {
      type: event.type, activeMs: event.activeMs, boneId: event.boneId, points: event.points, score: event.score,
    };
    if (event.type === 'miss') return { type: event.type, activeMs: event.activeMs, boneId: event.boneId };
    return {
      type: event.type, activeMs: event.activeMs, obstacleId: event.obstacleId,
      obstacleType: event.obstacleType, points: event.points, score: event.score,
    };
  });
  return { inputs, resolution };
}

test('Level 1 park integration preserves 100 original courses and fixed-input Game results', () => {
  assert.equal(baseline.courses.length, 100);
  assert.equal(baseline.runs.length, 100);
  for (let seed = 0; seed < 100; seed++) {
    assert.deepEqual(courseSnapshot(createSprintCourse(seed)), baseline.courses[seed], `course seed ${seed}`);

    const events = [];
    const game = new Game({ phase: 4, seed, walkLevel: 1, onEvent: event => events.push(event) });
    assert.equal(game.walkLevel, 1);
    assert.equal(game.durationMs, 30_000);
    assert.equal(game.speed, 1);
    assert.equal(game.courseData, null);
    game.start();
    for (const input of baseline.fixedInputs) {
      game.advance(input.timeMs - game.timeMs);
      game.command(input.direction, 'level1-baseline');
    }
    game.advance(game.durationMs - game.timeMs);

    assert.deepEqual(game.result(), baseline.runs[seed].result, `result seed ${seed}`);
    assert.deepEqual(eventSnapshot(events), {
      inputs: baseline.runs[seed].inputs,
      resolution: baseline.runs[seed].resolution,
    }, `input and scoring trace seed ${seed}`);
  }
});
