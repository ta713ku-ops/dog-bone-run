import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveStore, SAVE_STORE_LIMITS, collectLegacyRecords } from '../src/save-store.js';

class MemoryStorage {
  values = new Map();

  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const validRecord = (ruleVersion, highScore, maxCombo) => JSON.stringify({ ruleVersion, highScore, maxCombo });

test('legacy record collection is synchronous, read-only, and distinguishes play evidence from completion', () => {
  const storage = new MemoryStorage();
  const validKey = 'dog-bone-run:record:sprint30-hard-v1';
  const zeroKey = 'dog-bone-run:record:phase2-walk2-v1';
  storage.setItem(validKey, validRecord('sprint30-hard-v1', 80, 9));
  storage.setItem(zeroKey, validRecord('phase2-walk2-v1', 0, 0));
  storage.setItem('unrelated', 'leave me alone');

  const before = [...storage.values.entries()];
  const result = collectLegacyRecords(storage);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.records, [
    {
      sourceKey: validKey,
      ruleVersion: 'sprint30-hard-v1',
      highScore: 80,
      maxCombo: 9,
      legacyPlayEvidence: true,
    },
    {
      sourceKey: zeroKey,
      ruleVersion: 'phase2-walk2-v1',
      highScore: 0,
      maxCombo: 0,
      legacyPlayEvidence: false,
    },
  ]);
  assert.deepEqual([...storage.values.entries()], before);
});

test('legacy collection reports corrupt and mismatched records without discarding valid ones', () => {
  const storage = new MemoryStorage();
  storage.setItem('dog-bone-run:record:phase3-walk3-v1', validRecord('phase2-walk2-v1', 20, 4));
  storage.setItem('dog-bone-run:record:sprint30-hard-v1', '{ broken');
  storage.setItem('dog-bone-run:record:phase2-walk2-v1', validRecord('phase2-walk2-v1', 3, 1));

  const result = collectLegacyRecords(storage);
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].ruleVersion, 'phase2-walk2-v1');
  assert.deepEqual(result.errors.map(({ key, error }) => ({ key, error })), [
    { key: 'dog-bone-run:record:phase3-walk3-v1', error: 'corrupt_data' },
    { key: 'dog-bone-run:record:sprint30-hard-v1', error: 'corrupt_data' },
  ]);
});

test('legacy storage access failures are returned as errors', () => {
  assert.deepEqual(collectLegacyRecords(() => { throw new Error('denied'); }), {
    ok: false,
    records: [],
    errors: [],
    error: 'storage_unavailable',
  });
  assert.equal(collectLegacyRecords({ length: 0 }).error, 'storage_unavailable');
  assert.equal(collectLegacyRecords({
    get length() { throw new Error('denied'); },
    key() { return null; },
    getItem() { return null; },
  }).error, 'storage_unavailable');
});

test('unsupported IndexedDB stops open without silently replacing the injected state', async () => {
  const initialState = { schemaVersion: 2, revision: 0, saveGeneration: 'initial-v2', coins: 12 };
  const store = new SaveStore({ initialState, validate: state => ({ ok: state.schemaVersion === 2 }), indexedDB: null });

  const result = await store.open();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'indexeddb_unavailable');
  assert.equal(result.state, null);
  assert.equal(store.owner, false);
  assert.equal(store._db, null);
});

test('constructor requires the shared initial state and validator interface', () => {
  assert.throws(() => new SaveStore(), /initialState/);
  assert.throws(() => new SaveStore({ initialState: {}, validate: null }), /validate/);
});

test('public limits match the v5.1 save contract', () => {
  assert.deepEqual(SAVE_STORE_LIMITS, {
    maxSaveBytes: 131_072,
    maxImportBytes: 131_072,
    maxMetadataBytes: 524_288,
    heartbeatIntervalMs: 2_000,
    leaseTtlMs: 10_000,
  });
});
