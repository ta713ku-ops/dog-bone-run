import assert from 'node:assert/strict';
import test from 'node:test';
import { AdventureScene, getAdventureStage } from '../src/adventure-scene.js';
import { CONFIG } from '../src/config.js';

function makeRenderer(width = 390, height = 844, reducedMotion = false) {
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
    width, height, ctx, reducedMotion,
    ellipse(...args) { calls.push({ op: 'ellipse', args }); },
    path(...args) { calls.push({ op: 'path', args }); },
    flower(...args) { calls.push({ op: 'flower', args }); },
    project(lane, distance) {
      calls.push({ op: 'project', args: [lane, distance] });
      const progress = distance / CONFIG.lookAhead;
      return {
        x: width * .5 + lane * width * .235 * (1 - .68 * progress),
        y: height * .80 - height * .56 * Math.sign(progress) * Math.abs(progress) ** .72,
        scale: 1 - .68 * progress,
      };
    },
    worldDistance(game) { return game.distance; },
  };
  return { renderer, calls };
}

function allNumbersFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allNumbersFinite);
  if (value && typeof value === 'object') return Object.values(value).every(allNumbersFinite);
  return true;
}

function renderCalls({ width = 390, height = 844, reducedMotion = false, game, menu = false, timeMs = 0 }) {
  const { renderer, calls } = makeRenderer(width, height, reducedMotion);
  new AdventureScene().draw(renderer, game, { menu, timeMs });
  return calls;
}

test('adventure stages use the three contracted Japanese titles and exact boundaries', () => {
  assert.deepEqual(getAdventureStage(-1), { index: 0, title: '花咲く小径' });
  assert.deepEqual(getAdventureStage(9_999), { index: 0, title: '花咲く小径' });
  assert.deepEqual(getAdventureStage(10_000), { index: 1, title: '木漏れ日の森' });
  assert.deepEqual(getAdventureStage(19_999), { index: 1, title: '木漏れ日の森' });
  assert.deepEqual(getAdventureStage(20_000), { index: 2, title: '小川のほとり' });
  assert.deepEqual(getAdventureStage(Number.NaN), { index: 0, title: '花咲く小径' });
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

test('forest draws dense edge tree rows and hills use smooth cubic curves', () => {
  const calls = renderCalls({ reducedMotion: true, game: Object.freeze({ state: 'running', phase: 4, timeMs: 15_000, distance: 0, x: 0 }) });
  const edgeTrees = calls.filter(call => call.op === 'project'
    && Math.abs(call.args[0]) >= 2.05 && Math.abs(call.args[0]) <= 2.29).length;
  assert.ok(edgeTrees >= 14, `expected layered forest rows outside the course lanes, got ${edgeTrees}`);
  assert.ok(calls.filter(call => call.op === 'bezierCurveTo').length >= 25, 'rolling hills use continuous cubic curves');
  assert.equal(calls.filter(call => call.op === 'quadraticCurveTo').length, 0);
});
