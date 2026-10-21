import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_ATTENTION_MS, HOME_DIRECTION_GESTURE_MS, sampleHomeAttention, sampleHomeIdleGesture } from '../src/home-presence.js';
import { createHomeCommand, sampleHomeCommand } from '../src/home-command-motion.js';
import { Renderer } from '../src/render.js';
import { sampleHome } from '../src/sprite-animation.js';

const frameCounts = { sitdown: 48, liedown: 48, greet: 32, tiltleft: 32, tiltright: 32 };
const faceBase = { headYaw: 0, gazeX: 0, headAngle: 0, headLift: 0, earLeft: 0, earRight: 0 };

function direction(base, action, age, durationMs = HOME_DIRECTION_GESTURE_MS) {
  return sampleHomeIdleGesture(base, action, age, false, { durationMs });
}

function rendererAt(time, gesture, heldFrame = null) {
  return Object.assign(Object.create(Renderer.prototype), {
    dogs: { stats: { animationReady: true, continuityReady: true, homeMotionReady: true, homeFrameCounts: frameCounts } },
    lastDrawState: 'ready', menuElapsedMs: time, menuLastFrameNow: null, homeClockOffset: 0,
    homeInteraction: null, homeAttention: null, homeStillPose: null, homeHeldFrame: heldFrame,
    homeSample: null, reducedMotion: false, systemReducedMotion: false, userReducedMotion: false,
    homeAutonomy: { reset() {}, next() { return null; }, settle() {} }, homeAutonomyReady: true,
    homeAutoCommand: null, homeAutoGesture: gesture, homePosture: 'stand',
    homeLocalRelease: null, homeIdleRest: { headRest: 0, eyeRest: 0 }, homeFrozenLocal: null,
    canvas: { closest: () => ({ dataset: {} }) },
  });
}

test('look gestures cue the eyes and ears first, turn into a readable signed yaw, then return smoothly', () => {
  for (const [action, sign] of [['look-left', -1], ['look-right', 1]]) {
    assert.equal(direction(faceBase, action, 0), faceBase, 'the initial sample is the exact base pose');
    const cue = direction(faceBase, action, 100);
    assert.equal(cue.headYaw, 0, 'the early cue precedes the face turn');
    assert.equal(Math.sign(cue.gazeX), sign);
    assert.ok(cue.earLeft > 0 && cue.earRight > 0);

    const turned = direction(faceBase, action, 1_500);
    assert.ok(Math.abs(turned.headYaw - sign * .86) < 1e-12, 'the peak uses the authored oblique endpoint');
    assert.ok(Math.abs(turned.headAngle) <= .015, 'roll remains a subtle secondary cue');
    const returning = direction(faceBase, action, 2_640);
    assert.ok(Math.abs(returning.headYaw) < Math.abs(turned.headYaw));
    const atEndOfTurn = direction(faceBase, action, 3_320);
    assert.equal(atEndOfTurn.headYaw, 0);
    assert.equal(direction(faceBase, action, HOME_DIRECTION_GESTURE_MS), faceBase);

    let previous = faceBase.headYaw;
    for (let age = 10; age <= 3_320; age += 10) {
      const current = direction(faceBase, action, age).headYaw;
      assert.ok(Math.abs(current - previous) <= .017, `${action} has a gradual yaw step at ${age}ms`);
      previous = current;
    }
  }
});

test('attention recenters a paused direction and returns to the exact base angle', () => {
  const paused = { ...faceBase, headYaw: -.86 };
  assert.equal(sampleHomeAttention(paused, 0), paused);
  assert.equal(sampleHomeAttention(paused, HOME_ATTENTION_MS), paused);
  assert.ok(Math.abs(sampleHomeAttention(paused, 700).headYaw) < .02);
  assert.ok(sampleHomeAttention(paused, 2_000).headYaw < -.1, 'the paused glance returns during the call exit');

  let previous = paused.headYaw;
  for (let age = 1; age <= HOME_ATTENTION_MS; age += 1) {
    const current = sampleHomeAttention(paused, age).headYaw;
    assert.ok(Math.abs(current - previous) < .004, `attention yaw is continuous at ${age}ms`);
    previous = current;
  }
});

test('manual commands preserve the current yaw at handoff and return it over about 700ms', () => {
  const seated = {
    atlas: 'sitdown', index: 47, nextIndex: 47, mix: 0,
    layers: [{ atlas: 'sitdown', index: 47, weight: 1 }], headYaw: -.84,
  };
  const command = createHomeCommand('sit', 2_000, seated, frameCounts);
  assert.equal(command.durationMs, 700, 'a same-posture command keeps running long enough to hand off yaw');
  const first = sampleHomeCommand(2_000, command, { frameCounts });
  assert.equal(first.headYaw, seated.headYaw, 'the first manual sample exactly matches the interrupted angle');
  assert.ok(sampleHomeCommand(2_350, command, { frameCounts }).headYaw < 0);
  assert.equal(sampleHomeCommand(2_700, command, { frameCounts }).headYaw, 0);
  assert.equal(sampleHomeCommand(2_800, command, { frameCounts }).headYaw, 0);

  const noYawCommand = createHomeCommand('sit', 2_000, { ...seated, headYaw: 0 }, frameCounts);
  assert.equal(noYawCommand.durationMs, 0, 'the existing zero-yaw, same-pose duration contract remains intact');
});

test('reduced motion freezes a turned angle and resumes the same gesture phase', () => {
  const gesture = { action: 'look-left', startedAt: 0, durationMs: HOME_DIRECTION_GESTURE_MS, rest: { headRest: 0, eyeRest: 0 } };
  const r = rendererAt(1_500, gesture);
  const turned = r.updateHomeSample(1_500);
  assert.equal(turned.headYaw, -.86);

  r.setReducedMotion(true);
  const frozen = r.updateHomeSample(2_100);
  assert.equal(frozen.headYaw, turned.headYaw);
  assert.equal(r.homeFrozenLocal.headYaw, turned.headYaw);

  r.menuElapsedMs = 2_300;
  r.setReducedMotion(false);
  assert.equal(r.homeLocalRelease.source.headYaw, turned.headYaw);
  assert.equal(Object.hasOwn(r.homeHeldFrame, 'headYaw'), false, 'resume releases the saved local angle back to the active gesture');
  const resumed = r.updateHomeSample(2_300);
  assert.equal(resumed.headYaw, turned.headYaw, 'resuming starts at the same visible angle');
  const afterResume = r.updateHomeSample(2_500);
  assert.ok(afterResume.headYaw < 0, 'the gesture continues instead of snapping to the front');
});
