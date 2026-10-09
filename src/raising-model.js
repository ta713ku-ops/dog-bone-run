import {
  DECORATION_ITEMS,
  ECONOMY_VERSION,
  FOOD_ITEMS,
  HOUSE_ITEMS,
  HOUSE_LEVEL_PRICES,
  RAISING_CONFIG,
  SHOP_ITEMS,
  TOY_ITEMS,
  getHungerState,
} from './raising-config.js';
import { createRaisingCourse } from './raising-course.js';

const TOY_BY_ID = new Map(TOY_ITEMS.map(item => [item.id, item]));
const FOOD_BY_ID = new Map(FOOD_ITEMS.map(item => [item.id, item]));
const SHOP_BY_ID = new Map(SHOP_ITEMS.map(item => [item.id, item]));
const DECORATION_BY_ID = new Map(DECORATION_ITEMS.map(item => [item.id, item]));
const HOUSE_BY_ID = new Map(HOUSE_ITEMS.map(item => [item.id, item]));
const TOP_LEVEL_KEYS = [
  'schemaVersion', 'revision', 'saveGeneration', 'coins', 'dog', 'owned', 'equipped', 'inventory',
  'settings', 'records', 'activeRun', 'activeAction', 'raisingClockMs', 'moodDecayDebt',
  'petting', 'naturalLossSession', 'idHistory', 'raisingRng',
];
const ROAD_DECORATION = new Set(['standard', 'modest', 'minimal']);
const MAX_COINS = 1_000_000_000;
const MAX_TICK_MS = 60_000;
const MAX_ID_LENGTH = 128;
export const LEGACY_PROVISIONAL_ECONOMY_VERSION = 'raising-economy-provisional-1';
const LEGACY_PROVISIONAL_ECONOMY = Object.freeze({
  boneRewardCoins: 1,
  goldBoneRewardCoins: 3,
  clearBonusCoins: 4,
  runRewardScaleBps: Object.freeze({ 1: 10_000, 2: 10_500, 3: 11_000, 4: 11_500, 5: 12_000 }),
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isId(value) {
  return typeof value === 'string' && value.length >= 16 && value.length <= MAX_ID_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function isUniqueStringArray(value, predicate = () => true, maxLength = 64) {
  return Array.isArray(value) && value.length <= maxLength
    && value.every(item => typeof item === 'string' && predicate(item))
    && new Set(value).size === value.length;
}

function cloneSave(save) {
  return JSON.parse(JSON.stringify(save));
}

function boundedAppend(list, value, max = RAISING_CONFIG.idHistoryLimit) {
  return [...list.filter(item => item !== value), value].slice(-max);
}

function failed(save, error, result = undefined) {
  return result === undefined ? { ok: false, save, error } : { ok: false, save, result, error };
}

function succeeded(save, result) {
  return { ok: true, save, result };
}

function normalizeSeed(seed) {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

function countCourseBones(course) {
  const normal = course.bones.filter(bone => bone.kind !== 'gold').length;
  const gold = course.bones.filter(bone => bone.kind === 'gold').length;
  return { normal, gold };
}

export function calculateFullClearReference(course, difficulty = 3) {
  if (!isObject(course) || !Array.isArray(course.bones)) throw new TypeError('A course with bones is required.');
  if (!isIntegerIn(difficulty, 1, 5)) throw new RangeError('Difficulty must be an integer from 1 to 5.');
  const { normal, gold } = countCourseBones(course);
  const scale = RAISING_CONFIG.runRewardScaleBps[difficulty] / 10_000;
  const earned = Math.floor((normal * RAISING_CONFIG.boneRewardCoins + gold * RAISING_CONFIG.goldBoneRewardCoins) * scale);
  const clearBonus = Math.floor(RAISING_CONFIG.clearBonusCoins * scale);
  return earned + clearBonus;
}

export function calculateRunRewardInput({ normalCollected = 0, goldCollected = 0, completed = false, difficulty = 3, course }) {
  if (!isIntegerIn(difficulty, 1, 5)) throw new RangeError('Difficulty must be an integer from 1 to 5.');
  const totals = countCourseBones(course);
  const normal = Math.max(0, Math.min(totals.normal, Math.trunc(Number(normalCollected) || 0)));
  const gold = Math.max(0, Math.min(totals.gold, Math.trunc(Number(goldCollected) || 0)));
  const scale = RAISING_CONFIG.runRewardScaleBps[difficulty] / 10_000;
  const earnedBase = Math.floor((normal * RAISING_CONFIG.boneRewardCoins + gold * RAISING_CONFIG.goldBoneRewardCoins) * scale);
  const fullClearReference = calculateFullClearReference(course, difficulty);
  const clearBonus = Math.floor(RAISING_CONFIG.clearBonusCoins * scale);
  const reward = completed
    ? Math.min(fullClearReference, earnedBase + clearBonus)
    : Math.max(0, Math.floor(Math.min(
      earnedBase * RAISING_CONFIG.failureMultipliers[difficulty],
      0.70 * fullClearReference,
    )));
  return { earnedBase, fullClearReference, reward, normalCollected: normal, goldCollected: gold, completed: Boolean(completed), difficulty };
}

export function createInitialSave() {
  return {
    schemaVersion: RAISING_CONFIG.schemaVersion,
    revision: 0,
    saveGeneration: 'initial-v2',
    coins: RAISING_CONFIG.startingCoins,
    dog: {
      name: RAISING_CONFIG.startingDogName,
      hunger: RAISING_CONFIG.startingHunger,
      energy: RAISING_CONFIG.startingEnergy,
      mood: RAISING_CONFIG.startingMood,
    },
    owned: { houseLevel: 1, toys: ['starterBall'], decorations: [] },
    equipped: { toy: 'starterBall', bed: null, decorations: [] },
    inventory: { kibble: 0, treat: 0 },
    settings: {
      soundEnabled: true,
      musicEnabled: true,
      musicVolume: RAISING_CONFIG.initialMusicVolume,
      sfxVolume: RAISING_CONFIG.initialSfxVolume,
      reducedMotion: false,
      roadDecoration: RAISING_CONFIG.initialRoadDecoration,
    },
    records: {
      unlockedDifficulty: 1,
      runsStarted: 0,
      runsCleared: 0,
      runsFailed: 0,
      totalCoinsEarned: 0,
      totalCoinsSpent: 0,
      legacyMigrationVersion: 0,
      legacyPlayEvidence: [],
      ruleRecords: [],
      lastRun: null,
      lastExportAt: null,
    },
    activeRun: null,
    activeAction: null,
    raisingClockMs: 0,
    moodDecayDebt: 0,
    petting: { lastGainAtMs: null, history: [], gestureIds: [] },
    naturalLossSession: { sessionId: null, used: 0 },
    idHistory: { runIds: [], actionIds: [] },
    raisingRng: { algorithm: 'xorshift32-v1', state: 0, drawCount: 0, idleMs: 0 },
  };
}

function validRecordList(value, maxLength = 32) {
  return Array.isArray(value) && value.length <= maxLength && value.every(record =>
    hasExactKeys(record, ['key', 'highScore', 'maxCombo'])
    && typeof record.key === 'string' && record.key.length > 0 && record.key.length <= 128
    && isIntegerIn(record.highScore, 0, 1_000_000_000)
    && isIntegerIn(record.maxCombo, 0, 1_000_000_000));
}

function validAction(action, save) {
  if (!hasExactKeys(action, [
    'saveGeneration', 'actionId', 'ownerTabId', 'ownerEpoch', 'kind', 'cycleIndex', 'elapsedActiveMs',
    'status', 'chargedCost', 'compensationState', 'energyPerCycle', 'bedEquipped', 'toyId', 'startedAtMs',
  ])) return false;
  return action.saveGeneration === save.saveGeneration
    && isId(action.actionId)
    && typeof action.ownerTabId === 'string' && action.ownerTabId.length > 0 && action.ownerTabId.length <= MAX_ID_LENGTH
    && isIntegerIn(action.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)
    && ['rest', 'play', 'sleep'].includes(action.kind)
    && isIntegerIn(action.cycleIndex, 0, 1_000_000)
    && isFiniteNumber(action.elapsedActiveMs) && action.elapsedActiveMs >= 0 && action.elapsedActiveMs < RAISING_CONFIG.restCycleMs
    && action.status === 'running'
    && isIntegerIn(action.chargedCost, 0, MAX_COINS)
    && ['not-eligible', 'eligible', 'compensated'].includes(action.compensationState)
    && isIntegerIn(action.energyPerCycle, 0, 100)
    && typeof action.bedEquipped === 'boolean'
    && (action.toyId === null || TOY_BY_ID.has(action.toyId))
    && isIntegerIn(action.startedAtMs, 0, Number.MAX_SAFE_INTEGER)
    && (action.kind !== 'play' || (action.toyId !== null && action.chargedCost > 0))
    && (action.kind === 'play' ? action.toyId !== null && action.chargedCost > 0 : action.toyId === null);
}

function validRunBase(run, save) {
  if (!hasExactKeys(run, [
    'saveGeneration', 'runId', 'economyVersion', 'seed', 'difficulty', 'ownerEpoch', 'status',
    'fullClearReference', 'normalBoneTotal', 'goldBoneTotal', 'rewardScaleBps', 'startedAtMs',
  ])) return false;
  return run.saveGeneration === save.saveGeneration
    && isId(run.runId)
    && isIntegerIn(run.seed, 0, 0xffff_ffff)
    && isIntegerIn(run.difficulty, 1, 5)
    && run.difficulty <= save.records.unlockedDifficulty
    && isIntegerIn(run.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)
    && run.status === 'running'
    && isIntegerIn(run.fullClearReference, 0, 100_000)
    && isIntegerIn(run.normalBoneTotal, 0, 100_000)
    && isIntegerIn(run.goldBoneTotal, 0, 100_000)
    && isIntegerIn(run.startedAtMs, 0, save.raisingClockMs)
    && save.idHistory.runIds.includes(run.runId);
}

function validRun(run, save) {
  if (!validRunBase(run, save)) return false;

  if (run.economyVersion === ECONOMY_VERSION) {
    return run.rewardScaleBps === RAISING_CONFIG.runRewardScaleBps[run.difficulty]
      && run.fullClearReference === Math.floor((run.normalBoneTotal * RAISING_CONFIG.boneRewardCoins
        + run.goldBoneTotal * RAISING_CONFIG.goldBoneRewardCoins) * run.rewardScaleBps / 10_000)
        + Math.floor(RAISING_CONFIG.clearBonusCoins * run.rewardScaleBps / 10_000);
  }

  if (run.economyVersion !== LEGACY_PROVISIONAL_ECONOMY_VERSION
    || run.rewardScaleBps !== LEGACY_PROVISIONAL_ECONOMY.runRewardScaleBps[run.difficulty]) return false;

  // SaveStore.open validates before acquire. Accept exactly the previous known
  // economy so its existing ownership-change transaction can abandon the run
  // and back up the untouched old save. Unknown versions never reach this path.
  let expectedBoneTotals;
  try {
    expectedBoneTotals = countCourseBones(createRaisingCourse(run.seed, run.difficulty));
  } catch {
    return false;
  }
  if (run.normalBoneTotal !== expectedBoneTotals.normal || run.goldBoneTotal !== expectedBoneTotals.gold) return false;
  const previousScale = run.rewardScaleBps / 10_000;
  const previousFullClearReference = Math.floor((run.normalBoneTotal * LEGACY_PROVISIONAL_ECONOMY.boneRewardCoins
    + run.goldBoneTotal * LEGACY_PROVISIONAL_ECONOMY.goldBoneRewardCoins) * previousScale)
    + Math.floor(LEGACY_PROVISIONAL_ECONOMY.clearBonusCoins * previousScale);
  return run.fullClearReference === previousFullClearReference;
}

export function validateSave(value) {
  if (!hasExactKeys(value, TOP_LEVEL_KEYS)) return { ok: false, error: 'invalid-save-shape' };
  if (value.schemaVersion !== RAISING_CONFIG.schemaVersion) return { ok: false, error: 'unsupported-save-version' };
  if (!isIntegerIn(value.revision, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'invalid-revision' };
  if (typeof value.saveGeneration !== 'string' || value.saveGeneration.length < 1 || value.saveGeneration.length > MAX_ID_LENGTH) return { ok: false, error: 'invalid-save-generation' };
  if (!isIntegerIn(value.coins, 0, MAX_COINS)) return { ok: false, error: 'invalid-coins' };
  if (!hasExactKeys(value.dog, ['name', 'hunger', 'energy', 'mood'])
    || typeof value.dog.name !== 'string' || value.dog.name.trim().length < 1 || value.dog.name.length > 32
    || !isFiniteNumber(value.dog.hunger) || value.dog.hunger < 0 || value.dog.hunger > 100
    || !isIntegerIn(value.dog.energy, 0, 100) || !isIntegerIn(value.dog.mood, 0, 100)) return { ok: false, error: 'invalid-dog' };
  if (!hasExactKeys(value.owned, ['houseLevel', 'toys', 'decorations'])
    || !isIntegerIn(value.owned.houseLevel, 1, 5)
    || !isUniqueStringArray(value.owned.toys, id => TOY_BY_ID.has(id), TOY_ITEMS.length)
    || !value.owned.toys.includes('starterBall')
    || !isUniqueStringArray(value.owned.decorations, id => DECORATION_BY_ID.has(id), DECORATION_ITEMS.length)) return { ok: false, error: 'invalid-owned-items' };
  if (!hasExactKeys(value.equipped, ['toy', 'bed', 'decorations'])
    || !value.owned.toys.includes(value.equipped.toy)
    || (value.equipped.bed !== null && (value.equipped.bed !== 'bed' || !value.owned.decorations.includes('bed')))
    || !isUniqueStringArray(value.equipped.decorations, id => DECORATION_BY_ID.has(id) && id !== 'bed', DECORATION_ITEMS.length)
    || value.equipped.decorations.some(id => !value.owned.decorations.includes(id))) return { ok: false, error: 'invalid-equipped-items' };
  if (!hasExactKeys(value.inventory, FOOD_ITEMS.map(item => item.id))
    || FOOD_ITEMS.some(item => !isIntegerIn(value.inventory[item.id], 0, 100_000))) return { ok: false, error: 'invalid-inventory' };
  if (!hasExactKeys(value.settings, ['soundEnabled', 'musicEnabled', 'musicVolume', 'sfxVolume', 'reducedMotion', 'roadDecoration'])
    || typeof value.settings.soundEnabled !== 'boolean' || typeof value.settings.musicEnabled !== 'boolean'
    || !isFiniteNumber(value.settings.musicVolume) || value.settings.musicVolume < 0 || value.settings.musicVolume > 1
    || !isFiniteNumber(value.settings.sfxVolume) || value.settings.sfxVolume < 0 || value.settings.sfxVolume > 1
    || typeof value.settings.reducedMotion !== 'boolean' || !ROAD_DECORATION.has(value.settings.roadDecoration)) return { ok: false, error: 'invalid-settings' };

  const recordKeys = ['unlockedDifficulty', 'runsStarted', 'runsCleared', 'runsFailed', 'totalCoinsEarned', 'totalCoinsSpent', 'legacyMigrationVersion', 'legacyPlayEvidence', 'ruleRecords', 'lastRun', 'lastExportAt'];
  if (!hasExactKeys(value.records, recordKeys)
    || !isIntegerIn(value.records.unlockedDifficulty, 1, 5)
    || !isIntegerIn(value.records.runsStarted, 0, 1_000_000_000)
    || !isIntegerIn(value.records.runsCleared, 0, 1_000_000_000)
    || !isIntegerIn(value.records.runsFailed, 0, 1_000_000_000)
    || !isIntegerIn(value.records.totalCoinsEarned, 0, MAX_COINS)
    || !isIntegerIn(value.records.totalCoinsSpent, 0, MAX_COINS)
    || !isIntegerIn(value.records.legacyMigrationVersion, 0, 1)
    || !Array.isArray(value.records.legacyPlayEvidence) || value.records.legacyPlayEvidence.length > 32
    || !value.records.legacyPlayEvidence.every(evidence => hasExactKeys(evidence, ['key', 'highScore', 'maxCombo'])
      && typeof evidence.key === 'string' && evidence.key.length > 0 && evidence.key.length <= 128
      && isIntegerIn(evidence.highScore, 1, 1_000_000_000) && isIntegerIn(evidence.maxCombo, 0, 1_000_000_000))
    || !validRecordList(value.records.ruleRecords)
    || (value.records.lastRun !== null && (!hasExactKeys(value.records.lastRun, ['runId', 'difficulty', 'outcome', 'reward'])
      || typeof value.records.lastRun.runId !== 'string' || !isIntegerIn(value.records.lastRun.difficulty, 1, 5)
      || !['clear', 'failure', 'cancelled'].includes(value.records.lastRun.outcome)
      || !isIntegerIn(value.records.lastRun.reward, 0, MAX_COINS)))
    || (value.records.lastExportAt !== null && (typeof value.records.lastExportAt !== 'string'
      || !Number.isFinite(Date.parse(value.records.lastExportAt))
      || new Date(value.records.lastExportAt).toISOString() !== value.records.lastExportAt))) return { ok: false, error: 'invalid-records' };
  if (!isIntegerIn(value.raisingClockMs, 0, Number.MAX_SAFE_INTEGER)
    || !isFiniteNumber(value.moodDecayDebt) || value.moodDecayDebt < 0 || value.moodDecayDebt >= 1) return { ok: false, error: 'invalid-clock-or-mood-debt' };
  if (!hasExactKeys(value.petting, ['lastGainAtMs', 'history', 'gestureIds'])
    || (value.petting.lastGainAtMs !== null && !isIntegerIn(value.petting.lastGainAtMs, 0, Number.MAX_SAFE_INTEGER))
    || !Array.isArray(value.petting.history) || value.petting.history.length > 128
    || !value.petting.history.every(entry => hasExactKeys(entry, ['atMs', 'gain'])
      && isIntegerIn(entry.atMs, 0, value.raisingClockMs) && isIntegerIn(entry.gain, 1, RAISING_CONFIG.petMoodGain))
    || !isUniqueStringArray(value.petting.gestureIds, isId, RAISING_CONFIG.idHistoryLimit)) return { ok: false, error: 'invalid-petting' };
  if (!hasExactKeys(value.naturalLossSession, ['sessionId', 'used'])
    || (value.naturalLossSession.sessionId !== null && (typeof value.naturalLossSession.sessionId !== 'string'
      || value.naturalLossSession.sessionId.length < 1 || value.naturalLossSession.sessionId.length > MAX_ID_LENGTH))
    || !isIntegerIn(value.naturalLossSession.used, 0, RAISING_CONFIG.naturalMoodLossPerSessionCap)) return { ok: false, error: 'invalid-natural-loss-session' };
  if (!hasExactKeys(value.idHistory, ['runIds', 'actionIds'])
    || !isUniqueStringArray(value.idHistory.runIds, isId, RAISING_CONFIG.idHistoryLimit)
    || !isUniqueStringArray(value.idHistory.actionIds, isId, RAISING_CONFIG.idHistoryLimit)) return { ok: false, error: 'invalid-id-history' };
  if (!hasExactKeys(value.raisingRng, ['algorithm', 'state', 'drawCount', 'idleMs'])
    || value.raisingRng.algorithm !== 'xorshift32-v1'
    || !isIntegerIn(value.raisingRng.state, 0, 0xffff_ffff)
    || !isIntegerIn(value.raisingRng.drawCount, 0, Number.MAX_SAFE_INTEGER)
    || !isIntegerIn(value.raisingRng.idleMs, 0, RAISING_CONFIG.spontaneousSleepIntervalMs - 1)) return { ok: false, error: 'invalid-raising-rng' };
  if ((value.activeRun !== null && !validRun(value.activeRun, value))
    || (value.activeAction !== null && !validAction(value.activeAction, value))) return { ok: false, error: 'invalid-active-operation' };
  if (value.activeRun && value.activeAction) return { ok: false, error: 'run-and-action-cannot-overlap' };
  return { ok: true };
}

/**
 * Normalizes only the immediately preceding local v2 candidate shape. It adds
 * fields introduced by this implementation and rejects every other unknown,
 * missing, or malformed field instead of attempting a broad repair.
 * A save may retain an active run only when it matches the exact known
 * provisional economy profile. This lets SaveStore.open validate the prior
 * state; SaveStore.acquire then clears a non-resumable active run in its
 * ownership-change transaction while retaining the prior save as backup.
 * The current model refuses to settle that old run for currency; explicit
 * cancelRun remains a zero-reward abandonment path.
 */
export function migrateCandidateSave(value) {
  if (!isObject(value) || value.schemaVersion !== RAISING_CONFIG.schemaVersion || !isObject(value.records)) {
    return { ok: false, error: 'unsupported-candidate-save' };
  }
  const normalized = cloneSave(value);
  const recordKeysBeforeExport = ['unlockedDifficulty', 'runsStarted', 'runsCleared', 'runsFailed', 'totalCoinsEarned', 'totalCoinsSpent', 'legacyMigrationVersion', 'legacyPlayEvidence', 'ruleRecords', 'lastRun'];
  const recordKeysCurrent = [...recordKeysBeforeExport, 'lastExportAt'];
  const originalRecordKeys = Object.keys(value.records).sort();
  if (originalRecordKeys.join('\n') === [...recordKeysBeforeExport].sort().join('\n')) normalized.records.lastExportAt = null;
  else if (originalRecordKeys.join('\n') !== [...recordKeysCurrent].sort().join('\n')) return { ok: false, error: 'unsupported-candidate-save' };

  const originalTopKeys = Object.keys(value).sort();
  const topKeysBeforeRng = TOP_LEVEL_KEYS.filter(key => key !== 'raisingRng').sort();
  if (originalTopKeys.join('\n') === topKeysBeforeRng.join('\n')) {
    normalized.raisingRng = { algorithm: 'xorshift32-v1', state: 0, drawCount: 0, idleMs: 0 };
  } else if (originalTopKeys.join('\n') !== [...TOP_LEVEL_KEYS].sort().join('\n')) return { ok: false, error: 'unsupported-candidate-save' };

  const result = validateSave(normalized);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, save: normalized, migrated: originalTopKeys.join('\n') !== [...TOP_LEVEL_KEYS].sort().join('\n')
    || originalRecordKeys.join('\n') !== [...recordKeysCurrent].sort().join('\n') };
}

function actionCommandIdValid(command) {
  return isId(command.actionId)
    && typeof command.ownerTabId === 'string' && command.ownerTabId.length > 0 && command.ownerTabId.length <= MAX_ID_LENGTH
    && isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER);
}

function startAction(state, command, details) {
  if (state.activeRun) return failed(state, 'run-active');
  if (!actionCommandIdValid(command)) return failed(state, 'invalid-action-owner-or-id');
  if (state.idHistory.actionIds.includes(command.actionId)) return failed(state, 'action-id-already-used');
  const next = cloneSave(state);
  const cancelledActionId = next.activeAction?.actionId ?? null;
  next.activeAction = {
    saveGeneration: next.saveGeneration,
    actionId: command.actionId,
    ownerTabId: command.ownerTabId,
    ownerEpoch: command.ownerEpoch,
    kind: details.kind,
    cycleIndex: 0,
    elapsedActiveMs: 0,
    status: 'running',
    chargedCost: details.chargedCost,
    compensationState: details.chargedCost > 0 ? 'not-eligible' : 'not-eligible',
    energyPerCycle: details.energyPerCycle,
    bedEquipped: details.bedEquipped,
    toyId: details.toyId,
    startedAtMs: next.raisingClockMs,
  };
  next.raisingRng.idleMs = 0;
  next.idHistory.actionIds = boundedAppend(next.idHistory.actionIds, command.actionId);
  return succeeded(next, {
    actionId: command.actionId,
    kind: details.kind,
    chargedCost: details.chargedCost,
    energyPerCycle: details.energyPerCycle,
    bedEquipped: details.bedEquipped,
    cancelledActionId,
  });
}

function applyPurchase(state, command) {
  if (state.activeRun) return failed(state, 'run-active');
  const item = SHOP_BY_ID.get(command.itemId);
  const food = FOOD_BY_ID.get(command.itemId);
  if (!item && !food) return failed(state, 'unknown-item');
  if (item?.type === 'house') {
    if (item.level !== state.owned.houseLevel + 1 || item.level !== HOUSE_LEVEL_PRICES_LEVEL(item.id)) return failed(state, 'house-level-out-of-order');
  } else if (item?.type === 'toy' && state.owned.toys.includes(item.id)) return failed(state, 'item-already-owned');
  else if (item?.type === 'decoration' && state.owned.decorations.includes(item.id)) return failed(state, 'item-already-owned');
  const price = item?.price ?? food.price;
  if (state.coins < price) return failed(state, 'insufficient-coins');

  const next = cloneSave(state);
  next.raisingRng.idleMs = 0;
  next.coins -= price;
  next.records.totalCoinsSpent = Math.min(MAX_COINS, next.records.totalCoinsSpent + price);
  if (food) next.inventory[food.id] = Math.min(100_000, next.inventory[food.id] + 1);
  else if (item.type === 'house') next.owned.houseLevel = item.level;
  else if (item.type === 'toy') next.owned.toys.push(item.id);
  else if (item.type === 'decoration') next.owned.decorations.push(item.id);
  return succeeded(next, { itemId: command.itemId, price, coins: next.coins, quantity: food ? next.inventory[food.id] : undefined });
}

function HOUSE_LEVEL_PRICES_LEVEL(itemId) {
  const item = HOUSE_BY_ID.get(itemId);
  return item?.level ?? null;
}

function advanceMood(state, hunger, elapsedMs) {
  const hungerState = getHungerState(hunger);
  const period = hungerState === 'veryHungry'
    ? RAISING_CONFIG.naturalMoodLossMs.veryHungry
    : hungerState === 'hungry' ? RAISING_CONFIG.naturalMoodLossMs.hungry : null;
  if (period === null || state.naturalLossSession.used >= RAISING_CONFIG.naturalMoodLossPerSessionCap) {
    return { mood: state.dog.mood, debt: state.moodDecayDebt, used: state.naturalLossSession.used, loss: 0 };
  }

  let debt = state.moodDecayDebt + elapsedMs / period;
  const due = Math.floor(debt + 1e-10);
  if (due <= 0) return { mood: state.dog.mood, debt, used: state.naturalLossSession.used, loss: 0 };
  const allowance = RAISING_CONFIG.naturalMoodLossPerSessionCap - state.naturalLossSession.used;
  const loss = Math.min(due, allowance, state.dog.mood);
  debt -= due;
  if (state.dog.mood === 0) debt = 0;
  return { mood: state.dog.mood - loss, debt: Math.max(0, debt), used: state.naturalLossSession.used + loss, loss };
}

function advanceNeeds(state, elapsedMs) {
  const risePerMs = RAISING_CONFIG.hungerRisePerMinute / 60_000;
  let remaining = elapsedMs;
  let hunger = state.dog.hunger;
  let mood = state.dog.mood;
  let debt = state.moodDecayDebt;
  let used = state.naturalLossSession.used;
  let naturalLoss = 0;

  // Split at hunger-state boundaries so a long visible tick does not apply one
  // mood rate to time spent in another state.
  while (remaining > 1e-7) {
    const currentState = getHungerState(hunger);
    const nextThreshold = currentState === 'sated' ? RAISING_CONFIG.hungryAt
      : currentState === 'hungry' ? RAISING_CONFIG.veryHungryAt : 100;
    const untilThreshold = hunger >= nextThreshold || risePerMs === 0
      ? remaining
      : Math.max(0, (nextThreshold - hunger) / risePerMs);
    const segment = Math.min(remaining, untilThreshold > 1e-7 ? untilThreshold : remaining);
    const moodStep = advanceMood({ ...state, dog: { ...state.dog, mood }, moodDecayDebt: debt, naturalLossSession: { ...state.naturalLossSession, used } }, hunger, segment);
    mood = moodStep.mood;
    debt = moodStep.debt;
    used = moodStep.used;
    naturalLoss += moodStep.loss;
    hunger = Math.min(100, hunger + segment * risePerMs);
    remaining -= segment;
  }

  return { hunger, mood, debt, used, naturalLoss };
}

function advanceAction(state, elapsedMs) {
  if (!state.activeAction || elapsedMs === 0) return { action: state.activeAction, energy: state.dog.energy, completed: false, recharge: 0 };
  const action = { ...state.activeAction };
  if (action.kind === 'play') {
    const elapsed = action.elapsedActiveMs + elapsedMs;
    if (elapsed >= RAISING_CONFIG.playDurationMs) return { action: null, energy: state.dog.energy, completed: true, recharge: 0 };
    action.elapsedActiveMs = elapsed;
    return { action, energy: state.dog.energy, completed: false, recharge: 0 };
  }

  const total = action.elapsedActiveMs + elapsedMs;
  const cycles = Math.floor(total / RAISING_CONFIG.restCycleMs);
  const remainder = total % RAISING_CONFIG.restCycleMs;
  const requestedEnergy = cycles * action.energyPerCycle;
  const energy = Math.min(100, state.dog.energy + requestedEnergy);
  const recharge = energy - state.dog.energy;
  if (energy >= 100) return { action: null, energy, completed: true, recharge };
  action.elapsedActiveMs = remainder;
  action.cycleIndex += cycles;
  return { action, energy, completed: false, recharge };
}

function hashSeed(text) {
  let state = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return (state >>> 0) || 0x9e3779b9;
}

function nextRaisingRandom(rng, saveGeneration) {
  let state = rng.state || hashSeed(saveGeneration);
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  if (state === 0) state = 0x9e3779b9;
  return { value: state / 0x1_0000_0000, state };
}

function sleepChanceForEnergy(energy) {
  if (energy >= RAISING_CONFIG.spontaneousSleepEnergyHigh) return RAISING_CONFIG.spontaneousSleepChance.highEnergy;
  if (energy >= RAISING_CONFIG.spontaneousSleepEnergyMedium) return RAISING_CONFIG.spontaneousSleepChance.mediumEnergy;
  return RAISING_CONFIG.spontaneousSleepChance.lowEnergy;
}

function createSleepAction(state, command) {
  if (!actionCommandIdValid(command) || state.idHistory.actionIds.includes(command.actionId)) return null;
  const bedEquipped = state.equipped.bed === 'bed';
  return {
    saveGeneration: state.saveGeneration,
    actionId: command.actionId,
    ownerTabId: command.ownerTabId,
    ownerEpoch: command.ownerEpoch,
    kind: 'sleep',
    cycleIndex: 0,
    elapsedActiveMs: 0,
    status: 'running',
    chargedCost: 0,
    compensationState: 'not-eligible',
    energyPerCycle: bedEquipped ? RAISING_CONFIG.restEnergyBed : RAISING_CONFIG.restEnergyGround,
    bedEquipped,
    toyId: null,
    startedAtMs: state.raisingClockMs,
  };
}

function advanceIdleAndSleep(state, command, elapsedMs) {
  if (command.context?.idle === false) {
    return { rng: { ...state.raisingRng, idleMs: 0 }, action: null, energy: state.dog.energy, actionCompleted: false, recharge: 0, sleepRolls: 0, sleepProbability: null, spontaneousSleep: false, actionStarted: false };
  }
  let remaining = elapsedMs;
  let idleMs = state.raisingRng.idleMs;
  let rng = { ...state.raisingRng };
  let action = null;
  let energy = state.dog.energy;
  let actionCompleted = false;
  let recharge = 0;
  let sleepRolls = 0;
  let sleepProbability = null;
  let spontaneousSleep = false;
  let actionStarted = false;

  while (remaining > 0) {
    const untilRoll = RAISING_CONFIG.spontaneousSleepIntervalMs - idleMs;
    const segment = Math.min(remaining, untilRoll);
    idleMs += segment;
    remaining -= segment;
    if (idleMs < RAISING_CONFIG.spontaneousSleepIntervalMs) break;

    idleMs = 0;
    const random = nextRaisingRandom(rng, state.saveGeneration);
    rng.state = random.state;
    rng.drawCount += 1;
    sleepRolls += 1;
    sleepProbability = sleepChanceForEnergy(energy);
    if (random.value >= sleepProbability) continue;

    spontaneousSleep = true;
    action = createSleepAction(state, command);
    if (!action) break;
    actionStarted = true;
    rng.idleMs = 0;
    if (remaining > 0) {
      const progressed = advanceAction({ ...state, activeAction: action, dog: { ...state.dog, energy } }, remaining);
      action = progressed.action;
      energy = progressed.energy;
      recharge += progressed.recharge;
      actionCompleted = progressed.completed;
    }
    break;
  }

  rng.idleMs = actionStarted ? 0 : idleMs;
  return { rng, action, energy, actionCompleted, recharge, sleepRolls, sleepProbability, spontaneousSleep, actionStarted };
}

function applyTick(state, command) {
  if (!Number.isInteger(command.elapsedMs) || command.elapsedMs < 0 || command.elapsedMs > MAX_TICK_MS) return failed(state, 'invalid-elapsed-ms');
  const sessionId = typeof command.sessionId === 'string' && command.sessionId.length > 0 && command.sessionId.length <= MAX_ID_LENGTH
    ? command.sessionId : null;
  const context = isObject(command.context) ? command.context : {};
  const canAdvance = context.isOwner === true && context.foreground === true && context.paused !== true && !state.activeRun;
  if (!canAdvance) return succeeded(state, { advanced: false, elapsedMs: 0, naturalMoodLoss: 0, recharge: 0, actionCompleted: false });
  if (command.elapsedMs === 0 && (sessionId === null || sessionId === state.naturalLossSession.sessionId)) {
    return succeeded(state, { advanced: false, elapsedMs: 0, naturalMoodLoss: 0, recharge: 0, actionCompleted: false });
  }
  const next = cloneSave(state);
  if (sessionId !== null && next.naturalLossSession.sessionId !== sessionId) {
    next.naturalLossSession = { sessionId, used: 0 };
  }
  if (command.elapsedMs === 0) {
    return succeeded(next, { advanced: false, elapsedMs: 0, naturalMoodLoss: 0, recharge: 0, actionCompleted: false });
  }

  const needs = advanceNeeds(next, command.elapsedMs);
  const action = state.activeAction
    ? advanceAction(next, command.elapsedMs)
    : advanceIdleAndSleep(next, command, command.elapsedMs);
  next.raisingClockMs += command.elapsedMs;
  next.dog.hunger = needs.hunger;
  next.dog.mood = needs.mood;
  next.moodDecayDebt = needs.debt;
  next.naturalLossSession.used = needs.used;
  next.dog.energy = action.energy;
  next.activeAction = action.action;
  next.raisingRng = action.rng ?? { ...next.raisingRng, idleMs: 0 };
  if (action.actionStarted && command.actionId) next.idHistory.actionIds = boundedAppend(next.idHistory.actionIds, command.actionId);
  return succeeded(next, {
    advanced: true,
    elapsedMs: command.elapsedMs,
    raisingClockMs: next.raisingClockMs,
    hungerState: getHungerState(next.dog.hunger),
    naturalMoodLoss: needs.naturalLoss,
    recharge: action.recharge,
    actionCompleted: action.completed,
    sleepRolls: action.sleepRolls ?? 0,
    sleepProbability: action.sleepProbability ?? null,
    spontaneousSleep: action.spontaneousSleep ?? false,
    actionStarted: action.actionStarted ?? false,
    actionKind: action.action?.kind ?? null,
    actionId: action.action?.actionId ?? (action.actionStarted ? command.actionId : state.activeAction?.actionId ?? null),
    cycleIndex: next.activeAction?.cycleIndex ?? null,
  });
}

function applyPet(state, command) {
  if (state.activeRun) return failed(state, 'run-active');
  const gestureId = command.gestureId;
  if (!isId(gestureId)) return failed(state, 'gesture-id-required');
  if (state.petting.gestureIds.includes(gestureId)) return failed(state, 'gesture-already-used');
  const nowMs = command.nowMs ?? state.raisingClockMs;
  if (!Number.isInteger(nowMs) || nowMs !== state.raisingClockMs) return failed(state, 'pet-clock-mismatch');

  const recent = state.petting.history.filter(entry => entry.atMs > nowMs - RAISING_CONFIG.petRollingWindowMs && entry.atMs <= nowMs);
  const rollingGain = recent.reduce((sum, entry) => sum + entry.gain, 0);
  const cooldownReady = state.petting.lastGainAtMs === null || nowMs - state.petting.lastGainAtMs >= RAISING_CONFIG.petCooldownMs;
  const gain = cooldownReady
    ? Math.min(RAISING_CONFIG.petMoodGain, 100 - state.dog.mood, RAISING_CONFIG.petRollingGainCap - rollingGain)
    : 0;
  if (gain <= 0) {
    return succeeded(state, {
      gestureId,
      gain: 0,
      mood: state.dog.mood,
      cooldownReady,
      rollingGain,
      cancelledActionId: null,
      noop: true,
    });
  }
  const next = cloneSave(state);
  next.raisingRng.idleMs = 0;
  const cancelledActionId = next.activeAction?.actionId ?? null;
  next.activeAction = null;
  next.petting.history = recent;
  next.petting.gestureIds = boundedAppend(next.petting.gestureIds, gestureId);
  if (gain > 0) {
    next.dog.mood += gain;
    next.petting.lastGainAtMs = nowMs;
    next.petting.history.push({ atMs: nowMs, gain });
  }
  return succeeded(next, { gestureId, gain, mood: next.dog.mood, cooldownReady, rollingGain: rollingGain + gain, cancelledActionId });
}

function applyRunBegin(state, command) {
  if (!isId(command.runId) || !isIntegerIn(command.ownerEpoch, 0, Number.MAX_SAFE_INTEGER)) return failed(state, 'invalid-run-id-or-owner');
  if (!isIntegerIn(command.difficulty, 1, 5) || command.difficulty > state.records.unlockedDifficulty) return failed(state, 'difficulty-locked');
  if (!Number.isInteger(command.seed)) return failed(state, 'invalid-seed');
  if (state.activeRun) return failed(state, 'run-already-active');
  if (state.idHistory.runIds.includes(command.runId)) return failed(state, 'run-id-already-used');

  const next = cloneSave(state);
  const cancelledActionId = next.activeAction?.actionId ?? null;
  next.activeAction = null;
  next.raisingRng.idleMs = 0;
  const course = createRaisingCourse(command.seed, command.difficulty);
  const totals = countCourseBones(course);
  const rewardScaleBps = RAISING_CONFIG.runRewardScaleBps[command.difficulty];
  const fullClearReference = calculateFullClearReference(course, command.difficulty);
  next.activeRun = {
    saveGeneration: next.saveGeneration,
    runId: command.runId,
    economyVersion: ECONOMY_VERSION,
    seed: normalizeSeed(command.seed),
    difficulty: command.difficulty,
    ownerEpoch: command.ownerEpoch,
    status: 'running',
    fullClearReference,
    normalBoneTotal: totals.normal,
    goldBoneTotal: totals.gold,
    rewardScaleBps,
    startedAtMs: next.raisingClockMs,
  };
  next.idHistory.runIds = boundedAppend(next.idHistory.runIds, command.runId);
  next.records.runsStarted += 1;
  return succeeded(next, { runId: command.runId, difficulty: command.difficulty, seed: next.activeRun.seed, economyVersion: ECONOMY_VERSION, rewardScaleBps, fullClearReference, cancelledActionId });
}

function applyRunSettlement(state, command, cancelled = false) {
  if (!state.activeRun || command.runId !== state.activeRun.runId) return failed(state, 'active-run-mismatch');
  const next = cloneSave(state);
  const active = next.activeRun;
  if (cancelled) {
    next.activeRun = null;
    next.records.lastRun = { runId: active.runId, difficulty: active.difficulty, outcome: 'cancelled', reward: 0 };
    return succeeded(next, { runId: active.runId, outcome: 'cancelled', reward: 0, coins: next.coins });
  }
  if (active.economyVersion !== ECONOMY_VERSION) return failed(state, 'run-economy-version-mismatch');

  const outcome = command.result?.outcome ?? (command.result?.completed === true ? 'clear' : 'failure');
  if (!['clear', 'failure'].includes(outcome)) return failed(state, 'invalid-run-outcome');
  const input = command.result ?? {};
  const normalCollected = Math.max(0, Math.min(active.normalBoneTotal, Math.trunc(Number(input.normalCollected) || 0)));
  const goldCollected = Math.max(0, Math.min(active.goldBoneTotal, Math.trunc(Number(input.goldCollected) || 0)));
  const earnedBase = Math.floor((normalCollected * RAISING_CONFIG.boneRewardCoins
    + goldCollected * RAISING_CONFIG.goldBoneRewardCoins) * active.rewardScaleBps / 10_000);
  const clearBonus = Math.floor(RAISING_CONFIG.clearBonusCoins * active.rewardScaleBps / 10_000);
  const reward = outcome === 'clear'
    ? Math.min(active.fullClearReference, earnedBase + clearBonus)
    : Math.max(0, Math.floor(Math.min(
      earnedBase * RAISING_CONFIG.failureMultipliers[active.difficulty],
      0.70 * active.fullClearReference,
    )));
  const holeIds = Array.isArray(input.holeIds) ? [...new Set(input.holeIds.filter(id => typeof id === 'string' && id.length <= 128))].slice(0, 32) : [];
  const holeMoodLoss = Math.min(3 * holeIds.length, next.dog.mood);
  next.dog.mood -= holeMoodLoss;
  next.coins = Math.min(MAX_COINS, next.coins + reward);
  next.records.totalCoinsEarned = Math.min(MAX_COINS, next.records.totalCoinsEarned + reward);
  if (outcome === 'clear') {
    next.records.runsCleared += 1;
    next.records.unlockedDifficulty = Math.max(next.records.unlockedDifficulty, Math.min(5, active.difficulty + 1));
  } else next.records.runsFailed += 1;
  next.records.lastRun = { runId: active.runId, difficulty: active.difficulty, outcome, reward };
  next.activeRun = null;
  return succeeded(next, {
    runId: active.runId,
    difficulty: active.difficulty,
    outcome,
    normalCollected,
    goldCollected,
    earnedBase,
    fullClearReference: active.fullClearReference,
    reward,
    coins: next.coins,
    holeMoodLoss,
  });
}

function applyLegacyMigration(state, command) {
  if (state.records.legacyMigrationVersion !== 0) return failed(state, 'legacy-migration-already-applied');
  if (!Array.isArray(command.records) || command.records.length > 32) return failed(state, 'invalid-legacy-records');
  const records = [];
  for (const input of command.records) {
    if (!isObject(input)) return failed(state, 'invalid-legacy-record');
    const key = input.key;
    const highScore = input.highScore;
    const maxCombo = input.maxCombo ?? 0;
    if (typeof key !== 'string' || key.length < 1 || key.length > 128
      || !isIntegerIn(highScore, 0, 1_000_000_000) || !isIntegerIn(maxCombo, 0, 1_000_000_000)) return failed(state, 'invalid-legacy-record');
    records.push({ key, highScore, maxCombo });
  }
  if (new Set(records.map(record => record.key)).size !== records.length) return failed(state, 'duplicate-legacy-rule');
  const next = cloneSave(state);
  next.records.ruleRecords = records;
  next.records.legacyPlayEvidence = records.filter(record => record.highScore > 0).map(({ key, highScore, maxCombo }) => ({ key, highScore, maxCombo }));
  if (next.records.legacyPlayEvidence.length > 0) next.records.unlockedDifficulty = Math.max(2, next.records.unlockedDifficulty);
  next.records.legacyMigrationVersion = 1;
  return succeeded(next, { importedRecords: records.length, legacyPlayEvidence: next.records.legacyPlayEvidence.length, unlockedDifficulty: next.records.unlockedDifficulty });
}

function applyCommandUnchecked(save, command) {
  if (!isObject(command) || typeof command.type !== 'string') return failed(save, 'invalid-command');
  switch (command.type) {
    case 'tick': return applyTick(save, command);
    case 'pet': return applyPet(save, command);
    case 'rest': {
      if (isId(command.actionId) && save.idHistory.actionIds.includes(command.actionId)) return failed(save, 'action-id-already-used');
      if (save.dog.energy >= 100) return failed(save, 'energy-already-full');
      const bedEquipped = save.equipped.bed === 'bed';
      return startAction(save, command, {
        kind: 'rest', chargedCost: 0, bedEquipped,
        energyPerCycle: bedEquipped ? RAISING_CONFIG.restEnergyBed : RAISING_CONFIG.restEnergyGround,
        toyId: null,
      });
    }
    case 'play': {
      if (isId(command.actionId) && save.idHistory.actionIds.includes(command.actionId)) return failed(save, 'action-id-already-used');
      const toyId = command.toyId ?? command.itemId;
      const toy = TOY_BY_ID.get(toyId);
      if (!toy || !save.owned.toys.includes(toyId)) return failed(save, 'toy-not-owned');
      if (save.equipped.toy !== toyId) return failed(save, 'toy-not-equipped');
      if (save.dog.energy < toy.minEnergy) return failed(save, 'energy-too-low');
      const next = cloneSave(save);
      next.dog.energy -= toy.energyCost;
      const started = startAction(next, command, { kind: 'play', chargedCost: toy.energyCost, bedEquipped: false, energyPerCycle: 0, toyId });
      if (!started.ok) return failed(save, started.error);
      started.result.energy = started.save.dog.energy;
      return started;
    }
    case 'finishAction':
    case 'cancelAction': {
      if (!save.activeAction || command.actionId !== save.activeAction.actionId) return failed(save, 'active-action-mismatch');
      const next = cloneSave(save);
      const action = next.activeAction;
      if (command.type === 'finishAction' && action.kind !== 'play') return failed(save, 'rest-finishes-by-cycle');
      next.activeAction = null;
      next.raisingRng.idleMs = 0;
      return succeeded(next, { actionId: action.actionId, kind: action.kind, outcome: command.type === 'finishAction' ? 'completed' : 'cancelled', chargedCost: action.chargedCost, refunded: 0 });
    }
    case 'feed': {
      if (save.activeRun) return failed(save, 'run-active');
      const food = FOOD_BY_ID.get(command.foodId);
      if (!food) return failed(save, 'unknown-food');
      if (save.inventory[food.id] <= 0) return failed(save, 'food-not-owned');
      const next = cloneSave(save);
      const cancelledActionId = next.activeAction?.actionId ?? null;
      next.activeAction = null;
      next.inventory[food.id] -= 1;
      next.raisingRng.idleMs = 0;
      next.dog.hunger = Math.max(0, next.dog.hunger - food.hungerRecovery);
      next.dog.energy = Math.min(100, next.dog.energy + food.energyRecovery);
      next.dog.mood = Math.min(100, next.dog.mood + food.moodRecovery);
      return succeeded(next, { foodId: food.id, hungerRecovery: food.hungerRecovery, energyRecovery: food.energyRecovery, moodRecovery: food.moodRecovery, inventory: next.inventory[food.id], cancelledActionId });
    }
    case 'purchase': return applyPurchase(save, command);
    case 'equip': {
      if (save.activeRun) return failed(save, 'run-active');
      const itemId = command.itemId;
      if (TOY_BY_ID.has(itemId)) {
        if (!save.owned.toys.includes(itemId)) return failed(save, 'toy-not-owned');
        if (save.equipped.toy === itemId) return succeeded(save, { itemId, equipped: true, changed: false });
        const next = cloneSave(save);
        next.raisingRng.idleMs = 0;
        next.equipped.toy = itemId;
        return succeeded(next, { itemId, slot: 'toy', equipped: true, changed: true });
      }
      const decoration = DECORATION_BY_ID.get(itemId);
      if (!decoration || !save.owned.decorations.includes(itemId)) return failed(save, 'item-not-owned');
      const next = cloneSave(save);
      next.raisingRng.idleMs = 0;
      if (decoration.kind === 'bed') {
        next.equipped.bed = next.equipped.bed === itemId ? null : itemId;
        return succeeded(next, { itemId, slot: 'bed', equipped: next.equipped.bed === itemId, changed: true });
      }
      const isEquipped = next.equipped.decorations.includes(itemId);
      next.equipped.decorations = isEquipped
        ? next.equipped.decorations.filter(id => id !== itemId)
        : [...next.equipped.decorations, itemId];
      return succeeded(next, { itemId, slot: 'decoration', equipped: !isEquipped, changed: true });
    }
    case 'settings': {
      const patch = command.patch;
      if (!isObject(patch)) return failed(save, 'invalid-settings-patch');
      const allowed = new Set(['soundEnabled', 'musicEnabled', 'musicVolume', 'sfxVolume', 'reducedMotion', 'roadDecoration']);
      if (Object.keys(patch).some(key => !allowed.has(key))) return failed(save, 'unknown-setting');
      const nextSettings = { ...save.settings, ...patch };
      const probe = cloneSave(save);
      probe.settings = nextSettings;
      const validation = validateSave(probe);
      if (!validation.ok) return failed(save, 'invalid-settings-value');
      const changed = Object.keys(patch).some(key => save.settings[key] !== patch[key]);
      if (!changed) return succeeded(save, { changed: false, settings: save.settings });
      const next = cloneSave(save);
      next.raisingRng.idleMs = 0;
      next.settings = nextSettings;
      return succeeded(next, { changed: true, settings: next.settings });
    }
    case 'beginRun': return applyRunBegin(save, command);
    case 'settleRun': return applyRunSettlement(save, command, false);
    case 'cancelRun': return applyRunSettlement(save, command, true);
    case 'legacyMigration': return applyLegacyMigration(save, command);
    case 'exported': {
      if (typeof command.at !== 'string' || !Number.isFinite(Date.parse(command.at))
        || new Date(command.at).toISOString() !== command.at) return failed(save, 'invalid-export-time');
      const next = cloneSave(save);
      next.raisingRng.idleMs = 0;
      next.records.lastExportAt = command.at;
      return succeeded(next, { lastExportAt: command.at });
    }
    default: return failed(save, 'unknown-command');
  }
}

export function applyCommand(save, command) {
  const validation = validateSave(save);
  if (!validation.ok) return failed(save, validation.error);
  try {
    const result = applyCommandUnchecked(save, command);
    if (!result.ok) return result;
    const nextValidation = validateSave(result.save);
    if (!nextValidation.ok) return failed(save, `invalid-transition:${nextValidation.error}`);
    return result;
  } catch (error) {
    return failed(save, error instanceof Error ? `command-error:${error.message}` : 'command-error');
  }
}
