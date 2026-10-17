export const DEFAULT_PICKUP_BARK_URL = new URL('../art/audio/pickup-bark.mp3', import.meta.url);

const DEFAULT_FETCH_TIMEOUT_MS = 4_000;
const BARK_GAIN = 0.6;
const PICKUP_COOLDOWN_MS = 300;

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

function wallTimeMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export class PickupBark {
  constructor({
    fetcher = globalThis.fetch?.bind(globalThis),
    url = DEFAULT_PICKUP_BARK_URL,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    now = wallTimeMs,
    gain = BARK_GAIN,
    cooldownMs = PICKUP_COOLDOWN_MS,
  } = {}) {
    this.fetcher = fetcher;
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.gain = gain;
    this.cooldownMs = cooldownMs;

    this._bytesPromise = null;
    this._contextStates = new WeakMap();
    this._context = null;
    this._contextGeneration = 0;
    this._buffer = null;
    this._voice = null;
    this._lastPlayAt = null;
  }

  // Load the asset once. A failed or timed-out request is cached as unavailable,
  // so a later pickup cannot unexpectedly trigger a delayed request or sound.
  preload() {
    if (!this._bytesPromise) {
      this._bytesPromise = this._loadBytes().catch(() => null);
    }
    return this._bytesPromise;
  }

  async _loadBytes() {
    if (typeof this.fetcher !== 'function') return null;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId;
    let rejectTimeout;
    const timeout = new Promise((_, reject) => {
      rejectTimeout = reject;
      timeoutId = setTimeout(() => {
        controller?.abort();
        reject(new Error('pickup bark fetch timeout'));
      }, Math.max(0, this.timeoutMs));
    });

    try {
      const response = await Promise.race([
        Promise.resolve().then(() => this.fetcher(this.url, controller ? { signal: controller.signal } : {})),
        timeout,
      ]);
      if (!response || response.ok === false || typeof response.arrayBuffer !== 'function') return null;

      const bytes = await Promise.race([
        Promise.resolve().then(() => response.arrayBuffer()),
        timeout,
      ]);
      return asArrayBuffer(bytes);
    } catch {
      controller?.abort();
      // Prevent a rejected timeout promise from becoming an unhandled rejection
      // when an early fetch error wins the race.
      rejectTimeout?.(new Error('pickup bark fetch ended'));
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async prepare(context) {
    const isContextLike = context && (typeof context === 'object' || typeof context === 'function');
    if (!isContextLike || context.state === 'closed' || typeof context.decodeAudioData !== 'function') {
      if (context && this._context === context) this._clearContext(context);
      return false;
    }

    if (this._context !== context) {
      this.stop();
      this._context = context;
      this._contextGeneration++;
      this._buffer = null;
    }

    const generation = this._contextGeneration;
    let state = this._contextStates.get(context);
    if (!state) {
      state = { buffer: null, promise: null };
      this._contextStates.set(context, state);
    }

    if (state.buffer) {
      if (this._isCurrent(context, generation)) this._buffer = state.buffer;
      return this._isCurrent(context, generation);
    }

    if (!state.promise) {
      state.promise = this.preload()
        .then(bytes => bytes ? this._decode(context, bytes) : null)
        .then(buffer => {
          if (buffer) state.buffer = buffer;
          return buffer;
        })
        .catch(() => null);
    }

    const buffer = await state.promise;
    if (!buffer || !this._isCurrent(context, generation)) return false;
    this._buffer = buffer;
    return true;
  }

  _decode(context, bytes) {
    const input = bytes.slice(0);
    return new Promise(resolve => {
      let settled = false;
      const finish = buffer => {
        if (settled) return;
        settled = true;
        resolve(buffer ?? null);
      };

      try {
        const result = context.decodeAudioData(input, finish, () => finish(null));
        if (result && typeof result.then === 'function') result.then(finish, () => finish(null));
        else if (result && typeof result === 'object') finish(result);
      } catch {
        finish(null);
      }
    });
  }

  _isCurrent(context, generation) {
    return this._context === context && this._contextGeneration === generation && context.state !== 'closed';
  }

  _clearContext(context) {
    if (this._context !== context) return;
    this.stop();
    this._context = null;
    this._buffer = null;
    this._contextGeneration++;
  }

  // Playback is deliberately synchronous and never queued. The caller can keep
  // collecting bones if the buffer is still loading or the audio is suspended.
  play(context, destination = context?.destination) {
    if (context?.state === 'closed') {
      this._clearContext(context);
      return false;
    }
    if (!context || context.state !== 'running' || this._context !== context || !this._buffer) return false;
    if (this._voice) return false;

    const now = this.now();
    if (this._lastPlayAt !== null && now - this._lastPlayAt < this.cooldownMs) return false;

    let source;
    let gain;
    let voice;
    try {
      source = context.createBufferSource();
      gain = context.createGain();
      source.buffer = this._buffer;
      const gainParam = gain.gain;
      if (typeof gainParam?.setValueAtTime === 'function') gainParam.setValueAtTime(this.gain, context.currentTime ?? 0);
      else if (gainParam) gainParam.value = this.gain;
      source.connect(gain);
      gain.connect(destination ?? context.destination);

      voice = { source, gain };
      this._voice = voice;
      source.onended = () => this._disconnectVoice(voice);
      source.start(context.currentTime ?? 0);
      this._lastPlayAt = now;
      return true;
    } catch {
      if (voice) this._disconnectVoice(voice);
      else {
        try { source?.disconnect(); } catch {}
        try { gain?.disconnect(); } catch {}
      }
      return false;
    }
  }

  stop() {
    this._lastPlayAt = null;
    const voice = this._voice;
    if (!voice) return;
    try { voice.source.stop(); } catch {}
    this._disconnectVoice(voice);
  }

  get playing() { return Boolean(this._voice); }

  _disconnectVoice(voice) {
    if (voice.cleaned) return;
    voice.cleaned = true;
    if (this._voice === voice) this._voice = null;
    try { voice.source.onended = null; } catch {}
    try { voice.source.disconnect(); } catch {}
    try { voice.gain.disconnect(); } catch {}
  }
}
