import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { FrameMetrics, SessionLog } from '../src/log.js';

function tickingClock(step = 10) {
  let time = 0;
  return () => { time += step; return time; };
}

test('keeps retry history and starts a new session after five runs', () => {
  const log = new SessionLog({ now: tickingClock() });
  const environment = { userAgent: 'captured test agent', viewport: { width: 390, height: 844 } };
  log.beginRun(environment);
  const firstRunId = log.run.id;
  log.record('bone_collected', { count: 1 }, 1200);
  const firstCollect = log.events.at(-1);

  for (let run = 2; run <= 6; run++) log.beginRun({ capture: `run-${run}` });

  assert.equal(log.sessions.length, 2);
  assert.deepEqual(log.sessions.map(session => session.runs.length), [5, 1]);
  assert.deepEqual(log.sessions[0].runs.map(run => run.attempt), [1, 2, 3, 4, 5]);
  assert.equal(log.sessions[1].runs[0].attempt, 1);
  assert.equal(firstCollect.type, 'bone_collected');
  assert.equal(log.events.includes(firstCollect), true, 'retry must not clear earlier events');
  assert.equal(firstCollect.runId, firstRunId);
  assert.equal(log.events[0].sessionId, log.events[1].sessionId);
  assert.notEqual(log.sessions[0].id, log.sessions[1].id);
});

test('stores supplied environment and versions, leaving unconfirmed details empty', () => {
  const log = new SessionLog({ now: tickingClock() });
  const capturedEnvironment = {
    userAgent: 'explicit test fixture',
    viewport: { width: 390, height: 844 },
  };
  log.beginRun(capturedEnvironment);

  assert.deepEqual(log.run.environment, capturedEnvironment);
  assert.deepEqual(log.run.versions, {
    build: CONFIG.buildVersion,
    config: CONFIG.configVersion,
    course: CONFIG.courseVersion,
    log: CONFIG.logVersion,
  });
  assert.deepEqual(log.confirmed, { participantId: null, device: null, os: null, browser: null });
  assert.equal(Object.hasOwn(log.run.environment, 'machine'), false);
  assert.deepEqual(log.sessions[0].confirmed, { participantId: null, device: null, os: null, browser: null });

  log.confirm({ participantId: 'tester-1', device: 'user-confirmed device' });
  assert.deepEqual(log.confirmed, {
    participantId: 'tester-1', device: 'user-confirmed device', os: null, browser: null,
  });
  assert.deepEqual(log.sessions[0].confirmed, log.confirmed);
  assert.equal(log.events.at(-1).type, 'environment_confirmed');
});

test('keeps event sequence and session time monotonic, with active time ordered per run', () => {
  const log = new SessionLog({ now: tickingClock(25) });
  for (let run = 0; run < 6; run++) {
    log.beginRun({ run });
    log.record('active_tick', { run, tick: 1 }, 0);
    log.record('active_tick', { run, tick: 2 }, 16.667);
  }

  assert.deepEqual(log.events.map(event => event.sequence), log.events.map((_, index) => index + 1));
  for (const session of log.sessions) {
    const events = log.events.filter(event => event.sessionId === session.id);
    assert.ok(events.length > 0);
    for (let index = 1; index < events.length; index++) {
      assert.ok(events[index].sessionMs >= events[index - 1].sessionMs, 'session time should not move backward');
    }
  }
  for (const run of log.sessions.flatMap(session => session.runs)) {
    const activeTimes = log.events.filter(event => event.runId === run.id).map(event => event.activeMs);
    assert.deepEqual(activeTimes, [...activeTimes].sort((a, b) => a - b));
  }
});

test('caps the log at 20000 events with one terminal incomplete marker', () => {
  const log = new SessionLog({ now: () => 0 });
  for (let index = 0; index < 20_005; index++) log.record('sample', { index }, index);

  assert.equal(log.events.length, 20_000);
  assert.equal(log.incomplete, true);
  assert.deepEqual(log.events.at(-1), {
    incomplete: true,
    reason: 'event_limit',
    maxEvents: 20_000,
    sequence: 20_000,
    type: 'log_limit',
    activeMs: 19_999,
    sessionMs: 0,
    sessionId: null,
    runId: null,
  });
  const terminalMarker = log.events.at(-1);
  log.record('after_limit');
  assert.equal(log.events.length, 20_000);
  assert.equal(log.events.at(-1), terminalMarker);
  assert.equal(log.snapshot().incomplete, true);
});

test('recording and exporting do not transmit session data', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls++; return Promise.resolve({ ok: true }); };
  try {
    const log = new SessionLog({ now: tickingClock() });
    log.beginRun({ userAgent: 'test fixture' });
    log.record('score', { value: 4 }, 30_000);
    log.confirm({ participantId: 'tester-1' });
    const snapshot = log.snapshot();
    assert.equal(snapshot.events.length, 3);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('summarizes nearest-rank p95, frame duration, and consecutive long frames', () => {
  const metrics = new FrameMetrics();
  for (let duration = 1; duration <= 18; duration++) metrics.add(duration);
  metrics.add(100);
  metrics.add(101.2);
  metrics.add(150.005);

  assert.deepEqual(metrics.summary(), {
    frames: 21,
    p95Ms: 102,
    maxMs: 150.01,
    over100: 2,
    maxConsecutiveLongFrames: 2,
  });

  metrics.reset();
  assert.deepEqual(metrics.summary(), {
    frames: 0,
    p95Ms: 0,
    maxMs: 0,
    over100: 0,
    maxConsecutiveLongFrames: 0,
  });
});
