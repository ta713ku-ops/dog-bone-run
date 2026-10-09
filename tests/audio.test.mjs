import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../src/audio.js';

class MockAudioContext {
  static created = [];

  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.resumeCalls = 0;
    this.oscillators = [];
    this.gains = [];
    MockAudioContext.created.push(this);
  }

  resume() {
    this.resumeCalls++;
    return Promise.resolve();
  }

  createOscillator() {
    const oscillator = {
      type: null,
      frequency: {
        setValueAtTime(value) { oscillator.frequencyHz = value; },
        exponentialRampToValueAtTime() {},
      },
      connect() {},
      disconnect() { this.disconnected = true; },
      start(when) { this.started = true; this.startTime = when; },
      stop(when) { this.stopped = true; this.cancelled = arguments.length === 0; this.stopTime = when; },
      onended: null,
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    const node = {
      gain: {
        setValueAtTime(value) { this.value = value; },
        exponentialRampToValueAtTime(value) {
          this.rampValues ??= [];
          this.rampValues.push(value);
        },
      },
      connect(destination) { this.connectedTo = destination; },
      disconnect() { this.disconnected = true; },
    };
    this.gains.push(node);
    return node;
  }
}

function installFakeTimers() {
  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextId;
    timeouts.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = id => timeouts.delete(id);
  globalThis.setInterval = (callback, delay) => {
    const id = ++nextId;
    intervals.set(id, { callback, delay });
    return id;
  };
  globalThis.clearInterval = id => intervals.delete(id);
  return {
    timeouts,
    intervals,
    restore() { Object.assign(globalThis, original); },
  };
}

test('creates and resumes audio synchronously from unlock, then waits for running', async () => {
  MockAudioContext.created = [];
  const order = [];
  let resolveResume;
  class DelayedAudioContext extends MockAudioContext {
    constructor() {
      super();
      order.push('construct');
    }
    resume() {
      order.push('resume');
      return new Promise(resolve => { resolveResume = resolve; });
    }
  }
  const audio = new Audio(state => order.push(`state:${state}`), { Context: DelayedAudioContext, timeoutMs: 1000 });

  const unlocking = audio.unlock();
  assert.deepEqual(order.slice(0, 3), ['construct', 'state:suspended', 'resume']);
  assert.equal(audio.contextCount, 1);

  resolveResume();
  await Promise.resolve();
  assert.equal(audio.context.state, 'suspended');

  audio.context.state = 'running';
  audio.context.onstatechange();
  assert.deepEqual(await unlocking, { ok: true });
  assert.ok(order.includes('state:running'));
});

test('reports unsupported audio and rejected resume as silent fallbacks', async () => {
  const unsupported = new Audio(() => {}, { Context: null });
  assert.deepEqual(await unsupported.unlock(), { ok: false, reason: 'unsupported' });

  class RejectedAudioContext extends MockAudioContext {
    resume() { return Promise.reject(new Error('NotAllowedError')); }
  }
  const rejected = new Audio(() => {}, { Context: RejectedAudioContext });
  assert.deepEqual(await rejected.unlock(), { ok: false, reason: 'NotAllowedError' });
});

for (const state of ['suspended', 'interrupted']) {
  test(`times out when resume settles but context remains ${state}`, async () => {
    const fakeTimers = installFakeTimers();
    try {
      class StuckAudioContext extends MockAudioContext {
        constructor() { super(); this.state = state; }
      }
      const audio = new Audio(() => {}, { Context: StuckAudioContext, timeoutMs: 40 });
      const unlocking = audio.unlock();
      const timeout = [...fakeTimers.timeouts.values()].find(timer => timer.delay === 40);
      assert.ok(timeout, 'unlock should arm its bounded timeout');
      timeout.callback();
      assert.deepEqual(await unlocking, { ok: false, reason: 'timeout' });
      assert.equal(fakeTimers.intervals.size, 0);
    } finally {
      fakeTimers.restore();
    }
  });
}

test('late resume after timeout does not leave a polling interval running', async () => {
  const fakeTimers = installFakeTimers();
  try {
    let resolveResume;
    class LateAudioContext extends MockAudioContext {
      resume() { return new Promise(resolve => { resolveResume = resolve; }); }
    }
    const audio = new Audio(() => {}, { Context: LateAudioContext, timeoutMs: 25 });
    const unlocking = audio.unlock();
    [...fakeTimers.timeouts.values()].find(timer => timer.delay === 25).callback();
    assert.deepEqual(await unlocking, { ok: false, reason: 'timeout' });
    assert.equal(fakeTimers.intervals.size, 0);

    resolveResume();
    await Promise.resolve();
    assert.equal(fakeTimers.intervals.size, 0, 'a late resume must not create a poll after unlock has finished');
  } finally {
    fakeTimers.restore();
  }
});

test('reuses a live context across retries and replaces a closed context', async () => {
  MockAudioContext.created = [];
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });

  assert.deepEqual(await audio.unlock(), { ok: true });
  const first = audio.context;
  assert.deepEqual(await audio.unlock(), { ok: true });
  assert.equal(audio.context, first);
  assert.equal(audio.contextCount, 1);
  assert.equal(first.resumeCalls, 2);

  first.state = 'closed';
  assert.deepEqual(await audio.unlock(), { ok: true });
  assert.notEqual(audio.context, first);
  assert.equal(audio.contextCount, 2);
  assert.equal(MockAudioContext.created.length, 2);
});

test('ignores state changes from a replaced closed context', async () => {
  const states = [];
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(state => states.push(state), { Context: RunningAudioContext });

  await audio.unlock();
  const oldContext = audio.context;
  const oldListener = oldContext.onstatechange;
  oldContext.state = 'closed';
  await audio.unlock();
  const currentContext = audio.context;
  const stateCount = states.length;

  oldContext.state = 'suspended';
  oldListener();
  assert.equal(audio.context, currentContext);
  assert.equal(states.length, stateCount, 'a stale context must not report the replacement context state');
});

test('retries a timed-out unlock on the same context', async () => {
  const fakeTimers = installFakeTimers();
  try {
    class RetryableAudioContext extends MockAudioContext {
      resume() {
        this.resumeCalls++;
        if (this.resumeCalls === 2) this.state = 'running';
        return Promise.resolve();
      }
    }
    const audio = new Audio(() => {}, { Context: RetryableAudioContext, timeoutMs: 30 });

    const firstAttempt = audio.unlock();
    [...fakeTimers.timeouts.values()].find(timer => timer.delay === 30).callback();
    assert.deepEqual(await firstAttempt, { ok: false, reason: 'timeout' });
    const context = audio.context;

    assert.deepEqual(await audio.unlock(), { ok: true });
    assert.equal(audio.context, context);
    assert.equal(context.resumeCalls, 2);
    assert.equal(audio.contextCount, 1);
    assert.equal(fakeTimers.intervals.size, 0);
  } finally {
    fakeTimers.restore();
  }
});

test('stop disconnects and clears every active voice', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  audio.play(2);
  audio.play(4);
  assert.equal(audio.voices.size, 2);

  const voices = [...audio.voices];
  audio.stop();
  assert.equal(audio.voices.size, 0);
  for (const { oscillator, gain } of voices) {
    assert.equal(oscillator.stopped, true);
    assert.equal(oscillator.disconnected, true);
    assert.equal(gain.disconnected, true);
  }
});

test('gold collection has a distinct timbre and rising pitch without another AudioContext', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
    createOscillator() {
      const oscillator = super.createOscillator();
      oscillator.frequency.setValueAtTime = value => { oscillator.initialHz = value; };
      oscillator.frequency.exponentialRampToValueAtTime = value => { oscillator.finalHz = value; };
      return oscillator;
    }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock(); audio.play(3); audio.play(3, 'gold');
  const [ordinary, gold] = audio.context.oscillators;
  assert.equal(ordinary.type, 'sine'); assert.equal(gold.type, 'triangle');
  assert.ok(gold.initialHz > ordinary.initialHz); assert.ok(gold.finalHz > ordinary.finalHz);
  assert.equal(audio.contextCount, 1); audio.stop(); assert.equal(audio.voices.size, 0);
});

test('music uses a bounded frame-pumped schedule and skips missed notes after a long gap', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();

  audio.startMusic(1000);
  assert.equal(audio.voices.size, 2, 'the first beat schedules only bass and melody');
  const firstMusicOscillator = audio.context.oscillators[0];
  audio.updateMusic(1000);
  audio.updateMusic(1016);
  assert.equal(audio.voices.size, 2, 'repeated frame updates do not duplicate a scheduled note');

  audio.updateMusic(1480);
  assert.equal(audio.voices.size, 3, 'the middle melody note is added inside the lookahead');
  audio.updateMusic(1980);
  assert.equal(audio.voices.size, 5, 'only the next two-note beat inside the lookahead is added');
  assert.equal(audio.musicScheduled.size, 2, 'scheduled-event bookkeeping stays bounded to the current beat');
  assert.ok(audio.context.oscillators.length <= 5, 'the scheduler does not queue the whole melody');

  audio.updateMusic(2480);
  assert.equal(audio.voices.size, 5, 'the next phrase rest stays silent');

  audio.updateMusic(10000);
  assert.equal(firstMusicOscillator.stopped, true, 'a discontinuity clears stale scheduled music');
  assert.equal(audio.voices.size, 2, 'a long gap starts from the current time instead of catching up');
  assert.equal(audio.musicScheduled.size, 2);
  audio.stop();
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.musicRunning, false);
});

test('music and SFX have independent buses and music volume can be set to zero', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  assert.deepEqual(audio.setVolumes({ music: 0, sfx: 1 }), { music: 0, sfx: 1 });

  audio.startMusic(0);
  const musicVoice = [...audio.voices].find(voice => voice.role === 'melody');
  audio.play(2);
  const sfxVoice = [...audio.voices].find(voice => voice.type === 'sfx');
  assert.equal(audio.musicGain.gain.value, 0);
  assert.equal(audio.sfxGain.gain.value, 1);
  assert.equal(musicVoice.gain.connectedTo, audio.musicGain);
  assert.equal(sfxVoice.gain.connectedTo, audio.sfxGain);
  assert.equal(audio.contextCount, 1);
  audio.stop();
});

test('rejects invalid mix volume inputs without changing the current mix', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  const original = { ...audio.volumes };

  for (const volumes of [
    { music: -0.01, sfx: 1 },
    { music: 1.01, sfx: 1 },
    { music: Number.NaN, sfx: 1 },
    { music: 0.5, sfx: Number.POSITIVE_INFINITY },
    { music: 0.5 },
    { music: '0.5', sfx: 1 },
  ]) {
    assert.throws(() => audio.setVolumes(volumes), RangeError);
    assert.deepEqual(audio.volumes, original);
  }
});

test('music mute stops only music voices and leaves SFX audible', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  audio.startMusic(0);
  audio.play(1);
  const musicVoices = [...audio.voices].filter(voice => voice.type === 'music');
  const sfxVoice = [...audio.voices].find(voice => voice.type === 'sfx');

  audio.setMusicEnabled(false);
  assert.equal(musicVoices.length, 2);
  for (const musicVoice of musicVoices) assert.equal(musicVoice.oscillator.cancelled, true);
  assert.notEqual(sfxVoice.oscillator.cancelled, true);
  assert.equal(audio.voices.size, 1);
  audio.play(2);
  assert.equal(audio.voices.size, 2, 'SFX still plays while music is muted');
  assert.equal(audio.musicEnabled, false);
  audio.stop();
});

test('restarting music removes its old scheduled voices without overlap', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  audio.startMusic(0);
  const first = audio.context.oscillators.at(-1);

  audio.startMusic(5000);
  assert.equal(first.stopped, true);
  assert.equal(audio.voices.size, 2);
  const replacement = audio.context.oscillators.at(-1);
  audio.updateMusic(5000);
  assert.equal(audio.voices.size, 2, 'retrying the same start point does not overlap or duplicate notes');
  assert.notEqual(replacement, first);
  audio.stop();
});

test('the original 12-second phrase has rests, lower accompaniment, and quieter peaks than SFX', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  audio.startMusic(0);
  const [bass, melody] = [...audio.voices];
  assert.equal(bass.role, 'accompaniment');
  assert.equal(melody.role, 'melody');
  assert.equal(bass.oscillator.frequencyHz, 130.81);
  assert.equal(melody.oscillator.frequencyHz, 523.25);
  assert.equal(bass.gain.gain.rampValues[0], 0.04);
  assert.equal(melody.gain.gain.rampValues[0], 0.06);

  audio.play(1);
  const sfx = [...audio.voices].find(voice => voice.type === 'sfx');
  assert.equal(sfx.gain.gain.rampValues[0], 0.14);
  assert.ok((bass.gain.gain.rampValues[0] + melody.gain.gain.rampValues[0]) * audio.volumes.music < sfx.gain.gain.rampValues[0]);

  audio.stop();
});

test('the melody rests between phrases and repeats after 12 seconds without a growing voice set', async () => {
  class RunningAudioContext extends MockAudioContext {
    constructor() { super(); this.state = 'running'; }
  }
  const audio = new Audio(() => {}, { Context: RunningAudioContext });
  await audio.unlock();
  audio.startMusic(0);
  const peakVoiceCount = () => audio.voices.size;
  let maximumVoices = peakVoiceCount();

  for (let activeMs = 100; activeMs <= 12_000; activeMs += 100) {
    audio.context.currentTime = activeMs / 1000;
    for (const voice of [...audio.voices]) {
      if (voice.oscillator.stopTime <= audio.context.currentTime && !voice.oscillator.ended) {
        voice.oscillator.ended = true;
        voice.oscillator.onended?.();
      }
    }
    audio.updateMusic(activeMs);
    maximumVoices = Math.max(maximumVoices, peakVoiceCount());
  }

  assert.equal(audio.context.oscillators.filter(oscillator => oscillator.startTime === 0).length, 2);
  assert.equal(audio.context.oscillators.filter(oscillator => oscillator.startTime === 12).length, 2);
  assert.equal(audio.context.oscillators.filter(oscillator => oscillator.startTime === 1.5).length, 0, 'a written rest stays silent');
  assert.ok(maximumVoices <= 2, `voice count should remain bounded, saw ${maximumVoices}`);
  assert.ok(audio.musicScheduled.size <= 2, 'music bookkeeping remains limited to the current beat');
  audio.stop();
});
