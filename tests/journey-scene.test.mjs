import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURNEY_ROUTES } from '../src/journey-catalog.js';
import { JourneyScene, getJourneySceneProfile } from '../src/journey-scene.js';
import { getWalkLevel } from '../src/walk-levels.js';

function makeRenderer() {
  const draws = { paths: [], ellipses: [], strokes: 0 };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'stroke') return () => { draws.strokes += 1; };
      if (key === 'createLinearGradient' || key === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const width = 390, height = 844;
  return {
    draws, ctx, width, height,
    worldDistance(game) { return game.distance; },
    project(lane, distance) {
      const scale = 1 / (1 + .65 * Math.max(-.82, distance));
      return { x: width * .5 + lane * width * .235 * scale, y: height * .28 + height * .52 * scale, scale };
    },
    path(points, fill, stroke, lineWidth) { draws.paths.push({ points, fill, stroke, lineWidth }); },
    ellipse(x, y, rx, ry, fill, stroke, angle) { draws.ellipses.push({ x, y, rx, ry, fill, stroke, angle }); },
  };
}

test('all twelve authored routes map to distinct, inspectable scenery variants', () => {
  const variants = new Set();
  for (const route of JOURNEY_ROUTES) {
    const profile = getJourneySceneProfile(route.id);
    assert.ok(profile, `${route.id} has a scenery profile`);
    variants.add(profile.variant);
    assert.ok(profile.features.length >= 2, `${route.id} has multiple physical scene features`);
    const renderer = makeRenderer();
    const scene = new JourneyScene();
    const result = scene.drawEnvironment(renderer, {
      journeyRouteId: route.id,
      distance: 6 * getWalkLevel(route.level).speed,
      timeMs: 6_000,
      speed: getWalkLevel(route.level).speed,
    });
    assert.equal(result.variant, profile.variant);
    assert.equal(renderer.journeySceneInspection.variant, profile.variant);
    assert.ok(renderer.draws.paths.length + renderer.draws.ellipses.length > 0, `${route.id} paints real scenery geometry`);
  }
  assert.equal(variants.size, 12);
});

test('riverside and pond routes draw separate world-water bodies; wet road has physical reflections', () => {
  const riverScene = new JourneyScene();
  const riverRenderer = makeRenderer();
  const river = riverScene.drawEnvironment(riverRenderer, {
    journeyRouteId: 'street-2', distance: 8, timeMs: 8_000, speed: 1,
  });
  assert.equal(river.waterBody, 'river');
  assert.ok(river.features.includes('wooden-bridge'));
  assert.ok(riverRenderer.draws.paths.some(path => path.points.length >= 48 && typeof path.fill === 'object'), 'river water is a continuous world-space ribbon with depth shading');

  const pondRenderer = makeRenderer();
  const pond = new JourneyScene().drawEnvironment(pondRenderer, {
    journeyRouteId: 'park-3', distance: 8 * getWalkLevel(2).speed, timeMs: 8_000, speed: getWalkLevel(2).speed,
  });
  assert.equal(pond.waterBody, 'pond');
  assert.ok(pond.features.includes('reeds'));
  assert.ok(pondRenderer.draws.paths.some(path => path.fill === '#579ca2'), 'pond water is drawn as a bounded world-space ellipse');

  const wetRenderer = makeRenderer();
  const wet = new JourneyScene().drawEnvironment(wetRenderer, {
    journeyRouteId: 'street-3', distance: 8, timeMs: 8_000, speed: 1,
  });
  assert.equal(wet.weather, 'after-rain');
  assert.ok(wet.features.includes('road-puddles'));
  assert.ok(wetRenderer.draws.paths.length >= 4, 'wet road includes multiple separate puddles');
  assert.ok(wetRenderer.draws.strokes >= 4, 'wet road includes separate reflected streaks');
});

test('classic rendering has no journey scenery overlay', () => {
  const scene = new JourneyScene();
  const renderer = makeRenderer();
  assert.equal(scene.drawEnvironment(renderer, { journeyRouteId: null, distance: 0, timeMs: 0 }), null);
  assert.equal(renderer.journeySceneInspection, null);
  assert.equal(renderer.draws.paths.length + renderer.draws.ellipses.length, 0);
});

test('recognizable named encounters use distinct compact silhouettes', () => {
  const namedIds = new Set([
    'butterfly', 'duck', 'dragonfly', 'bat', 'bench', 'bridge',
    'clover', 'pinecone', 'acorn', 'crystal', 'quartz',
  ]);
  const discoveries = JOURNEY_ROUTES.flatMap(route => route.discoveries)
    .filter(discovery => namedIds.has(discovery.id.split('-').at(-1)));
  const signatures = new Map();

  for (const discovery of discoveries) {
    const calls = [];
    const ctx = new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => calls.push([String(key), ...args]);
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    const renderer = {
      ctx,
      project(lane, distance) { return { x: lane * 20 + 100, y: 130 + distance * 3, scale: .8 }; },
      ellipse(...args) { calls.push(['ellipse', ...args]); },
      path(...args) { calls.push(['path', ...args]); },
    };
    new JourneyScene().drawEncounter(renderer, discovery, 1);
    signatures.set(discovery.id, JSON.stringify(calls));
  }

  assert.equal(signatures.size, namedIds.size, 'the catalog includes each named encounter exactly once');
  assert.equal(new Set(signatures.values()).size, namedIds.size, 'animals, landmarks, plants and objects each draw a distinct silhouette');
});
