const POSTURES = Object.freeze(['stand', 'sit', 'lie']);
const MODES = Object.freeze(['calm', 'curious', 'sleepy']);
const MAX_DELTA_PER_CALL_MS = 60_000;
const MAX_LOGICAL_TIME_MS = Number.MAX_SAFE_INTEGER / 2;
const MAX_DEFER_MS = 7 * 24 * 60 * 60 * 1_000;
const MODE_DURATION_MS = Object.freeze([60_000, 180_000]);
const NORMAL_HOLD_MS = Object.freeze([20_000, 45_000]);
const SLEEPY_LIE_HOLD_MS = Object.freeze([60_000, 120_000]);
const FIRST_HOLD_MS = Object.freeze([20_000, 30_000]);
const MANUAL_HOLD_MS = Object.freeze([16_000, 24_000]);
const GESTURE_GAP_MS = Object.freeze([4_000, 15_000]);
const SAME_GESTURE_COOLDOWN_MS = 25_000;

export const HOME_AUTONOMY_GESTURE_DURATIONS_MS = Object.freeze({
  'look-left': Object.freeze([3_000, 5_000]),
  'look-right': Object.freeze([3_000, 5_000]),
  'check-in': 4_000,
  'ear-flick-left': 1_200,
  'ear-flick-right': 1_200,
  drowsy: 4_000,
  'head-rest': 12_000,
  sleep: 20_000,
  'paw-adjust': 2_500,
  'weight-shift': 3_000,
});

const GESTURE_POSTURES = Object.freeze({
  'look-left': Object.freeze(['stand', 'sit', 'lie']),
  'look-right': Object.freeze(['stand', 'sit', 'lie']),
  'check-in': Object.freeze(['stand', 'sit', 'lie']),
  'ear-flick-left': Object.freeze(['stand', 'sit', 'lie']),
  'ear-flick-right': Object.freeze(['stand', 'sit', 'lie']),
  drowsy: Object.freeze(['sit', 'lie']),
  'head-rest': Object.freeze(['lie']),
  sleep: Object.freeze(['lie']),
  'paw-adjust': Object.freeze(['sit']),
  'weight-shift': Object.freeze(['stand']),
});

const MODE_GESTURE_WEIGHTS = Object.freeze({
  calm: Object.freeze({
    stand: Object.freeze({ 'look-left': 1.6, 'look-right': 1.6, 'check-in': 0.55, 'ear-flick-left': 0.45, 'ear-flick-right': 0.45, 'weight-shift': 0.45 }),
    sit: Object.freeze({ 'look-left': 1.1, 'look-right': 1.1, 'check-in': 0.6, 'ear-flick-left': 0.4, 'ear-flick-right': 0.4, drowsy: 0.25, 'paw-adjust': 0.55 }),
    lie: Object.freeze({ 'look-left': 0.65, 'look-right': 0.65, 'check-in': 0.55, 'ear-flick-left': 0.4, 'ear-flick-right': 0.4, drowsy: 0.4, 'head-rest': 0.9 }),
  }),
  curious: Object.freeze({
    stand: Object.freeze({ 'look-left': 1.5, 'look-right': 1.5, 'check-in': 0.9, 'ear-flick-left': 0.65, 'ear-flick-right': 0.65, 'weight-shift': 0.55 }),
    sit: Object.freeze({ 'look-left': 1.2, 'look-right': 1.2, 'check-in': 1.2, 'ear-flick-left': 0.6, 'ear-flick-right': 0.6, drowsy: 0.2, 'paw-adjust': 0.35 }),
    lie: Object.freeze({ 'look-left': 1.0, 'look-right': 1.0, 'check-in': 1.1, 'ear-flick-left': 0.55, 'ear-flick-right': 0.55, drowsy: 0.2 }),
  }),
  sleepy: Object.freeze({
    stand: Object.freeze({ 'look-left': 0.5, 'look-right': 0.5, 'check-in': 0.35, 'ear-flick-left': 0.4, 'ear-flick-right': 0.4, 'weight-shift': 0.2 }),
    sit: Object.freeze({ 'look-left': 0.6, 'look-right': 0.6, 'check-in': 0.35, 'ear-flick-left': 0.4, 'ear-flick-right': 0.4, drowsy: 1.2, 'paw-adjust': 0.25 }),
    lie: Object.freeze({ 'look-left': 0.35, 'look-right': 0.35, 'check-in': 0.45, 'ear-flick-left': 0.35, 'ear-flick-right': 0.35, drowsy: 1.0, 'head-rest': 1.0, sleep: 0.75 }),
  }),
});

const MODE_POSTURE_WEIGHTS = Object.freeze({
  calm: Object.freeze({ stand: 0.10, sit: 0.20, lie: 0.70 }),
  curious: Object.freeze({ stand: 0.48, sit: 0.36, lie: 0.16 }),
  sleepy: Object.freeze({ stand: 0.08, sit: 0.30, lie: 0.62 }),
});

function validPosture(value, fallback = 'stand') {
  return POSTURES.includes(value) ? value : fallback;
}

function normalizeSeed(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return 42;
  return seed >>> 0;
}

function clampDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_DEFER_MS);
}

/**
 * A seeded, time-based activity planner for the 2D home dog. It emits at most
 * one action at a time; drawing and animation timing stay with the renderer.
 */
export class HomeAutonomy {
  constructor(seed = 42) {
    this._initialSeed = normalizeSeed(seed);
    this.reset(0, 'stand');
  }

  reset(timeMs = 0, posture = 'stand') {
    const rawTime = this._validRawTime(timeMs, 0);
    this._lastRawTime = rawTime;
    this._now = 0;
    this._randomState = this._initialSeed;
    this._posture = validPosture(posture);
    this._postureStartedAt = 0;
    this._seenPostures = new Set([this._posture]);
    this._awaitingSettle = false;
    this._pendingPosture = null;
    this._holdStart = 0;
    this._firstHold = true;
    this._postureDeadline = 0;
    this._manualHoldUntil = 0;

    this._mode = this._pickMode();
    this._modeStartedAt = 0;
    this._modeDeadline = this._modeDurationFrom(0);
    this._sleepSequenceStage = this._mode === 'sleepy' && this._posture === 'lie' ? 'head-rest' : null;

    this._gestureDeadline = null;
    this._currentGesture = null;
    this._currentGestureUntil = null;
    this._lastGesture = null;
    this._lastGestureAt = null;
    this._gestureTimes = new Map();

    this._scheduleHold(0, this._intBetween(FIRST_HOLD_MS[0], FIRST_HOLD_MS[1]), false, true);
    return this.snapshot;
  }

  settle(timeMs, posture, { manual = false } = {}) {
    const now = this._advance(timeMs);
    this._refreshMode(now);
    this._adoptPosture(validPosture(posture, this._posture), now);
    this._awaitingSettle = false;
    this._pendingPosture = null;
    this._currentGesture = null;
    this._currentGestureUntil = null;

    if (this._posture !== 'lie') this._sleepSequenceStage = null;
    else if (this._mode === 'sleepy' && this._sleepSequenceStage === null) this._sleepSequenceStage = 'head-rest';

    this._firstHold = false;
    const waitMs = this._postureWaitDuration();
    this._scheduleHold(now, waitMs, Boolean(manual));
    this._firstHold = false;
    return this.snapshot;
  }

  defer(timeMs, durationMs) {
    const now = this._advance(timeMs);
    this._refreshMode(now);
    const duration = clampDuration(durationMs);
    if (duration === 0 || this._awaitingSettle) return this.snapshot;

    this._postureDeadline = Math.max(this._postureDeadline, now) + duration;
    if (this._gestureDeadline !== null) {
      this._gestureDeadline = Math.max(this._gestureDeadline, now) + duration;
    }
    if (this._currentGestureUntil !== null) {
      this._currentGestureUntil = Math.max(this._currentGestureUntil, now) + duration;
    }
    if (now < this._manualHoldUntil) this._manualHoldUntil = Math.max(this._manualHoldUntil, now) + duration;
    this._modeDeadline = Math.max(this._modeDeadline, now) + duration;
    return this.snapshot;
  }

  next(timeMs, posture) {
    const now = this._advance(timeMs);
    this._refreshMode(now);

    const actualPosture = validPosture(posture, this._posture);
    if (actualPosture !== this._posture) this._adoptPosture(actualPosture, now);
    if (this._awaitingSettle) return null;

    if (this._currentGestureUntil !== null) {
      if (now < this._currentGestureUntil) return null;
      const endedAt = this._currentGestureUntil;
      this._currentGesture = null;
      this._currentGestureUntil = null;
      // If the host stopped sampling for a while, start a fresh gap from now.
      // This prevents overdue opportunities from turning into a catch-up burst.
      this._scheduleGestureOpportunity(Math.max(now, endedAt));
    }

    if (now < this._manualHoldUntil) return null;
    this._manualHoldUntil = 0;

    if (now >= this._postureDeadline) {
      this._firstHold = false;
      if (this._sleepSequenceStage !== null && this._posture === 'lie') {
        this._postureDeadline = now + this._intBetween(GESTURE_GAP_MS[0], GESTURE_GAP_MS[1]);
      } else {
        const action = this._pickPosture(this._posture);
        if (action === this._posture) {
          this._scheduleHold(now, this._postureWaitDuration(), false);
          return null;
        }

        this._pendingPosture = action;
        this._awaitingSettle = true;
        this._gestureDeadline = null;
        return { kind: 'posture', action };
      }
    }

    if (this._gestureDeadline === null || now < this._gestureDeadline) return null;

    const action = this._pickGesture(this._posture);
    if (!action) {
      this._scheduleGestureOpportunity(now);
      return null;
    }

    const durationMs = this._gestureDuration(action);
    const until = now + durationMs;
    // A gesture is allowed to finish naturally before the next posture action.
    this._postureDeadline = Math.max(this._postureDeadline, until);
    this._gestureDeadline = null;
    this._currentGesture = action;
    this._currentGestureUntil = until;
    this._lastGesture = action;
    this._lastGestureAt = now;
    this._gestureTimes.set(action, now);
    this._advanceSleepSequence(action);

    return { kind: 'gesture', action, durationMs };
  }

  get snapshot() {
    return {
      nowMs: this._now,
      posture: this._posture,
      holdStartMs: this._holdStart,
      postureDeadlineMs: this._postureDeadline,
      gestureDeadlineMs: this._gestureDeadline,
      manualHold: this._now < this._manualHoldUntil,
      manualHoldUntilMs: this._manualHoldUntil || null,
      awaitingSettle: this._awaitingSettle,
      pendingPosture: this._pendingPosture,
      gestureUsed: this._lastGestureAt !== null && this._lastGestureAt >= this._holdStart,
      seenPostures: [...this._seenPostures],
      mode: this._mode,
      modeStartedAtMs: this._modeStartedAt,
      modeDeadlineMs: this._modeDeadline,
      lastGesture: this._lastGesture,
      lastGestureAtMs: this._lastGestureAt,
      currentGesture: this._currentGesture,
      currentGestureUntilMs: this._currentGestureUntil,
      gestureCooldowns: Object.fromEntries(this._gestureTimes),
      sleepSequenceStage: this._sleepSequenceStage,
    };
  }

  _scheduleHold(now, waitMs, manual, first = false) {
    this._holdStart = now;
    this._postureDeadline = now + waitMs;
    this._manualHoldUntil = manual ? now + this._intBetween(MANUAL_HOLD_MS[0], MANUAL_HOLD_MS[1]) : 0;
    if (manual) this._postureDeadline = Math.max(this._postureDeadline, this._manualHoldUntil + GESTURE_GAP_MS[0]);
    this._gestureDeadline = null;
    if (!manual) this._scheduleGestureOpportunity(now);
    else this._scheduleGestureOpportunity(this._manualHoldUntil);
    if (first) this._firstHold = true;
  }

  _scheduleGestureOpportunity(from) {
    this._gestureDeadline = from + this._intBetween(GESTURE_GAP_MS[0], GESTURE_GAP_MS[1]);
  }

  _postureWaitDuration() {
    const range = this._mode === 'sleepy' && this._posture === 'lie'
      ? SLEEPY_LIE_HOLD_MS
      : NORMAL_HOLD_MS;
    return this._intBetween(range[0], range[1]);
  }

  _modeDurationFrom(now) {
    return now + this._intBetween(MODE_DURATION_MS[0], MODE_DURATION_MS[1]);
  }

  _refreshMode(now) {
    if (now < this._modeDeadline) return;
    const previous = this._mode;
    this._mode = this._pickMode(previous);
    this._modeStartedAt = now;
    this._modeDeadline = this._modeDurationFrom(now);

    if (this._mode === 'sleepy' && this._posture === 'lie') {
      if (this._sleepSequenceStage === null) this._sleepSequenceStage = 'head-rest';
      if (!this._firstHold) {
        const extension = this._intBetween(SLEEPY_LIE_HOLD_MS[0], SLEEPY_LIE_HOLD_MS[1]);
        this._postureDeadline = Math.max(this._postureDeadline, now + extension);
      }
    } else if (this._mode !== 'sleepy' && this._sleepSequenceStage === 'head-rest') {
      // A sequence only becomes a promise after its first rest gesture begins.
      this._sleepSequenceStage = null;
    }
  }

  _adoptPosture(posture, now) {
    if (posture === this._posture) return;
    this._posture = posture;
    this._postureStartedAt = now;
    this._seenPostures.add(posture);
    this._sleepSequenceStage = this._mode === 'sleepy' && posture === 'lie' ? 'head-rest' : null;
    this._currentGesture = null;
    this._currentGestureUntil = null;
    if (!this._awaitingSettle) {
      this._firstHold = false;
      this._scheduleHold(now, this._postureWaitDuration(), false);
    }
  }

  _pickMode(excluding = null) {
    const options = MODES.filter((mode) => mode !== excluding);
    const weights = { calm: 0.65, curious: 0.15, sleepy: 0.20 };
    const total = options.reduce((sum, mode) => sum + weights[mode], 0);
    let needle = this._random() * total;
    for (const mode of options) {
      needle -= weights[mode];
      if (needle < 0) return mode;
    }
    return options.at(-1);
  }

  _pickPosture(current) {
    const weights = { ...MODE_POSTURE_WEIGHTS[this._mode] };
    // Repeated upright holds gradually become less likely. Lying rest remains
    // protected, and no posture has a forced next pose or a hard time limit.
    if (current !== 'lie') {
      const age = Math.max(0, this._now - this._postureStartedAt);
      weights[current] *= Math.max(0.12, 1 / (1 + age / 20_000));
    }
    const total = POSTURES.reduce((sum, posture) => sum + weights[posture], 0);
    let needle = this._random() * total;
    for (const posture of POSTURES) {
      needle -= weights[posture];
      if (needle < 0) return posture;
    }
    return current;
  }

  _pickGesture(posture) {
    // Give a newly opened home one small response before allowing quiet gaps.
    if (this._random() < 0.38 && this._lastGestureAt !== null) return null;

    const weights = MODE_GESTURE_WEIGHTS[this._mode][posture];
    const candidateWeights = new Map(Object.entries(weights));
    if (this._sleepSequenceStage === 'sleep') candidateWeights.set('sleep', Math.max(candidateWeights.get('sleep') ?? 0, 1));
    if (this._sleepSequenceStage === 'head-rest' || this._sleepSequenceStage === 'recovery') {
      candidateWeights.set('head-rest', Math.max(candidateWeights.get('head-rest') ?? 0, 1));
    }
    if (this._sleepSequenceStage === 'recovery') candidateWeights.set('check-in', Math.max(candidateWeights.get('check-in') ?? 0, 0.8));
    const candidates = [...candidateWeights].filter(([action, weight]) => {
      if (weight <= 0 || !GESTURE_POSTURES[action]?.includes(posture)) return false;
      const lastAt = this._gestureTimes.get(action);
      return lastAt === undefined || this._now - lastAt >= SAME_GESTURE_COOLDOWN_MS;
    });

    if (this._sleepSequenceStage !== null && posture === 'lie') {
      const sequenceAction = this._sequenceActionCandidate(candidates);
      if (sequenceAction) return sequenceAction;
      return null;
    }

    if (candidates.length === 0) return null;
    const total = candidates.reduce((sum, [, weight]) => sum + weight, 0);
    let needle = this._random() * total;
    for (const [action, weight] of candidates) {
      needle -= weight;
      if (needle < 0) return action;
    }
    return candidates.at(-1)[0];
  }

  _sequenceActionCandidate(candidates) {
    const actions = new Set(candidates.map(([action]) => action));
    if (this._sleepSequenceStage === 'head-rest') return actions.has('head-rest') ? 'head-rest' : null;
    if (this._sleepSequenceStage === 'sleep') return actions.has('sleep') ? 'sleep' : null;
    if (this._sleepSequenceStage === 'recovery') {
      const recovery = ['head-rest', 'check-in'].filter((action) => actions.has(action));
      if (recovery.length === 0) return null;
      return recovery[Math.floor(this._random() * recovery.length)];
    }
    return null;
  }

  _advanceSleepSequence(action) {
    if (this._posture !== 'lie' || this._sleepSequenceStage === null) return;
    if (this._sleepSequenceStage === 'head-rest' && action === 'head-rest') {
      this._sleepSequenceStage = 'sleep';
    } else if (this._sleepSequenceStage === 'sleep' && action === 'sleep') {
      this._sleepSequenceStage = 'recovery';
    } else if (this._sleepSequenceStage === 'recovery' && ['head-rest', 'check-in'].includes(action)) {
      this._sleepSequenceStage = null;
    }
  }

  _gestureDuration(action) {
    const duration = HOME_AUTONOMY_GESTURE_DURATIONS_MS[action];
    return Array.isArray(duration) ? this._intBetween(duration[0], duration[1]) : duration;
  }

  _intBetween(min, max) {
    return min + Math.floor(this._random() * (max - min + 1));
  }

  _random() {
    // Mulberry32 gives repeatable but seed-varying schedules for acceptance tests.
    this._randomState = (this._randomState + 0x6D2B79F5) >>> 0;
    let value = this._randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  _validRawTime(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  _advance(timeMs) {
    const raw = this._validRawTime(timeMs, this._lastRawTime);
    if (raw > this._lastRawTime) {
      const elapsed = Math.min(raw - this._lastRawTime, MAX_DELTA_PER_CALL_MS);
      this._now = Math.min(this._now + elapsed, MAX_LOGICAL_TIME_MS);
      this._lastRawTime = raw;
    }
    return this._now;
  }
}
