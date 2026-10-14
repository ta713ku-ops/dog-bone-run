import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { PHASE2, PHASE4 } from '../src/config.js';
import { createSprintCourse } from '../src/sprint-course.js';

const bone = (id, distance, lane = 0, kind = 'normal') => ({ id, distance, timeMs: distance * 1000, lane, kind });
const obstacle = (id, type, distance, lane = 0) => ({ id, type, distance, lane });
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);

function setup({ course = [], obstacles = [], seed = 42 } = {}) {
  const events = [];
  const game = new Game({ phase: 4, course, obstacles, seed, onEvent: event => events.push(event) });
  assert.equal(game.start(), true);
  return { game, events };
}

test('Phase 4 loads the seeded sprint course and exposes its time-based display values', () => {
  const seed = 57;
  const data = createSprintCourse(seed);
  const game = new Game({ phase: 4, seed });
  assert.equal(game.phase, 4);
  assert.equal(game.seed, data.seed);
  assert.deepEqual(game.bones.map(({ id, distance, lane, kind, status }) => ({ id, distance, lane, kind, status })),
    data.bones.map(item => ({ id: item.id, distance: item.distance, lane: item.lane, kind: item.kind ?? 'normal', status: 'pending' })));
  assert.deepEqual(game.obstacles.map(({ id, type, distance, lane, status }) => ({ id, type, distance, lane, status })),
    data.obstacles.map(item => ({ id: item.id, type: item.type, distance: item.distance, lane: item.lane, status: 'pending' })));
  assert.deepEqual(game.goldIds, data.goldIds);
  assert.equal(game.goalDistance, 30);
  assert.equal(game.progress, 0);
  assert.equal(game.difficultyLevel, 1);

  for (const phase of [1, 2, 3]) {
    const legacy = new Game({ phase, course: [], obstacles: [] });
    assert.equal(legacy.goalDistance, PHASE2.goalDistance);
    assert.equal(legacy.progress, 0);
    assert.equal(legacy.difficultyLevel, 1);
  }
});

test('Phase 4 contact subtracts score but preserves normal speed and the 30-second finish', () => {
  const { game, events } = setup({ obstacles: [obstacle('litter', 'litter', 1)] });
  game.advance(PHASE4.durationMs);

  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 30_000);
  near(game.distance, 30);
  assert.equal(game.speed, 1);
  assert.equal(game.score, 0);
  const contact = events.find(event => event.type === 'obstacle_contact');
  assert.deepEqual({ points: contact.points, nominalPenalty: contact.nominalPenalty,
    score: contact.score, scoreBefore: contact.scoreBefore, status: contact.status },
  { points: 0, nominalPenalty: 10, score: 0, scoreBefore: 0, status: 'contacted' });
  assert.equal(game.result().completed, true);
  assert.equal(game.result().endReason, 'finish');
  assert.equal(game.result().progress, 1);
  assert.equal(game.progress, 1);
  near(game.goalDistance, game.distance);
  assert.equal(events.some(event => ['slow_end', 'suppression_end', 'fall'].includes(event.type)), false);
  assert.equal(events.filter(event => event.type === 'end').length, 1);
  assert.equal(events.at(-1).reason, 'finish');
});

test('goal distance, progress, and difficulty follow the fixed active-time course', () => {
  const { game } = setup({ obstacles: [obstacle('crow', 'crow', 1)] });
  game.advance(840);
  assert.equal(game.timeMs, 840);
  near(game.distance, 0.84);
  near(game.goalDistance, 30);
  assert.equal(game.speed, 1);
  near(game.progress, 840 / PHASE4.durationMs);
  assert.equal(game.difficultyLevel, 1);

  game.advance(4_160);
  assert.equal(game.timeMs, 5_000);
  assert.equal(game.difficultyLevel, 2);
  game.advance(5_000);
  assert.equal(game.difficultyLevel, 3);
  game.advance(5_000);
  assert.equal(game.difficultyLevel, 4);
  game.advance(5_000);
  assert.equal(game.difficultyLevel, 5);
  game.advance(5_000);
  assert.equal(game.difficultyLevel, 6);
});

test('pause excludes hidden time from the 30-second active clock', () => {
  const { game } = setup();
  game.advance(7_777);
  assert.equal(game.pause('hidden'), true);
  const paused = { timeMs: game.timeMs, distance: game.distance, progress: game.progress };
  game.advance(60_000);
  assert.equal(game.resume(), true);
  assert.deepEqual({ timeMs: game.timeMs, distance: game.distance, progress: game.progress }, paused);

  game.advance(22_223);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 30_000);
  assert.equal(game.distance, 30);
  assert.equal(game.result().completed, true);
});

test('obstacle contacts never fall or end Phase 4, and pause still freezes active time', () => {
  const { game, events } = setup({
    course: [bone('before-hole', 0.5)],
    obstacles: [obstacle('crow', 'crow', 1)],
  });
  game.advance(1_000);
  assert.equal(game.state, 'running');
  assert.equal(game.timeMs, 1_000);
  assert.equal(game.distance, 1);
  assert.equal(game.collected, 1);
  assert.equal(events.some(event => event.type === 'fall'), false);

  game.pause('hidden');
  game.advance(10_000);
  assert.equal(game.timeMs, 1_000);
  game.resume();
  game.advance(29_000);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 30_000);
  assert.equal(game.result().endReason, 'finish');
  assert.equal(events.filter(event => event.type === 'end').length, 1);
});

test('all distinct obstacle contacts resolve before the bone at the 30-second boundary', () => {
  const { game, events } = setup({
    course: [bone('boundary-bone', 30.1)],
    obstacles: [
      obstacle('bag', 'litter', 30.16),
      obstacle('bird', 'crow', 30.16),
      obstacle('cat', 'cat', 30.16),
    ],
  });
  game.score = 15;
  game.advance(30_000);

  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 30_000);
  assert.equal(game.distance, 30);
  const boundaryEvents = events.filter(event => event.activeMs === 30_000 &&
    ['obstacle_contact', 'collect'].includes(event.type));
  assert.deepEqual(boundaryEvents.map(event => event.type === 'collect' ? `collect:${event.boneId}` : `obstacle:${event.obstacleType}`),
    ['obstacle:litter', 'obstacle:crow', 'obstacle:cat', 'collect:boundary-bone']);
  const contacts = boundaryEvents.filter(event => event.type === 'obstacle_contact');
  assert.deepEqual(contacts.map(({ points, score, scoreBefore, status }) => ({ points, score, scoreBefore, status })), [
    { points: -10, score: 5, scoreBefore: 15, status: 'contacted' },
    { points: -5, score: 0, scoreBefore: 5, status: 'contacted' },
    { points: 0, score: 0, scoreBefore: 0, status: 'contacted' },
  ]);
  assert.ok(game.obstacles.every(item => item.status === 'contacted'));
  assert.equal(game.bones[0].status, 'collected');
  assert.equal(game.score, 10);
  assert.equal(game.result().completed, true);
  assert.equal(game.result().progress, 1);
  assert.equal(game.result().endReason, 'finish');
});

test('same-time Phase 4 obstacle contacts deduct independently before collection', () => {
  const { game, events } = setup({
    course: [bone('boundary-bone', 30.1)],
    obstacles: [obstacle('bird', 'crow', 30.16), obstacle('bag', 'litter', 30.16)],
  });
  game.score = 15;
  game.advance(30_000);
  const boundaryEvents = events.filter(event => event.activeMs === 30_000 &&
    ['obstacle_contact', 'collect'].includes(event.type));

  assert.deepEqual(boundaryEvents.map(event => event.type === 'collect' ? `collect:${event.boneId}` : `obstacle:${event.obstacleType}`),
    ['obstacle:crow', 'obstacle:litter', 'collect:boundary-bone']);
  assert.deepEqual(boundaryEvents.filter(event => event.type === 'obstacle_contact').map(event => event.points), [-10, -5]);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 30_000);
  assert.equal(game.distance, 30);
  assert.equal(game.result().completed, true);
  assert.equal(game.result().endReason, 'finish');
});

test('a complete safe course collects every bone before the 30-second result', () => {
  const course = Array.from({ length: 59 }, (_, index) =>
    bone(`bone-${index + 1}`, 0.5 + index * 0.5, 0, index === 58 ? 'gold' : 'normal'));
  const { game } = setup({ course });
  game.advance(30_000);

  assert.equal(game.state, 'result');
  assert.equal(game.result().placed, 59);
  assert.equal(game.result().collected, 59);
  assert.equal(game.normalCollected, 58);
  assert.equal(game.goldCollected, 1);
  assert.equal(game.result().completed, true);
  assert.equal(game.result().progress, 1);
});

test('the generated sprint course can be completed by following its bone route', () => {
  const seed = 42;
  const data = createSprintCourse(seed);
  const game = new Game({ phase: 4, seed });
  assert.equal(game.start(), true);

  for (const nextBone of game.bones) {
    const commandAt = Math.max(0, nextBone.distance * 1000 - 300);
    if (commandAt > game.timeMs) game.advance(commandAt - game.timeMs);
    if (game.state !== 'running') break;
    const target = game.move?.to ?? game.lane;
    if (target !== nextBone.lane) assert.equal(game.command(Math.sign(nextBone.lane - target)), true);
  }
  game.advance(Math.max(0, PHASE4.durationMs - game.timeMs));

  assert.equal(game.state, 'result');
  assert.equal(game.result().placed, data.bones.length);
  assert.equal(game.result().collected, data.bones.length);
  assert.equal(game.result().completed, true);
  assert.equal(game.result().endReason, 'finish');
  assert.equal(game.result().progress, 1);
  assert.deepEqual(game.goldIds, data.goldIds);
  assert.equal(game.obstacles.some(item => item.status === 'contacted'), false);
});

test('contact results are independent of advance cadence', () => {
  function run(stepMs) {
    const { game, events } = setup({
      course: [bone('first', 0.5), bone('during-crow', 1.5), bone('later', 4), bone('last', 10, 0, 'gold')],
      obstacles: [obstacle('crow', 'crow', 1), obstacle('cat', 'cat', 6)],
    });
    while (game.state === 'running') game.advance(Math.min(stepMs, 30_000 - game.timeMs));
    return {
      result: game.result(),
      events: events.filter(event => ['collect', 'obstacle_contact', 'end'].includes(event.type))
        .map(({ type, activeMs, boneId, obstacleId, obstacleType, points, score, completed, progress }) =>
          ({ type, activeMs, boneId, obstacleId, obstacleType, points, score, completed, progress })),
    };
  }
  const raf = run(1000 / 60), coarse = run(137);
  assert.deepEqual({ score: raf.result.score, collected: raf.result.collected, completed: raf.result.completed, endReason: raf.result.endReason, progress: raf.result.progress },
    { score: coarse.result.score, collected: coarse.result.collected, completed: coarse.result.completed, endReason: coarse.result.endReason, progress: coarse.result.progress });
  near(raf.result.distance, coarse.result.distance, 1e-6);
  assert.deepEqual(raf.events.map(event => [event.type, event.boneId ?? event.obstacleType]),
    coarse.events.map(event => [event.type, event.boneId ?? event.obstacleType]));
  raf.events.forEach((event, index) => near(event.activeMs, coarse.events[index].activeMs, 1e-6));
});

test('abandon reports partial time progress and reset restores the sprint start state', () => {
  const { game, events } = setup({ obstacles: [obstacle('litter', 'litter', 1)] });
  game.advance(840);
  game.abandon();
  const abandoned = events.findLast(event => event.type === 'end');
  assert.equal(abandoned.reason, 'quit');
  assert.equal(abandoned.endReason, 'quit');
  near(abandoned.progress, 840 / 30_000);
  assert.equal(abandoned.completed, false);
  assert.equal(game.state, 'ready');

  game.reset({ seed: 43 });
  assert.equal(game.state, 'ready');
  assert.equal(game.timeMs, 0);
  assert.equal(game.distance, 0);
  assert.equal(game.speed, 1);
  assert.equal(game.progress, 0);
  assert.equal(game.goalDistance, 30);
  assert.equal(game.difficultyLevel, 1);
  assert.equal(game.endReason, null);
  assert.equal(game.seed, 43);
  assert.equal(game.obstacles[0].status, 'pending');
});
