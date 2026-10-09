const RECORD_KEY_PREFIX = 'dog-bone-run:record:';
const EMPTY_RECORD = Object.freeze({ highScore: 0, maxCombo: 0 });

export const RUNNER_SETTINGS_DEFAULTS = Object.freeze({
  soundEnabled: true, musicEnabled: true, musicVolume: .35, sfxVolume: .8, reducedMotion: false,
});
const RUNNER_SETTINGS_KEY = 'dog-bone-run:settings:v1';
function validSettings(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && ['soundEnabled', 'musicEnabled', 'reducedMotion'].every(key => typeof value[key] === 'boolean')
    && ['musicVolume', 'sfxVolume'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}
function settingsCopy(value) {
  return Object.fromEntries(Object.keys(RUNNER_SETTINGS_DEFAULTS).map(key => [key, value[key]]));
}

/** Independent runner preferences. Never opens or deletes the old raising DB. */
export class RunnerSettingsStore {
  constructor({storage = () => globalThis.localStorage} = {}) {
    this.storage = storage; this.current = {...RUNNER_SETTINGS_DEFAULTS};
  }
  read() {
    try {
      const raw = this.storage().getItem(RUNNER_SETTINGS_KEY);
      if (raw !== null) {
        const value = JSON.parse(raw);
        if (value.version !== 1 || !validSettings(value.settings)) throw new Error('invalid_settings');
        this.current = settingsCopy(value.settings);
      }
      return {ok: true, settings: {...this.current}};
    } catch { return {ok: false, settings: {...this.current}}; }
  }
  save(settings) {
    if (!validSettings(settings)) return {ok: false, error: 'invalid_settings'};
    this.current = settingsCopy(settings);
    try {
      this.storage().setItem(RUNNER_SETTINGS_KEY, JSON.stringify({version: 1, settings: this.current}));
      return {ok: true};
    } catch { return {ok: false, error: 'write_failed'}; }
  }
}

function copyRecord(record) {
  return { highScore: record.highScore, maxCombo: record.maxCombo };
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value, ruleVersion) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value.ruleVersion === undefined || value.ruleVersion === ruleVersion)
    && isNonnegativeInteger(value.highScore)
    && isNonnegativeInteger(value.maxCombo);
}

export class RecordStore {
  constructor({ storage = () => globalThis.localStorage, ruleVersion } = {}) {
    if (typeof storage !== 'function') {
      throw new TypeError('storage must be a function');
    }
    if (ruleVersion === undefined || ruleVersion === null || String(ruleVersion).trim() === '') {
      throw new TypeError('ruleVersion is required');
    }

    this.storage = storage;
    this.ruleVersion = String(ruleVersion);
    this.key = `${RECORD_KEY_PREFIX}${encodeURIComponent(this.ruleVersion)}`;
    this.lastRecord = copyRecord(EMPTY_RECORD);
  }

  read() {
    let storage;
    try {
      storage = this.storage();
    } catch {
      return { ok: false, record: copyRecord(this.lastRecord), error: 'storage_unavailable' };
    }

    const loaded = this.readFrom(storage);
    if (loaded.ok) return { ok: true, record: copyRecord(loaded.record) };
    return { ok: false, record: copyRecord(loaded.record), error: loaded.error };
  }

  save({ completed, score, maxCombo } = {}) {
    if (typeof completed !== 'boolean' || !isNonnegativeInteger(score) || !isNonnegativeInteger(maxCombo)) {
      return { ok: false, record: copyRecord(this.lastRecord), error: 'invalid_input' };
    }

    let storage;
    try {
      storage = this.storage();
    } catch {
      return { ok: false, record: copyRecord(this.lastRecord), error: 'storage_unavailable' };
    }

    const loaded = this.readFrom(storage);
    if (!loaded.ok && loaded.error !== 'corrupt_data') {
      return { ok: false, record: copyRecord(loaded.record), error: loaded.error };
    }

    const previous = loaded.record;
    const highScore = completed ? Math.max(previous.highScore, score) : previous.highScore;
    const next = {
      highScore,
      maxCombo: Math.max(previous.maxCombo, maxCombo),
    };
    const highScoreUpdated = highScore > previous.highScore;
    const maxComboUpdated = next.maxCombo > previous.maxCombo;

    // A corrupt value must be repaired even when the incoming run adds no record.
    if (!loaded.corrupt && !highScoreUpdated && !maxComboUpdated) {
      return {
        ok: true,
        record: copyRecord(previous),
        highScoreUpdated: false,
        maxComboUpdated: false,
      };
    }

    try {
      storage.setItem(this.key, JSON.stringify({ ruleVersion: this.ruleVersion, ...next }));
    } catch {
      return { ok: false, record: copyRecord(previous), error: 'write_failed' };
    }

    this.lastRecord = copyRecord(next);
    return {
      ok: true,
      record: copyRecord(next),
      highScoreUpdated,
      maxComboUpdated,
    };
  }

  readFrom(storage) {
    let raw;
    try {
      if (storage === null || storage === undefined || typeof storage.getItem !== 'function') {
        return { ok: false, record: copyRecord(this.lastRecord), error: 'storage_unavailable' };
      }
      raw = storage.getItem(this.key);
    } catch {
      return { ok: false, record: copyRecord(this.lastRecord), error: 'read_failed' };
    }

    if (raw === null) {
      const record = copyRecord(EMPTY_RECORD);
      this.lastRecord = record;
      return { ok: true, record: copyRecord(record), corrupt: false };
    }

    let parsed;
    try {
      if (typeof raw !== 'string') throw new TypeError('stored record must be text');
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, record: copyRecord(this.lastRecord), error: 'corrupt_data', corrupt: true };
    }

    if (!isRecord(parsed, this.ruleVersion)) {
      return { ok: false, record: copyRecord(this.lastRecord), error: 'corrupt_data', corrupt: true };
    }

    const record = { highScore: parsed.highScore, maxCombo: parsed.maxCombo };
    this.lastRecord = copyRecord(record);
    return { ok: true, record: copyRecord(record), corrupt: false };
  }
}
