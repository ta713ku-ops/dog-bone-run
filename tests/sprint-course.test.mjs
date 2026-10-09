import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, PHASE4 } from '../src/config.js';
import { createPhase2Course } from '../src/phase2-course.js';
import { createSprintCourse } from '../src/sprint-course.js';

function scheduledRouteSegments(bones) {
  const segments = [];
  let lane = 0;
  let cursor = 0;
  const moveSeconds = CONFIG.moveMs / 1000;
  const scheduledLeadSeconds = 0.3;

  for (const bone of bones) {
    if (bone.lane === lane) continue;
    const moveStart = bone.distance - scheduledLeadSeconds;
    const moveEnd = moveStart + moveSeconds;
    assert.ok(moveStart >= cursor - 1e-9, `${bone.id} lane move does not overlap its predecessor`);
    segments.push({ start: cursor, end: moveStart, from: lane, to: lane });
    segments.push({ start: moveStart, end: moveEnd, from: lane, to: bone.lane });
    cursor = moveEnd;
    lane = bone.lane;
  }
  segments.push({ start: cursor, end: PHASE4.durationMs / 1000, from: lane, to: lane });
  return segments;
}

function laneAt(segment, distance) {
  if (segment.end === segment.start) return segment.to;
  const progress = (distance - segment.start) / (segment.end - segment.start);
  return segment.from + (segment.to - segment.from) * progress;
}

function minimumCenterDistance(segment, obstacleLane, start, end) {
  const x0 = laneAt(segment, start);
  const x1 = laneAt(segment, end);
  if (obstacleLane >= Math.min(x0, x1) && obstacleLane <= Math.max(x0, x1)) return 0;
  return Math.min(Math.abs(x0 - obstacleLane), Math.abs(x1 - obstacleLane));
}

function routeClearance(segments, obstacle) {
  const halfLength = CONFIG.dogHalfLength + CONFIG.obstacleHalfLength;
  const contactStart = obstacle.distance - halfLength;
  const contactEnd = obstacle.distance + halfLength;
  let closest = Infinity;
  for (const segment of segments) {
    const start = Math.max(contactStart, segment.start);
    const end = Math.min(contactEnd, segment.end);
    if (start > end) continue;
    closest = Math.min(closest, minimumCenterDistance(segment, obstacle.lane, start, end));
  }
  return closest;
}

function rowsAtDistance(obstacles) {
  const rows = new Map();
  for (const obstacle of obstacles) {
    const key = obstacle.distance.toFixed(3);
    rows.set(key, [...(rows.get(key) ?? []), obstacle]);
  }
  return [...rows.values()];
}

test('the 30-second course uses the phase-4 rule and generates dense, seeded collectible routes', () => {
  const seed = 42;
  const course = createSprintCourse(seed);
  const repeated = createSprintCourse(seed);
  const oldCourse = createPhase2Course(seed);

  assert.equal(PHASE4.durationMs, 30_000);
  assert.equal(PHASE4.ruleVersion, 'sprint30-hard-v1');
  assert.deepEqual(Object.keys(course).sort(), ['bones', 'goldCandidates', 'goldIds', 'obstacles', 'seed']);
  assert.equal(course.seed, seed);
  assert.deepEqual(course, repeated);
  assert.notStrictEqual(course.bones[0], repeated.bones[0]);
  assert.notStrictEqual(course.obstacles[0], repeated.obstacles[0]);
  assert.ok(course.bones.length / 30 > oldCourse.bones.length / 60, 'bones arrive more often than the 60-second course');
  assert.ok(course.obstacles.length / 30 > oldCourse.obstacles.length / 60, 'hazards arrive more often than the 60-second course');

  assert.equal(course.bones[0].distance, 1.6);
  assert.ok(course.bones.at(-1).distance <= 29.5);
  assert.ok(course.bones.every(bone => bone.timeMs === Math.round(bone.distance * 1000)));
  for (let index = 1; index < course.bones.length; index++) {
    const previous = course.bones[index - 1], bone = course.bones[index];
    const stage = [...PHASE4.stages].reverse().find(item => previous.distance * 1000 >= item.fromMs);
    assert.ok(Math.abs(bone.distance - previous.distance - stage.boneGap) < 1e-9,
      `${bone.id} uses the ${stage.boneGap}s gap for its active stage`);
    assert.ok(Math.abs(bone.lane - previous.lane) <= 1, `${bone.id} changes at most one lane`);
  }

  assert.equal(course.goldCandidates.length, 5);
  assert.equal(new Set(course.goldCandidates).size, 5);
  assert.equal(course.goldIds.length, 2);
  assert.equal(new Set(course.goldIds).size, 2);
  assert.ok(course.goldIds.every(id => course.goldCandidates.includes(id)));
  assert.deepEqual(course.bones.filter(bone => bone.kind === 'gold').map(bone => bone.id), course.goldIds);
  assert.ok(course.goldCandidates.every(id => course.bones.some(bone => bone.id === id)));

  const ids = [...course.bones, ...course.obstacles].map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'bone and obstacle ids are globally unique');
  assert.ok(course.obstacles.every(obstacle => obstacle.distance >= 2));
});

test('every seeded obstacle avoids the complete 200ms all-bone route with a clearance margin', () => {
  for (let seed = 0; seed < 100; seed++) {
    const { bones, obstacles } = createSprintCourse(seed);
    const segments = scheduledRouteSegments(bones);
    const lateralHalfWidth = CONFIG.dogHalfWidth + CONFIG.obstacleHalfWidth;
    const longitudinalHalfLength = CONFIG.dogHalfLength + CONFIG.obstacleHalfLength;

    for (const obstacle of obstacles) {
      const clearance = routeClearance(segments, obstacle) - lateralHalfWidth;
      assert.ok(clearance > 0.06, `seed ${seed} ${obstacle.id} has ${clearance} lane clearance`);

      const contactEnd = obstacle.distance + longitudinalHalfLength;
      const nextMove = segments.find(segment => segment.from !== segment.to && segment.start >= obstacle.distance - 1e-9);
      if (nextMove) {
        assert.ok(nextMove.start - contactEnd >= 0.06 - 1e-9,
          `seed ${seed} ${obstacle.id} leaves at least 60ms before the next lane move`);
      }
    }
  }
});

test('hazards grow denser, hole-heavy, and paired without ever blocking all three lanes', () => {
  let earlyHoles = 0, earlyTotal = 0, lateHoles = 0, lateTotal = 0;
  let observedPairs = 0;
  let maxPerRow = 0;

  for (let seed = 0; seed < 80; seed++) {
    const { bones, obstacles } = createSprintCourse(seed);
    const rows = rowsAtDistance(obstacles);
    observedPairs += rows.filter(row => row.length === 2).length;
    maxPerRow = Math.max(maxPerRow, ...rows.map(row => row.length));
    for (const row of rows) {
      assert.ok(row.length <= 2, `seed ${seed} never blocks three lanes at one time`);
      assert.equal(new Set(row.map(item => item.lane)).size, row.length);
      const routeBone = bones.find(bone => Math.abs(bone.distance - row[0].distance) < 1e-9);
      assert.ok(routeBone, 'hazard rows align with a collectible bone distance');
      assert.ok(row.every(item => item.lane !== routeBone.lane), 'hazards occupy lanes outside the all-bone route');
      if (row[0].distance < 15) {
        earlyTotal += row.length;
        earlyHoles += row.filter(item => item.type === 'hole').length;
      } else {
        lateTotal += row.length;
        lateHoles += row.filter(item => item.type === 'hole').length;
      }
    }
  }

  assert.ok(observedPairs > 0, 'seeded runs include two-lane hazard rows');
  assert.equal(maxPerRow, 2);
  assert.ok(lateHoles / lateTotal > earlyHoles / earlyTotal,
    `late hole rate ${lateHoles}/${lateTotal} exceeds early rate ${earlyHoles}/${earlyTotal}`);
});

test('seed normalization and returned arrays/objects are isolated across runs', () => {
  const negative = createSprintCourse(-1);
  const unsigned = createSprintCourse(0xffff_ffff);
  assert.equal(negative.seed, 0xffff_ffff);
  assert.deepEqual(negative, unsigned);
  assert.deepEqual(createSprintCourse(42), createSprintCourse(42));
  assert.notDeepEqual(createSprintCourse(42).bones.map(bone => bone.lane), createSprintCourse(43).bones.map(bone => bone.lane));

  negative.bones[0].lane = 99;
  negative.obstacles[0].lane = 99;
  negative.goldCandidates[0] = 'mutated';
  negative.goldIds.splice(0);
  const fresh = createSprintCourse(-1);
  assert.equal(fresh.bones[0].lane, 0);
  assert.notEqual(fresh.obstacles[0].lane, 99);
  assert.notEqual(fresh.goldCandidates[0], 'mutated');
  assert.equal(fresh.goldIds.length, 2);
});
