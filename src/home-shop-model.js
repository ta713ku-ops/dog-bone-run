import {
  calculateRunRewardInput,
  createInitialSave,
  migrateCandidateSave,
  validateSave,
} from './raising-model.js';
import {
  getHomeShopItem,
  HOME_SHOP_ITEMS,
  HOME_SHOP_SLOTS,
  HOME_SHOP_VERSION,
} from './home-shop-catalog.js';
import {
  ALL_JOURNEY_ROUTES,
  getJourneyRoute,
} from './journey-catalog.js';
import { createJourneyLife, getJourneyDiscoveryReaction } from './journey-life.js';

const MAX_COINS = 1_000_000_000;
const MAX_WALK_BONES = 10_000;
const ID_HISTORY_LIMIT = 128;
const BASE_TOP_LEVEL_KEYS = Object.keys(createInitialSave());
const HOME_TOP_LEVEL_KEYS = [...BASE_TOP_LEVEL_KEYS, 'roomShop'];
const ITEM_IDS = new Set(HOME_SHOP_ITEMS.map(item => item.id));
const ROOM_IDS = new Set(HOME_SHOP_ITEMS.filter(item => item.slot === 'room').map(item => item.id));
const ROUTE_IDS = new Set(ALL_JOURNEY_ROUTES.map(route => route.id));
const DISCOVERY_IDS = new Set(ALL_JOURNEY_ROUTES.flatMap(route => route.discoveries.map(item => item.id)));
const JOURNEY_MODES = new Set(['calm', 'challenge']);
const DEFAULT_ROOM_ID = 'room-white';
const LEGACY_ROOM_TOY_IDS = new Set(['starterBall', 'plush', 'rope']);
const JOURNEY_VERSION = 1;
const JOURNEY_LIFE_VERSION = 1;
const MAX_JOURNEY_RUNS = 1_000_000_000;
const MAX_JOURNEY_BONUS = 400;
const DISCOVERY_REWARD = 5;
const DISCOVERY_REWARD_CAP = 15;

/** First six completed journey trips get a one-time welcome award. */
export const JOURNEY_STARTER_AWARDS = Object.freeze([140, 180, 230, 280, 330, 380]);
/** Welcome awards taper smoothly, then settle into a repeatable 100-coin bonus. */
export const JOURNEY_REPEAT_AWARDS = Object.freeze([340, 300, 260, 220, 190, 170, 150, 135, 120, 110, 100]);
const HOME_PLAY_IDS = new Set(['pet', 'starterBall', 'plush', 'rope', 'bed']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIntegerIn(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isRunId(value) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && value.length <= 40
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(save, result) {
  return { ok: true, save, result };
}

function failure(save, error, result = undefined) {
  return result === undefined ? { ok: false, save, error } : { ok: false, save, result, error };
}

function freshRoomShop() {
  return {
    version: HOME_SHOP_VERSION,
    owned: [DEFAULT_ROOM_ID, 'starterBall'],
    equipped: { room: DEFAULT_ROOM_ID, rug: null, bed: null, toy: null, decor: null },
    activeWalk: null,
    settledRunIds: [],
    lastReward: null,
  };
}

function freshJourney() {
  const journey = { version: JOURNEY_VERSION, discoveryIds: [], completedRoutes: [], completedRuns: 0 };
  journey.life = createJourneyLife(journey);
  return journey;
}

function roomShopFromLegacy(base) {
  const roomShop = freshRoomShop();
  if (base.owned.decorations.includes('bed')) roomShop.owned.push('bed');
  for (const id of ['plush', 'rope']) {
    if (base.owned.toys.includes(id)) roomShop.owned.push(id);
  }
  if (base.equipped.bed === 'bed' && roomShop.owned.includes('bed')) {
    roomShop.equipped.bed = 'bed';
  }
  if (base.equipped.toy !== 'starterBall'
    && LEGACY_ROOM_TOY_IDS.has(base.equipped.toy)
    && roomShop.owned.includes(base.equipped.toy)) {
    roomShop.equipped.toy = base.equipped.toy;
  }
  return roomShop;
}

function stripRoomShop(value) {
  const { roomShop: ignored, ...base } = value;
  return base;
}

function validRoomShop(roomShop) {
  const hasJourney = isObject(roomShop) && Object.prototype.hasOwnProperty.call(roomShop, 'journey');
  const roomShopKeys = ['version', 'owned', 'equipped', 'activeWalk', 'settledRunIds', 'lastReward',
    ...(hasJourney ? ['journey'] : [])];
  if (!hasExactKeys(roomShop, roomShopKeys)
    || roomShop.version !== HOME_SHOP_VERSION
    || !Array.isArray(roomShop.owned)
    || roomShop.owned.length < 1
    || roomShop.owned.length > HOME_SHOP_ITEMS.length
    || !roomShop.owned.every(id => typeof id === 'string' && ITEM_IDS.has(id))
    || new Set(roomShop.owned).size !== roomShop.owned.length
    || !roomShop.owned.includes('starterBall')) return false;

  const hasRoomSlot = Object.prototype.hasOwnProperty.call(roomShop.equipped ?? {}, 'room');
  const hasDecorSlot = Object.prototype.hasOwnProperty.call(roomShop.equipped ?? {}, 'decor');
  const expectedSlots = hasDecorSlot
    ? ['room', 'rug', 'bed', 'toy', 'decor']
    : hasRoomSlot ? ['room', 'rug', 'bed', 'toy'] : ['rug', 'bed', 'toy'];
  if (!hasExactKeys(roomShop.equipped, expectedSlots)) return false;
  for (const slot of expectedSlots) {
    const id = roomShop.equipped[slot];
    if (slot === 'room' && (id === null || !ROOM_IDS.has(id) || !roomShop.owned.includes(DEFAULT_ROOM_ID))) return false;
    if (id === null) continue;
    const item = getHomeShopItem(id);
    if (!item || item.slot !== slot || !roomShop.owned.includes(id)) return false;
  }

  if (!Array.isArray(roomShop.settledRunIds)
    || roomShop.settledRunIds.length > ID_HISTORY_LIMIT
    || !roomShop.settledRunIds.every(isRunId)
    || new Set(roomShop.settledRunIds).size !== roomShop.settledRunIds.length) return false;

  // Validate the optional namespace before comparing a retained journey
  // receipt against it; malformed imported JSON must fail closed, not throw.
  if (hasJourney && !validJourney(roomShop.journey)) return false;

  if (roomShop.activeWalk !== null) {
    const walk = roomShop.activeWalk;
    const hasJourneyRoute = isObject(walk) && Object.prototype.hasOwnProperty.call(walk, 'routeId');
    const walkKeys = ['runId', 'level', 'seed', 'ownerEpoch', 'normalTotal', 'goldTotal',
      ...(hasJourneyRoute ? ['routeId', 'mode'] : [])];
    if (!hasExactKeys(walk, walkKeys)
      || !isRunId(walk.runId)
      || !isIntegerIn(walk.level, 1, 4)
      || !isIntegerIn(walk.seed, 0, 0xffff_ffff)
      || !isIntegerIn(walk.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)
      || !isIntegerIn(walk.normalTotal, 0, MAX_WALK_BONES)
      || !isIntegerIn(walk.goldTotal, 0, MAX_WALK_BONES)
      || walk.normalTotal + walk.goldTotal > MAX_WALK_BONES
      || roomShop.settledRunIds.includes(walk.runId)) return false;
    if (hasJourneyRoute) {
      const route = getJourneyRoute(walk.routeId);
      if (!route || route.level !== walk.level || !JOURNEY_MODES.has(walk.mode) || !hasJourney) return false;
    }
  }

  if (roomShop.lastReward !== null) {
    const reward = roomShop.lastReward;
    const hasJourneyResult = isObject(reward) && Object.prototype.hasOwnProperty.call(reward, 'journey');
    if (!hasExactKeys(reward, ['runId', 'reward', 'completed', 'normalCollected', 'goldCollected', 'level',
      ...(hasJourneyResult ? ['journey'] : [])])
      || !isRunId(reward.runId)
      || !isIntegerIn(reward.reward, 0, MAX_COINS)
      || typeof reward.completed !== 'boolean'
      || !isIntegerIn(reward.normalCollected, 0, MAX_WALK_BONES)
      || !isIntegerIn(reward.goldCollected, 0, MAX_WALK_BONES)
      || !isIntegerIn(reward.level, 1, 4)) return false;
    if (hasJourneyResult && (!hasJourney || !validJourneyResult(reward.journey, reward.level))) return false;
    if (hasJourneyResult && (reward.journey.completed !== reward.completed
      || reward.journey.completedRuns > roomShop.journey.completedRuns
      || !reward.journey.discoveryIds.every(id => roomShop.journey.discoveryIds.includes(id))
      || !reward.journey.completedRoutes.every(id => roomShop.journey.completedRoutes.includes(id)))) return false;
  }
  return true;
}

function validUniqueIds(value, knownIds, maxLength) {
  return Array.isArray(value) && value.length <= maxLength
    && value.every(id => typeof id === 'string' && knownIds.has(id))
    && new Set(value).size === value.length;
}

function validJourney(journey) {
  const hasLife = isObject(journey) && Object.prototype.hasOwnProperty.call(journey, 'life');
  return hasExactKeys(journey, ['version', 'discoveryIds', 'completedRoutes', 'completedRuns',
    ...(hasLife ? ['life'] : [])])
    && journey.version === JOURNEY_VERSION
    && validUniqueIds(journey.discoveryIds, DISCOVERY_IDS, DISCOVERY_IDS.size)
    && validUniqueIds(journey.completedRoutes, ROUTE_IDS, ROUTE_IDS.size)
    && isIntegerIn(journey.completedRuns, journey.completedRoutes.length, MAX_JOURNEY_RUNS)
    && ((journey.completedRuns === 0) === (journey.completedRoutes.length === 0))
    && (!hasLife || validJourneyLife(journey.life, journey));
}

function validJourneyLife(life, journey) {
  if (!hasExactKeys(life, [
    'version', 'memories', 'routeVisits', 'lastRouteId', 'lastDiscoveryId', 'firstWalkAt', 'lastWalkAt',
    'tutorialComplete', 'named', 'homePlays',
  ]) || life.version !== JOURNEY_LIFE_VERSION || !isObject(life.memories) || !isObject(life.routeVisits)) return false;

  for (const [discoveryId, memory] of Object.entries(life.memories)) {
    if (!DISCOVERY_IDS.has(discoveryId)
      || !journey.discoveryIds.includes(discoveryId)
      || !hasExactKeys(memory, ['firstSeenAt', 'lastSeenAt', 'visits', 'reaction'])
      || (memory.firstSeenAt !== null && !isIsoDate(memory.firstSeenAt))
      || (memory.lastSeenAt !== null && !isIsoDate(memory.lastSeenAt))
      || !isIntegerIn(memory.visits, 1, MAX_JOURNEY_RUNS)
      || (memory.reaction !== null && (typeof memory.reaction !== 'string' || memory.reaction.length < 1 || memory.reaction.length > 128))) {
      return false;
    }
    if (memory.firstSeenAt && memory.lastSeenAt && memory.firstSeenAt > memory.lastSeenAt) return false;
  }
  if (journey.discoveryIds.some(id => !Object.hasOwn(life.memories, id))) return false;

  for (const [routeId, visits] of Object.entries(life.routeVisits)) {
    if (!ROUTE_IDS.has(routeId) || !isIntegerIn(visits, 1, MAX_JOURNEY_RUNS)) return false;
  }
  if (journey.completedRoutes.some(id => !isIntegerIn(life.routeVisits[id], 1, MAX_JOURNEY_RUNS))) return false;
  if ((life.lastRouteId !== null && (!ROUTE_IDS.has(life.lastRouteId)
    || !isIntegerIn(life.routeVisits[life.lastRouteId], 1, MAX_JOURNEY_RUNS)))
    || (life.lastDiscoveryId !== null && (!DISCOVERY_IDS.has(life.lastDiscoveryId)
      || !Object.hasOwn(life.memories, life.lastDiscoveryId)))) return false;
  if ((life.firstWalkAt !== null && !isIsoDate(life.firstWalkAt))
    || (life.lastWalkAt !== null && !isIsoDate(life.lastWalkAt))
    || (life.firstWalkAt && life.lastWalkAt && life.firstWalkAt > life.lastWalkAt)) return false;
  if (typeof life.tutorialComplete !== 'boolean' || typeof life.named !== 'boolean'
    || !hasExactKeys(life.homePlays, ['pet', 'starterBall', 'plush', 'rope', 'bed'])
    || Object.values(life.homePlays).some(count => !isIntegerIn(count, 0, MAX_JOURNEY_RUNS))) return false;
  return true;
}

function plannedStarterAward(completedRuns) {
  if (completedRuns < JOURNEY_STARTER_AWARDS.length) return JOURNEY_STARTER_AWARDS[completedRuns];
  const repeatIndex = completedRuns - JOURNEY_STARTER_AWARDS.length;
  return JOURNEY_REPEAT_AWARDS[Math.min(repeatIndex, JOURNEY_REPEAT_AWARDS.length - 1)];
}

function validJourneyResult(summary, level) {
  if (!hasExactKeys(summary, [
    'routeId', 'mode', 'runDiscoveryIds', 'newDiscoveryIds', 'discoveryIds', 'completedRoutes',
    'completedRuns', 'completed', 'starterCoins', 'discoveryCoins', 'bonusCoins', 'completedAt',
  ])) return false;
  const route = getJourneyRoute(summary.routeId);
  const routeDiscoveryIds = new Set(route?.discoveries.map(item => item.id) ?? []);
  return Boolean(route)
    && route.level === level
    && JOURNEY_MODES.has(summary.mode)
    && validUniqueIds(summary.runDiscoveryIds, routeDiscoveryIds, routeDiscoveryIds.size)
    && validUniqueIds(summary.newDiscoveryIds, routeDiscoveryIds, routeDiscoveryIds.size)
    && summary.newDiscoveryIds.every(id => summary.runDiscoveryIds.includes(id))
    && validUniqueIds(summary.discoveryIds, DISCOVERY_IDS, DISCOVERY_IDS.size)
    && summary.newDiscoveryIds.every(id => summary.discoveryIds.includes(id))
    && validUniqueIds(summary.completedRoutes, ROUTE_IDS, ROUTE_IDS.size)
    && isIntegerIn(summary.completedRuns, summary.completedRoutes.length, MAX_JOURNEY_RUNS)
    && ((summary.completedRuns === 0) === (summary.completedRoutes.length === 0))
    && typeof summary.completed === 'boolean'
    && isIntegerIn(summary.starterCoins, 0, Math.max(...JOURNEY_STARTER_AWARDS))
    && isIntegerIn(summary.discoveryCoins, 0, DISCOVERY_REWARD_CAP)
    && isIntegerIn(summary.bonusCoins, 0, MAX_JOURNEY_BONUS)
    && summary.bonusCoins === summary.starterCoins + summary.discoveryCoins
    && (summary.completedAt === null || isIsoDate(summary.completedAt))
    && (!summary.completed || summary.completedRoutes.includes(summary.routeId));
}

function legacyBaseValidation(value) {
  if (!hasExactKeys(value, HOME_TOP_LEVEL_KEYS)) return { ok: false, error: 'invalid-home-shop-shape' };
  return validateSave(stripRoomShop(value));
}

export function createHomeShopSave() {
  const save = createInitialSave();
  save.roomShop = freshRoomShop();
  return save;
}

export function validateHomeShopSave(value) {
  const baseValidation = legacyBaseValidation(value);
  if (!baseValidation.ok) return baseValidation;
  if (!validRoomShop(value.roomShop)) return { ok: false, error: 'invalid-room-shop' };
  return { ok: true };
}

/** Adds the namespaced room-shop state while retaining every existing v2 value. */
export function migrateHomeShopSave(candidate) {
  if (!isObject(candidate) || Object.prototype.hasOwnProperty.call(candidate, 'roomShop')) {
    return { ok: false, error: 'unsupported-home-shop-candidate' };
  }

  let base;
  const current = validateSave(candidate);
  if (current.ok) {
    base = clone(candidate);
  } else {
    const normalized = migrateCandidateSave(candidate);
    if (!normalized.ok) return normalized;
    base = clone(normalized.save);
  }

  const save = { ...base, roomShop: roomShopFromLegacy(base) };
  const validation = validateHomeShopSave(save);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, save, migrated: true };
}

export const migrateRoomShopSave = migrateHomeShopSave;

function addLegacyOwnership(save, itemId) {
  if (itemId === 'bed' && !save.owned.decorations.includes('bed')) {
    save.owned.decorations.push('bed');
  } else if (LEGACY_ROOM_TOY_IDS.has(itemId) && !save.owned.toys.includes(itemId)) {
    save.owned.toys.push(itemId);
  }
}

function equipMutable(save, slot, itemId) {
  const previous = save.roomShop.equipped[slot];
  save.roomShop.equipped[slot] = itemId;
  if (slot === 'bed' && save.owned.decorations.includes('bed')) {
    save.equipped.bed = itemId === 'bed' ? 'bed' : null;
  } else if (slot === 'toy' && itemId !== null && LEGACY_ROOM_TOY_IDS.has(itemId)) {
    save.equipped.toy = itemId;
  }
  return previous !== itemId;
}

function equipCommand(save, command) {
  const rawId = command.itemId;
  const item = typeof rawId === 'string' ? getHomeShopItem(rawId) : null;
  const slot = command.slot ?? item?.slot;
  if (!HOME_SHOP_SLOTS.includes(slot)) return failure(save, 'invalid-slot');
  if (slot === 'room' && (rawId === null || rawId === undefined)) return failure(save, 'room-required');
  if (slot === 'room' && !Object.prototype.hasOwnProperty.call(save.roomShop.equipped, 'room')) {
    return failure(save, 'interiors-not-initialized');
  }
  if (slot === 'decor' && !Object.prototype.hasOwnProperty.call(save.roomShop.equipped, 'decor')) {
    return failure(save, 'interiors-not-initialized');
  }
  if (rawId !== null && rawId !== undefined && !item) return failure(save, 'unknown-item');
  if (item && item.slot !== slot) return failure(save, 'item-slot-mismatch');
  if (item && !save.roomShop.owned.includes(item.id)) return failure(save, 'item-not-owned');
  const itemId = item?.id ?? null;
  const next = clone(save);
  if (itemId !== null) addLegacyOwnership(next, itemId);
  const changed = equipMutable(next, slot, itemId);
  if (!changed) return success(save, { slot, itemId, equipped: itemId !== null, changed: false });
  return success(next, { slot, itemId, equipped: itemId !== null, changed: true });
}

function purchaseCommand(save, command) {
  const item = getHomeShopItem(command.itemId);
  if (!item) return failure(save, 'unknown-item');
  if (command.equip !== undefined && typeof command.equip !== 'boolean') return failure(save, 'invalid-equip-option');
  if (item.slot === 'room' && !Object.prototype.hasOwnProperty.call(save.roomShop.equipped, 'room')) {
    return failure(save, 'interiors-not-initialized');
  }
  if (item.slot === 'decor' && !Object.prototype.hasOwnProperty.call(save.roomShop.equipped, 'decor')) {
    return failure(save, 'interiors-not-initialized');
  }
  if (save.roomShop.owned.includes(item.id)) return failure(save, 'item-already-owned');
  if (save.coins < item.price) return failure(save, 'insufficient-coins');

  const next = clone(save);
  next.coins -= item.price;
  next.records.totalCoinsSpent = Math.min(MAX_COINS, next.records.totalCoinsSpent + item.price);
  next.roomShop.owned.push(item.id);
  addLegacyOwnership(next, item.id);
  const equipped = command.equip === true
    ? equipMutable(next, item.slot, item.id)
    : false;
  return success(next, {
    itemId: item.id,
    price: item.price,
    coins: next.coins,
    owned: true,
    equipped: command.equip === true,
    equipmentChanged: equipped,
  });
}

function initializeInteriorsCommand(save) {
  const hasRoomSlot = Object.prototype.hasOwnProperty.call(save.roomShop.equipped, 'room');
  const hasDecorSlot = Object.prototype.hasOwnProperty.call(save.roomShop.equipped, 'decor');
  if (hasRoomSlot && hasDecorSlot) {
    return success(save, { initialized: true, changed: false });
  }

  const next = clone(save);
  if (!hasRoomSlot) {
    if (!next.roomShop.owned.includes(DEFAULT_ROOM_ID)) next.roomShop.owned.push(DEFAULT_ROOM_ID);
    next.roomShop.equipped.room = DEFAULT_ROOM_ID;
    if (next.roomShop.equipped.toy === 'starterBall') next.roomShop.equipped.toy = null;
  }
  if (!hasDecorSlot) next.roomShop.equipped.decor = null;
  return success(next, { initialized: true, changed: true });
}

function initializeJourneyCommand(save) {
  if (save.roomShop.journey && save.roomShop.journey.life) {
    return success(save, { initialized: true, changed: false,
      discoveryIds: [...save.roomShop.journey.discoveryIds],
      completedRoutes: [...save.roomShop.journey.completedRoutes],
      completedRuns: save.roomShop.journey.completedRuns });
  }
  const next = clone(save);
  if (!next.roomShop.journey) next.roomShop.journey = freshJourney();
  else next.roomShop.journey.life = createJourneyLife(next.roomShop.journey);
  return success(next, { initialized: true, changed: true,
    discoveryIds: [...next.roomShop.journey.discoveryIds],
    completedRoutes: [...next.roomShop.journey.completedRoutes],
    completedRuns: next.roomShop.journey.completedRuns });
}

function journeyLifeCommandTarget(save) {
  return save.roomShop.journey?.life ? null : 'journey-not-initialized';
}

function truncateUtf16ByCodePoint(value, maxUnits) {
  let result = '';
  for (const point of value) {
    if (result.length + point.length > maxUnits) break;
    result += point;
  }
  return result;
}

function setDogNameCommand(save, command) {
  const targetError = journeyLifeCommandTarget(save);
  if (targetError) return failure(save, targetError);
  if (typeof command.name !== 'string') return failure(save, 'invalid-dog-name');
  const requested = truncateUtf16ByCodePoint(command.name.trim(), 32);
  const named = requested.length > 0;
  const name = named ? requested : 'この子';
  const changed = save.dog.name !== name || save.roomShop.journey.life.named !== named;
  if (!changed) return success(save, { name, named, changed: false });
  const next = clone(save);
  next.dog.name = name;
  next.roomShop.journey.life.named = named;
  return success(next, { name, named, changed: true });
}

function completeJourneyTutorialCommand(save) {
  const targetError = journeyLifeCommandTarget(save);
  if (targetError) return failure(save, targetError);
  if (save.roomShop.journey.life.tutorialComplete) {
    return success(save, { tutorialComplete: true, changed: false });
  }
  const next = clone(save);
  next.roomShop.journey.life.tutorialComplete = true;
  return success(next, { tutorialComplete: true, changed: true });
}

function recordHomePlayCommand(save, command) {
  const targetError = journeyLifeCommandTarget(save);
  if (targetError) return failure(save, targetError);
  const itemId = command.itemId;
  if (typeof itemId !== 'string' || !HOME_PLAY_IDS.has(itemId)) return failure(save, 'invalid-home-play-item');
  if (itemId !== 'pet') {
    const slot = itemId === 'bed' ? 'bed' : 'toy';
    if (!save.roomShop.owned.includes(itemId)) return failure(save, 'item-not-owned');
    if (save.roomShop.equipped[slot] !== itemId) return failure(save, 'item-not-equipped');
  }
  const plays = save.roomShop.journey.life.homePlays[itemId];
  if (plays >= MAX_JOURNEY_RUNS) return failure(save, 'home-play-limit');
  const next = clone(save);
  next.roomShop.journey.life.homePlays[itemId] += 1;
  return success(next, { itemId, plays: next.roomShop.journey.life.homePlays[itemId] });
}

function lastKnownOnOrAfterFirst(completedAt, firstAt) {
  // A device clock rollback cannot provide a valid last date before the known
  // first date. Preserve that first date and leave the last date unknown.
  if (completedAt === null || (firstAt !== null && completedAt < firstAt)) return null;
  return completedAt;
}

function recordJourneySettlementLife(journey, routeId, discoveryIds, completedAt) {
  const life = journey.life ?? createJourneyLife(journey);
  const hadPriorVisit = Object.values(life.routeVisits).some(visits => visits > 0);
  const priorVisits = life.routeVisits[routeId] ?? 0;
  if (priorVisits >= MAX_JOURNEY_RUNS) return 'journey-visit-limit';

  life.routeVisits[routeId] = priorVisits + 1;
  life.lastRouteId = routeId;
  if (!hadPriorVisit && life.firstWalkAt === null) life.firstWalkAt = completedAt;
  life.lastWalkAt = lastKnownOnOrAfterFirst(completedAt, life.firstWalkAt);
  if (discoveryIds.length > 0) life.lastDiscoveryId = discoveryIds.at(-1);
  for (const discoveryId of discoveryIds) {
    const prior = life.memories[discoveryId];
    if (prior?.visits >= MAX_JOURNEY_RUNS) return 'journey-memory-limit';
    const firstSeenAt = prior ? prior.firstSeenAt : completedAt;
    life.memories[discoveryId] = {
      firstSeenAt,
      lastSeenAt: lastKnownOnOrAfterFirst(completedAt, firstSeenAt),
      visits: (prior?.visits ?? 0) + 1,
      reaction: getJourneyDiscoveryReaction(discoveryId),
    };
  }
  journey.life = life;
  return null;
}

function appendSettledId(ids, runId) {
  return [...ids.filter(id => id !== runId), runId].slice(-ID_HISTORY_LIMIT);
}

function syntheticCourse(normalTotal, goldTotal) {
  return {
    bones: [
      ...Array.from({ length: normalTotal }, () => ({ kind: 'normal' })),
      ...Array.from({ length: goldTotal }, () => ({ kind: 'gold' })),
    ],
  };
}

function beginWalkCommand(save, command) {
  if (!isRunId(command.runId)
    || !isIntegerIn(command.level, 1, 4)
    || !isIntegerIn(command.seed, 0, 0xffff_ffff)
    || !isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)
    || !isIntegerIn(command.normalTotal, 0, MAX_WALK_BONES)
    || !isIntegerIn(command.goldTotal, 0, MAX_WALK_BONES)
    || command.normalTotal + command.goldTotal > MAX_WALK_BONES) return failure(save, 'invalid-walk');
  const hasRouteId = command.routeId !== undefined && command.routeId !== null;
  let routeId;
  let mode;
  if (hasRouteId) {
    const route = getJourneyRoute(command.routeId);
    mode = command.mode === undefined || command.mode === null ? 'calm' : command.mode;
    if (!route || route.level !== command.level || !JOURNEY_MODES.has(mode)) return failure(save, 'invalid-journey-walk');
    if (!save.roomShop.journey) return failure(save, 'journey-not-initialized');
    routeId = route.id;
  } else if (command.mode !== undefined && command.mode !== null && command.mode !== 'calm') {
    return failure(save, 'invalid-journey-mode');
  }
  if (save.roomShop.activeWalk) return failure(save, 'walk-already-active');
  if (save.roomShop.settledRunIds.includes(command.runId)
    || save.roomShop.lastReward?.runId === command.runId) return failure(save, 'walk-id-already-settled');
  const next = clone(save);
  next.roomShop.activeWalk = {
    runId: command.runId,
    level: command.level,
    seed: command.seed,
    ownerEpoch: command.ownerEpoch,
    normalTotal: command.normalTotal,
    goldTotal: command.goldTotal,
    ...(routeId ? { routeId, mode } : {}),
  };
  return success(next, { runId: command.runId, active: true, ...(routeId ? { routeId, mode } : {}) });
}

function resumeWalkCommand(save, command) {
  if (!isRunId(command.runId)
    || !isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)) {
    return failure(save, 'invalid-walk-resume');
  }
  const active = save.roomShop.activeWalk;
  if (!active || active.runId !== command.runId) return failure(save, 'active-walk-mismatch');
  if (command.ownerEpoch < active.ownerEpoch) return failure(save, 'stale-owner-epoch');
  if (command.ownerEpoch === active.ownerEpoch) {
    return success(save, { runId: active.runId, ownerEpoch: active.ownerEpoch, resumed: false });
  }
  const next = clone(save);
  next.roomShop.activeWalk.ownerEpoch = command.ownerEpoch;
  return success(next, { runId: active.runId, ownerEpoch: command.ownerEpoch, resumed: true });
}

function settleWalkCommand(save, command) {
  const roomShop = save.roomShop;
  if (!isRunId(command.runId)
    || !isIntegerIn(command.normalCollected, 0, MAX_WALK_BONES)
    || !isIntegerIn(command.goldCollected, 0, MAX_WALK_BONES)
    || typeof command.completed !== 'boolean'
    || !isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)
    || (command.completedAt !== undefined && !isIsoDate(command.completedAt))) return failure(save, 'invalid-settlement');

  if (roomShop.settledRunIds.includes(command.runId) || roomShop.lastReward?.runId === command.runId) {
    const prior = roomShop.lastReward?.runId === command.runId ? roomShop.lastReward : null;
    return success(save, prior
      ? { ...prior, duplicate: true }
      : { runId: command.runId, reward: 0, duplicate: true });
  }

  const active = roomShop.activeWalk;
  if (!active || active.runId !== command.runId) return failure(save, 'active-walk-mismatch');
  if (active.ownerEpoch !== command.ownerEpoch) return failure(save, 'foreign-owner-epoch');

  const journeyRun = typeof active.routeId === 'string';
  let runDiscoveryIds = [];
  if (journeyRun) {
    if (!roomShop.journey) return failure(save, 'journey-not-initialized');
    const route = getJourneyRoute(active.routeId);
    const routeDiscoveryIds = new Set(route?.discoveries.map(item => item.id) ?? []);
    const requested = command.discoveryIds === undefined ? [] : command.discoveryIds;
    if (!Array.isArray(requested) || requested.length > routeDiscoveryIds.size
      || !requested.every(id => typeof id === 'string' && routeDiscoveryIds.has(id))
      || new Set(requested).size !== requested.length) return failure(save, 'invalid-journey-discoveries');
    runDiscoveryIds = [...requested];
  } else if (command.discoveryIds !== undefined) {
    if (!Array.isArray(command.discoveryIds) || command.discoveryIds.length !== 0) {
      return failure(save, 'unexpected-journey-discoveries');
    }
  }

  const calculated = calculateRunRewardInput({
    normalCollected: command.normalCollected,
    goldCollected: command.goldCollected,
    completed: command.completed,
    difficulty: active.level,
    course: syntheticCourse(active.normalTotal, active.goldTotal),
  });
  const baseReward = Math.min(calculated.reward, MAX_COINS - save.coins);
  const next = clone(save);
  let reward = baseReward;
  let journeySummary = null;
  if (journeyRun) {
    const journey = next.roomShop.journey;
    const previousDiscoveries = new Set(journey.discoveryIds);
    const newDiscoveryIds = runDiscoveryIds.filter(id => !previousDiscoveries.has(id));
    const completedRuns = journey.completedRuns + (command.completed ? 1 : 0);
    if (completedRuns > MAX_JOURNEY_RUNS) return failure(save, 'journey-run-limit');
    const starterPlanned = command.completed ? plannedStarterAward(journey.completedRuns) : 0;
    const discoveryPlanned = Math.min(newDiscoveryIds.length * DISCOVERY_REWARD, DISCOVERY_REWARD_CAP);
    const maxAffordableBonus = Math.max(0, MAX_COINS - save.coins - baseReward);
    const starterCoins = Math.min(starterPlanned, maxAffordableBonus);
    const discoveryCoins = Math.min(discoveryPlanned, Math.max(0, maxAffordableBonus - starterCoins));
    const bonusCoins = Math.min(MAX_JOURNEY_BONUS, starterCoins + discoveryCoins);
    const allDiscoveryIds = [...journey.discoveryIds, ...newDiscoveryIds];
    const completedRoutes = command.completed && !journey.completedRoutes.includes(active.routeId)
      ? [...journey.completedRoutes, active.routeId]
      : [...journey.completedRoutes];
    journey.life ??= createJourneyLife(journey);
    journey.discoveryIds = allDiscoveryIds;
    journey.completedRoutes = completedRoutes;
    journey.completedRuns = completedRuns;
    const lifeError = recordJourneySettlementLife(
      journey, active.routeId, runDiscoveryIds, command.completedAt ?? null,
    );
    if (lifeError) return failure(save, lifeError);
    reward = Math.min(MAX_COINS - save.coins, baseReward + bonusCoins);
    journeySummary = {
      routeId: active.routeId,
      mode: active.mode,
      runDiscoveryIds,
      newDiscoveryIds,
      discoveryIds: [...journey.discoveryIds],
      completedRoutes: [...journey.completedRoutes],
      completedRuns: journey.completedRuns,
      completed: command.completed,
      starterCoins,
      discoveryCoins,
      bonusCoins,
      completedAt: command.completedAt ?? null,
    };
  }
  next.coins += reward;
  next.records.totalCoinsEarned = Math.min(MAX_COINS, next.records.totalCoinsEarned + reward);
  next.roomShop.activeWalk = null;
  next.roomShop.settledRunIds = appendSettledId(next.roomShop.settledRunIds, active.runId);
  next.roomShop.lastReward = {
    runId: active.runId,
    reward,
    completed: command.completed,
    normalCollected: calculated.normalCollected,
    goldCollected: calculated.goldCollected,
    level: active.level,
    ...(journeySummary ? { journey: journeySummary } : {}),
  };
  return success(next, { ...next.roomShop.lastReward, duplicate: false,
    ...(journeySummary ? { journey: clone(journeySummary) } : {}) });
}

function cancelWalkCommand(save, command) {
  if (!isRunId(command.runId)) return failure(save, 'invalid-run-id');
  if (command.ownerEpoch !== undefined && !isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)) {
    return failure(save, 'invalid-owner-epoch');
  }
  if (save.roomShop.settledRunIds.includes(command.runId)) {
    return success(save, { runId: command.runId, cancelled: true, reward: 0, duplicate: true });
  }
  const active = save.roomShop.activeWalk;
  if (!active || active.runId !== command.runId) return failure(save, 'active-walk-mismatch');
  if (command.ownerEpoch !== undefined && active.ownerEpoch !== command.ownerEpoch) {
    return failure(save, 'foreign-owner-epoch');
  }
  const next = clone(save);
  next.roomShop.activeWalk = null;
  next.roomShop.settledRunIds = appendSettledId(next.roomShop.settledRunIds, active.runId);
  return success(next, { runId: active.runId, cancelled: true, reward: 0, duplicate: false });
}

export function applyHomeShopCommand(state, command) {
  const validation = validateHomeShopSave(state);
  if (!validation.ok) return failure(state, validation.error);
  if (!isObject(command) || typeof command.type !== 'string') return failure(state, 'invalid-command');

  let result;
  try {
    switch (command.type) {
      case 'initializeInteriors': result = initializeInteriorsCommand(state); break;
      case 'initializeJourney': result = initializeJourneyCommand(state); break;
      case 'setDogName': result = setDogNameCommand(state, command); break;
      case 'completeJourneyTutorial': result = completeJourneyTutorialCommand(state); break;
      case 'recordHomePlay': result = recordHomePlayCommand(state, command); break;
      case 'purchase': result = purchaseCommand(state, command); break;
      case 'equip': result = equipCommand(state, command); break;
      case 'beginWalk': result = beginWalkCommand(state, command); break;
      case 'resumeWalk': result = resumeWalkCommand(state, command); break;
      case 'settleWalk': result = settleWalkCommand(state, command); break;
      case 'cancelWalk': result = cancelWalkCommand(state, command); break;
      default: return failure(state, 'unknown-command');
    }
  } catch {
    return failure(state, 'command-failed');
  }

  if (!result.ok) return result;
  const nextValidation = validateHomeShopSave(result.save);
  if (!nextValidation.ok) return failure(state, `invalid-transition:${nextValidation.error}`);
  return result;
}
