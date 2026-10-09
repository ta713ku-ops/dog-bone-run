import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDogRigMesh, DOG_GAIT, DOG_RIG_DIAGNOSTICS, DogAnimationController,
  getDogAnimationPose, sampleDogDeformation,
} from '../src/dog-animation.js';

test('walk and run phase are functions of ground distance and loop smoothly', () => {
  const first = getDogAnimationPose({ action: 'run', groundDistance: 1.9, timeMs: 800, velocity: 1 });
  const sameDistanceLater = getDogAnimationPose({ action: 'run', groundDistance: 1.9, timeMs: 7_800, velocity: 1 });
  const advancedByStride = getDogAnimationPose({ action: 'run', groundDistance: 1.9 + DOG_GAIT.runStrideLength, timeMs: 800, velocity: 1 });
  assert.equal(first.gaitPhase, sameDistanceLater.gaitPhase);
  assert.ok(Math.abs(first.gaitPhase - advancedByStride.gaitPhase) < 1e-12);

  for (const gait of ['walk', 'run']) {
    const stride = gait === 'walk' ? DOG_GAIT.walkStrideLength : DOG_GAIT.runStrideLength;
    const before = getDogAnimationPose({ action: gait, groundDistance: stride * (1 - 1e-6), timeMs: 900, velocity: 1 });
    const after = getDogAnimationPose({ action: gait, groundDistance: stride * (1 + 1e-6), timeMs: 900, velocity: 1 });
    for (const point of [[.25, 1], [.5, .4], [.75, 1], [.5, .2]]) {
      const a = sampleDogDeformation(...point, before, 140);
      const b = sampleDogDeformation(...point, after, 140);
      assert.ok(Math.hypot(a.dx - b.dx, a.dy - b.dy) < .01, `${gait} seam at ${point}`);
    }
  }
});

test('stopping removes gait lift and deceleration follows travelled distance smoothly', () => {
  const slow = getDogAnimationPose({ action: 'run', groundDistance: 2, velocity: .3, timeMs: 1_000 });
  const fast = getDogAnimationPose({ action: 'run', groundDistance: 2, velocity: 1.4, timeMs: 1_000 });
  const stopped = getDogAnimationPose({ action: 'run', groundDistance: 2, velocity: 0, timeMs: 9_000 });
  assert.ok(slow.gaitWeight > 0 && slow.gaitWeight < fast.gaitWeight);
  assert.equal(stopped.gaitWeight, 0);
  assert.equal(stopped.feet.left.lift, 0);
  assert.equal(stopped.feet.right.lift, 0);
  assert.equal(stopped.gaitPhase, slow.gaitPhase, 'time does not advance a spatial gait phase');
  const eased = getDogAnimationPose({ action: 'run', groundDistance: 2.03, velocity: .3, timeMs: 1_000 });
  assert.ok(eased.gaitPhase > slow.gaitPhase, 'a small amount of ground travel advances the slowed gait by the matching amount');
  assert.ok(eased.gaitPhase - slow.gaitPhase < .05);
});

test('stance feet stay on the ground while the opposite foot swings', () => {
  const crop = { x: 54, y: 14, width: 150, height: 234, anchorX: 76.25 };
  const stride = DOG_GAIT.runStrideLength;
  const pose = getDogAnimationPose({ action: 'run', groundDistance: stride * .12, velocity: 1.2, timeMs: 600 });
  assert.equal(pose.feet.left.stance, true);
  assert.equal(pose.feet.right.stance, false);
  const mesh = buildDogRigMesh({ crop, x: 110, foot: 205, size: 180, pose });
  assert.equal(mesh.triangles.length, 192);
  const vertexAt = (u, v) => mesh.vertices.find(vertex => vertex.u === u && vertex.v === v);
  const leftFoot = vertexAt(.25, 1), rightFoot = vertexAt(.75, 1);
  assert.ok(leftFoot && rightFoot);
  assert.equal(leftFoot.y, 205, 'left stance paw remains on the controller foot line');
  assert.ok(rightFoot.y < 205, 'right paw lifts during swing');

  const heldPose = getDogAnimationPose({ action: 'run', groundDistance: stride * .12, velocity: 0, timeMs: 600 });
  const heldMesh = buildDogRigMesh({ crop, x: 110, foot: 205, size: 180, pose: heldPose });
  for (const u of [.25, .75]) {
    const paw = heldMesh.vertices.find(vertex => vertex.u === u && vertex.v === 1);
    assert.equal(paw.y, 205, 'a stopped paw stays planted even if its previous spatial phase was swing');
  }
});

test('lane lean and timed reaction are independent additive channels', () => {
  const common = { action: 'run', groundDistance: .27, timeMs: 900, velocity: 1.1 };
  const base = getDogAnimationPose(common);
  const leaned = getDogAnimationPose({ ...common, moveLean: .8 });
  const reacted = getDogAnimationPose({ ...common, reaction: { type: 'collect', ageMs: 90 } });
  assert.equal(base.gaitPhase, leaned.gaitPhase);
  assert.equal(base.feet.left.stance, leaned.feet.left.stance);
  assert.notDeepEqual(sampleDogDeformation(.5, .38, base, 180), sampleDogDeformation(.5, .38, leaned, 180));
  assert.equal(base.gaitPhase, reacted.gaitPhase);
  assert.equal(base.moveLean, reacted.moveLean);
  assert.notDeepEqual(sampleDogDeformation(.5, .38, base, 180), sampleDogDeformation(.5, .38, reacted, 180));
  assert.deepEqual(sampleDogDeformation(.25, 1, leaned, 180), { dx: 0, dy: 0 });
});

test('reduced motion keeps a small living breath and pause freezes the complete pose', () => {
  const normal = getDogAnimationPose({ action: 'run', groundDistance: .4, timeMs: 1_200, velocity: 1 });
  const reduced = getDogAnimationPose({ action: 'run', groundDistance: .4, timeMs: 1_200, velocity: 1, reducedMotion: true });
  assert.ok(reduced.gaitWeight > 0 && reduced.gaitWeight < normal.gaitWeight);
  assert.ok(Math.abs(reduced.breath) > 0);

  const controller = new DogAnimationController();
  const moving = controller.sample({ action: 'run', groundDistance: .4, timeMs: 1_200, velocity: 1, moveLean: -.4 });
  assert.equal(controller.sample({ action: 'run', groundDistance: .4, timeMs: 1_200, velocity: 1, moveLean: -.4, paused: true }), moving);
  assert.equal(controller.sample({ action: 'run', groundDistance: 8.4, timeMs: 9_200, velocity: 0, moveLean: .8, paused: true }), moving);
  assert.equal(controller.sample({ action: 'run', groundDistance: .4, timeMs: 1_200, velocity: 1, moveLean: -.4, paused: true }), moving);
  const resumed = controller.sample({ action: 'run', groundDistance: .42, timeMs: 1_300, velocity: .95 });
  assert.notEqual(resumed, moving);
  controller.reset();
  assert.equal(controller.lastPose, null);
});

test('rig landmark status remains a prototype until source metadata and art review exist', () => {
  assert.equal(DOG_RIG_DIAGNOSTICS.status, 'prototype');
  assert.match(DOG_RIG_DIAGNOSTICS.landmarks, /estimated/);
  assert.match(DOG_RIG_DIAGNOSTICS.landmarks, /no bodyLandmarks or contactFeet/);
  assert.match(DOG_RIG_DIAGNOSTICS.gaitCalibration, /provisional/);
  assert.equal(DOG_RIG_DIAGNOSTICS.artReview, 'pending');
  assert.equal(DOG_RIG_DIAGNOSTICS.trianglesPerFrame, 192);
});

test('home source crops accept front/side head and tail motion with an explicit groundY', () => {
  const crop = { x: 12, y: 18, width: 280, height: 320, anchorX: 139, groundY: 278 };
  const args = { action: 'lie', timeMs: 200, view: 'side', rigMode: 'home' };
  const first = getDogAnimationPose({ ...args, reaction: { type: 'headNod', ageMs: 100 } });
  const next = getDogAnimationPose({ ...args, timeMs: 390, reaction: { type: 'headNod', ageMs: 100 } });
  assert.notDeepEqual(sampleDogDeformation(.78, .22, first, 180), sampleDogDeformation(.78, .22, next, 180));
  assert.notDeepEqual(
    sampleDogDeformation(.14, .24, getDogAnimationPose({ ...args, action: 'tailWag' }), 180),
    sampleDogDeformation(.14, .24, getDogAnimationPose({ ...args, action: 'tailWag', timeMs: 75 }), 180),
  );
  const headSignal = getDogAnimationPose({ ...args, headNod: .35 });
  const tailSignal = getDogAnimationPose({ ...args, tailWag: -.4 });
  assert.notDeepEqual(sampleDogDeformation(.78, .22, headSignal, 180), sampleDogDeformation(.78, .22, first, 180));
  assert.notDeepEqual(sampleDogDeformation(.14, .24, tailSignal, 180), sampleDogDeformation(.14, .24, first, 180));
  assert.equal(getDogAnimationPose({ ...args, headNod: 3, tailWag: -5 }).headNod, 1);
  assert.equal(getDogAnimationPose({ ...args, headNod: 3, tailWag: -5 }).tailWag, -1);
  const mesh = buildDogRigMesh({ crop, x: 110, foot: 206, size: 180, pose: first });
  const groundV = crop.groundY / crop.height;
  const anchors = mesh.vertices.filter(vertex => Math.abs(vertex.v - groundV) < 1e-9);
  assert.equal(anchors.length, 9, 'the custom ground line is an exact mesh row');
  assert.ok(anchors.every(vertex => vertex.y === 206), 'custom source crops keep their supplied groundY on the renderer foot line');
});

test('extreme clamped controls keep the triangulated crop finite and nonfolding', () => {
  const crop = { x: 54, y: 14, width: 150, height: 234, anchorX: 76.25 };
  const pose = getDogAnimationPose({
    action: 'run', timeMs: 380, groundDistance: .41, velocity: 1.6,
    moveLean: 2, headNod: -4, tailWag: 6,
    reaction: { type: 'hit', ageMs: 60 },
  });
  const mesh = buildDogRigMesh({ crop, x: 175, foot: 225, size: 190, pose });
  assert.ok(mesh.vertices.every(vertex => [vertex.sx, vertex.sy, vertex.x, vertex.y].every(Number.isFinite)));
  for (const triangle of mesh.triangles) {
    const [a, b, c] = triangle.map(index => mesh.vertices[index]);
    const signedArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    assert.ok(signedArea > 0, `triangle ${triangle.join(',')} keeps its source winding`);
  }
});
