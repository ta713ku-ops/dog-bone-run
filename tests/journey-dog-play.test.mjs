import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJourneyDogPlay,
  sampleJourneyDogPlay,
  createJourneyDiscoveryReaction,
  sampleJourneyDiscoveryReaction,
} from '../src/journey-dog-play.js';

test('ball play rolls away, reaches the dog, is carried home, then settles in its slot', () => {
  const play = createJourneyDogPlay('starterBall', 1_000);
  assert.equal(sampleJourneyDogPlay(play, 1_000).phase, 'anticipate');
  const chase = sampleJourneyDogPlay(play, 3_650, { toyOffset: .55 });
  assert.equal(chase.phase, 'chase');
  assert.ok(chase.dogOffset < 0, 'the dog follows the ball across the room');

  const carry = sampleJourneyDogPlay(play, 4_800, { toyOffset: .55 });
  assert.equal(carry.phase, 'return');
  assert.equal(carry.propMode, 'carried');
  assert.equal(carry.attached, true);
  assert.equal(carry.carryOffsetY, .54, 'the ball stays at the photographed mouth instead of covering the eyes');
  assert.ok(carry.dogOffset > chase.dogOffset, 'dog and ball move back toward the home position together');

  const released = sampleJourneyDogPlay(play, 6_040, { toyOffset: .55 });
  assert.equal(released.phase, 'release');
  assert.equal(released.attached, false);
  const settled = sampleJourneyDogPlay(play, 6_600, { toyOffset: .55 });
  assert.equal(settled.phase, 'settled');
  assert.equal(settled.dogOffset, 0);
  assert.equal(settled.propOffsetX, 0);
  assert.equal(settled.active, false);
});

test('plush approaches the equipped item and finishes in a calm resting pose', () => {
  const play = createJourneyDogPlay('plush', 200);
  const approach = sampleJourneyDogPlay(play, 800, { toyOffset: .55 });
  assert.equal(approach.phase, 'approach');
  assert.ok(approach.dogOffset > 0);
  const sniff = sampleJourneyDogPlay(play, 1_500, { toyOffset: .55 });
  assert.equal(sniff.phase, 'sniff');
  assert.ok(sniff.headRest > 0);
  const rest = sampleJourneyDogPlay(play, 5_000, { toyOffset: .55 });
  assert.equal(rest.phase, 'settled');
  assert.ok(rest.dogOffset > 0);
  assert.equal(rest.dogOffset, sniff.dogOffset, 'the dog stays beside the plush while resting');
  assert.equal(rest.headRest, .82);
  assert.equal(rest.eyeRest, .86);
  assert.equal(rest.propMode, 'slot');
});

test('rope tug attaches to the muzzle and returns to the slot without a positional jump', () => {
  const play = createJourneyDogPlay('rope', 0);
  const beforeGrab = sampleJourneyDogPlay(play, 1_100, { toyOffset: .55 });
  const tugA = sampleJourneyDogPlay(play, 1_700, { toyOffset: .55 });
  const tugB = sampleJourneyDogPlay(play, 2_432, { toyOffset: .55 });
  assert.equal(beforeGrab.phase, 'grab');
  assert.equal(tugA.phase, 'tug');
  assert.equal(tugA.attached, true);
  assert.equal(tugB.attached, true);
  assert.ok(tugA.carryOffsetY >= .54 && tugA.carryOffsetY <= .565);
  assert.notEqual(tugA.propRotation, tugB.propRotation);
  assert.ok(Math.abs(tugB.carryOffsetX - tugA.carryOffsetX) > .01);
  const settled = sampleJourneyDogPlay(play, 3_900, { toyOffset: .55 });
  assert.equal(settled.phase, 'settled');
  assert.equal(settled.dogOffset, 0);
  assert.equal(settled.propOffsetX, 0);
});

test('toy-to-mouth transitions meet at the same screen point', () => {
  const ball = createJourneyDogPlay('starterBall', 0);
  const ballBefore = sampleJourneyDogPlay(ball, 3_186, { toyOffset: .55 }); // progress .569
  const ballAfter = sampleJourneyDogPlay(ball, 3_192, { toyOffset: .55 }); // progress .57, return starts
  assert.equal(ballBefore.propMode, 'offset');
  assert.equal(ballAfter.propMode, 'carried');
  assert.ok(Math.abs((.55 + ballBefore.propOffsetX) - (ballAfter.dogOffset + ballAfter.carryOffsetX)) < .02);
  assert.ok(ballBefore.propLift > .98);

  const rope = createJourneyDogPlay('rope', 0);
  const ropeBefore = sampleJourneyDogPlay(rope, 1_214, { toyOffset: .55 }); // just before the tug begins
  const ropeAfter = sampleJourneyDogPlay(rope, 1_216, { toyOffset: .55 });
  assert.equal(ropeBefore.phase, 'grab');
  assert.equal(ropeBefore.propMode, 'offset');
  assert.equal(ropeAfter.propMode, 'carried');
  const ropeBeforeX = .55 + ropeBefore.propOffsetX;
  const ropeAfterX = ropeAfter.dogOffset + ropeAfter.carryOffsetX;
  assert.ok(Math.abs(ropeBeforeX - ropeAfterX) < .01);
  assert.ok(ropeBefore.propLift > .98);
});

test('bed settling remains bounded and supports reduced motion with finite static output', () => {
  const play = createJourneyDogPlay('bed', Number.POSITIVE_INFINITY, { startDogOffset: .4 });
  const moving = sampleJourneyDogPlay(play, 1_200, { reducedMotion: false });
  assert.equal(moving.phase, 'settling');
  assert.ok(moving.dogOffset < .4 && moving.dogOffset > 0);
  const reduced = sampleJourneyDogPlay(play, Number.NaN, { reducedMotion: true });
  assert.equal(reduced.phase, 'reduced-motion');
  assert.equal(reduced.active, false);
  assert.equal(reduced.dogOffset, .4);
  assert.ok(Object.values(reduced).filter(value => typeof value === 'number').every(Number.isFinite));
});

test('all action samples are deterministic and keep dog offsets inside the home lane', () => {
  for (const itemId of ['bed', 'starterBall', 'plush', 'rope']) {
    const play = createJourneyDogPlay(itemId, 50, { startDogOffset: -.2 });
    for (let time = 0; time <= play.durationMs + 100; time += 37) {
      const first = sampleJourneyDogPlay(play, 50 + time, { toyOffset: .58 });
      const again = sampleJourneyDogPlay(play, 50 + time, { toyOffset: .58 });
      assert.deepEqual(first, again);
      assert.ok(Math.abs(first.dogOffset) <= .55);
      assert.ok(Object.values(first).filter(value => typeof value === 'number').every(Number.isFinite));
    }
  }
  assert.equal(createJourneyDogPlay('plant', 0), null);
  assert.equal(createJourneyDogPlay('toString', 0), null);
  assert.equal(createJourneyDiscoveryReaction({ id: 'prototype-key', kind: 'toString' }), null);
  assert.equal(sampleJourneyDogPlay(null, Number.NaN).active, false);
  assert.equal(sampleJourneyDogPlay(null, Number.NaN, null).active, false);
  assert.equal(sampleJourneyDiscoveryReaction(null, Number.NaN, null).active, false);
});

test('plush and rope approaches keep the photo dog inside a phone-width canvas', () => {
  const plush = createJourneyDogPlay('plush', 0);
  for (let time = 0; time <= plush.durationMs; time += 50) {
    const sample = sampleJourneyDogPlay(plush, time, { toyOffset: .58 });
    assert.ok(sample.dogOffset <= .15, 'the plush approach stops before the right edge clips the dog');
  }

  const rope = createJourneyDogPlay('rope', 0);
  for (let time = 0; time <= rope.durationMs; time += 50) {
    const sample = sampleJourneyDogPlay(rope, time, { toyOffset: .58 });
    assert.ok(sample.dogOffset <= .185, 'rope tug sway stays within the portrait-safe right offset');
  }
});

test('discovery reactions select nose, ears, gaze and step cues by discovery kind', () => {
  const expected = {
    scent: sample => sample.headRest > 0,
    animal: sample => sample.earLeft > 0 && sample.earRight > 0,
    water: sample => sample.step > 0 && sample.pawAdjust > 0,
    light: sample => sample.headLift > 0,
    object: sample => sample.headRest > 0 && sample.pawAdjust > 0,
  };
  for (const [kind, hasCue] of Object.entries(expected)) {
    const reaction = createJourneyDiscoveryReaction({ id: `test-${kind}`, kind, lane: -1 }, 300);
    assert.ok(reaction);
    const sample = sampleJourneyDiscoveryReaction(reaction, 1_200);
    assert.ok(sample.active);
    assert.ok(sample.gazeX < 0 && sample.turn < 0, 'response direction follows the encounter lane');
    assert.ok(hasCue(sample), kind);
    assert.ok(Object.values(sample).filter(value => typeof value === 'number').every(Number.isFinite));
  }
});

test('discovery response reaches a quiet endpoint and reduced motion returns a deterministic glance', () => {
  const reaction = createJourneyDiscoveryReaction({ id: 'waterline', kind: 'water', lane: 1 }, 100);
  assert.equal(createJourneyDiscoveryReaction({ id: 'unknown', kind: 'unmapped' }, 0), null);
  const ended = sampleJourneyDiscoveryReaction(reaction, 5_000);
  assert.equal(ended.active, false);
  assert.equal(ended.step, 0);
  const reduced = sampleJourneyDiscoveryReaction(reaction, 101, { reducedMotion: true });
  assert.equal(reduced.progress, 1);
  assert.equal(reduced.active, true);
  assert.ok(reduced.gazeX > 0 && reduced.pawAdjust > 0);
  assert.ok(Object.values(reduced).filter(value => typeof value === 'number').every(Number.isFinite));
});
