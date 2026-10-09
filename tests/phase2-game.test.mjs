import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { createPhase2Course } from '../src/phase2-course.js';

function near(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function equivalentAcrossCadences(actual, expected, path = '$') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isInteger(actual) && Number.isInteger(expected)) {
      assert.equal(actual, expected, `${path} should match exactly`);
    } else {
      near(actual, expected, 1e-6);
    }
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path} length should match`);
    for (let index = 0; index < actual.length; index++) {
      equivalentAcrossCadences(actual[index], expected[index], `${path}[${index}]`);
    }
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys should match`);
    for (const key of Object.keys(expected)) {
      equivalentAcrossCadences(actual[key], expected[key], `${path}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, `${path} should match`);
}

function makeGame({ course = [], obstacles = [], seed = 41 } = {}) {
  const events = [];
  const game = new Game({
    phase: 2,
    course,
    obstacles,
    seed,
    onEvent: event => events.push(event),
  });
  assert.equal(game.start(), true);
  return { game, events };
}

function eventsOf(events, type) {
  return events.filter(event => event.type === type);
}

function bone(id, distance, lane = 0, kind = 'normal') {
  return { id, distance, lane, kind };
}

function obstacle(id, type, distance, lane = 0) {
  return { id, type, distance, lane };
}

test('Phase 2 finishes at 60 distance, with active time independent of the goal', () => {
  const { game } = makeGame();
  game.advance(59_999);
  assert.equal(game.state, 'running');
  assert.equal(game.timeMs, 59_999);
  assert.ok(Math.abs(game.distance - 59.999) < 1e-9);

  game.advance(1);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 60_000);
  assert.equal(game.distance, 60);
  assert.deepEqual(
    { completed: game.result().completed, progress: game.result().progress, distance: game.result().distance, phase: game.result().phase },
    { completed: true, progress: 1, distance: 60, phase: 2 },
  );
  game.advance(10_000);
  assert.equal(game.distance, 60);
  assert.equal(game.timeMs, 60_000);
});

test('one puddle slows to 0.6 for exactly 1000 active ms and suppresses combo timeout for 1300 ms', () => {
  const { game, events } = makeGame({ obstacles: [obstacle('puddle-a', 'puddle', 1)] });

  game.advance(839.999);
  assert.equal(game.speed, 1);
  assert.equal(eventsOf(events, 'obstacle_contact').length, 0);
  game.advance(0.001);
  assert.equal(game.timeMs, 840);
  near(game.distance, 0.84);
  assert.equal(game.speed, 0.6);
  assert.equal(game.slowUntilMs, 1_840);
  assert.equal(game.suppressUntilMs, 2_140);
  assert.deepEqual(eventsOf(events, 'obstacle_contact').map(({ obstacleId, obstacleType, ignored }) => ({ obstacleId, obstacleType, ignored })), [
    { obstacleId: 'puddle-a', obstacleType: 'puddle', ignored: false },
  ]);

  game.advance(999.999);
  assert.equal(game.timeMs, 1_839.999);
  assert.equal(game.speed, 0.6);
  assert.ok(Math.abs(game.distance - 1.4399994) < 1e-9);
  game.advance(0.001);
  assert.equal(game.timeMs, 1_840);
  assert.equal(game.speed, 1);
  assert.equal(eventsOf(events, 'slow_end').length, 1);
  assert.equal(eventsOf(events, 'slow_end')[0].activeMs, 1_840);
  assert.equal(game.suppressUntilMs, 2_140);
});

test('a second puddle touched as the first slow ends is consumed during suppression and never queued', () => {
  const { game, events } = makeGame({ obstacles: [
    obstacle('first', 'puddle', 1),
    obstacle('second', 'puddle', 1.6),
  ] });

  game.advance(1_840);
  const contacts = eventsOf(events, 'obstacle_contact');
  assert.deepEqual(contacts.map(({ obstacleId, obstacleType, ignored }) => ({ obstacleId, obstacleType, ignored })), [
    { obstacleId: 'first', obstacleType: 'puddle', ignored: false },
    { obstacleId: 'second', obstacleType: 'puddle', ignored: true },
  ]);
  assert.deepEqual(contacts.map(event => event.activeMs), [840, 1_840]);
  assert.equal(game.speed, 1);
  assert.equal(game.suppressUntilMs, 2_140);

  game.advance(5_000);
  assert.equal(game.speed, 1);
  assert.equal(eventsOf(events, 'slow_end').length, 1);
  assert.equal(eventsOf(events, 'obstacle_contact').length, 2);
});

test('a live combo survives suppression and receives a fresh 1200 active ms grace period', () => {
  const { game, events } = makeGame({
    course: [bone('before-water', 0.5)],
    obstacles: [obstacle('water', 'puddle', 1)],
  });

  game.advance(840);
  assert.equal(game.combo, 1);
  assert.equal(game.timeMs, 840);
  game.advance(1_299);
  assert.equal(game.combo, 1);
  assert.equal(eventsOf(events, 'combo_end').filter(event => event.reason === 'timeout').length, 0);
  game.advance(1);
  assert.equal(game.timeMs, 2_140);
  assert.equal(game.combo, 1);
  assert.equal(eventsOf(events, 'combo_end').filter(event => event.reason === 'timeout').length, 0);

  game.advance(1_200);
  assert.equal(game.combo, 1);
  game.advance(1);
  assert.equal(game.combo, 0);
  assert.equal(eventsOf(events, 'combo_end').filter(event => event.reason === 'timeout').length, 1);
});

test('trash clears a combo during water suppression and the cleared combo never returns', () => {
  const { game, events } = makeGame({
    course: [bone('before-water', 0.5)],
    obstacles: [
      obstacle('water', 'puddle', 1),
      obstacle('trash-in-suppression', 'trash', 1.3),
    ],
  });

  game.advance(840);
  assert.equal(game.combo, 1);
  assert.equal(game.suppressUntilMs, 2_140);
  game.advance(500);
  assert.equal(game.timeMs, 1_340);
  assert.equal(game.combo, 0);
  assert.equal(game.score, 10);
  assert.equal(game.collected, 1);
  assert.equal(eventsOf(events, 'combo_end').filter(event => event.reason === 'trash').length, 1);
  assert.equal(eventsOf(events, 'combo_end').filter(event => event.reason === 'timeout').length, 0);

  game.advance(800);
  assert.equal(game.timeMs, 2_140);
  assert.equal(game.combo, 0);
  assert.equal(eventsOf(events, 'combo_grace').length, 0);
  game.advance(1_201);
  assert.equal(game.combo, 0);
  assert.equal(eventsOf(events, 'combo_grace').length, 0);
  assert.equal(eventsOf(events, 'combo_end').filter(event => event.reason === 'timeout').length, 0);
});

test('a second puddle in the final 300 ms of suppression is ignored after slow_end', () => {
  const { game, events } = makeGame({ obstacles: [
    obstacle('first', 'puddle', 1),
    obstacle('late-second', 'puddle', 1.76),
  ] });

  game.advance(1_840);
  assert.equal(game.speed, 1);
  assert.equal(game.suppressUntilMs, 2_140);
  assert.equal(eventsOf(events, 'slow_end').length, 1);
  game.advance(160);

  const contacts = eventsOf(events, 'obstacle_contact');
  assert.equal(game.timeMs, 2_000);
  assert.deepEqual(contacts.map(({ obstacleId, obstacleType, ignored }) => ({ obstacleId, obstacleType, ignored })), [
    { obstacleId: 'first', obstacleType: 'puddle', ignored: false },
    { obstacleId: 'late-second', obstacleType: 'puddle', ignored: true },
  ]);
  assert.equal(contacts[1].activeMs, 2_000);
  assert.equal(game.speed, 1);
  assert.equal(game.suppressUntilMs, 2_140);

  game.advance(2_000);
  assert.equal(game.speed, 1);
  assert.equal(eventsOf(events, 'obstacle_contact').length, 2);
  assert.equal(eventsOf(events, 'slow_end').length, 1);
});

test('a bone collected after the old timeout during suppression still reaches its normal score tier', () => {
  const course = Array.from({ length: 9 }, (_, index) => bone(`opening-${index + 1}`, 0.2 + index * 0.05));
  course.push(bone('tenth-during-water', 1.46));
  const { game, events } = makeGame({ course, obstacles: [obstacle('water', 'puddle', 1)] });

  game.advance(840);
  assert.equal(game.combo, 9);
  assert.equal(game.score, 90);
  assert.equal(game.speed, 0.6);
  assert.equal(game.suppressUntilMs, 2_140);
  game.advance(867);

  const collects = eventsOf(events, 'collect');
  assert.equal(collects.length, 10);
  const tenth = collects.at(-1);
  assert.equal(tenth.boneId, 'tenth-during-water');
  assert.ok(tenth.activeMs > 1_700 && tenth.activeMs < 1_840);
  assert.equal(tenth.kind, 'normal');
  assert.equal(tenth.combo, 10);
  assert.equal(tenth.multiplier, 1.2);
  assert.equal(tenth.points, 12);
  assert.equal(game.combo, 10);
  assert.equal(game.score, 102);
  assert.equal(game.collected, 10);
  assert.equal(game.normalCollected, 10);
  assert.equal(game.goldCollected, 0);
});

test('trash clears only combo, while empty and trash-only runs finish with zero collection stats', () => {
  const comboRun = makeGame({
    course: [bone('one', 0.5)],
    obstacles: [obstacle('trash', 'trash', 1.5)],
  });
  comboRun.game.advance(1_340);
  assert.equal(comboRun.game.combo, 0);
  assert.equal(comboRun.game.score, 10);
  assert.equal(comboRun.game.collected, 1);
  assert.equal(comboRun.game.maxCombo, 1);

  const emptyRun = makeGame({ obstacles: [obstacle('only-trash', 'trash', 1)] });
  emptyRun.game.advance(60_000);
  assert.equal(emptyRun.game.state, 'result');
  assert.equal(emptyRun.game.distance, 60);
  assert.equal(emptyRun.game.speed, 1);
  assert.deepEqual(
    (({ score, collected, normalCollected, goldCollected, maxCombo, completed }) =>
      ({ score, collected, normalCollected, goldCollected, maxCombo, completed }))(emptyRun.game.result()),
    { score: 0, collected: 0, normalCollected: 0, goldCollected: 0, maxCombo: 0, completed: true },
  );
  assert.equal(eventsOf(emptyRun.events, 'collect').length, 0);
});

test('same-time contacts resolve trash, then puddle, then bone', () => {
  const { game, events } = makeGame({
    course: [bone('combo-seed', 0.5), bone('at-hazards', 1)],
    // Reverse the two hazards in input order: sorting must follow their priority.
    obstacles: [
      obstacle('water-first-in-array', 'puddle', 1.06),
      obstacle('trash-second-in-array', 'trash', 1.06),
    ],
  });

  game.advance(900);
  const atSharedBoundary = events.filter(event => Math.abs(event.activeMs - 900) < 1e-7 &&
    ['obstacle_contact', 'collect'].includes(event.type));
  assert.deepEqual(atSharedBoundary.map(event => event.type === 'collect'
    ? `collect:${event.boneId}`
    : `obstacle:${event.obstacleType}`), [
    'obstacle:trash',
    'obstacle:puddle',
    'collect:at-hazards',
  ]);
  assert.equal(game.combo, 1);
  assert.equal(game.score, 20);
  assert.equal(game.collected, 2);
  assert.equal(game.speed, 0.6);
});

test('gold bones score 50 base points and use the same tier multiplier as normal bones', () => {
  const course = Array.from({ length: 10 }, (_, index) =>
    bone(`tier-${index + 1}`, 1 + index * 0.5, 0, index === 9 ? 'gold' : 'normal'));
  const { game, events } = makeGame({ course });
  game.advance(5_600);

  const collects = eventsOf(events, 'collect');
  assert.equal(collects.length, 10);
  assert.equal(collects[0].kind, 'normal');
  assert.equal(collects[0].points, 10);
  assert.equal(collects[8].combo, 9);
  assert.equal(collects[8].points, 10);
  assert.equal(collects[9].kind, 'gold');
  assert.equal(collects[9].combo, 10);
  assert.equal(collects[9].multiplier, 1.2);
  assert.equal(collects[9].points, 60);
  assert.equal(game.score, 150);
  assert.equal(game.normalCollected, 9);
  assert.equal(game.goldCollected, 1);
  assert.equal(game.result().collected, 10);
});

test('bone collision sweeps moving x and accepts the inclusive 0.34 width and 0.10 length boundary', () => {
  const { game, events } = makeGame({ course: [bone('moving-bone', 1, 1)] });
  game.advance(900);
  assert.equal(game.command(1), true);
  game.advance(131.999);
  assert.equal(eventsOf(events, 'collect').length, 0);
  game.advance(0.001);
  const collect = eventsOf(events, 'collect')[0];
  assert.equal(collect.boneId, 'moving-bone');
  assert.ok(Math.abs(collect.activeMs - 1_032) < 1e-7);
  assert.ok(Math.abs(collect.x - 0.66) < 1e-7);
  game.advance(1_000);
  assert.equal(eventsOf(events, 'collect').length, 1);

  const edge = makeGame({ course: [bone('inclusive-edge', 1, 0.34)] });
  edge.game.advance(900);
  assert.equal(eventsOf(edge.events, 'collect').length, 1);

  const outside = makeGame({ course: [bone('outside-edge', 1, 0.340001)] });
  outside.game.advance(1_101);
  assert.equal(eventsOf(outside.events, 'collect').length, 0);
});

test('obstacle collision sweeps moving x and accepts the inclusive 0.5 width and 0.16 length boundary once', () => {
  const { game, events } = makeGame({ obstacles: [obstacle('moving-obstacle', 'trash', 0.84, 1)] });
  game.advance(700);
  assert.equal(game.command(1), true);
  game.advance(100);
  const contact = eventsOf(events, 'obstacle_contact')[0];
  assert.equal(contact.obstacleId, 'moving-obstacle');
  assert.equal(contact.obstacleType, 'trash');
  assert.equal(contact.ignored, false);
  assert.ok(Math.abs(contact.activeMs - 800) < 1e-7);
  game.advance(1_000);
  assert.equal(eventsOf(events, 'obstacle_contact').length, 1);

  const edge = makeGame({ obstacles: [obstacle('inclusive-edge', 'trash', 1, 0.5)] });
  edge.game.advance(840);
  assert.equal(eventsOf(edge.events, 'obstacle_contact').length, 1);

  const outside = makeGame({ obstacles: [obstacle('outside-edge', 'trash', 1, 0.500001)] });
  outside.game.advance(1_160);
  assert.equal(eventsOf(outside.events, 'obstacle_contact').length, 0);
});

test('pause freezes active time, distance, slowdown, and a 200 ms lane move', () => {
  const { game, events } = makeGame({ obstacles: [obstacle('water', 'puddle', 1)] });
  game.advance(840);
  assert.equal(game.speed, 0.6);
  assert.equal(game.command(1), true);
  game.advance(50);
  assert.equal(game.x, 0.25);

  assert.equal(game.pause(), true);
  const snapshot = {
    timeMs: game.timeMs,
    distance: game.distance,
    x: game.x,
    speed: game.speed,
    slowUntilMs: game.slowUntilMs,
    suppressUntilMs: game.suppressUntilMs,
    moveEndMs: game.move.endMs,
  };
  game.advance(10_000);
  assert.deepEqual({
    timeMs: game.timeMs,
    distance: game.distance,
    x: game.x,
    speed: game.speed,
    slowUntilMs: game.slowUntilMs,
    suppressUntilMs: game.suppressUntilMs,
    moveEndMs: game.move.endMs,
  }, snapshot);

  assert.equal(game.resume(), true);
  game.advance(150);
  assert.equal(game.timeMs, snapshot.timeMs + 150);
  assert.ok(Math.abs(game.distance - (snapshot.distance + 0.09)) < 1e-9);
  assert.equal(game.lane, 1);
  assert.equal(game.move, null);
  assert.equal(game.speed, 0.6);
  game.advance(850);
  assert.equal(game.timeMs, 1_890);
  assert.equal(game.speed, 1);
  assert.equal(eventsOf(events, 'slow_end').length, 1);
});

test('lane movement remains exactly 200 active ms while a puddle slowdown is active', () => {
  const { game } = makeGame({ obstacles: [obstacle('water', 'puddle', 1)] });
  game.advance(840);
  assert.equal(game.speed, 0.6);
  assert.equal(game.command(1), true);
  game.advance(199.999);
  assert.equal(game.move !== null, true);
  assert.equal(game.lane, 0);
  game.advance(0.001);
  assert.equal(game.move, null);
  assert.equal(game.lane, 1);
  assert.equal(game.timeMs, 1_040);
  assert.equal(game.speed, 0.6);
  assert.ok(Math.abs(game.distance - 0.96) < 1e-9);
});

test('retry restores the exact Phase 2 start state and makes consumed effects available again', () => {
  const { game, events } = makeGame({
    course: [bone('retry-bone', 0.5)],
    obstacles: [obstacle('retry-water', 'puddle', 1)],
    seed: 20261003,
  });
  game.advance(840);
  assert.equal(game.speed, 0.6);
  near(game.distance, 0.84);
  game.advance(100);
  assert.ok(game.distance > 0.84);

  game.reset();
  assert.equal(game.state, 'ready');
  assert.equal(game.timeMs, 0);
  assert.equal(game.distance, 0);
  assert.equal(game.speed, 1);
  assert.equal(game.x, 0);
  assert.equal(game.lane, 0);
  assert.equal(game.score, 0);
  assert.equal(game.combo, 0);
  assert.equal(game.maxCombo, 0);
  assert.equal(game.collected, 0);
  assert.equal(game.normalCollected, 0);
  assert.equal(game.goldCollected, 0);
  assert.ok(game.slowUntilMs <= game.timeMs);
  assert.ok(game.suppressUntilMs <= game.timeMs);
  assert.equal(game.start(), true);
  game.advance(840);
  assert.equal(game.speed, 0.6);
  assert.equal(game.distance, 0.84);
  assert.equal(eventsOf(events, 'obstacle_contact').length, 2);
});

test('one full puddle extends the 60-distance finish to exactly 60400 active ms', () => {
  const { game } = makeGame({ obstacles: [obstacle('only-water', 'puddle', 1)] });
  game.advance(60_399);
  assert.equal(game.state, 'running');
  near(game.distance, 59.999);
  game.advance(1);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, 60_400);
  assert.equal(game.distance, 60);
  assert.equal(game.result().completed, true);
});

test('seeded fixed course and golden IDs survive on the Phase 2 game and its result', () => {
  const seed = 20261003;
  const game = new Game({ phase: 2, seed });
  const repeated = createPhase2Course(seed);
  game.start();
  assert.equal(game.seed, seed);
  assert.equal(game.result().seed, seed);
  assert.ok(Array.isArray(game.goldIds));
  assert.equal(game.goldIds.length, 2);
  assert.equal(new Set(game.goldIds).size, 2);
  assert.deepEqual(game.goldIds, repeated.goldIds);
  assert.deepEqual(game.bones.filter(item => item.kind === 'gold').map(item => item.id), game.goldIds);
  assert.deepEqual(game.bones.map(({ id, distance, lane, kind }) => ({ id, distance, lane, kind })),
    repeated.bones.map(({ id, distance, lane, kind }) => ({ id, distance, lane, kind })));
  assert.deepEqual(game.obstacles.map(({ id, type, distance, lane }) => ({ id, type, distance, lane })),
    repeated.obstacles.map(({ id, type, distance, lane }) => ({ id, type, distance, lane })));
});

test('render update cadence does not change Phase 2 contacts, score, distance, or result', () => {
  const schedule = [
    { at: 500, direction: 1 },
    { at: 900, direction: -1 },
    { at: 1_500, direction: 1 },
    { at: 1_800, direction: -1 },
  ];
  const course = [
    bone('cadence-center', 1, 0),
    bone('cadence-right', 2, 1),
    bone('cadence-center-again', 3, 0),
  ];
  const obstacles = [obstacle('cadence-water', 'puddle', 1.2, 0)];

  function run(cadence) {
    const { game, events } = makeGame({ course, obstacles, seed: 77 });
    let scheduleIndex = 0;
    let cursor = 0;
    while (game.state === 'running') {
      const nextScheduled = schedule[scheduleIndex]?.at ?? Infinity;
      const target = Math.min(cursor + cadence(), nextScheduled);
      assert.ok(target > cursor, `cadence made no progress at ${cursor} ms`);
      game.advance(target - cursor);
      cursor = target;
      if (schedule[scheduleIndex]?.at === cursor) {
        game.command(schedule[scheduleIndex].direction, 'script');
        scheduleIndex++;
      }
    }
    return {
      result: game.result(),
      events: events.map(({ type, activeMs, boneId, kind, obstacleId, obstacleType, ignored, x, points, score, combo, reason }) =>
        ({ type, activeMs, boneId, kind, obstacleId, obstacleType, ignored, x, points, score, combo, reason })),
    };
  }

  const fast = run(() => 1_000 / 60);
  const slow = run(() => 137);
  const deltas = [7, 41, 113, 29, 251, 83];
  let index = 0;
  const irregular = run(() => deltas[index++ % deltas.length]);
  equivalentAcrossCadences(slow, fast);
  equivalentAcrossCadences(irregular, fast);
});
