import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_JOURNEY_ROUTES, EXTRA_JOURNEY_ROUTES, JOURNEY_ROUTES, getJourneyRoute } from '../src/journey-catalog.js';
import {
  applyHomeShopCommand,
  createHomeShopSave,
  JOURNEY_REPEAT_AWARDS,
  JOURNEY_STARTER_AWARDS,
  validateHomeShopSave,
} from '../src/home-shop-model.js';
import {
  getDogName,
  getFavouriteRoute,
  getHomeMemoryMessage,
  getJourneyLife,
  recommendJourneyRoute,
} from '../src/journey-life.js';

const RUN_ID = index => `life-run-${String(index).padStart(8, '0')}`;
const apply = (save, command) => applyHomeShopCommand(save, command);
const initialized = () => {
  const result = apply(createHomeShopSave(), { type: 'initializeJourney' });
  assert.equal(result.ok, true, result.error);
  return result.save;
};

function start(save, runId, routeId = 'street-1') {
  const route = getJourneyRoute(routeId);
  const result = apply(save, {
    type: 'beginWalk', runId, routeId, level: route.level, seed: route.seed,
    mode: 'calm', ownerEpoch: 7, normalTotal: 20, goldTotal: 2,
  });
  assert.equal(result.ok, true, result.error);
  return result.save;
}

function settle(save, options = {}) {
  const { completedAt, ...rest } = options;
  return apply(save, {
    runId: RUN_ID(1), normalCollected: 20, goldCollected: 2,
    completed: true, ownerEpoch: 7, discoveryIds: [], ...rest,
    ...(completedAt === undefined ? {} : { completedAt }),
    type: 'settleWalk',
  });
}

test('initializeJourney upgrades old journey facts with null dates and never mutates the old save', () => {
  const old = createHomeShopSave();
  old.roomShop.journey = {
    version: 1,
    discoveryIds: ['street-1-bakery', 'park-1-clover', 'dusk-1-sunset'],
    completedRoutes: ['street-1', 'dusk-1'],
    completedRuns: 2,
  };
  assert.deepEqual(validateHomeShopSave(old), { ok: true });
  const before = structuredClone(old);

  const upgraded = apply(old, { type: 'initializeJourney' });
  assert.equal(upgraded.ok, true, upgraded.error);
  assert.deepEqual(old, before, 'upgrade is copy-on-write');
  assert.deepEqual(upgraded.save.roomShop.journey, {
    ...before.roomShop.journey,
    life: {
      version: 1,
      memories: {
        'street-1-bakery': { firstSeenAt: null, lastSeenAt: null, visits: 1, reaction: null },
        'park-1-clover': { firstSeenAt: null, lastSeenAt: null, visits: 1, reaction: null },
        'dusk-1-sunset': { firstSeenAt: null, lastSeenAt: null, visits: 1, reaction: null },
      },
      routeVisits: { 'street-1': 1, 'park-1': 1, 'dusk-1': 1 },
      lastRouteId: null,
      lastDiscoveryId: null,
      firstWalkAt: null,
      lastWalkAt: null,
      tutorialComplete: false,
      named: false,
      homePlays: { pet: 0, starterBall: 0, plush: 0, rope: 0, bed: 0 },
    },
  });
  assert.equal(upgraded.result.changed, true);
  const repeated = apply(upgraded.save, { type: 'initializeJourney' });
  assert.equal(repeated.ok, true, repeated.error);
  assert.equal(repeated.result.changed, false);
  assert.deepEqual(repeated.save, upgraded.save);
});

test('journey life validation rejects malformed memory, route, date, flag and home-play data', () => {
  const base = initialized();
  base.roomShop.journey.discoveryIds = ['street-1-bakery'];
  base.roomShop.journey.life.memories['street-1-bakery'] = {
    firstSeenAt: null, lastSeenAt: null, visits: 1, reaction: null,
  };
  assert.deepEqual(validateHomeShopSave(base), { ok: true });

  const corruptions = [
    life => { life.version = 2; },
    life => { life.memories['street-1-bakery'].visits = 0; },
    life => { life.memories['street-1-bakery'].lastSeenAt = 'yesterday'; },
    life => {
      life.memories['street-1-bakery'].firstSeenAt = '2026-10-30T02:00:00.000Z';
      life.memories['street-1-bakery'].lastSeenAt = '2026-10-30T01:00:00.000Z';
    },
    life => {
      life.firstWalkAt = '2026-10-30T02:00:00.000Z';
      life.lastWalkAt = '2026-10-30T01:00:00.000Z';
    },
    life => { life.memories['unknown-discovery'] = { firstSeenAt: null, lastSeenAt: null, visits: 1, reaction: null }; },
    life => { life.routeVisits['unknown-route'] = 1; },
    life => { life.lastRouteId = 'unknown-route'; },
    life => { life.named = 'yes'; },
    life => { life.homePlays.pet = -1; },
    life => { delete life.homePlays.rope; },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(base);
    corrupt(invalid.roomShop.journey.life);
    assert.doesNotThrow(() => validateHomeShopSave(invalid));
    assert.equal(validateHomeShopSave(invalid).ok, false);
  }
});

test('journey state accepts all 15 available route IDs and 45 discovery memories', () => {
  const save = initialized();
  save.roomShop.journey = {
    version: 1,
    discoveryIds: ALL_JOURNEY_ROUTES.flatMap(route => route.discoveries.map(item => item.id)),
    completedRoutes: ALL_JOURNEY_ROUTES.map(route => route.id),
    completedRuns: ALL_JOURNEY_ROUTES.length,
  };
  const initializedOldJourney = apply(save, { type: 'initializeJourney' });
  assert.equal(initializedOldJourney.ok, true, initializedOldJourney.error);
  assert.equal(initializedOldJourney.save.roomShop.journey.discoveryIds.length, 45);
  assert.equal(initializedOldJourney.save.roomShop.journey.completedRoutes.length, 15);
  assert.equal(Object.keys(initializedOldJourney.save.roomShop.journey.life.memories).length, 45);
  assert.equal(validateHomeShopSave(initializedOldJourney.save).ok, true);
});

test('settlement records visits and reactions atomically, including incomplete trips, and dedupes retries', () => {
  const firstAt = '2026-10-30T01:00:00.000Z';
  const secondAt = '2026-10-30T02:00:00.000Z';
  let save = start(initialized(), RUN_ID(1));
  const first = settle(save, {
    runId: RUN_ID(1), discoveryIds: ['street-1-bakery'], completedAt: firstAt,
  });
  assert.equal(first.ok, true, first.error);
  save = first.save;
  assert.deepEqual(save.roomShop.journey.life.routeVisits, { 'street-1': 1 });
  assert.equal(save.roomShop.journey.life.lastRouteId, 'street-1');
  assert.equal(save.roomShop.journey.life.lastDiscoveryId, 'street-1-bakery');
  assert.equal(save.roomShop.journey.life.firstWalkAt, firstAt);
  assert.equal(save.roomShop.journey.life.lastWalkAt, firstAt);
  assert.deepEqual(save.roomShop.journey.life.memories['street-1-bakery'], {
    firstSeenAt: firstAt,
    lastSeenAt: firstAt,
    visits: 1,
    reaction: '鼻をひくひくさせて、香りを覚えました',
  });
  assert.deepEqual(Object.keys(save.roomShop.lastReward.journey).sort(), [
    'bonusCoins', 'completed', 'completedAt', 'completedRoutes', 'completedRuns', 'discoveryCoins',
    'discoveryIds', 'mode', 'newDiscoveryIds', 'routeId', 'runDiscoveryIds', 'starterCoins',
  ].sort(), 'life stays outside the established settlement receipt');
  assert.equal(validateHomeShopSave(save).ok, true);

  const duplicate = settle(save, { runId: RUN_ID(1), discoveryIds: [], completedAt: secondAt });
  assert.equal(duplicate.ok, true, duplicate.error);
  assert.equal(duplicate.result.duplicate, true);
  assert.deepEqual(duplicate.save, save, 'retry returns the receipt without another visit or memory');

  const secondStart = start(save, RUN_ID(2));
  const incomplete = settle(secondStart, {
    runId: RUN_ID(2), discoveryIds: ['street-1-bakery'], completed: false, completedAt: secondAt,
  });
  assert.equal(incomplete.ok, true, incomplete.error);
  assert.equal(incomplete.result.journey.starterCoins, 0);
  assert.equal(incomplete.result.journey.completedRuns, 1, 'failed trips do not consume completion awards');
  assert.deepEqual(incomplete.save.roomShop.journey.life.routeVisits, { 'street-1': 2 });
  assert.deepEqual(incomplete.save.roomShop.journey.life.memories['street-1-bakery'], {
    firstSeenAt: firstAt,
    lastSeenAt: secondAt,
    visits: 2,
    reaction: '鼻をひくひくさせて、香りを覚えました',
  });

  const thirdStart = start(incomplete.save, RUN_ID(3), 'street-2');
  const beforeBadSettlement = structuredClone(thirdStart);
  const bad = settle(thirdStart, {
    runId: RUN_ID(3), discoveryIds: ['street-1-bakery'], completedAt: '2026-10-30T03:00:00.000Z',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid-journey-discoveries');
  assert.deepEqual(bad.save, beforeBadSettlement);

  const cancelled = apply(thirdStart, { type: 'cancelWalk', runId: RUN_ID(3), ownerEpoch: 7 });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.deepEqual(cancelled.save.roomShop.journey.life.routeVisits, { 'street-1': 2 },
    'cancelling a walk does not create a route visit');
});

test('a clock rollback preserves first dates and records unknown last dates without blocking settlement', () => {
  const firstAt = '2026-10-30T01:00:00.000Z';
  const beforeFirstAt = '2026-10-29T23:00:00.000Z';
  const firstRun = settle(start(initialized(), RUN_ID(1)), {
    runId: RUN_ID(1), discoveryIds: ['street-1-bakery'], completedAt: firstAt,
  });
  assert.equal(firstRun.ok, true, firstRun.error);

  const beforeCoins = firstRun.save.coins;
  const rollbackRun = settle(start(firstRun.save, RUN_ID(2)), {
    runId: RUN_ID(2), discoveryIds: ['street-1-bakery'], completedAt: beforeFirstAt,
  });
  assert.equal(rollbackRun.ok, true, rollbackRun.error);
  assert.ok(rollbackRun.result.reward > 0);
  assert.equal(rollbackRun.save.coins, beforeCoins + rollbackRun.result.reward,
    'wallet reward settles in the same transaction as life data');

  const journey = rollbackRun.save.roomShop.journey;
  assert.equal(journey.life.routeVisits['street-1'], 2);
  assert.equal(journey.life.memories['street-1-bakery'].visits, 2);
  assert.equal(journey.life.memories['street-1-bakery'].firstSeenAt, firstAt);
  assert.equal(journey.life.memories['street-1-bakery'].lastSeenAt, null,
    'the clock rollback leaves the last sighting date unknown');
  assert.equal(journey.life.firstWalkAt, firstAt);
  assert.equal(journey.life.lastWalkAt, null,
    'the clock rollback leaves the last walk date unknown');
  assert.equal(validateHomeShopSave(rollbackRun.save).ok, true);

  const duplicate = settle(rollbackRun.save, {
    runId: RUN_ID(2), discoveryIds: ['street-1-bakery'], completedAt: beforeFirstAt,
  });
  assert.equal(duplicate.ok, true, duplicate.error);
  assert.equal(duplicate.result.duplicate, true);
  assert.deepEqual(duplicate.save, rollbackRun.save, 'retry neither awards coins nor increments visits again');
});

test('dog naming trims blanks, keeps Unicode scalar boundaries within 32 UTF-16 units, and is reversible', () => {
  let save = initialized();
  assert.equal(getDogName(save), 'この子');

  const named = apply(save, { type: 'setDogName', name: '  こむぎ  ' });
  assert.equal(named.ok, true, named.error);
  assert.equal(named.save.dog.name, 'こむぎ');
  assert.equal(named.save.roomShop.journey.life.named, true);
  assert.equal(getDogName(named.save), 'こむぎ');

  const blank = apply(named.save, { type: 'setDogName', name: '   ' });
  assert.equal(blank.ok, true, blank.error);
  assert.equal(blank.save.dog.name, 'この子');
  assert.equal(blank.save.roomShop.journey.life.named, false);
  assert.equal(getDogName(blank.save), 'この子');
  assert.equal(apply(blank.save, { type: 'setDogName', name: '' }).result.changed, false);

  const emoji = apply(blank.save, { type: 'setDogName', name: `${'あ'.repeat(30)}😀tail` });
  assert.equal(emoji.ok, true, emoji.error);
  assert.equal(emoji.save.dog.name.length, 32);
  assert.ok(emoji.save.dog.name.endsWith('😀'));
  assert.equal(emoji.save.dog.name.includes('\uFFFD'), false);
  assert.deepEqual(validateHomeShopSave(emoji.save), { ok: true });
  assert.equal(apply(blank.save, { type: 'setDogName', name: null }).error, 'invalid-dog-name');
});

test('tutorial completion is idempotent and home play requires an owned equipped item', () => {
  let save = initialized();
  const pet = apply(save, { type: 'recordHomePlay', itemId: 'pet' });
  assert.equal(pet.ok, true, pet.error);
  assert.equal(pet.save.roomShop.journey.life.homePlays.pet, 1);

  pet.save.coins = 500;
  const unequippedBall = apply(pet.save, { type: 'recordHomePlay', itemId: 'starterBall' });
  assert.equal(unequippedBall.ok, false);
  assert.equal(unequippedBall.error, 'item-not-equipped');
  const boughtUnequipped = apply(pet.save, { type: 'purchase', itemId: 'plush', equip: false });
  assert.equal(boughtUnequipped.ok, true, boughtUnequipped.error);
  const notEquipped = apply(boughtUnequipped.save, { type: 'recordHomePlay', itemId: 'plush' });
  assert.equal(notEquipped.ok, false);
  assert.equal(notEquipped.error, 'item-not-equipped');

  const equippedPlush = apply(boughtUnequipped.save, { type: 'equip', itemId: 'plush' });
  assert.equal(equippedPlush.ok, true, equippedPlush.error);
  const plushPlay = apply(equippedPlush.save, { type: 'recordHomePlay', itemId: 'plush' });
  assert.equal(plushPlay.ok, true, plushPlay.error);
  assert.equal(plushPlay.save.roomShop.journey.life.homePlays.plush, 1);
  assert.equal(apply(plushPlay.save, { type: 'recordHomePlay', itemId: 'bed' }).error, 'item-not-owned');
  assert.equal(apply(plushPlay.save, { type: 'recordHomePlay', itemId: 'unknown' }).error, 'invalid-home-play-item');

  const tutorial = apply(plushPlay.save, { type: 'completeJourneyTutorial' });
  assert.equal(tutorial.ok, true, tutorial.error);
  assert.equal(tutorial.save.roomShop.journey.life.tutorialComplete, true);
  const repeated = apply(tutorial.save, { type: 'completeJourneyTutorial' });
  assert.equal(repeated.ok, true, repeated.error);
  assert.equal(repeated.result.changed, false);
  assert.deepEqual(repeated.save, tutorial.save);
});

test('memory copy refers to the dog, a remembered discovery and the favourite route', () => {
  let save = start(initialized(), RUN_ID(1), 'street-1');
  save = settle(save, {
    runId: RUN_ID(1), discoveryIds: ['street-1-bakery'], completedAt: '2026-10-30T01:00:00.000Z',
  }).save;
  save = start(save, RUN_ID(2), 'park-1');
  save = settle(save, {
    runId: RUN_ID(2), discoveryIds: ['park-1-clover'], completedAt: '2026-10-30T02:00:00.000Z',
  }).save;

  const message = getHomeMemoryMessage(save);
  assert.ok(message.includes('この子'));
  assert.ok(message.includes('芝生の丘'), 'the favourite is tied to remembered route visits');
  assert.ok(message.includes('四つ葉のクローバー'), 'the latest specific find appears in the message');

  const named = apply(save, { type: 'setDogName', name: '麦' });
  assert.equal(named.ok, true, named.error);
  const namedMessage = getHomeMemoryMessage(named.save);
  assert.ok(namedMessage.includes('麦'));
  assert.ok(namedMessage.includes('芝生の丘'));
  assert.ok(namedMessage.includes('四つ葉のクローバー'));
  assert.notEqual(namedMessage, message);
});

test('route recommendations cover never-walked routes first, then missing finds, then favourites', () => {
  const fresh = initialized().roomShop.journey;
  assert.equal(recommendJourneyRoute(fresh).id, 'street-1');
  assert.equal(recommendJourneyRoute(fresh, 'street-1').id, 'street-2');

  const twelveCompleteWithTwelveFinds = {
    version: 1,
    discoveryIds: JOURNEY_ROUTES.map(route => route.discoveries[0].id),
    completedRoutes: JOURNEY_ROUTES.map(route => route.id),
    completedRuns: 12,
  };
  assert.equal(recommendJourneyRoute(twelveCompleteWithTwelveFinds, 'street-1').id, 'street-2',
    'once all routes have been walked, a route with missing finds is recommended');

  const allFinds = {
    version: 1,
    discoveryIds: JOURNEY_ROUTES.flatMap(route => route.discoveries.map(item => item.id)),
    completedRoutes: JOURNEY_ROUTES.map(route => route.id),
    completedRuns: 12,
    life: {
      ...getJourneyLife(fresh),
      memories: Object.fromEntries(JOURNEY_ROUTES.flatMap(route => route.discoveries.map(item => [item.id, {
        firstSeenAt: null, lastSeenAt: null, visits: 1, reaction: null,
      }]))),
      routeVisits: Object.fromEntries(JOURNEY_ROUTES.map((route, index) => [route.id, route.id === 'street-1' ? 5 : index === 1 ? 2 : 1])),
      lastRouteId: 'street-1',
      lastDiscoveryId: 'cave-3-spring',
    },
  };
  assert.equal(getFavouriteRoute(allFinds).id, 'street-1');
  assert.equal(recommendJourneyRoute(allFinds, 'park-1').id, 'street-1');
  assert.equal(recommendJourneyRoute(allFinds, 'street-1').id, 'street-2');

  const withExtras = { ...allFinds, life: { ...allFinds.life,
    routeVisits: { ...allFinds.life.routeVisits, 'dusk-2': 6 },
  } };
  assert.equal(getFavouriteRoute(withExtras).id, 'dusk-2', 'favourites can resolve routes in optional content');
  assert.equal(recommendJourneyRoute(allFinds, 'park-1').id, 'street-1',
    'the default recommendation set remains the twelve free routes');
  assert.equal(recommendJourneyRoute(allFinds, 'park-1', ALL_JOURNEY_ROUTES.map(route => route.id)).id, 'dusk-1',
    'a verified accessible-route list can enable extra route recommendations');
  assert.equal(EXTRA_JOURNEY_ROUTES.length, 3);
});

test('welcome awards taper into a repeat bonus without a same-result drop over twenty percent', () => {
  const target = new Map([[1, 140], [3, 230], [6, 380], [7, 340], [10, 220], [20, 100]]);
  let save = initialized();
  const rewards = [];
  for (let run = 1; run <= 20; run += 1) {
    save = start(save, RUN_ID(100 + run), 'street-1');
    const result = settle(save, {
      runId: RUN_ID(100 + run), discoveryIds: [], completed: true,
      completedAt: `2026-10-30T00:${String(run).padStart(2, '0')}:00.000Z`,
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.result.journey.discoveryCoins, 0);
    rewards.push(result.result.reward);
    save = result.save;
  }

  for (const [run, expectedStarter] of target) {
    assert.equal(rewards[run - 1] - 43, expectedStarter, `run ${run} retains its planned award`);
  }
  for (let index = 1; index < rewards.length; index += 1) {
    assert.ok(rewards[index] >= rewards[index - 1] * 0.8,
      `run ${index + 1} reward should not fall more than 20% from run ${index}`);
  }
  const plannedAwards = [...JOURNEY_STARTER_AWARDS, ...JOURNEY_REPEAT_AWARDS];
  for (let index = JOURNEY_STARTER_AWARDS.length - 1; index < plannedAwards.length - 1; index += 1) {
    assert.ok(plannedAwards[index + 1] >= (plannedAwards[index] + 15) * 0.8,
      `run ${index + 2} absorbs the previous run's maximum one-time discovery bonus`);
  }
  assert.equal(rewards[18], rewards[19], 'the repeat award remains sustainable after the taper');
  assert.equal(JOURNEY_STARTER_AWARDS[5], 380, 'old retained receipts can still contain the sixth award');
  assert.equal(JOURNEY_REPEAT_AWARDS.at(-1), 100);
  assert.deepEqual(validateHomeShopSave(save), { ok: true });
});
