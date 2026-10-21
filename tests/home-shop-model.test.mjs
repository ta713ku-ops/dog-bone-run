import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game.js';
import { createRaisingCourse } from '../src/raising-course.js';
import { applyCommand, calculateRunRewardInput, createInitialSave, validateSave } from '../src/raising-model.js';
import { getHomeShopItem, HOME_SHOP_ITEMS, HOME_SHOP_SLOTS } from '../src/home-shop-catalog.js';
import {
  applyHomeShopCommand,
  createHomeShopSave,
  migrateHomeShopSave,
  validateHomeShopSave,
} from '../src/home-shop-model.js';

const RUN_ID = 'home-shop-run-00000001';
const command = (save, input) => applyHomeShopCommand(save, input);

test('catalog has thirteen items, premium room pricing, and one fixed decor slot', () => {
  assert.deepEqual(HOME_SHOP_SLOTS, ['room', 'rug', 'bed', 'toy', 'decor']);
  assert.deepEqual(HOME_SHOP_ITEMS.map(({ id, price, slot }) => ({ id, price, slot })), [
    { id: 'room-white', price: 0, slot: 'room' },
    { id: 'room-natural', price: 1_500, slot: 'room' },
    { id: 'room-playroom', price: 2_400, slot: 'room' },
    { id: 'room-luxe', price: 4_800, slot: 'room' },
    { id: 'room-garden', price: 3_200, slot: 'room' },
    { id: 'rug-oat', price: 120, slot: 'rug' },
    { id: 'rug-sage', price: 180, slot: 'rug' },
    { id: 'bed', price: 350, slot: 'bed' },
    { id: 'starterBall', price: 0, slot: 'toy' },
    { id: 'plush', price: 500, slot: 'toy' },
    { id: 'rope', price: 900, slot: 'toy' },
    { id: 'decor-plant', price: 650, slot: 'decor' },
    { id: 'decor-lantern', price: 800, slot: 'decor' },
  ]);
  assert.equal(HOME_SHOP_ITEMS.length, 13);
  assert.ok(HOME_SHOP_ITEMS.every(item => item.label && item.description && item.assetKey));
  assert.ok(HOME_SHOP_ITEMS.filter(item => item.slot === 'room' && item.price > 0).every(item => item.price > 900));
  assert.equal(Math.max(...HOME_SHOP_ITEMS.filter(item => item.slot !== 'room').map(item => item.price)), 900);
  assert.equal(getHomeShopItem('room-garden').price, 3_200);
  assert.equal(getHomeShopItem('decor-plant').price, 650);
  assert.equal(getHomeShopItem('decor-lantern').price, 800);
  assert.equal(getHomeShopItem('bed').slot, 'bed');
  assert.equal(getHomeShopItem('missing-item'), null);
});

test('new save keeps the legacy v2 wallet and adds a valid namespaced room shop', () => {
  const save = createHomeShopSave();
  assert.equal(save.schemaVersion, 2);
  assert.equal(save.coins, 0);
  assert.deepEqual(save.roomShop, {
    version: 1,
    owned: ['room-white', 'starterBall'],
    equipped: { room: 'room-white', rug: null, bed: null, toy: null, decor: null },
    activeWalk: null,
    settledRunIds: [],
    lastReward: null,
  });
  assert.deepEqual(validateHomeShopSave(save), { ok: true });
  const { roomShop, ...legacyBase } = save;
  assert.deepEqual(validateSave(legacyBase), { ok: true });
});

test('migration preserves the full legacy save and maps only supported legacy room items', () => {
  const legacy = createInitialSave();
  legacy.coins = 2_345;
  legacy.records.totalCoinsEarned = 4_321;
  legacy.records.totalCoinsSpent = 1_976;
  legacy.owned.toys.push('plush', 'rope', 'premiumBall');
  legacy.equipped.toy = 'rope';
  legacy.owned.decorations.push('bed', 'plant');
  legacy.equipped.bed = 'bed';
  legacy.equipped.decorations.push('plant');
  const legacyRun = applyCommand(legacy, {
    type: 'beginRun', runId: 'legacy-raising-run-00001', seed: 123, difficulty: 1, ownerEpoch: 4,
  });
  assert.equal(legacyRun.ok, true, legacyRun.error);
  Object.assign(legacy, legacyRun.save);
  assert.deepEqual(validateSave(legacy), { ok: true });
  const before = structuredClone(legacy);

  const migrated = migrateHomeShopSave(legacy);
  assert.equal(migrated.ok, true, migrated.error);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.save.coins, 2_345);
  assert.deepEqual(migrated.save.roomShop.owned, ['room-white', 'starterBall', 'bed', 'plush', 'rope']);
  assert.deepEqual(migrated.save.roomShop.equipped, { room: 'room-white', rug: null, bed: 'bed', toy: 'rope', decor: null });
  assert.deepEqual(migrated.save.activeRun, before.activeRun, 'a legacy raising run remains untouched');
  const { roomShop, ...migratedBase } = migrated.save;
  assert.deepEqual(migratedBase, before, 'migration leaves the prior raising data byte-for-byte equivalent as JSON');
  assert.deepEqual(legacy, before, 'migration does not mutate its input');
  assert.deepEqual(validateHomeShopSave(migrated.save), { ok: true });
});

test('legacy v1 roomShop validates unchanged, then initializes interiors without losing saved state', () => {
  const old = createHomeShopSave();
  old.coins = 777;
  old.records.totalCoinsSpent = 123;
  old.roomShop.owned = ['starterBall', 'bed', 'plush', 'rug-sage'];
  old.roomShop.equipped = { rug: 'rug-sage', bed: 'bed', toy: 'starterBall' };
  old.roomShop.activeWalk = {
    runId: RUN_ID, level: 2, seed: 45, ownerEpoch: 3, normalTotal: 4, goldTotal: 1,
  };
  old.roomShop.settledRunIds = ['settled-walk-00000001'];
  old.roomShop.lastReward = {
    runId: 'settled-walk-00000001', reward: 55, completed: true,
    normalCollected: 4, goldCollected: 1, level: 2,
  };
  delete old.roomShop.owned[old.roomShop.owned.indexOf('room-white')];
  old.roomShop.owned = old.roomShop.owned.filter(Boolean);
  delete old.roomShop.equipped.room;

  const legacySnapshot = structuredClone(old);
  assert.deepEqual(validateHomeShopSave(old), { ok: true }, 'the prior v1 namespace shape remains loadable');
  assert.deepEqual(old, legacySnapshot, 'validation does not rewrite a prior v1 save');

  const initialized = command(old, { type: 'initializeInteriors' });
  assert.equal(initialized.ok, true, initialized.error);
  assert.ok(initialized.save.roomShop.owned.includes('room-white'));
  assert.equal(initialized.save.roomShop.equipped.room, 'room-white');
  assert.equal(initialized.save.roomShop.equipped.decor, null);
  assert.equal(initialized.save.roomShop.equipped.toy, null, 'the old default ball is cleared once');
  assert.equal(initialized.save.roomShop.equipped.rug, 'rug-sage');
  assert.equal(initialized.save.roomShop.equipped.bed, 'bed');
  assert.equal(initialized.save.coins, old.coins);
  assert.deepEqual(initialized.save.records, old.records);
  assert.deepEqual(initialized.save.roomShop.activeWalk, old.roomShop.activeWalk);
  assert.deepEqual(initialized.save.roomShop.settledRunIds, old.roomShop.settledRunIds);
  assert.deepEqual(initialized.save.roomShop.lastReward, old.roomShop.lastReward);

  const repeated = command(initialized.save, { type: 'initializeInteriors' });
  assert.equal(repeated.ok, true, repeated.error);
  assert.equal(repeated.result.changed, false);
  assert.deepEqual(repeated.save, initialized.save);
});

test('legacy v1 without a room slot cannot bypass interior initialization through room purchases', () => {
  const legacy = createHomeShopSave();
  legacy.coins = 5_000;
  legacy.roomShop.owned = ['starterBall'];
  legacy.roomShop.equipped = { rug: null, bed: null, toy: 'starterBall' };
  const before = structuredClone(legacy);
  assert.deepEqual(validateHomeShopSave(legacy), { ok: true });

  for (const input of [
    { type: 'purchase', itemId: 'room-white', equip: true },
    { type: 'purchase', itemId: 'room-natural', equip: true },
    { type: 'purchase', itemId: 'room-natural', equip: false },
    { type: 'equip', itemId: 'room-white' },
    { type: 'purchase', itemId: 'decor-plant' },
    { type: 'equip', itemId: 'decor-plant' },
  ]) {
    const result = command(legacy, input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error, 'interiors-not-initialized', JSON.stringify(input));
    assert.deepEqual(result.save, before, JSON.stringify(input));
  }
  assert.deepEqual(legacy, before, 'rejected room commands do not mutate coins or saved equipment');
});

test('the former four-slot save adds decor without resetting its paid room, toy, or walk state', () => {
  const old = createHomeShopSave();
  old.coins = 4_321;
  old.records.totalCoinsSpent = 1_234;
  old.roomShop.owned.push('room-natural', 'rope');
  old.roomShop.equipped = { room: 'room-natural', rug: null, bed: null, toy: 'rope' };
  old.roomShop.activeWalk = {
    runId: RUN_ID, level: 2, seed: 45, ownerEpoch: 3, normalTotal: 4, goldTotal: 1,
  };
  old.roomShop.settledRunIds = ['settled-walk-00000001'];
  old.roomShop.lastReward = {
    runId: 'settled-walk-00000001', reward: 55, completed: true,
    normalCollected: 4, goldCollected: 1, level: 2,
  };
  const before = structuredClone(old);
  assert.deepEqual(validateHomeShopSave(old), { ok: true }, 'the current four-slot shape remains loadable');

  const initialized = command(old, { type: 'initializeInteriors' });
  assert.equal(initialized.ok, true, initialized.error);
  assert.deepEqual(initialized.save.roomShop.equipped, {
    room: 'room-natural', rug: null, bed: null, toy: 'rope', decor: null,
  });
  assert.equal(initialized.save.coins, before.coins);
  assert.deepEqual(initialized.save.records, before.records);
  assert.deepEqual(initialized.save.roomShop.activeWalk, before.roomShop.activeWalk);
  assert.deepEqual(initialized.save.roomShop.settledRunIds, before.roomShop.settledRunIds);
  assert.deepEqual(initialized.save.roomShop.lastReward, before.roomShop.lastReward);

  const repeated = command(initialized.save, { type: 'initializeInteriors' });
  assert.equal(repeated.ok, true, repeated.error);
  assert.equal(repeated.result.changed, false);
  assert.deepEqual(repeated.save, initialized.save);
});

test('interior initialization preserves previously chosen paid equipment and all unrelated save values', () => {
  const old = createHomeShopSave();
  old.coins = 6_789;
  old.roomShop.owned.push('room-natural', 'room-playroom', 'rope', 'rug-oat', 'bed');
  old.roomShop.equipped = { rug: 'rug-oat', bed: 'bed', toy: 'rope' };
  delete old.roomShop.equipped.room;
  delete old.roomShop.owned[old.roomShop.owned.indexOf('room-white')];
  old.roomShop.owned = old.roomShop.owned.filter(Boolean);
  const before = structuredClone(old);

  const initialized = command(old, { type: 'initializeInteriors' });
  assert.equal(initialized.ok, true, initialized.error);
  assert.equal(initialized.save.roomShop.equipped.toy, 'rope');
  assert.equal(initialized.save.roomShop.equipped.rug, 'rug-oat');
  assert.equal(initialized.save.roomShop.equipped.bed, 'bed');
  assert.equal(initialized.save.roomShop.equipped.room, 'room-white');
  const { roomShop: priorShop, ...priorBase } = before;
  const { roomShop: nextShop, ...nextBase } = initialized.save;
  assert.deepEqual(nextBase, priorBase);
  assert.deepEqual({ ...nextShop, owned: priorShop.owned, equipped: { ...nextShop.equipped, room: undefined, decor: undefined } }, {
    ...priorShop,
    equipped: { ...priorShop.equipped, room: undefined, decor: undefined },
  });
});

test('candidate migration first applies the narrow v2 normalizer and then adds room state', () => {
  const legacy = createInitialSave();
  legacy.coins = 876;
  delete legacy.records.lastExportAt;
  delete legacy.raisingRng;

  const migrated = migrateHomeShopSave(legacy);
  assert.equal(migrated.ok, true, migrated.error);
  assert.equal(migrated.save.coins, 876);
  assert.equal(migrated.save.records.lastExportAt, null);
  assert.deepEqual(migrated.save.raisingRng, { algorithm: 'xorshift32-v1', state: 0, drawCount: 0, idleMs: 0 });
  assert.equal(migrated.save.roomShop.equipped.toy, null, 'legacy default starterBall is not auto-equipped');
  assert.equal(migrated.save.roomShop.equipped.room, 'room-white');
  assert.deepEqual(validateHomeShopSave(migrated.save), { ok: true });
});

test('room purchases are atomic, require the full price, and room selection cannot be empty', () => {
  const poor = createHomeShopSave();
  poor.coins = 1_499;
  const before = structuredClone(poor);
  const insufficient = command(poor, { type: 'purchase', itemId: 'room-natural', equip: true });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.error, 'insufficient-coins');
  assert.deepEqual(insufficient.save, before);
  assert.deepEqual(poor, before);

  poor.coins = 4_800;
  const purchased = command(poor, { type: 'purchase', itemId: 'room-natural' });
  assert.equal(purchased.ok, true, purchased.error);
  assert.equal(purchased.save.coins, 3_300);
  assert.equal(purchased.save.records.totalCoinsSpent, 1_500);
  assert.equal(purchased.save.roomShop.equipped.room, 'room-white', 'purchase alone does not change the selected room');
  const selected = command(purchased.save, { type: 'equip', itemId: 'room-natural' });
  assert.equal(selected.ok, true, selected.error);
  assert.equal(selected.save.roomShop.equipped.room, 'room-natural');

  const duplicate = command(selected.save, { type: 'purchase', itemId: 'room-natural' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'item-already-owned');
  assert.deepEqual(duplicate.save, selected.save);

  const removed = command(selected.save, { type: 'equip', slot: 'room', itemId: null });
  assert.equal(removed.ok, false);
  assert.equal(removed.error, 'room-required');
  assert.deepEqual(removed.save, selected.save);
});

test('switching rooms keeps the selected rug, bed, toy, and wallet', () => {
  let save = createHomeShopSave();
  save.coins = 8_000;
  for (const itemId of ['room-natural', 'rug-sage', 'bed', 'rope']) {
    const purchased = command(save, { type: 'purchase', itemId, equip: itemId !== 'room-natural' });
    assert.equal(purchased.ok, true, purchased.error);
    save = purchased.save;
  }
  save = command(save, { type: 'equip', itemId: 'room-natural' }).save;
  const beforeSwitch = structuredClone(save);
  const switched = command(save, { type: 'equip', itemId: 'room-white' });
  assert.equal(switched.ok, true, switched.error);
  assert.equal(switched.save.roomShop.equipped.room, 'room-white');
  assert.deepEqual(switched.save.roomShop.equipped, {
    room: 'room-white', rug: 'rug-sage', bed: 'bed', toy: 'rope', decor: null,
  });
  assert.equal(switched.save.coins, beforeSwitch.coins);
  assert.equal(switched.save.records.totalCoinsSpent, beforeSwitch.records.totalCoinsSpent);
  assert.deepEqual(switched.save.roomShop.owned, beforeSwitch.roomShop.owned);
});

test('purchase atomically charges the wallet, owns the item, and equips only on request', () => {
  const save = createHomeShopSave();
  save.coins = 700;
  const purchased = command(save, { type: 'purchase', itemId: 'rug-sage', equip: true });
  assert.equal(purchased.ok, true, purchased.error);
  assert.equal(purchased.save.coins, 520);
  assert.equal(purchased.save.records.totalCoinsSpent, 180);
  assert.deepEqual(purchased.save.roomShop.owned, ['room-white', 'starterBall', 'rug-sage']);
  assert.equal(purchased.save.roomShop.equipped.rug, 'rug-sage');
  assert.deepEqual(validateHomeShopSave(purchased.save), { ok: true });

  const withoutAutoEquip = command(purchased.save, { type: 'purchase', itemId: 'bed' });
  assert.equal(withoutAutoEquip.ok, true, withoutAutoEquip.error);
  assert.equal(withoutAutoEquip.save.coins, 170);
  assert.equal(withoutAutoEquip.save.roomShop.equipped.bed, null);
  assert.ok(withoutAutoEquip.save.owned.decorations.includes('bed'), 'overlapping purchases remain compatible with v2 ownership');
});

test('decor purchases and equipment are atomic and preserve walk and reward records', () => {
  const poorPlant = createHomeShopSave();
  poorPlant.coins = 649;
  const poorPlantBefore = structuredClone(poorPlant);
  const plantInsufficient = command(poorPlant, { type: 'purchase', itemId: 'decor-plant', equip: true });
  assert.equal(plantInsufficient.ok, false);
  assert.equal(plantInsufficient.error, 'insufficient-coins');
  assert.deepEqual(plantInsufficient.save, poorPlantBefore);
  assert.deepEqual(poorPlant, poorPlantBefore);

  const poorLantern = createHomeShopSave();
  poorLantern.coins = 799;
  const poorLanternBefore = structuredClone(poorLantern);
  const lanternInsufficient = command(poorLantern, { type: 'purchase', itemId: 'decor-lantern' });
  assert.equal(lanternInsufficient.ok, false);
  assert.equal(lanternInsufficient.error, 'insufficient-coins');
  assert.deepEqual(lanternInsufficient.save, poorLanternBefore);

  let save = createHomeShopSave();
  save.coins = 1_500;
  save.records.totalCoinsEarned = 321;
  save.roomShop.activeWalk = {
    runId: RUN_ID, level: 2, seed: 45, ownerEpoch: 3, normalTotal: 4, goldTotal: 1,
  };
  save.roomShop.settledRunIds = ['settled-walk-00000001'];
  save.roomShop.lastReward = {
    runId: 'settled-walk-00000001', reward: 55, completed: true,
    normalCollected: 4, goldCollected: 1, level: 2,
  };
  const walkBefore = structuredClone(save.roomShop);

  const purchasedPlant = command(save, { type: 'purchase', itemId: 'decor-plant' });
  assert.equal(purchasedPlant.ok, true, purchasedPlant.error);
  assert.equal(purchasedPlant.save.coins, 850);
  assert.equal(purchasedPlant.save.records.totalCoinsSpent, 650);
  assert.equal(purchasedPlant.save.roomShop.equipped.decor, null, 'purchase does not auto-equip without a request');
  assert.deepEqual(purchasedPlant.save.roomShop.activeWalk, walkBefore.activeWalk);
  assert.deepEqual(purchasedPlant.save.roomShop.settledRunIds, walkBefore.settledRunIds);
  assert.deepEqual(purchasedPlant.save.roomShop.lastReward, walkBefore.lastReward);

  const equippedPlant = command(purchasedPlant.save, { type: 'equip', itemId: 'decor-plant' });
  assert.equal(equippedPlant.ok, true, equippedPlant.error);
  assert.equal(equippedPlant.save.roomShop.equipped.decor, 'decor-plant');
  const removedPlant = command(equippedPlant.save, { type: 'equip', slot: 'decor', itemId: null });
  assert.equal(removedPlant.ok, true, removedPlant.error);
  assert.equal(removedPlant.save.roomShop.equipped.decor, null);
  assert.ok(removedPlant.save.roomShop.owned.includes('decor-plant'), 'removal keeps ownership');
  assert.equal(removedPlant.save.coins, 850);
  assert.equal(removedPlant.save.records.totalCoinsSpent, 650);
  assert.deepEqual(removedPlant.save.roomShop.activeWalk, walkBefore.activeWalk);
  assert.deepEqual(removedPlant.save.roomShop.settledRunIds, walkBefore.settledRunIds);
  assert.deepEqual(removedPlant.save.roomShop.lastReward, walkBefore.lastReward);

  const duplicatePlant = command(removedPlant.save, { type: 'purchase', itemId: 'decor-plant' });
  assert.equal(duplicatePlant.ok, false);
  assert.equal(duplicatePlant.error, 'item-already-owned');
  assert.deepEqual(duplicatePlant.save, removedPlant.save);

  const purchasedLantern = command(removedPlant.save, { type: 'purchase', itemId: 'decor-lantern', equip: true });
  assert.equal(purchasedLantern.ok, true, purchasedLantern.error);
  assert.equal(purchasedLantern.save.coins, 50);
  assert.equal(purchasedLantern.save.records.totalCoinsSpent, 1_450);
  assert.equal(purchasedLantern.save.roomShop.equipped.decor, 'decor-lantern');
  assert.deepEqual(purchasedLantern.save.roomShop.activeWalk, walkBefore.activeWalk);
  assert.deepEqual(validateHomeShopSave(purchasedLantern.save), { ok: true });

  const duplicateLantern = command(purchasedLantern.save, { type: 'purchase', itemId: 'decor-lantern' });
  assert.equal(duplicateLantern.ok, false);
  assert.equal(duplicateLantern.error, 'item-already-owned');
  assert.deepEqual(duplicateLantern.save, purchasedLantern.save);
});

test('insufficient funds and duplicate purchases leave the save untouched', () => {
  const save = createHomeShopSave();
  save.coins = 119;
  const before = structuredClone(save);
  const insufficient = command(save, { type: 'purchase', itemId: 'rug-oat' });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.error, 'insufficient-coins');
  assert.deepEqual(insufficient.save, before);
  assert.deepEqual(save, before);

  save.coins = 120;
  const purchased = command(save, { type: 'purchase', itemId: 'rug-oat' });
  assert.equal(purchased.ok, true);
  const duplicate = command(purchased.save, { type: 'purchase', itemId: 'rug-oat' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'item-already-owned');
  assert.deepEqual(duplicate.save, purchased.save);
});

test('fixed slots allow replacement and removal but reject unowned or mismatched items', () => {
  let save = createHomeShopSave();
  save.coins = 2_000;
  for (const itemId of ['rug-oat', 'rug-sage', 'bed', 'plush']) {
    const item = command(save, { type: 'purchase', itemId });
    assert.equal(item.ok, true, item.error);
    save = item.save;
  }

  save = command(save, { type: 'equip', itemId: 'rug-oat' }).save;
  save = command(save, { type: 'equip', itemId: 'rug-sage' }).save;
  save = command(save, { type: 'equip', itemId: 'bed' }).save;
  save = command(save, { type: 'equip', itemId: 'plush' }).save;
  assert.deepEqual(save.roomShop.equipped, { room: 'room-white', rug: 'rug-sage', bed: 'bed', toy: 'plush', decor: null });

  const removed = command(save, { type: 'equip', slot: 'rug', itemId: null });
  assert.equal(removed.ok, true);
  assert.equal(removed.save.roomShop.equipped.rug, null);
  assert.equal(command(save, { type: 'equip', itemId: 'rope' }).error, 'item-not-owned');
  assert.equal(command(save, { type: 'equip', slot: 'bed', itemId: 'rug-oat' }).error, 'item-slot-mismatch');
  assert.deepEqual(validateHomeShopSave(removed.save), { ok: true });
});

test('settlement uses current game course totals, rejects a foreign epoch, and credits a run once', () => {
  const game = new Game({ phase: 4, walkLevel: 2, seed: 123 });
  const normalTotal = game.course.filter(bone => bone.kind !== 'gold').length;
  const goldTotal = game.course.filter(bone => bone.kind === 'gold').length;
  const raisingCourse = createRaisingCourse(game.seed, game.walkLevel);
  const raisingNormalTotal = raisingCourse.bones.filter(bone => bone.kind !== 'gold').length;
  const raisingGoldTotal = raisingCourse.bones.filter(bone => bone.kind === 'gold').length;
  assert.ok(normalTotal > raisingNormalTotal || goldTotal > raisingGoldTotal);

  const runId = RUN_ID;
  let save = createHomeShopSave();
  const started = command(save, {
    type: 'beginWalk', runId, level: game.walkLevel, seed: game.seed, ownerEpoch: 7,
    normalTotal, goldTotal,
  });
  assert.equal(started.ok, true, started.error);
  save = started.save;
  const beforeRejectedSettlement = structuredClone(save);

  const foreign = command(save, {
    type: 'settleWalk', runId, normalCollected: normalTotal, goldCollected: goldTotal,
    completed: true, ownerEpoch: 8,
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error, 'foreign-owner-epoch');
  assert.deepEqual(foreign.save, beforeRejectedSettlement);
  assert.deepEqual(save, beforeRejectedSettlement, 'failed settlement is retryable and does not mutate the input');

  const expected = calculateRunRewardInput({
    normalCollected: normalTotal,
    goldCollected: goldTotal,
    completed: true,
    difficulty: game.walkLevel,
    course: { bones: game.course },
  });
  const raisingBoundExpected = calculateRunRewardInput({
    normalCollected: normalTotal,
    goldCollected: goldTotal,
    completed: true,
    difficulty: game.walkLevel,
    course: { bones: raisingCourse.bones },
  });
  assert.ok(expected.reward > raisingBoundExpected.reward, 'the selected runner course has a larger clear bound');

  const settled = command(save, {
    type: 'settleWalk', runId, normalCollected: normalTotal, goldCollected: goldTotal,
    completed: true, ownerEpoch: 7,
  });
  assert.equal(settled.ok, true, settled.error);
  assert.equal(settled.result.reward, expected.reward);
  assert.equal(settled.save.coins, expected.reward);
  assert.equal(settled.save.records.totalCoinsEarned, expected.reward);
  assert.equal(settled.save.roomShop.activeWalk, null);
  assert.deepEqual(settled.save.roomShop.lastReward, {
    runId, reward: expected.reward, completed: true,
    normalCollected: normalTotal, goldCollected: goldTotal, level: 2,
  });

  const duplicate = command(settled.save, {
    type: 'settleWalk', runId, normalCollected: normalTotal, goldCollected: goldTotal,
    completed: true, ownerEpoch: 7,
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.result.reward, expected.reward);
  assert.equal(duplicate.save.coins, settled.save.coins);
  assert.deepEqual(duplicate.save, settled.save);
});

test('a retained reward resumes only its matching active walk under a newer lease epoch', () => {
  const normalCollected = 4;
  let save = command(createHomeShopSave(), {
    type: 'beginWalk', runId: RUN_ID, level: 2, seed: 321, ownerEpoch: 10,
    normalTotal: 5, goldTotal: 1,
  }).save;
  const beforeResume = structuredClone(save);

  const wrongRun = command(save, { type: 'resumeWalk', runId: 'other-home-shop-run-00001', ownerEpoch: 11 });
  assert.equal(wrongRun.ok, false);
  assert.equal(wrongRun.error, 'active-walk-mismatch');
  assert.deepEqual(wrongRun.save, beforeResume);

  const olderEpoch = command(save, { type: 'resumeWalk', runId: RUN_ID, ownerEpoch: 9 });
  assert.equal(olderEpoch.ok, false);
  assert.equal(olderEpoch.error, 'stale-owner-epoch');
  assert.deepEqual(olderEpoch.save, beforeResume);

  const resumed = command(save, { type: 'resumeWalk', runId: RUN_ID, ownerEpoch: 11 });
  assert.equal(resumed.ok, true, resumed.error);
  assert.deepEqual(resumed.save.roomShop.activeWalk, { ...beforeResume.roomShop.activeWalk, ownerEpoch: 11 });
  assert.equal(resumed.result.resumed, true);

  const oldEpochSettlement = command(resumed.save, {
    type: 'settleWalk', runId: RUN_ID, normalCollected, goldCollected: 1,
    completed: true, ownerEpoch: 10,
  });
  assert.equal(oldEpochSettlement.ok, false);
  assert.equal(oldEpochSettlement.error, 'foreign-owner-epoch');
  assert.deepEqual(oldEpochSettlement.save, resumed.save);

  const settled = command(resumed.save, {
    type: 'settleWalk', runId: RUN_ID, normalCollected, goldCollected: 1,
    completed: true, ownerEpoch: 11,
  });
  assert.equal(settled.ok, true, settled.error);
  assert.equal(settled.result.reward > 0, true);
  assert.equal(settled.save.roomShop.activeWalk, null);
  assert.equal(settled.save.roomShop.lastReward.runId, RUN_ID);

  const repeatedResume = command(settled.save, { type: 'resumeWalk', runId: RUN_ID, ownerEpoch: 12 });
  assert.equal(repeatedResume.ok, false);
  assert.equal(repeatedResume.error, 'active-walk-mismatch');
  assert.deepEqual(repeatedResume.save, settled.save);
});

test('cancelled walks settle for zero and cannot later be credited', () => {
  let save = createHomeShopSave();
  const started = command(save, {
    type: 'beginWalk', runId: RUN_ID, level: 1, seed: 20, ownerEpoch: 2,
    normalTotal: 3, goldTotal: 0,
  });
  assert.equal(started.ok, true);
  save = started.save;
  const cancelled = command(save, { type: 'cancelWalk', runId: RUN_ID, ownerEpoch: 2 });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.save.roomShop.activeWalk, null);
  assert.equal(cancelled.save.coins, 0);
  const late = command(cancelled.save, {
    type: 'settleWalk', runId: RUN_ID, normalCollected: 3, goldCollected: 0,
    completed: true, ownerEpoch: 2,
  });
  assert.equal(late.ok, true);
  assert.equal(late.result.duplicate, true);
  assert.equal(late.result.reward, 0);
  assert.equal(late.save.coins, 0);
});

test('bounded settlement history retains the latest reward idempotency key', () => {
  let save = createHomeShopSave();
  save = command(save, {
    type: 'beginWalk', runId: RUN_ID, level: 1, seed: 1, ownerEpoch: 0,
    normalTotal: 1, goldTotal: 0,
  }).save;
  save = command(save, {
    type: 'settleWalk', runId: RUN_ID, normalCollected: 1, goldCollected: 0,
    completed: true, ownerEpoch: 0,
  }).save;
  const coinsAfterReward = save.coins;

  for (let index = 0; index < 128; index++) {
    const runId = `cancelled-run-${String(index).padStart(8, '0')}`;
    save = command(save, {
      type: 'beginWalk', runId, level: 1, seed: index, ownerEpoch: 0,
      normalTotal: 1, goldTotal: 0,
    }).save;
    save = command(save, { type: 'cancelWalk', runId, ownerEpoch: 0 }).save;
  }

  assert.equal(save.roomShop.settledRunIds.length, 128);
  assert.equal(save.roomShop.settledRunIds.includes(RUN_ID), false);
  assert.deepEqual(validateHomeShopSave(save), { ok: true });
  const duplicate = command(save, {
    type: 'settleWalk', runId: RUN_ID, normalCollected: 1, goldCollected: 0,
    completed: true, ownerEpoch: 0,
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.save.coins, coinsAfterReward);
});

test('validator rejects malformed extension data while accepting the legacy base only through the wrapper', () => {
  const valid = createHomeShopSave();
  const invalidSlot = structuredClone(valid);
  invalidSlot.roomShop.equipped.rug = 'bed';
  assert.equal(validateHomeShopSave(invalidSlot).ok, false);

  const emptyRoom = structuredClone(valid);
  emptyRoom.roomShop.equipped.room = null;
  assert.equal(validateHomeShopSave(emptyRoom).ok, false);

  const unownedRoom = structuredClone(valid);
  unownedRoom.roomShop.equipped.room = 'room-natural';
  assert.equal(validateHomeShopSave(unownedRoom).ok, false);

  const unknownSlot = structuredClone(valid);
  unknownSlot.roomShop.equipped.shelf = null;
  assert.equal(validateHomeShopSave(unknownSlot).ok, false, 'only the exact supported slot shapes are accepted');

  const missingFreeRoom = structuredClone(valid);
  missingFreeRoom.roomShop.owned = ['starterBall'];
  assert.equal(validateHomeShopSave(missingFreeRoom).ok, false);

  const invalidActive = structuredClone(valid);
  invalidActive.roomShop.activeWalk = {
    runId: 'short', level: 1, seed: 1, ownerEpoch: 0, normalTotal: 1, goldTotal: 0,
  };
  assert.equal(validateHomeShopSave(invalidActive).ok, false);

  const unknown = { ...valid, roomShop: valid.roomShop, unexpected: true };
  assert.equal(validateHomeShopSave(unknown).ok, false);
  assert.equal(validateSave(valid).ok, false, 'the old v2 validator still rejects the namespaced extension');
});
