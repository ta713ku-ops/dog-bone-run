import { PickupBark } from './pickup-bark.js';
import { ContactWhine } from './contact-whine.js';
import { getJourneyRoute } from './journey-catalog.js';

const MUSIC_LOOKAHEAD_MS = 120;
const MUSIC_DISCONTINUITY_MS = 500;
// Six 4/4 bars at 120 BPM (12 seconds): C, G, Am, G, F, C. Gaps in
// the melody are intentional rests; the quieter lower notes provide plucked
// bass movement. Peaks are voice gains before the music bus (default 0.35).
const MUSIC_LOOP_MS = 12_000;
const NATURE_LOOKAHEAD_MS = 120;
const ENVIRONMENT_LEVELS = Object.freeze({ street: 1, park: 2, mountain: 3, cave: 4 });
const MAX_AMBIENT_CUES = 3;
const MAX_NATURE_ACTIONS = 2;

const environmentScene = (id, bed, filterType, cutoffHz, peak, stepEveryMs, stepCutoffHz, cues) => ({
  id, bed, filterType, cutoffHz, peak, modulationHz: .08, modulation: peak * .19,
  stepEveryMs, stepCutoffHz, stepPeak: .007, cues,
});

const ENVIRONMENT_NATURE_SCENES = Object.freeze({
  street: environmentScene('street', 'wind', 'lowpass', 1_050, .008, 850, 720, [
    { id: 'sparrow', kind: 'bird', offsetMs: 3_500, everyMs: 17_000, pan: -.42 },
  ]),
  park: environmentScene('park', 'wind', 'lowpass', 1_700, .0075, 780, 1_100, [
    { id: 'birdsong', kind: 'bird', offsetMs: 2_200, everyMs: 13_500, pan: .38 },
  ]),
  mountain: environmentScene('mountain', 'wind', 'bandpass', 720, .0085, 940, 520, [
    { id: 'distant-bird', kind: 'bird', offsetMs: 5_500, everyMs: 19_000, pan: -.3 },
  ]),
  cave: environmentScene('cave', 'cave', 'lowpass', 630, .011, 1_050, 420, [
    { id: 'drip', kind: 'drop', offsetMs: 2_000, everyMs: 7_500, pan: .22 },
  ]),
});

const ROUTE_NATURE_SCENES = Object.freeze({
  'street-1': environmentScene('street-1', 'wind', 'lowpass', 1_250, .007, 810, 850, [
    { id: 'morning-bird', kind: 'bird', offsetMs: 2_800, everyMs: 16_500, pan: -.35 },
  ]),
  'street-2': environmentScene('street-2', 'water', 'lowpass', 880, .009, 870, 650, [
    { id: 'river-drop', kind: 'drop', offsetMs: 2_400, everyMs: 6_900, pan: .36 },
    { id: 'river-bird', kind: 'bird', offsetMs: 8_100, everyMs: 21_000, pan: -.42 },
  ]),
  'street-3': environmentScene('street-3', 'water', 'bandpass', 1_450, .008, 830, 610, [
    { id: 'puddle-drop', kind: 'drop', offsetMs: 1_200, everyMs: 5_800, pan: -.18 },
  ]),
  'park-1': environmentScene('park-1', 'wind', 'lowpass', 1_850, .007, 760, 1_100, [
    { id: 'hill-bird', kind: 'bird', offsetMs: 1_900, everyMs: 12_400, pan: .42 },
  ]),
  'park-2': environmentScene('park-2', 'wind', 'bandpass', 1_100, .008, 790, 780, [
    { id: 'canopy-bird', kind: 'bird', offsetMs: 3_700, everyMs: 18_200, pan: -.4 },
    { id: 'leaf-rustle', kind: 'leaf', offsetMs: 7_200, everyMs: 14_500, pan: .28 },
  ]),
  'park-3': environmentScene('park-3', 'water', 'lowpass', 730, .0095, 880, 560, [
    { id: 'pond-drop', kind: 'drop', offsetMs: 2_100, everyMs: 7_600, pan: .32 },
    { id: 'pond-bird', kind: 'bird', offsetMs: 9_300, everyMs: 20_000, pan: -.38 },
  ]),
  'mountain-1': environmentScene('mountain-1', 'wind', 'bandpass', 820, .009, 960, 520, [
    { id: 'forest-bird', kind: 'bird', offsetMs: 4_200, everyMs: 18_500, pan: .35 },
    { id: 'forest-leaf', kind: 'leaf', offsetMs: 8_800, everyMs: 15_700, pan: -.22 },
  ]),
  'mountain-2': environmentScene('mountain-2', 'wind', 'lowpass', 960, .008, 1_000, 470, [
    { id: 'ridge-bird', kind: 'bird', offsetMs: 6_700, everyMs: 23_000, pan: -.45 },
  ]),
  'mountain-3': environmentScene('mountain-3', 'wind', 'bandpass', 1_300, .0085, 900, 880, [
    { id: 'pine-leaf', kind: 'leaf', offsetMs: 2_900, everyMs: 9_600, pan: .26 },
    { id: 'woodpecker', kind: 'bird', offsetMs: 10_000, everyMs: 22_500, pan: -.35 },
  ]),
  'cave-1': environmentScene('cave-1', 'cave', 'lowpass', 590, .011, 1_080, 390, [
    { id: 'entrance-drip', kind: 'drop', offsetMs: 1_600, everyMs: 5_600, pan: .2 },
  ]),
  'cave-2': environmentScene('cave-2', 'cave', 'bandpass', 940, .0105, 1_140, 500, [
    { id: 'moss-drip', kind: 'drop', offsetMs: 3_300, everyMs: 8_400, pan: -.25 },
    { id: 'crystal-ping', kind: 'crystal', offsetMs: 6_200, everyMs: 15_000, pan: .38 },
  ]),
  'cave-3': environmentScene('cave-3', 'cave', 'lowpass', 470, .012, 1_120, 350, [
    { id: 'deep-drip', kind: 'drop', offsetMs: 2_700, everyMs: 4_900, pan: .32 },
  ]),
  'dusk-1': environmentScene('dusk-1', 'water', 'lowpass', 660, .009, 900, 560, [
    { id: 'sunset-ripple', kind: 'drop', offsetMs: 3_800, everyMs: 7_700, pan: -.32 },
    { id: 'evening-bird', kind: 'bird', offsetMs: 12_000, everyMs: 24_000, pan: .36 },
  ]),
  'dusk-2': environmentScene('dusk-2', 'water', 'bandpass', 1_450, .0085, 870, 670, [
    { id: 'pond-cricket', kind: 'cricket', offsetMs: 1_400, everyMs: 6_200, pan: .42 },
    { id: 'firefly-water', kind: 'drop', offsetMs: 4_300, everyMs: 9_200, pan: -.28 },
  ]),
  'dusk-3': environmentScene('dusk-3', 'wind', 'lowpass', 740, .009, 1_030, 450, [
    { id: 'star-chime', kind: 'crystal', offsetMs: 7_400, everyMs: 18_500, pan: -.38 },
    { id: 'night-bird', kind: 'bird', offsetMs: 14_000, everyMs: 26_000, pan: .3 },
  ]),
});

const NATURE_ACTIONS = Object.freeze({
  scent: { kind: 'sniff', hz: 0, peak: .012, duration: .13 },
  plant: { kind: 'leaf', hz: 0, peak: .013, duration: .22 },
  animal: { kind: 'bird', hz: 1_550, peak: .018, duration: .26 },
  light: { kind: 'crystal', hz: 880, peak: .015, duration: .42 },
  water: { kind: 'drop', hz: 920, peak: .016, duration: .24 },
  landmark: { kind: 'crystal', hz: 660, peak: .014, duration: .38 },
  sound: { kind: 'crystal', hz: 520, peak: .012, duration: .46 },
  object: { kind: 'sniff', hz: 0, peak: .012, duration: .13 },
  detail: { kind: 'crystal', hz: 740, peak: .014, duration: .38 },
  weather: { kind: 'leaf', hz: 0, peak: .011, duration: .25 },
  sniff: { kind: 'sniff', hz: 0, peak: .012, duration: .13 },
  listen: { kind: 'bird', hz: 1_300, peak: .014, duration: .24 },
  look: { kind: 'crystal', hz: 740, peak: .014, duration: .38 },
  discovery: { kind: 'crystal', hz: 880, peak: .015, duration: .4 },
});
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
  constructor(onState = () => {}, { Context = globalThis.AudioContext ?? globalThis.webkitAudioContext, timeoutMs = 2000, bark = new PickupBark(), whine = new ContactWhine() } = {}) {
    this.Context = Context; this.timeoutMs = timeoutMs; this.onState = onState;
    this.context = null; this.enabled = true; this.musicEnabled = true;
    this.volumes = { music: 0.35, sfx: 1 };
    this.musicGain = null; this.ambientGain = null; this.sfxGain = null;
    this.voices = new Set(); this.contextCount = 0;
    this.musicRunning = false; this.natureRunning = false;
    this.musicAnchorActiveMs = 0; this.musicAnchorAudioTime = 0;
    this.musicLastActiveMs = null; this.musicScheduled = new Map();
    this.environment = null; this.journeyRoute = null; this.ambientEnabled = true;
    this.natureNoiseBuffer = null; this.natureBufferContext = null;
    this.natureAnchorActiveMs = null; this.natureAnchorAudioTime = null;
    this.natureLastActiveMs = null; this.natureScheduled = new Map();
    this.natureSuppressedUntil = -Infinity;
    this.bark = bark;
    this.whine = whine;
    this.lastContactAudioTime = -Infinity;
  }

  preload() { void this.whine.preload(); return this.bark.preload(); }

  // Called synchronously from the click handler so Safari keeps user activation.
  async unlock() {
    if (!this.enabled) return { ok: true, silent: true };
    let timer, poll, completed = false;
    try {
      if (!this.Context) throw new Error('unsupported');
      if (!this.context || this.context.state === 'closed') {
        if (this.context) this.stop();
        this.context = new this.Context(); this.contextCount++;
        this.natureNoiseBuffer = null; this.natureBufferContext = null;
        this.lastContactAudioTime = -Infinity;
        const created = this.context;
        created.onstatechange = () => { if (this.context === created) this.onState(created.state); };
        this._createMix(created);
      }
      const context = this.context;
      this.onState(context.state);
      // resume() must happen before the first await. Some interrupted contexts
      // resolve resume before they become running, so observe the state too.
      const resume = context.resume();
      // Never delay the user-activation resume or the start of the game for an SFX file.
      void this.bark.prepare(context);
      void this.whine.prepare(context);
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
    if (!this.musicEnabled) {
      this._stopMusicVoices();
      this.musicScheduled.clear();
    } else if (this.musicRunning) {
      const activeMs = this.musicLastActiveMs ?? this.musicAnchorActiveMs;
      this.musicScheduled.clear();
      this.musicAnchorActiveMs = activeMs;
      this.musicAnchorAudioTime = this.context?.currentTime ?? 0;
      this.updateMusic(activeMs);
    }
  }

  setAmbientEnabled(enabled) {
    this.ambientEnabled = Boolean(enabled);
    if (!this.ambientEnabled) {
      this._stopVoices(voice => voice.type === 'ambient' || voice.type === 'ambient-cue');
      this._resetNatureScheduler();
    } else if (this.natureRunning) {
      const activeMs = this.musicLastActiveMs ?? this.musicAnchorActiveMs;
      this._resetNatureScheduler(activeMs, this.context?.currentTime ?? 0);
      this._startAmbient();
      this.updateNature(activeMs);
    }
    return this.ambientEnabled;
  }

  setEnvironment(level) {
    const numeric = Number.isFinite(level) ? level : ENVIRONMENT_LEVELS[level];
    this.environment = Object.keys(ENVIRONMENT_LEVELS).find(name => ENVIRONMENT_LEVELS[name] === numeric) ?? null;
    this.journeyRoute = null;
    if (this.natureRunning) {
      this._resetNatureScheduler(this.musicLastActiveMs ?? this.musicAnchorActiveMs, this.context?.currentTime ?? 0);
      this._startAmbient();
    }
    return this.environment;
  }

  setJourneyRoute(routeId) {
    const route = typeof routeId === 'string' ? getJourneyRoute(routeId) : null;
    this.journeyRoute = route?.id ?? null;
    this.environment = route
      ? Object.keys(ENVIRONMENT_LEVELS).find(name => ENVIRONMENT_LEVELS[name] === route.level) ?? null
      : null;
    if (this.natureRunning) {
      const activeMs = this.musicLastActiveMs ?? this.musicAnchorActiveMs;
      this._resetNatureScheduler(activeMs, this.context?.currentTime ?? 0);
      this._startAmbient();
      this.updateNature(activeMs);
    }
    return this.journeyRoute;
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
      if (!this.musicGain || !this.ambientGain || !this.sfxGain) this._createMix(this.context);
      this._setGain(this.musicGain, music);
      // The existing BGM volume slider also scales ambience; the separate
      // buses let its BGM mute leave the nature soundscape running.
      this._setGain(this.ambientGain, music);
      this._setGain(this.sfxGain, sfx);
    }
    return { ...this.volumes };
  }

  startMusic(activeMs = 0) {
    if (!Number.isFinite(activeMs) || activeMs < 0) throw new RangeError('activeMs must be a finite non-negative number');
    this._stopMusic();
    this._stopNature();
    const context = this.context;
    if (!this.enabled || context?.state !== 'running') return;
    this.musicRunning = true;
    this.natureRunning = true;
    this.musicAnchorActiveMs = activeMs;
    this.musicAnchorAudioTime = context.currentTime;
    this.musicLastActiveMs = activeMs;
    this.updateMusic(activeMs);
    this._resetNatureScheduler(activeMs, context.currentTime);
    this._startAmbient();
    this.updateNature(activeMs);
  }

  updateMusic(activeMs) {
    if (!Number.isFinite(activeMs) || activeMs < 0) return;
    const context = this.context;
    if (!this.musicRunning || !this.enabled || context?.state !== 'running') return;
    if (!this.musicEnabled) {
      this.musicLastActiveMs = activeMs;
      return;
    }

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

  updateNature(activeMs) {
    if (!Number.isFinite(activeMs) || activeMs < 0) return false;
    const context = this.context;
    if (!this.enabled || !this.ambientEnabled || !this.natureRunning
      || context?.state !== 'running' || !this.ambientGain) return false;
    const scene = this._natureScene();
    if (!scene) return false;

    if (this.natureLastActiveMs !== null && (activeMs < this.natureLastActiveMs
      || activeMs - this.natureLastActiveMs > MUSIC_DISCONTINUITY_MS)) {
      this._stopVoices(voice => voice.type === 'ambient-cue');
      this._resetNatureScheduler(activeMs, context.currentTime);
    }
    this.natureLastActiveMs = activeMs;
    this._pruneNatureVoices(context.currentTime);
    if (this.whine.playing || context.currentTime < this.natureSuppressedUntil) return true;
    if (![...this.voices].some(voice => voice.type === 'ambient')) {
      this._startAmbient();
    }
    if (this.natureAnchorActiveMs === null) this._resetNatureScheduler(activeMs, context.currentTime);

    const events = [
      { id: 'footstep', kind: 'footstep', offsetMs: Math.floor(scene.stepEveryMs * .55), everyMs: scene.stepEveryMs },
      ...scene.cues,
    ];
    const through = activeMs + NATURE_LOOKAHEAD_MS;
    for (const event of events) {
      const firstIndex = Math.max(0, Math.floor((activeMs - event.offsetMs) / event.everyMs));
      const lastIndex = Math.max(firstIndex, Math.floor((through - event.offsetMs) / event.everyMs));
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const eventActiveMs = event.offsetMs + index * event.everyMs;
        if (eventActiveMs < activeMs - 1 || eventActiveMs > through) continue;
        const key = `${scene.id}:${event.id}:${index}`;
        if (this.natureScheduled.has(key)) continue;
        const activeCues = [...this.voices].filter(voice => voice.type === 'ambient-cue').length;
        if (activeCues >= MAX_AMBIENT_CUES) continue;
        const when = Math.max(context.currentTime,
          this.natureAnchorAudioTime + (eventActiveMs - this.natureAnchorActiveMs) / 1000);
        const voice = this._playNatureCue(event, when, scene);
        if (voice) this.natureScheduled.set(key, { at: eventActiveMs, voice });
      }
    }
    for (const [key, event] of this.natureScheduled) {
      if (event.at < activeMs - 500) this.natureScheduled.delete(key);
    }
    return true;
  }

  playDiscovery() {
    const context = this.context;
    if (!this.enabled || context?.state !== 'running') return false;
    const frequencies = [698.46, 1_046.5];
    const now = context.currentTime;
    frequencies.forEach((frequency, index) => {
      const when = now + index * .075;
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, when);
      gain.gain.setValueAtTime(.0001, when);
      gain.gain.exponentialRampToValueAtTime(index ? .045 : .07, when + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, when + .17);
      oscillator.connect(gain); gain.connect(this.sfxGain ?? context.destination);
      this._trackVoice({ oscillator, gain, type: 'discovery' });
      oscillator.start(when); oscillator.stop(when + .19);
    });
    return true;
  }

  playNature(kind) {
    const action = typeof kind === 'string' ? NATURE_ACTIONS[kind] : null;
    const context = this.context;
    if (!action || !this.enabled || context?.state !== 'running' || !this.sfxGain) return false;
    const now = context.currentTime;
    const contactPriority = this.whine.playing || now - this.lastContactAudioTime < .85;
    const warningActive = [...this.voices].some(voice => voice.type === 'warning');
    const recentCollect = Number.isFinite(this.lastCollectAudioTime) && now - this.lastCollectAudioTime < .18;
    if (contactPriority || warningActive || recentCollect) return false;

    const existing = [...this.voices].filter(voice => voice.type === 'nature-action');
    while (existing.length >= MAX_NATURE_ACTIONS) {
      const oldest = existing.shift();
      this._stopVoices(voice => voice === oldest);
    }
    const voice = this._playNatureCue({ id: `action-${kind}`, kind: action.kind, peak: action.peak,
      duration: action.duration, hz: action.hz, pan: .12 }, now, this._natureScene(), this.sfxGain, 'nature-action');
    return Boolean(voice);
  }

  play(level, kind = 'normal') {
    const ctx = this.context;
    if (!this.enabled || ctx?.state !== 'running') return;
    this.lastCollectAudioTime = ctx.currentTime;
    this._stopVoices(voice => voice.type === 'warning');
    const contactPriority = this.whine.playing || ctx.currentTime - this.lastContactAudioTime < .85;
    const barkPlayed = !contactPriority && this.bark.play(ctx, this.sfxGain ?? ctx.destination);
    const frequencies = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(), now = ctx.currentTime;
    const frequency = frequencies[level - 1] * (kind === 'gold' ? 1.5 : 1);
    oscillator.type = kind === 'gold' ? 'triangle' : 'sine'; oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'gold' ? 2 : 1.3), now + .08);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(contactPriority ? .025 : barkPlayed ? .05 : .14, now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
    oscillator.connect(gain); gain.connect(this.sfxGain ?? ctx.destination);
    const voice = { oscillator, gain, type: 'sfx' }; this._trackVoice(voice);
    oscillator.start(now); oscillator.stop(now + .18);
  }

  playContact() {
    const ctx = this.context;
    if (!this.enabled || ctx?.state !== 'running' || this.whine.playing
      || ctx.currentTime - this.lastContactAudioTime < .85) return false;
    this.lastContactAudioTime = ctx.currentTime;
    this.natureSuppressedUntil = ctx.currentTime + .85;
    this.bark.stop();
    this._stopVoices(voice => voice.type !== 'music');
    if (this.whine.play(ctx, this.sfxGain ?? ctx.destination)) return true;
    // An unavailable recording gets a quiet descending cue, never a bark.
    const now = ctx.currentTime, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(420, now);
    oscillator.frequency.exponentialRampToValueAtTime(240, now + .22);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.07, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .25);
    oscillator.connect(gain); gain.connect(this.sfxGain ?? ctx.destination);
    this._trackVoice({ oscillator, gain, type: 'contact' });
    oscillator.start(now); oscillator.stop(now + .27); return true;
  }

  playWarning(kind) {
    const ctx = this.context;
    if (!this.enabled || ctx?.state !== 'running' || !['crow', 'ball'].includes(kind)) return false;
    if (Number.isFinite(this.lastCollectAudioTime) && ctx.currentTime - this.lastCollectAudioTime < .20) return false;
    this._stopVoices(voice => voice.type === 'warning');
    const now = ctx.currentTime, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    const hz = kind === 'crow' ? 260 : 410;
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(hz, now);
    oscillator.frequency.exponentialRampToValueAtTime(hz * .7, now + .10);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.025, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
    oscillator.connect(gain); gain.connect(this.sfxGain ?? ctx.destination);
    this._trackVoice({ oscillator, gain, type: 'warning' });
    oscillator.start(now); oscillator.stop(now + .14); return true;
  }

  stop() {
    this.bark.stop();
    this.whine.stop();
    this.lastContactAudioTime = -Infinity;
    this.natureSuppressedUntil = -Infinity;
    this._stopVoices(() => true);
    this._resetMusicScheduler();
    this.natureRunning = false;
    this._resetNatureScheduler();
  }

  _createMix(context) {
    this.musicGain = context.createGain();
    this.ambientGain = context.createGain();
    this.sfxGain = context.createGain();
    this._setGain(this.musicGain, this.volumes.music);
    this._setGain(this.ambientGain, this.volumes.music);
    this._setGain(this.sfxGain, this.volumes.sfx);
    this.musicGain.connect(context.destination);
    this.ambientGain.connect(context.destination);
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
    voice.nodes ??= [voice.oscillator, voice.gain];
    voice.stoppers ??= [voice.oscillator];
    this.voices.add(voice);
    voice.oscillator.onended = () => {
      this._releaseVoice(voice);
      for (const [key, event] of this.musicScheduled) if (event.voice === voice) this.musicScheduled.delete(key);
      for (const [key, event] of this.natureScheduled) if (event.voice === voice) this.natureScheduled.delete(key);
    };
    return voice;
  }

  _releaseVoice(voice) {
    for (const node of new Set(voice.nodes ?? [voice.oscillator, voice.gain])) {
      try { node?.disconnect?.(); } catch { /* Optional nodes and fake contexts may not support disconnect. */ }
    }
    this.voices.delete(voice);
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
    this._stopMusicVoices();
    this._resetMusicScheduler();
  }

  _stopNature() {
    this._stopVoices(voice => voice.type === 'ambient' || voice.type === 'ambient-cue');
    this.natureRunning = false;
    this._resetNatureScheduler();
  }

  _natureScene() {
    if (this.journeyRoute) return ROUTE_NATURE_SCENES[this.journeyRoute] ?? null;
    return ENVIRONMENT_NATURE_SCENES[this.environment] ?? null;
  }

  _resetNatureScheduler(activeMs = null, audioTime = null) {
    this.natureAnchorActiveMs = activeMs;
    this.natureAnchorAudioTime = audioTime;
    this.natureLastActiveMs = activeMs;
    this.natureScheduled.clear();
  }

  _natureNoise(context) {
    if (this.natureBufferContext === context && this.natureNoiseBuffer) return this.natureNoiseBuffer;
    if (typeof context?.createBuffer !== 'function') return null;
    const sampleRate = Number.isFinite(context.sampleRate) && context.sampleRate > 0 ? context.sampleRate : 44_100;
    const length = Math.max(1, Math.floor(sampleRate * 1.5));
    try {
      const buffer = context.createBuffer(1, length, sampleRate);
      const channel = buffer.getChannelData?.(0);
      if (!channel || channel.length === 0) return null;
      for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
      this.natureNoiseBuffer = buffer;
      this.natureBufferContext = context;
      return buffer;
    } catch {
      return null;
    }
  }

  _setParam(param, value, when) {
    if (typeof param?.setValueAtTime === 'function') param.setValueAtTime(value, when);
    else if (param) param.value = value;
  }

  _rampParam(param, value, when) {
    if (typeof param?.exponentialRampToValueAtTime === 'function') param.exponentialRampToValueAtTime(value, when);
    else this._setParam(param, value, when);
  }

  _panner(context, destination, pan, nodes) {
    if (typeof context?.createStereoPanner !== 'function') return destination;
    try {
      const panner = context.createStereoPanner();
      this._setParam(panner.pan, Math.max(-1, Math.min(1, pan)), context.currentTime);
      panner.connect(destination);
      nodes.push(panner);
      return panner;
    } catch {
      return destination;
    }
  }

  _startAmbient() {
    const context = this.context;
    this._stopVoices(voice => voice.type === 'ambient' || voice.type === 'ambient-cue');
    const scene = this._natureScene();
    if (!scene || !this.enabled || !this.ambientEnabled || !this.natureRunning
      || context?.state !== 'running' || !this.ambientGain || this.whine.playing
      || context.currentTime < this.natureSuppressedUntil) return false;
    const now = context.currentTime;
    const nodes = [];
    const stoppers = [];
    let source;
    let voice;
    try {
      const buffer = this._natureNoise(context);
      if (!buffer || typeof context.createBufferSource !== 'function'
        || typeof context.createBiquadFilter !== 'function' || typeof context.createGain !== 'function') return false;
      source = context.createBufferSource(); nodes.push(source);
      stoppers.push(source);
      const filter = context.createBiquadFilter(); nodes.push(filter);
      const gain = context.createGain(); nodes.push(gain);
      source.buffer = buffer;
      source.loop = true;
      filter.type = scene.filterType;
      this._setParam(filter.frequency, scene.cutoffHz, now);
      this._setParam(filter.Q, scene.bed === 'cave' ? .72 : .5, now);
      this._setParam(gain.gain, .0001, now);
      this._rampParam(gain.gain, scene.peak, now + .5);
      source.connect(filter); filter.connect(gain); gain.connect(this.ambientGain);

      // A quiet low-frequency oscillator feeds the bed gain for slow gusts or
      // water movement. If AudioParam modulation is absent, the filtered noise
      // still plays at its authored base level.
      if (typeof context.createOscillator === 'function') {
        let modulator, modGain;
        try {
          modulator = context.createOscillator(); modGain = context.createGain();
          nodes.push(modulator, modGain);
          modulator.type = 'sine';
          this._setParam(modulator.frequency, scene.modulationHz, now);
          this._setParam(modGain.gain, scene.modulation, now);
          modulator.connect(modGain); modGain.connect(gain.gain);
          modulator.start(now);
          stoppers.push(modulator);
        } catch {
          try { modulator?.stop(); } catch { /* Optional modulation. */ }
          try { modulator?.disconnect?.(); modGain?.disconnect?.(); } catch { /* Optional modulation. */ }
          for (const optionalNode of [modulator, modGain]) {
            const index = nodes.indexOf(optionalNode);
            if (index >= 0) nodes.splice(index, 1);
          }
        }
      }
      voice = { oscillator: source, stoppers,
        gain, nodes, type: 'ambient', environment: this.environment, routeId: this.journeyRoute,
        bed: scene.bed, filterType: scene.filterType, cutoffHz: scene.cutoffHz };
      this._trackVoice(voice);
      source.start(now);
      return true;
    } catch {
      try { source?.stop(); } catch { /* Unsupported or already stopped. */ }
      if (voice) this._stopVoices(candidate => candidate === voice);
      else for (const node of nodes) { try { node?.disconnect?.(); } catch { /* Optional fake-context cleanup. */ } }
      return false;
    }
  }

  _playNatureCue(event, when, scene, bus = this.ambientGain, type = 'ambient-cue') {
    const defaults = {
      footstep: { sound: 'noise', filterType: 'bandpass', cutoffHz: scene?.stepCutoffHz ?? 650, peak: scene?.stepPeak ?? .007, duration: .09 },
      leaf: { sound: 'noise', filterType: 'highpass', cutoffHz: 1_750, peak: .0065, duration: .29 },
      sniff: { sound: 'noise', filterType: 'bandpass', cutoffHz: 920, peak: .011, duration: .12 },
      bird: { sound: 'tone', hz: 1_700, peak: .009, duration: .25 },
      drop: { sound: 'tone', hz: 980, peak: .011, duration: .23 },
      cricket: { sound: 'tone', hz: 3_850, peak: .007, duration: .32 },
      crystal: { sound: 'tone', hz: 760, peak: .0065, duration: .38 },
    };
    const preset = defaults[event.kind];
    if (!preset || !bus) return null;
    const peak = event.peak ?? preset.peak;
    const duration = event.duration ?? preset.duration;
    const pan = Number.isFinite(event.pan) ? event.pan : 0;
    if (preset.sound === 'noise') {
      return this._playNoiseBurst({ when, duration, peak, filterType: preset.filterType,
        cutoffHz: preset.cutoffHz, pan, bus, type, kind: event.kind });
    }
    return this._playToneBurst({ when, duration, peak, hz: event.hz ?? preset.hz,
      pan, bus, type, kind: event.kind });
  }

  _playNoiseBurst({ when, duration, peak, filterType, cutoffHz, pan, bus, type, kind }) {
    const context = this.context;
    if (typeof context?.createBufferSource !== 'function' || typeof context.createBiquadFilter !== 'function'
      || typeof context.createGain !== 'function' || !this._natureNoise(context)) return null;
    const nodes = [];
    let source;
    let voice;
    try {
      source = context.createBufferSource(); nodes.push(source);
      const filter = context.createBiquadFilter(); nodes.push(filter);
      const gain = context.createGain(); nodes.push(gain);
      source.buffer = this.natureNoiseBuffer;
      source.loop = false;
      filter.type = filterType;
      this._setParam(filter.frequency, cutoffHz, when);
      this._setParam(filter.Q, filterType === 'bandpass' ? .85 : .55, when);
      this._setParam(gain.gain, .0001, when);
      this._rampParam(gain.gain, peak, when + Math.min(.018, duration * .2));
      this._rampParam(gain.gain, .0001, when + duration);
      source.connect(filter); filter.connect(gain);
      const destination = this._panner(context, bus, pan, nodes);
      gain.connect(destination);
      voice = { oscillator: source, gain, nodes, stoppers: [source], type, kind,
        createdAt: context.currentTime, endAudioTime: when + duration + .025 };
      this._trackVoice(voice);
      source.start(when); source.stop(when + duration + .03);
      return voice;
    } catch {
      try { source?.stop(); } catch { /* Optional fake-context cleanup. */ }
      if (voice) this._releaseVoice(voice);
      else for (const node of nodes) { try { node?.disconnect?.(); } catch { /* Optional fake-context cleanup. */ } }
      return null;
    }
  }

  _playToneBurst({ when, duration, peak, hz, pan, bus, type, kind }) {
    const context = this.context;
    if (typeof context?.createOscillator !== 'function' || typeof context.createGain !== 'function') return null;
    const nodes = [];
    let oscillator;
    let voice;
    try {
      oscillator = context.createOscillator(); nodes.push(oscillator);
      const gain = context.createGain(); nodes.push(gain);
      const preset = kind === 'bird' ? [hz * .82, hz * 1.34, hz * .96]
        : kind === 'drop' ? [hz * 1.35, hz * .78]
          : kind === 'crystal' ? [hz, hz * 1.16]
            : [hz, hz];
      oscillator.type = kind === 'cricket' ? 'triangle' : 'sine';
      this._setParam(oscillator.frequency, preset[0], when);
      if (preset[1] !== preset[0]) this._rampParam(oscillator.frequency, preset[1], when + duration * .34);
      if (preset.length > 2) this._rampParam(oscillator.frequency, preset[2], when + duration * .74);
      this._setParam(gain.gain, .0001, when);
      const attack = Math.min(.025, duration * .15);
      this._rampParam(gain.gain, peak, when + attack);
      if (kind === 'cricket') {
        this._setParam(gain.gain, .0001, when + duration * .28);
        this._rampParam(gain.gain, peak * .75, when + duration * .37);
        this._setParam(gain.gain, .0001, when + duration * .55);
        this._rampParam(gain.gain, peak * .58, when + duration * .64);
        this._rampParam(gain.gain, .0001, when + duration);
      } else {
        this._rampParam(gain.gain, .0001, when + duration);
      }
      oscillator.connect(gain);
      const destination = this._panner(context, bus, pan, nodes);
      gain.connect(destination);
      voice = { oscillator, gain, nodes, stoppers: [oscillator], type, kind,
        createdAt: context.currentTime, endAudioTime: when + duration + .025 };
      this._trackVoice(voice);
      oscillator.start(when); oscillator.stop(when + duration + .03);
      return voice;
    } catch {
      try { oscillator?.stop(); } catch { /* Optional fake-context cleanup. */ }
      if (voice) this._releaseVoice(voice);
      else for (const node of nodes) { try { node?.disconnect?.(); } catch { /* Optional fake-context cleanup. */ } }
      return null;
    }
  }

  _pruneNatureVoices(now) {
    for (const voice of this.voices) {
      if ((voice.type === 'ambient-cue' || voice.type === 'nature-action')
        && Number.isFinite(voice.endAudioTime) && voice.endAudioTime <= now) {
        this._releaseVoice(voice);
      }
    }
  }

  _stopMusicVoices() {
    this._stopVoices(voice => voice.type === 'music');
  }

  _stopVoices(predicate) {
    for (const voice of this.voices) {
      if (!predicate(voice)) continue;
      for (const source of voice.stoppers ?? [voice.oscillator]) {
        try { source?.stop?.(); } catch { /* Already stopped or unsupported. */ }
      }
      this._releaseVoice(voice);
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
