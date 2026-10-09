export const ECONOMY_VERSION = 'raising-economy-designed-1';
export const ECONOMY_STATUS = 'ECONOMY CONFIG DESIGNED';
export const ECONOMY_CONFIG_FINALIZED = true;
export const ECONOMY_HUMAN_REVIEW = 'PENDING';

// New design values. The previous economy sheets were not supplied, so these
// prices are not represented as recovered historical values.
export const HOUSE_LEVEL_PRICES = Object.freeze({ 1: 0, 2: 2_500, 3: 4_000, 4: 7_000, 5: 10_000 });

export const TOY_ITEMS = Object.freeze([
  Object.freeze({ id: 'starterBall', label: 'はじめてのボール', description: '最初から使える、やわらかいボール。', price: 0, energyCost: 5, minEnergy: 15, free: true }),
  Object.freeze({ id: 'premiumBall', label: 'カラフルボール', description: 'よく弾むボール。遊び始めると元気を5使います。', price: 650, energyCost: 5, minEnergy: 15 }),
  Object.freeze({ id: 'rope', label: 'ひっぱりロープ', description: '引っぱりっこ用のロープ。遊び始めると元気を6使います。', price: 900, energyCost: 6, minEnergy: 15 }),
  Object.freeze({ id: 'plush', label: 'ぬいぐるみ', description: 'ゆっくり遊べるぬいぐるみ。遊び始めると元気を2使います。', price: 500, energyCost: 2, minEnergy: 5 }),
  Object.freeze({ id: 'frisbee', label: 'フリスビー', description: '走って追いかけるフリスビー。遊び始めると元気を8使います。', price: 1_200, energyCost: 8, minEnergy: 15 }),
]);

export const DECORATION_ITEMS = Object.freeze([
  Object.freeze({ id: 'cushion', label: 'クッション', description: '庭に置けるやわらかいクッション。', price: 180, kind: 'decoration' }),
  Object.freeze({ id: 'plant', label: '植木', description: '庭を彩る小さな植木。', price: 250, kind: 'decoration' }),
  Object.freeze({ id: 'bed', label: 'ベッド', description: '装備すると休憩1回で元気が18回復します。', price: 350, kind: 'bed' }),
  Object.freeze({ id: 'lamp', label: 'ランプ', description: '夕方の庭を照らすランプ。', price: 450, kind: 'decoration' }),
  Object.freeze({ id: 'fountain', label: '噴水', description: '庭に置ける小さな噴水。', price: 1_200, kind: 'decoration' }),
]);

export const HOUSE_ITEMS = Object.freeze([
  Object.freeze({ id: 'house-2', label: 'おうち Lv.2', description: '犬小屋をひとつ大きくします。', price: HOUSE_LEVEL_PRICES[2], level: 2, type: 'house' }),
  Object.freeze({ id: 'house-3', label: 'おうち Lv.3', description: '犬小屋をさらに大きくします。', price: HOUSE_LEVEL_PRICES[3], level: 3, type: 'house' }),
  Object.freeze({ id: 'house-4', label: 'おうち Lv.4', description: '犬小屋をさらに大きくします。', price: HOUSE_LEVEL_PRICES[4], level: 4, type: 'house' }),
  Object.freeze({ id: 'house-5', label: 'おうち Lv.5', description: '犬小屋を最大まで大きくします。', price: HOUSE_LEVEL_PRICES[5], level: 5, type: 'house' }),
]);

// Designed consumables: kibble is the efficient hunger refill; treats cost more
// per hunger point and also give a small mood boost.
export const FOOD_ITEMS = Object.freeze([
  Object.freeze({ id: 'kibble', label: 'ごはん', description: 'おなかを35回復します。', price: 14, hungerRecovery: 35, energyRecovery: 0, moodRecovery: 0 }),
  Object.freeze({ id: 'treat', label: 'おやつ', description: 'おなかを10、きげんを3回復します。', price: 8, hungerRecovery: 10, energyRecovery: 0, moodRecovery: 3 }),
]);

export const SHOP_ITEMS = Object.freeze([
  ...HOUSE_ITEMS,
  ...TOY_ITEMS.filter(item => !item.free).map(item => Object.freeze({ ...item, type: 'toy' })),
  ...DECORATION_ITEMS.map(item => Object.freeze({ ...item, type: 'decoration' })),
]);

// The profiles and timings below are a deliberately fixed first design for
// repeatable simulation. They are not telemetry or recovered legacy settings.
export const ECONOMY_DESIGN_PROFILE = Object.freeze({
  version: ECONOMY_VERSION,
  provenance: 'New economy design. Earlier v1-v4 economy inputs were unavailable and were not reconstructed.',
  targets: Object.freeze({
    starOneHours: Object.freeze({ min: 7, max: 9 }),
    progressionHours: Object.freeze({ min: 3.5, max: 5.5 }),
    failureEfficiencyMaxRatio: 0.9,
    seeds: 100,
    allPermanentItemsRequired: true,
  }),
  simulation: Object.freeze({
    seedStart: 0,
    seedCount: 100,
    resultAndFastRestartMs: 5_000,
    homeCareMsPerRun: 8_000,
    failureRecoveryMs: 0,
    maxEndpointRuns: 50_000,
    failureCollectionRate: 0.8,
    sensitivityRates: Object.freeze([0.6, 0.8, 1]),
    roundTimeSensitivityMultipliers: Object.freeze([0.9, 1.1]),
  }),
  carePolicy: Object.freeze({
    feedWithKibbleAtOrAboveHunger: 60,
    optionalTreatEveryRuns: 12,
  }),
  profiles: Object.freeze([
    Object.freeze({
      name: 'star1-fixed-design',
      description: '固定★1、完走率78%、取得率72%。設計用の確定profileで実測値ではありません。',
      fixedDifficulty: 1,
      clearProbability: 0.78,
      collectionRate: 0.72,
    }),
    Object.freeze({
      name: 'progression-design',
      description: '★1から★4へclear数で進行、完走率80%、取得率82%。設計用の確定profileで実測値ではありません。',
      difficultyMilestones: Object.freeze([
        Object.freeze({ clears: 0, difficulty: 1 }),
        Object.freeze({ clears: 4, difficulty: 2 }),
        Object.freeze({ clears: 12, difficulty: 3 }),
        Object.freeze({ clears: 40, difficulty: 4 }),
      ]),
      clearProbability: 0.8,
      collectionRate: 0.82,
    }),
  ]),
});

export const RAISING_CONFIG = Object.freeze({
  schemaVersion: 2,
  startingCoins: 0,
  startingDogName: 'ポチ',
  startingHunger: 0,
  startingEnergy: 100,
  startingMood: 70,
  initialRoadDecoration: 'modest',
  initialMusicVolume: 0.35,
  initialSfxVolume: 0.8,
  // These are the new versioned design inputs. Real difficulty feel still needs playtest.
  hungerRisePerMinute: 10,
  hungryAt: 60,
  veryHungryAt: 80,
  naturalMoodLossMs: Object.freeze({ hungry: 180_000, veryHungry: 90_000 }),
  naturalMoodLossPerSessionCap: 10,
  petMoodGain: 3,
  petCooldownMs: 5_000,
  petRollingWindowMs: 60_000,
  petRollingGainCap: 12,
  restCycleMs: 8_000,
  restEnergyGround: 10,
  restEnergyBed: 18,
  playDurationMs: 4_000,
  spontaneousSleepIntervalMs: 30_000,
  spontaneousSleepChance: Object.freeze({ highEnergy: 0.05, mediumEnergy: 0.15, lowEnergy: 0.35 }),
  spontaneousSleepEnergyHigh: 70,
  spontaneousSleepEnergyMedium: 40,
  spontaneousPlayDisabledAtOrBelow: 35,
  runDurationMs: 30_000,
  clearBonusCoins: 5,
  boneRewardCoins: 1,
  goldBoneRewardCoins: 3,
  runRewardScaleBps: Object.freeze({ 1: 14_000, 2: 15_500, 3: 17_000, 4: 18_500, 5: 20_000 }),
  failureMultipliers: Object.freeze({ 1: 0.84, 2: 0.84, 3: 0.84, 4: 0.84, 5: 0.84 }),
  permanentItemTargetCoins: 29_180,
  housePricesTotal: 23_500,
  toyPricesTotal: 3_250,
  decorationPricesTotal: 2_430,
  idHistoryLimit: 128,
});

// Empty: the versioned numerical config is finalized. Human review is tracked separately.
export const ECONOMY_CONFIG_PENDING = Object.freeze([]);

export function getHungerState(hunger) {
  if (hunger >= RAISING_CONFIG.veryHungryAt) return 'veryHungry';
  if (hunger >= RAISING_CONFIG.hungryAt) return 'hungry';
  return 'sated';
}
