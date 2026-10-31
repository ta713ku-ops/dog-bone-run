import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../src/audio.js';

class RunningAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.oscillators = [];
    this.gains = [];
  }
  resume() { return Promise.resolve(); }
  createOscillator() {
    const oscillator = {
      frequency: { setValueAtTime(value) { oscillator.frequencyHz = value; }, exponentialRampToValueAtTime() {} },
      connect() {}, disconnect() { this.disconnected = true; },
      start(when) { this.startedAt = when; }, stop(when) { this.stoppedAt = when; this.cancelled = arguments.length === 0; },
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const node = {
      gain: { setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { (this.ramps ??= []).push(value); } },
      connect(destination) { this.connectedTo = destination; }, disconnect() { this.disconnected = true; },
    };
    this.gains.push(node);
    return node;
  }
}

const quietAssets = {
  bark: { preload() {}, prepare() {}, play() { return false; }, stop() {} },
  whine: { playing: false, preload() {}, prepare() {}, play() { return false; }, stop() {} },
};

test('a fake context without noise APIs is ignored while the existing music pause/restart remains safe', async () => {
  const audio = new Audio(() => {}, { Context: RunningAudioContext, ...quietAssets });
  assert.equal(audio.setEnvironment(2), 'park');
  await audio.unlock();
  audio.setVolumes({ music: .2, sfx: .7 });
  audio.startMusic(0);
  assert.equal([...audio.voices].filter(voice => voice.type === 'ambient').length, 0,
    'a minimal fake context without buffer/filter nodes does not invent drone oscillators');
  assert.equal([...audio.voices].filter(voice => voice.type === 'music').length, 2);
  assert.equal(audio.musicGain.gain.value, .2);

  audio.setEnvironment('cave');
  assert.equal([...audio.voices].filter(voice => voice.type === 'music').length, 2);
  audio.stop();
  assert.equal([...audio.voices].filter(voice => voice.type === 'ambient').length, 0);
  audio.startMusic(8_000);
  assert.equal([...audio.voices].filter(voice => voice.type === 'music').length, 2);
  audio.stop();
});

test('discovery chime uses SFX controls while global mute and music mute stop their own channels', async () => {
  const audio = new Audio(() => {}, { Context: RunningAudioContext, ...quietAssets });
  await audio.unlock();
  audio.setVolumes({ music: .35, sfx: .4 });
  audio.setEnvironment('street');
  audio.startMusic(0);
  assert.equal(audio.playDiscovery(), true);
  const discovery = [...audio.voices].filter(voice => voice.type === 'discovery');
  assert.equal(discovery.length, 2);
  assert.ok(discovery.every(voice => voice.gain.connectedTo === audio.sfxGain));

  audio.setMusicEnabled(false);
  assert.equal([...audio.voices].some(voice => voice.type === 'ambient' || voice.type === 'music'), false);
  assert.equal([...audio.voices].filter(voice => voice.type === 'discovery').length, 2, 'the discovery cue remains an SFX');
  audio.setEnabled(false);
  assert.equal(audio.playDiscovery(), false);
  assert.equal(audio.voices.size, 0);
});
