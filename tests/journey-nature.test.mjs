import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../src/audio.js';
import { ALL_JOURNEY_ROUTES } from '../src/journey-catalog.js';

class FakeParam {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}

class FakeNode {
  constructor(kind) { this.kind = kind; this.connections = []; this.disconnected = false; }
  connect(destination) { this.connections.push(destination); this.connectedTo = destination; }
  disconnect() { this.disconnected = true; this.connections = []; }
}

class NatureAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 48_000;
    this.destination = new FakeNode('destination');
    this.bufferSources = [];
    this.oscillators = [];
    this.filters = [];
    this.gains = [];
    this.panners = [];
  }
  resume() { return Promise.resolve(); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { channels, length, sampleRate, getChannelData: index => data[index] };
  }
  createBufferSource() {
    const source = Object.assign(new FakeNode('buffer-source'), {
      loop: false,
      start(time) { this.startedAt = time; },
      stop(time) { this.stoppedAt = time; this.cancelled = arguments.length === 0; },
    });
    this.bufferSources.push(source);
    return source;
  }
  createBiquadFilter() {
    const filter = Object.assign(new FakeNode('filter'), {
      frequency: new FakeParam(), Q: new FakeParam(), type: 'lowpass',
    });
    this.filters.push(filter);
    return filter;
  }
  createStereoPanner() {
    const panner = Object.assign(new FakeNode('panner'), { pan: new FakeParam() });
    this.panners.push(panner);
    return panner;
  }
  createGain() {
    const gain = Object.assign(new FakeNode('gain-node'), { gain: new FakeParam() });
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = Object.assign(new FakeNode('oscillator'), {
      type: 'sine',
      frequency: new FakeParam(),
      start(time) { this.startedAt = time; },
      stop(time) { this.stoppedAt = time; this.cancelled = arguments.length === 0; },
    });
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

const quietAssets = {
  bark: { preload() {}, prepare() {}, play() { return false; }, stop() {} },
  whine: { playing: false, preload() {}, prepare() {}, play() { return false; }, stop() {} },
};

test('every catalog route selects its authored nature scene', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  assert.equal(audio.setJourneyRoute(ALL_JOURNEY_ROUTES[0].id), ALL_JOURNEY_ROUTES[0].id);
  await audio.unlock();
  audio.startMusic(0);

  for (const route of ALL_JOURNEY_ROUTES) {
    assert.equal(audio.setJourneyRoute(route.id), route.id);
    const beds = [...audio.voices].filter(voice => voice.type === 'ambient');
    assert.equal(beds.length, 1, `${route.id} has one continuous scene bed`);
    assert.equal(beds[0].routeId, route.id);
    assert.ok(Number.isFinite(beds[0].cutoffHz), `${route.id} has a filtered bed`);
  }
  audio.stop();
});

test('route scenes use filtered noise beds and switching route releases the previous bed', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  assert.equal(audio.ambientEnabled, true);
  assert.equal(audio.setJourneyRoute('street-2'), 'street-2');
  await audio.unlock();
  audio.setVolumes({ music: .24, sfx: .8 });
  audio.startMusic(0);

  let ambient = [...audio.voices].filter(voice => voice.type === 'ambient');
  assert.equal(ambient.length, 1, 'one continuous noise bed serves each route');
  assert.equal(ambient[0].routeId, 'street-2');
  assert.equal(ambient[0].bed, 'water');
  assert.equal(ambient[0].oscillator.kind, 'buffer-source');
  assert.equal(ambient[0].oscillator.loop, true);
  assert.equal(ambient[0].nodes.find(node => node.kind === 'filter').type, 'lowpass');
  assert.equal(ambient[0].nodes.find(node => node.kind === 'filter').frequency.value, 880);
  assert.equal(ambient[0].gain.connectedTo, audio.ambientGain);
  assert.equal(ambient[0].stoppers.length, 2, 'noise bed and gentle modulation stop together');
  assert.ok(ambient[0].nodes.some(node => node.kind === 'oscillator'));
  assert.equal(audio.musicGain.gain.value, .24);
  assert.equal(audio.ambientGain.gain.value, .24, 'the existing volume slider scales the separate nature bus too');

  const priorSource = ambient[0].oscillator;
  assert.equal(audio.setJourneyRoute('cave-1'), 'cave-1');
  ambient = [...audio.voices].filter(voice => voice.type === 'ambient');
  assert.equal(ambient.length, 1);
  assert.equal(priorSource.cancelled, true);
  assert.equal(priorSource.disconnected, true);
  assert.equal(ambient[0].routeId, 'cave-1');
  assert.equal(ambient[0].bed, 'cave');
  assert.equal(ambient[0].nodes.find(node => node.kind === 'filter').frequency.value, 590);
  audio.stop();
  assert.equal(audio.voices.size, 0);
});

test('frame-pumped footsteps and route cues stay sparse and are cleared by pause', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  audio.setJourneyRoute('park-3');
  await audio.unlock();
  audio.startMusic(0);
  let peakCueVoices = 0;
  let peakVoices = audio.voices.size;
  for (let activeMs = 0; activeMs <= 10_000; activeMs += 20) {
    audio.context.currentTime = activeMs / 1_000;
    audio.updateNature(activeMs);
    peakCueVoices = Math.max(peakCueVoices,
      [...audio.voices].filter(voice => voice.type === 'ambient-cue').length);
    peakVoices = Math.max(peakVoices, audio.voices.size);
  }
  assert.ok(audio.context.bufferSources.some(source => source.buffer && !source.loop),
    'surface steps and water use short noise bursts');
  assert.ok(audio.context.oscillators.some(oscillator => oscillator.frequency.events.length > 1),
    'route birds or droplets use short changing tones');
  assert.ok(audio.context.panners.some(panner => panner.pan.value !== 0), 'occasional cues are spatially panned');
  assert.ok(peakCueVoices <= 2, `ambient cues remain sparse, saw ${peakCueVoices}`);
  assert.ok(peakVoices <= 6, `the active voice set stays bounded, saw ${peakVoices}`);
  assert.ok(audio.natureScheduled.size <= 2, 'only nearby cue events stay in the scheduler');

  const voices = [...audio.voices];
  audio.stop();
  assert.equal(audio.voices.size, 0);
  for (const voice of voices) {
    assert.ok(voice.stoppers.every(source => source.cancelled), 'pause stops each source, including modulation');
    assert.ok(voice.nodes.every(node => node.disconnected), 'pause disconnects each route node');
  }
});

test('ambient toggle, music mute, SFX volume, global mute and contact priority stay independent', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  audio.setJourneyRoute('street-1');
  await audio.unlock();
  audio.setVolumes({ music: .3, sfx: .25 });
  audio.startMusic(0);
  assert.equal(audio.setAmbientEnabled(false), false);
  assert.equal([...audio.voices].some(voice => voice.type === 'ambient' || voice.type === 'ambient-cue'), false);
  assert.ok([...audio.voices].some(voice => voice.type === 'music'), 'ambient mute keeps BGM running');

  assert.equal(audio.playNature('scent'), true);
  let action = [...audio.voices].find(voice => voice.type === 'nature-action');
  assert.ok(action);
  assert.ok(action.nodes.some(node => node.kind === 'panner' && node.connectedTo === audio.sfxGain));
  assert.equal(action.gain.gain.events.find(event => event[0] === 'ramp')[1], .012);

  audio.setMusicEnabled(false);
  assert.equal([...audio.voices].some(voice => voice.type === 'music' || voice.type === 'ambient'), false);
  assert.equal(audio.playNature('animal'), true, 'an explicit observation remains an SFX when BGM is muted');
  audio.setEnabled(false);
  assert.equal(audio.playNature('animal'), false);
  assert.equal(audio.voices.size, 0);

  audio.setEnabled(true);
  assert.equal(audio.playContact(), true);
  assert.equal(audio.playNature('animal'), false, 'nature reactions yield to the contact cue');
  audio.stop();
});

test('explicit nature reactions evict the oldest action and stay bounded', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  await audio.unlock();
  audio.startMusic(0);
  audio.setAmbientEnabled(false);

  assert.equal(audio.playNature('scent'), true);
  const oldest = [...audio.voices].find(voice => voice.type === 'nature-action');
  assert.equal(audio.playNature('animal'), true);
  assert.equal(audio.playNature('look'), true);
  const actions = [...audio.voices].filter(voice => voice.type === 'nature-action');
  assert.equal(actions.length, 2);
  assert.equal(oldest.stoppers[0].cancelled, true);
  assert.ok(oldest.nodes.every(node => node.disconnected));
  audio.stop();
  assert.equal(audio.voices.size, 0);
});

test('BGM mute leaves nature running, ambient mute leaves BGM running, and stop clears both', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  audio.setJourneyRoute('park-1');
  await audio.unlock();
  audio.startMusic(0);

  audio.setMusicEnabled(false);
  assert.equal([...audio.voices].some(voice => voice.type === 'music'), false);
  assert.equal([...audio.voices].filter(voice => voice.type === 'ambient').length, 1);
  let sawFootstep = false;
  for (let activeMs = 0; activeMs <= 1_000; activeMs += 20) {
    audio.context.currentTime = activeMs / 1_000;
    audio.updateMusic(activeMs);
    audio.updateNature(activeMs);
    if ([...audio.voices].some(voice => voice.type === 'ambient-cue' && voice.kind === 'footstep')) sawFootstep = true;
  }
  assert.ok(sawFootstep, 'footsteps continue with BGM muted');

  audio.setMusicEnabled(true);
  assert.ok([...audio.voices].some(voice => voice.type === 'music'));
  audio.setAmbientEnabled(false);
  assert.equal([...audio.voices].some(voice => voice.type === 'ambient' || voice.type === 'ambient-cue'), false);
  assert.ok([...audio.voices].some(voice => voice.type === 'music'), 'ambient mute preserves BGM');

  const voices = [...audio.voices];
  audio.stop();
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.musicRunning, false);
  assert.equal(audio.natureRunning, false);
  assert.ok(voices.every(voice => voice.nodes.every(node => node.disconnected)), 'stop disconnects both buses');
});

test('classic environment scenes still start with BGM disabled', async () => {
  const audio = new Audio(() => {}, { Context: NatureAudioContext, ...quietAssets });
  assert.equal(audio.setEnvironment('cave'), 'cave');
  await audio.unlock();
  audio.setMusicEnabled(false);
  audio.startMusic(0);

  const bed = [...audio.voices].find(voice => voice.type === 'ambient');
  assert.ok(bed);
  assert.equal(bed.environment, 'cave');
  assert.equal(bed.routeId, null);
  assert.equal(bed.gain.connectedTo, audio.ambientGain);
  assert.equal([...audio.voices].some(voice => voice.type === 'music'), false);
  audio.stop();
});

test('minimal fake contexts can omit noise APIs without blocking music or throwing', async () => {
  class MinimalContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createGain() { return { gain: new FakeParam(), connect() {}, disconnect() {} }; }
    createOscillator() {
      return { frequency: new FakeParam(), connect() {}, disconnect() {}, start() {}, stop() {} };
    }
  }
  const audio = new Audio(() => {}, { Context: MinimalContext, ...quietAssets });
  audio.setJourneyRoute('dusk-2');
  await audio.unlock();
  assert.doesNotThrow(() => audio.startMusic(0));
  assert.equal([...audio.voices].filter(voice => voice.type === 'ambient').length, 0);
  assert.doesNotThrow(() => audio.updateNature(0));
  assert.equal(audio.playNature('scent'), false, 'unsupported noise nodes fail silently');
  assert.equal(audio.playNature('animal'), true, 'supported oscillator actions still work');
  assert.doesNotThrow(() => audio.setAmbientEnabled(false));
  audio.stop();
  assert.equal(audio.voices.size, 0);
});

test('a route source that fails during start releases its modulation and graph', async () => {
  class BrokenBufferSourceContext extends NatureAudioContext {
    createBufferSource() {
      const source = super.createBufferSource();
      const start = source.start;
      source.start = function (time) {
        if (this.loop) throw new Error('source unavailable');
        return start.call(this, time);
      };
      return source;
    }
  }
  const audio = new Audio(() => {}, { Context: BrokenBufferSourceContext, ...quietAssets });
  audio.setJourneyRoute('mountain-2');
  await audio.unlock();
  assert.doesNotThrow(() => audio.startMusic(0));
  assert.equal([...audio.voices].some(voice => voice.type === 'ambient'), false);

  const modulator = audio.context.oscillators.find(oscillator => oscillator.frequency.value === .08);
  assert.ok(modulator?.cancelled, 'the already-started modulation oscillator is stopped');
  const routeSource = audio.context.bufferSources.find(source => source.loop);
  assert.ok(routeSource?.disconnected);
  audio.stop();
});
