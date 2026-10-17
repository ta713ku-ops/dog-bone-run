import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { CAVE_LEVEL4, createCaveCourse } from '../src/cave-course.js';

const SEED_COUNT = 1_000;
const ROBUSTNESS_SEEDS = [0, 1, 42, 137];
const FRAME_SCHEDULES_MS = [1_000 / 60, 1_000 / 30, 50];
const EPSILON = 1e-7;

function groupsByEvent(obstacles) {
  const groups = new Map();
  for (const obstacle of obstacles) {
    const group = groups.get(obstacle.eventId) ?? [];
    group.push(obstacle);
    groups.set(obstacle.eventId, group);
  }
  return [...groups.values()];
}

function assertCourseContract(course, seed) {
  assert.equal(course.seed, seed);
  assert.equal(course.ruleVersion, CAVE_LEVEL4.ruleVersion);
  assert.equal(course.courseVersion, CAVE_LEVEL4.courseVersion);
  assert.equal(course.events.length, 54);
  assert.equal(course.bones.length, 48);
  assert.equal(course.bones.filter(bone => bone.kind === 'gold').length, 3);
  assert.equal(course.obstacles.length, 90);
  assert.equal(course.safeInputs.length, 72);
  assert.equal(course.generation.edgeCrossingCount, 18);
  assert.equal(course.generation.fallback, false);

  const groups = groupsByEvent(course.obstacles);
  assert.equal(groups.length, 54);
  assert.equal(groups.filter(group => group.length === 2 && group.every(item => item.type !== 'bat')).length, 18);
  assert.equal(groups.filter(group => group.length === 1 && group[0].type === 'bat').length, 18);
  assert.equal(groups.filter(group => group.length === 2 && group.some(item => item.type === 'bat')).length, 18);
  assert.equal(course.obstacles.filter(item => item.type === 'bat').length, 36);
  for (const type of ['stalagmite', 'stalactite', 'caveRock']) {
    assert.equal(course.obstacles.filter(item => item.type === type).length, 18);
  }
  const gaps = course.events.slice(1).map((event, index) => event.arrivalMs - course.events[index].arrivalMs);
  assert.equal(gaps.filter(gap => gap === 720).length, 18);
  assert.equal(gaps.filter(gap => gap === 380).length, 35);
  assert.equal(course.events[0].arrivalMs, 2_200);
  assert.equal(course.events.at(-1).arrivalMs, 28_460);
}

function finishAndAssert(game, context) {
  assert.equal(game.state, 'result', `${context}: did not finish`);
  assert.equal(game.timeMs, CAVE_LEVEL4.durationMs, `${context}: duration`);
  assert.equal(game.collected, 48, `${context}: missed bone`);
  assert.equal(game.normalCollected, 45, `${context}: normal bones`);
  assert.equal(game.goldCollected, 3, `${context}: gold bones`);
  assert.equal(game.contactCount, 0, `${context}: obstacle contacts`);
  assert.equal(game.contactEventCount, 0, `${context}: contacted events`);
}

function replay(seed, inputs, perturb = null) {
  const game = new Game({ phase: 4, walkLevel: 4, seed });
  assert.equal(game.start(), true);
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const timeMs = input.timeMs + (perturb?.index === index ? perturb.offsetMs : 0);
    assert.ok(timeMs >= game.timeMs - EPSILON,
      `input order seed ${seed}, input ${index}, perturb ${JSON.stringify(perturb)}`);
    game.advance(Math.max(0, timeMs - game.timeMs));
    assert.equal(game.command(input.direction, 'cave-course-verification'), true,
      `input rejected seed ${seed}, input ${index}, perturb ${JSON.stringify(perturb)}`);
  }
  game.advance(Math.max(0, CAVE_LEVEL4.durationMs - game.timeMs));
  return game;
}

function replayFramed(seed, inputs, frameMs) {
  const game = new Game({ phase: 4, walkLevel: 4, seed });
  assert.equal(game.start(), true);
  let inputIndex = 0;
  let frameIndex = 1;
  while (game.timeMs < CAVE_LEVEL4.durationMs - EPSILON) {
    const frameEndMs = Math.min(CAVE_LEVEL4.durationMs, frameIndex * frameMs);
    const input = inputs[inputIndex];
    if (input && input.timeMs <= frameEndMs + EPSILON) {
      game.advance(Math.max(0, input.timeMs - game.timeMs));
      assert.equal(game.command(input.direction, `frame-${frameMs}-verification`), true,
        `input rejected at ${frameMs} ms frame schedule, input ${inputIndex}`);
      inputIndex++;
    } else {
      game.advance(frameEndMs - game.timeMs);
      frameIndex++;
    }
  }
  assert.equal(inputIndex, inputs.length, `not all inputs sent at ${frameMs} ms frame schedule`);
  return game;
}

let minimumInputs = Infinity;
let maximumInputs = -Infinity;
for (let seed = 0; seed < SEED_COUNT; seed++) {
  const course = createCaveCourse(seed);
  assertCourseContract(course, seed);
  finishAndAssert(replay(seed, course.safeInputs), `nominal safe route seed ${seed}`);
  minimumInputs = Math.min(minimumInputs, course.safeInputs.length);
  maximumInputs = Math.max(maximumInputs, course.safeInputs.length);
  if ((seed + 1) % 100 === 0) console.log(`verified nominal Game routes: ${seed + 1}/${SEED_COUNT}`);
}

let perturbRuns = 0;
for (const seed of ROBUSTNESS_SEEDS) {
  const course = createCaveCourse(seed);
  for (let index = 0; index < course.safeInputs.length; index++) {
    for (const offsetMs of [-40, 40]) {
      finishAndAssert(replay(seed, course.safeInputs, { index, offsetMs }),
        `input ${index} shifted ${offsetMs} ms, seed ${seed}`);
      perturbRuns++;
    }
  }
}

const frameRuns = [];
for (const frameMs of FRAME_SCHEDULES_MS) {
  finishAndAssert(replayFramed(42, createCaveCourse(42).safeInputs, frameMs), `frame ${frameMs} ms`);
  frameRuns.push(frameMs);
}

console.log(JSON.stringify({
  seeds: SEED_COUNT,
  nominalSafeGameReplays: SEED_COUNT,
  individualPlusMinus40MsGameReplays: perturbRuns,
  frameScheduleMs: frameRuns,
  safeInputCountRange: [minimumInputs, maximumInputs],
}, null, 2));
