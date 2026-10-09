import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordStore } from '../src/storage.js';

class MemoryStorage {
  values = new Map();
  writes = 0;

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.writes++;
    this.values.set(key, String(value));
  }
}

test('read starts at zero and rule versions use separate durable keys', () => {
  const storage = new MemoryStorage();
  const phase1 = new RecordStore({ storage: () => storage, ruleVersion: 'phase1-v2.1' });
  const phase2 = new RecordStore({ storage: () => storage, ruleVersion: 'phase2-v1' });

  assert.deepEqual(phase1.read(), { ok: true, record: { highScore: 0, maxCombo: 0 } });
  assert.deepEqual(phase2.read(), { ok: true, record: { highScore: 0, maxCombo: 0 } });
  assert.notEqual(phase1.key, phase2.key);

  assert.equal(phase1.save({ completed: true, score: 50, maxCombo: 8 }).ok, true);
  assert.deepEqual(phase1.read().record, { highScore: 50, maxCombo: 8 });
  assert.deepEqual(phase2.read().record, { highScore: 0, maxCombo: 0 });
});

test('only completed runs update high score, while max combo can update on any ending', () => {
  const storage = new MemoryStorage();
  const store = new RecordStore({ storage: () => storage, ruleVersion: 'phase2-v1' });

  const incomplete = store.save({ completed: false, score: 900, maxCombo: 12 });
  assert.deepEqual(incomplete, {
    ok: true,
    record: { highScore: 0, maxCombo: 12 },
    highScoreUpdated: false,
    maxComboUpdated: true,
  });

  const completed = store.save({ completed: true, score: 120, maxCombo: 9 });
  assert.deepEqual(completed, {
    ok: true,
    record: { highScore: 120, maxCombo: 12 },
    highScoreUpdated: true,
    maxComboUpdated: false,
  });

  const futureGameOver = store.save({ completed: false, score: 500, maxCombo: 20 });
  assert.deepEqual(futureGameOver, {
    ok: true,
    record: { highScore: 120, maxCombo: 20 },
    highScoreUpdated: false,
    maxComboUpdated: true,
  });
  assert.deepEqual(JSON.parse(storage.getItem(store.key)), {
    ruleVersion: 'phase2-v1', highScore: 120, maxCombo: 20,
  });
});

test('unchanged records are reported durable without unnecessary writes', () => {
  const storage = new MemoryStorage();
  const store = new RecordStore({ storage: () => storage, ruleVersion: 'phase2-v1' });
  store.save({ completed: true, score: 40, maxCombo: 6 });
  const writes = storage.writes;

  assert.deepEqual(store.save({ completed: true, score: 30, maxCombo: 6 }), {
    ok: true,
    record: { highScore: 40, maxCombo: 6 },
    highScoreUpdated: false,
    maxComboUpdated: false,
  });
  assert.equal(storage.writes, writes);
});

test('a malformed stored value is reported and repaired by the next valid save', () => {
  const storage = new MemoryStorage();
  const store = new RecordStore({ storage: () => storage, ruleVersion: 'phase2-v1' });
  storage.values.set(store.key, '{ broken json');

  assert.deepEqual(store.read(), {
    ok: false, record: { highScore: 0, maxCombo: 0 }, error: 'corrupt_data',
  });
  assert.deepEqual(store.save({ completed: true, score: 10, maxCombo: 3 }), {
    ok: true,
    record: { highScore: 10, maxCombo: 3 },
    highScoreUpdated: true,
    maxComboUpdated: true,
  });
  assert.deepEqual(store.read(), { ok: true, record: { highScore: 10, maxCombo: 3 } });
});

test('invalid record fields and mismatched payload versions are rejected as corrupt', () => {
  const storage = new MemoryStorage();
  const store = new RecordStore({ storage: () => storage, ruleVersion: 'phase2-v1' });

  for (const raw of [
    'null',
    JSON.stringify({ highScore: -1, maxCombo: 2 }),
    JSON.stringify({ highScore: 1.5, maxCombo: 2 }),
    JSON.stringify({ highScore: Number.MAX_SAFE_INTEGER + 1, maxCombo: 2 }),
    JSON.stringify({ ruleVersion: 'phase1-v2.1', highScore: 100, maxCombo: 50 }),
  ]) {
    storage.values.set(store.key, raw);
    assert.equal(store.read().error, 'corrupt_data');
  }
});

test('storage getter and read errors are caught and never reported as saves', () => {
  const unavailable = new RecordStore({ storage: () => { throw new Error('denied'); }, ruleVersion: 'phase2-v1' });
  assert.deepEqual(unavailable.read(), {
    ok: false, record: { highScore: 0, maxCombo: 0 }, error: 'storage_unavailable',
  });
  const getterFailure = unavailable.save({ completed: true, score: 10, maxCombo: 2 });
  assert.equal(getterFailure.ok, false);
  assert.equal(getterFailure.error, 'storage_unavailable');
  assert.equal('highScoreUpdated' in getterFailure, false);

  const readFailure = new RecordStore({
    storage: () => ({ getItem() { throw new Error('denied'); }, setItem() { assert.fail('must not write'); } }),
    ruleVersion: 'phase2-v1',
  });
  assert.equal(readFailure.read().error, 'read_failed');
  const saveFailure = readFailure.save({ completed: true, score: 10, maxCombo: 2 });
  assert.equal(saveFailure.ok, false);
  assert.equal(saveFailure.error, 'read_failed');
  assert.equal('maxComboUpdated' in saveFailure, false);
});

test('write failure returns the last durable record without success flags', () => {
  const storage = new MemoryStorage();
  const store = new RecordStore({ storage: () => storage, ruleVersion: 'phase2-v1' });
  store.save({ completed: true, score: 100, maxCombo: 10 });
  const originalSetItem = storage.setItem;
  storage.setItem = () => { throw new Error('quota'); };

  const result = store.save({ completed: true, score: 200, maxCombo: 20 });
  assert.deepEqual(result, {
    ok: false,
    record: { highScore: 100, maxCombo: 10 },
    error: 'write_failed',
  });
  assert.deepEqual(JSON.parse(storage.getItem(store.key)), {
    ruleVersion: 'phase2-v1', highScore: 100, maxCombo: 10,
  });
  storage.setItem = originalSetItem;
});

test('save rejects non-boolean completion and non-finite or fractional counters', () => {
  const store = new RecordStore({ storage: () => new MemoryStorage(), ruleVersion: 'phase2-v1' });

  for (const run of [
    { completed: 1, score: 1, maxCombo: 1 },
    { completed: true, score: -1, maxCombo: 1 },
    { completed: true, score: 1.2, maxCombo: 1 },
    { completed: false, score: 1, maxCombo: Infinity },
    { completed: false, score: NaN, maxCombo: 1 },
  ]) {
    const result = store.save(run);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_input');
    assert.equal('highScoreUpdated' in result, false);
  }
});
