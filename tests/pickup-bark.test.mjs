import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PICKUP_BARK_URL, PickupBark } from '../src/pickup-bark.js';
import { CONTACT_WHINE_URL, ContactWhine } from '../src/contact-whine.js';

function makeContext({ decodeAudioData } = {}) {
  const context = {
    state: 'running',
    currentTime: 3,
    destination: { name: 'main destination' },
    decodedInputs: [],
    sources: [],
    gains: [],
    decodeAudioData(bytes, onSuccess, onError) {
      this.decodedInputs.push(bytes);
      if (decodeAudioData) return decodeAudioData.call(this, bytes, onSuccess, onError);
      const buffer = { context: this, duration: 0.22 };
      onSuccess?.(buffer);
      return undefined;
    },
    createBufferSource() {
      const source = {
        connect(node) { this.connectedTo = node; },
        start(when) { this.startedAt = when; this.started = true; },
        stop() { this.stopCalls = (this.stopCalls ?? 0) + 1; },
        disconnect() { this.disconnected = true; },
        onended: null,
      };
      this.sources.push(source);
      return source;
    },
    createGain() {
      const gain = {
        gain: { setValueAtTime(value, at) { this.value = value; this.at = at; } },
        connect(node) { this.connectedTo = node; },
        disconnect() { this.disconnected = true; },
      };
      this.gains.push(gain);
      return gain;
    },
  };
  return context;
}

function audioFetcher(counter = { calls: 0 }) {
  return {
    counter,
    fetcher: async (_url, options) => {
      counter.calls++;
      counter.signal = options?.signal;
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    },
  };
}

test('contact whine uses its separate recording, volume and cooldown with the shared lifecycle', async () => {
  let now=1000;
  const voice=new ContactWhine({fetcher:audioFetcher().fetcher,now:()=>now});
  const ctx=makeContext();await voice.prepare(ctx);
  assert.equal(voice.url,CONTACT_WHINE_URL);
  assert.equal(voice.play(ctx),true);assert.equal(voice.playing,true);
  assert.equal(ctx.gains[0].gain.value,.55);
  ctx.sources[0].onended();assert.equal(voice.playing,false);
  now=1849;assert.equal(voice.play(ctx),false);
  now=1850;assert.equal(voice.play(ctx),true);
  voice.stop();assert.equal(voice.playing,false);
  assert.equal(ctx.sources[1].stopCalls,1);
});

test('preloads once and decodes the cached bytes for each current context', async () => {
  const { fetcher, counter } = audioFetcher();
  const bark = new PickupBark({ fetcher });
  const [firstBytes, secondBytes] = await Promise.all([bark.preload(), bark.preload()]);
  assert.equal(firstBytes.byteLength, 4);
  assert.equal(secondBytes, firstBytes);
  assert.equal(counter.calls, 1);
  assert.equal(DEFAULT_PICKUP_BARK_URL.pathname.endsWith('/art/audio/pickup-bark.mp3'), true);

  const firstContext = makeContext();
  const secondContext = makeContext();
  assert.equal(await bark.prepare(firstContext), true);
  assert.equal(await bark.prepare(secondContext), true);
  assert.equal(counter.calls, 1, 'context replacement reuses the downloaded bytes');
  assert.equal(firstContext.decodedInputs.length, 1);
  assert.equal(secondContext.decodedInputs.length, 1);
  assert.notEqual(firstContext.decodedInputs[0], secondContext.decodedInputs[0], 'decode receives a fresh copy');
});

test('plays one modest voice at a time and enforces a 300ms wall-clock cooldown', async () => {
  let now = 1_000;
  const bark = new PickupBark({ fetcher: audioFetcher().fetcher, now: () => now });
  const context = makeContext();
  const sfxBus = { name: 'sfx bus' };
  await bark.prepare(context);

  assert.equal(bark.play(context, sfxBus), true);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].buffer.context, context);
  assert.equal(context.sources[0].startedAt, context.currentTime);
  assert.equal(context.gains[0].gain.value, 0.6);
  assert.equal(context.gains[0].connectedTo, sfxBus);
  assert.equal(bark.play(context, sfxBus), false, 'a live bark blocks overlap');
  assert.equal(context.sources.length, 1);

  context.sources[0].onended();
  now = 1_299;
  assert.equal(bark.play(context, sfxBus), false, 'a pickup within 300ms is dropped');
  now = 1_300;
  assert.equal(bark.play(context, sfxBus), true, 'a new pickup is allowed at the cooldown boundary');
});

test('stop ends and disconnects a voice and clears cooldown for pause, end, or mute', async () => {
  let now = 50;
  const bark = new PickupBark({ fetcher: audioFetcher().fetcher, now: () => now });
  const context = makeContext();
  await bark.prepare(context);
  assert.equal(bark.play(context), true);
  const [source] = context.sources;
  const [gain] = context.gains;

  bark.stop();
  assert.equal(source.stopCalls, 1);
  assert.equal(source.disconnected, true);
  assert.equal(gain.disconnected, true);
  assert.equal(bark.play(context), true, 'stop resets the cooldown immediately');
  assert.equal(context.sources.length, 2);
});

test('a pickup during preparation is dropped and is never replayed after decoding', async () => {
  let resolveDecode;
  const buffer = { duration: 0.22 };
  const context = makeContext({ decodeAudioData: () => new Promise(resolve => { resolveDecode = resolve; }) });
  const bark = new PickupBark({ fetcher: audioFetcher().fetcher });
  const preparing = bark.prepare(context);
  assert.equal(bark.play(context), false);

  for (let turn = 0; turn < 20 && !resolveDecode; turn++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof resolveDecode, 'function', 'decode should start after the asset bytes load');
  resolveDecode(buffer);
  assert.equal(await preparing, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(context.sources.length, 0, 'the earlier pickup is not queued for late playback');
});

test('fetch and decode failures resolve quietly and never schedule playback', async () => {
  let fetchCalls = 0;
  const failedFetch = new PickupBark({ fetcher: async () => { fetchCalls++; throw new Error('offline'); } });
  assert.equal(await failedFetch.preload(), null);
  assert.equal(await failedFetch.prepare(makeContext()), false);
  assert.equal(await failedFetch.preload(), null);
  assert.equal(fetchCalls, 1);

  const decodeFailureContext = makeContext({ decodeAudioData: () => { throw new Error('bad audio'); } });
  const failedDecode = new PickupBark({ fetcher: audioFetcher().fetcher });
  assert.equal(await failedDecode.prepare(decodeFailureContext), false);
  assert.equal(failedDecode.play(decodeFailureContext), false);
  assert.equal(decodeFailureContext.sources.length, 0);
});

test('a context without decodeAudioData remains silent without fetching', async () => {
  let fetchCalls = 0;
  const bark = new PickupBark({ fetcher: async () => { fetchCalls++; throw new Error('should not fetch'); } });
  const context = makeContext();
  delete context.decodeAudioData;
  assert.equal(await bark.prepare(context), false);
  assert.equal(fetchCalls, 0);
});

test('a stalled request is aborted after the configured fetch bound', async () => {
  let signal;
  const bark = new PickupBark({
    timeoutMs: 8,
    fetcher: (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  assert.equal(await bark.preload(), null);
  assert.equal(signal.aborted, true);
});

test('a stale decode cannot replace the buffer for a newer context', async () => {
  let resolveOldDecode;
  const oldBuffer = { name: 'old context buffer' };
  const newBuffer = { name: 'new context buffer' };
  const oldContext = makeContext({ decodeAudioData: () => new Promise(resolve => { resolveOldDecode = resolve; }) });
  const newContext = makeContext({ decodeAudioData: () => Promise.resolve(newBuffer) });
  const bark = new PickupBark({ fetcher: audioFetcher().fetcher });

  const oldPreparation = bark.prepare(oldContext);
  for (let turn = 0; turn < 20 && !resolveOldDecode; turn++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof resolveOldDecode, 'function');
  assert.equal(await bark.prepare(newContext), true);
  resolveOldDecode(oldBuffer);
  assert.equal(await oldPreparation, false);
  assert.equal(bark.play(oldContext), false);
  assert.equal(bark.play(newContext), true);
  assert.equal(newContext.sources[0].buffer, newBuffer);
});

test('a closed current context is discarded and cannot play', async () => {
  const context = makeContext();
  const bark = new PickupBark({ fetcher: audioFetcher().fetcher });
  assert.equal(await bark.prepare(context), true);
  context.state = 'closed';
  assert.equal(bark.play(context), false);
  const replacement = makeContext();
  assert.equal(await bark.prepare(replacement), true);
  assert.equal(bark.play(replacement), true);
});
