import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleHome } from '../src/sprite-animation.js';
import { createHomeCommand, sampleHomeCommand } from '../src/home-command-motion.js';

const production48 = { sitdown: 48, liedown: 48, greet: 32, tiltleft: 32, tiltright: 32 };

function layersOf(frame) {
  if (Array.isArray(frame.layers)) return frame.layers;
  const mix = Number.isFinite(frame.mix) ? Math.min(1, Math.max(0, frame.mix)) : 0;
  const nextAtlas = frame.nextAtlas ?? frame.atlas;
  return [
    { atlas: frame.atlas, index: frame.index, weight: 1 - mix },
    { atlas: nextAtlas, index: frame.nextIndex, weight: mix },
  ].filter(layer => layer.weight > 0);
}

function poseForLayer(layer, frameCounts) {
  if (layer.atlas === 'sitdown') {
    return frameCounts.sitdown <= 1 ? 0 : layer.index / (frameCounts.sitdown - 1);
  }
  if (layer.atlas === 'liedown') {
    return frameCounts.liedown <= 1 ? 1 : 1 + layer.index / (frameCounts.liedown - 1);
  }
  if (layer.atlas === 'postures') {
    if (layer.index <= 3) return layer.index / 3;
    if (layer.index <= 5) return 1;
    if (layer.index <= 8) return 1 + (layer.index - 6) / 2;
    return 2;
  }
  return 0;
}

function poseOf(frame, frameCounts) {
  const layers = layersOf(frame);
  const weight = layers.reduce((sum, layer) => sum + layer.weight, 0);
  return weight ? layers.reduce((sum, layer) => sum + poseForLayer(layer, frameCounts) * layer.weight, 0) / weight : 0;
}

function assertFiniteSample(sample) {
  for (const value of Object.values(sample)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  for (const layer of layersOf(sample)) {
    assert.ok(Number.isInteger(layer.index) && layer.index >= 0);
    assert.ok(Number.isFinite(layer.weight) && layer.weight >= 0 && layer.weight <= 1);
  }
}

test('sit and lie commands honor production and mixed atlas counts', () => {
  for (const frameCounts of [production48, { sitdown: 48, liedown: 32, greet: 16 }]) {
    for (const action of ['sit', 'lie']) {
      const anchor = sampleHome(0, { continuousMotion: true, frameCounts });
      const command = createHomeCommand(action, 0, anchor, frameCounts);
      const target = sampleHomeCommand(command.startedAt + command.durationMs, command, { frameCounts });
      const expectedAtlas = action === 'sit' ? 'sitdown' : 'liedown';
      const expectedIndex = frameCounts[expectedAtlas] - 1;
      assert.deepEqual(layersOf(target), [{ atlas: expectedAtlas, index: expectedIndex, weight: 1 }]);

      for (let elapsed = 0; elapsed <= command.durationMs; elapsed += 37) {
        const frame = sampleHomeCommand(elapsed, command, { frameCounts });
        assertFiniteSample(frame);
        for (const layer of layersOf(frame)) {
          assert.ok(layer.index < frameCounts[layer.atlas] || !frameCounts[layer.atlas],
            `${layer.atlas} index ${layer.index} stays within its atlas`);
        }
      }
    }
  }
});

test('continuous lie-to-sit entry uses the configured 48-frame endpoint', () => {
  const sample = sampleHome(40_200, {
    continuousMotion: true,
    interaction: { action: 'sit', startedAt: 40_000 },
    frameCounts: production48,
  });
  assert.deepEqual(layersOf(sample), [{ atlas: 'liedown', index: 47, weight: 1 }]);
});

test('commands start on exact automatic layers from every posture and transition', () => {
  const anchorsAt = [0, 16_950, 17_500, 18_400, 31_350, 32_000, 32_800, 49_850, 50_400, 51_200, 52_800];
  for (const startedAt of anchorsAt) {
    const anchor = sampleHome(startedAt, { continuousMotion: true, frameCounts: production48 });
    for (const action of ['sit', 'lie', 'greet']) {
      const command = createHomeCommand(action, startedAt, anchor, production48);
      const initial = sampleHomeCommand(startedAt, command, { frameCounts: production48 });
      assert.deepEqual(layersOf(initial), layersOf(anchor), `${action} preserves layers at ${startedAt}ms`);
      assert.equal(initial.headAngle, 0);
      assert.equal(initial.headLift, 0);
      assertFiniteSample(initial);
    }
  }
});

test('posture routes progress monotonically from partial automatic transitions', () => {
  for (const startedAt of [0, 17_500, 31_800, 50_400]) {
    const anchor = sampleHome(startedAt, { continuousMotion: true, frameCounts: production48 });
    for (const action of ['sit', 'lie']) {
      const command = createHomeCommand(action, startedAt, anchor, production48);
      if (command.durationMs === 0) continue;
      const target = action === 'sit' ? 1 : 2;
      let prior = poseOf(sampleHomeCommand(startedAt, command, { frameCounts: production48 }), production48);
      const direction = Math.sign(target - prior);
      for (let elapsed = 25; elapsed < command.durationMs; elapsed += 25) {
        const current = poseOf(sampleHomeCommand(startedAt + elapsed, command, { frameCounts: production48 }), production48);
        assert.ok((current - prior) * direction >= -1e-8,
          `${action} moves monotonically at ${startedAt}+${elapsed}ms (${prior} to ${current})`);
        prior = current;
      }
      const settled = sampleHomeCommand(startedAt + command.durationMs, command, { frameCounts: production48 });
      assert.ok(Math.abs(poseOf(settled, production48) - target) < 1e-8);
    }
  }
});

test('sit, lying rise, seated lie, and stand-to-lie use distinct one-way timing', () => {
  const standing = sampleHome(0, { continuousMotion: true, frameCounts: production48 });
  const seated = { atlas: 'sitdown', index: 47, nextIndex: 47, mix: 0, action: 'fully-sitting', layers: [{ atlas: 'sitdown', index: 47, weight: 1 }] };
  const lying = { atlas: 'liedown', index: 47, nextIndex: 47, mix: 0, action: 'lie-head-up', layers: [{ atlas: 'liedown', index: 47, weight: 1 }] };
  const sit = createHomeCommand('sit', 0, standing, production48);
  const rise = createHomeCommand('sit', 0, lying, production48);
  const lieFromSit = createHomeCommand('lie', 0, seated, production48);
  const lieFromStand = createHomeCommand('lie', 0, standing, production48);
  assert.equal(sit.durationMs, 1_600);
  assert.equal(rise.durationMs, 1_500);
  assert.equal(lieFromSit.durationMs, 1_800);
  assert.equal(lieFromStand.durationMs, 2_800);
  assert.equal(lieFromStand.motions.length, 2);
  assert.ok(Math.abs(lieFromStand.motions.reduce((sum, motion) => sum + motion.durationMs, 0) - lieFromStand.durationMs) < 1e-8);

  const routePoses = [];
  for (let elapsed = 0; elapsed <= lieFromStand.durationMs; elapsed += 100) {
    routePoses.push(poseOf(sampleHomeCommand(elapsed, lieFromStand, { frameCounts: production48 }), production48));
  }
  assert.ok(routePoses.some(pose => pose < 0.95) && routePoses.some(pose => pose > 1.05));
  const nearSit = routePoses.findIndex(pose => pose >= 0.95);
  assert.ok(nearSit > 0 && nearSit < routePoses.length - 1);
  assert.notEqual(routePoses[nearSit + 1], routePoses[nearSit], 'the stand-to-lie route has no seated plateau');
});

test('completed commands hold the target for ten seconds and keep real-time idle motion', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const anchor = sampleHome(0, { continuousMotion: true, frameCounts });
  for (const action of ['sit', 'lie']) {
    const command = createHomeCommand(action, 0, anchor, frameCounts);
    const atCompletion = sampleHomeCommand(command.durationMs, command, { frameCounts, seed: 91 });
    const later = sampleHomeCommand(command.durationMs + 10_000, command, { frameCounts, seed: 91 });
    assert.deepEqual(layersOf(later), layersOf(atCompletion));
    let blinkSeen = false;
    let firstBreath = null;
    let laterBreath = null;
    for (let elapsed = command.durationMs; elapsed <= command.durationMs + 10_000; elapsed += 25) {
      const sample = sampleHomeCommand(elapsed, command, { frameCounts, seed: 91 });
      assert.deepEqual(layersOf(sample), layersOf(atCompletion));
      if (sample.blink > 0) blinkSeen = true;
      if (firstBreath === null) firstBreath = sample.breath;
      if (elapsed >= command.durationMs + 250) laterBreath = sample.breath;
    }
    assert.equal(blinkSeen, true, `${action} allows a real-time blink while held`);
    assert.notEqual(firstBreath, laterBreath, `${action} keeps breathing while held`);
    assert.ok(Number.isFinite(later.breath));
  }
});

test('greet uses only local head and ear motion and never selects a paw atlas', () => {
  const frameCounts = { sitdown: 48, liedown: 48, greet: 48 };
  for (const startedAt of [0, 18_400, 32_800]) {
    const anchor = sampleHome(startedAt, { continuousMotion: true, frameCounts });
    const command = createHomeCommand('greet', startedAt, anchor, frameCounts);
    assert.equal(command.durationMs, 3_000);
    for (const elapsed of [0, 450, 900, 1_400, 1_900, 2_450, 3_000]) {
      const sample = sampleHomeCommand(startedAt + elapsed, command, { frameCounts });
      assert.deepEqual(layersOf(sample), layersOf(anchor));
      assert.ok(layersOf(sample).every(layer => layer.atlas !== 'greet'));
      assert.ok(Math.abs(sample.headAngle) <= 0.055 + 1e-12);
      assert.ok(Math.abs(sample.headLift) <= 4 + 1e-12);
      assert.ok(Math.abs(sample.earLeft) <= 1 && Math.abs(sample.earRight) <= 1);
      assertFiniteSample(sample);
    }
    const alert = sampleHomeCommand(startedAt + 1_400, command, { frameCounts });
    const release = sampleHomeCommand(startedAt + 2_450, command, { frameCounts });
    const done = sampleHomeCommand(startedAt + 3_000, command, { frameCounts });
    assert.ok(alert.headAngle > 0.05 && alert.headLift > 3.5);
    assert.ok(release.headAngle < alert.headAngle && release.headLift < alert.headLift);
    assert.equal(done.headAngle, 0);
    assert.equal(done.headLift, 0);
  }
});

test('greet stages ears, lift, and tilt with smooth staggered phases', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const startedAt = 0;
  const anchor = sampleHome(startedAt, { continuousMotion: true, frameCounts, seed: 42 });
  const command = createHomeCommand('greet', startedAt, anchor, frameCounts);
  const sampleAt = elapsed => sampleHomeCommand(startedAt + elapsed, command, { frameCounts, seed: 42 });
  const baseAt = (elapsed, frame) => sampleHome(startedAt + elapsed, {
    continuousMotion: true,
    heldFrame: frame,
    frameCounts,
    seed: 42,
  });

  const first = sampleAt(0);
  const firstBase = baseAt(0, first);
  assert.equal(first.earLeft, firstBase.earLeft);
  assert.equal(first.earRight, firstBase.earRight);
  const early = sampleAt(100);
  assert.ok(early.earLeft > 0, 'the ears respond first');
  assert.equal(early.headLift, 0);
  assert.equal(early.headAngle, 0);

  const lift = sampleAt(250);
  assert.ok(lift.headLift > 0, 'the face lifts after the ears begin');
  assert.equal(lift.headAngle, 0, 'the tilt begins after the lift');
  const alert = sampleAt(1_400);
  const alertBase = baseAt(1_400, alert);
  assert.ok(Math.abs((alert.earLeft - alertBase.earLeft) - 0.32) < 1e-8);
  assert.ok(Math.abs((alert.earRight - alertBase.earRight) - 0.2) < 1e-8);

  const done = sampleAt(3_000);
  const doneBase = baseAt(3_000, done);
  assert.equal(done.earLeft, doneBase.earLeft);
  assert.equal(done.earRight, doneBase.earRight);
  assert.equal(done.headAngle, 0);
  assert.equal(done.headLift, 0);
});

test('commands carry an active greet response continuously, then release it', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const greetStart = 0;
  const standing = sampleHome(greetStart, { continuousMotion: true, frameCounts, seed: 42 });
  const greet = createHomeCommand('greet', greetStart, standing, frameCounts);
  const interruptedAt = 1_400;
  const active = sampleHomeCommand(interruptedAt, greet, { frameCounts, seed: 42 });

  for (const action of ['sit', 'lie', 'greet']) {
    const next = createHomeCommand(action, interruptedAt, active, frameCounts);
    const first = sampleHomeCommand(interruptedAt, next, { frameCounts, seed: 42 });
    for (const field of ['headAngle', 'headLift', 'earLeft', 'earRight']) {
      assert.equal(first[field], active[field], `${action} starts with the captured ${field}`);
    }

    const near = sampleHomeCommand(interruptedAt + 16, next, { frameCounts, seed: 42 });
    assert.ok(Math.abs(near.headAngle - active.headAngle) < 0.002);
    assert.ok(Math.abs(near.headLift - active.headLift) < 0.08);
    assert.ok(Math.abs(near.earLeft - active.earLeft) < 0.02);
    assert.ok(Math.abs(near.earRight - active.earRight) < 0.02);

    if (action !== 'greet') {
      const released = sampleHomeCommand(interruptedAt + 320, next, { frameCounts, seed: 42 });
      assert.equal(released.headAngle, 0);
      assert.equal(released.headLift, 0);
    }

    const reduced = sampleHomeCommand(interruptedAt + 16, next, {
      frameCounts,
      seed: 42,
      reducedMotion: true,
    });
    assert.equal(reduced.headAngle, 0);
    assert.equal(reduced.headLift, 0);
    assert.equal(reduced.earLeft, 0);
    assert.equal(reduced.earRight, 0);
  }
});

test('a command preserves nonzero automatic idle ears on entry', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const startedAt = 6_000;
  const anchor = sampleHome(startedAt, { continuousMotion: true, frameCounts, seed: 42 });
  assert.notEqual(anchor.earLeft, 0);
  const command = createHomeCommand('greet', startedAt, anchor, frameCounts);
  const first = sampleHomeCommand(startedAt, command, { frameCounts, seed: 42 });
  assert.equal(first.earLeft, anchor.earLeft);
  assert.equal(first.earRight, anchor.earRight);

  const near = sampleHomeCommand(startedAt + 16, command, { frameCounts, seed: 42 });
  assert.ok(Math.abs(near.earLeft - anchor.earLeft) < 0.02);
  assert.ok(Math.abs(near.earRight - anchor.earRight) < 0.02);
});

test('a no-op posture command holds an active local handoff for 320ms', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const cases = [
    {
      action: 'sit',
      frame: { atlas: 'sitdown', index: 47, nextIndex: 47, mix: 0, action: 'fully-sitting', layers: [{ atlas: 'sitdown', index: 47, weight: 1 }] },
    },
    {
      action: 'lie',
      frame: { atlas: 'liedown', index: 47, nextIndex: 47, mix: 0, action: 'lie-head-up', layers: [{ atlas: 'liedown', index: 47, weight: 1 }] },
    },
  ];

  for (const { action, frame } of cases) {
    const automatic = sampleHome(6_000, { continuousMotion: true, heldFrame: frame, frameCounts, seed: 42 });
    const ordinaryNoOp = createHomeCommand(action, 6_000, automatic, frameCounts);
    assert.notEqual(automatic.earLeft, 0, 'the ordinary anchor has idle ear motion');
    assert.equal(ordinaryNoOp.durationMs, 0, 'ordinary idle ears do not extend a no-op command');

    const greet = createHomeCommand('greet', 6_000, automatic, frameCounts);
    const active = sampleHomeCommand(7_400, greet, { frameCounts, seed: 42 });
    const interrupted = createHomeCommand(action, 7_400, active, frameCounts);
    assert.equal(interrupted.durationMs, 320, `${action} keeps the zero-distance pose command alive for the handoff`);

    const first = sampleHomeCommand(7_400, interrupted, { frameCounts, seed: 42 });
    for (const field of ['headAngle', 'headLift', 'earLeft', 'earRight']) {
      assert.equal(first[field], active[field], `${action} preserves ${field} at command start`);
    }

    const near = sampleHomeCommand(7_416, interrupted, { frameCounts, seed: 42 });
    assert.ok(Math.abs(near.headAngle - active.headAngle) < 0.002);
    assert.ok(Math.abs(near.headLift - active.headLift) < 0.08);
    assert.ok(Math.abs(near.earLeft - active.earLeft) < 0.02);
    assert.ok(Math.abs(near.earRight - active.earRight) < 0.02);

    const ended = sampleHomeCommand(7_720, interrupted, { frameCounts, seed: 42 });
    const baseline = sampleHome(7_720, { continuousMotion: true, heldFrame: ended, frameCounts, seed: 42 });
    assert.equal(ended.headAngle, 0);
    assert.equal(ended.headLift, 0);
    assert.equal(ended.earLeft, baseline.earLeft);
    assert.equal(ended.earRight, baseline.earRight);
  }
});

test('greet finishes automatic transition anchors while the local response runs', () => {
  const frameCounts = { sitdown: 48, liedown: 48, greet: 32 };
  const cases = [
    { startedAt: 17_500, targetPose: 1, atlas: 'sitdown', index: 47, action: 'fully-sitting' },
    { startedAt: 31_800, targetPose: 2, atlas: 'liedown', index: 47, action: 'lie-head-up' },
    { startedAt: 50_400, targetPose: 1, atlas: 'sitdown', index: 47, action: 'fully-sitting' },
    { startedAt: 52_000, targetPose: 0, atlas: 'sitdown', index: 0, action: 'stand-idle' },
  ];
  for (const expected of cases) {
    const anchor = sampleHome(expected.startedAt, { continuousMotion: true, frameCounts });
    const command = createHomeCommand('greet', expected.startedAt, anchor, frameCounts);
    assert.deepEqual(layersOf(sampleHomeCommand(expected.startedAt, command, { frameCounts })), layersOf(anchor));
    assert.equal(command.targetPose, expected.targetPose, `${anchor.action} finishes its automatic route`);
    assert.ok(command.motions.some(motion => motion.kind === 'local-attention'));
    const middle = sampleHomeCommand(expected.startedAt + 1_500, command, { frameCounts });
    assert.ok(Math.abs(middle.headAngle) > 0.05);
    assert.ok((poseOf(middle, frameCounts) - poseOf(anchor, frameCounts))
      * Math.sign(expected.targetPose - poseOf(anchor, frameCounts)) >= 0);
    const done = sampleHomeCommand(expected.startedAt + command.durationMs, command, { frameCounts });
    assert.deepEqual(layersOf(done), [{ atlas: expected.atlas, index: expected.index, weight: 1 }]);
    assert.equal(done.action, expected.action);
    assert.equal(done.headAngle, 0);
    assert.equal(done.headLift, 0);
  }
});

test('small repeated posture commands are no-ops and reduced motion keeps a static held pose', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const seated = { atlas: 'sitdown', index: 47, nextIndex: 47, mix: 0, action: 'fully-sitting', layers: [{ atlas: 'sitdown', index: 47, weight: 1 }] };
  const repeated = createHomeCommand('sit', 2_000, seated, frameCounts);
  assert.equal(repeated.durationMs, 0);
  assert.deepEqual(layersOf(sampleHomeCommand(2_000, repeated, { frameCounts })), layersOf(seated));

  const nearSeated = { atlas: 'sitdown', index: 46, nextIndex: 46, mix: 0, action: 'interaction-sit', layers: [{ atlas: 'sitdown', index: 46, weight: 1 }] };
  const finish = createHomeCommand('sit', 3_000, nearSeated, frameCounts);
  assert.ok(finish.durationMs > 0 && finish.durationMs <= 300);
  assert.deepEqual(layersOf(sampleHomeCommand(3_000, finish, { frameCounts })), layersOf(nearSeated));
  const finished = sampleHomeCommand(3_000 + finish.durationMs, finish, { frameCounts });
  assert.deepEqual(layersOf(finished), [{ atlas: 'sitdown', index: 47, weight: 1 }]);
  assert.equal(finished.action, 'fully-sitting', 'partial endpoints settle into a canonical idle pose');

  const standing = sampleHome(0, { continuousMotion: true, frameCounts });
  const lie = createHomeCommand('lie', 0, standing, frameCounts);
  const reduced = sampleHomeCommand(100, lie, { frameCounts, reducedMotion: true });
  assert.deepEqual(layersOf(reduced), layersOf(lie.targetFrame));
  assert.equal(reduced.blink, 0);
  assert.equal(reduced.breath, 0);
  assert.equal(reduced.earLeft, 0);
  assert.equal(reduced.earRight, 0);
  assert.equal(reduced.headAngle, 0);
  assert.equal(reduced.headLift, 0);

  const held = sampleHome(12_000, {
    continuousMotion: true,
    heldFrame: lie.targetFrame,
    frameCounts,
    reducedMotion: true,
  });
  assert.deepEqual(layersOf(held), layersOf(lie.targetFrame));
  assert.equal(held.breath, 0);
  assert.equal(held.headAngle, 0);
});

test('continuous heldFrame overrides automatic and interaction poses while remaining decorated', () => {
  const frameCounts = { sitdown: 48, liedown: 48 };
  const heldFrame = { atlas: 'liedown', index: 47, nextIndex: 47, mix: 0, action: 'lie-head-up', layers: [{ atlas: 'liedown', index: 47, weight: 1 }] };
  const held = sampleHome(12_345, {
    continuousMotion: true,
    heldFrame,
    frameCounts,
    interaction: { action: 'greet', startedAt: 12_000 },
  });
  assert.deepEqual(layersOf(held), layersOf(heldFrame));
  assert.equal(held.attention, undefined);
  assert.equal(held.natural, true);
  assert.ok(Number.isFinite(held.breath));
  assert.ok(Number.isFinite(held.earLeft));
});
