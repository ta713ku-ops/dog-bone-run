import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHomeAction } from '../src/home-animation.js';

const home = (kind, elapsedMs, extra = {}) => resolveHomeAction({ kind, elapsedMs, ...extra });

test('idle and unknown actions resolve to a finite neutral pose without a toy', () => {
  for (const result of [resolveHomeAction(), home('unknown', 900)]) {
    assert.deepEqual(result, {
      rootOffsetX: 0,
      rootOffsetY: 0,
      facing: 'front',
      direction: 0,
      gaitDistance: 0,
      gaitSpeed: 0,
      headNod: 0,
      tailWag: 0,
      poseKey: 'idle',
      transition: 0,
      toy: { x: 0, y: 0, visible: false, held: false, type: null },
    });
  }
});

test('ball and frisbee play follow windup, flight arc, chase, pickup, and return', () => {
  for (const toyId of ['starterBall', 'frisbee']) {
    const at = elapsedMs => home('play', elapsedMs, { toyId });
    const windup = at(200);
    const flight = at(800);
    const chase = at(2_000);
    const pickup = at(2_800);
    const returning = at(3_500);
    const homeAgain = at(4_000);

    assert.equal(windup.poseKey, `play-${toyId === 'frisbee' ? 'frisbee' : 'ball'}-windup`);
    assert.equal(windup.toy.held, true);
    assert.equal(flight.poseKey.endsWith('-throw'), true);
    assert.equal(flight.toy.held, false);
    assert.ok(flight.toy.y > 0.1, 'toy rises above its ground position during flight');
    assert.equal(chase.poseKey.endsWith('-chase'), true);
    assert.equal(chase.facing, 'side');
    assert.equal(chase.direction, 1);
    assert.ok(chase.rootOffsetX > 0);
    assert.ok(chase.gaitDistance > 0);
    assert.ok(chase.gaitSpeed > 0);
    assert.equal(pickup.poseKey.endsWith('-pickup'), true);
    assert.equal(pickup.toy.held, false);
    assert.equal(returning.poseKey.endsWith('-return'), true);
    assert.equal(returning.direction, -1);
    assert.ok(returning.rootOffsetX > 0);
    assert.equal(homeAgain.rootOffsetX, 0);
    assert.equal(homeAgain.gaitDistance, toyId === 'frisbee' ? 2.4 : 1.92);
    assert.equal(homeAgain.toy.held, true);
    assert.equal(homeAgain.toy.type, toyId);

    let previousDistance = 0;
    for (let time = 0; time <= 4_000; time += 8) {
      const result = at(time);
      assert.ok(result.gaitDistance >= previousDistance, `${toyId} gait distance regressed at ${time}ms`);
      assert.ok(result.gaitSpeed >= 0);
      previousDistance = result.gaitDistance;
    }
  }
});

test('fetch root path has continuous velocity at its movement boundaries', () => {
  const rootX = elapsedMs => home('play', elapsedMs).rootOffsetX;
  const derivativeNear = elapsedMs => (rootX(elapsedMs + 1) - rootX(elapsedMs - 1)) / 2;

  for (const boundary of [1_360, 2_640, 2_960, 4_000]) {
    assert.ok(Math.abs(derivativeNear(boundary)) < 0.00001, `root should settle at ${boundary}ms`);
  }

  for (const boundary of [1_360, 2_640, 2_960, 4_000]) {
    const samples = [rootX(boundary - 1), rootX(boundary), rootX(boundary + 1)];
    for (let index = 1; index < samples.length; index += 1) {
      assert.ok(Math.abs(samples[index] - samples[index - 1]) < 0.001);
    }
  }
});

test('toy flight and pickup positions remain continuous across phase changes', () => {
  const at = elapsedMs => home('play', elapsedMs, { toyId: 'starterBall' });
  for (const boundary of [480, 1_360, 2_640, 2_960, 4_000]) {
    const before = at(boundary - 0.1).toy;
    const after = at(boundary + 0.1).toy;
    assert.ok(Math.abs(before.x - after.x) < 0.002, `toy x jumped at ${boundary}ms`);
    assert.ok(Math.abs(before.y - after.y) < 0.002, `toy y jumped at ${boundary}ms`);
  }
});

test('reduced motion preserves the fetch story and thrown toy while suppressing root chase', () => {
  const ordinary = home('play', 2_000, { toyId: 'frisbee' });
  const reduced = home('play', 2_000, { toyId: 'frisbee', reducedMotion: true });
  const ordinaryFlight = home('play', 800, { toyId: 'frisbee' });
  const reducedFlight = home('play', 800, { toyId: 'frisbee', reducedMotion: true });

  assert.equal(reduced.poseKey, ordinary.poseKey);
  assert.equal(reduced.facing, ordinary.facing);
  assert.equal(reduced.toy.visible, true);
  assert.equal(reduced.toy.type, 'frisbee');
  assert.equal(reduced.rootOffsetX, 0);
  assert.equal(reduced.rootOffsetY, 0);
  assert.equal(reduced.gaitDistance, 0);
  assert.equal(reduced.gaitSpeed, 0);
  assert.equal(reduced.toy.x, ordinary.toy.x);
  assert.equal(reducedFlight.poseKey, ordinaryFlight.poseKey);
  assert.equal(reducedFlight.toy.held, false);
  assert.ok(reducedFlight.toy.y > 0.1);
  assert.equal(reducedFlight.toy.x, ordinaryFlight.toy.x);
  assert.equal(reducedFlight.toy.y, ordinaryFlight.toy.y);
});

test('rope play is a grounded tug with no fetch route', () => {
  const early = home('play', 1_000, { toyId: 'rope' });
  const late = home('play', 2_600, { toyId: 'rope' });

  assert.equal(early.poseKey, 'play-rope-tug');
  assert.equal(early.facing, 'side');
  assert.equal(early.direction, -1);
  assert.equal(early.toy.visible, true);
  assert.equal(early.toy.held, true);
  assert.equal(early.toy.type, 'rope');
  assert.equal(early.gaitDistance, 0);
  assert.equal(early.gaitSpeed, 0);
  assert.ok(Math.abs(early.rootOffsetX) < 0.08);
  assert.notEqual(early.toy.x, late.toy.x);
  assert.notEqual(early.headNod, late.headNod);
});

test('plush play settles low and cuddles a held toy with small head movement', () => {
  const resting = home('play', 2_000, { toyId: 'plush' });
  const reduced = home('play', 2_000, { toyId: 'plush', reducedMotion: true });

  assert.equal(resting.poseKey, 'play-plush-cuddle');
  assert.equal(resting.facing, 'front');
  assert.ok(resting.rootOffsetY < -0.1);
  assert.equal(resting.toy.visible, true);
  assert.equal(resting.toy.held, true);
  assert.equal(resting.toy.type, 'plush');
  assert.equal(resting.gaitDistance, 0);
  assert.ok(Math.abs(resting.headNod) <= 0.045);
  assert.ok(Math.abs(reduced.headNod) < Math.abs(resting.headNod));
});

test('feeding exposes sniff, eating, and licking phases with small head movement', () => {
  const sniff = home('feed', 250);
  const eat = home('feed', 1_800);
  const lick = home('feed', 3_900);

  assert.equal(sniff.poseKey, 'feed-sniff');
  assert.ok(sniff.headNod < 0);
  assert.equal(eat.poseKey, 'feed-eat');
  assert.ok(Math.abs(eat.headNod) < 0.25);
  assert.equal(lick.poseKey, 'feed-lick');
  assert.ok(lick.headNod > 0);
  assert.equal(lick.toy.visible, false);
  assert.equal(sniff.rootOffsetX, 0);
  assert.equal(eat.gaitDistance, 0);
});

test('rest and sleep ease down, then keep breathing on absolute elapsed time', () => {
  for (const kind of ['rest', 'sleep']) {
    const start = home(kind, 0);
    const settled = home(kind, 1_000);
    const later = home(kind, 13_700);
    const stillLater = home(kind, 14_050);

    assert.equal(start.transition, 0);
    assert.equal(settled.poseKey, kind === 'sleep' ? 'sleep-lie' : 'rest-lie');
    assert.equal(settled.transition, 1);
    assert.ok(settled.rootOffsetY < 0);
    assert.equal(later.transition, 1);
    assert.notEqual(later.headNod, stillLater.headNod);
    assert.equal(later.gaitDistance, 0);
  }
});

test('absolute elapsed time makes output independent of frame cadence and pauses', () => {
  const target = 2_137;
  const direct = home('play', target, { toyId: 'starterBall' });
  let stepped;
  for (let time = 0; time < target; time += 17) {
    stepped = home('play', Math.min(time + 17, target), { toyId: 'starterBall' });
  }
  assert.deepEqual(stepped, direct);

  const pausedFrameBefore = home('feed', 1_234);
  const pausedFrameAfter = home('feed', 1_234);
  assert.deepEqual(pausedFrameAfter, pausedFrameBefore);
});

test('invalid times are clamped and never leak NaN into the render result', () => {
  const result = resolveHomeAction({ kind: 'play', elapsedMs: Number.NaN, durationMs: 0 });
  for (const value of Object.values(result)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  assert.equal(result.poseKey, 'play-ball-windup');
  assert.equal(result.toy.held, true);

  for (const extreme of [
    resolveHomeAction({ kind: 'feed', elapsedMs: Number.MAX_VALUE }),
    resolveHomeAction({ kind: 'play', elapsedMs: 0.5, durationMs: Number.MIN_VALUE }),
  ]) {
    for (const value of Object.values(extreme)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    }
    assert.ok(Number.isFinite(extreme.toy.x));
    assert.ok(Number.isFinite(extreme.toy.y));
  }
});
