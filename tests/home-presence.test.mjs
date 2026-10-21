import test from 'node:test';
import assert from 'node:assert/strict';
import { homeDogLayout, HOME_ATTENTION_MS, sampleHomeAttention } from '../src/home-presence.js';
import { sampleHome } from '../src/sprite-animation.js';
import { Renderer } from '../src/render.js';

const frameCounts = { sitdown: 48, liedown: 48, greet: 32, tiltleft: 32, tiltright: 32 };
function rendererAt(time, heldFrame = null) {
  return Object.assign(Object.create(Renderer.prototype), {
    dogs: { stats: { animationReady: true, continuityReady: true, homeMotionReady: true, homeFrameCounts: frameCounts } },
    lastDrawState: 'ready', menuElapsedMs: time, homeClockOffset: 0,
    homeInteraction: null, homeAttention: null, homeStillPose: null, homeHeldFrame: heldFrame,
    reducedMotion: false, systemReducedMotion: false,
    canvas: { closest: () => ({ dataset: {} }) },
  });
}

test('touch response keeps the exact posture, including mid-transition, and resumes its suspended timeline', () => {
  for (const time of [0, 17500, 25000, 32000, 40000, 50500]) {
    const r = rendererAt(time), before = r.updateHomeSample(time);
    assert.equal(r.homeRespond(), true);
    assert.equal(r.homeRespond(), false, 'rapid taps cannot queue responses');
    assert.equal(r.homeGesture('lie'), false, 'posture commands cannot interrupt the response');
    for (const age of [0, 240, 650, 1100, 1750, HOME_ATTENTION_MS - 1]) {
      const sample = r.updateHomeSample(time + age);
      assert.deepEqual(sample.layers, before.layers, `pose changed at ${time}+${age}`);
      if (age === 1100) assert.ok(sample.headLift > (before.headLift ?? 0));
    }
    const after = r.updateHomeSample(time + HOME_ATTENTION_MS);
    assert.deepEqual(after, before, 'entry and exit meet the same idle sample');
    assert.equal(r.homeBusy, false);
    assert.deepEqual(r.updateHomeSample(time + HOME_ATTENTION_MS + 80),
      sampleHome(time + 80, { continuousMotion: true, frameCounts, detailedMotion: true, seed: 42, heldFrame: null, interaction: null }));
  }
});

test('touch response preserves a manually held pose and turning motion off settles without rewinding the posture', () => {
  const held = sampleHome(40000, { continuousMotion: true, frameCounts });
  const r = rendererAt(25000, held);
  r.homeRespond(); r.menuElapsedMs += 900;
  const responding = r.updateHomeSample(r.menuElapsedMs);
  r.setReducedMotion(true);
  const still = r.updateHomeSample(r.menuElapsedMs);
  assert.deepEqual(still.layers, responding.layers);
  assert.equal(still.headLift, 0);
  assert.equal(r.homeBusy, false);
  assert.deepEqual(r.updateHomeSample(r.menuElapsedMs + 12000), still);
  assert.equal(r.homeRespond(), true);
  assert.equal(r.homeAttention, null);
});

test('local motion is continuous, bounded and does not mutate the base image sample', () => {
  const base = sampleHome(25000, { continuousMotion: true, frameCounts });
  const original = structuredClone(base);
  let prior = sampleHomeAttention(base, 0);
  for (let age = 1; age <= HOME_ATTENTION_MS; age++) {
    const next = sampleHomeAttention(base, age);
    for (const field of ['headLift', 'headAngle', 'earLeft', 'earRight', 'blink', 'breath']) {
      assert.ok(Math.abs((next[field] ?? 0) - (prior[field] ?? 0)) < .02, `${field} jumped at ${age}`);
    }
    assert.equal(next.layers, base.layers);
    prior = next;
  }
  assert.deepEqual(base, original);
  assert.equal(sampleHomeAttention(base, 800, true), base);
});

test('the dog and its touch bounds stay inside narrow, short, landscape and desktop scenes', () => {
  for (const [w, h] of [[320,480],[320,568],[390,844],[430,932],[480,390],[476,668]]) {
    const { touch, size, foot } = homeDogLayout(w,h);
    assert.ok(touch.width >= 44 && touch.height >= 44);
    assert.ok(touch.left >= 0 && touch.top >= 0);
    assert.ok(touch.left + touch.width <= w);
    assert.ok(touch.top + touch.height < h * .70);
    assert.ok(size > 0 && foot === h * .63);
  }
});
