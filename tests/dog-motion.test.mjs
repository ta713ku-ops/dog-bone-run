import test from 'node:test';
import assert from 'node:assert/strict';
import { getDogMotion } from '../src/dog-motion.js';

const ACTIONS = new Set(['idle', 'blink', 'lookLeft', 'lookRight', 'paw', 'bow', 'finish']);
const NUMERIC_FIELDS = ['poseTimeMs', 'poseWeight', 'scaleX', 'scaleY', 'rotation', 'lift', 'shadowScale'];
const BLEND_FIELDS = ['poseWeight', 'scaleX', 'scaleY', 'rotation', 'lift', 'shadowScale'];

function assertValidMotion(motion) {
  assert.ok(ACTIONS.has(motion.action), `unexpected action: ${motion.action}`);
  for (const key of NUMERIC_FIELDS) assert.ok(Number.isFinite(motion[key]), `${key} must be finite`);
  assert.ok(motion.poseTimeMs >= 0);
  assert.ok(motion.poseWeight >= 0 && motion.poseWeight <= 1);
  assert.ok(motion.scaleX >= 0.99 && motion.scaleX <= 1.01);
  assert.ok(motion.scaleY >= 0.985 && motion.scaleY <= 1.02);
  assert.ok(Math.abs(motion.rotation) <= 0.03);
  assert.ok(motion.lift >= 0 && motion.lift <= 3);
  assert.ok(motion.shadowScale >= 0.94 && motion.shadowScale <= 1.02);
  assert.ok(motion.accent === null || motion.accent === 'tap' || motion.accent === 'celebrate');
}

function assertContinuousAcross(boundary, { reactionMs = null } = {}) {
  const before = getDogMotion(boundary - 0.001, { reactionMs });
  const at = getDogMotion(boundary, { reactionMs });
  for (const key of BLEND_FIELDS) {
    assert.ok(Math.abs(at[key] - before[key]) < 0.000001, `${key} jumps at ${boundary}ms`);
  }
}

function assertContinuousAcrossReaction(boundary, timeMs = 12_000) {
  const before = getDogMotion(timeMs, { reactionMs: boundary - 0.001 });
  const at = getDogMotion(timeMs, { reactionMs: boundary });
  for (const key of BLEND_FIELDS) {
    assert.ok(Math.abs(at[key] - before[key]) < 0.000001, `${key} jumps at reaction ${boundary}ms`);
  }
}

test('the dog holds idle posture for over six seconds before a quick 200ms blink', () => {
  for (const timeMs of [0, 3_000, 6_000, 6_399.999]) {
    const pose = getDogMotion(timeMs);
    assert.equal(pose.action, 'idle');
    assert.equal(pose.poseWeight, 0);
    assert.equal(pose.lift, 0, 'idle paws stay on the ground');
  }
  assert.equal(getDogMotion(6_400).action, 'blink');
  assert.equal(getDogMotion(6_400).poseTimeMs, 0);
  assert.equal(getDogMotion(6_470).poseWeight, 1);
  assert.equal(getDogMotion(6_530).poseWeight, 1);
  assert.equal(getDogMotion(6_600).action, 'idle');
  assert.equal(getDogMotion(6_600).poseWeight, 0);
  assert.equal(getDogMotion(11_399.999).action, 'idle');
});

test('the 36s cycle holds natural gestures for their full dwell and alternates the look direction', () => {
  const lookLeft = getDogMotion(12_700);
  const lookRight = getDogMotion(36_000 + 12_700);
  const bow = getDogMotion(26_600);
  const paw = getDogMotion(33_800);
  assert.equal(lookLeft.action, 'lookLeft');
  assert.equal(lookRight.action, 'lookRight');
  assert.equal(lookLeft.poseTimeMs, 1_300);
  assert.equal(lookLeft.poseWeight, 1);
  assert.equal(getDogMotion(14_000).action, 'idle');
  assert.equal(bow.action, 'bow');
  assert.equal(bow.poseTimeMs, 1_200);
  assert.equal(bow.poseWeight, 1);
  assert.equal(getDogMotion(27_800).action, 'idle');
  assert.equal(paw.action, 'paw');
  assert.equal(paw.poseTimeMs, 1_200);
  assert.equal(paw.poseWeight, 1);
  assert.equal(getDogMotion(35_000).action, 'idle');

  for (const timeMs of [6_600, 11_399, 14_000, 18_999, 19_200, 25_399, 27_800, 32_599, 35_000, 35_999]) {
    assert.equal(getDogMotion(timeMs).action, 'idle', `expected an idle dwell at ${timeMs}ms`);
  }
});

test('look, bow, paw, and blink pose weights blend smoothly at both ends', () => {
  const gestures = [
    { start: 6_400, end: 6_600, blend: 70 },
    { start: 11_400, end: 14_000, blend: 350 },
    { start: 19_000, end: 19_200, blend: 70 },
    { start: 25_400, end: 27_800, blend: 450 },
    { start: 32_600, end: 35_000, blend: 450 },
  ];
  for (const { start, end, blend } of gestures) {
    assert.equal(getDogMotion(start).poseWeight, 0);
    assert.equal(getDogMotion(start + blend).poseWeight, 1);
    assert.equal(getDogMotion(end - blend).poseWeight, 1);
    assert.equal(getDogMotion(end).poseWeight, 0);
    assertContinuousAcross(start);
    assertContinuousAcross(end);
  }
});

test('breathing repeats every 4.8s while body transforms and paw anchoring stay small', () => {
  for (const timeMs of [0, 6_000, 11_400, 25_400, 33_800, 36_000, 71_999]) {
    const motion = getDogMotion(timeMs);
    assertValidMotion(motion);
    assert.equal(motion.lift, 0, 'idle paws remain anchored');
    assert.deepEqual(
      [getDogMotion(timeMs).scaleX, getDogMotion(timeMs).scaleY],
      [getDogMotion(timeMs + 4_800).scaleX, getDogMotion(timeMs + 4_800).scaleY],
    );
  }
  assert.notEqual(getDogMotion(1_200).scaleY, getDogMotion(3_600).scaleY);
});

test('tap reaction has a 1.5s paw dwell, a 3px maximum hop, and an 1.8s accent', () => {
  const start = getDogMotion(20_000, { reactionMs: 0 });
  const entrance = getDogMotion(20_000, { reactionMs: 350 });
  const peak = getDogMotion(20_000, { reactionMs: 400 });
  const landed = getDogMotion(20_000, { reactionMs: 900 });
  const pawEnds = getDogMotion(20_000, { reactionMs: 1_500 });
  const accentEnds = getDogMotion(20_000, { reactionMs: 1_799 });
  const ended = getDogMotion(20_000, { reactionMs: 1_800 });
  assert.equal(start.action, 'paw');
  assert.equal(start.poseWeight, 0);
  assert.equal(entrance.poseWeight, 1);
  assert.equal(peak.lift, 3);
  assert.equal(peak.action, 'paw');
  assert.equal(landed.lift, 0);
  assert.equal(landed.accent, 'tap');
  assert.equal(pawEnds.action, 'idle');
  assert.equal(pawEnds.poseWeight, 0);
  assert.equal(pawEnds.accent, 'tap');
  assert.equal(accentEnds.accent, 'tap');
  assert.equal(ended.action, 'idle');
  assert.equal(ended.poseWeight, 0);
  assert.equal(ended.accent, null);
  assert.equal(ended.lift, 0);
  assertContinuousAcrossReaction(0, 0);
  for (const boundary of [400, 900, 1_500, 1_800, 2_150]) assertContinuousAcrossReaction(boundary);
});

test('a tap fades back into an in-progress idle-cycle gesture without a pose jump', () => {
  const duringTap = getDogMotion(12_000, { reactionMs: 1_799 });
  const recoveryStart = getDogMotion(12_000, { reactionMs: 1_800 });
  const recoveryMiddle = getDogMotion(12_000, { reactionMs: 1_975 });
  const recoveryEnd = getDogMotion(12_000, { reactionMs: 2_150 });
  assert.equal(duringTap.action, 'idle');
  assert.equal(duringTap.poseWeight, 0);
  assert.equal(recoveryStart.action, 'lookLeft');
  assert.equal(recoveryStart.poseWeight, 0);
  assert.equal(recoveryMiddle.poseWeight, 0.5);
  assert.equal(recoveryEnd.poseWeight, getDogMotion(12_000).poseWeight);
  assert.equal(recoveryStart.accent, null);
});

test('all timeline transforms and weights stay finite, bounded, and deterministic', () => {
  const reactionTimes = [0, 1, 70, 200, 350, 400, 900, 1_150, 1_499, 1_500, 1_799, 1_800, 1_975, 2_149, 2_150, 2_600];
  for (let timeMs = 0; timeMs <= 72_000; timeMs += 257) {
    const motion = getDogMotion(timeMs);
    assert.deepEqual(getDogMotion(timeMs), motion);
    assertValidMotion(motion);
    assertValidMotion(getDogMotion(timeMs, { celebrate: true }));
    for (const reactionMs of reactionTimes) assertValidMotion(getDogMotion(timeMs, { reactionMs }));
  }
  for (const boundary of [
    6_400, 6_600, 11_400, 14_000, 19_000, 19_200,
    25_400, 27_800, 32_600, 35_000, 36_000, 72_000,
  ]) assertContinuousAcross(boundary);
});

test('reduced motion preserves a small breath and blink while removing large gestures and tap motion', () => {
  const expected = {
    action: 'idle', poseTimeMs: 0, poseWeight: 0, scaleX: 1, scaleY: 1,
    rotation: 0, lift: 0, shadowScale: 1, accent: null,
  };
  assert.deepEqual(getDogMotion(0, { reducedMotion: true }), expected);
  assert.deepEqual(getDogMotion(-20, { reducedMotion: true }), expected);
  assert.equal(getDogMotion(1_200, { reducedMotion: true }).scaleY, 1.003);
  assert.equal(getDogMotion(6_400, { reducedMotion: true }).action, 'blink');
  assert.equal(getDogMotion(6_470, { reducedMotion: true }).poseWeight, 1);
  assert.equal(getDogMotion(6_600, { reducedMotion: true }).action, 'idle');

  for (const timeMs of [11_900, 12_700, 26_600, 33_800, 81_000]) {
    const motion = getDogMotion(timeMs, { reducedMotion: true, reactionMs: 100 });
    assert.ok(['idle', 'blink'].includes(motion.action));
    assert.equal(motion.lift, 0);
    assert.equal(motion.rotation, 0);
    assert.equal(motion.accent, null);
    assertValidMotion(motion);
  }
  const celebration = getDogMotion(81_000, { reducedMotion: true, celebrate: true });
  assert.equal(celebration.action, 'finish');
  assert.equal(celebration.lift, 0);
  assertValidMotion(celebration);
});

test('pause freezes the dog pose even if wall or animation time continues', () => {
  const paused = { action: 'idle', poseTimeMs: 0, poseWeight: 0, scaleX: 1, scaleY: 1,
    rotation: 0, lift: 0, shadowScale: 1, accent: null };
  for (const timeMs of [0, 6_470, 12_700, 81_000]) {
    assert.deepEqual(getDogMotion(timeMs, { paused: true, reactionMs: 600, celebrate: true }), paused);
    assert.deepEqual(getDogMotion(timeMs, { paused: true, reducedMotion: true }), paused);
  }
});

test('celebration selects the full-weight finish pose and takes precedence over a tap', () => {
  const motion = getDogMotion(12_345, { celebrate: true, reactionMs: 120 });
  assert.equal(motion.action, 'finish');
  assert.equal(motion.poseTimeMs, 12_345);
  assert.equal(motion.poseWeight, 1);
  assert.equal(motion.accent, 'celebrate');
  assert.equal(motion.lift, 0);
  assert.equal(motion.scaleX, getDogMotion(12_345).scaleX);
  assert.equal(motion.scaleY, getDogMotion(12_345).scaleY);
  assertValidMotion(motion);
});
