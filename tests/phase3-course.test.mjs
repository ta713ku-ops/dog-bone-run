import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, PHASE2 } from '../src/config.js';
import { createCourse } from '../src/course.js';
import { createPhase2Course } from '../src/phase2-course.js';
import { createPhase3Course } from '../src/phase3-course.js';

const EXPECTED_HOLES = [
  { id: 'hole-001', type: 'hole', lane: 1, distance: 20.0 },
  { id: 'hole-002', type: 'hole', lane: -1, distance: 28.8 },
  { id: 'hole-003', type: 'hole', lane: 0, distance: 37.0 },
  { id: 'hole-004', type: 'hole', lane: -1, distance: 44.8 },
  { id: 'hole-005', type: 'hole', lane: -1, distance: 51.8 },
];

test('Phase 3 preserves the Phase 2 course, seed, and gold selection while adding five fixed holes', () => {
  const seed = 0x1234;
  const phase2 = createPhase2Course(seed);
  const phase3 = createPhase3Course(seed);

  assert.deepEqual(Object.keys(phase3).sort(), ['bones', 'goldCandidates', 'goldIds', 'obstacles', 'seed']);
  assert.equal(phase3.seed, phase2.seed);
  assert.equal(phase3.bones.length, 65);
  assert.deepEqual(phase3.bones, phase2.bones);
  assert.deepEqual(phase3.bones.map(({ id, lane, timeMs, distance }) => ({ id, lane, timeMs, distance })), createCourse());
  assert.deepEqual(phase3.goldCandidates, phase2.goldCandidates);
  assert.deepEqual(phase3.goldIds, phase2.goldIds);
  assert.deepEqual(phase3.obstacles.filter(({ type }) => type !== 'hole'), phase2.obstacles);
  assert.deepEqual(phase3.obstacles.filter(({ type }) => type === 'hole'), EXPECTED_HOLES);

  const negativeSeed = createPhase3Course(-1);
  assert.equal(negativeSeed.seed, 0xffff_ffff);
  assert.deepEqual(negativeSeed, createPhase3Course(0xffff_ffff));
  assert.deepEqual(createPhase3Course(seed), phase3);
  assert.deepEqual(createPhase3Course(99).obstacles.filter(({ type }) => type === 'hole'), EXPECTED_HOLES);

  phase3.obstacles.find(({ type }) => type === 'hole').lane = 99;
  assert.deepEqual(createPhase3Course(seed).obstacles.filter(({ type }) => type === 'hole'), EXPECTED_HOLES);
  assert.deepEqual(createPhase2Course(seed).obstacles, phase2.obstacles);
});

function scheduledRouteSegments(bones) {
  const segments = [];
  let lane = 0;
  let cursor = 0;
  const moveSeconds = CONFIG.moveMs / 1000;
  const arrivalBufferSeconds = 0.1;

  for (const bone of bones) {
    if (bone.lane === lane) continue;
    const moveEnd = bone.distance - arrivalBufferSeconds;
    const moveStart = moveEnd - moveSeconds;
    segments.push({ start: cursor, end: moveStart, from: lane, to: lane });
    segments.push({ start: moveStart, end: moveEnd, from: lane, to: bone.lane });
    cursor = moveEnd;
    lane = bone.lane;
  }

  segments.push({ start: cursor, end: PHASE2.goalDistance, from: lane, to: lane });
  return segments;
}

function laneAt(segment, distance) {
  if (segment.end === segment.start) return segment.to;
  const progress = (distance - segment.start) / (segment.end - segment.start);
  return segment.from + (segment.to - segment.from) * progress;
}

function minimumLateralGap(segment, obstacleLane, start, end) {
  const x0 = laneAt(segment, start);
  const x1 = laneAt(segment, end);
  if (obstacleLane >= Math.min(x0, x1) && obstacleLane <= Math.max(x0, x1)) return 0;
  return Math.min(Math.abs(x0 - obstacleLane), Math.abs(x1 - obstacleLane));
}

function routeClearanceForObstacle(segments, obstacle) {
  const halfLength = CONFIG.dogHalfLength + CONFIG.obstacleHalfLength;
  const contactStart = obstacle.distance - halfLength;
  const contactEnd = obstacle.distance + halfLength;
  let closestGap = Infinity;

  for (const segment of segments) {
    const start = Math.max(contactStart, segment.start);
    const end = Math.min(contactEnd, segment.end);
    if (start > end) continue;
    closestGap = Math.min(closestGap, minimumLateralGap(segment, obstacle.lane, start, end));
  }
  return closestGap;
}

test('the continuous 65-bone route clears every Phase 2 hazard and Phase 3 hole', () => {
  const { bones, obstacles } = createPhase3Course(42);
  const segments = scheduledRouteSegments(bones);
  const lateralCollisionHalfWidth = CONFIG.dogHalfWidth + CONFIG.obstacleHalfWidth;

  assert.equal(bones.length, 65);
  assert.equal(obstacles.filter(({ type }) => type === 'hole').length, 5);
  assert.equal(obstacles.length, 13);
  assert.ok(obstacles.every(({ type }) => ['puddle', 'trash', 'hole'].includes(type)));

  for (const obstacle of obstacles) {
    const closestGap = routeClearanceForObstacle(segments, obstacle);
    assert.ok(
      closestGap > lateralCollisionHalfWidth,
      `${obstacle.id} route clearance ${closestGap} must exceed ${lateralCollisionHalfWidth}`,
    );
  }
});

test('holes stay clear of gold and hazards, with a gentle opening and tighter late cadence', () => {
  const { bones, obstacles, goldCandidates } = createPhase3Course(9);
  const holes = obstacles.filter(({ type }) => type === 'hole');
  const goldDistances = goldCandidates.map(id => bones.find(bone => bone.id === id).distance);
  const existingHazards = obstacles.filter(({ type }) => type !== 'hole');
  const typePreviewSeconds = 0.9;
  const reactionSeconds = 0.3;
  const swipeDecisionSeconds = 0.15;
  const moveSeconds = CONFIG.moveMs / 1000;
  const typePreviewAndActionSeconds = typePreviewSeconds + reactionSeconds + swipeDecisionSeconds + moveSeconds;
  const collisionHalfLength = CONFIG.dogHalfLength + CONFIG.obstacleHalfLength;

  assert.deepEqual(holes, EXPECTED_HOLES);
  assert.ok(holes[0].distance >= 20, 'the opening stays gentle before the first hole');
  assert.ok(CONFIG.lookAhead >= typePreviewAndActionSeconds,
    'normal-speed lookAhead covers type preview, reaction, swipe, and move time');

  const holeGaps = holes.slice(1).map((hole, index) => hole.distance - holes[index].distance);
  assert.ok(holeGaps.every((gap, index) => index === 0 || gap < holeGaps[index - 1]),
    'fixed holes become closer together toward the finish');

  for (const hole of holes) {
    const nearestGold = Math.min(...goldDistances.map(distance => Math.abs(distance - hole.distance)));
    assert.ok(nearestGold >= 1.2 - 1e-9, `${hole.id} is at least 1.2 distance from every gold candidate`);

    const nearestExistingHazard = Math.min(...existingHazards.map(item => Math.abs(item.distance - hole.distance)));
    assert.ok(nearestExistingHazard >= 2.4 - 1e-9,
      `${hole.id} leaves room before and after each inherited hazard`);
  }

  const ordered = [...obstacles].sort((a, b) => a.distance - b.distance);
  for (let index = 1; index < ordered.length; index++) {
    const gap = ordered[index].distance - ordered[index - 1].distance;
    const clearToContactSeconds = gap - 2 * collisionHalfLength;
    assert.ok(clearToContactSeconds >= typePreviewAndActionSeconds,
      `${ordered[index - 1].id} to ${ordered[index].id} leaves ${clearToContactSeconds}s between collision windows`);
  }
});
