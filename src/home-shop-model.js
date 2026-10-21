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

const MAX_COINS = 1_000_000_000;
const MAX_WALK_BONES = 10_000;
const ID_HISTORY_LIMIT = 128;
const BASE_TOP_LEVEL_KEYS = Object.keys(createInitialSave());
const HOME_TOP_LEVEL_KEYS = [...BASE_TOP_LEVEL_KEYS, 'roomShop'];
const ITEM_IDS = new Set(HOME_SHOP_ITEMS.map(item => item.id));
const ROOM_IDS = new Set(HOME_SHOP_ITEMS.filter(item => item.slot === 'room').map(item => item.id));
const DEFAULT_ROOM_ID = 'room-white';
const LEGACY_ROOM_TOY_IDS = new Set(['starterBall', 'plush', 'rope']);

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
  if (!hasExactKeys(roomShop, ['version', 'owned', 'equipped', 'activeWalk', 'settledRunIds', 'lastReward'])
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

  if (roomShop.activeWalk !== null) {
    const walk = roomShop.activeWalk;
    if (!hasExactKeys(walk, ['runId', 'level', 'seed', 'ownerEpoch', 'normalTotal', 'goldTotal'])
      || !isRunId(walk.runId)
      || !isIntegerIn(walk.level, 1, 4)
      || !isIntegerIn(walk.seed, 0, 0xffff_ffff)
      || !isIntegerIn(walk.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)
      || !isIntegerIn(walk.normalTotal, 0, MAX_WALK_BONES)
      || !isIntegerIn(walk.goldTotal, 0, MAX_WALK_BONES)
      || walk.normalTotal + walk.goldTotal > MAX_WALK_BONES
      || roomShop.settledRunIds.includes(walk.runId)) return false;
  }

  if (roomShop.lastReward !== null) {
    const reward = roomShop.lastReward;
    if (!hasExactKeys(reward, ['runId', 'reward', 'completed', 'normalCollected', 'goldCollected', 'level'])
      || !isRunId(reward.runId)
      || !isIntegerIn(reward.reward, 0, MAX_COINS)
      || typeof reward.completed !== 'boolean'
      || !isIntegerIn(reward.normalCollected, 0, MAX_WALK_BONES)
      || !isIntegerIn(reward.goldCollected, 0, MAX_WALK_BONES)
      || !isIntegerIn(reward.level, 1, 4)) return false;
  }
  return true;
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
  };
  return success(next, { runId: command.runId, active: true });
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
    || !isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)) return failure(save, 'invalid-settlement');

  if (roomShop.settledRunIds.includes(command.runId) || roomShop.lastReward?.runId === command.runId) {
    const prior = roomShop.lastReward?.runId === command.runId ? roomShop.lastReward : null;
    return success(save, prior
      ? { ...prior, duplicate: true }
      : { runId: command.runId, reward: 0, duplicate: true });
  }

  const active = roomShop.activeWalk;
  if (!active || active.runId !== command.runId) return failure(save, 'active-walk-mismatch');
  if (active.ownerEpoch !== command.ownerEpoch) return failure(save, 'foreign-owner-epoch');

  const calculated = calculateRunRewardInput({
    normalCollected: command.normalCollected,
    goldCollected: command.goldCollected,
    completed: command.completed,
    difficulty: active.level,
    course: syntheticCourse(active.normalTotal, active.goldTotal),
  });
  const reward = Math.min(calculated.reward, MAX_COINS - save.coins);
  const next = clone(save);
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
  };
  return success(next, { ...next.roomShop.lastReward, duplicate: false });
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
