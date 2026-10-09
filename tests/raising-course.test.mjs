import test from 'node:test';
import assert from 'node:assert/strict';
import { createSprintCourse } from '../src/sprint-course.js';
import { createRaisingCourse } from '../src/raising-course.js';

test('raising courses are deterministic, retain the sprint shape, and do not mutate the existing course', () => {
  const before = createSprintCourse(42);
  const first = createRaisingCourse(42, 3);
  const again = createRaisingCourse(42, 3);
  assert.deepEqual(Object.keys(first).sort(), ['bones', 'goldCandidates', 'goldIds', 'obstacles', 'seed']);
  assert.deepEqual(first, again);
  assert.deepEqual(first.bones, before.bones);
  assert.deepEqual(first.goldIds, before.goldIds);
  assert.deepEqual(createSprintCourse(42), before);
});

test('difficulty one reduces hazards and difficulty five increases them across a 100-seed sample', () => {
  let easyHazards = 0;
  let standardHazards = 0;
  let hardHazards = 0;
  for (let seed = 0; seed < 100; seed++) {
    easyHazards += createRaisingCourse(seed, 1).obstacles.length;
    standardHazards += createRaisingCourse(seed, 3).obstacles.length;
    hardHazards += createRaisingCourse(seed, 5).obstacles.length;
  }
  assert.ok(easyHazards < standardHazards, `${easyHazards} should be below ${standardHazards}`);
  assert.ok(hardHazards > standardHazards, `${hardHazards} should exceed ${standardHazards}`);
});

test('a course never blocks the bone lane or all three lanes at one distance', () => {
  for (let difficulty = 1; difficulty <= 5; difficulty++) {
    for (let seed = 0; seed < 100; seed++) {
      const { bones, obstacles } = createRaisingCourse(seed, difficulty);
      const boneAt = new Map(bones.map(bone => [bone.distance, bone]));
      const lanesAtDistance = new Map();
      for (const obstacle of obstacles) {
        const bone = boneAt.get(obstacle.distance);
        assert.ok(bone, 'each generated obstacle is paired with a collectible beat');
        assert.notEqual(obstacle.lane, bone.lane, 'the course leaves its collectible lane open');
        if (!lanesAtDistance.has(obstacle.distance)) lanesAtDistance.set(obstacle.distance, new Set());
        lanesAtDistance.get(obstacle.distance).add(obstacle.lane);
      }
      for (const lanes of lanesAtDistance.values()) assert.ok(lanes.size <= 2);
      const ids = [...bones, ...obstacles].map(item => item.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  }
});

test('difficulty input is explicit and bounded to the five configured stars', () => {
  for (const difficulty of [0, 6, 1.5, '3']) assert.throws(() => createRaisingCourse(7, difficulty), RangeError);
  assert.equal(createRaisingCourse(-1, 1).seed, 0xffff_ffff);
});
