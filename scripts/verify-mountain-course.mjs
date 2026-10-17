import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/game.js';
import { createMountainCourse, MOUNTAIN_LEVEL3 } from '../src/mountain-course.js';

const SEED_COUNT = 1_000;
const ROBUSTNESS_SEEDS = [0, 1, 42, 137];
const BONE_CHASE_SEEDS = Array.from({ length: 24 }, (_, seed) => seed);
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
  assert.equal(course.ruleVersion, MOUNTAIN_LEVEL3.ruleVersion);
  assert.equal(course.courseVersion, MOUNTAIN_LEVEL3.courseVersion);
  assert.equal(course.bones.length, 48);
  assert.equal(course.bones.filter(bone => bone.kind === 'gold').length, 3);
  assert.equal(course.obstacles.length, 57);
  assert.equal(course.safeInputs.length, 50, `route inputs for seed ${seed}`);
  assert.equal(course.generation.twoStepDetourCount, 11, `two-step detours for seed ${seed}`);
  assert.ok(course.generation.boneLaneChanges >= 45, `too few bone lane changes for seed ${seed}`);
  assert.equal(course.generation.fallback, false);
  const groups = groupsByEvent(course.obstacles);
  assert.equal(groups.length, 39);
  assert.equal(groups.filter(group => group.length === 2 && group.every(item => item.type !== 'rollingStone')).length, 18);
  assert.equal(groups.filter(group => group.length === 1 && group[0].type === 'rollingStone').length, 12);
  assert.equal(groups.filter(group => group.length === 1 && group[0].type !== 'rollingStone').length, 9);
  assert.ok(Math.min(...groups.map(group => group[0].arrivalMs)) >= 2_500);
  assert.ok(Math.max(...groups.map(group => group[0].arrivalMs)) < 29_000);
}

function replay(seed, course, inputs, perturb = null) {
  const game = new Game({ phase: 4, walkLevel: 3, seed });
  assert.equal(game.start(), true);
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const timeMs = input.timeMs + (perturb?.index === index ? perturb.offsetMs : 0);
    assert.ok(timeMs >= game.timeMs - EPSILON, `input order seed ${seed}, input ${index}`);
    game.advance(Math.max(0, timeMs - game.timeMs));
    assert.equal(game.command(input.direction, 'mountain-course-verification'), true,
      `input rejected seed ${seed}, input ${index}, perturb ${JSON.stringify(perturb)}`);
  }
  game.advance(Math.max(0, MOUNTAIN_LEVEL3.durationMs - game.timeMs));
  return game;
}

function assertSafeGame(game, seed, context) {
  assert.equal(game.state, 'result', `${context}: game did not finish, seed ${seed}`);
  assert.equal(game.timeMs, MOUNTAIN_LEVEL3.durationMs, `${context}: duration, seed ${seed}`);
  assert.equal(game.collected, 48, `${context}: missed bone, seed ${seed}`);
  assert.equal(game.normalCollected, 45, `${context}: normal bone count, seed ${seed}`);
  assert.equal(game.goldCollected, 3, `${context}: gold count, seed ${seed}`);
  assert.equal(game.contactCount, 0, `${context}: obstacle contact, seed ${seed}`);
  assert.equal(game.contactEventCount, 0, `${context}: contact event, seed ${seed}`);
}

function makeBoneOnlyInputs(bones) {
  const inputs = [];
  let lane = 0;
  for (const bone of bones) {
    const delta = bone.lane - lane;
    const moveCount = Math.abs(delta);
    for (let step = 0; step < moveCount; step++) {
      inputs.push({ timeMs: bone.timeMs - (moveCount - step) * CONFIG.moveMs, direction: Math.sign(delta) });
    }
    lane = bone.lane;
  }
  return inputs;
}

let minimumInputCount = Infinity;
let maximumInputCount = -Infinity;
for (let seed = 0; seed < SEED_COUNT; seed++) {
  const course = createMountainCourse(seed);
  assertCourseContract(course, seed);
  const game = replay(seed, course, course.safeInputs);
  assertSafeGame(game, seed, 'nominal safe route');
  minimumInputCount = Math.min(minimumInputCount, course.safeInputs.length);
  maximumInputCount = Math.max(maximumInputCount, course.safeInputs.length);
  if ((seed + 1) % 100 === 0) console.log(`verified nominal Game routes: ${seed + 1}/${SEED_COUNT}`);
}

let perturbRuns = 0;
for (const seed of ROBUSTNESS_SEEDS) {
  const course = createMountainCourse(seed);
  for (let index = 0; index < course.safeInputs.length; index++) {
    for (const offsetMs of [-40, 40]) {
      const game = replay(seed, course, course.safeInputs, { index, offsetMs });
      assertSafeGame(game, seed, `input ${index} shifted ${offsetMs} ms`);
      perturbRuns++;
    }
  }
}

const boneChaseContacts = [];
for (const seed of BONE_CHASE_SEEDS) {
  const course = createMountainCourse(seed);
  const game = replay(seed, course, makeBoneOnlyInputs(course.bones));
  assert.equal(game.collected, 48, `bone-only chase missed a bone for seed ${seed}`);
  assert.ok(game.contactCount >= 12, `bone-only chase was too forgiving for seed ${seed}: ${game.contactCount}`);
  boneChaseContacts.push(game.contactCount);
}

console.log(JSON.stringify({
  seeds: SEED_COUNT,
  nominalSafeGameReplays: SEED_COUNT,
  individualPlusMinus40MsGameReplays: perturbRuns,
  boneOnlyChaseSamples: BONE_CHASE_SEEDS.length,
  boneOnlyChaseContactRange: [Math.min(...boneChaseContacts), Math.max(...boneChaseContacts)],
  safeInputCountRange: [minimumInputCount, maximumInputCount],
}, null, 2));
