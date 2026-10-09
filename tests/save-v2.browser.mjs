import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Set DOG_PLAYWRIGHT_MODULE to the bundled Playwright index.mjs when the package
// is not installed in the project. This test uses the browser's real IndexedDB.
const { chromium } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const sourcePath = fileURLToPath(new URL('../src/save-store.js', import.meta.url));
const source = await readFile(sourcePath, 'utf8');
const moduleSources = new Map([['/save-store.js', source]]);
for (const name of ['raising-model.js', 'raising-config.js', 'raising-course.js', 'sprint-course.js', 'config.js']) {
  moduleSources.set(`/src/${name}`, await readFile(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8'));
}
const html = `<!doctype html><meta charset="utf-8"><script type="module">
  import { SaveStore } from '/save-store.js';
  import { createInitialSave, validateSave, migrateCandidateSave } from '/src/raising-model.js';
  window.SaveStore = SaveStore;
  window.raisingModel = { createInitialSave, validateSave, migrateCandidateSave };
</script>`;

// Route a loopback origin inside Playwright so IndexedDB has a secure local
// origin without opening a listening socket in the constrained test runner.
const origin = 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const checks = [];

function initialState() {
  return {
    schemaVersion: 2,
    revision: 0,
    saveGeneration: 'initial-v2',
    coins: 10,
    activeRun: null,
    activeAction: null,
  };
}

async function makePage(context, { databaseName, nowExpression = '() => Date.now()' }) {
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.SaveStore === 'function');
  await page.evaluate(({ databaseName, nowExpression, state }) => {
    const now = (0, eval)(nowExpression);
    window.store = new window.SaveStore({
      initialState: state,
      databaseName,
      now,
      validate: value => ({
        ok: value !== null
          && typeof value === 'object'
          && value.schemaVersion === 2
          && Number.isSafeInteger(value.coins)
          && value.coins >= 0,
      }),
    });
  }, { databaseName, nowExpression, state: initialState() });
  const opened = await page.evaluate(() => window.store.open());
  assert.equal(opened.ok, true, `open failed: ${opened.error}`);
  return page;
}

async function readBackupRows(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = window.store._db.transaction('backups', 'readonly').objectStore('backups').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function armRealTransactionFault(page, fault) {
  await page.evaluate(faultType => {
    const db = window.store._db;
    const nativeTransaction = db.transaction.bind(db);
    db.transaction = function (...args) {
      const tx = nativeTransaction(...args);
      const names = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (args[1] !== 'readwrite' || !names.includes('records') || !names.includes('backups')) return tx;

      const nativeObjectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const objectStore = nativeObjectStore(name);
        if (name !== 'records') return objectStore;
        const nativePut = objectStore.put.bind(objectStore);
        objectStore.put = (value, key) => {
          const request = nativePut(value, key);
          if (key === 'lease' && window.__armedSaveFault) {
            const armed = window.__armedSaveFault;
            window.__armedSaveFault = null;
            if (armed === 'quota') {
              // Deliver the deterministic quota fault through SaveStore's real
              // transaction error handler, then abort this native IDB transaction.
              const error = new DOMException('Injected quota fault for atomicity coverage', 'QuotaExceededError');
              tx.onerror?.({ target: { error }, currentTarget: tx });
            }
            tx.abort();
          }
          return request;
        };
        return objectStore;
      };
      return tx;
    };
    window.__armedSaveFault = faultType;
  }, fault);
}

try {
  const context = await browser.newContext();
  await context.route(`${origin}/**`, route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (moduleSources.has(pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: moduleSources.get(pathname) });
    return route.fulfill({ status: 404, body: 'not found' });
  });
  const databaseName = `save-v2-race-${randomUUID()}`;
  const first = await makePage(context, { databaseName });
  const second = await makePage(context, { databaseName });
  const third = await makePage(context, { databaseName });
  const fourth = await makePage(context, { databaseName });

  const firstAcquire = await first.evaluate(() => window.store.acquire({ takeover: false }));
  const secondAcquire = await second.evaluate(() => window.store.acquire({ takeover: false }));
  assert.equal(firstAcquire.owner, true);
  assert.equal(secondAcquire.owner, false);
  assert.equal(secondAcquire.lease.active, true);
  assert.equal(secondAcquire.lease.epoch, firstAcquire.lease.epoch);

  const committed = await first.evaluate(() => {
    const ownerTabId = window.store.tabId;
    const ownerEpoch = window.store.epoch;
    return window.store.transact(state => ({
      state: {
        ...state,
        coins: state.coins + 5,
        activeRun: { id: 'run-old', ownerTabId, ownerEpoch },
      },
      result: 'credited',
    }), { expectedRevision: 0 });
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.result, 'credited');
  assert.equal(committed.state.revision, 1);
  assert.equal((await second.evaluate(() => window.store.read())).state.coins, 15);

  const takeover = await second.evaluate(epoch => window.store.acquire({ takeover: true, expectedEpoch: epoch }), secondAcquire.lease.epoch);
  assert.equal(takeover.ok, true);
  assert.equal(takeover.owner, true);
  assert.equal(takeover.state.activeRun, null, 'a different owner cancels the prior active run without compensation');
  assert.equal(takeover.state.revision, 2);
  const oldOwnerWrite = await first.evaluate(() => window.store.transact(state => ({ state: { ...state, coins: 999 } }), { expectedRevision: 1 }));
  assert.equal(oldOwnerWrite.ok, false);
  assert.equal(oldOwnerWrite.error, 'lease_lost');

  const staleRevision = await second.evaluate(() => window.store.transact(state => ({ state: { ...state, coins: 20 } }), { expectedRevision: 1 }));
  assert.equal(staleRevision.ok, false);
  assert.equal(staleRevision.error, 'revision_conflict');
  assert.equal(staleRevision.state.coins, 15);

  const exported = await second.evaluate(() => window.store.exportJSON());
  const exportedState = JSON.parse(exported);
  assert.equal(exportedState.activeRun, null);
  const importState = { ...exportedState, coins: 77, activeRun: { id: 'must-not-resume' }, activeAction: { id: 'must-not-resume' } };
  const imported = await second.evaluate(({ text, revision }) => window.store.importJSON(text, { expectedRevision: revision }), {
    text: JSON.stringify(importState),
    revision: takeover.state.revision,
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.state.coins, 77);
  assert.equal(imported.state.revision, 3);
  assert.notEqual(imported.state.saveGeneration, 'initial-v2');
  assert.equal(imported.state.activeRun, null);
  assert.equal(imported.state.activeAction, null);
  const beforeRejectedImports = await second.evaluate(() => window.store.read());
  assert.equal(beforeRejectedImports.ok, true);
  const backupsBeforeRejectedImports = await readBackupRows(second);
  const brokenJSON = await second.evaluate(() => window.store.importJSON('{broken json'));
  assert.equal(brokenJSON.ok, false);
  assert.equal(brokenJSON.error, 'invalid_import');
  const invalidImport = await second.evaluate(() => window.store.importJSON('{"schemaVersion":3,"revision":0,"saveGeneration":"future","coins":1}'));
  assert.equal(invalidImport.ok, false);
  assert.equal(invalidImport.error, 'invalid_import');
  assert.deepEqual(await second.evaluate(() => window.store.read()), beforeRejectedImports, 'broken JSON and unknown schema leave the durable save unchanged');
  assert.deepEqual(await readBackupRows(second), backupsBeforeRejectedImports, 'rejected imports do not rotate or replace backups');

  const businessRejection = await second.evaluate(() => window.store.transact(() => {
    const error = new Error('insufficient energy');
    error.code = 'energy-too-low';
    throw error;
  }, { expectedRevision: 3 }));
  assert.equal(businessRejection.ok, false);
  assert.equal(businessRejection.error, 'energy-too-low');
  const missingRevision = await second.evaluate(() => window.store.transact(state => ({ state: { ...state } })));
  assert.equal(missingRevision.ok, false);
  assert.equal(missingRevision.error, 'expected_revision_required');
  const oversizedMutation = await second.evaluate(() => window.store.transact(state => ({
    state: { ...state, oversized: 'x'.repeat(131_072) },
  }), { expectedRevision: 3 }));
  assert.equal(oversizedMutation.ok, false);
  assert.equal(oversizedMutation.error, 'size_limit');

  const exactImportText = (() => {
    const base = {
      schemaVersion: 2,
      revision: 0,
      saveGeneration: '00000000-0000-4000-8000-000000000000',
      coins: 33,
      activeRun: null,
      activeAction: null,
      padding: '',
    };
    const paddingLength = 131_072 - JSON.stringify(base).length;
    base.padding = 'x'.repeat(paddingLength);
    return JSON.stringify(base);
  })();
  assert.equal(new TextEncoder().encode(exactImportText).byteLength, 131_072, 'the exact boundary is measured in UTF-8 bytes');
  const exactImport = await second.evaluate(({ text, revision }) => window.store.importJSON(text, { expectedRevision: revision }), {
    text: exactImportText,
    revision: 3,
  });
  assert.equal(exactImport.ok, true, `128 KiB import failed: ${exactImport.error}`);
  assert.equal(exactImport.state.revision, 4);
  const beforeTooLargeImport = await second.evaluate(() => window.store.read());
  const backupsBeforeTooLargeImport = await readBackupRows(second);
  const tooLargeImport = await second.evaluate(() => window.store.importJSON(' '.repeat(131_073)));
  assert.equal(tooLargeImport.ok, false);
  assert.equal(tooLargeImport.error, 'size_limit');
  assert.deepEqual(await second.evaluate(() => window.store.read()), beforeTooLargeImport, 'an oversized import preserves the durable save');
  assert.deepEqual(await readBackupRows(second), backupsBeforeTooLargeImport, 'an oversized import preserves both backup slots');
  const importedRoundTrip = JSON.parse(await second.evaluate(() => window.store.exportJSON()));
  assert.equal(importedRoundTrip.coins, 33, 'a valid import remains exportable with its saved values');
  assert.equal(importedRoundTrip.revision, 4);
  const backupRows = await readBackupRows(second);
  assert.equal(backupRows.length, 2);
  assert.deepEqual(backupRows.map(row => row.state.revision).sort((a, b) => a - b), [2, 3]);

  const ownerAtRaceStart = await second.evaluate(() => window.store.read());
  const contenders = await Promise.all([
    third.evaluate(({ epoch }) => window.store.acquire({ takeover: true, expectedEpoch: epoch }), { epoch: ownerAtRaceStart.lease.epoch }),
    fourth.evaluate(({ epoch }) => window.store.acquire({ takeover: true, expectedEpoch: epoch }), { epoch: ownerAtRaceStart.lease.epoch }),
  ]);
  assert.equal(contenders.filter(result => result.ok && result.owner).length, 1, 'only one same-epoch takeover may win');
  assert.equal(contenders.filter(result => result.error === 'stale_epoch').length, 1);
  assert.equal((await first.evaluate(() => window.store.read())).owner, false);
  checks.push('initial-open race, read-only second tab, revision conflict, domain error propagation, 128 KiB bounds, bounded backups, atomic takeover, old-owner fencing, export/import, same-epoch takeover race');

  for (const fault of ['abort', 'quota']) {
    const faultDb = `save-v2-fault-${fault}-${randomUUID()}`;
    const faultPage = await makePage(context, { databaseName: faultDb });
    const acquired = await faultPage.evaluate(() => window.store.acquire());
    assert.equal(acquired.ok, true);
    const committedBeforeFault = await faultPage.evaluate(() => window.store.transact(state => ({
      state: { ...state, coins: state.coins + 25 },
      result: 'durable-before-fault',
    }), { expectedRevision: 0 }));
    assert.equal(committedBeforeFault.ok, true);
    assert.equal(committedBeforeFault.state.revision, 1);
    const durableBeforeFault = await faultPage.evaluate(() => window.store.read());
    const backupsBeforeFault = await readBackupRows(faultPage);
    await armRealTransactionFault(faultPage, fault);
    const failedWrite = await faultPage.evaluate(() => window.store.transact(state => ({
      state: { ...state, coins: state.coins + 100 },
      result: 'must-not-propagate',
    }), { expectedRevision: 1 }));
    assert.equal(failedWrite.ok, false, `${fault} must not report a successful commit`);
    assert.equal(failedWrite.result, undefined, `${fault} must not propagate the transform result`);
    assert.equal(failedWrite.error, fault === 'quota' ? 'quota_exceeded' : 'transaction_aborted');
    const durableAfterFault = await faultPage.evaluate(() => window.store.read());
    const backupsAfterFault = await readBackupRows(faultPage);
    assert.deepEqual(durableAfterFault.state, durableBeforeFault.state, `${fault} preserves durable save state and revision`);
    assert.equal(durableAfterFault.state.coins, 35, `${fault} preserves the previously committed coin balance`);
    assert.deepEqual(backupsAfterFault, backupsBeforeFault, `${fault} rolls back backup rotation in the same real IndexedDB transaction`);
    assert.equal(durableAfterFault.state.revision, 1);
    await faultPage.evaluate(() => window.store.close());
  }
  checks.push('native IndexedDB abort and deterministic QuotaExceededError injection both roll back save, revision, coins, and backup rotation without returning success; this does not simulate a physically full device');

  const migrationDb = `save-v2-candidate-${randomUUID()}`;
  const migrationPage = await context.newPage();
  await migrationPage.goto(origin);
  await migrationPage.waitForFunction(() => typeof window.SaveStore === 'function');
  const candidateBefore = await migrationPage.evaluate(() => {
    const candidate = window.raisingModel.createInitialSave();
    candidate.revision = 9;
    candidate.saveGeneration = 'candidate-generation-kept';
    candidate.coins = 745;
    candidate.records.runsStarted = 4;
    candidate.records.legacyPlayEvidence = [{ key: 'phase2-walk2-v1', highScore: 3, maxCombo: 1 }];
    delete candidate.records.lastExportAt;
    delete candidate.raisingRng;
    return candidate;
  });
  await migrationPage.evaluate(async ({ databaseName, candidate }) => {
    const opened = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records');
        request.result.createObjectStore('backups');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const tx = opened.transaction(['records'], 'readwrite');
      tx.objectStore('records').put(candidate, 'save');
      tx.objectStore('records').put({ ownerTabId: null, token: null, epoch: 0, expiresAt: 0 }, 'lease');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    opened.close();
    window.migrationCalls = 0;
    window.migrationStore = new window.SaveStore({
      databaseName,
      initialState: window.raisingModel.createInitialSave(),
      validate: window.raisingModel.validateSave,
      migrateCandidate(value) {
        window.migrationCalls++;
        return window.raisingModel.migrateCandidateSave(value);
      },
    });
  }, { databaseName: migrationDb, candidate: candidateBefore });
  const migration = await migrationPage.evaluate(() => window.migrationStore.open());
  assert.equal(migration.ok, true, `candidate migration failed: ${migration.error}`);
  assert.equal(migration.migrated, true);
  assert.equal(migration.state.revision, 10);
  assert.equal(migration.state.coins, candidateBefore.coins);
  assert.equal(migration.state.records.runsStarted, candidateBefore.records.runsStarted);
  assert.equal(migration.state.records.lastExportAt, null);
  assert.equal(migration.state.saveGeneration, candidateBefore.saveGeneration);
  assert.deepEqual(migration.state.raisingRng, { algorithm: 'xorshift32-v1', state: 0, drawCount: 0, idleMs: 0 });
  assert.equal(await migrationPage.evaluate(() => window.migrationCalls), 1);
  const migrationBackup = await migrationPage.evaluate(() => new Promise((resolve, reject) => {
    const request = window.migrationStore._db.transaction('backups', 'readonly').objectStore('backups').get('latest');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  assert.equal(migrationBackup.reason, 'candidate-migration');
  assert.deepEqual(migrationBackup.state, candidateBefore, 'the pre-migration candidate is retained atomically as backup');
  const reopen = await migrationPage.evaluate(async databaseName => {
    const store = new window.SaveStore({
      databaseName,
      initialState: window.raisingModel.createInitialSave(),
      validate: window.raisingModel.validateSave,
      migrateCandidate() { throw new Error('migration must run only once'); },
    });
    return store.open();
  }, migrationDb);
  assert.equal(reopen.ok, true);
  assert.equal(reopen.state.revision, 10);

  const corruptDb = `save-v2-candidate-unknown-${randomUUID()}`;
  const corruptBefore = { ...candidateBefore, futureField: 'preserve-for-recovery' };
  await migrationPage.evaluate(async ({ databaseName, candidate }) => {
    const opened = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records');
        request.result.createObjectStore('backups');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const tx = opened.transaction('records', 'readwrite');
      tx.objectStore('records').put(candidate, 'save');
      tx.objectStore('records').put({ ownerTabId: null, token: null, epoch: 0, expiresAt: 0 }, 'lease');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    opened.close();
    window.corruptStore = new window.SaveStore({
      databaseName,
      initialState: window.raisingModel.createInitialSave(),
      validate: window.raisingModel.validateSave,
      migrateCandidate: window.raisingModel.migrateCandidateSave,
    });
  }, { databaseName: corruptDb, candidate: corruptBefore });
  const rejectedMigration = await migrationPage.evaluate(() => window.corruptStore.open());
  assert.equal(rejectedMigration.ok, false);
  assert.equal(rejectedMigration.error, 'unsupported-candidate-save');
  const corruptAfter = await migrationPage.evaluate(() => new Promise((resolve, reject) => {
    const request = window.corruptStore._db.transaction('records', 'readonly').objectStore('records').get('save');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  assert.deepEqual(corruptAfter, corruptBefore, 'an unknown candidate remains byte-for-byte represented in the save record');
  await migrationPage.evaluate(() => window.migrationStore.close());
  checks.push('candidate migration increments revision once, preserves gameplay values and generation, backs up atomically, skips repeat migration, and leaves unsupported data untouched');

  const resumeDb = `save-v2-resume-${randomUUID()}`;
  const resumePage = await makePage(context, { databaseName: resumeDb, nowExpression: '() => window.testNow' });
  await resumePage.evaluate(() => { window.testNow = 1_000; });
  const beforeResume = await resumePage.evaluate(() => window.store.acquire());
  const activeState = await resumePage.evaluate(() => window.store.transact(state => ({
    state: {
      ...state,
      activeAction: {
        actionId: 'rest-1',
        ownerTabId: window.store.tabId,
        ownerEpoch: window.store.epoch,
        status: 'active',
        chargedCost: 0,
      },
    },
  }), { expectedRevision: 0 }));
  assert.equal(activeState.ok, true);
  const oldToken = await resumePage.evaluate(() => window.store.token);
  await resumePage.evaluate(() => { window.testNow = 11_001; });
  const expiredHeartbeat = await resumePage.evaluate(() => window.store.heartbeat());
  assert.equal(expiredHeartbeat.ok, false);
  assert.equal(expiredHeartbeat.error, 'lease_lost');
  assert.equal((await resumePage.evaluate(() => window.store.read())).owner, false);
  const resumed = await resumePage.evaluate(() => window.store.acquire({ takeover: false }));
  assert.equal(resumed.ok, true);
  assert.equal(resumed.owner, true);
  assert.equal(resumed.lease.epoch, beforeResume.lease.epoch + 1);
  assert.notEqual(await resumePage.evaluate(() => window.store.token), oldToken);
  assert.equal(resumed.state.activeAction.ownerEpoch, resumed.lease.epoch, 'same-document re-acquire keeps its action on the new epoch');
  assert.equal(resumed.state.revision, 2);
  const heartbeat = await resumePage.evaluate(() => window.store.heartbeat());
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.lease.expiresAt, 21_001);
  checks.push('same-document expired-lease reacquire carries active action to the fenced epoch; heartbeat renews TTL');

  const closeResults = await Promise.all([
    first.evaluate(() => window.store.close()),
    second.evaluate(() => window.store.close()),
    third.evaluate(() => window.store.close()),
    fourth.evaluate(() => window.store.close()),
    resumePage.evaluate(() => window.store.close()),
  ]);
  assert.ok(closeResults.every(result => result.ok || result.error === 'lease_lost'));
  await context.close();
  console.log(JSON.stringify({ checks }, null, 2));
} finally {
  await browser.close();
}
