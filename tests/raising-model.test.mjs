import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  calculateFullClearReference,
  calculateRunRewardInput,
  createInitialSave,
  migrateCandidateSave,
  validateSave,
} from '../src/raising-model.js';
import {
  DECORATION_ITEMS,
  ECONOMY_CONFIG_PENDING,
  ECONOMY_CONFIG_FINALIZED,
  ECONOMY_HUMAN_REVIEW,
  FOOD_ITEMS,
  HOUSE_LEVEL_PRICES,
  RAISING_CONFIG,
  SHOP_ITEMS,
  TOY_ITEMS,
} from '../src/raising-config.js';
import { createRaisingCourse } from '../src/raising-course.js';

const SESSION = 'page-session-00000001';
let tickActionIndex = 0;

function command(save, value) {
  const result = applyCommand(save, value);
  assert.ok(result.ok, result.error);
  assert.deepEqual(validateSave(result.save), { ok: true });
  return result;
}

function tick(save, elapsedMs, overrides = {}) {
  return command(save, {
    type: 'tick',
    elapsedMs,
    sessionId: SESSION,
    context: { isOwner: true, foreground: true, paused: false, idle: false },
    actionId: id(`tick-action-${tickActionIndex++}`),
    ownerTabId: id('tab-a'),
    ownerEpoch: 1,
    ...overrides,
  });
}

function id(text) {
  return `${text}-0000000000000000`;
}

test('initial save is valid, starts with zero coins, and owns only the free starter ball', () => {
  const save = createInitialSave();
  assert.deepEqual(validateSave(save), { ok: true });
  assert.equal(save.schemaVersion, 2);
  assert.equal(save.revision, 0);
  assert.equal(save.coins, 0);
  assert.equal(save.dog.hunger, 0);
  assert.deepEqual(save.owned.toys, ['starterBall']);
  assert.equal(save.inventory.kibble, 0);
  assert.equal(save.settings.musicVolume, 0.35);
  assert.equal(save.settings.sfxVolume, 0.8);
  assert.equal(save.records.unlockedDifficulty, 1);
});

test('validator rejects invalid numbers, duplicate IDs, unknown schema fields, and mismatched equipment', () => {
  const source = createInitialSave();
  const badCoins = structuredClone(source);
  badCoins.coins = -1;
  assert.equal(validateSave(badCoins).ok, false);
  const badItems = structuredClone(source);
  badItems.owned.toys.push('starterBall');
  assert.equal(validateSave(badItems).ok, false);
  const unknownField = { ...source, extra: true };
  assert.equal(validateSave(unknownField).ok, false);
  const badEquipment = structuredClone(source);
  badEquipment.equipped.bed = 'bed';
  assert.equal(validateSave(badEquipment).ok, false);
});

test('commands return a new save and leave the input unchanged', () => {
  const original = createInitialSave();
  const snapshot = structuredClone(original);
  const result = command(original, { type: 'settings', patch: { reducedMotion: true } });
  assert.deepEqual(original, snapshot);
  assert.notStrictEqual(result.save, original);
  assert.equal(result.save.settings.reducedMotion, true);
  assert.equal(result.save.revision, original.revision, 'revision belongs to SaveStore');
});

test('petting has a five-second cooldown, a real-gain rolling cap, and a single-gesture ID', () => {
  let save = createInitialSave();
  const first = command(save, { type: 'pet', gestureId: id('pet-a') });
  save = first.save;
  assert.equal(first.result.gain, 3);
  assert.equal(applyCommand(save, { type: 'pet', gestureId: id('pet-a') }).error, 'gesture-already-used');
  assert.equal(command(save, { type: 'pet', gestureId: id('pet-b') }).result.gain, 0);

  for (let index = 0; index < 4; index++) {
    const advanced = tick(save, 5_000);
    save = advanced.save;
    const pet = command(save, { type: 'pet', gestureId: id(`pet-${index + 1}`), nowMs: save.raisingClockMs });
    save = pet.save;
  }
  assert.equal(save.dog.mood, 82, 'four successful strokes add 12 mood');
  const blockedByRollingWindow = command(save, { type: 'pet', gestureId: id('pet-cap'), nowMs: save.raisingClockMs });
  assert.equal(blockedByRollingWindow.result.gain, 0);
  assert.equal(save.petting.lastGainAtMs, 15_000, 'blocked attempt does not extend cooldown');
});

test('pet window excludes an event exactly 60 seconds old and clamps at mood 100', () => {
  let save = createInitialSave();
  save.dog.mood = 99;
  save = command(save, { type: 'pet', gestureId: id('pet-near-cap') }).save;
  assert.equal(save.dog.mood, 100);
  assert.equal(save.petting.history[0].gain, 1);
  save = tick(save, 60_000).save;
  save.dog.mood = 97;
  const afterWindow = command(save, { type: 'pet', gestureId: id('pet-window'), nowMs: save.raisingClockMs });
  assert.equal(afterWindow.result.gain, 3);
});

test('natural mood loss uses exclusive hunger states, fractional debt, owner visibility, and a ten-point page cap', () => {
  let save = createInitialSave();
  save.dog.hunger = 60;
  const readonlyTick = applyCommand(save, {
    type: 'tick', elapsedMs: 60_000, sessionId: 'other-session-0001',
    context: { isOwner: false, foreground: true, paused: false },
  });
  assert.equal(readonlyTick.result.advanced, false);
  assert.deepEqual(readonlyTick.save, save, 'read-only tick cannot reset a session cap');

  save = tick(save, 60_000).save;
  assert.ok(save.moodDecayDebt > 0 && save.moodDecayDebt < 1);
  for (let index = 0; index < 30; index++) save = tick(save, 60_000).save;
  assert.equal(save.naturalLossSession.used, 10);
  assert.equal(save.dog.mood, 60);
  const nextPage = tick(save, 0, { sessionId: 'page-session-00000002' }).save;
  assert.equal(nextPage.naturalLossSession.used, 0, 'new Document receives a fresh ten-point natural cap');
  assert.equal(nextPage.dog.mood, save.dog.mood, 'changing session identity alone grants no mood or coins');
});

test('rest starts on the ground without a bed, credits each eight-second cycle once, and cancels partial work', () => {
  let save = createInitialSave();
  save.dog.energy = 50;
  const started = command(save, { type: 'rest', actionId: id('rest-a'), ownerTabId: id('tab-a'), ownerEpoch: 1 });
  save = started.save;
  assert.equal(started.result.energyPerCycle, 10);
  assert.equal(tick(save, 7_999).save.dog.energy, 50);
  save = tick(save, 8_000).save;
  assert.equal(save.dog.energy, 60);
  assert.equal(save.activeAction.cycleIndex, 1);
  save = tick(save, 4_000).save;
  assert.equal(save.dog.energy, 60);
  save = command(save, { type: 'cancelAction', actionId: id('rest-a') }).save;
  assert.equal(save.activeAction, null);
  const duplicate = applyCommand(save, { type: 'rest', actionId: id('rest-a'), ownerTabId: id('tab-a'), ownerEpoch: 1 });
  assert.equal(duplicate.error, 'action-id-already-used');
});

test('rest snapshots bed equipment at action start and finishes at energy 100', () => {
  let save = createInitialSave();
  save.coins = 350;
  save.dog.energy = 82;
  save = command(save, { type: 'purchase', itemId: 'bed' }).save;
  save = command(save, { type: 'equip', itemId: 'bed' }).save;
  save = command(save, { type: 'rest', actionId: id('rest-bed'), ownerTabId: id('tab-a'), ownerEpoch: 2 }).save;
  assert.equal(save.activeAction.energyPerCycle, 18);
  save = command(save, { type: 'equip', itemId: 'bed' }).save;
  assert.equal(save.equipped.bed, null);
  save = tick(save, 8_000).save;
  assert.equal(save.dog.energy, 100);
  assert.equal(save.activeAction, null);
});

test('spontaneous sleep rolls once per 30 idle seconds with the configured energy probabilities', () => {
  const expected = new Map([[70, 0.05], [69, 0.15], [40, 0.15], [39, 0.35]]);
  for (const [energy, probability] of expected) {
    let save = createInitialSave();
    save.dog.energy = energy;
    save.raisingRng.state = 1; // The next independent xorshift32 value is below every configured threshold.
    const before = applyCommand(save, {
      type: 'tick', elapsedMs: 29_999, sessionId: SESSION,
      context: { isOwner: true, foreground: true, paused: false, idle: true },
      actionId: id(`sleep-before-${energy}`), ownerTabId: id('tab-a'), ownerEpoch: 1,
    });
    assert.equal(before.result.sleepRolls, 0);
    const rolled = applyCommand(before.save, {
      type: 'tick', elapsedMs: 1, sessionId: SESSION,
      context: { isOwner: true, foreground: true, paused: false, idle: true },
      actionId: id(`sleep-${energy}`), ownerTabId: id('tab-a'), ownerEpoch: 1,
    });
    assert.ok(rolled.ok, rolled.error);
    assert.equal(rolled.result.sleepRolls, 1);
    assert.equal(rolled.result.sleepProbability, probability);
    assert.equal(rolled.result.spontaneousSleep, true);
    assert.equal(rolled.result.actionKind, 'sleep');
    assert.equal(rolled.save.activeAction.kind, 'sleep');
    assert.equal(rolled.save.raisingRng.algorithm, 'xorshift32-v1');
    assert.equal(rolled.save.raisingRng.drawCount, 1);
  }
});

test('spontaneous sleep snapshots bed recovery, pauses outside an active home session, and can be interrupted', () => {
  let save = createInitialSave();
  save.coins = 350;
  save.dog.energy = 39;
  save.raisingRng.state = 1;
  save = command(save, { type: 'purchase', itemId: 'bed' }).save;
  save = command(save, { type: 'equip', itemId: 'bed' }).save;
  const sleeping = command(save, {
    type: 'tick', elapsedMs: 30_000, sessionId: SESSION,
    context: { isOwner: true, foreground: true, paused: false, idle: true },
    actionId: id('sleep-bed'), ownerTabId: id('tab-a'), ownerEpoch: 1,
  });
  save = sleeping.save;
  assert.equal(save.activeAction.kind, 'sleep');
  assert.equal(save.activeAction.energyPerCycle, 18);
  const paused = applyCommand(save, {
    type: 'tick', elapsedMs: 30_000, sessionId: SESSION,
    context: { isOwner: true, foreground: false, paused: false, idle: true },
    actionId: id('sleep-paused'), ownerTabId: id('tab-a'), ownerEpoch: 1,
  });
  assert.deepEqual(paused.save, save);
  save = command(save, { type: 'pet', gestureId: id('wake-dog') }).save;
  assert.equal(save.activeAction, null, 'a user interaction interrupts sleep without a refund');
  assert.equal(save.dog.energy, 39);
});

test('play enforces energy boundaries, charges once at start, and does not refund cancellation', () => {
  let save = createInitialSave();
  save.dog.energy = 14;
  assert.equal(applyCommand(save, { type: 'play', toyId: 'starterBall', actionId: id('play-low'), ownerTabId: id('tab-a'), ownerEpoch: 1 }).error, 'energy-too-low');
  save.dog.energy = 15;
  save = command(save, { type: 'play', toyId: 'starterBall', actionId: id('play-ok'), ownerTabId: id('tab-a'), ownerEpoch: 1 }).save;
  assert.equal(save.dog.energy, 10);
  save = command(save, { type: 'cancelAction', actionId: id('play-ok') }).save;
  assert.equal(save.dog.energy, 10);
  assert.equal(save.activeAction, null);
  assert.equal(applyCommand(save, { type: 'play', toyId: 'starterBall', actionId: id('play-ok'), ownerTabId: id('tab-a'), ownerEpoch: 1 }).error, 'action-id-already-used');

  save.owned.toys.push('plush');
  save.equipped.toy = 'plush';
  save.dog.energy = 4;
  assert.equal(applyCommand(save, { type: 'play', toyId: 'plush', actionId: id('plush-low'), ownerTabId: id('tab-a'), ownerEpoch: 1 }).error, 'energy-too-low');
  save.dog.energy = 5;
  save = command(save, { type: 'play', toyId: 'plush', actionId: id('plush-ok'), ownerTabId: id('tab-a'), ownerEpoch: 1 }).save;
  assert.equal(save.dog.energy, 3);
});

test('permanent shop totals match the specified prices; food purchases and feed update the wallet and inventory', () => {
  assert.equal(Object.values(HOUSE_LEVEL_PRICES).reduce((sum, price) => sum + price, 0), 23_500);
  assert.equal(TOY_ITEMS.filter(item => !item.free).reduce((sum, item) => sum + item.price, 0), 3_250);
  assert.equal(DECORATION_ITEMS.reduce((sum, item) => sum + item.price, 0), 2_430);
  assert.equal(SHOP_ITEMS.reduce((sum, item) => sum + item.price, 0), RAISING_CONFIG.permanentItemTargetCoins);
  assert.ok(FOOD_ITEMS.every(item => item.label && item.description));
  assert.equal(ECONOMY_CONFIG_FINALIZED, true);
  assert.equal(ECONOMY_HUMAN_REVIEW, 'PENDING');
  assert.deepEqual(ECONOMY_CONFIG_PENDING, []);

  let save = createInitialSave();
  save.coins = FOOD_ITEMS.find(item => item.id === 'kibble').price;
  save.dog.hunger = 40;
  save = command(save, { type: 'purchase', itemId: 'kibble' }).save;
  assert.equal(save.inventory.kibble, 1);
  assert.equal(save.coins, 0);
  save = command(save, { type: 'feed', foodId: 'kibble' }).save;
  assert.equal(save.dog.hunger, 5);
  assert.equal(save.inventory.kibble, 0);
  assert.equal(applyCommand(save, { type: 'feed', foodId: 'kibble' }).error, 'food-not-owned');
});

test('purchase, equip, settings, and export timestamp all remain validator-compatible', () => {
  let save = createInitialSave();
  save.coins = 29_180;
  for (const item of SHOP_ITEMS) save = command(save, { type: 'purchase', itemId: item.id }).save;
  assert.equal(save.coins, 0);
  assert.equal(save.owned.houseLevel, 5);
  assert.equal(save.owned.toys.length, TOY_ITEMS.length);
  assert.equal(save.owned.decorations.length, DECORATION_ITEMS.length);
  save = command(save, { type: 'equip', itemId: 'bed' }).save;
  save = command(save, { type: 'equip', itemId: 'frisbee' }).save;
  save = command(save, { type: 'equip', itemId: 'plant' }).save;
  save = command(save, { type: 'settings', patch: { musicEnabled: false, musicVolume: 0.2, roadDecoration: 'minimal' } }).save;
  save = command(save, { type: 'exported', at: '2026-10-04T01:02:03.000Z' }).save;
  assert.equal(save.equipped.bed, 'bed');
  assert.equal(save.equipped.toy, 'frisbee');
  assert.deepEqual(save.equipped.decorations, ['plant']);
  assert.equal(save.settings.musicEnabled, false);
  assert.equal(save.records.lastExportAt, '2026-10-04T01:02:03.000Z');
  assert.equal(applyCommand(save, { type: 'purchase', itemId: 'rope' }).error, 'item-already-owned');
});

test('run settlement is tied to the active seed and difficulty, caps failure pay, and cannot pay twice', () => {
  let save = createInitialSave();
  save.records.unlockedDifficulty = 5;
  const seed = 42;
  const difficulty = 5;
  const course = createRaisingCourse(seed, difficulty);
  const counts = { normalCollected: course.bones.filter(bone => bone.kind !== 'gold').length, goldCollected: course.goldIds.length };
  const fullClearReference = calculateFullClearReference(course, difficulty);
  const fullBase = Math.floor((counts.normalCollected * RAISING_CONFIG.boneRewardCoins
    + counts.goldCollected * RAISING_CONFIG.goldBoneRewardCoins) * RAISING_CONFIG.runRewardScaleBps[difficulty] / 10_000);
  save = command(save, { type: 'beginRun', runId: id('run-fail'), seed, difficulty, ownerEpoch: 3 }).save;
  assert.equal(save.activeRun.fullClearReference, fullClearReference);
  const failedRun = command(save, {
    type: 'settleRun', runId: id('run-fail'),
    result: { outcome: 'failure', ...counts, fullClearReference: 999_999, holeIds: ['hole-a', 'hole-a', 'hole-b'] },
  });
  const expectedCap = Math.floor(0.70 * fullClearReference);
  const expectedFailureReward = Math.max(0, Math.floor(Math.min(
    fullBase * RAISING_CONFIG.failureMultipliers[difficulty],
    0.70 * fullClearReference,
  )));
  assert.ok(fullBase * RAISING_CONFIG.failureMultipliers[difficulty] >= 0.70 * fullClearReference, 'the all-pickups fixture reaches the configured failure cap');
  assert.equal(failedRun.result.reward, expectedFailureReward);
  assert.equal(failedRun.result.reward, expectedCap);
  assert.ok(failedRun.result.reward <= expectedCap);
  assert.equal(failedRun.result.earnedBase, fullBase);
  assert.equal(failedRun.result.holeMoodLoss, 6);
  assert.equal(failedRun.save.dog.mood, 64);
  assert.equal(failedRun.save.activeRun, null);
  assert.equal(applyCommand(failedRun.save, { type: 'settleRun', runId: id('run-fail'), result: { outcome: 'clear', ...counts } }).error, 'active-run-mismatch');
  assert.equal(applyCommand(failedRun.save, { type: 'beginRun', runId: id('run-fail'), seed, difficulty, ownerEpoch: 3 }).error, 'run-id-already-used');
});

test('completed runs add their bonus once, unlock the next star, and cancel has no minimum reward', () => {
  let save = createInitialSave();
  const course = createRaisingCourse(9, 1);
  const fullClearReference = calculateFullClearReference(course, 1);
  const counts = { normalCollected: course.bones.filter(bone => bone.kind !== 'gold').length, goldCollected: course.goldIds.length };
  const expected = calculateRunRewardInput({ ...counts, completed: true, difficulty: 1, course });
  save = command(save, { type: 'beginRun', runId: id('run-clear'), seed: 9, difficulty: 1, ownerEpoch: 1 }).save;
  const settled = command(save, { type: 'settleRun', runId: id('run-clear'), result: { outcome: 'clear', ...counts } });
  assert.equal(settled.result.reward, expected.reward);
  assert.equal(settled.result.reward, fullClearReference);
  assert.equal(settled.save.records.unlockedDifficulty, 2);

  save = command(settled.save, { type: 'beginRun', runId: id('run-cancel'), seed: 10, difficulty: 2, ownerEpoch: 1 }).save;
  const cancelled = command(save, { type: 'cancelRun', runId: id('run-cancel') });
  assert.equal(cancelled.result.reward, 0);
  assert.equal(cancelled.save.coins, settled.save.coins);
  assert.equal(applyCommand(cancelled.save, { type: 'cancelRun', runId: id('run-cancel') }).error, 'active-run-mismatch');
});

test('legacy migration preserves evidence without inventing coins or completed runs', () => {
  const initial = createInitialSave();
  const migrated = command(initial, {
    type: 'legacyMigration',
    records: [{ key: 'sprint30-hard-v1', highScore: 101, maxCombo: 14 }, { key: 'phase2-walk2-v1', highScore: 0, maxCombo: 0 }],
  });
  assert.equal(migrated.save.records.unlockedDifficulty, 2);
  assert.equal(migrated.save.records.legacyPlayEvidence.length, 1);
  assert.equal(migrated.save.records.runsCleared, 0);
  assert.equal(migrated.save.coins, 0);
  assert.equal(applyCommand(migrated.save, { type: 'legacyMigration', records: [] }).error, 'legacy-migration-already-applied');
});

test('candidate v2 migration adds only the newly introduced export and RNG fields', () => {
  const current = createInitialSave();
  current.coins = 315;
  current.dog.energy = 47;
  const candidate = structuredClone(current);
  delete candidate.records.lastExportAt;
  delete candidate.raisingRng;
  const snapshot = structuredClone(candidate);
  const migrated = migrateCandidateSave(candidate);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.save.coins, 315);
  assert.equal(migrated.save.dog.energy, 47);
  assert.equal(migrated.save.records.lastExportAt, null);
  assert.deepEqual(migrated.save.raisingRng, { algorithm: 'xorshift32-v1', state: 0, drawCount: 0, idleMs: 0 });
  assert.deepEqual(candidate, snapshot);

  const malformed = structuredClone(candidate);
  malformed.unknown = true;
  assert.equal(migrateCandidateSave(malformed).ok, false);
  const invalidValue = structuredClone(candidate);
  invalidValue.coins = -4;
  assert.equal(migrateCandidateSave(invalidValue).ok, false);
});
