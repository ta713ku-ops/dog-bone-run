import assert from 'node:assert/strict';
import test from 'node:test';
import { AdventureScene, getAdventureStage } from '../src/adventure-scene.js';
import { CONFIG } from '../src/config.js';
import { projectStreet } from '../src/street-camera.js';
import { deriveVisualSeed, shouldKeepRoadDecoration } from '../src/road-comfort.js';

function makeRenderer(width = 390, height = 844, reducedMotion = false, roadFlags = {}, streetPerspective = false) {
  const calls = [];
  const alphaStack = [];
  const ctx = {
    globalAlpha: 1,
    save() { alphaStack.push(this.globalAlpha); calls.push({ op: 'save', args: [] }); },
    restore() { this.globalAlpha = alphaStack.pop() ?? 1; calls.push({ op: 'restore', args: [] }); },
    beginPath() { calls.push({ op: 'beginPath', args: [] }); },
    moveTo(...args) { calls.push({ op: 'moveTo', args }); },
    lineTo(...args) { calls.push({ op: 'lineTo', args }); },
    bezierCurveTo(...args) { calls.push({ op: 'bezierCurveTo', args }); },
    closePath() { calls.push({ op: 'closePath', args: [] }); },
    fill() { calls.push({ op: 'fill', args: [] }); },
    translate(...args) { calls.push({ op: 'translate', args }); },
    rotate(...args) { calls.push({ op: 'rotate', args }); },
    stroke() { calls.push({ op: 'stroke', args: [] }); },
    fillRect(...args) { calls.push({ op: 'fillRect', args }); },
    fillText(...args) { calls.push({ op: 'fillText', args }); },
    createLinearGradient(...args) {
      calls.push({ op: 'createLinearGradient', args });
      return { addColorStop(...stopArgs) { calls.push({ op: 'addColorStop', args: stopArgs }); } };
    },
  };
  const renderer = {
    width, height, ctx, reducedMotion, streetPerspective,
    roadGeneration: 13,
    roadComfortFlags: { crossLines: true, nearDecorations: true, farParallax: true, ...roadFlags },
    ellipse(...args) { calls.push({ op: 'ellipse', args }); },
    path(...args) { calls.push({ op: 'path', args }); },
    project(lane, distance) {
      calls.push({ op: 'project', args: [lane, distance] });
      if (this.streetPerspective) return projectStreet(width, height, lane, distance);
      const progress = distance / CONFIG.lookAhead;
      return {
        x: width * .5 + lane * width * .235 * (1 - .68 * progress),
        y: height * .80 - height * .56 * Math.sign(progress) * Math.abs(progress) ** .72,
        scale: 1 - .68 * progress,
      };
    },
    worldDistance(game) { return game.distance; },
    shouldDrawRoadDecoration(objectId, options) {
      calls.push({ op: 'allowRoadDecoration', args: [objectId, options] });
      return true;
    },
    recordRoadDecoration(decoration) { calls.push({ op: 'roadDecoration', args: [decoration] }); },
  };
  return { renderer, calls };
}

function allNumbersFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allNumbersFinite);
  if (value && typeof value === 'object') return Object.values(value).every(allNumbersFinite);
  return true;
}

function renderCalls({ width = 390, height = 844, reducedMotion = false, roadFlags, game, menu = false, timeMs = 0, streetPerspective = false }) {
  const { renderer, calls } = makeRenderer(width, height, reducedMotion, roadFlags, streetPerspective);
  new AdventureScene().draw(renderer, game, { menu, timeMs });
  return calls;
}

test('adventure stages use the three contracted Japanese titles and exact boundaries', () => {
  assert.deepEqual(getAdventureStage(-1), { index: 0, title: '家並みの道' });
  assert.deepEqual(getAdventureStage(9_999), { index: 0, title: '家並みの道' });
  assert.deepEqual(getAdventureStage(10_000), { index: 1, title: '庭木のある通り' });
  assert.deepEqual(getAdventureStage(19_999), { index: 1, title: '庭木のある通り' });
  assert.deepEqual(getAdventureStage(20_000), { index: 2, title: '塀沿いの道' });
  assert.deepEqual(getAdventureStage(Number.NaN), { index: 0, title: '家並みの道' });
});

test('all three landscapes draw finite geometry at narrow and wide sizes without changing game state', () => {
  for (const [width, height] of [[320, 568], [390, 844], [1280, 720]]) {
    for (const timeMs of [1_000, 10_000, 20_000, 29_500]) {
      const game = Object.freeze({ state: 'running', phase: 4, timeMs, distance: timeMs / 1000, x: .25 });
      const before = JSON.stringify(game);
      const calls = renderCalls({ width, height, game });
      assert.ok(calls.length > 100, `expected a detailed scene at ${width}x${height}`);
      assert.ok(calls.length < 5_000, `scene drawing must stay bounded at ${width}x${height}`);
      assert.ok(calls.every(allNumbersFinite), `non-finite draw argument at ${width}x${height}, ${timeMs}ms`);
      assert.equal(JSON.stringify(game), before, 'scene rendering must not mutate game state');
      assert.ok(calls.some(call => call.op === 'project' && Math.abs(Math.abs(call.args[0]) - 1.55) < .001), 'road edges use renderer.project');
    }
  }
});

test('reduced motion freezes menu decorations while normal menu animation moves them', () => {
  const reducedEarly = renderCalls({ reducedMotion: true, menu: true, timeMs: 800 });
  const reducedLate = renderCalls({ reducedMotion: true, menu: true, timeMs: 8_800 });
  assert.deepEqual(reducedLate, reducedEarly);

  const movingEarly = renderCalls({ reducedMotion: false, menu: true, timeMs: 800 });
  const movingLate = renderCalls({ reducedMotion: false, menu: true, timeMs: 8_800 });
  assert.notDeepEqual(movingLate, movingEarly);
});

test('farParallax freezes sky drift without stopping world scenery or road projection', () => {
  const early = renderCalls({ menu: true, timeMs: 800, roadFlags: { farParallax: false } });
  const late = renderCalls({ menu: true, timeMs: 8_800, roadFlags: { farParallax: false } });
  assert.deepEqual(late, early);

  const moving = renderCalls({ menu: true, timeMs: 8_800, roadFlags: { farParallax: true } });
  assert.notDeepEqual(moving, early);
});

test('menu road and scenery start below the compact-screen copy area', () => {
  const short = renderCalls({ width: 320, height: 568, menu: true, reducedMotion: true });
  const regular = renderCalls({ width: 390, height: 844, menu: true, reducedMotion: true });
  const maxProjectedDistance = calls => Math.max(...calls.filter(call => call.op === 'project').map(call => call.args[1]));
  assert.ok(maxProjectedDistance(short) <= 1.7 + 1e-8);
  assert.ok(maxProjectedDistance(regular) <= 2.15 + 1e-8);
  const shortHorizon = 568 * .8 - 568 * .56 * (1.7 / CONFIG.lookAhead) ** .72;
  assert.ok(shortHorizon > 250, `compact menu path begins below the description: ${shortHorizon}`);
});

test('course scenery scroll follows world distance, and a frozen game frame stays deterministic', () => {
  const paused = Object.freeze({ state: 'paused', phase: 4, timeMs: 4_200, distance: 3.1, x: 0 });
  const frozenA = renderCalls({ game: paused });
  const frozenB = renderCalls({ game: paused });
  assert.deepEqual(frozenB, frozenA);

  const later = Object.freeze({ ...paused, timeMs: 5_100, distance: 4.2 });
  assert.notDeepEqual(renderCalls({ game: later, reducedMotion: true }), renderCalls({ game: paused, reducedMotion: true }));
});

test('residential and commercial facades and garden walls stay outside the road', () => {
  const game = Object.freeze({ state: 'running', phase: 4, timeMs: 15_000, distance: 0, x: 0 });
  const { renderer, calls } = makeRenderer(390, 844, true);
  new AdventureScene().draw(renderer, game);
  assert.ok(calls.some(call => call.op === 'path'), 'the missing atlas has a drawn vector-house fallback');
  const facades = calls.filter(call => call.op === 'roadDecoration'
    && /^(house|convenience|shop|apartment):/.test(call.args[0].objectId));
  assert.ok(facades.length >= 4, 'facades repeat along both sides of the street');
  for (const { objectId, bounds } of facades.map(call => call.args[0])) {
    const [, sideText, slotText] = objectId.split(':');
    const side = Number(sideText), slot = Number(slotText);
    const distance = (side < 0 ? .28 : 1.12) + slot * 1.9;
    const roadEdge = renderer.project(side * 1.55, distance).x;
    assert.ok(side < 0 ? bounds.right < roadEdge : bounds.left > roadEdge, `${objectId} stays outside the projected road edge`);
  }
  assert.ok(facades.some(call => call.args[0].bounds.right - call.args[0].bounds.left > 200),
    'at least one nearby facade reads larger than the running character');
  const walls = calls.filter(call => call.op === 'roadDecoration' && call.args[0].category === 'road_fence');
  assert.ok(walls.length >= 2, 'garden walls frame both sides of the residential street');
  assert.equal(calls.some(call => call.op === 'flower'), false);
  assert.equal(calls.some(call => call.op === 'roadDecoration' && /butterfly|creek|tree/.test(call.args[0].objectId)), false);
});

test('the rendered 30-second street mixes facades with stable IDs and a bounded convenience cadence', () => {
  const scene = new AdventureScene();
  const appearances = new Map();
  const frameIds = new Map();
  for (let distance = 0; distance <= 30; distance += 1) {
    const { renderer, calls } = makeRenderer();
    scene.draw(renderer, { state: 'running', phase: 4, timeMs: distance * 1_000, distance, x: 0 });
    const ids = new Set();
    for (const call of calls.filter(entry => entry.op === 'roadDecoration')) {
      const decoration = call.args[0], [kind, sideText, slotText] = decoration.objectId.split(':');
      if (!['house', 'convenience', 'shop', 'apartment'].includes(kind)) continue;
      const side = Number(sideText), slot = Number(slotText);
      const worldDistance = (side < 0 ? .28 : 1.12) + slot * 1.9;
      if (worldDistance < 0 || worldDistance >= 30) continue;
      appearances.set(decoration.objectId, { kind, generation: decoration.generation });
      ids.add(decoration.objectId);
    }
    frameIds.set(distance, ids);
  }

  const byKind = {};
  for (const item of appearances.values()) (byKind[item.kind] ??= []).push(item);
  assert.ok((byKind.house?.length ?? 0) > (byKind.convenience?.length ?? 0)
    + (byKind.shop?.length ?? 0) + (byKind.apartment?.length ?? 0), 'houses remain the dominant facade type');
  assert.ok((byKind.convenience?.length ?? 0) >= 1 && (byKind.convenience?.length ?? 0) <= 2,
    'the 30-second world interval shows one or two convenience stores');
  assert.ok((byKind.shop?.length ?? 0) >= 1, 'the street includes a small shop facade');
  assert.ok((byKind.apartment?.length ?? 0) >= 1, 'the street includes a low-rise apartment facade');
  const commercialShare = ((byKind.shop?.length ?? 0) + (byKind.apartment?.length ?? 0)) / appearances.size;
  assert.ok(commercialShare >= .25, `shops and apartments account for at least a quarter of facades, got ${commercialShare}`);
  assert.ok([...appearances.values()].every(item => item.generation === 13), 'drawn objects carry the active road generation');

  const shared = [...frameIds.get(5)].filter(id => frameIds.get(6).has(id));
  assert.ok(shared.length >= 2, 'the same world objects keep IDs as the camera advances');
});

test('structural storefronts remain in the rendered street in every comfort mode', () => {
  const scene = new AdventureScene();
  for (const mode of ['standard', 'modest', 'minimal']) {
    const appearances = new Set();
    const visualSeed = deriveVisualSeed(71);
    for (let distance = 0; distance <= 30; distance += 1) {
      const { renderer, calls } = makeRenderer();
      renderer.roadDecoration = mode;
      renderer.shouldDrawRoadDecoration = (objectId, options = {}) => shouldKeepRoadDecoration({
        visualSeed, objectId, mode, reducedMotion: renderer.reducedMotion,
        flags: renderer.roadComfortFlags, ...options,
      });
      scene.draw(renderer, { state: 'running', phase: 4, timeMs: distance * 1_000, distance, seed: 71, x: 0 });
      for (const call of calls.filter(entry => entry.op === 'roadDecoration')) {
        const [kind] = call.args[0].objectId.split(':');
        if (kind === 'shop' || kind === 'apartment' || kind === 'convenience') appearances.add(kind);
      }
    }
    assert.ok(appearances.has('shop'), `${mode} keeps small storefronts visible`);
    assert.ok(appearances.has('apartment'), `${mode} keeps low-rise apartments visible`);
    assert.ok(appearances.has('convenience'), `${mode} keeps convenience stores visible`);
  }
});

test('commercial facades, vending machines, poles, and wires remain beyond the road curb', () => {
  const { renderer, calls } = makeRenderer(390, 844, true);
  new AdventureScene().draw(renderer, { state: 'paused', phase: 4, timeMs: 14_000, distance: 14, x: 0 });
  const records = calls.filter(call => call.op === 'roadDecoration').map(call => call.args[0]);

  for (const item of records.filter(entry => /^(convenience|shop|apartment):/.test(entry.objectId))) {
    const [, sideText, slotText] = item.objectId.split(':');
    const side = Number(sideText), slot = Number(slotText);
    const distance = (side < 0 ? .28 : 1.12) + slot * 1.9 - 14;
    const curb = renderer.project(side * 1.55, distance).x;
    assert.ok(side < 0 ? item.bounds.right < curb : item.bounds.left > curb, `${item.objectId} stays off asphalt`);
  }

  for (const item of records.filter(entry => entry.objectId.startsWith('vending:'))) {
    const [, sideText, slotText] = item.objectId.split(':');
    const side = Number(sideText), slot = Number(slotText);
    const distance = (side < 0 ? .28 : 1.12) + slot * 1.9 - 14;
    const curb = renderer.project(side * 1.76, distance).x;
    assert.ok(side < 0 ? item.bounds.right < curb : item.bounds.left > curb, `${item.objectId} stays beyond the curb`);
  }

  assert.ok(records.some(entry => entry.objectId.startsWith('vending:')), 'convenience stores receive a static code-drawn machine');
  const powerStructures = records.filter(entry => entry.objectId.startsWith('power-structure:'));
  assert.equal(powerStructures.length, 2, 'each connected side network is recorded as one complete comfort unit');
  for (const item of powerStructures) {
    const side = Number(item.objectId.split(':')[1]);
    const curb = renderer.project(side * 1.76, CONFIG.lookAhead).x;
    assert.ok(side < 0 ? item.bounds.right < curb : item.bounds.left > curb, `${item.objectId} stays beyond the curb`);
  }
});

test('far houses fade continuously and the decorative road extension ends before look-ahead', () => {
  const scene = new AdventureScene();
  const worldHouse = .28;
  const renderAtDistance = distance => {
    const { renderer, calls } = makeRenderer();
    scene.draw(renderer, { state: 'running', phase: 4, timeMs: 5_000, distance, x: 0 });
    return { calls, renderer };
  };

  const nearLimit = renderAtDistance(worldHouse - (CONFIG.lookAhead - .15));
  const closer = renderAtDistance(worldHouse - (CONFIG.lookAhead - .25));
  const alphaFor = calls => calls.find(call => call.op === 'roadDecoration'
    && call.args[0].objectId === 'house:-1:0')?.args[0].alpha;
  const faint = alphaFor(nearLimit.calls), stronger = alphaFor(closer.calls);
  assert.ok(Number.isFinite(faint) && faint > 0 && faint < 1, 'a house near the horizon remains visible while fading');
  assert.ok(stronger > faint && stronger <= 1, 'opacity changes smoothly as the same house approaches');

  const horizonY = nearLimit.renderer.project(0, CONFIG.lookAhead).y;
  const extendedRoad = nearLimit.calls.some(call => call.op === 'path' && call.args[1] === '#85817a'
    && call.args[0].some(point => point[1] < horizonY - 1)
    && call.args[0].some(point => Math.abs(point[1] - horizonY) < .01));
  assert.ok(extendedRoad, 'the road tapers into the distant residential skyline');
  assert.ok(nearLimit.calls.filter(call => call.op === 'project').every(call => call.args[1] <= CONFIG.lookAhead),
    'the far decoration does not project beyond the configured look-ahead');
});

test('world decor IDs stay fixed as the camera scrolls and comfort flags still govern road lines', () => {
  const scene = new AdventureScene();
  const first = makeRenderer();
  scene.draw(first.renderer, { state: 'running', timeMs: 2_000, distance: 1, x: 0 });
  const second = makeRenderer();
  scene.draw(second.renderer, { state: 'running', timeMs: 2_100, distance: 1.1, x: 0 });
  const ids = calls => new Set(calls.filter(call => call.op === 'roadDecoration' && call.args[0].objectId.startsWith('house:'))
    .map(call => call.args[0].objectId));
  const common = [...ids(first.calls)].filter(id => ids(second.calls).has(id));
  assert.ok(common.length >= 2, 'the same world houses keep their IDs over consecutive frames');

  const noCrossings = makeRenderer();
  noCrossings.renderer.roadComfortFlags.crossLines = false;
  scene.draw(noCrossings.renderer, { state: 'running', timeMs: 2_000, distance: 1, x: 0 });
  assert.equal(noCrossings.calls.some(call => call.op === 'roadDecoration' && call.args[0].category === 'road_cross_line'), false);

  const minimal = makeRenderer();
  minimal.renderer.roadDecoration = 'minimal';
  scene.draw(minimal.renderer, { state: 'running', timeMs: 2_000, distance: 1, x: 0 });
  assert.equal(minimal.calls.some(call => call.op === 'roadDecoration' && call.args[0].category === 'road_cross_line'), false);
});

test('the running street projects continuous geometry to the shared horizon at every supported size', () => {
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [1280, 720]]) {
    const game = Object.freeze({ state: 'running', phase: 4, timeMs: 8_000, distance: 8, x: 0 });
    const before = JSON.stringify(game);
    const calls = renderCalls({ width, height, game, streetPerspective: true });
    const projected = calls.filter(call => call.op === 'project');
    assert.ok(calls.length > 300, 'expected detailed projected scenery at ' + width + 'x' + height);
    assert.ok(calls.length < 15_000, 'scene calls stay bounded at ' + width + 'x' + height);
    assert.ok(calls.every(allNumbersFinite), 'all scene geometry remains finite at ' + width + 'x' + height);
    assert.ok(projected.some(call => call.args[1] > CONFIG.lookAhead), 'the world continues beyond obstacle look-ahead');
    assert.ok(projected.every(call => call.args[1] <= 60), 'the street meets the horizon at distance 60');
    assert.equal(JSON.stringify(game), before, 'scene rendering never mutates the active run');
  }
});

test('projected buildings, trees, vending machines and power stay beyond both play-lane edges', () => {
  const game = Object.freeze({ state: 'running', phase: 4, timeMs: 6_000, distance: 6, x: 0 });
  const { renderer, calls } = makeRenderer(390, 844, true, {}, true);
  new AdventureScene().draw(renderer, game);
  const structures = calls.filter(call => call.op === 'roadDecoration').map(call => call.args[0])
    .filter(item => /^(house|shop|apartment|convenience|lot|lot-tree|street-tree|street-pole|street-vending|street-wire):/.test(item.objectId));
  assert.ok(structures.length >= 12, 'the run has stable building, garden, tree and utility diagnostics');
  for (const item of structures) {
    assert.ok(item.bounds && allNumbersFinite(item.bounds), item.objectId + ' has finite screen bounds');
    assert.ok(item.worldLaneBounds, item.objectId + ' reports its world-lane footprint');
    assert.ok(item.worldLaneBounds.min > 1.55 || item.worldLaneBounds.max < -1.55,
      item.objectId + ' stays outside the road play area');
  }
  assert.ok(structures.some(item => item.objectId.startsWith('convenience:')), 'the street includes a convenience store');
  assert.ok(structures.some(item => item.objectId.startsWith('shop:')), 'the street includes a local shop');
  assert.ok(structures.some(item => item.objectId.startsWith('apartment:')), 'the street includes an apartment');
  assert.ok(structures.some(item => item.objectId.startsWith('street-pole:')), 'utility poles remain roadside');
  assert.ok(structures.some(item => item.objectId.startsWith('lot-tree:')),
    'frontage trees are world-anchored, visible, and included in roadside diagnostics');
});

test('street IDs remain fixed between adjacent camera frames and pause holds ambient motion', () => {
  const scene = new AdventureScene();
  const draw = (distance, timeMs, state = 'running') => {
    const { renderer, calls } = makeRenderer(390, 844, false, {}, true);
    scene.draw(renderer, { state, phase: 4, timeMs, distance, x: 0 });
    return calls;
  };
  const first = draw(8, 8_000);
  const second = draw(8.2, 8_200);
  const ids = calls => new Set(calls.filter(call => call.op === 'roadDecoration'
    && call.args[0].objectId.startsWith('house:')).map(call => call.args[0].objectId));
  assert.ok([...ids(first)].some(id => ids(second).has(id)), 'adjacent frames retain the same world-house IDs');
  const treeIds = calls => new Set(calls.filter(call => call.op === 'roadDecoration'
    && call.args[0].objectId.startsWith('lot-tree:')).map(call => call.args[0].objectId));
  assert.ok([...treeIds(first)].some(id => treeIds(second).has(id)), 'frontage trees retain world-stable IDs while scrolling');
  assert.deepEqual(draw(8, 8_000, 'paused'), draw(8, 18_000, 'paused'), 'paused world details and sky do not animate');
  assert.notDeepEqual(first, draw(8, 18_000), 'running sky drift follows active time');
});
