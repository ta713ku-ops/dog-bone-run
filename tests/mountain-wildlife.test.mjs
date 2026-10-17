import test from 'node:test';
import assert from 'node:assert/strict';
import { MOUNTAIN_WILDLIFE, drawMountainWildlife, sampleWildlifeMotion } from '../src/mountain-wildlife.js';
import { projectStreet } from '../src/street-camera.js';

function createRenderer({ width = 390, height = 844, reducedMotion = false } = {}) {
  const calls = [];
  const record = name => (...args) => calls.push([name, ...args]);
  const ctx = {
    globalAlpha: 1,
    save: record('save'), restore: record('restore'), beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'), quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'), translate: record('translate'), scale: record('scale'),
    rotate: record('rotate'), fill: record('fill'), stroke: record('stroke'), fillRect: record('fillRect'),
    ellipse: record('ellipse'), arc: record('arc'), clip: record('clip'),
  };
  return {
    width, height, reducedMotion, trailBend: 0, ctx, calls,
    ellipse(...args) { calls.push(['ellipse', ...args]); },
    path(...args) { calls.push(['path', ...args]); },
  };
}

test('wildlife is immutable, world-positioned and stays beyond the mountain trail', () => {
  assert.ok(Object.isFrozen(MOUNTAIN_WILDLIFE));
  assert.ok(MOUNTAIN_WILDLIFE.length >= 18);
  const kinds = new Set(MOUNTAIN_WILDLIFE.map(item => item.kind));
  assert.deepEqual([...kinds].sort(), ['bird', 'butterfly', 'deer', 'dragonfly', 'fox', 'frog', 'rabbit', 'squirrel']);
  for (const animal of MOUNTAIN_WILDLIFE) {
    assert.ok(Object.isFrozen(animal), `${animal.id} metadata is immutable`);
    for (const value of [animal.lane, animal.at, animal.width, animal.depth, animal.height, animal.elevation])
      assert.ok(Number.isFinite(value), `${animal.id} has finite world metadata`);
    assert.ok(Math.abs(animal.lane) - animal.width / 2 > 1.86,
      `${animal.id} body stays outside the path boundary`);
    for (let timeMs = 0; timeMs <= 30_000; timeMs += 500) {
      const motion = sampleWildlifeMotion(animal, timeMs);
      assert.ok(Math.abs(animal.lane + motion.laneOffset) - animal.width / 2 > 1.86,
        `${animal.id} motion stays outside the path at ${timeMs}ms`);
    }
  }
});

test('each mountain section has an identifiable wildlife encounter in the 390px view', () => {
  for (const [seconds, section] of [[4, 'trailhead'], [12, 'deep-forest'], [20, 'stream'], [27, 'ridge']]) {
    const travel = seconds * 1.25;
    const visible = MOUNTAIN_WILDLIFE.filter(item => item.section === section && item.at - travel >= 1.2 && item.at - travel <= 7);
    const readable=visible.filter(item=>{
      const p=projectStreet(390,844,item.lane,item.at-travel,item.elevation),unit=390*.235*p.scale;
      return p.x-item.width*unit/2>=0&&p.x+item.width*unit/2<=390&&item.height*unit>=16;
    });
    assert.ok(readable.some(item => ['deer', 'fox', 'rabbit', 'squirrel', 'frog'].includes(item.kind)),
      `${section} includes a complete identifiable animal at ${seconds}s`);
  }
  assert.ok(MOUNTAIN_WILDLIFE.some(item => item.kind === 'frog' && item.section === 'stream'));
  assert.ok(MOUNTAIN_WILDLIFE.some(item => item.kind === 'dragonfly' && item.section === 'stream'));
  assert.ok(MOUNTAIN_WILDLIFE.some(item => item.kind === 'bird'));
  assert.ok(MOUNTAIN_WILDLIFE.some(item => item.kind === 'butterfly'));
});

test('pose changes crossfade continuously and all local motion remains bounded', () => {
  const deer = { kind: 'deer', behavior: 'deer', animationOffset: 0 };
  const samples = [2_990, 3_020, 3_260, 3_500, 6_760, 7_000, 7_190, 7_210]
    .map(timeMs => sampleWildlifeMotion(deer, timeMs));
  for (const sample of samples) {
    assert.ok(sample.poseMix >= 0 && sample.poseMix <= 1);
    assert.ok(Math.abs(sample.laneOffset) <= .016);
    assert.equal(sample.elevationOffset, 0);
  }
  assert.ok(samples[1].poseMix > 0 && samples[1].poseMix < .1);
  assert.ok(samples[2].poseMix > .45 && samples[2].poseMix < .55);
  assert.ok(samples[3].poseMix > .9 && samples[3].poseMix < 1);
  assert.ok(samples[6].poseMix < .1, 'return transition reaches the resting pose smoothly');
  assert.ok(Math.abs(samples[6].poseMix - samples[7].poseMix) < .03,
    'the animation wraps without a visible pose jump');

  const rabbit = { kind: 'rabbit', behavior: 'rabbit', animationOffset: 0 };
  const jumps = Array.from({ length: 100 }, (_, index) => sampleWildlifeMotion(rabbit, index * 100).elevationOffset);
  assert.ok(Math.max(...jumps) <= .13);
  assert.ok(Math.max(...jumps) < .14, 'the in-place hop stays below four screen pixels at encounter scale');
  assert.equal(sampleWildlifeMotion(rabbit, 2_000, true).elevationOffset, 0);
});

test('reduced motion freezes pose and placement, while fixed paused game time is deterministic', () => {
  const fox = MOUNTAIN_WILDLIFE.find(item => item.id === 'forest-fox');
  assert.deepEqual(sampleWildlifeMotion(fox, 1_500, true), sampleWildlifeMotion(fox, 25_000, true));
  assert.deepEqual(sampleWildlifeMotion(fox, 9_100), sampleWildlifeMotion(fox, 9_100));

  const first = createRenderer({ reducedMotion: true });
  const second = createRenderer({ reducedMotion: true });
  drawMountainWildlife(first, fox, 3.5, 4_300);
  drawMountainWildlife(second, fox, 3.5, 28_000);
  assert.deepEqual(first.calls, second.calls, 'world travel can continue while local wildlife motion is frozen');
});

test('draw uses the shared world projection and falls back to detailed Canvas animals', () => {
  const renderer = createRenderer();
  for (const animal of MOUNTAIN_WILDLIFE) {
    const before = renderer.calls.length;
    assert.equal(drawMountainWildlife(renderer, animal, 3.25, 1_200), true, animal.id);
    const calls = renderer.calls.slice(before);
    assert.ok(calls.some(call => call[0] === 'path' || call[0] === 'ellipse'), `${animal.id} has a visible fallback`);
  }
  assert.equal(drawMountainWildlife(renderer, { kind: 'unknown', lane: 3 }, 2), false);
  assert.equal(drawMountainWildlife(renderer, MOUNTAIN_WILDLIFE[0], NaN), false);

  const animal = MOUNTAIN_WILDLIFE.find(item => item.id === 'forest-deer');
  const timeMs = (3.27 - animal.animationOffset) * 1_000;
  const motion = sampleWildlifeMotion(animal, timeMs);
  const distance = 4.1;
  const expected = projectStreet(390, 844, animal.lane + motion.laneOffset, distance,
    animal.elevation + motion.elevationOffset, 0);
  const atlasCalls = [];
  const art = { drawAnimal(r, kind, pose, bounds) { atlasCalls.push({ kind, pose, bounds }); return true; } };
  const atlasRenderer = createRenderer();
  assert.equal(drawMountainWildlife(atlasRenderer, animal, distance, timeMs, art), true);
  assert.deepEqual(atlasCalls.map(call => call.kind), ['deer', 'deer']);
  assert.deepEqual(atlasCalls.map(call => call.pose), [0, 1], 'two atlas poses crossfade instead of switching abruptly');
  assert.ok(Math.abs(atlasCalls[0].bounds.alpha + atlasCalls[1].bounds.alpha - 1) < 1e-9);
  assert.ok(Math.abs(atlasCalls[0].bounds.x - expected.x) < 1e-9);
  assert.ok(Math.abs(atlasCalls[0].bounds.y - expected.y) < 1e-9);
  assert.ok(atlasCalls[0].bounds.height > 45, 'deer remains visibly sized at the planned encounter distance');
});
