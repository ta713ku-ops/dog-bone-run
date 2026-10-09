import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  createInitialSave,
  LEGACY_PROVISIONAL_ECONOMY_VERSION,
  migrateCandidateSave,
  validateSave,
} from '../src/raising-model.js';
import { createRaisingCourse } from '../src/raising-course.js';

const LEGACY_SCALE_BPS = Object.freeze({ 1: 10_000, 2: 10_500, 3: 11_000, 4: 11_500, 5: 12_000 });
const TEST_EPOCH = 9;

function id(value) {
  return `${value}-000000000000`;
}

function makePersistedProvisionalRun() {
  const save = createInitialSave();
  const runId = id('provisional-run');
  const seed = 89_321;
  const difficulty = 4;
  const course = createRaisingCourse(seed, difficulty);
  const normalBoneTotal = course.bones.filter(bone => bone.kind !== 'gold').length;
  const goldBoneTotal = course.bones.filter(bone => bone.kind === 'gold').length;
  const rewardScaleBps = LEGACY_SCALE_BPS[difficulty];
  const scale = rewardScaleBps / 10_000;
  const fullClearReference = Math.floor((normalBoneTotal + goldBoneTotal * 3) * scale)
    + Math.floor(4 * scale);

  save.saveGeneration = id('persisted-generation');
  save.revision = 16;
  save.coins = 847;
  save.dog.hunger = 42;
  save.dog.energy = 71;
  save.owned.houseLevel = 2;
  save.owned.toys.push('plush');
  save.equipped.toy = 'plush';
  save.records.unlockedDifficulty = 5;
  save.records.runsStarted = 11;
  save.records.runsCleared = 7;
  save.records.runsFailed = 3;
  save.records.totalCoinsEarned = 2_016;
  save.records.totalCoinsSpent = 1_169;
  save.records.lastRun = { runId: id('previous-run'), difficulty: 3, outcome: 'clear', reward: 52 };
  save.raisingClockMs = 50_000;
  save.idHistory.runIds.push(runId);
  save.activeRun = {
    saveGeneration: save.saveGeneration,
    runId,
    economyVersion: LEGACY_PROVISIONAL_ECONOMY_VERSION,
    seed,
    difficulty,
    ownerEpoch: TEST_EPOCH,
    status: 'running',
    fullClearReference,
    normalBoneTotal,
    goldBoneTotal,
    rewardScaleBps,
    startedAtMs: 48_000,
  };
  assert.deepEqual(validateSave(save), { ok: true });
  return save;
}

test('known provisional persisted run is accepted narrowly, is never paid under new economy, and can be abandoned for zero', () => {
  const persisted = JSON.parse(JSON.stringify(makePersistedProvisionalRun()));
  const original = structuredClone(persisted);
  assert.deepEqual(validateSave(persisted), { ok: true });

  // SaveStore candidate normalization may add its known fields while preserving
  // the old run unchanged; the next owner acquisition clears it and backs up
  // this pre-acquisition state using SaveStore's existing ownership-change path.
  const candidate = structuredClone(persisted);
  delete candidate.records.lastExportAt;
  delete candidate.raisingRng;
  const candidateBefore = structuredClone(candidate);
  const migrated = migrateCandidateSave(candidate);
  assert.equal(migrated.ok, true, migrated.error);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.save.activeRun, candidateBefore.activeRun);
  assert.equal(migrated.save.coins, candidateBefore.coins);
  assert.equal(migrated.save.records.unlockedDifficulty, candidateBefore.records.unlockedDifficulty);
  assert.deepEqual(candidate, candidateBefore, 'normalization does not mutate the persisted source');

  const settlement = applyCommand(persisted, {
    type: 'settleRun',
    runId: persisted.activeRun.runId,
    result: { outcome: 'clear', completed: true, normalCollected: persisted.activeRun.normalBoneTotal, goldCollected: persisted.activeRun.goldBoneTotal },
  });
  assert.equal(settlement.ok, false);
  assert.equal(settlement.error, 'run-economy-version-mismatch');
  assert.deepEqual(settlement.save, original, 'the new economy cannot settle an old reward scale');

  const abandoned = applyCommand(persisted, { type: 'cancelRun', runId: persisted.activeRun.runId });
  assert.equal(abandoned.ok, true);
  assert.equal(abandoned.result.outcome, 'cancelled');
  assert.equal(abandoned.result.reward, 0);
  assert.equal(abandoned.save.activeRun, null);
  assert.equal(abandoned.save.coins, original.coins);
  assert.equal(abandoned.save.records.totalCoinsEarned, original.records.totalCoinsEarned);
  assert.equal(abandoned.save.records.totalCoinsSpent, original.records.totalCoinsSpent);
  assert.equal(abandoned.save.records.runsStarted, original.records.runsStarted);
  assert.equal(abandoned.save.records.runsCleared, original.records.runsCleared);
  assert.equal(abandoned.save.records.runsFailed, original.records.runsFailed);
  assert.equal(abandoned.save.records.unlockedDifficulty, original.records.unlockedDifficulty);
  assert.deepEqual(validateSave(abandoned.save), { ok: true });
});

test('unknown, future, or corrupted active-run economies remain rejected', () => {
  const known = makePersistedProvisionalRun();

  for (const version of ['raising-economy-designed-2', 'unrecognized-economy', '', null]) {
    const future = structuredClone(known);
    future.activeRun.economyVersion = version;
    assert.equal(validateSave(future).ok, false, `unexpectedly accepted ${String(version)}`);
    assert.equal(migrateCandidateSave(future).ok, false, `unexpectedly migrated ${String(version)}`);
  }

  const badReference = structuredClone(known);
  badReference.activeRun.fullClearReference += 1;
  assert.equal(validateSave(badReference).ok, false);
  assert.equal(migrateCandidateSave(badReference).ok, false);

  const badScale = structuredClone(known);
  badScale.activeRun.rewardScaleBps += 1;
  assert.equal(validateSave(badScale).ok, false);
  assert.equal(migrateCandidateSave(badScale).ok, false);

  const badRouteCounts = structuredClone(known);
  badRouteCounts.activeRun.normalBoneTotal += 1;
  assert.equal(validateSave(badRouteCounts).ok, false);
  assert.equal(migrateCandidateSave(badRouteCounts).ok, false);

  const corruptWallet = structuredClone(known);
  corruptWallet.coins = -1;
  assert.equal(validateSave(corruptWallet).ok, false);
  assert.equal(migrateCandidateSave(corruptWallet).ok, false);

  const unknownRunField = structuredClone(known);
  unknownRunField.activeRun.extra = 'not-supported';
  assert.equal(validateSave(unknownRunField).ok, false);
  assert.equal(migrateCandidateSave(unknownRunField).ok, false);
});

test('zero-gain pets during play or rest are true no-ops for cooldown and rolling-cap cases', () => {
  const cases = [
    {
      reason: 'cooldown',
      lastGainAtMs: 19_000,
      history: [{ atMs: 19_000, gain: 3 }],
    },
    {
      reason: 'rolling-cap',
      lastGainAtMs: 7_000,
      history: [1_000, 3_000, 5_000, 7_000].map(atMs => ({ atMs, gain: 3 })),
    },
  ];

  for (const { reason, lastGainAtMs, history } of cases) {
    for (const actionKind of ['rest', 'play']) {
      let save = createInitialSave();
      save.revision = 23;
      save.raisingClockMs = 20_000;
      save.dog.mood = 80;
      save.petting.lastGainAtMs = lastGainAtMs;
      save.petting.history = history.map(entry => ({ ...entry }));
      save.petting.gestureIds = history.map((_, index) => id(`prior-${reason}-${index}`));

      if (actionKind === 'rest') save.dog.energy = 50;
      const action = applyCommand(save, {
        type: actionKind,
        ...(actionKind === 'play' ? { toyId: 'starterBall' } : {}),
        actionId: id(`${reason}-${actionKind}`),
        ownerTabId: id('active-owner'),
        ownerEpoch: TEST_EPOCH,
      });
      assert.equal(action.ok, true, action.error);
      save = action.save;
      const before = structuredClone(save);

      const pet = applyCommand(save, {
        type: 'pet',
        gestureId: id(`no-op-${reason}-${actionKind}`),
        nowMs: save.raisingClockMs,
      });
      assert.equal(pet.ok, true, pet.error);
      assert.equal(pet.result.noop, true);
      assert.equal(pet.result.gain, 0);
      assert.equal(pet.result.cancelledActionId, null);
      assert.strictEqual(pet.save, save, 'a no-op must return the same state object for controller preflight');
      assert.deepEqual(pet.save, before);
      assert.equal(pet.save.revision, 23, 'the no-op leaves revision unchanged so the controller can skip a store transaction');
      assert.deepEqual(pet.save.activeAction, before.activeAction);
      assert.deepEqual(pet.save.raisingRng, before.raisingRng);
      assert.deepEqual(pet.save.petting, before.petting, 'no-op gesture ID and history are not persisted');
    }
  }
});
