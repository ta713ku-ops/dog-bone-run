import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { createParkCourse, parkObstacleLaneAt, parkObstacleVisibleAt } from '../src/park-course.js';

function playSafeRoute(seed) {
  const events = [];
  const game = new Game({ phase: 4, seed, walkLevel: 2, onEvent: event => events.push(event) });
  game.start();
  for (const input of game.courseData.safeInputs) {
    game.advance(input.timeMs - game.timeMs);
    game.command(input.direction, 'safe-route');
  }
  game.advance(game.durationMs - game.timeMs);
  return { game, events };
}

test('Level 2 exposes its course and result diagnostics and the safe course clears through real Game', () => {
  for (const seed of [0, 7, 16, 23, 31]) {
    const { game, events } = playSafeRoute(seed);
    assert.equal(game.walkLevel, 2);
    assert.equal(game.durationMs, 30_000);
    assert.equal(game.speed, 1.1);
    assert.equal(game.courseData.bones.length, 48);
    assert.equal(game.courseData.obstacles.length, 32);
    assert.equal(game.courseData.ruleVersion, 'park30-level2-v2');
    assert.equal(game.courseData.courseVersion, 'park-level2-course-2');
    assert.equal(game.courseData.generation.safeInputCount, game.courseData.safeInputs.length);
    assert.equal(game.collected, 48);
    assert.equal(game.normalCollected, 45);
    assert.equal(game.goldCollected, 3);
    assert.equal(game.contactCount, 0);
    assert.equal(game.contactEventCount, 0);
    assert.equal(game.state, 'result');
    assert.equal(game.timeMs, 30_000);
    assert.equal(game.result().walkLevel, 2);
    assert.equal(game.result().durationMs, 30_000);
    assert.equal(game.result().speed, 1.1);
    assert.equal(game.result().contactCount, 0);
    assert.equal(game.result().contactEventCount, 0);
    assert.deepEqual(events.filter(event => event.type === 'input' && !event.accepted), []);

    const visibilityEvents = events.filter(event => event.type === 'obstacle_visible');
    const courseEvents = new Map();
    for (const obstacle of game.courseData.obstacles) courseEvents.set(obstacle.eventId, obstacle);
    assert.equal(visibilityEvents.length, 26);
    assert.equal(new Set(visibilityEvents.map(event => event.eventId)).size, 26);
    assert.equal(events.some(event => event.type === 'obstacle_warning'), false);
    for (const visible of visibilityEvents) {
      assert.equal(visible.activeMs, courseEvents.get(visible.eventId).visibleStartMs);
      assert.equal(visible.visibleStartMs, courseEvents.get(visible.eventId).visibleStartMs);
      assert.equal(visible.obstacleType, courseEvents.get(visible.eventId).type);
      assert.ok(visible.obstacleId);
    }
  }
});

test('Level 2 keeps the safe route clear when a crow-adjacent input is 60 ms early', () => {
  const course = createParkCourse(0);
  const events = [];
  const game = new Game({ phase: 4, seed: 0, walkLevel: 2, onEvent: event => events.push(event) });
  game.start();
  for (let index = 0; index < course.safeInputs.length; index++) {
    const input = course.safeInputs[index];
    const timeMs = input.timeMs + (index === 6 ? -60 : 0);
    game.advance(timeMs - game.timeMs);
    game.command(input.direction, 'crow-margin-regression');
  }
  game.advance(game.durationMs - game.timeMs);
  assert.equal(game.collected, 48);
  assert.equal(game.contactCount, 0);
  assert.deepEqual(events.filter(event => event.type === 'input' && !event.accepted), []);
});

test('Level 2 emits body visibility when advance ends exactly at visibleStartMs', () => {
  const course = createParkCourse(0);
  const target = course.obstacles.find(obstacle => obstacle.eventId === 'park-event-01');
  const events = [];
  const game = new Game({ phase: 4, seed: 0, walkLevel: 2, onEvent: event => events.push(event) });
  game.start();
  game.advance(target.visibleStartMs);
  assert.deepEqual(events.filter(event => event.type === 'obstacle_visible'), [{
    type: 'obstacle_visible',
    activeMs: target.visibleStartMs,
    obstacleType: target.type,
    eventId: target.eventId,
    obstacleId: target.id,
    visibleStartMs: target.visibleStartMs,
    lane: target.lane,
    targetLanes: [target.lane],
  }]);
});

test('Level 2 counts each contacted obstacle once and groups contacts by event', () => {
  const events = [];
  const sharedArrival = 1_000 + ((0.06 + 0.10) - (0.06 + 0.04)) * 1000 / 1.1;
  const game = new Game({
    phase: 4,
    walkLevel: 2,
    course: [{ id: 'shared-bone', lane: 0, timeMs: 1_000, distance: 1.1, kind: 'normal' }],
    obstacles: [
      { id: 'same-a', eventId: 'same-event', type: 'puddle', lane: 0, arrivalMs: sharedArrival, visibleStartMs: 0, distance: sharedArrival * 1.1 / 1000 },
      { id: 'same-b', eventId: 'same-event', type: 'puddle', lane: 0, arrivalMs: sharedArrival, visibleStartMs: 0, distance: sharedArrival * 1.1 / 1000 },
      { id: 'later', eventId: 'later-event', type: 'puddle', lane: 0, arrivalMs: 2_000, visibleStartMs: 200, distance: 2.2 },
      { id: 'last', eventId: 'last-event', type: 'puddle', lane: 0, arrivalMs: 3_000, visibleStartMs: 1_200, distance: 3.3 },
    ],
    onEvent: event => events.push(event),
  });
  game.start();
  game.advance(5_000);

  assert.equal(game.contactCount, 4);
  assert.equal(game.contactEventCount, 3);
  assert.equal(game.score, 0, 'penalties cannot reduce score below zero');
  assert.equal(game.collected, 1);
  assert.equal(game.bones[0].status, 'collected');
  assert.ok(game.obstacles.every(obstacle => obstacle.status === 'contacted'));
  const contacts = events.filter(event => event.type === 'obstacle_contact');
  assert.deepEqual(contacts.map(event => event.obstacleId), ['same-a', 'same-b', 'later', 'last']);
  assert.deepEqual(contacts.map(event => event.eventId), ['same-event', 'same-event', 'later-event', 'last-event']);
  assert.ok(contacts.every(event => event.contactCount >= 1 && event.contactEventCount >= 1));
  const simultaneousBoneAndContact = events.filter(event =>
    Math.abs(event.activeMs - events.find(other => other.type === 'collect')?.activeMs) < 1e-6 &&
    ['obstacle_contact', 'collect'].includes(event.type));
  assert.deepEqual(simultaneousBoneAndContact.map(event => event.type), ['obstacle_contact', 'obstacle_contact', 'collect']);
});

test('Level 2 crows are grounded at first visibility and ball collision uses its full trajectory', () => {
  const visibleCrow = new Game({
    phase: 4, walkLevel: 2, course: [],
    obstacles: [{ id: 'visible-crow', eventId: 'crow-visible', type: 'crow', lane: 0, arrivalMs: 1_000,
      visibleStartMs: 0, groundedStartMs: 0, departureMs: 1_300, distance: 1.1 }],
  });
  visibleCrow.start();
  visibleCrow.advance(1_600);
  assert.equal(visibleCrow.contactCount, 1, 'the crow is already grounded when its body first appears');

  const movingBall = new Game({
    phase: 4, walkLevel: 2, course: [],
    obstacles: [{ id: 'crossing-ball', eventId: 'ball-cross', type: 'ball', lane: -1,
      fromLane: -1, toLane: 1, arrivalMs: 2_000, visibleStartMs: 200,
      moveStartMs: 200, moveEndMs: 2_300, distance: 2.2 }],
  });
  movingBall.x = movingBall.lane = 1;
  movingBall.start();
  movingBall.advance(2_500);
  assert.equal(movingBall.contactCount, 1, 'the ball collides while crossing the dog lane');
});

test('Level 1 distance grouping stays diagnostic and does not change its result shape', () => {
  const game = new Game({ phase: 4, walkLevel: 1, course: [], obstacles: [
    { id: 'legacy-a', type: 'crow', lane: 0, distance: 1 },
    { id: 'legacy-b', type: 'crow', lane: 0, distance: 1 },
  ] });
  game.start();
  game.advance(2_000);
  assert.equal(game.contactCount, 2);
  assert.equal(game.contactEventCount, 1);
  assert.equal(Object.hasOwn(game.result(), 'walkLevel'), false);
  assert.equal(Object.hasOwn(game.result(), 'contactCount'), false);
  assert.equal(Object.hasOwn(game.result(), 'contactEventCount'), false);
});

test('generation failure uses an independent immutable backup and its actual Game route clears', () => {
  const backup = createParkCourse(99, { maxAttempts: 0 });
  assert.equal(backup.generation.fallback, true);
  assert.equal(backup.generation.attempts, 0);
  assert.equal(backup.ruleVersion, 'park30-level2-v2');
  assert.equal(backup.courseVersion, 'park-level2-course-2');
  assert.equal(backup.bones.length, 48); assert.equal(backup.obstacles.length, 32);
  const game = new Game({ phase: 4, walkLevel: 2, seed: 99, course: backup.bones, obstacles: backup.obstacles });
  game.start();
  for (const input of backup.safeInputs) { game.advance(input.timeMs - game.timeMs); assert.ok(game.command(input.direction)); }
  game.advance(30000 - game.timeMs);
  assert.equal(game.collected, 48); assert.equal(game.contactCount, 0); assert.equal(game.timeMs, 30000);
  backup.bones[0].lane = 999;
  assert.notEqual(createParkCourse(99, { maxAttempts: 0 }).bones[0].lane, 999);
});

test('Level 2 pass state and event occur strictly beyond the inclusive contact endpoint', () => {
  const events = [];
  const game = new Game({ phase: 4, walkLevel: 2, course: [], obstacles: [
    { id: 'boundary-puddle', eventId: 'boundary-event', type: 'puddle', lane: 1, distance: 1.1, arrivalMs: 1000, visibleStartMs: 0 },
  ], onEvent: event => events.push(event) });
  game.start();
  const exitMs = 1000 + .16 / 1.1 * 1000;
  game.advance(exitMs); assert.equal(game.obstacles[0].status, 'pending');
  game.advance(.0005); assert.equal(game.obstacles[0].status, 'pending');
  game.advance(.002); assert.equal(game.obstacles[0].status, 'passed');
  assert.ok(events.find(event => event.type === 'obstacle_pass').activeMs > exitMs);
});

test('ball completes its full roll and holds the endpoint after collision pass', () => {
  const game = new Game({ phase: 4, seed: 42, walkLevel: 2 });
  const ball = game.obstacles.find(o => o.type === 'ball');
  game.lane = game.x = [-1, 0, 1].find(lane => lane !== ball.fromLane && lane !== ball.toLane);
  game.start();game.advance(ball.arrivalMs + 200);
  assert.equal(ball.status, 'passed');
  assert.equal(parkObstacleVisibleAt(ball, game.timeMs), true);
  assert.notEqual(parkObstacleLaneAt(ball, game.timeMs), ball.toLane);
  game.advance(ball.moveEndMs - game.timeMs);
  assert.equal(parkObstacleVisibleAt(ball, game.timeMs), true);
  assert.equal(parkObstacleLaneAt(ball, game.timeMs), ball.toLane);
  game.advance(150);
  assert.equal(parkObstacleVisibleAt(ball, game.timeMs), true);
  game.advance(.01);
  assert.equal(parkObstacleVisibleAt(ball, game.timeMs), false);
});

test('park scoring and contact geometry agree at 16.67, 33.33 and 50 ms frame steps', () => {
  function replay(seed, stepMs, safe) {
    const events=[];
    const game=new Game({phase:4,walkLevel:2,seed,onEvent:e=>events.push(e)});game.start();
    function advanceTo(endMs) { while(game.timeMs<endMs-1e-7) game.advance(Math.min(stepMs,endMs-game.timeMs)); }
    if(safe) for(const input of game.courseData.safeInputs){advanceTo(input.timeMs);game.command(input.direction,'frame-contract');}
    advanceTo(30000);
    return {result:game.result(),events:events.filter(e=>['collect','obstacle_contact','end'].includes(e.type)).map(e=>({...e,activeMs:Math.round(e.activeMs*1000)/1000}))};
  }
  for(let seed=0;seed<32;seed++)for(const safe of [true,false]){
    const reference=replay(seed,30000,safe);
    for(const step of [16.67,33.33,50]) assert.deepEqual(replay(seed,step,safe),reference,`seed ${seed} safe=${safe} step=${step}`);
  }
});
