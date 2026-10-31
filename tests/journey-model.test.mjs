import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getJourneyDiscovery,
  getJourneyRoute,
  JOURNEY_PLACES,
  JOURNEY_ROUTES,
} from '../src/journey-catalog.js';
import {
  applyHomeShopCommand,
  createHomeShopSave,
  JOURNEY_STARTER_AWARDS,
  migrateHomeShopSave,
  validateHomeShopSave,
} from '../src/home-shop-model.js';
import { createInitialSave } from '../src/raising-model.js';

const MAX_COINS = 1_000_000_000;
const RUN_ID = index => `journey-run-${String(index).padStart(8, '0')}`;
const apply = (save, command) => applyHomeShopCommand(save, command);
const initialized = () => {
  const result = apply(createHomeShopSave(), { type: 'initializeJourney' });
  assert.equal(result.ok, true, result.error);
  return result.save;
};
const start = (save, { runId = RUN_ID(1), routeId = 'street-1', mode, ownerEpoch = 7,
  normalTotal = 20, goldTotal = 2 } = {}) => {
  const route = getJourneyRoute(routeId);
  return apply(save, {
    type: 'beginWalk', runId, routeId, mode, level: route.level, seed: route.seed,
    ownerEpoch, normalTotal, goldTotal,
  });
};
const settle = (save, { runId = RUN_ID(1), ownerEpoch = 7, discoveryIds = [], completed = true,
  completedAt = '2026-10-29T03:00:00.000Z' } = {}) => apply(save, {
  type: 'settleWalk', runId, normalCollected: 20, goldCollected: 2,
  completed, ownerEpoch, discoveryIds, completedAt,
});

test('journey catalog contains twelve authored routes and thirty-six distinct timed discoveries', () => {
  assert.deepEqual(JOURNEY_PLACES.map(place => [place.id, place.level]), [
    ['street', 1], ['park', 2], ['mountain', 3], ['cave', 4],
  ]);
  assert.equal(JOURNEY_ROUTES.length, 12);
  assert.deepEqual(JOURNEY_ROUTES.map(route => route.id), [
    'street-1', 'street-2', 'street-3', 'park-1', 'park-2', 'park-3',
    'mountain-1', 'mountain-2', 'mountain-3', 'cave-1', 'cave-2', 'cave-3',
  ]);
  const allDiscoveries = JOURNEY_ROUTES.flatMap(route => route.discoveries);
  assert.equal(allDiscoveries.length, 36);
  assert.equal(new Set(allDiscoveries.map(item => item.id)).size, 36);
  for (const route of JOURNEY_ROUTES) {
    assert.ok(route.title && route.description);
    assert.ok(Number.isSafeInteger(route.seed) && route.seed >= 0 && route.seed <= 0xffff_ffff);
    assert.equal(route.discoveries.length, 3);
    assert.ok(route.discoveries.every(item => Number.isFinite(item.timeMs) && item.timeMs > 0));
    assert.ok(route.discoveries[0].timeMs < route.discoveries[1].timeMs
      && route.discoveries[1].timeMs < route.discoveries[2].timeMs,
    'the authored encounters stay in temporal order');
    assert.equal(route.discoveries[0].lane, 0, 'the first encounter stays in the center lane');
    assert.deepEqual(route.discoveries.slice(1).map(item => item.lane).sort(), [-1, 1]);
    for (const item of route.discoveries) {
      assert.ok(item.title && item.description && item.kind);
      assert.equal(getJourneyDiscovery(item.id), item);
    }
    assert.equal(getJourneyRoute(route.id), route);
  }
  assert.equal(getJourneyRoute('missing'), null);
  assert.equal(getJourneyDiscovery('missing'), null);
});

test('journey state is opt-in and initialization is additive, idempotent, and migration-safe', () => {
  const prior = createHomeShopSave();
  const before = structuredClone(prior);
  assert.deepEqual(validateHomeShopSave(prior), { ok: true });
  assert.equal(Object.hasOwn(prior.roomShop, 'journey'), false);

  const first = apply(prior, { type: 'initializeJourney' });
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(first.save.roomShop.journey, {
    version: 1, discoveryIds: [], completedRoutes: [], completedRuns: 0,
    life: {
      version: 1, memories: {}, routeVisits: {}, lastRouteId: null, lastDiscoveryId: null,
      firstWalkAt: null, lastWalkAt: null, tutorialComplete: false, named: false,
      homePlays: { pet: 0, starterBall: 0, plush: 0, rope: 0, bed: 0 },
    },
  });
  assert.deepEqual(first.save.coins, prior.coins);
  assert.deepEqual(first.save.records, prior.records);
  const { journey, ...firstRoomShop } = first.save.roomShop;
  const { roomShop, ...firstBase } = first.save;
  const { roomShop: originalRoomShop, ...originalBase } = before;
  assert.deepEqual(firstRoomShop, originalRoomShop);
  assert.deepEqual(firstBase, originalBase);
  assert.deepEqual(prior, before, 'initialization does not mutate a legacy save');

  const repeated = apply(first.save, { type: 'initializeJourney' });
  assert.equal(repeated.ok, true, repeated.error);
  assert.equal(repeated.result.changed, false);
  assert.deepEqual(repeated.save, first.save);

  const legacy = createInitialSave();
  legacy.coins = 900;
  const migrated = migrateHomeShopSave(legacy);
  assert.equal(migrated.ok, true, migrated.error);
  assert.equal(Object.hasOwn(migrated.save.roomShop, 'journey'), false,
    'migration keeps old saves on their prior shape until explicit initialization');
  const migratedJourney = apply(migrated.save, { type: 'initializeJourney' });
  assert.equal(migratedJourney.ok, true, migratedJourney.error);
  assert.equal(migratedJourney.save.coins, 900);

  const legacyV1 = createHomeShopSave();
  legacyV1.roomShop.activeWalk = {
    runId: RUN_ID(90), level: 1, seed: 4, ownerEpoch: 1, normalTotal: 20, goldTotal: 2,
  };
  assert.deepEqual(validateHomeShopSave(legacyV1), { ok: true }, 'pre-journey active walk shape remains valid');
});

test('journey namespace and active route metadata reject malformed or inconsistent saved data', () => {
  const valid = initialized();
  const badVersion = structuredClone(valid);
  badVersion.roomShop.journey.version = 2;
  assert.equal(validateHomeShopSave(badVersion).ok, false);

  const unknownDiscovery = structuredClone(valid);
  unknownDiscovery.roomShop.journey.discoveryIds = ['other-route-discovery'];
  assert.equal(validateHomeShopSave(unknownDiscovery).ok, false);

  const duplicateDiscovery = structuredClone(valid);
  duplicateDiscovery.roomShop.journey.discoveryIds = ['street-1-bakery', 'street-1-bakery'];
  assert.equal(validateHomeShopSave(duplicateDiscovery).ok, false);

  const impossibleRuns = structuredClone(valid);
  impossibleRuns.roomShop.journey.completedRoutes = ['street-1', 'park-1'];
  impossibleRuns.roomShop.journey.completedRuns = 1;
  assert.equal(validateHomeShopSave(impossibleRuns).ok, false);
  const noCompletedRoute = structuredClone(valid);
  noCompletedRoute.roomShop.journey.completedRuns = 1;
  assert.equal(validateHomeShopSave(noCompletedRoute).ok, false);

  const unknownRoute = structuredClone(valid);
  unknownRoute.roomShop.journey.completedRoutes = ['other-route'];
  assert.equal(validateHomeShopSave(unknownRoute).ok, false);

  const started = start(valid);
  assert.equal(started.ok, true, started.error);
  const wrongLevel = structuredClone(started.save);
  wrongLevel.roomShop.activeWalk.level = 2;
  assert.equal(validateHomeShopSave(wrongLevel).ok, false);
  const badMode = structuredClone(started.save);
  badMode.roomShop.activeWalk.mode = 'speed';
  assert.equal(validateHomeShopSave(badMode).ok, false);
  const missingJourney = structuredClone(started.save);
  delete missingJourney.roomShop.journey;
  assert.equal(validateHomeShopSave(missingJourney).ok, false);
});

test('malformed journey namespaces and retained receipts return invalid-save instead of throwing', () => {
  let save = start(initialized()).save;
  save = settle(save, { discoveryIds: ['street-1-bakery'] }).save;
  assert.equal(validateHomeShopSave(save).ok, true);

  for (const malformed of [null, 'bad', 7, [], { version: 1 }]) {
    const invalidNamespace = structuredClone(save);
    invalidNamespace.roomShop.journey = malformed;
    assert.doesNotThrow(() => validateHomeShopSave(invalidNamespace));
    assert.equal(validateHomeShopSave(invalidNamespace).ok, false,
      `reject malformed namespace ${JSON.stringify(malformed)}`);
  }

  for (const malformed of [null, 'bad', 7, [], { routeId: 'street-1' }]) {
    const invalidReceipt = structuredClone(save);
    invalidReceipt.roomShop.lastReward.journey = malformed;
    assert.doesNotThrow(() => validateHomeShopSave(invalidReceipt));
    assert.equal(validateHomeShopSave(invalidReceipt).ok, false,
      `reject malformed receipt ${JSON.stringify(malformed)}`);
  }
});

test('beginWalk requires an initialized matching route and keeps mode independent of place', () => {
  const base = createHomeShopSave();
  const before = structuredClone(base);
  const uninitialized = start(base);
  assert.equal(uninitialized.ok, false);
  assert.equal(uninitialized.error, 'journey-not-initialized');
  assert.deepEqual(uninitialized.save, before);

  const save = initialized();
  const wrongLevel = apply(save, {
    type: 'beginWalk', runId: RUN_ID(1), routeId: 'park-1', mode: 'calm', level: 1,
    seed: 22, ownerEpoch: 7, normalTotal: 20, goldTotal: 2,
  });
  assert.equal(wrongLevel.ok, false);
  assert.equal(wrongLevel.error, 'invalid-journey-walk');
  const badMode = start(save, { mode: 'rush' });
  assert.equal(badMode.ok, false);
  assert.equal(badMode.error, 'invalid-journey-walk');
  const modeWithoutRoute = apply(save, {
    type: 'beginWalk', runId: RUN_ID(2), mode: 'challenge', level: 1, seed: 2,
    ownerEpoch: 7, normalTotal: 20, goldTotal: 2,
  });
  assert.equal(modeWithoutRoute.ok, false);
  assert.equal(modeWithoutRoute.error, 'invalid-journey-mode');

  const omittedMode = start(save, { routeId: 'park-2', mode: undefined, runId: RUN_ID(3) });
  assert.equal(omittedMode.ok, true, omittedMode.error);
  assert.equal(omittedMode.result.mode, 'calm');
  assert.deepEqual(omittedMode.save.roomShop.activeWalk, {
    runId: RUN_ID(3), level: 2, seed: getJourneyRoute('park-2').seed, ownerEpoch: 7,
    normalTotal: 20, goldTotal: 2, routeId: 'park-2', mode: 'calm',
  });

  const cancelled = apply(omittedMode.save, { type: 'cancelWalk', runId: RUN_ID(3), ownerEpoch: 7 });
  const challenge = start(cancelled.save, { routeId: 'park-2', mode: 'challenge', runId: RUN_ID(4) });
  assert.equal(challenge.ok, true, challenge.error);
  assert.equal(challenge.result.mode, 'challenge');
  assert.equal(challenge.save.roomShop.activeWalk.level, 2);

  const classic = apply(cancelled.save, {
    type: 'beginWalk', runId: RUN_ID(5), routeId: null, mode: 'calm', level: 1,
    seed: 3, ownerEpoch: 7, normalTotal: 20, goldTotal: 2,
  });
  assert.equal(classic.ok, true, classic.error);
  assert.deepEqual(Object.keys(classic.save.roomShop.activeWalk).sort(), [
    'goldTotal', 'level', 'normalTotal', 'ownerEpoch', 'runId', 'seed',
  ]);
});

test('journey settlement validates route discoveries and canonical dates before changing wallet or album', () => {
  let save = start(initialized()).save;
  const before = structuredClone(save);
  for (const discoveryIds of [
    ['park-1-clover'],
    ['street-1-bakery', 'street-1-bakery'],
    ['not-a-discovery'],
    ['street-1-bakery', 'street-1-sign', 'street-1-sparrow', 'street-1-extra'],
  ]) {
    const invalid = settle(save, { discoveryIds });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error, 'invalid-journey-discoveries');
    assert.deepEqual(invalid.save, before);
    assert.deepEqual(save, before, 'rejected input leaves the active walk untouched');
  }

  const invalidDate = settle(save, { discoveryIds: ['street-1-bakery'], completedAt: '2026-02-30T00:00:00.000Z' });
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidDate.error, 'invalid-settlement');
  assert.deepEqual(invalidDate.save, before);
  const nonCanonicalDate = settle(save, { discoveryIds: ['street-1-bakery'], completedAt: '2026-10-29' });
  assert.equal(nonCanonicalDate.ok, false);
  assert.equal(nonCanonicalDate.error, 'invalid-settlement');
  assert.deepEqual(nonCanonicalDate.save, before);

  const discoveryIds = JOURNEY_ROUTES[0].discoveries.map(item => item.id);
  const settled = settle(save, { discoveryIds });
  assert.equal(settled.ok, true, settled.error);
  const summary = settled.result.journey;
  assert.deepEqual(summary.runDiscoveryIds, discoveryIds);
  assert.deepEqual(summary.newDiscoveryIds, discoveryIds);
  assert.deepEqual(summary.discoveryIds, discoveryIds);
  assert.deepEqual(summary.completedRoutes, ['street-1']);
  assert.equal(summary.completedRuns, 1);
  assert.equal(summary.starterCoins, JOURNEY_STARTER_AWARDS[0]);
  assert.equal(summary.discoveryCoins, 15);
  assert.equal(summary.bonusCoins, summary.starterCoins + summary.discoveryCoins);
  assert.equal(summary.completedAt, '2026-10-29T03:00:00.000Z');
  assert.equal(settled.result.reward, 43 + summary.bonusCoins,
    'the existing level-one full-clear reward is preserved and bonuses are added');
  assert.equal(settled.save.coins, settled.result.reward);
  assert.equal(settled.save.records.totalCoinsEarned, settled.result.reward);
  assert.equal(settled.save.roomShop.activeWalk, null);
  assert.deepEqual(settled.save.roomShop.journey.discoveryIds, discoveryIds);
  assert.deepEqual(settled.save.roomShop.journey.completedRoutes, ['street-1']);
  assert.equal(validateHomeShopSave(settled.save).ok, true);

  const invalidReceipt = structuredClone(settled.save);
  invalidReceipt.roomShop.lastReward.journey.completedAt = 'not-a-date';
  assert.equal(validateHomeShopSave(invalidReceipt).ok, false);
  const wrongReceiptLevel = structuredClone(settled.save);
  wrongReceiptLevel.roomShop.lastReward.level = 2;
  assert.equal(validateHomeShopSave(wrongReceiptLevel).ok, false);
});

test('journey bonuses are one-time, discovery IDs cannot be replayed, and settlement is idempotent', () => {
  let save = start(initialized()).save;
  const discoveries = JOURNEY_ROUTES[0].discoveries.map(item => item.id);
  const first = settle(save, { discoveryIds: discoveries });
  assert.equal(first.ok, true, first.error);
  save = first.save;
  const priorCoins = save.coins;

  const duplicate = settle(save, { discoveryIds: ['park-1-clover'] });
  assert.equal(duplicate.ok, true, duplicate.error);
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.result.reward, first.result.reward);
  assert.deepEqual(duplicate.result.journey, first.result.journey,
    'a changed duplicate payload replays the original receipt, not new awards');
  assert.equal(duplicate.save.coins, priorCoins);
  assert.deepEqual(duplicate.save, save);

  const secondStart = start(save, { runId: RUN_ID(2), routeId: 'street-1' });
  assert.equal(secondStart.ok, true, secondStart.error);
  const second = settle(secondStart.save, { runId: RUN_ID(2), discoveryIds: discoveries });
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(second.result.journey.newDiscoveryIds, []);
  assert.equal(second.result.journey.discoveryCoins, 0);
  assert.equal(second.result.journey.starterCoins, JOURNEY_STARTER_AWARDS[1]);
  assert.equal(second.save.roomShop.journey.completedRuns, 2);
  assert.equal(second.save.roomShop.journey.discoveryIds.length, 3);
  assert.deepEqual(second.save.roomShop.journey.completedRoutes, ['street-1']);
});

test('cancelled or failed journey walks do not consume completion awards; only new discoveries pay once', () => {
  let save = initialized();
  let started = start(save, { runId: RUN_ID(10) });
  assert.equal(started.ok, true, started.error);
  const cancelled = apply(started.save, { type: 'cancelWalk', runId: RUN_ID(10), ownerEpoch: 7 });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.save.roomShop.journey.completedRuns, 0);
  assert.deepEqual(cancelled.save.roomShop.journey.discoveryIds, []);
  assert.equal(cancelled.save.coins, 0);

  started = start(cancelled.save, { runId: RUN_ID(11) });
  const partial = settle(started.save, {
    runId: RUN_ID(11), discoveryIds: ['street-1-bakery'], completed: false,
  });
  assert.equal(partial.ok, true, partial.error);
  assert.equal(partial.result.journey.starterCoins, 0);
  assert.equal(partial.result.journey.completedRuns, 0);
  assert.equal(partial.result.journey.discoveryCoins, 5);
  assert.deepEqual(partial.result.journey.discoveryIds, ['street-1-bakery']);

  started = start(partial.save, { runId: RUN_ID(12) });
  const completed = settle(started.save, {
    runId: RUN_ID(12), discoveryIds: ['street-1-bakery'], completed: true,
  });
  assert.equal(completed.ok, true, completed.error);
  assert.equal(completed.result.journey.starterCoins, JOURNEY_STARTER_AWARDS[0]);
  assert.equal(completed.result.journey.discoveryCoins, 0);
  assert.equal(completed.result.journey.completedRuns, 1);
});

test('journey awards cap at wallet capacity and the first six completed trips reach both furniture targets', () => {
  let capped = initialized();
  capped.coins = MAX_COINS - 10;
  let started = start(capped, { runId: RUN_ID(20) });
  const cappedResult = settle(started.save, {
    runId: RUN_ID(20), discoveryIds: JOURNEY_ROUTES[0].discoveries.map(item => item.id),
  });
  assert.equal(cappedResult.ok, true, cappedResult.error);
  assert.equal(cappedResult.save.coins, MAX_COINS);
  assert.equal(cappedResult.result.reward, 10);
  assert.equal(cappedResult.result.journey.bonusCoins, 0);
  assert.equal(cappedResult.save.records.totalCoinsEarned, 10);

  let save = initialized();
  for (let index = 0; index < 6; index++) {
    const routeId = ['street-1', 'street-1', 'street-2', 'park-1', 'mountain-1', 'cave-1'][index];
    started = start(save, { runId: RUN_ID(30 + index), routeId });
    assert.equal(started.ok, true, started.error);
    const discoveries = getJourneyRoute(routeId).discoveries.map(item => item.id);
    const completed = settle(started.save, { runId: RUN_ID(30 + index), discoveryIds: discoveries });
    assert.equal(completed.ok, true, completed.error);
    save = completed.save;
    if (index === 5) {
      assert.equal(save.roomShop.lastReward.journey.starterCoins, 380);
      assert.deepEqual(validateHomeShopSave(save), { ok: true }, 'the former maximum award remains a valid receipt');
    }
    if (index === 0) {
      assert.ok(save.coins >= 120, `first trip provides the 120-coin rug: ${save.coins}`);
      const rug = apply(save, { type: 'purchase', itemId: 'rug-oat', equip: true });
      assert.equal(rug.ok, true, rug.error);
      save = rug.save;
    }
  }
  assert.equal(save.roomShop.journey.completedRuns, 6);
  assert.ok(save.coins >= 1_500, `natural room is affordable after six completed trips: ${save.coins}`);
  const room = apply(save, { type: 'purchase', itemId: 'room-natural', equip: true });
  assert.equal(room.ok, true, room.error);
  assert.equal(room.save.roomShop.equipped.room, 'room-natural');
  assert.ok(room.save.coins >= 0);
  assert.deepEqual(JOURNEY_STARTER_AWARDS.length, 6);
});
