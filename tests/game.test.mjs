import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, tier } from '../src/config.js';
import { createCourse } from '../src/course.js';
import { Game } from '../src/game.js';

function makeGame(course = []) {
  const events = [];
  const game = new Game({ course, onEvent: event => events.push(event) });
  game.start();
  return { game, events };
}

function near(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('active time ends at 60 seconds and does not advance after the result', () => {
  const { game } = makeGame();
  game.advance(59_999);
  assert.equal(game.state, 'running');
  assert.equal(game.timeMs, 59_999);
  game.advance(1);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, CONFIG.durationMs);
  game.advance(10_000);
  assert.equal(game.timeMs, CONFIG.durationMs);
});

test('a fractional 60 fps remainder advances the final active time to exactly 60 seconds', () => {
  const { game } = makeGame();
  for (let frame = 0; frame < 3_599; frame++) game.advance(1_000 / 60);
  const remaining = CONFIG.durationMs - game.timeMs;
  assert.ok(remaining > 0);
  assert.notEqual(game.timeMs, Math.round(game.timeMs));
  game.advance(remaining);
  assert.equal(game.state, 'result');
  assert.equal(game.timeMs, CONFIG.durationMs);
});

test('commands are rejected while ready or after finishing, and reset clears a retry', () => {
  const events = [];
  const game = new Game({ course: [], onEvent: event => events.push(event) });
  assert.equal(game.command(1), false);
  assert.equal(events.at(-1).reason, 'not_running');
  game.start();
  game.command(1);
  game.advance(CONFIG.durationMs);
  assert.equal(game.state, 'result');
  assert.equal(game.command(-1), false);
  assert.equal(events.at(-1).reason, 'not_running');
  game.reset();
  assert.equal(game.state, 'ready');
  assert.equal(game.timeMs, 0);
  assert.equal(game.x, 0);
  assert.equal(game.lane, 0);
  assert.equal(game.move, null);
  assert.equal(game.queue, null);
  assert.equal(game.lastAcceptedMs, -Infinity);
  assert.equal(game.score, 0);
  assert.equal(game.combo, 0);
  assert.equal(game.maxCombo, 0);
  assert.equal(game.collected, 0);
  assert.equal(game.lastCollectMs, -Infinity);
  assert.equal(game.start(), true);
  assert.equal(game.command(-1), true);
});

test('a lane move is linear and completes in exactly 200 active milliseconds', () => {
  const { game } = makeGame();
  assert.equal(game.command(1), true);
  for (const [elapsed, x] of [[50, .25], [50, .5], [50, .75]]) {
    game.advance(elapsed);
    near(game.x, x);
    assert.equal(game.lane, 0);
  }
  game.advance(50);
  assert.equal(game.x, 1);
  assert.equal(game.lane, 1);
  assert.equal(game.move, null);
});

test('movement targets stay within the three lanes and edge rejection does not reset cooldown', () => {
  const { game, events } = makeGame();
  assert.equal(game.command(-1), true);
  game.advance(100);
  assert.equal(game.command(-1), false);
  assert.equal(events.at(-1).reason, 'edge');
  assert.equal(game.lastAcceptedMs, 0);
  assert.equal(game.command(1), true);
  assert.equal(game.queue, 0);
  game.advance(300);
  assert.equal(game.lane, 0);
  assert.ok([-1, 0, 1].includes(game.lane));
});

test('a rejected cooldown input does not move the next acceptance deadline', () => {
  const { game, events } = makeGame();
  assert.equal(game.command(1), true);
  game.advance(99);
  assert.equal(game.command(-1), false);
  assert.equal(events.at(-1).reason, 'cooldown');
  assert.equal(game.lastAcceptedMs, 0);
  game.advance(1);
  assert.equal(game.command(-1), true);
  assert.equal(game.lastAcceptedMs, 100);
  assert.equal(game.queue, 0);
});

test('a full queue rejects without replacing its target or resetting cooldown', () => {
  const { game, events } = makeGame();
  assert.equal(game.command(1), true);
  game.advance(100);
  assert.equal(game.command(-1), true);
  assert.equal(game.queue, 0);

  // Extend only this fixture's in-flight move to keep a queued command present
  // after its cooldown expires; normal 200 ms moves consume the queue first.
  game.move.endMs = 400;
  game.advance(100);
  assert.equal(game.command(-1), false);
  assert.equal(events.at(-1).reason, 'queue_full');
  assert.equal(game.queue, 0);
  assert.equal(game.lastAcceptedMs, 100);

  game.clearQueue('test');
  assert.equal(game.command(-1), true);
  assert.equal(game.lastAcceptedMs, 200);
});

test('a queued target is based on the current move target and starts after that move', () => {
  const { game, events } = makeGame();
  game.command(1);
  game.advance(100);
  assert.equal(game.x, .5);
  assert.equal(game.command(-1), true);
  assert.equal(game.queue, 0);
  const queued = events.find(event => event.type === 'queue_save');
  assert.equal(queued.toLane, 0);

  game.advance(100);
  assert.equal(game.lane, 1);
  assert.equal(game.move.from, 1);
  assert.equal(game.move.to, 0);
  near(game.x, 1);
  game.advance(100);
  near(game.x, .5);
  game.advance(100);
  assert.equal(game.lane, 0);
  assert.equal(game.x, 0);
});

test('queued same-direction moves can go from left through center to right', () => {
  const { game } = makeGame();
  assert.equal(game.command(-1), true);
  game.advance(100);
  assert.equal(game.command(1), true);
  assert.equal(game.queue, 0);
  game.advance(200);
  assert.equal(game.lane, -1);
  assert.equal(game.move.to, 0);
  assert.equal(game.command(1), true);
  assert.equal(game.queue, 1);
  game.advance(100);
  assert.equal(game.lane, 0);
  assert.equal(game.move.to, 1);
  game.advance(200);
  assert.equal(game.lane, 1);
});

test('cancel discards only the queued command and preserves the active movement', () => {
  const { game } = makeGame();
  game.command(1);
  game.advance(100);
  game.command(-1);
  const currentMove = game.move;
  game.cancel('pointer', { dx: -30, dy: 0 });
  assert.equal(game.queue, null);
  assert.equal(game.move, currentMove);
  near(game.x, .5);
  game.advance(100);
  assert.equal(game.lane, 1);
  assert.equal(game.move, null);
});

test('pause freezes active time and movement, and discards the queue', () => {
  const { game } = makeGame();
  game.command(1);
  game.advance(100);
  game.command(-1);
  const move = game.move;
  assert.equal(game.pause(), true);
  assert.equal(game.queue, null);
  assert.equal(game.move, move);
  const pausedTime = game.timeMs;
  const pausedX = game.x;
  game.advance(5_000);
  assert.equal(game.timeMs, pausedTime);
  assert.equal(game.x, pausedX);
  assert.equal(game.resume(), true);
  game.advance(100);
  assert.equal(game.timeMs, pausedTime + 100);
  assert.equal(game.lane, 1);
  assert.equal(game.move, null);
});

test('default course has two opening center bones and reaches both sides within ten seconds', () => {
  const course = createCourse();
  assert.ok(course.length >= 55, `expected at least 55 bones, got ${course.length}`);
  assert.deepEqual(course.slice(0, 2).map(({ lane, timeMs }) => ({ lane, timeMs })), [
    { lane: 0, timeMs: 2_000 },
    { lane: 0, timeMs: 2_800 },
  ]);
  const firstTenSeconds = course.filter(bone => bone.timeMs <= 10_000);
  assert.ok(firstTenSeconds.some(bone => bone.lane === -1));
  assert.ok(firstTenSeconds.some(bone => bone.lane === 1));
});

test('course spacing follows lane changes, avoids direct opposites, and ends before the miss window', () => {
  const course = createCourse();
  for (let index = 1; index < course.length; index++) {
    const previous = course[index - 1];
    const current = course[index];
    assert.ok(Math.abs(current.lane - previous.lane) <= 1, `direct opposite at ${previous.id}/${current.id}`);
    assert.equal(current.timeMs - previous.timeMs, current.lane === previous.lane ? 800 : 1_000);
  }
  assert.ok(course.at(-1).timeMs + 100 < CONFIG.durationMs);
});

test('the fixed route can be collected end to end with a 50-plus combo', () => {
  const course = createCourse();
  const { game, events } = makeGame(course);
  let playerLane = 0;
  for (const bone of course) {
    if (bone.lane !== playerLane) {
      game.advance(bone.timeMs - 300 - game.timeMs);
      assert.equal(game.command(bone.lane - playerLane), true, `move to lane ${bone.lane} before ${bone.id}`);
      playerLane = bone.lane;
    }
  }
  game.advance(CONFIG.durationMs - game.timeMs);
  assert.equal(game.collected, course.length);
  assert.equal(game.maxCombo, course.length);
  assert.ok(game.maxCombo >= 50);
  assert.ok(events.every(event => event.type !== 'miss'));
});

test('fixed update stepping detects a moving collision and collects each bone only once', () => {
  const { game, events } = makeGame([{ id: 'moving-hit', lane: 1, timeMs: 1_000 }]);
  game.advance(900);
  assert.equal(game.command(1), true);
  game.advance(300);
  const collects = events.filter(event => event.type === 'collect');
  assert.equal(collects.length, 1);
  assert.equal(collects[0].boneId, 'moving-hit');
  assert.ok(collects[0].x >= .66 && collects[0].x <= 1);
  assert.equal(game.collected, 1);
  game.advance(500);
  assert.equal(events.filter(event => event.type === 'collect').length, 1);
});

test('hitbox limits are inclusive at 100 ms and 0.34 lane units', () => {
  const { game } = makeGame();
  const bone = { lane: 0, timeMs: 1_000 };
  near(game.contactTime(bone, 900, 1_000, 0, 0), 900);
  near(game.contactTime(bone, 1_100, 1_200, 0, 0), 1_100);
  near(game.contactTime(bone, 900, 1_100, .34, .34), 900);
  near(game.contactTime(bone, 900, 1_100, -.34, -.34), 900);
  assert.equal(game.contactTime(bone, 899, 899.9, 0, 0), null);
  assert.equal(game.contactTime(bone, 1_100.1, 1_200, 0, 0), null);
  assert.equal(game.contactTime(bone, 900, 1_100, .340001, .340001), null);
  assert.equal(game.contactTime(bone, 900, 1_100, -.340001, -.340001), null);
});

test('a bone is still pending at +100 ms and misses only after that boundary', () => {
  const { game, events } = makeGame([{ id: 'late', lane: 1, timeMs: 1_000 }]);
  game.advance(1_100);
  assert.equal(game.bones[0].status, 'pending');
  assert.equal(events.filter(event => event.type === 'miss').length, 0);
  game.advance(.01);
  assert.equal(game.bones[0].status, 'miss');
  const miss = events.find(event => event.type === 'miss');
  assert.equal(miss.boneId, 'late');
  assert.equal(miss.activeMs, 1_100);
});

test('combo continues through 1199 and 1200 ms gaps, but ends for 1201 ms', async t => {
  for (const gap of [1_199, 1_200, 1_201]) {
    await t.test(`${gap} ms`, () => {
      const { game, events } = makeGame([
        { id: 'first', lane: 0, timeMs: 1_000 },
        { id: 'second', lane: 0, timeMs: 1_000 + gap },
      ]);
      game.advance(1_000 + gap + 150);
      const collects = events.filter(event => event.type === 'collect');
      const timeoutEnds = events.filter(event => event.type === 'combo_end' && event.reason === 'timeout');
      assert.equal(collects.length, 2);
      if (gap <= 1_200) {
        assert.deepEqual(collects.map(event => event.combo), [1, 2]);
        assert.equal(timeoutEnds.length, 0);
      } else {
        assert.deepEqual(collects.map(event => event.combo), [1, 1]);
        assert.equal(timeoutEnds.length, 1);
        assert.equal(timeoutEnds[0].activeMs, 2_100);
      }
    });
  }
});

test('tier score, level, multiplier, and milestone thresholds fire exactly once', () => {
  const bones = Array.from({ length: 55 }, (_, index) => ({
    id: `tier-${index + 1}`,
    lane: 0,
    timeMs: 1_000 + index * 300,
  }));
  const { game, events } = makeGame(bones);
  game.advance(bones.at(-1).timeMs + 150);
  const collects = events.filter(event => event.type === 'collect');
  assert.equal(collects.length, bones.length);
  const milestones = collects.filter(event => event.milestone).map(event => [event.combo, event.milestone]);
  assert.deepEqual(milestones, [[10, 'GOOD'], [20, 'NICE'], [30, 'GREAT'], [50, 'PERFECT']]);
  for (const [combo, points, level, multiplier] of [
    [9, 10, 1, 1], [10, 12, 2, 1.2], [19, 12, 2, 1.2],
    [20, 15, 3, 1.5], [29, 15, 3, 1.5], [30, 20, 4, 2],
    [49, 20, 4, 2], [50, 20, 5, 2], [55, 20, 5, 2],
  ]) {
    assert.equal(collects[combo - 1].points, points, `points at combo ${combo}`);
    assert.equal(collects[combo - 1].level, level, `level at combo ${combo}`);
    assert.equal(collects[combo - 1].multiplier, multiplier, `multiplier at combo ${combo}`);
  }
  assert.deepEqual(tier(9), { multiplier: 1, level: 1, milestone: null });
  assert.deepEqual(tier(10), { multiplier: 1.2, level: 2, milestone: 'GOOD' });
  assert.deepEqual(tier(20), { multiplier: 1.5, level: 3, milestone: 'NICE' });
  assert.deepEqual(tier(30), { multiplier: 2, level: 4, milestone: 'GREAT' });
  assert.deepEqual(tier(50), { multiplier: 2, level: 5, milestone: 'PERFECT' });
});

test('render update cadence does not change the result for a scripted input schedule', () => {
  const schedule = [
    { at: 500, direction: 1 },
    { at: 900, direction: -1 },
    { at: 1_500, direction: 1 },
    { at: 1_800, direction: -1 },
    { at: 2_400, direction: 1 },
  ];
  const course = [
    { id: 'cadence-1', lane: 0, timeMs: 1_000 },
    { id: 'cadence-2', lane: 1, timeMs: 2_000 },
    { id: 'cadence-3', lane: 0, timeMs: 3_000 },
  ];
  function run(cadence) {
    const { game, events } = makeGame(course);
    let scheduleIndex = 0;
    let cursor = 0;
    while (cursor < CONFIG.durationMs) {
      const nextScheduled = schedule[scheduleIndex]?.at ?? Infinity;
      const target = Math.min(cursor + cadence(), nextScheduled, CONFIG.durationMs);
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
      events: events.map(({ type, activeMs, boneId, lane, x, points, score, combo, reason }) =>
        ({ type, activeMs, boneId, lane, x, points, score, combo, reason })),
    };
  }
  const fast = run(() => 1_000 / 60);
  const slow = run(() => 137);
  const irregularDeltas = [7, 41, 113, 29, 251, 83];
  let index = 0;
  const irregular = run(() => irregularDeltas[index++ % irregularDeltas.length]);
  assert.deepEqual(slow, fast);
  assert.deepEqual(irregular, fast);
});
