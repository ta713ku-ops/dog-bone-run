const DATABASE_NAME = 'dog-bone-run-save-v2';
const DATABASE_VERSION = 1;
const RECORDS_STORE = 'records';
const BACKUPS_STORE = 'backups';
const SAVE_KEY = 'save';
const LEASE_KEY = 'lease';
const LEGACY_RECORD_PREFIX = 'dog-bone-run:record:';
const MAX_SAVE_BYTES = 128 * 1024;
const MAX_IMPORT_BYTES = 128 * 1024;
const MAX_METADATA_BYTES = 512 * 1024;
const HEARTBEAT_INTERVAL_MS = 2_000;
const LEASE_TTL_MS = 10_000;

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonBytes(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new TypeError('invalid_json_value');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return unescape(encodeURIComponent(text)).length;
}

function inspectJSON(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > 64 || ++budget.nodes > 50_000) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (value.length > 20_000) return false;
    return value.every(item => inspectJSON(item, depth + 1, budget));
  }
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  if (keys.length > 20_000) return false;
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return false;
    if (!inspectJSON(value[key], depth + 1, budget)) return false;
  }
  return true;
}

function validateResult(validate, value) {
  try {
    const result = validate(value);
    if (typeof result === 'boolean') return { ok: result, error: result ? undefined : 'invalid_state' };
    if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
      return { ok: result.ok, error: result.error };
    }
  } catch {
    return { ok: false, error: 'invalid_state' };
  }
  return { ok: false, error: 'invalid_state' };
}

function isSaveState(value, validate) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !inspectJSON(value)) {
    return { ok: false, error: 'invalid_state' };
  }
  const checked = validateResult(validate, value);
  if (!checked.ok) return { ok: false, error: checked.error || 'invalid_state' };
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    return { ok: false, error: 'invalid_state' };
  }
  if (typeof value.saveGeneration !== 'string' || value.saveGeneration.length === 0 || value.saveGeneration.length > 128) {
    return { ok: false, error: 'invalid_state' };
  }
  try {
    if (jsonBytes(value) > MAX_SAVE_BYTES) return { ok: false, error: 'size_limit' };
  } catch {
    return { ok: false, error: 'invalid_state' };
  }
  return { ok: true };
}

function hasPreservedValues(original, migrated) {
  if (Array.isArray(original)) {
    return Array.isArray(migrated)
      && migrated.length === original.length
      && original.every((value, index) => hasPreservedValues(value, migrated[index]));
  }
  if (original && typeof original === 'object') {
    if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return false;
    return Object.keys(original).every(key => Object.prototype.hasOwnProperty.call(migrated, key)
      && hasPreservedValues(original[key], migrated[key]));
  }
  return Object.is(original, migrated);
}

function emptyLease() {
  return { ownerTabId: null, token: null, epoch: 0, expiresAt: 0 };
}

function isLease(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value.ownerTabId === null || typeof value.ownerTabId === 'string')
    && (value.token === null || typeof value.token === 'string')
    && Number.isSafeInteger(value.epoch)
    && value.epoch >= 0
    && Number.isFinite(value.expiresAt)
    && value.expiresAt >= 0;
}

function publicLease(lease, now) {
  if (!isLease(lease)) return null;
  return {
    ownerTabId: lease.ownerTabId,
    epoch: lease.epoch,
    expiresAt: lease.expiresAt,
    active: lease.token !== null && lease.expiresAt > now,
  };
}

function identifier() {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject) return null;
  try {
    if (typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID();
    if (typeof cryptoObject.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoObject.getRandomValues(bytes);
      return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    return null;
  }
  return null;
}

function errorCode(error, fallback = 'transaction_aborted') {
  const name = error && typeof error === 'object' ? error.name : '';
  if (name === 'QuotaExceededError') return 'quota_exceeded';
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError') {
    return 'indexeddb_unavailable';
  }
  return fallback;
}

function legacyStorage(storageOrGetter) {
  if (typeof storageOrGetter === 'function') return storageOrGetter();
  if (storageOrGetter !== undefined) return storageOrGetter;
  return globalThis.localStorage;
}

/**
 * Read the previous per-rule records without changing or deleting any legacy key.
 * Invalid and unknown entries are returned in `errors` so migration can remain explicit.
 */
export function collectLegacyRecords(storageOrGetter) {
  let storage;
  try {
    storage = legacyStorage(storageOrGetter);
    if (!storage || !Number.isSafeInteger(storage.length)
      || typeof storage.key !== 'function' || typeof storage.getItem !== 'function') {
      return { ok: false, records: [], errors: [], error: 'storage_unavailable' };
    }
  } catch {
    return { ok: false, records: [], errors: [], error: 'storage_unavailable' };
  }

  const records = [];
  const errors = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (typeof key !== 'string' || !key.startsWith(LEGACY_RECORD_PREFIX)) continue;
      const encodedVersion = key.slice(LEGACY_RECORD_PREFIX.length);
      let ruleVersion;
      try {
        ruleVersion = decodeURIComponent(encodedVersion);
      } catch {
        errors.push({ key, error: 'invalid_rule_version' });
        continue;
      }
      const raw = storage.getItem(key);
      let parsed;
      try {
        if (typeof raw !== 'string') throw new TypeError('record_missing');
        parsed = JSON.parse(raw);
      } catch {
        errors.push({ key, ruleVersion, error: 'corrupt_data' });
        continue;
      }
      const valid = parsed !== null
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && (parsed.ruleVersion === undefined || parsed.ruleVersion === ruleVersion)
        && Number.isSafeInteger(parsed.highScore)
        && parsed.highScore >= 0
        && Number.isSafeInteger(parsed.maxCombo)
        && parsed.maxCombo >= 0;
      if (!valid) {
        errors.push({ key, ruleVersion, error: 'corrupt_data' });
        continue;
      }
      records.push({
        sourceKey: key,
        ruleVersion,
        highScore: parsed.highScore,
        maxCombo: parsed.maxCombo,
        legacyPlayEvidence: parsed.highScore > 0,
      });
    }
  } catch {
    return { ok: false, records, errors, error: 'read_failed' };
  }
  return { ok: true, records, errors };
}

export class SaveStore {
  constructor({
    initialState,
    validate,
    migrateCandidate = null,
    indexedDB: indexedDBOverride,
    databaseName = DATABASE_NAME,
    now = () => Date.now(),
  } = {}) {
    if (!initialState || typeof initialState !== 'object' || Array.isArray(initialState)) {
      throw new TypeError('initialState must be an object');
    }
    if (typeof validate !== 'function') throw new TypeError('validate must be a function');
    if (migrateCandidate !== null && typeof migrateCandidate !== 'function') {
      throw new TypeError('migrateCandidate must be a function or null');
    }
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.initialState = cloneJSON(initialState);
    this.validate = validate;
    this.migrateCandidate = migrateCandidate;
    this.indexedDB = indexedDBOverride === undefined ? globalThis.indexedDB : indexedDBOverride;
    this.databaseName = databaseName;
    this.now = now;
    this.tabId = identifier();
    this.token = null;
    this.epoch = null;
    this._expiresAt = 0;
    this._db = null;
    this._lastState = null;
    this._closed = false;
    this.onchange = null;
    this._channel = null;

    if (typeof globalThis.BroadcastChannel === 'function' && typeof globalThis.window !== 'undefined') {
      try {
        this._channel = new BroadcastChannel(`${databaseName}:changes`);
        this._channel.addEventListener('message', event => {
          if (event.data?.type === 'save-updated' && typeof this.onchange === 'function') {
            this.onchange(event.data);
          }
        });
      } catch {
        this._channel = null;
      }
    }
  }

  get owner() {
    return this.token !== null && this.epoch !== null && this._expiresAt > this.now();
  }

  get ownerInfo() {
    return this.owner ? { tabId: this.tabId, token: this.token, epoch: this.epoch } : null;
  }

  async open() {
    if (this._closed) this._closed = false;
    if (this._db) {
      const latest = await this.read();
      return latest;
    }
    const indexedDB = this.indexedDB;
    if (!indexedDB || typeof indexedDB.open !== 'function') {
      return this._result(false, null, 'indexeddb_unavailable');
    }
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        let request;
        let requestSettled = false;
        try {
          request = indexedDB.open(this.databaseName, DATABASE_VERSION);
        } catch (error) {
          reject({ code: errorCode(error, 'indexeddb_unavailable') });
          return;
        }
        request.onupgradeneeded = () => {
          const upgraded = request.result;
          if (!upgraded.objectStoreNames.contains(RECORDS_STORE)) upgraded.createObjectStore(RECORDS_STORE);
          if (!upgraded.objectStoreNames.contains(BACKUPS_STORE)) upgraded.createObjectStore(BACKUPS_STORE);
        };
        request.onerror = () => {
          requestSettled = true;
          reject({ code: errorCode(request.error, 'indexeddb_unavailable') });
        };
        request.onblocked = () => {
          requestSettled = true;
          reject({ code: 'database_blocked' });
        };
        request.onsuccess = () => {
          if (requestSettled || this._closed) {
            request.result.close();
            if (!requestSettled) reject({ code: 'store_closed' });
            return;
          }
          requestSettled = true;
          resolve(request.result);
        };
      });
    } catch (error) {
      return this._result(false, null, error.code || 'indexeddb_unavailable');
    }
    this._db = db;
    db.onversionchange = () => {
      db.close();
      if (this._db === db) this._db = null;
      this._clearOwner();
    };

    const outcome = await this._runTransaction([RECORDS_STORE, BACKUPS_STORE], 'readwrite', (tx, setOutput, setFailure) => {
      const records = tx.objectStore(RECORDS_STORE);
      const saveRequest = records.get(SAVE_KEY);
      const leaseRequest = records.get(LEASE_KEY);
      let saveReady = false;
      let leaseReady = false;
      let saveValue;
      let leaseValue;
      const finish = () => {
        if (!saveReady || !leaseReady) return;
        if (saveValue === undefined) {
          const initial = cloneJSON(this.initialState);
          if (!Number.isSafeInteger(initial.revision) || initial.revision < 0) initial.revision = 0;
          const generation = identifier();
          if (!generation) {
            setOutput({ ok: false, state: null, error: 'crypto_unavailable' });
            return;
          }
          initial.saveGeneration = generation;
          const validity = isSaveState(initial, this.validate);
          if (!validity.ok) {
            setOutput({ ok: false, state: null, error: validity.error });
            return;
          }
          records.put(initial, SAVE_KEY);
          saveValue = initial;
        } else {
          const validity = isSaveState(saveValue, this.validate);
          if (!validity.ok) {
            const candidateEnvelope = saveValue !== null
              && typeof saveValue === 'object'
              && !Array.isArray(saveValue)
              && inspectJSON(saveValue)
              && Number.isSafeInteger(saveValue.revision)
              && saveValue.revision >= 0
              && typeof saveValue.saveGeneration === 'string'
              && saveValue.saveGeneration.length > 0
              && saveValue.saveGeneration.length <= 128;
            if (!this.migrateCandidate || !candidateEnvelope
              || saveValue.revision >= Number.MAX_SAFE_INTEGER) {
              setOutput({ ok: false, state: null, error: validity.error === 'size_limit' ? 'size_limit' : 'corrupt_data' });
              return;
            }

            let migration;
            try {
              migration = this.migrateCandidate(cloneJSON(saveValue));
            } catch (error) {
              const code = error && typeof error.code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(error.code)
                ? error.code
                : 'corrupt_data';
              setOutput({ ok: false, state: null, error: code });
              return;
            }
            if (migration && typeof migration.then === 'function') {
              if (typeof migration.catch === 'function') migration.catch(() => {});
              setOutput({ ok: false, state: null, error: 'async_migration_not_allowed' });
              return;
            }
            if (!migration || migration.ok !== true || migration.migrated !== true
              || !migration.save || typeof migration.save !== 'object' || Array.isArray(migration.save)) {
              const code = migration?.error && typeof migration.error === 'string'
                && /^[a-z][a-z0-9_-]{0,63}$/.test(migration.error)
                ? migration.error
                : 'corrupt_data';
              setOutput({ ok: false, state: null, error: code });
              return;
            }
            let migrated;
            try {
              migrated = cloneJSON(migration.save);
            } catch {
              setOutput({ ok: false, state: null, error: 'corrupt_data' });
              return;
            }
            if (migrated.saveGeneration !== saveValue.saveGeneration
              || !hasPreservedValues(saveValue, migrated)) {
              setOutput({ ok: false, state: null, error: 'corrupt_data' });
              return;
            }
            migrated.revision = saveValue.revision + 1;
            const migratedValidity = isSaveState(migrated, this.validate);
            if (!migratedValidity.ok) {
              setOutput({ ok: false, state: null, error: migratedValidity.error || 'corrupt_data' });
              return;
            }
            const normalizedLease = leaseValue === undefined ? emptyLease() : leaseValue;
            if (!isLease(normalizedLease)) {
              setOutput({ ok: false, state: null, error: 'corrupt_lease' });
              return;
            }
            this._writeStateWithBackup(tx, saveValue, migrated, normalizedLease, 'candidate-migration', error => {
              if (error) {
                setOutput({ ok: false, state: null, error });
                return;
              }
              saveValue = migrated;
              leaseValue = normalizedLease;
              setOutput({ ok: true, state: migrated, lease: normalizedLease, migrated: true });
            });
            return;
          }
        }
        if (leaseValue === undefined) {
          leaseValue = emptyLease();
          records.put(leaseValue, LEASE_KEY);
        } else if (!isLease(leaseValue)) {
          setOutput({ ok: false, state: saveValue, error: 'corrupt_lease' });
          return;
        }
        setOutput({ ok: true, state: saveValue, lease: leaseValue });
      };
      saveRequest.onsuccess = () => { saveValue = saveRequest.result; saveReady = true; finish(); };
      leaseRequest.onsuccess = () => { leaseValue = leaseRequest.result; leaseReady = true; finish(); };
      saveRequest.onerror = () => setFailure(errorCode(saveRequest.error));
      leaseRequest.onerror = () => setFailure(errorCode(leaseRequest.error));
    });
    if (outcome.ok) this._lastState = cloneJSON(outcome.state);
    return this._withOwnership(outcome);
  }

  async acquire({ takeover = false, expectedEpoch } = {}) {
    if (!this._db) {
      const opened = await this.open();
      if (!opened.ok) return opened;
    }
    if (!this.tabId) return this._result(false, this._lastState, 'crypto_unavailable');
    const nextToken = identifier();
    if (!nextToken) return this._result(false, this._lastState, 'crypto_unavailable');
    let stagedLease = null;
    const outcome = await this._runTransaction([RECORDS_STORE, BACKUPS_STORE], 'readwrite', (tx, setOutput, setFailure) => {
      const records = tx.objectStore(RECORDS_STORE);
      const saveRequest = records.get(SAVE_KEY);
      const leaseRequest = records.get(LEASE_KEY);
      let saveReady = false;
      let leaseReady = false;
      let state;
      let lease;
      const finish = () => {
        if (!saveReady || !leaseReady) return;
        if (!state) { setOutput({ ok: false, state: null, error: 'missing_save' }); return; }
        const stateValidity = isSaveState(state, this.validate);
        if (!stateValidity.ok) { setOutput({ ok: false, state: null, error: 'corrupt_data' }); return; }
        if (lease === undefined) lease = emptyLease();
        if (!isLease(lease)) { setOutput({ ok: false, state, error: 'corrupt_lease' }); return; }

        const now = this.now();
        const active = lease.token !== null && lease.expiresAt > now;
        const sameActiveOwner = active
          && lease.ownerTabId === this.tabId
          && lease.token === this.token
          && lease.epoch === this.epoch;
        if (sameActiveOwner) {
          const renewed = { ...lease, expiresAt: now + LEASE_TTL_MS };
          records.put(renewed, LEASE_KEY);
          stagedLease = renewed;
          setOutput({ ok: true, state, lease: renewed });
          return;
        }

        if (active && !takeover) {
          this._clearOwner();
          setOutput({ ok: true, state, owner: false, lease });
          return;
        }
        if (active && takeover && !Number.isSafeInteger(expectedEpoch)) {
          setOutput({ ok: false, state, error: 'expected_epoch_required', lease });
          return;
        }
        if (expectedEpoch !== undefined && expectedEpoch !== lease.epoch) {
          setOutput({ ok: false, state, error: 'stale_epoch', lease });
          return;
        }
        if (!Number.isSafeInteger(lease.epoch + 1)) {
          setOutput({ ok: false, state, error: 'epoch_exhausted', lease });
          return;
        }

        const sameDocumentResume = this.token !== null
          && lease.ownerTabId === this.tabId
          && lease.token === this.token
          && lease.epoch === this.epoch;
        const nextState = cloneJSON(state);
        let changed = false;
        for (const field of ['activeRun', 'activeAction']) {
          const activeItem = nextState[field];
          if (!activeItem) continue;
          if (sameDocumentResume
            && activeItem.ownerTabId === this.tabId
            && activeItem.ownerEpoch === lease.epoch) {
            activeItem.ownerEpoch = lease.epoch + 1;
          } else {
            nextState[field] = null;
          }
          changed = true;
        }
        const nextLease = {
          ownerTabId: this.tabId,
          token: nextToken,
          epoch: lease.epoch + 1,
          expiresAt: now + LEASE_TTL_MS,
        };
        stagedLease = nextLease;
        if (changed) {
          nextState.revision = state.revision + 1;
          const validity = isSaveState(nextState, this.validate);
          if (!validity.ok) { stagedLease = null; setOutput({ ok: false, state, error: validity.error }); return; }
          this._writeStateWithBackup(tx, state, nextState, nextLease, 'ownership-change', (error) => {
            if (error) { stagedLease = null; setOutput({ ok: false, state, error }); return; }
            setOutput({ ok: true, state: nextState, lease: nextLease });
          });
        } else {
          records.put(nextLease, LEASE_KEY);
          setOutput({ ok: true, state, lease: nextLease });
        }
      };
      saveRequest.onsuccess = () => { state = saveRequest.result; saveReady = true; finish(); };
      leaseRequest.onsuccess = () => { lease = leaseRequest.result; leaseReady = true; finish(); };
      saveRequest.onerror = () => setFailure(errorCode(saveRequest.error));
      leaseRequest.onerror = () => setFailure(errorCode(leaseRequest.error));
    });
    if (outcome.ok && stagedLease) {
      this._adoptLease(stagedLease);
      if (outcome.state) this._lastState = cloneJSON(outcome.state);
      this._broadcast(outcome.state?.revision);
    } else if (outcome.error === 'lease_lost' || outcome.error === 'stale_epoch') {
      this._clearOwner();
    }
    return this._withOwnership(outcome);
  }

  async read() {
    if (!this._db) {
      const opened = await this.open();
      if (!opened.ok) return opened;
    }
    const outcome = await this._runTransaction([RECORDS_STORE], 'readonly', (tx, setOutput, setFailure) => {
      const records = tx.objectStore(RECORDS_STORE);
      const saveRequest = records.get(SAVE_KEY);
      const leaseRequest = records.get(LEASE_KEY);
      let saveReady = false;
      let leaseReady = false;
      let state;
      let lease;
      const finish = () => {
        if (!saveReady || !leaseReady) return;
        if (!state) { setOutput({ ok: false, state: null, error: 'missing_save' }); return; }
        const validity = isSaveState(state, this.validate);
        if (!validity.ok) { setOutput({ ok: false, state: null, error: 'corrupt_data' }); return; }
        if (lease === undefined) lease = emptyLease();
        if (!isLease(lease)) { setOutput({ ok: false, state, error: 'corrupt_lease' }); return; }
        setOutput({ ok: true, state, lease });
      };
      saveRequest.onsuccess = () => { state = saveRequest.result; saveReady = true; finish(); };
      leaseRequest.onsuccess = () => { lease = leaseRequest.result; leaseReady = true; finish(); };
      saveRequest.onerror = () => setFailure(errorCode(saveRequest.error));
      leaseRequest.onerror = () => setFailure(errorCode(leaseRequest.error));
    });
    if (outcome.ok) {
      this._lastState = cloneJSON(outcome.state);
      const lease = outcome.lease;
      if (lease.token !== null
        && lease.ownerTabId === this.tabId
        && lease.token === this.token
        && lease.epoch === this.epoch) {
        this._expiresAt = lease.expiresAt;
      } else {
        this._clearOwner();
      }
    }
    return this._withOwnership(outcome);
  }

  async transact(transform, { expectedRevision } = {}) {
    if (typeof transform !== 'function') return this._result(false, this._lastState, 'invalid_transform');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return this._result(false, this._lastState, 'expected_revision_required');
    }
    if (!this._db) {
      const opened = await this.open();
      if (!opened.ok) return opened;
    }
    let stagedLease = null;
    let didWrite = false;
    const outcome = await this._runTransaction([RECORDS_STORE, BACKUPS_STORE], 'readwrite', (tx, setOutput, setFailure) => {
      const records = tx.objectStore(RECORDS_STORE);
      const saveRequest = records.get(SAVE_KEY);
      const leaseRequest = records.get(LEASE_KEY);
      let saveReady = false;
      let leaseReady = false;
      let state;
      let lease;
      const finish = () => {
        if (!saveReady || !leaseReady) return;
        if (!state) { setOutput({ ok: false, state: null, error: 'missing_save' }); return; }
        const validity = isSaveState(state, this.validate);
        if (!validity.ok) { setOutput({ ok: false, state: null, error: 'corrupt_data' }); return; }
        if (!isLease(lease)) { setOutput({ ok: false, state, error: 'corrupt_lease' }); return; }
        const now = this.now();
        if (!this._leaseMatches(lease, now)) {
          setOutput({ ok: false, state, error: 'lease_lost', lease });
          return;
        }
        if (expectedRevision !== undefined
          && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision)) {
          setOutput({ ok: false, state, error: 'revision_conflict', lease });
          return;
        }
        let transformed;
        try {
          transformed = transform(cloneJSON(state));
        } catch (error) {
          const code = error && typeof error.code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(error.code)
            ? error.code
            : 'transform_failed';
          setOutput({ ok: false, state, error: code, lease });
          return;
        }
        if (!transformed || typeof transformed !== 'object' || Array.isArray(transformed)
          || !Object.prototype.hasOwnProperty.call(transformed, 'state')) {
          setOutput({ ok: false, state, error: 'invalid_transform', lease });
          return;
        }
        if (transformed.state && typeof transformed.state.then === 'function') {
          setOutput({ ok: false, state, error: 'async_transform_not_allowed', lease });
          return;
        }
        let next;
        try {
          next = cloneJSON(transformed.state);
        } catch {
          setOutput({ ok: false, state, error: 'invalid_state', lease });
          return;
        }
        next.revision = state.revision;
        try {
          if (JSON.stringify(next) === JSON.stringify(state)) {
            const renewed = { ...lease, expiresAt: now + LEASE_TTL_MS };
            records.put(renewed, LEASE_KEY);
            stagedLease = renewed;
            setOutput({ ok: true, state, result: transformed.result, lease: renewed });
            return;
          }
        } catch {
          setOutput({ ok: false, state, error: 'invalid_state', lease });
          return;
        }
        if (state.revision >= Number.MAX_SAFE_INTEGER) {
          setOutput({ ok: false, state, error: 'revision_exhausted', lease });
          return;
        }
        next.revision = state.revision + 1;
        const nextValidity = isSaveState(next, this.validate);
        if (!nextValidity.ok) {
          setOutput({ ok: false, state, error: nextValidity.error, lease });
          return;
        }
        const renewed = { ...lease, expiresAt: now + LEASE_TTL_MS };
        stagedLease = renewed;
        didWrite = true;
        this._writeStateWithBackup(tx, state, next, renewed, 'save', (error) => {
          if (error) { stagedLease = null; didWrite = false; setOutput({ ok: false, state, error, lease }); return; }
          setOutput({ ok: true, state: next, result: transformed.result, lease: renewed });
        });
      };
      saveRequest.onsuccess = () => { state = saveRequest.result; saveReady = true; finish(); };
      leaseRequest.onsuccess = () => { lease = leaseRequest.result; leaseReady = true; finish(); };
      saveRequest.onerror = () => setFailure(errorCode(saveRequest.error));
      leaseRequest.onerror = () => setFailure(errorCode(leaseRequest.error));
    });
    if (outcome.ok && stagedLease) this._adoptLease(stagedLease);
    if (outcome.ok) {
      this._lastState = cloneJSON(outcome.state);
      if (didWrite) this._broadcast(outcome.state.revision);
    } else if (outcome.error === 'lease_lost' || outcome.error === 'revision_conflict') {
      if (outcome.state) this._lastState = cloneJSON(outcome.state);
      if (outcome.error === 'lease_lost') this._preserveOrClearOwner(outcome.lease);
    }
    return this._withOwnership(outcome);
  }

  async heartbeat() {
    if (!this._db) return this._result(false, this._lastState, 'indexeddb_unavailable');
    const outcome = await this._runTransaction([RECORDS_STORE], 'readwrite', (tx, setOutput, setFailure) => {
      const records = tx.objectStore(RECORDS_STORE);
      const request = records.get(LEASE_KEY);
      request.onsuccess = () => {
        const lease = request.result;
        const now = this.now();
        if (!isLease(lease) || !this._leaseMatches(lease, now)) {
          setOutput({ ok: false, state: this._lastState, error: 'lease_lost', lease: isLease(lease) ? lease : undefined });
          return;
        }
        const renewed = { ...lease, expiresAt: now + LEASE_TTL_MS };
        records.put(renewed, LEASE_KEY);
        setOutput({ ok: true, state: this._lastState, lease: renewed });
      };
      request.onerror = () => setFailure(errorCode(request.error));
    });
    if (outcome.ok) this._adoptLease(outcome.lease);
    else if (outcome.error === 'lease_lost') this._preserveOrClearOwner(outcome.lease);
    return this._withOwnership(outcome);
  }

  async importJSON(text, { expectedRevision } = {}) {
    if (typeof text !== 'string') return this._result(false, this._lastState, 'invalid_import');
    let inputBytes;
    try {
      inputBytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(text).byteLength
        : unescape(encodeURIComponent(text)).length;
    } catch {
      return this._result(false, this._lastState, 'invalid_import');
    }
    if (inputBytes > MAX_IMPORT_BYTES) return this._result(false, this._lastState, 'size_limit');
    let imported;
    try {
      imported = JSON.parse(text);
    } catch {
      return this._result(false, this._lastState, 'invalid_import');
    }
    if (!inspectJSON(imported)) return this._result(false, this._lastState, 'invalid_import');
    const validity = validateResult(this.validate, imported);
    if (!validity.ok) return this._result(false, this._lastState, validity.error || 'invalid_import');
    const generation = identifier();
    if (!generation) return this._result(false, this._lastState, 'crypto_unavailable');
    if (!this._db) {
      const opened = await this.open();
      if (!opened.ok) return opened;
    }
    let stagedLease = null;
    const outcome = await this._runTransaction([RECORDS_STORE, BACKUPS_STORE], 'readwrite', (tx, setOutput, setFailure) => {
      const records = tx.objectStore(RECORDS_STORE);
      const saveRequest = records.get(SAVE_KEY);
      const leaseRequest = records.get(LEASE_KEY);
      let saveReady = false;
      let leaseReady = false;
      let current;
      let lease;
      const finish = () => {
        if (!saveReady || !leaseReady) return;
        if (!current) { setOutput({ ok: false, state: null, error: 'missing_save' }); return; }
        if (!isSaveState(current, this.validate)) { setOutput({ ok: false, state: null, error: 'corrupt_data' }); return; }
        const now = this.now();
        if (!this._leaseMatches(lease, now)) { setOutput({ ok: false, state: current, error: 'lease_lost', lease }); return; }
        if (expectedRevision !== undefined
          && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision)) {
          setOutput({ ok: false, state: current, error: 'revision_conflict', lease });
          return;
        }
        if (current.revision >= Number.MAX_SAFE_INTEGER) {
          setOutput({ ok: false, state: current, error: 'revision_exhausted', lease });
          return;
        }
        const next = cloneJSON(imported);
        next.revision = current.revision + 1;
        next.saveGeneration = generation;
        if (Object.prototype.hasOwnProperty.call(next, 'activeRun')) next.activeRun = null;
        if (Object.prototype.hasOwnProperty.call(next, 'activeAction')) next.activeAction = null;
        const nextValidity = isSaveState(next, this.validate);
        if (!nextValidity.ok) { setOutput({ ok: false, state: current, error: nextValidity.error }); return; }
        const renewed = { ...lease, expiresAt: now + LEASE_TTL_MS };
        stagedLease = renewed;
        this._writeStateWithBackup(tx, current, next, renewed, 'import', (error) => {
          if (error) { stagedLease = null; setOutput({ ok: false, state: current, error, lease }); return; }
          setOutput({ ok: true, state: next, lease: renewed });
        });
      };
      saveRequest.onsuccess = () => { current = saveRequest.result; saveReady = true; finish(); };
      leaseRequest.onsuccess = () => { lease = leaseRequest.result; leaseReady = true; finish(); };
      saveRequest.onerror = () => setFailure(errorCode(saveRequest.error));
      leaseRequest.onerror = () => setFailure(errorCode(leaseRequest.error));
    });
    if (outcome.ok && stagedLease) this._adoptLease(stagedLease);
    if (outcome.ok) {
      this._lastState = cloneJSON(outcome.state);
      this._broadcast(outcome.state.revision);
    } else if (outcome.error === 'lease_lost') {
      if (outcome.state) this._lastState = cloneJSON(outcome.state);
      this._preserveOrClearOwner(outcome.lease);
    }
    return this._withOwnership(outcome);
  }

  async exportJSON() {
    const outcome = await this.read();
    if (!outcome.ok) {
      const error = new Error(outcome.error || 'export_failed');
      error.code = outcome.error || 'export_failed';
      throw error;
    }
    const exported = cloneJSON(outcome.state);
    if (Object.prototype.hasOwnProperty.call(exported, 'activeRun')) exported.activeRun = null;
    if (Object.prototype.hasOwnProperty.call(exported, 'activeAction')) exported.activeAction = null;
    return JSON.stringify(exported);
  }

  async close() {
    let outcome = this._result(true, this._lastState);
    if (this._db && this.token !== null && this.epoch !== null) {
      outcome = await this._runTransaction([RECORDS_STORE], 'readwrite', (tx, setOutput, setFailure) => {
        const records = tx.objectStore(RECORDS_STORE);
        const request = records.get(LEASE_KEY);
        request.onsuccess = () => {
          const lease = request.result;
          if (!this._leaseMatches(lease, this.now())) {
            setOutput({ ok: false, state: this._lastState, error: 'lease_lost', lease });
            return;
          }
          const released = { ownerTabId: null, token: null, epoch: lease.epoch, expiresAt: 0 };
          records.put(released, LEASE_KEY);
          setOutput({ ok: true, state: this._lastState, lease: released });
        };
        request.onerror = () => setFailure(errorCode(request.error));
      });
    }
    this._clearOwner();
    this._closed = true;
    if (this._channel) this._channel.close();
    if (this._db) this._db.close();
    this._db = null;
    return this._withOwnership(outcome);
  }

  _runTransaction(storeNames, mode, operation) {
    if (!this._db) return Promise.resolve(this._result(false, this._lastState, 'indexeddb_unavailable'));
    return new Promise(resolve => {
      let tx;
      let output = null;
      let failure = null;
      try {
        tx = this._db.transaction(storeNames, mode);
      } catch (error) {
        resolve(this._result(false, this._lastState, errorCode(error, 'indexeddb_unavailable')));
        return;
      }
      tx.oncomplete = () => {
        resolve(output || this._result(false, this._lastState, failure || 'transaction_aborted'));
      };
      tx.onerror = event => {
        failure = errorCode(event?.target?.error || tx.error, failure || 'transaction_aborted');
      };
      tx.onabort = () => {
        resolve(this._result(false, this._lastState, failure || errorCode(tx.error)));
      };
      try {
        operation(tx, value => { output = value; }, code => { failure = code; });
      } catch (error) {
        failure = errorCode(error, 'transaction_aborted');
        try { tx.abort(); } catch { resolve(this._result(false, this._lastState, failure)); }
      }
    });
  }

  _writeStateWithBackup(tx, current, next, lease, reason, complete) {
    const backups = tx.objectStore(BACKUPS_STORE);
    const latestRequest = backups.get('latest');
    latestRequest.onerror = () => complete(errorCode(latestRequest.error));
    latestRequest.onsuccess = () => {
      try {
      const priorLatest = latestRequest.result;
      const currentSnapshot = {
        state: cloneJSON(current),
        revision: current.revision,
        createdAt: this.now(),
        reason,
      };
      const nextBytes = jsonBytes(next);
      if (nextBytes > MAX_SAVE_BYTES) { complete('size_limit'); return; }
      const metadataBytes = jsonBytes(lease)
        + jsonBytes(currentSnapshot)
        + (priorLatest ? jsonBytes(priorLatest) : 0)
        + nextBytes;
      if (metadataBytes > MAX_METADATA_BYTES) { complete('metadata_size_limit'); return; }
      if (priorLatest) backups.put(priorLatest, 'previous');
      else backups.delete('previous');
      backups.put(currentSnapshot, 'latest');
      const records = tx.objectStore(RECORDS_STORE);
      records.put(next, SAVE_KEY);
      records.put(lease, LEASE_KEY);
      complete(null);
      } catch (error) {
        // Request callbacks run after _runTransaction's synchronous guard.
        // A failure of any write must also roll back the backup writes.
        complete(errorCode(error, 'transaction_aborted'));
        try { tx.abort(); } catch { /* Already aborted by IndexedDB. */ }
      }
    };
  }

  _leaseMatches(lease, now) {
    return isLease(lease)
      && this.token !== null
      && this.epoch !== null
      && lease.ownerTabId === this.tabId
      && lease.token === this.token
      && lease.epoch === this.epoch
      && lease.expiresAt > now;
  }

  _adoptLease(lease) {
    this.token = lease.token;
    this.epoch = lease.epoch;
    this._expiresAt = lease.expiresAt;
  }

  _clearOwner() {
    this.token = null;
    this.epoch = null;
    this._expiresAt = 0;
  }

  _preserveOrClearOwner(lease) {
    if (isLease(lease)
      && lease.ownerTabId === this.tabId
      && lease.token === this.token
      && lease.epoch === this.epoch) {
      this._expiresAt = lease.expiresAt;
      return;
    }
    this._clearOwner();
  }

  _withOwnership(outcome) {
    if (!outcome || typeof outcome !== 'object') return this._result(false, this._lastState, 'transaction_aborted');
    const result = { ...outcome, owner: this.owner };
    if (result.lease) result.lease = publicLease(result.lease, this.now());
    if (result.state && typeof result.state === 'object') result.state = cloneJSON(result.state);
    return result;
  }

  _result(ok, state, error) {
    const result = { ok, state: state ? cloneJSON(state) : null, owner: this.owner };
    if (error) result.error = error;
    return result;
  }

  _broadcast(revision) {
    if (!this._channel) return;
    try { this._channel.postMessage({ type: 'save-updated', revision, tabId: this.tabId }); } catch { /* notifications are advisory */ }
  }
}

export const SAVE_STORE_LIMITS = Object.freeze({
  maxSaveBytes: MAX_SAVE_BYTES,
  maxImportBytes: MAX_IMPORT_BYTES,
  maxMetadataBytes: MAX_METADATA_BYTES,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  leaseTtlMs: LEASE_TTL_MS,
});

export default SaveStore;
