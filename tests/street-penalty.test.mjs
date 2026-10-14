import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { PHASE4 } from '../src/config.js';

const bone = (id, distance, lane = 0, kind = 'normal') => ({ id, distance, timeMs: distance * 1000, lane, kind });
const obstacle = (id, type, distance, lane = 0) => ({ id, type, distance, lane });

function setup({ course = [], obstacles = [], seed = 42 } = {}) {
  const events = [];
  const game = new Game({ phase: 4, course, obstacles, seed, onEvent: event => events.push(event) });
  assert.equal(game.start(), true);
  return { game, events };
}

test('penalty reports the actual signed deduction and clamps score at zero once per obstacle', () => {
  const { game, events } = setup({ obstacles: [obstacle('bag', 'litter', 1)] });
  game.score = 6;

  game.advance(1_160);
  game.advance(300);

  const contacts = events.filter(event => event.type === 'obstacle_contact');
  assert.equal(contacts.length, 1);
  assert.deepEqual({ obstacleType: contacts[0].obstacleType, points: contacts[0].points,
    nominalPenalty: contacts[0].nominalPenalty, score: contacts[0].score,
    scoreBefore: contacts[0].scoreBefore, status: contacts[0].status },
  { obstacleType: 'litter', points: -6, nominalPenalty: 10, score: 0, scoreBefore: 6, status: 'contacted' });
  assert.equal(game.obstacles[0].status, 'contacted');
  assert.equal(game.score, 0);
});

test('direct duplicate obstacleContact calls charge once per Phase 4 obstacle', () => {
  const { game, events } = setup({ obstacles: [obstacle('bird', 'crow', 1)] });
  game.score = 25;
  const target = game.obstacles[0];

  assert.equal(game.obstacleContact(target), true);
  assert.equal(game.obstacleContact(target), false);

  assert.equal(target.status, 'contacted');
  assert.equal(game.score, 15);
  assert.equal(events.filter(event => event.type === 'obstacle_contact').length, 1);
});

test('a same-time obstacle contact resolves before the collectible and leaves the pickup valid', () => {
  const { game, events } = setup({
    course: [bone('bone-at-contact', 1)],
    obstacles: [obstacle('cat', 'cat', 1.06)],
  });

  game.advance(1_000);

  const sameTime = events.filter(event => Math.abs(event.activeMs - 900) < 1e-7 &&
    ['obstacle_contact', 'collect'].includes(event.type));
  assert.deepEqual(sameTime.map(event => event.type), ['obstacle_contact', 'collect']);
  assert.equal(sameTime[0].score, 0);
  assert.equal(sameTime[0].points, 0);
  assert.equal(sameTime[1].score, 10);
  assert.equal(game.bones[0].status, 'collected');
});

test('contact keeps combo and permits the next collection at normal speed', () => {
  const { game, events } = setup({
    course: [bone('first', 0.5), bone('next', 1.2)],
    obstacles: [obstacle('bird', 'crow', 1)],
  });

  game.advance(1_100);

  assert.equal(game.combo, 2);
  assert.equal(game.collected, 2);
  assert.equal(game.speed, 1);
  assert.equal(game.distance, 1.1);
  assert.equal(game.score, 10);
  assert.equal(game.obstacles[0].status, 'contacted');
  assert.equal(events.filter(event => event.type === 'obstacle_contact').length, 1);
  assert.equal(events.some(event => ['combo_end', 'slow_end', 'suppression_end', 'combo_grace'].includes(event.type)), false);
  assert.equal(events.filter(event => event.type === 'collect').at(-1).combo, 2);
});

test('pause after a contact excludes hidden time and does not repeat its deduction', () => {
  const { game, events } = setup({ obstacles: [obstacle('bag', 'litter', 1)] });
  game.score = 25;
  game.advance(1_000);
  assert.equal(game.score, 15);
  assert.equal(game.pause('hidden'), true);
  const pausedAt = game.timeMs;
  game.advance(5_000);
  assert.equal(game.timeMs, pausedAt);
  assert.equal(game.resume(), true);
  game.advance(1_000);
  assert.equal(game.timeMs, 2_000);
  assert.equal(game.score, 15);
  assert.equal(events.filter(event => event.type === 'obstacle_contact').length, 1);
});

test('distinct simultaneous obstacles each charge once and do not interrupt the run', () => {
  const {game,events}=setup({obstacles:[obstacle('bag','litter',1),obstacle('cat','cat',1)]});
  game.score=25;
  game.advance(1100);
  assert.equal(game.score,5);
  const contacts=events.filter(e=>e.type==='obstacle_contact');
  assert.deepEqual(contacts.map(e=>[e.obstacleId,e.points]),[['bag',-10],['cat',-10]]);
  assert.equal(contacts[0].activeMs,contacts[1].activeMs);
  game.advance(1100);
  assert.equal(game.score,5);
  assert.equal(events.filter(e=>e.type==='obstacle_contact').length,2);
  assert.equal(game.state,'running');
});

test('contacts do not interrupt completion of all 30 active seconds', () => {
  const { game, events } = setup({ obstacles: [
    obstacle('bag', 'litter', 5),
    obstacle('bird', 'crow', 15),
    obstacle('cat', 'cat', 29),
  ] });
  game.score = 30;
  game.advance(PHASE4.durationMs);

  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, PHASE4.durationMs);
  assert.equal(game.distance, 30);
  assert.equal(game.speed, 1);
  assert.equal(game.result().completed, true);
  assert.equal(game.result().endReason, 'finish');
  assert.deepEqual(game.obstacles.map(item => item.status), ['contacted', 'contacted', 'contacted']);
  assert.equal(events.filter(event => event.type === 'obstacle_contact').length, 3);
  assert.equal(events.some(event => event.type === 'fall'), false);
});

test('obstacle collision includes the lateral boundary and excludes a point just outside it', () => {
  const atBoundary = setup({ obstacles: [obstacle('edge', 'crow', 1, 0.5)] }).game;
  atBoundary.advance(1_300);
  assert.equal(atBoundary.obstacles[0].status, 'contacted');

  const outsideBoundary = setup({ obstacles: [obstacle('outside', 'cat', 1, 0.500001)] }).game;
  outsideBoundary.advance(1_300);
  assert.equal(outsideBoundary.obstacles[0].status, 'passed');
  assert.equal(outsideBoundary.score, 0);
});
