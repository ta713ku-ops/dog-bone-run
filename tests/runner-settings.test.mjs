import test from 'node:test';
import assert from 'node:assert/strict';
import {RunnerSettingsStore, RUNNER_SETTINGS_DEFAULTS} from '../src/storage.js';

test('runner preferences persist independently and do not alter old game data', () => {
  const values = new Map([['dog-bone-run:record:sprint30-hard-v1', 'old-record'], ['raising', 'old-data']]);
  const storage = () => ({getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)});
  const preferences = {...RUNNER_SETTINGS_DEFAULTS, soundEnabled: false, musicVolume: .15, reducedMotion: true};
  assert.equal(new RunnerSettingsStore({storage}).save(preferences).ok, true);
  assert.deepEqual(new RunnerSettingsStore({storage}).read().settings, preferences);
  assert.equal(values.get('raising'), 'old-data');
  assert.equal(values.get('dog-bone-run:record:sprint30-hard-v1'), 'old-record');
});
test('corrupt or out-of-range preferences fall back safely without overwriting data', () => {
  for (const raw of ['{', JSON.stringify({version: 2, settings: RUNNER_SETTINGS_DEFAULTS}), JSON.stringify({version: 1, settings: {...RUNNER_SETTINGS_DEFAULTS, musicVolume: 100}})]) {
    const store = new RunnerSettingsStore({storage: () => ({getItem: () => raw, setItem: () => assert.fail('must not repair automatically')})});
    assert.equal(store.read().ok, false);
    assert.deepEqual(store.read().settings, RUNNER_SETTINGS_DEFAULTS);
  }
});
test('storage failure leaves current preferences usable and rejects invalid input', () => {
  const store = new RunnerSettingsStore({storage: () => {throw new Error('denied');}});
  assert.equal(store.read().ok, false);
  assert.equal(store.save({...RUNNER_SETTINGS_DEFAULTS, sfxVolume: NaN}).error, 'invalid_settings');
  assert.equal(store.save({...RUNNER_SETTINGS_DEFAULTS, soundEnabled: false}).error, 'write_failed');
  assert.equal(store.read().settings.soundEnabled, false);
});
