const MUSIC_LOOKAHEAD_MS = 120;
const MUSIC_DISCONTINUITY_MS = 500;
// Six 4/4 bars at 120 BPM (12 seconds): C, G, Am, G, F, C. Gaps in
// the melody are intentional rests; the quieter lower notes provide plucked
// bass movement. Peaks are voice gains before the music bus (default 0.35).
const MUSIC_LOOP_MS = 12_000;
const MUSIC_EVENTS = [
  { atMs: 0, hz: 130.81, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 0, hz: 523.25, durationMs: 260, peak: 0.06, role: 'melody' },
  { atMs: 500, hz: 659.25, durationMs: 245, peak: 0.06, role: 'melody' },
  { atMs: 1_000, hz: 196, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 1_000, hz: 783.99, durationMs: 320, peak: 0.065, role: 'melody' },

  { atMs: 2_000, hz: 196, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 2_000, hz: 659.25, durationMs: 260, peak: 0.06, role: 'melody' },
  { atMs: 2_500, hz: 783.99, durationMs: 245, peak: 0.06, role: 'melody' },
  { atMs: 3_000, hz: 146.83, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 3_000, hz: 1_046.5, durationMs: 320, peak: 0.065, role: 'melody' },
  { atMs: 3_500, hz: 659.25, durationMs: 245, peak: 0.055, role: 'melody' },

  { atMs: 4_000, hz: 220, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 4_000, hz: 440, durationMs: 300, peak: 0.055, role: 'melody' },
  { atMs: 4_500, hz: 523.25, durationMs: 245, peak: 0.06, role: 'melody' },
  { atMs: 5_000, hz: 164.81, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 5_000, hz: 659.25, durationMs: 320, peak: 0.06, role: 'melody' },

  { atMs: 6_000, hz: 196, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 6_000, hz: 392, durationMs: 300, peak: 0.055, role: 'melody' },
  { atMs: 6_500, hz: 493.88, durationMs: 245, peak: 0.06, role: 'melody' },
  { atMs: 7_000, hz: 146.83, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 7_000, hz: 587.33, durationMs: 320, peak: 0.06, role: 'melody' },
  { atMs: 7_500, hz: 493.88, durationMs: 245, peak: 0.055, role: 'melody' },

  { atMs: 8_000, hz: 174.61, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 8_000, hz: 523.25, durationMs: 300, peak: 0.06, role: 'melody' },
  { atMs: 8_500, hz: 659.25, durationMs: 245, peak: 0.06, role: 'melody' },
  { atMs: 9_000, hz: 130.81, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 9_000, hz: 783.99, durationMs: 320, peak: 0.065, role: 'melody' },

  { atMs: 10_000, hz: 196, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 10_000, hz: 587.33, durationMs: 300, peak: 0.055, role: 'melody' },
  { atMs: 10_500, hz: 659.25, durationMs: 245, peak: 0.06, role: 'melody' },
  { atMs: 11_000, hz: 130.81, durationMs: 350, peak: 0.04, role: 'accompaniment' },
  { atMs: 11_000, hz: 523.25, durationMs: 390, peak: 0.06, role: 'melody' },
];

export class Audio {
  constructor(onState = () => {}, { Context = globalThis.AudioContext ?? globalThis.webkitAudioContext, timeoutMs = 2000 } = {}) {
    this.Context = Context; this.timeoutMs = timeoutMs; this.onState = onState;
    this.context = null; this.enabled = true; this.musicEnabled = true;
    this.volumes = { music: 0.35, sfx: 1 };
    this.musicGain = null; this.sfxGain = null;
    this.voices = new Set(); this.contextCount = 0;
    this.musicRunning = false; this.musicAnchorActiveMs = 0; this.musicAnchorAudioTime = 0;
    this.musicLastActiveMs = null; this.musicScheduled = new Map();
  }

  // Called synchronously from the click handler so Safari keeps user activation.
  async unlock() {
    if (!this.enabled) return { ok: true, silent: true };
    let timer, poll, completed = false;
    try {
      if (!this.Context) throw new Error('unsupported');
      if (!this.context || this.context.state === 'closed') {
        this.context = new this.Context(); this.contextCount++;
        const created = this.context;
        created.onstatechange = () => { if (this.context === created) this.onState(created.state); };
        this._createMix(created);
      }
      const context = this.context;
      this.onState(context.state);
      // resume() must happen before the first await. Some interrupted contexts
      // resolve resume before they become running, so observe the state too.
      const resume = context.resume();
      await Promise.race([
        Promise.resolve(resume).then(() => new Promise(resolve => {
          if (completed) { resolve(); return; }
          const check = () => { if (context.state === 'running') resolve(); };
          poll = setInterval(check, 20); check();
        })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); }),
      ]);
      if (context.state !== 'running') throw new Error(context.state);
      return { ok: true };
    } catch (error) {
      this.onState(this.context?.state ?? 'unavailable', error.message);
      return { ok: false, reason: error.message };
    } finally { completed = true; clearTimeout(timer); clearInterval(poll); }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (!this.musicEnabled) this._stopMusic();
  }

  setVolumes({ music, sfx } = {}) {
    const next = { music, sfx };
    for (const [name, value] of Object.entries(next)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`${name} volume must be a finite number from 0 to 1`);
      }
    }
    this.volumes = next;
    if (this.context && this.context.state !== 'closed') {
      if (!this.musicGain || !this.sfxGain) this._createMix(this.context);
      this._setGain(this.musicGain, music);
      this._setGain(this.sfxGain, sfx);
    }
    return { ...this.volumes };
  }

  startMusic(activeMs = 0) {
    if (!Number.isFinite(activeMs) || activeMs < 0) throw new RangeError('activeMs must be a finite non-negative number');
    this._stopMusic();
    const context = this.context;
    if (!this.enabled || !this.musicEnabled || context?.state !== 'running') return;
    this.musicRunning = true;
    this.musicAnchorActiveMs = activeMs;
    this.musicAnchorAudioTime = context.currentTime;
    this.musicLastActiveMs = activeMs;
    this.updateMusic(activeMs);
  }

  updateMusic(activeMs) {
    if (!Number.isFinite(activeMs) || activeMs < 0) return;
    const context = this.context;
    if (!this.musicRunning || !this.enabled || !this.musicEnabled || context?.state !== 'running') return;

    if (this.musicLastActiveMs !== null &&
        (activeMs < this.musicLastActiveMs || activeMs - this.musicLastActiveMs > MUSIC_DISCONTINUITY_MS)) {
      // A pause, hidden-tab suspension, or clock reset must not replay missed notes.
      this._stopMusicVoices();
      this.musicScheduled.clear();
      this.musicAnchorActiveMs = activeMs;
      this.musicAnchorAudioTime = context.currentTime;
    }
    this.musicLastActiveMs = activeMs;

    const from = activeMs;
    const through = activeMs + MUSIC_LOOKAHEAD_MS;
    const firstCycle = Math.max(0, Math.floor((from - this.musicAnchorActiveMs) / MUSIC_LOOP_MS));
    const lastCycle = Math.max(firstCycle, Math.floor((through - this.musicAnchorActiveMs) / MUSIC_LOOP_MS));

    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      for (let index = 0; index < MUSIC_EVENTS.length; index++) {
        const event = MUSIC_EVENTS[index];
        const eventActiveMs = this.musicAnchorActiveMs + cycle * MUSIC_LOOP_MS + event.atMs;
        if (eventActiveMs < from - 1 || eventActiveMs > through) continue;
        const key = `${cycle}:${index}`;
        if (this.musicScheduled.has(key)) continue;
        const when = Math.max(context.currentTime, this.musicAnchorAudioTime + (eventActiveMs - this.musicAnchorActiveMs) / 1000);
        const voice = this._playMusicNote(event, when);
        if (voice) this.musicScheduled.set(key, { at: eventActiveMs, voice });
      }
    }

    // Keep the scheduler's bookkeeping bounded for long runs.
    for (const [key, event] of this.musicScheduled) {
      if (event.at < activeMs - 400) this.musicScheduled.delete(key);
    }
  }

  play(level, kind = 'normal') {
    const ctx = this.context;
    if (!this.enabled || ctx?.state !== 'running') return;
    const frequencies = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(), now = ctx.currentTime;
    const frequency = frequencies[level - 1] * (kind === 'gold' ? 1.5 : 1);
    oscillator.type = kind === 'gold' ? 'triangle' : 'sine'; oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'gold' ? 2 : 1.3), now + .08);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.14, now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
    oscillator.connect(gain); gain.connect(this.sfxGain ?? ctx.destination);
    const voice = { oscillator, gain, type: 'sfx' }; this._trackVoice(voice);
    oscillator.start(now); oscillator.stop(now + .18);
  }

  stop() {
    this._stopVoices(() => true);
    this._resetMusicScheduler();
  }

  _createMix(context) {
    this.musicGain = context.createGain();
    this.sfxGain = context.createGain();
    this._setGain(this.musicGain, this.volumes.music);
    this._setGain(this.sfxGain, this.volumes.sfx);
    this.musicGain.connect(context.destination);
    this.sfxGain.connect(context.destination);
  }

  _setGain(node, value) {
    const param = node?.gain;
    if (!param) return;
    if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(this.context?.currentTime ?? 0);
    if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, this.context?.currentTime ?? 0);
    else param.value = value;
  }

  _trackVoice(voice) {
    this.voices.add(voice);
    voice.oscillator.onended = () => {
      voice.oscillator.disconnect(); voice.gain.disconnect(); this.voices.delete(voice);
      for (const [key, event] of this.musicScheduled) if (event.voice === voice) this.musicScheduled.delete(key);
    };
    return voice;
  }

  _playMusicNote(event, when) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.musicGain) return null;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(event.hz, when);
    // Separate short plucks leave rests audible. Lower accompaniment and the
    // soft bus level keep the melody's default peak well under the SFX peak.
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(event.peak, when + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, when + event.durationMs / 1000);
    oscillator.connect(gain); gain.connect(this.musicGain);
    const voice = { oscillator, gain, type: 'music', role: event.role }; this._trackVoice(voice);
    oscillator.start(when); oscillator.stop(when + event.durationMs / 1000 + .015);
    return voice;
  }

  _stopMusic() {
    this._stopVoices(voice => voice.type === 'music');
    this._resetMusicScheduler();
  }

  _stopMusicVoices() {
    this._stopVoices(voice => voice.type === 'music');
  }

  _stopVoices(predicate) {
    for (const voice of this.voices) {
      if (!predicate(voice)) continue;
      try { voice.oscillator.stop(); } catch { /* Already stopped. */ }
      voice.oscillator.disconnect(); voice.gain.disconnect(); this.voices.delete(voice);
    }
  }

  _resetMusicScheduler() {
    this.musicRunning = false;
    this.musicLastActiveMs = null;
    this.musicScheduled.clear();
    this.musicAnchorActiveMs = 0;
    this.musicAnchorAudioTime = 0;
  }
}
