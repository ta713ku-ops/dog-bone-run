import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipRoadBounds, compositedLuminanceDelta, deriveVisualSeed, ROAD_COMFORT_FLAGS,
  roadReferenceDistance, RoadComfortTracker, shouldKeepRoadDecoration, stableHash32,
} from '../src/road-comfort.js';
import { AdventureScene } from '../src/adventure-scene.js';
import { CONFIG } from '../src/config.js';
import { Renderer } from '../src/render.js';

test('visual hash is stable, independent of gameplay seed, and decoration modes are nested', () => {
  assert.equal(stableHash32('oak:12'), stableHash32('oak:12'));
  assert.notEqual(deriveVisualSeed(11), deriveVisualSeed(12));
  const kept = Object.fromEntries(['standard', 'modest', 'minimal'].map(mode => [mode,
    Array.from({ length: 2_000 }, (_, index) => `flower:${index}`)
      .filter(objectId => shouldKeepRoadDecoration({ visualSeed: 81, objectId, mode })),
  ]));
  assert.ok(kept.minimal.length < kept.modest.length && kept.modest.length < kept.standard.length);
  assert.ok(kept.modest.length > 900 && kept.modest.length < 1_100);
  const standard = new Set(kept.standard), modest = new Set(kept.modest), minimal = new Set(kept.minimal);
  assert.ok([...modest].every(id => standard.has(id)));
  assert.ok([...minimal].every(id => modest.has(id)));
  assert.ok(!shouldKeepRoadDecoration({ visualSeed: 1, objectId: 'tuft', mode: 'standard', near: true, flags: { ...ROAD_COMFORT_FLAGS, nearDecorations: false } }));
  assert.ok(shouldKeepRoadDecoration({ visualSeed: 1, objectId: 'sign', mode: 'minimal', near: true, essential: true, flags: { ...ROAD_COMFORT_FLAGS, nearDecorations: false } }));
});

test('bounds use clipped CSS pixels and the bottom 40% begins at exactly 0.60 of canvas height', () => {
  assert.deepEqual(clipRoadBounds({ left: -5, top: 300, right: 20, bottom: 600 }, 320, 568), {
    left: 0, top: 300, right: 20, bottom: 568,
  });
  assert.equal(clipRoadBounds({ left: 3, top: 568, right: 20, bottom: 580 }, 320, 568), null);

  const tracker = new RoadComfortTracker();
  tracker.beginFrame({ width: 320, height: 568, distance: 0, activeMs: 0, state: 'running' });
  tracker.record({ objectId: 'edge', generation: 4, category: 'road_stone', bounds: { x: 10, y: 340.7, width: 5, height: 4 } });
  tracker.record({ objectId: 'above', category: 'road_flower', bounds: { x: 10, y: 340, width: 5, height: .5 } });
  tracker.record({ objectId: 'transparent', category: 'road_grass', bounds: { x: 10, y: 400, width: 5, height: 5 }, alpha: 0 });
  tracker.record({ objectId: 'outside', category: 'road_fence', bounds: { x: 330, y: 400, width: 5, height: 5 } });
  const metrics = tracker.endFrame();
  assert.equal(metrics.referenceY, 340.8);
  assert.equal(metrics.decorativeObjectsBottom40, 1);
  assert.deepEqual(metrics.observedUnits.map(unit => [unit.objectId, unit.generation, unit.category]), [['edge', 4, 'road_stone']]);
});

test('the actual road projection puts the reference distance at 60% for short and tall viewports', () => {
  for (const height of [568, 667, 844, 932]) {
    const distance = roadReferenceDistance(height);
    const projected = Renderer.prototype.project.call({ width: 390, height, trailBend: 0 }, 0, distance);
    assert.ok(Math.abs(projected.y - height * .6) < 1e-8, `${height}px reference projected at ${projected.y}`);
  }
});

test('crossing measurement interpolates skipped frames and excludes pause and hidden time', () => {
  const tracker = new RoadComfortTracker();
  tracker.beginFrame({ width: 390, height: 844, runSeed: 15, phase: 4, distance: 0, activeMs: 0, state: 'running' });
  tracker.endFrame();
  tracker.beginFrame({ width: 390, height: 844, runSeed: 15, phase: 4, distance: 2.05, activeMs: 1_000, state: 'running' });
  let metrics = tracker.endFrame();
  assert.deepEqual(metrics.crossedLines.map(event => event.lineId), ['road-cross-1', 'road-cross-2', 'road-cross-3']);
  assert.deepEqual(metrics.crossedLines.map(event => event.generation), [15, 15, 15]);
  assert.ok(metrics.crossedLines.every(event => event.timeMs > 0 && event.timeMs < 1_000));
  assert.equal(metrics.crossingsPerSecond, 3);

  tracker.beginFrame({ width: 390, height: 844, runSeed: 15, phase: 4, distance: 2.05, activeMs: 1_000, state: 'paused' });
  tracker.endFrame();
  tracker.beginFrame({ width: 390, height: 844, runSeed: 15, phase: 4, distance: 2.05, activeMs: 10_000, state: 'running', visible: false });
  tracker.endFrame();
  tracker.beginFrame({ width: 390, height: 844, runSeed: 15, phase: 4, distance: 2.05, activeMs: 10_000, state: 'running' });
  tracker.endFrame();
  tracker.beginFrame({ width: 390, height: 844, runSeed: 15, phase: 4, distance: 2.15, activeMs: 10_100, state: 'running' });
  metrics = tracker.endFrame();
  assert.deepEqual(metrics.crossedLines, [], 'resume begins a fresh trajectory segment');
});

test('crossing rate stays unfilled before one active second and then uses the half-open window', () => {
  const tracker = new RoadComfortTracker();
  tracker.beginFrame({ width: 320, height: 568, distance: 0, activeMs: 0, state: 'running' });
  tracker.endFrame();
  tracker.beginFrame({ width: 320, height: 568, distance: .1, activeMs: 100, state: 'running' });
  let metrics = tracker.endFrame();
  assert.equal(metrics.windowReady, false);
  assert.equal(metrics.crossingsPerSecond, null);
  assert.equal(metrics.windowMs, 100);

  tracker.beginFrame({ width: 320, height: 568, distance: 1, activeMs: 1_000, state: 'running' });
  metrics = tracker.endFrame();
  assert.equal(metrics.windowReady, true);
  assert.equal(metrics.crossingsPerSecond, 2);
  tracker.beginFrame({ width: 320, height: 568, distance: 2, activeMs: 2_000, state: 'running' });
  metrics = tracker.endFrame();
  assert.equal(metrics.crossingsInWindow, 1, 'an event at t-1000 is outside the half-open window');
});

test('crossings only count stable line IDs selected into the current decoration set', () => {
  const tracker = new RoadComfortTracker();
  const selected = lineId => Number(lineId.split('-').at(-1)) % 2 === 1;
  tracker.beginFrame({ width: 390, height: 844, distance: 0, activeMs: 0, state: 'running', lineVisible: selected });
  tracker.endFrame();
  tracker.beginFrame({ width: 390, height: 844, distance: 2.05, activeMs: 1_000, state: 'running', lineVisible: selected });
  const metrics = tracker.endFrame();
  assert.deepEqual(metrics.crossedLines.map(event => event.lineId), ['road-cross-1', 'road-cross-3']);
});

test('translucent road swatches stay within the 0.15 linear-luminance difference target', () => {
  const surfaces = [
    ['#ead8b4', '#ddcba8'],
    ['#d6cbb0', '#cfc5aa'],
    ['#caa77a', '#c3a27b'],
  ];
  for (const [road, decoration] of surfaces) {
    assert.ok(compositedLuminanceDelta(decoration, road, .24) <= .15);
  }
  assert.ok(compositedLuminanceDelta('#c7b58f', '#ead8b4', .14) <= .15);
  assert.ok(compositedLuminanceDelta('#bda27f', '#caa77a', .14) <= .15);
});

function createObservedScene(width, height, mode, runSeed, flags = ROAD_COMFORT_FLAGS) {
  const stack = [];
  const ctx = {
    globalAlpha: 1,
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop() ?? 1; },
    beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, closePath() {}, fill() {}, stroke() {},
    translate() {}, rotate() {}, fillRect() {}, fillText() {},
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const tracker = new RoadComfortTracker();
  const renderer = {
    width, height, ctx, reducedMotion: false, roadDecoration: mode, roadComfortFlags: { ...flags },
    roadGeneration: runSeed,
    project(lane, distance) {
      const progress = distance / CONFIG.lookAhead;
      return {
        x: width * .5 + lane * width * .235 * (1 - .68 * progress),
        y: height * .80 - height * .56 * Math.sign(progress) * Math.abs(progress) ** .72,
        scale: 1 - .68 * progress,
      };
    },
    worldDistance(game) { return game.distance; },
    ellipse() {}, path() {}, flower() {},
    shouldDrawRoadDecoration(objectId, options = {}) {
      return shouldKeepRoadDecoration({
        visualSeed: deriveVisualSeed(runSeed), objectId, mode,
        reducedMotion: this.reducedMotion, flags: this.roadComfortFlags, ...options,
      });
    },
    recordRoadDecoration(unit) { return tracker.record(unit); },
  };
  return { renderer, tracker };
}

test('rendered scene observations keep actual bottom-40 counts under the limits at portrait sizes', () => {
  const scene = new AdventureScene();
  const viewports = [[320, 568], [375, 667], [390, 844], [430, 932]];
  for (const [width, height] of viewports) {
    for (const mode of ['standard', 'modest', 'minimal']) {
      const { renderer, tracker } = createObservedScene(width, height, mode, 71);
      for (let timeMs = 0; timeMs <= 30_000; timeMs += 500) {
        const game = { state: 'running', phase: 4, seed: 71, timeMs, distance: timeMs / 1000 };
        tracker.beginFrame({ width, height, runSeed: game.seed, phase: game.phase,
          distance: game.distance, activeMs: game.timeMs, state: game.state });
        scene.draw(renderer, game);
        const metrics = tracker.endFrame();
        assert.ok(metrics.crossLinesBottom40 <= 2, `${width}x${height} ${mode} has ${metrics.crossLinesBottom40} cross lines at ${timeMs}`);
        assert.ok(metrics.decorativeObjectsBottom40 <= 8,
          `${width}x${height} ${mode} has ${metrics.decorativeObjectsBottom40} objects at ${timeMs}: ${metrics.observedUnits.map(unit => `${unit.category}=${unit.objectId}`).join(',')}`);
        for (const unit of metrics.observedUnits) {
          assert.ok(unit.objectId.length > 0);
          assert.ok(Number.isFinite(unit.generation));
          assert.ok(unit.bounds.top >= 0 && unit.bounds.bottom <= height);
          assert.ok(unit.bounds.left >= 0 && unit.bounds.right <= width);
        }
      }
    }
  }
});

test('observed cross-line IDs follow fixed world geometry as the camera advances', () => {
  const scene = new AdventureScene();
  const { renderer, tracker } = createObservedScene(390, 844, 'standard', 22);
  const renderAt = distance => {
    tracker.beginFrame({ width: 390, height: 844, runSeed: 22, phase: 4,
      distance, activeMs: distance * 1_000, state: 'running' });
    scene.draw(renderer, { state: 'running', phase: 4, seed: 22, timeMs: distance * 1_000, distance });
    return tracker.endFrame();
  };
  const first = renderAt(0).observedUnits.find(unit => unit.lineId === 'road-cross-0');
  const next = renderAt(.1).observedUnits.find(unit => unit.lineId === 'road-cross-0');
  assert.ok(first && next);
  assert.equal(next.objectId, first.objectId);
  assert.equal(next.generation, first.generation);
  assert.ok(next.bounds.top > first.bounds.top, 'the same world line moves down as distance advances');

  const below = renderAt(.1).observedUnits.find(unit => unit.lineId === 'road-cross-1');
  assert.ok(below, 'line 1 is generated in road geometry before/at the reference crossing');
  assert.equal(below.bounds.top / 844 < .60, false, 'recorded geometry reaches the bottom-40 band');
});

test('Renderer exposes the road mode, independent dev flags, and frame metrics without mutating gameplay', () => {
  const originals = {
    matchMedia: globalThis.matchMedia,
    ResizeObserver: globalThis.ResizeObserver,
    devicePixelRatio: globalThis.devicePixelRatio,
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 2;
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = {
    width: 0, height: 0, getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 390, height: 844 }),
    closest: () => ({ dataset: {} }),
  };

  try {
    const renderer = new Renderer(canvas);
    renderer.adventure = new AdventureScene();
    assert.equal(renderer.roadDecoration, 'modest');
    const game = { state: 'running', phase: 4, seed: 44, timeMs: 1_000, distance: 1, x: 0, bones: [], obstacles: [] };
    const before = JSON.stringify(game);
    renderer.draw(game);
    assert.ok(renderer.comfortMetrics.observedUnits.length > 0);
    assert.ok(renderer.comfortMetrics.crossLinesBottom40 <= 2);
    assert.ok(renderer.comfortMetrics.decorativeObjectsBottom40 <= 8);
    assert.equal(renderer.visualSeed, deriveVisualSeed(44));
    const firstGeneration = renderer.comfortMetrics.observedUnits[0].generation;

    renderer.setRoadDecoration('standard');
    assert.equal(renderer.roadDecoration, 'standard');
    renderer.setRoadComfortFlags({ crossLines: false });
    renderer.draw({ ...game, timeMs: 1_100, distance: 1.1 });
    assert.equal(renderer.comfortMetrics.crossLinesBottom40, 0);
    assert.equal(renderer.roadComfortFlags.nearDecorations, true);
    assert.equal(JSON.stringify(game), before);
    assert.throws(() => renderer.setRoadDecoration('dense'), RangeError);
    assert.throws(() => renderer.setRoadComfortFlags({ unknown: false }), RangeError);

    renderer.draw({ ...game, state: 'paused', pausedFrom: 'running' });
    assert.equal(renderer.comfortMetrics.observedUnits[0].generation, firstGeneration);
    renderer.draw({ ...game, state: 'result' });
    renderer.draw({ ...game, state: 'ready', timeMs: 0, distance: 0 });
    renderer.draw({ ...game, timeMs: 0, distance: 0 });
    const rerunGeneration = renderer.comfortMetrics.observedUnits[0].generation;
    assert.ok(rerunGeneration > firstGeneration, 'a fresh attempt with the same seed gets a new observation generation');
    assert.ok(renderer.comfortMetrics.observedUnits.every(unit => unit.generation === rerunGeneration));
    assert.deepEqual(renderer.comfortMetrics.crossedLines, [], 'the rerun starts without the prior attempt trajectory');
    renderer.draw({ ...game, timeMs: 1_100, distance: 1.1 });
    assert.ok(renderer.comfortMetrics.observedUnits.every(unit => unit.generation === rerunGeneration));
    assert.equal(renderer.roadRunKey, '4:44');
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (typeof value === 'undefined') delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
