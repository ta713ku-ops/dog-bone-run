import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOG_3D_ACTIONS, DOG_3D_STAND_ROOT_HEIGHT,
  buildDog3DModel,
} from '../src/dog-3d-model.js';
import { DOG_3D_RIG_DIAGNOSTICS, dog3DPointOnScreen, sampleDog3DPose } from '../src/dog-3d-rig.js';

const close = (actual, expected, tolerance = .001) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${actual} should be within ${tolerance} of ${expected}`,
);

function footAt(action, groundDistance, yaw, velocity) {
  return sampleDog3DPose({
    action, groundDistance, yaw, velocity, timeMs: 870, actionAgeMs: 870,
  }).contactFeet.frontLeft.world;
}

test('all specified dog actions produce finite articulated matrices, landmarks, and foot diagnostics', () => {
  const expected = new Set([
    'idle', 'walk', 'run', 'rest', 'sleep', 'feed', 'sniff', 'lick', 'tug',
    'cuddle', 'carry', 'fall', 'finish',
  ]);
  for (const action of expected) assert.ok(DOG_3D_ACTIONS.includes(action), `${action} is supported`);
  for (const action of DOG_3D_ACTIONS) {
    const pose = sampleDog3DPose({
      action, timeMs: 2_137, actionAgeMs: 1_643, durationMs: 4_000,
      groundDistance: .23, velocity: .82, view: 'side', reducedMotion: action === 'sleep',
    });
    assert.equal(pose.action, action);
    assert.equal(pose.progress, 1_643 / 4_000, 'timed action progress uses actionAgeMs');
    assert.equal(pose.jointMatrices.length, 24);
    assert.ok(pose.jointMatrices.every(matrix => matrix.length === 16 && [...matrix].every(Number.isFinite)), `${action} matrices are finite`);
    for (const point of Object.values(pose.landmarks)) {
      assert.ok([point.x, point.y, point.z].every(Number.isFinite), `${action} landmark is finite`);
    }
    assert.deepEqual(Object.keys(pose.contactFeet).sort(), [...DOG_3D_RIG_DIAGNOSTICS.contactFeet].sort());
    for (const foot of Object.values(pose.contactFeet)) {
      assert.ok([foot.world.x, foot.world.y, foot.world.z, foot.local.x, foot.local.y, foot.local.z].every(Number.isFinite));
      if (foot.contact) close(foot.world.y, 0, .003);
    }
  }
});

test('stance soles stay at one world point through variable speed and all dog facings', () => {
  const model = buildDog3DModel();
  close(model.groundPlaneY, 0, .00001);
  for (const [action, stride, endOfStance] of [
    ['walk', .52, .64],
    ['run', .76, .52],
  ]) {
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      const samples = [
        footAt(action, .01, yaw, .25),
        footAt(action, stride * endOfStance * .25, yaw, .48),
        footAt(action, stride * endOfStance * .62, yaw, .91),
      ];
      assert.ok(samples.every(point => Math.abs(point.y) < .00001), `${action} stance stays on ground at yaw ${yaw}`);
      for (const point of samples.slice(1)) {
        close(point.x, samples[0].x, .0001);
        close(point.z, samples[0].z, .0001);
      }
    }
  }
  assert.equal(DOG_3D_STAND_ROOT_HEIGHT + model.bounds.min[1], model.groundPlaneY);
});

test('stance-to-swing and stride-wrap foot positions meet without a frame-boundary pop', () => {
  for (const [action, stride, stance] of [['walk', .52, .64], ['run', .76, .52]]) {
    for (const boundary of [stride * stance, stride]) {
      const epsilon = stride * 1e-5;
      const before = footAt(action, boundary - epsilon, 0, 1.05);
      const after = footAt(action, boundary + epsilon, 0, .62);
      close(before.x, after.x, .00001);
      close(before.y, after.y, .00001);
      close(before.z, after.z, .0001);
      const leftVelocity = (footAt(action, boundary - epsilon, 0, 1).z - footAt(action, boundary - 2 * epsilon, 0, 1).z) / epsilon;
      const rightVelocity = (footAt(action, boundary + 2 * epsilon, 0, 1).z - footAt(action, boundary + epsilon, 0, 1).z) / epsilon;
      assert.ok(Math.abs(leftVelocity - rightVelocity) < .01, `${action} foot velocity is continuous at ${boundary}`);
    }
  }
});

test('turn samples follow a smooth shortest yaw path and front-side-back coordinates', () => {
  const yawSamples = [];
  for (let age = 0; age <= 1_000; age += 10) {
    yawSamples.push(sampleDog3DPose({
      action: 'turn', actionAgeMs: age, durationMs: 1_000, timeMs: 12_000,
      turnFromYaw: 0, view: 'side',
    }));
  }
  close(yawSamples[0].yaw, 0, 1e-12);
  close(yawSamples.at(-1).yaw, Math.PI / 2, 1e-12);
  for (let index = 1; index < yawSamples.length; index += 1) {
    assert.ok(yawSamples[index].yaw >= yawSamples[index - 1].yaw);
    assert.ok(yawSamples[index].yaw - yawSamples[index - 1].yaw < .03, 'each 10ms turn step is small');
  }

  const front = sampleDog3DPose({ action: 'idle', view: 'front' });
  const side = sampleDog3DPose({ action: 'idle', view: 'side' });
  const back = sampleDog3DPose({ action: 'idle', view: 'back' });
  assert.ok(side.landmarks.nose.x > front.landmarks.nose.x + .3, '+PI/2 turns the muzzle toward screen right');
  assert.ok(back.landmarks.nose.z < front.landmarks.nose.z - .5, 'PI faces away from the camera');
});

test('event time, continuous breathing, reduced motion, and frozen pause stay independent', () => {
  const timedEarly = sampleDog3DPose({ action: 'feed', actionAgeMs: 1_200, timeMs: 220 });
  const timedLater = sampleDog3DPose({ action: 'feed', actionAgeMs: 1_200, timeMs: 2_220 });
  close(timedEarly.headPitch, timedLater.headPitch, 1e-12);
  assert.notEqual(timedEarly.bodyBreath, timedLater.bodyBreath);

  const active = sampleDog3DPose({ action: 'feed', actionAgeMs: 1_800, timeMs: 1_800 });
  assert.equal(sampleDog3DPose({ action: 'sleep', actionAgeMs: 3_000, paused: true, frozenPose: active }), active);
  const pauseOne = sampleDog3DPose({ action: 'idle', paused: true, timeMs: 100 });
  const pauseTwo = sampleDog3DPose({ action: 'idle', paused: true, timeMs: 90_000 });
  assert.deepEqual(pauseOne, pauseTwo);

  const headMotion = sampleDog3DPose({ action: 'headTilt', actionAgeMs: 2_000, timeMs: 1_200 });
  const quietHead = sampleDog3DPose({ action: 'headTilt', actionAgeMs: 2_000, timeMs: 1_200, reducedMotion: true });
  assert.ok(Math.abs(quietHead.headTilt) < Math.abs(headMotion.headTilt));
  const gait = sampleDog3DPose({ action: 'walk', groundDistance: .52 * .8, velocity: .9, timeMs: 1_200 });
  const quietGait = sampleDog3DPose({ action: 'walk', groundDistance: .52 * .8, velocity: .9, timeMs: 1_200, reducedMotion: true });
  assert.equal(quietGait.gait, 'walk', 'reduced motion retains a regular spatial gait');
  assert.ok(quietGait.contactFeet.frontLeft.lift < gait.contactFeet.frontLeft.lift);
  const jump = sampleDog3DPose({ action: 'happyJump', actionAgeMs: 2_000, timeMs: 1_200 });
  const quietJump = sampleDog3DPose({ action: 'happyJump', actionAgeMs: 2_000, timeMs: 1_200, reducedMotion: true });
  assert.ok(quietJump.rootY < jump.rootY, 'reduced motion lowers the jump height');
});

test('feed phase boundaries are position-continuous and mouth landmarks project to canvas CSS coordinates', () => {
  for (const boundary of [.22, .8]) {
    const time = 4_000 * boundary;
    const before = sampleDog3DPose({ action: 'feed', durationMs: 4_000, actionAgeMs: time - .1, timeMs: 1_100 });
    const after = sampleDog3DPose({ action: 'feed', durationMs: 4_000, actionAgeMs: time + .1, timeMs: 1_100 });
    close(before.headPitch, after.headPitch, .001);
    close(before.jawOpen, after.jawOpen, .001);
  }
  const pose = sampleDog3DPose({ action: 'idle' });
  const size = 200, foot = 320, x = 90;
  const screenMouth = dog3DPointOnScreen(pose.landmarks.mouth, { x, foot, size, standingHeight: 1.355 });
  close(screenMouth.x, x + pose.landmarks.mouth.x * size / 1.355, 1e-10);
  close(screenMouth.y, foot - pose.landmarks.mouth.y * size / 1.355, 1e-10);
  const headTop = dog3DPointOnScreen({ x: 0, y: 1.355, z: 0 }, { x, foot, size, standingHeight: 1.355 });
  close(headTop.y, foot - size, 1e-10);
});
