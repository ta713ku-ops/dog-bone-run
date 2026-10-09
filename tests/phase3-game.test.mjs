import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { PHASE3 } from '../src/config.js';

const bone = (id, distance, lane = 0, kind = 'normal') => ({ id, distance, timeMs: distance * 1000, lane, kind });
const hazard = (id, distance, lane = 0, type = 'hole') => ({ id, distance, lane, type });
function setup(course = [], obstacles = [hazard('hole', 2)]) {
  const events = []; const game = new Game({ phase: 3, course, obstacles, seed: 42, onEvent: e => events.push(e) });
  game.start(); return { game, events };
}
const snapshot = g => ({ timeMs: g.timeMs, distance: g.distance, x: g.x, score: g.score, combo: g.combo, slowUntilMs: g.slowUntilMs, suppressUntilMs: g.suppressUntilMs });

test('hole kills immediately, freezes game time, and ends only after the separate 650ms presentation', () => {
  const { game: g, events } = setup([bone('first', .6)]); g.advance(10_000);
  assert.equal(g.state, 'falling'); assert.equal(g.timeMs, 1840); assert.equal(g.distance, 1.84);
  assert.equal(g.collected, 1); assert.equal(g.score, 10); assert.equal(events.filter(e => e.type === 'end').length, 0);
  const death = snapshot(g); g.advance(10_000); assert.deepEqual(snapshot(g), death); assert.equal(g.fallElapsedMs, 0);
  assert.equal(g.command(1), false); g.advanceFall(649); assert.equal(g.state, 'falling');
  g.advanceFall(1); assert.equal(g.state, 'result'); assert.deepEqual(snapshot(g), death);
  assert.equal(g.result().completed, false); assert.equal(g.result().endReason, 'hole');
  assert.ok(Math.abs(g.result().progress - 1.84 / 60) < 1e-9);
  g.advanceFall(10_000); assert.equal(events.filter(e => e.type === 'end').length, 1);
  assert.equal(events.find(e => e.type === 'end').activeMs, 1840);
});

test('same-time hole blocks trash, puddle and bone, including a goal-boundary contact', () => {
  for (const d of [1, 60.16]) {
    const { game: g, events } = setup([bone('same', d - .06)], [hazard('water', d, 0, 'puddle'), hazard('trash', d, 0, 'trash'), hazard('hole', d)]);
    g.advance(70_000); assert.equal(g.state, 'falling'); assert.equal(g.score, 0);
    assert.equal(g.speed, 1); assert.equal(g.slowUntilMs, 0); assert.equal(g.suppressUntilMs, 0);
    assert.deepEqual(events.filter(e => e.type === 'obstacle_contact').map(e => e.obstacleType), ['hole']);
    assert.equal(g.bones[0].status, 'pending'); assert.equal(g.obstacles.find(o => o.id === 'trash').status, 'pending');
  }
});

test('hole collision sweeps a moving dog and keeps the inclusive lateral boundary', () => {
  const { game: g } = setup([], [hazard('hole', .2, 1)]); g.command(1); g.advance(200);
  assert.equal(g.state, 'falling'); assert.ok(Math.abs(g.x - .5) < 1e-9); assert.ok(Math.abs(g.timeMs - 100) < 1e-9);
  const outside = setup([], [hazard('hole', 1, .5001)]).game; outside.advance(1200); assert.equal(outside.state, 'running');
  const edge = setup([], [hazard('hole', 1, .5)]).game; edge.advance(840); assert.equal(edge.state, 'falling');
});

test('falling during water freezes all effects, and paused falling resumes only its presentation', () => {
  const { game: g } = setup([bone('first', .2)], [hazard('water', .5, 0, 'puddle'), hazard('hole', .8)]);
  g.advance(1000); assert.equal(g.state, 'falling'); assert.equal(g.speed, .6);
  const death = snapshot(g); g.advanceFall(200); g.pause('hidden');
  assert.equal(g.pausedFrom, 'falling'); g.advanceFall(2000); assert.equal(g.fallElapsedMs, 200);
  assert.deepEqual(snapshot(g), death); assert.equal(g.resume(), true); assert.equal(g.state, 'falling');
  g.advanceFall(PHASE3.fallMs - 200); assert.equal(g.state, 'result'); assert.deepEqual(snapshot(g), death);
});

test('death discards queued motion and retry restores the complete start state', () => {
  const { game: g } = setup([], [hazard('hole', .3, 1)]); g.command(1); g.advance(100); g.command(-1); g.advance(200);
  assert.equal(g.state, 'falling'); assert.equal(g.queue, null); assert.equal(g.move, null);
  g.advanceFall(650); g.reset({ seed: 43 });
  assert.equal(g.state, 'ready'); assert.equal(g.fall, null); assert.equal(g.endReason, null); assert.equal(g.fallElapsedMs, 0);
  assert.equal(g.pausedFrom, null); assert.deepEqual(snapshot(g), { timeMs: 0, distance: 0, x: 0, score: 0, combo: 0, slowUntilMs: 0, suppressUntilMs: 0 });
  assert.equal(g.obstacles[0].status, 'pending'); assert.equal(g.seed, 43);
});

test('safe Phase3 completion retains ordinary and gold scoring and records completion', () => {
  const { game: g, events } = setup([bone('normal', 1), bone('gold', 1.8, 0, 'gold')], []);
  g.advance(70_000); assert.equal(g.state, 'result'); assert.equal(g.timeMs, 60_000);
  assert.equal(g.score, 60); assert.equal(g.result().completed, true); assert.equal(g.result().endReason, 'finish');
  assert.equal(g.normalCollected, 1); assert.equal(g.goldCollected, 1); assert.equal(events.filter(e => e.type === 'end').length, 1);
});

test('fatal contact is independent of rendering cadence and presentation accepts only valid deltas', () => {
  function run(step) {
    const { game: g, events } = setup([bone('normal', .6)], [hazard('water', .8, 0, 'puddle'), hazard('hole', 1.3)]);
    while (g.state === 'running') g.advance(step);
    const result = g.result(); for (const delta of [0, -1, NaN, Infinity]) g.advanceFall(delta);
    assert.equal(g.fallElapsedMs, 0); g.advanceFall(650);
    return { result, contacts: events.filter(e => ['collect', 'obstacle_contact', 'fall'].includes(e.type)).map(e => ({ type: e.type, activeMs: e.activeMs, id: e.boneId ?? e.obstacleId })) };
  }
  const first = run(1000 / 60), second = run(137);
  assert.equal(first.result.score, second.result.score); assert.equal(first.result.completed, false);
  assert.ok(Math.abs(first.result.timeMs - second.result.timeMs) < 1e-6);
  assert.deepEqual(first.contacts.map(e => [e.type, e.id]), second.contacts.map(e => [e.type, e.id]));
  first.contacts.forEach((e,i) => assert.ok(Math.abs(e.activeMs - second.contacts[i].activeMs) < 1e-6));
});
