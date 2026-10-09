import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';
import { createPhase2Course } from '../src/phase2-course.js';

test('Phase 2 keeps the existing 65-bone, 60-second route and assigns two seeded gold bones', () => {
  const base = createCourse();
  const first = createPhase2Course(0x1234);
  const repeat = createPhase2Course(0x1234);

  assert.equal(first.bones.length, 65);
  assert.deepEqual(first.bones.map(({ id, lane, timeMs, distance }) => ({ id, lane, timeMs, distance })), base);
  assert.equal(first.bones.at(-1).distance, 59.6);
  assert.equal(first.seed, 0x1234);
  assert.deepEqual(first, repeat);

  assert.deepEqual(first.goldCandidates, ['bone-006', 'bone-019', 'bone-033', 'bone-046', 'bone-059']);
  assert.equal(new Set(first.goldCandidates).size, 5);
  assert.equal(new Set(first.goldIds).size, 2);
  assert.ok(first.goldIds.every(id => first.goldCandidates.includes(id)));
  assert.deepEqual(first.bones.filter(bone => bone.kind === 'gold').map(bone => bone.id), first.goldIds);
  assert.equal(first.bones.filter(bone => bone.kind === 'normal').length, 63);
  assert.deepEqual(base, createCourse(), 'Phase 2 generation does not mutate the Phase 1 course');
});

test('gold candidates are spread across the course and never share an obstacle distance window', () => {
  const { bones, obstacles, goldCandidates } = createPhase2Course(9);
  const candidateBones = goldCandidates.map(id => bones.find(bone => bone.id === id));

  assert.equal(candidateBones.length, 5);
  for (let index = 1; index < candidateBones.length; index++) {
    assert.ok(candidateBones[index].distance - candidateBones[index - 1].distance >= 11);
  }

  for (const candidate of candidateBones) {
    for (const obstacle of obstacles) {
      assert.ok(
        Math.abs(candidate.distance - obstacle.distance) >= 1.2 - 1e-9,
        `${candidate.id} is too close longitudinally to ${obstacle.id}`,
      );
    }
  }
});

function scheduledRouteSegments(bones) {
  const segments = [];
  let lane = 0;
  let cursor = 0;

  for (const bone of bones) {
    if (bone.lane === lane) continue;
    const moveStart = bone.distance - 0.3;
    const moveEnd = bone.distance - 0.1;
    segments.push({ start: cursor, end: moveStart, from: lane, to: lane });
    segments.push({ start: moveStart, end: moveEnd, from: lane, to: bone.lane });
    cursor = moveEnd;
    lane = bone.lane;
  }

  segments.push({ start: cursor, end: 60, from: lane, to: lane });
  return segments;
}

function routeLaneAt(segment, distance) {
  if (segment.end === segment.start) return segment.to;
  const progress = (distance - segment.start) / (segment.end - segment.start);
  return segment.from + (segment.to - segment.from) * progress;
}

function minimumLateralGap(segment, obstacleLane, start, end) {
  const x0 = routeLaneAt(segment, start);
  const x1 = routeLaneAt(segment, end);
  if (obstacleLane >= Math.min(x0, x1) && obstacleLane <= Math.max(x0, x1)) return 0;
  return Math.min(Math.abs(x0 - obstacleLane), Math.abs(x1 - obstacleLane));
}

test('all obstacles avoid the continuous scheduled route through their full longitudinal collision window', () => {
  const { bones, obstacles } = createPhase2Course(42);
  const segments = scheduledRouteSegments(bones);

  assert.equal(obstacles.length, 8);
  assert.ok(obstacles.every(({ type }) => type === 'puddle' || type === 'trash'));
  for (let index = 1; index < obstacles.length; index++) {
    assert.ok(obstacles[index].distance - obstacles[index - 1].distance >= 5);
  }

  for (const obstacle of obstacles) {
    const contactStart = obstacle.distance - 0.16;
    const contactEnd = obstacle.distance + 0.16;
    let closestGap = Infinity;
    for (const segment of segments) {
      const start = Math.max(contactStart, segment.start);
      const end = Math.min(contactEnd, segment.end);
      if (start > end) continue;
      closestGap = Math.min(closestGap, minimumLateralGap(segment, obstacle.lane, start, end));
    }

    // Dog .22 + obstacle .28 = .50. A strict margin means no edge contact.
    assert.ok(closestGap > 0.5, `${obstacle.id} has route clearance ${closestGap}`);
  }
});

test('all seeded outputs normalize to a uint32 and expose defensive copies of fixed obstacles', () => {
  const course = createPhase2Course(-1);
  const again = createPhase2Course(0xffff_ffff);

  assert.equal(course.seed, 0xffff_ffff);
  assert.deepEqual(course, again);
  course.obstacles[0].lane = -99;
  assert.equal(createPhase2Course(-1).obstacles[0].lane, 1);
});
