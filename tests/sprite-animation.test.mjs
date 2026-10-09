import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_CYCLE_MS, homeInteractionDuration, sampleHome, sampleWalk } from '../src/sprite-animation.js';

function layersOf(sample) {
  if (Array.isArray(sample.layers)) return sample.layers;
  const mix = Number.isFinite(sample.mix) ? Math.min(1, Math.max(0, sample.mix)) : 0;
  const nextAtlas = sample.nextAtlas ?? sample.atlas;
  const layers = [
    { atlas: sample.atlas, index: sample.index, weight: 1 - mix },
    { atlas: nextAtlas, index: sample.nextIndex, weight: mix },
  ].filter(layer => layer.weight > 0);
  return layers;
}

function assertNormalizedLayers(sample) {
  const layers = layersOf(sample);
  assert.ok(layers.length > 0);
  for (const layer of layers) {
    assert.ok(Number.isInteger(layer.index) && layer.index >= 0);
    assert.ok(Number.isFinite(layer.weight) && layer.weight >= 0 && layer.weight <= 1);
  }
  assert.ok(Math.abs(layers.reduce((sum, layer) => sum + layer.weight, 0) - 1) < 1e-10);
}

function assertNaturalDetailedSample(sample) {
  assert.equal(sample.natural, true);
  assert.ok(Number.isFinite(sample.blink) && sample.blink >= 0 && sample.blink <= 1);
  assert.ok(Number.isFinite(sample.breath) && sample.breath >= -1 && sample.breath <= 1);
  for (const atlas of [sample.atlas, sample.nextAtlas]) {
    if (atlas !== undefined) {
      assert.ok(!['expressions', 'postures'].includes(atlas),
        `detailed frame never uses legacy atlas ${atlas}`);
    }
  }
  for (const layer of layersOf(sample)) {
    assert.ok(!['expressions', 'postures'].includes(layer.atlas),
      `detailed output never uses legacy atlas ${layer.atlas}`);
  }
  assertNormalizedLayers(sample);
}

function assertContinuousClip(atlas, startMs, endMs, { reverse = false } = {}) {
  const positions = [];
  const indices = new Set();
  for (let time = startMs; time <= endMs; time += 25) {
    const sample = sampleHome(time, { detailedMotion: true });
    assert.equal(sample.atlas, atlas, `${atlas} is active at ${time}ms`);
    assert.ok(sample.index <= sample.nextIndex);
    assert.ok(sample.mix >= 0 && sample.mix < 1);
    positions.push(sample.index + sample.mix);
    indices.add(sample.index);
    indices.add(sample.nextIndex);
  }

  assert.ok(indices.size > 8, `${atlas} visits more than eight distinct image indices`);
  for (let index = 1; index < positions.length; index += 1) {
    const delta = positions[index] - positions[index - 1];
    assert.ok(reverse ? delta < 0 : delta > 0, `${atlas} advances continuously at sample ${index}`);
    assert.ok(Math.abs(delta) < 2, `${atlas} has no frozen step followed by a large jump`);
  }
}

test('walk sampling follows distance through one cyclic clip', () => {
  const strideLength = 0.78;
  const frameCount = 8;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const result = sampleWalk({ distance: strideLength * frame / frameCount, strideLength, frameCount });
    assert.equal(result.index, frame);
    assert.equal(result.nextIndex, (frame + 1) % frameCount);
    assert.equal(result.mix, 0);
    assert.ok(Math.abs(result.phase - frame / frameCount) < 1e-12);
  }

  const beforeWrap = sampleWalk({ distance: strideLength - 1e-7, strideLength, frameCount });
  const afterWrap = sampleWalk({ distance: strideLength + 1e-7, strideLength, frameCount });
  assert.equal(beforeWrap.index, frameCount - 1);
  assert.equal(beforeWrap.nextIndex, 0);
  assert.ok(beforeWrap.mix > 0.999);
  assert.equal(afterWrap.index, 0);
  assert.equal(afterWrap.nextIndex, 1);
  assert.ok(afterWrap.mix < 0.001);
  assert.equal(sampleWalk({ distance: strideLength * 4, strideLength, frameCount }).index, 0);
});

test('walk input guards handle negative, non-finite, and degenerate values', () => {
  const negative = sampleWalk({ distance: -0.78 / 8 });
  assert.equal(negative.index, 7);
  assert.equal(negative.nextIndex, 0);
  assert.equal(negative.phase, 0.875);

  for (const distance of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(sampleWalk({ distance }), { index: 0, nextIndex: 1, mix: 0, phase: 0 });
  }

  for (const options of [
    { distance: 0.2, strideLength: 0 },
    { distance: 0.2, strideLength: Number.NaN },
    { distance: 0.2, frameCount: 0 },
    { distance: 0.2, frameCount: Number.POSITIVE_INFINITY },
  ]) {
    const result = sampleWalk(options);
    for (const value of Object.values(result)) assert.ok(Number.isFinite(value));
    assert.ok(result.index >= 0 && result.index < 8);
    assert.ok(result.nextIndex >= 0 && result.nextIndex < 8);
  }

  assert.deepEqual(sampleWalk({ distance: 9, reducedMotion: true }), { index: 0, nextIndex: 0, mix: 0, phase: 0 });
  assert.deepEqual(sampleWalk({ distance: 9, frameCount: 1 }), { index: 0, nextIndex: 0, mix: 0, phase: 0 });
  assert.deepEqual(sampleWalk(null), sampleWalk());
});

test('home cycle reaches sitting and lying poses through authored transition steps', () => {
  assert.equal(HOME_CYCLE_MS, 36_000);
  assert.deepEqual(sampleHome(0), {
    atlas: 'expressions', index: 0, nextIndex: 0, mix: 0, action: 'stand-idle',
  });

  const sitBlend = sampleHome(8_340);
  assert.equal(sitBlend.atlas, 'postures');
  assert.equal(sitBlend.index, 0);
  assert.equal(sitBlend.nextIndex, 1);
  assert.equal(sitBlend.mix, 0.5);
  assert.equal(sampleHome(9_200).index, 3);
  assert.equal(sampleHome(9_200).action, 'fully-sitting');

  const lieBlend = sampleHome(17_540);
  assert.equal(lieBlend.index, 3);
  assert.equal(lieBlend.nextIndex, 6);
  assert.equal(lieBlend.mix, 0.5);
  assert.equal(sampleHome(18_400).index, 8);

  const sleeping = sampleHome(25_800);
  assert.equal(sleeping.index, 8);
  assert.equal(sleeping.nextIndex, 10);
  assert.equal(sleeping.mix, 0.5);
  assert.equal(sampleHome(31_800).index, 8, 'sleep settles back to the head-up pose before rising');

  const lieReverse = sampleHome(33_940);
  assert.equal(lieReverse.index, 8);
  assert.equal(lieReverse.nextIndex, 7);
  assert.equal(lieReverse.mix, 0.5);
  const standReverse = sampleHome(35_140);
  assert.equal(standReverse.index, 3);
  assert.equal(standReverse.nextIndex, 2);
  assert.equal(standReverse.mix, 0.5);
  assert.equal(sampleHome(HOME_CYCLE_MS).atlas, 'expressions');
  assert.equal(sampleHome(HOME_CYCLE_MS).index, 0);
});

test('home expressions and short posture gestures use brief blends', () => {
  const blink = sampleHome(1_935);
  assert.equal(blink.atlas, 'expressions');
  assert.equal(blink.index, 0);
  assert.equal(blink.nextIndex, 1);
  assert.equal(blink.mix, 0.5);

  const headTilt = sampleHome(3_280);
  assert.equal(headTilt.index, 0);
  assert.equal(headTilt.nextIndex, 3);
  assert.equal(headTilt.mix, 0.5);

  const seatedPaw = sampleHome(13_890);
  assert.equal(seatedPaw.atlas, 'postures');
  assert.equal(seatedPaw.index, 3);
  assert.equal(seatedPaw.nextIndex, 5);
  assert.equal(seatedPaw.mix, 0.5);
});

test('reduced motion keeps home on one stable neutral frame', () => {
  const stable = { atlas: 'expressions', index: 0, nextIndex: 0, mix: 0, action: 'stand-idle' };
  for (const timeMs of [0, 1_900, 8_500, 18_900, 33_900, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(sampleHome(timeMs, { reducedMotion: true, interaction: { action: 'lie', startedAt: 0 } }), stable);
  }
  assert.deepEqual(sampleHome(-1), sampleHome(0));
  assert.deepEqual(sampleHome(1_000, null), sampleHome(1_000));
});

test('a finite interaction reverses to the original idle state and resumes the cycle', () => {
  const interaction = { action: 'sit', startedAt: 0 };
  assert.equal(homeInteractionDuration('sit'), 4_600);
  assert.equal(homeInteractionDuration('lie'), 7_000);
  assert.equal(homeInteractionDuration('greet'), 1_600);
  assert.equal(homeInteractionDuration('unknown'), 0);

  const justBeforeEnd = sampleHome(4_599, { interaction });
  assert.equal(justBeforeEnd.atlas, 'postures');
  assert.equal(justBeforeEnd.nextAtlas, 'expressions');
  assert.equal(justBeforeEnd.index, 0);
  assert.equal(justBeforeEnd.nextIndex, 0);
  assert.ok(justBeforeEnd.mix > 0.99);

  const complete = sampleHome(4_600, { interaction });
  assert.equal(complete.atlas, 'expressions');
  assert.equal(complete.index, 0);
  assert.equal(complete.action, 'stand-idle');
  assert.deepEqual(sampleHome(4_610, { interaction }), sampleHome(10, { interaction: null }));

  const greet = { action: 'greet', startedAt: 0 };
  const greetEnter = sampleHome(100, { interaction: greet });
  assert.equal(greetEnter.index, 0);
  assert.equal(greetEnter.nextIndex, 5);
  assert.equal(greetEnter.mix, 0.5);
  const greetExit = sampleHome(1_500, { interaction: greet });
  assert.equal(greetExit.index, 5);
  assert.equal(greetExit.nextIndex, 0);
  assert.equal(greetExit.mix, 0.5);
  const greetComplete = sampleHome(1_600, { interaction: greet });
  assert.equal(greetComplete.atlas, 'expressions');
  assert.equal(greetComplete.index, 0);
  assert.deepEqual(greetComplete.layers, [{ atlas: 'expressions', index: 0, weight: 1 }]);
});

test('interaction crossfades preserve a blended anchor across expression and posture atlases', () => {
  const cases = [
    {
      startedAt: 3_280,
      atlas: 'expressions',
      expected: [
        { atlas: 'expressions', index: 0, weight: 0.5 },
        { atlas: 'expressions', index: 3, weight: 0.5 },
      ],
    },
    {
      startedAt: 8_340,
      atlas: 'postures',
      expected: [
        { atlas: 'postures', index: 0, weight: 0.5 },
        { atlas: 'postures', index: 1, weight: 0.5 },
      ],
    },
  ];

  for (const { startedAt, atlas, expected } of cases) {
    const interaction = { action: 'greet', startedAt };
    const anchor = sampleHome(startedAt);
    assert.equal(anchor.mix, 0.5);

    const entry = sampleHome(startedAt, { interaction });
    assert.equal(entry.action, 'interaction-greet-enter');
    assert.deepEqual(entry.layers, expected, 'zero-time interaction layers equal the complete anchor blend');

    const nearExit = sampleHome(startedAt + homeInteractionDuration('greet') - 1, { interaction });
    assert.ok(nearExit.layers.length <= 3);
    assert.ok(Math.abs(nearExit.layers.reduce((sum, layer) => sum + layer.weight, 0) - 1) < 1e-12);
    assert.ok(nearExit.layers.some(layer => layer.atlas === atlas && layer.index === expected[0].index));

    const exit = sampleHome(startedAt + homeInteractionDuration('greet'), { interaction });
    assert.deepEqual(exit.layers, expected, 'completed interaction converges to the complete anchor blend');
  }
});

test('detailed seated and lying greetings keep their exact anchor and add only small attention', () => {
  for (const startedAt of [10_000, 20_000]) {
    const interaction = { action: 'greet', startedAt };
    const anchor = sampleHome(startedAt, { detailedMotion: true });
    const anchorLayers = layersOf(anchor);
    const anchorPose = [anchor.atlas, anchor.index, anchor.nextAtlas, anchor.nextIndex, anchor.mix];
    let sawAttention = false;

    for (let elapsed = 0; elapsed <= homeInteractionDuration('greet'); elapsed += 50) {
      const sample = sampleHome(startedAt + elapsed, { detailedMotion: true, interaction });
      assertNaturalDetailedSample(sample);
      assert.deepEqual(layersOf(sample), anchorLayers, 'greeting retains every exact anchor layer');
      assert.deepEqual([sample.atlas, sample.index, sample.nextAtlas, sample.nextIndex, sample.mix], anchorPose,
        'greeting never swaps the whole pose');
      if (elapsed < homeInteractionDuration('greet')) {
        assert.ok(Number.isFinite(sample.attention));
        assert.ok(Math.abs(sample.attention) <= 0.18);
        if (Math.abs(sample.attention) > 0.1) sawAttention = true;
      }
    }
    assert.ok(sawAttention, 'the local attention cue is visible during the greeting');
  }
});

test('detailed automatic posture clips visit dense, continuously interpolated images in both directions', () => {
  assertContinuousClip('sitdown', 8_130, 9_060);
  assertContinuousClip('liedown', 17_330, 18_260);
  assertContinuousClip('liedown', 33_730, 34_670, { reverse: true });
  assertContinuousClip('sitdown', 34_930, 35_850, { reverse: true });

  assert.equal(sampleHome(10_100, { detailedMotion: true }).atlas, 'sitdown');
  assert.equal(sampleHome(10_100, { detailedMotion: true }).index, 15);
  assert.equal(sampleHome(19_400, { detailedMotion: true }).atlas, 'liedown');
  assert.equal(sampleHome(19_400, { detailedMotion: true }).index, 15);
});

test('detailed standing greeting uses its full clip while standing rests on the canonical frame', () => {
  for (const time of [0, 2_700, 4_100, 5_620, 7_300, 7_800]) {
    const sample = sampleHome(time, { detailedMotion: true });
    assert.equal(sample.atlas, 'sitdown');
    assert.equal(sample.index, 0);
    assert.equal(sample.nextIndex, 0);
  }

  const interaction = { action: 'greet', startedAt: 0 };
  const forward = [];
  const backward = [];
  for (let time = 130; time <= 770; time += 25) {
    const sample = sampleHome(time, { detailedMotion: true, interaction });
    assert.equal(sample.atlas, 'greet');
    forward.push(sample.index + sample.mix);
  }
  for (let time = 830; time <= 1_470; time += 25) {
    const sample = sampleHome(time, { detailedMotion: true, interaction });
    assert.equal(sample.atlas, 'greet');
    backward.push(sample.index + sample.mix);
  }
  assert.ok(new Set(forward.map(Math.floor)).size > 8);
  assert.ok(forward.at(-1) > forward[0]);
  assert.ok(backward.at(-1) < backward[0]);
  assert.equal(sampleHome(1_650, { detailedMotion: true, interaction }).atlas, 'sitdown');
});

test('detailed automatic paw greeting traverses greet frames and blends back to neutral', () => {
  const forward = [];
  const backward = [];
  for (let time = 5_780; time <= 6_440; time += 20) {
    const sample = sampleHome(time, { detailedMotion: true });
    assert.equal(sample.atlas, 'greet');
    assert.equal(sample.action, 'paw-lift');
    forward.push(sample.index + sample.mix);
  }
  for (let time = 6_480; time <= 7_120; time += 20) {
    const sample = sampleHome(time, { detailedMotion: true });
    assert.equal(sample.atlas, 'greet');
    backward.push(sample.index + sample.mix);
  }

  assert.ok(new Set(forward.map(Math.floor)).size > 8);
  assert.ok(forward.at(-1) > forward[0]);
  assert.ok(backward.at(-1) < backward[0]);

  const startsAtNeutral = sampleHome(5_650, { detailedMotion: true });
  const returnsToNeutral = sampleHome(7_250, { detailedMotion: true });
  assert.equal(startsAtNeutral.action, 'paw-lift');
  assert.deepEqual(layersOf(startsAtNeutral), [{ atlas: 'sitdown', index: 0, weight: 1 }]);
  assert.deepEqual(layersOf(returnsToNeutral), [{ atlas: 'sitdown', index: 0, weight: 1 }]);
  assertNormalizedLayers(sampleHome(7_249, { detailedMotion: true }));
  assert.equal(sampleHome(3_500, { detailedMotion: true }).action, 'head-tilt-left');
  assert.equal(sampleHome(6_000).index, 5, 'legacy paw sampling stays on its original image frame');
});

test('detailed blink and rest keep one canonical whole-body pose', () => {
  const seatedTimes = [11_199, 11_200, 11_220, 11_310, 11_420, 11_579, 11_600];
  const lyingTimes = [20_699, 20_700, 20_750, 20_820, 20_900, 23_399, 23_400,
    24_000, 25_699, 25_700, 29_000, 31_700, 31_900];

  for (const [times, atlas] of [[seatedTimes, 'sitdown'], [lyingTimes, 'liedown']]) {
    const samples = times.map(time => sampleHome(time, { detailedMotion: true }));
    const expectedIndex = 15;
    for (const sample of samples) {
      assertNaturalDetailedSample(sample);
      assert.equal(sample.atlas, atlas);
      assert.equal(sample.index, expectedIndex);
      assert.equal(sample.nextIndex, expectedIndex);
      assert.equal(sample.mix, 0);
    }
    for (const sample of samples.slice(1)) {
      assert.deepEqual(layersOf(sample), layersOf(samples[0]), 'blink and rest never change the body image');
    }
  }
});

test('natural blink is a smooth 220ms local pulse only on stationary samples', () => {
  const before = sampleHome(13_500, { detailedMotion: true });
  const closed = sampleHome(13_610, { detailedMotion: true });
  const after = sampleHome(13_720, { detailedMotion: true });
  assert.equal(before.blink, 0);
  assert.equal(closed.blink, 1);
  assert.equal(after.blink, 0);
  assert.deepEqual(layersOf(closed), layersOf(before));
  assert.deepEqual(layersOf(after), layersOf(before));

  for (const time of [3_500, 4_610, 6_000, 8_340]) {
    assert.equal(sampleHome(time, { detailedMotion: true }).blink, 0,
      'moving greeting and sit-down clips keep the localized blink open');
  }
  for (const startedAt of [13_400, 22_400]) {
    const sample = sampleHome(startedAt+210, {detailedMotion:true, interaction:{action:'greet',startedAt}});
    assert.equal(sample.blink, 0, 'attention gestures never cache a shifted eye patch');
  }
  const manualSit = { action: 'sit', startedAt: 12_100 };
  const manualLie = { action: 'lie', startedAt: 10_900 };
  assert.equal(sampleHome(13_500, { detailedMotion: true, interaction: manualSit }).blink, 0);
  assert.equal(sampleHome(13_500, { detailedMotion: true, interaction: manualLie }).blink, 0);
});

test('every detailed automatic and interaction sample is natural and excludes legacy atlases', () => {
  for (let time = 0; time < HOME_CYCLE_MS; time += 25) {
    assertNaturalDetailedSample(sampleHome(time, { detailedMotion: true }));
  }

  for (const action of ['sit', 'lie', 'greet']) {
    for (const startedAt of [0, 8_060, 10_000, 17_260, 20_000, 33_900, 35_000]) {
      const interaction = { action, startedAt };
      const duration = homeInteractionDuration(action);
      for (let elapsed = 0; elapsed <= duration; elapsed += 50) {
        assertNaturalDetailedSample(sampleHome(startedAt + elapsed, {
          detailedMotion: true,
          interaction,
        }));
      }
    }
  }
});

test('natural breathing is bounded, continuous at the cycle edge, and repeats with the 36-second loop', () => {
  const start = sampleHome(0, { detailedMotion: true });
  const nextBreath = sampleHome(4_500, { detailedMotion: true });
  const beforeWrap = sampleHome(HOME_CYCLE_MS - 1, { detailedMotion: true });
  const afterWrap = sampleHome(HOME_CYCLE_MS, { detailedMotion: true });
  assert.ok(Math.abs(start.breath - nextBreath.breath) < 1e-12);
  assert.ok(Math.abs(beforeWrap.breath - afterWrap.breath) < 0.002);
  assert.deepEqual(afterWrap, start);
});

test('detailed clip edges and the 36-second loop blend atlas layers with finite normalized weights', () => {
  for (const timeMs of [8_060, 9_140, 17_260, 18_340, 33_660, 34_740, 34_860, 35_940, 35_999]) {
    const sample = sampleHome(timeMs, { detailedMotion: true });
    assertNormalizedLayers(sample);
  }

  assert.ok(layersOf(sampleHome(8_060, { detailedMotion: true })).every(layer => layer.atlas === 'sitdown'));
  assert.ok(layersOf(sampleHome(9_140, { detailedMotion: true })).some(layer => layer.atlas === 'sitdown'));
  assert.ok(layersOf(sampleHome(17_260, { detailedMotion: true })).some(layer => layer.atlas === 'liedown'));
  assert.ok(layersOf(sampleHome(18_340, { detailedMotion: true })).some(layer => layer.atlas === 'liedown'));

  const beforeWrap = layersOf(sampleHome(HOME_CYCLE_MS - 1, { detailedMotion: true }));
  assert.ok(beforeWrap.every(layer => layer.atlas === 'sitdown'));
  assert.deepEqual(sampleHome(HOME_CYCLE_MS, { detailedMotion: true }),
    sampleHome(0, { detailedMotion: true }));
});

test('detailed manual sit and lie play generated clips forward, reverse, and return to complete anchors', () => {
  const sit = { action: 'sit', startedAt: 0 };
  const sitOutA = sampleHome(500, { detailedMotion: true, interaction: sit });
  const sitOutB = sampleHome(800, { detailedMotion: true, interaction: sit });
  assert.equal(sitOutA.atlas, 'sitdown');
  assert.equal(sitOutB.atlas, 'sitdown');
  assert.ok(sitOutB.index + sitOutB.mix > sitOutA.index + sitOutA.mix);
  assert.equal(sampleHome(1_650, { detailedMotion: true, interaction: sit }).atlas, 'sitdown');
  assert.equal(sampleHome(1_650, { detailedMotion: true, interaction: sit }).index, 15);
  const sitReturnA = sampleHome(3_500, { detailedMotion: true, interaction: sit });
  const sitReturnB = sampleHome(4_000, { detailedMotion: true, interaction: sit });
  assert.equal(sitReturnA.atlas, 'sitdown');
  assert.equal(sitReturnB.atlas, 'sitdown');
  assert.ok(sitReturnB.index + sitReturnB.mix < sitReturnA.index + sitReturnA.mix);
  assert.deepEqual(layersOf(sampleHome(4_600, { detailedMotion: true, interaction: sit })),
    [{ atlas: 'sitdown', index: 0, weight: 1 }]);

  const lie = { action: 'lie', startedAt: 0 };
  const lieOutA = sampleHome(800, { detailedMotion: true, interaction: lie });
  const lieOutB = sampleHome(2_000, { detailedMotion: true, interaction: lie });
  assert.equal(lieOutA.atlas, 'sitdown');
  assert.equal(lieOutB.atlas, 'liedown');
  assert.equal(sampleHome(2_750, { detailedMotion: true, interaction: lie }).atlas, 'liedown');
  assert.equal(sampleHome(2_750, { detailedMotion: true, interaction: lie }).index, 15);
  const lieReturnA = sampleHome(4_900, { detailedMotion: true, interaction: lie });
  const lieReturnB = sampleHome(6_100, { detailedMotion: true, interaction: lie });
  assert.equal(lieReturnA.atlas, 'liedown');
  assert.equal(lieReturnB.atlas, 'sitdown');
  assert.deepEqual(layersOf(sampleHome(7_000, { detailedMotion: true, interaction: lie })),
    [{ atlas: 'sitdown', index: 0, weight: 1 }]);
});

test('detailed interactions preserve every partial anchor layer and restore it with normalized weights', () => {
  const cases = [
    { action: 'greet', startedAt: 8_060 },
    { action: 'lie', startedAt: 8_060 },
    { action: 'greet', startedAt: 17_260 },
  ];

  for (const interaction of cases) {
    const options = { detailedMotion: true, interaction };
    const anchor = layersOf(sampleHome(interaction.startedAt, { detailedMotion: true }));
    assert.ok(anchor.length > 1, 'each chosen start time has a partial atlas blend');

    const entry = sampleHome(interaction.startedAt, options);
    assert.deepEqual(layersOf(entry), anchor, 'entry starts with every original anchor layer');
    assertNormalizedLayers(entry);

    const nearExit = sampleHome(interaction.startedAt + homeInteractionDuration(interaction.action) - 1, options);
    assertNormalizedLayers(nearExit);
    for (const layer of anchor) {
      assert.ok(layersOf(nearExit).some(candidate => candidate.atlas === layer.atlas
        && candidate.index === layer.index && candidate.weight > 0),
      `exit retains anchor layer ${layer.atlas}:${layer.index}`);
    }

    const exit = sampleHome(interaction.startedAt + homeInteractionDuration(interaction.action), options);
    assert.deepEqual(layersOf(exit), anchor, 'completed interaction resumes from the complete paused anchor');
    assertNormalizedLayers(exit);
  }
});

test('detailed mode guards invalid clocks, remains stable for reduced motion, and leaves fallback unchanged', () => {
  const stable = { atlas: 'expressions', index: 0, nextIndex: 0, mix: 0, action: 'stand-idle' };
  for (const timeMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const sample = sampleHome(timeMs, { detailedMotion: true });
    for (const value of [sample.index, sample.nextIndex, sample.mix]) assert.ok(Number.isFinite(value));
    assertNaturalDetailedSample(sample);
    assert.deepEqual(sampleHome(timeMs, { detailedMotion: true, reducedMotion: true,
      interaction: { action: 'greet', startedAt: 0 } }), stable);
  }

  assert.deepEqual(sampleHome(500, { detailedMotion: true,
    interaction: { action: 'sit', startedAt: Number.NaN } }), sampleHome(500, { detailedMotion: true }));
  for (const timeMs of [0, 3_300, 8_340, 17_540, 25_800, 33_940, 35_140, 36_000]) {
    assert.deepEqual(sampleHome(timeMs, { detailedMotion: false }), sampleHome(timeMs));
  }
  assert.deepEqual(sampleHome(1_000, { distance: 10, detailedMotion: true }),
    sampleHome(1_000, { detailedMotion: true }));
});

test('both head tilts retain dense frames and return to the canonical neutral',()=>{
 for(const [atlas,start,end] of [['tiltleft',2800,4000],['tiltright',4400,5600]]){
  const frames=new Set();
  for(let t=start;t<end;t+=10){const s=sampleHome(t,{detailedMotion:true});assert.equal(s.blink,0);for(const l of layersOf(s))if(l.atlas===atlas)frames.add(l.index);}
  assert.ok(frames.size>=14);
  assert.deepEqual(layersOf(sampleHome(end,{detailedMotion:true})),[{atlas:'sitdown',index:0,weight:1}]);
 }
});
