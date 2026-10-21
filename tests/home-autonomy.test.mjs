import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeAutonomy, HOME_AUTONOMY_GESTURE_DURATIONS_MS } from '../src/home-autonomy.js';

const MODES = new Set(['calm', 'curious', 'sleepy']);
const POSTURES = new Set(['stand', 'sit', 'lie']);
const GESTURE_POSTURES = {
  'look-left': POSTURES,
  'look-right': POSTURES,
  'check-in': POSTURES,
  'ear-flick-left': POSTURES,
  'ear-flick-right': POSTURES,
  drowsy: new Set(['sit', 'lie']),
  'head-rest': new Set(['lie']),
  sleep: new Set(['lie']),
  'paw-adjust': new Set(['sit']),
  'weight-shift': new Set(['stand']),
};

function simulate(seed, durationMs = 600_000, stepMs = 100) {
  const planner = new HomeAutonomy(seed);
  let posture = 'stand';
  const events = [];
  const modes = new Set([planner.snapshot.mode]);
  let postureStays = 0;

  for (let timeMs = 0; timeMs <= durationMs; timeMs += stepMs) {
    const before = planner.snapshot;
    const event = planner.next(timeMs, posture);
    const after = planner.snapshot;
    modes.add(after.mode);
    if (!event && after.postureDeadlineMs > before.postureDeadlineMs && after.posture === posture) postureStays += 1;
    if (!event) continue;

    events.push({ timeMs, postureBefore: posture, mode: after.mode, ...event, snapshot: after });
    if (event.kind === 'posture') {
      assert.equal(planner.next(timeMs, posture), null, 'posture planner stays locked until settle');
      posture = event.action;
      planner.settle(timeMs, posture);
    }
  }

  return { planner, posture, events, modes, postureStays };
}

function assertDurationContract(action, durationMs) {
  const contract = HOME_AUTONOMY_GESTURE_DURATIONS_MS[action];
  assert.ok(contract, `unsupported gesture ${action}`);
  if (Array.isArray(contract)) {
    assert.ok(durationMs >= contract[0] && durationMs <= contract[1], `${action} duration ${durationMs}ms is outside its range`);
  } else {
    assert.equal(durationMs, contract, `${action} has a fixed duration`);
  }
}

test('reset starts with a 20–30 second pose hold and a seeded 60–180 second mode', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const planner = new HomeAutonomy(seed);
    const { postureDeadlineMs, gestureDeadlineMs, mode, modeDeadlineMs } = planner.snapshot;
    assert.ok(postureDeadlineMs >= 20_000 && postureDeadlineMs <= 30_000);
    assert.ok(gestureDeadlineMs >= 4_000 && gestureDeadlineMs <= 15_000);
    assert.ok(MODES.has(mode));
    assert.ok(modeDeadlineMs >= 60_000 && modeDeadlineMs <= 180_000);
  }
});

test('same seed repeats the complete schedule while different seeds change it', () => {
  assert.deepEqual(simulate(314, 180_000).events, simulate(314, 180_000).events);
  assert.notDeepEqual(simulate(314, 180_000).events, simulate(315, 180_000).events);
});

test('ten-minute seeded samples vary modes, postures, and small gestures without forced posture tours', () => {
  const traces = Array.from({ length: 12 }, (_, seed) => simulate(seed, 600_000));
  const allModes = new Set(traces.flatMap((trace) => [...trace.modes]));
  const allGestures = new Set();
  const allPostures = new Set(['stand']);
  for (const trace of traces) {
    for (const event of trace.events) if (event.kind === 'posture') allPostures.add(event.action);
  }
  const incompleteAtTwoMinutes = traces.filter((trace, seed) => {
    const seen = new Set(['stand']);
    for (const event of simulate(seed, 120_000).events) {
      if (event.kind === 'posture') seen.add(event.action);
    }
    return seen.size < 3;
  });

  assert.deepEqual(allModes, MODES);
  assert.deepEqual(allPostures, POSTURES);
  assert.ok(incompleteAtTwoMinutes.length > 0, 'some seeds keep a posture or revisit two poses during the first two minutes');

  for (const trace of traces) {
    assert.ok(trace.postureStays > 0, 'the planner sometimes renews a hold without changing pose');
    const postureEvents = trace.events.filter((event) => event.kind === 'posture');
    for (const event of postureEvents) {
      assert.ok(POSTURES.has(event.action));
      assert.notEqual(event.action, event.postureBefore);
    }

    const gestures = trace.events.filter((event) => event.kind === 'gesture');
    let previous = null;
    const lastByAction = new Map();
    for (const event of gestures) {
      allGestures.add(event.action);
      assert.ok(GESTURE_POSTURES[event.action]?.has(event.postureBefore), `${event.action} is not eligible while ${event.postureBefore}`);
      assertDurationContract(event.action, event.durationMs);
      assert.ok(event.timeMs + event.durationMs <= event.snapshot.postureDeadlineMs, `${event.action} must end before the posture deadline`);
      if (previous) assert.ok(event.timeMs >= previous.timeMs + previous.durationMs + 4_000);
      const lastAt = lastByAction.get(event.action);
      if (lastAt !== undefined) assert.ok(event.timeMs - lastAt >= 25_000, `${event.action} cooldown must be at least 25 seconds`);
      lastByAction.set(event.action, event.timeMs);
      previous = event;
    }
  }

  assert.deepEqual(allGestures, new Set(Object.keys(HOME_AUTONOMY_GESTURE_DURATIONS_MS)));
});

test('normal holds last 20–45 seconds and sleepy lying holds last 60–120 seconds', () => {
  const planner = new HomeAutonomy(87);
  const normal = planner.settle(1_000, 'stand');
  assert.ok(normal.postureDeadlineMs - normal.holdStartMs >= 20_000);
  assert.ok(normal.postureDeadlineMs - normal.holdStartMs <= 45_000);

  const sleepyLie = new HomeAutonomy(87);
  sleepyLie._mode = 'sleepy';
  const resting = sleepyLie.settle(1_000, 'lie');
  assert.ok(resting.postureDeadlineMs - resting.holdStartMs >= 60_000);
  assert.ok(resting.postureDeadlineMs - resting.holdStartMs <= 120_000);
});

test('a fresh visit has an early small response while later gaps may remain quiet', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const trace = simulate(seed, 100_000);
    const first = trace.events[0];
    assert.equal(first.kind, 'gesture');
    assert.ok(first.timeMs >= 4_000 && first.timeMs <= 15_100);
  }
});

test('manual settle blocks every automatic event for a seeded 16–24 seconds', () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const planner = new HomeAutonomy(seed);
    const startMs = 10_000;
    const state = planner.settle(startMs, 'sit', { manual: true });
    const holdMs = state.manualHoldUntilMs - state.holdStartMs;
    assert.ok(holdMs >= 16_000 && holdMs <= 24_000);
    for (let elapsed = 0; elapsed < holdMs; elapsed += 100) {
      assert.equal(planner.next(startMs + elapsed, 'sit'), null);
    }
    assert.equal(planner.next(startMs + holdMs, 'sit'), null);
    assert.equal(planner.snapshot.manualHold, false);
  }
});

test('sleepy lying prefers an uncut head-rest, sleep, and recovery sequence', () => {
  let sequence = null;
  for (let seed = 0; seed < 40 && !sequence; seed += 1) {
    const planner = new HomeAutonomy(seed);
    planner.reset(0, 'lie');
    planner._mode = 'sleepy';
    planner._modeStartedAt = 0;
    planner._modeDeadline = 180_000;
    planner._sleepSequenceStage = 'head-rest';
    const actions = [];
    for (let timeMs = 0; timeMs <= 180_000; timeMs += 100) {
      const event = planner.next(timeMs, 'lie');
      if (event?.kind !== 'gesture') continue;
      actions.push(event.action);
      if (actions[0] === 'head-rest' && actions[1] === 'sleep' && ['head-rest', 'check-in'].includes(actions[2])) {
        sequence = { actions };
        break;
      }
    }
  }
  assert.ok(sequence, 'at least one seeded trace completes the preferred sleepy sequence');
  assert.equal(sequence.actions[0], 'head-rest');
  assert.equal(sequence.actions[1], 'sleep');
  assert.ok(['head-rest', 'check-in'].includes(sequence.actions[2]));
});

test('a gesture locks the planner until its duration elapses and can extend a tight posture deadline', () => {
  const planner = new HomeAutonomy(125);
  planner._mode = 'curious';
  planner._postureDeadline = 10_000;
  planner._gestureDeadline = 4_000;
  let event = null;
  for (let timeMs = 4_000; timeMs < 10_000 && !event; timeMs += 100) {
    event = planner.next(timeMs, 'stand');
  }
  assert.ok(event?.kind === 'gesture');
  const gestureAt = planner.snapshot.nowMs;
  const until = planner.snapshot.currentGestureUntilMs;
  assert.ok(until <= planner.snapshot.postureDeadlineMs);
  for (let timeMs = gestureAt + 100; timeMs < until; timeMs += 100) assert.equal(planner.next(timeMs, 'stand'), null);
});

test('defer shifts mode and action deadlines together, and a pending posture stays locked until settle', () => {
  const planner = new HomeAutonomy(22);
  const before = planner.snapshot;
  const after = planner.defer(1_000, 5_000);
  assert.equal(after.postureDeadlineMs, before.postureDeadlineMs + 5_000);
  assert.equal(after.gestureDeadlineMs, before.gestureDeadlineMs + 5_000);
  assert.equal(after.modeDeadlineMs, before.modeDeadlineMs + 5_000);

  const pending = new HomeAutonomy(23);
  const deadline = pending.snapshot.postureDeadlineMs;
  const event = pending.next(deadline, 'stand');
  if (event?.kind === 'posture') {
    assert.equal(pending.next(deadline, 'stand'), null);
    pending.settle(deadline, event.action);
    assert.equal(pending.next(deadline, event.action), null);
  }
});

test('large clock jumps, invalid times, and repeated calls cannot create action bursts', () => {
  const planner = new HomeAutonomy(Number.NaN);
  planner.reset(Number.NaN, 'unknown');
  assert.equal(planner.snapshot.posture, 'stand');
  assert.equal(planner.next(Number.NaN, 'stand'), null);
  assert.equal(planner.next(-1, 'stand'), null);

  const jumped = new HomeAutonomy(77);
  const first = jumped.next(600_000, 'stand');
  for (let index = 0; index < 100; index += 1) assert.equal(jumped.next(600_000, 'stand'), null);
  if (first?.kind === 'posture') {
    jumped.settle(600_000, first.action);
    for (let index = 0; index < 100; index += 1) assert.equal(jumped.next(600_000, first.action), null);
  }

  jumped.reset(50_000, 'lie');
  assert.equal(jumped.next(0, 'lie'), null, 'reset begins a new monotonic time epoch');
});

test('snapshot arrays and maps are detached from planner state', () => {
  const planner = new HomeAutonomy(900);
  planner._gestureTimes.set('look-left', 1_000);
  const original = planner.snapshot;
  const edited = planner.snapshot;
  edited.posture = 'lie';
  edited.seenPostures.push('lie');
  edited.gestureCooldowns['look-left'] = -1;
  edited.postureDeadlineMs = -1;

  assert.deepEqual(planner.snapshot, original);
  assert.notStrictEqual(planner.snapshot, planner.snapshot);
  assert.notStrictEqual(planner.snapshot.seenPostures, planner.snapshot.seenPostures);
  assert.notStrictEqual(planner.snapshot.gestureCooldowns, planner.snapshot.gestureCooldowns);
});
