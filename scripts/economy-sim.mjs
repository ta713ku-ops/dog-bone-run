import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  DECORATION_ITEMS,
  ECONOMY_CONFIG_PENDING,
  ECONOMY_CONFIG_FINALIZED,
  ECONOMY_DESIGN_PROFILE,
  ECONOMY_HUMAN_REVIEW,
  ECONOMY_STATUS,
  ECONOMY_VERSION,
  FOOD_ITEMS,
  HOUSE_ITEMS,
  RAISING_CONFIG,
  SHOP_ITEMS,
  TOY_ITEMS,
} from '../src/raising-config.js';
import { calculateRunRewardInput } from '../src/raising-model.js';
import { createRaisingCourse } from '../src/raising-course.js';

const SIM = Object.freeze({
  ...ECONOMY_DESIGN_PROFILE.simulation,
  carePolicy: ECONOMY_DESIGN_PROFILE.carePolicy,
  targets: ECONOMY_DESIGN_PROFILE.targets,
  runDurationMs: RAISING_CONFIG.runDurationMs,
});

const SEEDS = Object.freeze(Array.from({ length: SIM.seedCount }, (_, index) => SIM.seedStart + index));
const COURSE_CACHE = new Map();

function routeForReward(seed) {
  if (!COURSE_CACHE.has(seed)) {
    // Difficulty changes hazards, not the collectible route; rewards use the
    // common route so profile simulation does not imply obstacle skill data.
    COURSE_CACHE.set(seed, createRaisingCourse(seed, 1));
  }
  return COURSE_CACHE.get(seed);
}

function hash32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitHash(...parts) {
  return hash32(parts.join(':')) / 0x1_0000_0000;
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  return sortedValues[Math.round((sortedValues.length - 1) * fraction)];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, mean: null, p10: null, median: null, p90: null, min: null, max: null };
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const round = value => Number(value.toFixed(3));
  return {
    count: sorted.length,
    mean: round(mean),
    p10: round(percentile(sorted, 0.1)),
    median: round(percentile(sorted, 0.5)),
    p90: round(percentile(sorted, 0.9)),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
  };
}

function countCollected(course, reachedRatio, collectionRate, seed, scenarioKey) {
  const maxDistance = SIM.runDurationMs / 1000 * reachedRatio;
  let normalCollected = 0;
  let goldCollected = 0;
  for (const bone of course.bones) {
    if (bone.distance > maxDistance + 1e-9) continue;
    if (unitHash(seed, scenarioKey, bone.id, 'pickup') >= collectionRate) continue;
    if (bone.kind === 'gold') goldCollected += 1;
    else normalCollected += 1;
  }
  return { normalCollected, goldCollected };
}

function scenarioConsumableSpend(elapsedMs) {
  const kibble = FOOD_ITEMS.find(item => item.id === 'kibble');
  const treat = FOOD_ITEMS.find(item => item.id === 'treat');
  const kibbleSpend = kibble.price * RAISING_CONFIG.hungerRisePerMinute
    * (elapsedMs / 60_000) / kibble.hungerRecovery;
  const treatSpend = treat.price / SIM.carePolicy.optionalTreatEveryRuns;
  return { kibbleSpend, treatSpend, total: kibbleSpend + treatSpend };
}

function scenarioSample({ seed, difficulty, completed, reachedRatio, collectionRate, scenarioKey }) {
  const course = routeForReward(seed);
  const collected = countCollected(course, completed ? 1 : reachedRatio, collectionRate, seed, scenarioKey);
  const reward = calculateRunRewardInput({ ...collected, completed, difficulty, course });
  const recoveryMs = completed ? 0 : SIM.failureRecoveryMs;
  const elapsedMs = SIM.runDurationMs * (completed ? 1 : reachedRatio)
    + SIM.resultAndFastRestartMs + SIM.homeCareMsPerRun + recoveryMs;
  const spend = scenarioConsumableSpend(elapsedMs);
  const netCoins = reward.reward - spend.total;
  return {
    seed,
    grossCoins: reward.reward,
    netCoins,
    elapsedMs,
    foodSpend: spend.kibbleSpend,
    treatSpend: spend.treatSpend,
    grossCoinsPerMinute: reward.reward / (elapsedMs / 60_000),
    netCoinsPerMinute: netCoins / (elapsedMs / 60_000),
    earnedBase: reward.earnedBase,
    fullClearReference: reward.fullClearReference,
    normalCollected: collected.normalCollected,
    goldCollected: collected.goldCollected,
  };
}

function scenarioSummary({ difficulty, name, completed, reachedRatio, collectionRate }) {
  const samples = SEEDS.map(seed => scenarioSample({
    seed, difficulty, completed, reachedRatio, collectionRate, scenarioKey: name,
  }));
  return {
    name,
    difficulty,
    outcome: completed ? 'clear' : 'failure',
    reachedRatio: completed ? 1 : reachedRatio,
    collectionRate,
    seeds: [0, SEEDS.length - 1],
    grossCoins: summarize(samples.map(sample => sample.grossCoins)),
    netCoins: summarize(samples.map(sample => sample.netCoins)),
    foodSpend: summarize(samples.map(sample => sample.foodSpend)),
    treatSpend: summarize(samples.map(sample => sample.treatSpend)),
    grossCoinsPerMinute: summarize(samples.map(sample => sample.grossCoinsPerMinute)),
    netCoinsPerMinute: summarize(samples.map(sample => sample.netCoinsPerMinute)),
    fullClearReference: summarize(samples.map(sample => sample.fullClearReference)),
    seedMetrics: samples.map(({ seed, grossCoins, netCoins, foodSpend, treatSpend, elapsedMs, grossCoinsPerMinute, netCoinsPerMinute }) => ({
      seed,
      grossCoins,
      netCoins: Number(netCoins.toFixed(3)),
      foodSpend: Number(foodSpend.toFixed(3)),
      treatSpend: Number(treatSpend.toFixed(3)),
      elapsedMs: Number(elapsedMs.toFixed(3)),
      grossCoinsPerMinute: Number(grossCoinsPerMinute.toFixed(3)),
      netCoinsPerMinute: Number(netCoinsPerMinute.toFixed(3)),
    })),
  };
}

function addEfficiencyChecks(scenarios) {
  const clearByDifficulty = new Map(scenarios
    .filter(scenario => scenario.name === 'stable-clear-all-pickups')
    .map(scenario => [scenario.difficulty, scenario]));
  const failures = scenarios.filter(scenario => scenario.outcome === 'failure');
  return failures.map(failure => {
    const sameDifficulty = clearByDifficulty.get(failure.difficulty);
    const lowerDifficulties = [...clearByDifficulty.entries()].filter(([difficulty]) => difficulty < failure.difficulty);
    const seedChecks = failure.seedMetrics.map(failureSeed => {
      const sameSeedClear = sameDifficulty.seedMetrics.find(sample => sample.seed === failureSeed.seed);
      const lowerSeedRates = lowerDifficulties.map(([, scenario]) => scenario.seedMetrics.find(sample => sample.seed === failureSeed.seed)?.netCoinsPerMinute ?? 0);
      const bestLowerSeedRate = lowerSeedRates.length ? Math.max(...lowerSeedRates) : null;
      return {
        failRate: failureSeed.netCoinsPerMinute,
        sameRate: sameSeedClear?.netCoinsPerMinute ?? 0,
        bestLowerRate: bestLowerSeedRate,
        sameRatio: (sameSeedClear?.netCoinsPerMinute ?? 0) > 0 ? failureSeed.netCoinsPerMinute / sameSeedClear.netCoinsPerMinute : null,
        lowerRatio: bestLowerSeedRate > 0 ? failureSeed.netCoinsPerMinute / bestLowerSeedRate : null,
      };
    });
    const same = seedChecks.map(item => item.sameRatio).filter(Number.isFinite);
    const lower = seedChecks.map(item => item.lowerRatio).filter(Number.isFinite);
    const sameClearPositive = sameDifficulty.seedMetrics.every(sample => sample.netCoinsPerMinute > 0);
    const lowerClearPositive = failure.difficulty === 1 || lowerDifficulties.length > 0
      && lowerDifficulties.every(([, scenario]) => scenario.seedMetrics.every(sample => sample.netCoinsPerMinute > 0));
    const sameRate = sameDifficulty.netCoinsPerMinute.median;
    const failRate = failure.netCoinsPerMinute.median;
    const bestLowerDifficulty = lowerDifficulties.length
      ? Math.max(...lowerDifficulties.map(([, scenario]) => scenario.netCoinsPerMinute.median))
      : null;
    const ratioToSameDifficulty = sameRate > 0 ? failRate / sameRate : null;
    const ratioToBestLower = bestLowerDifficulty > 0 ? failRate / bestLowerDifficulty : null;
    const samePassing = same.filter(ratio => ratio <= 0.9).length;
    const lowerPassing = lower.filter(ratio => ratio <= 0.9).length;
    const numeric90PercentGate = sameClearPositive && samePassing === SEEDS.length
      && (failure.difficulty === 1 || (lowerClearPositive && bestLowerDifficulty > 0 && lowerPassing === SEEDS.length));
    return {
      difficulty: failure.difficulty,
      reachedRatio: failure.reachedRatio,
      failureNetCoinsPerMinuteMedian: Number(failRate.toFixed(3)),
      sameDifficultyClearNetCoinsPerMinuteMedian: Number(sameRate.toFixed(3)),
      bestLowerDifficultyClearNetCoinsPerMinuteMedian: bestLowerDifficulty === null ? null : Number(bestLowerDifficulty.toFixed(3)),
      ratioToSameDifficultyClear: ratioToSameDifficulty === null ? null : Number(ratioToSameDifficulty.toFixed(4)),
      ratioToBestLowerDifficultyClear: ratioToBestLower === null ? null : Number(ratioToBestLower.toFixed(4)),
      perSeedRatiosToSameClear: { passing: samePassing, total: SEEDS.length, p90: same.length ? Number(percentile([...same].sort((a, b) => a - b), 0.9).toFixed(4)) : null, max: same.length ? Number(Math.max(...same).toFixed(4)) : null },
      perSeedRatiosToBestLowerClear: failure.difficulty === 1 ? null : { passing: lowerPassing, total: SEEDS.length, p90: lower.length ? Number(percentile([...lower].sort((a, b) => a - b), 0.9).toFixed(4)) : null, max: lower.length ? Number(Math.max(...lower).toFixed(4)) : null },
      numeric90PercentGate,
      status: numeric90PercentGate ? 'PASS' : 'FAIL',
    };
  });
}

function selectedDifficulty(profile, clears) {
  if (profile.fixedDifficulty) return profile.fixedDifficulty;
  let selected = profile.difficultyMilestones[0].difficulty;
  for (const milestone of profile.difficultyMilestones) {
    if (clears < milestone.clears) break;
    selected = milestone.difficulty;
  }
  return selected;
}

function runProfile(seed, profile, overrides = {}) {
  const clearProbability = overrides.clearProbability ?? profile.clearProbability;
  const collectionRate = overrides.collectionRate ?? profile.collectionRate;
  const roundTimeMultiplier = overrides.roundTimeMultiplier ?? 1;
  const wallet = {
    coins: RAISING_CONFIG.startingCoins,
    grossCoins: 0,
    foodSpend: 0,
    foodSpendById: Object.fromEntries(FOOD_ITEMS.map(item => [item.id, 0])),
    foodPurchaseCounts: Object.fromEntries(FOOD_ITEMS.map(item => [item.id, 0])),
    permanentSpend: 0,
    runs: 0,
    clears: 0,
    elapsedMs: 0,
    hunger: RAISING_CONFIG.startingHunger,
    purchasedIds: [],
    purchaseTimesHours: {},
  };
  let difficulty = profile.fixedDifficulty ?? 1;

  while (wallet.purchasedIds.length < SHOP_ITEMS.length && wallet.runs < SIM.maxEndpointRuns) {
    difficulty = selectedDifficulty(profile, wallet.clears);
    const runSeed = (seed + Math.imul(wallet.runs, 0x9e3779b9)) >>> 0;
    const course = routeForReward(runSeed);
    const clears = unitHash(seed, wallet.runs, profile.name, 'clear') < clearProbability;
    const reachedRatio = clears ? 1 : 0.05 + 0.90 * unitHash(seed, wallet.runs, profile.name, 'reach');
    const collected = countCollected(course, reachedRatio, collectionRate, runSeed, `${profile.name}:${wallet.runs}`);
    const result = calculateRunRewardInput({ ...collected, completed: clears, difficulty, course });
    const elapsedMs = (SIM.runDurationMs * (clears ? 1 : reachedRatio)
      + SIM.resultAndFastRestartMs + SIM.homeCareMsPerRun
      + (clears ? 0 : SIM.failureRecoveryMs)) * roundTimeMultiplier;
    wallet.coins += result.reward;
    wallet.grossCoins += result.reward;
    wallet.elapsedMs += elapsedMs;
    wallet.runs += 1;
    if (clears) wallet.clears += 1;

    wallet.hunger = Math.min(100, wallet.hunger + RAISING_CONFIG.hungerRisePerMinute * elapsedMs / 60_000);
    const kibble = FOOD_ITEMS.find(item => item.id === 'kibble');
    if (wallet.runs % SIM.carePolicy.optionalTreatEveryRuns === 0) {
      const treat = FOOD_ITEMS.find(item => item.id === 'treat');
      if (wallet.coins >= treat.price) {
        wallet.coins -= treat.price;
        wallet.foodSpend += treat.price;
        wallet.foodSpendById[treat.id] += treat.price;
        wallet.foodPurchaseCounts[treat.id] += 1;
        wallet.hunger = Math.max(0, wallet.hunger - treat.hungerRecovery);
      }
    }
    while (wallet.hunger >= SIM.carePolicy.feedWithKibbleAtOrAboveHunger && wallet.coins >= kibble.price) {
      wallet.coins -= kibble.price;
      wallet.foodSpend += kibble.price;
      wallet.foodSpendById[kibble.id] += kibble.price;
      wallet.foodPurchaseCounts[kibble.id] += 1;
      wallet.hunger = Math.max(0, wallet.hunger - kibble.hungerRecovery);
    }

    for (const item of SHOP_ITEMS) {
      if (wallet.purchasedIds.includes(item.id)) continue;
      if (wallet.coins < item.price) continue;
      if (item.type === 'house' && item.level !== (wallet.purchasedIds.filter(id => id.startsWith('house-')).length + 2)) continue;
      wallet.coins -= item.price;
      wallet.permanentSpend += item.price;
      wallet.purchasedIds.push(item.id);
      wallet.purchaseTimesHours[item.id] = wallet.elapsedMs / 3_600_000;
    }
  }

  return {
    seed,
    profile: profile.name,
    runs: wallet.runs,
    clears: wallet.clears,
    grossCoins: wallet.grossCoins,
    foodSpend: wallet.foodSpend,
    foodSpendById: wallet.foodSpendById,
    foodPurchaseCounts: wallet.foodPurchaseCounts,
    permanentSpend: wallet.permanentSpend,
    remainingCoins: wallet.coins,
    acquiredAllPermanentItems: wallet.purchasedIds.length === SHOP_ITEMS.length,
    acquiredPermanentCount: wallet.purchasedIds.length,
    targetPermanentCoins: RAISING_CONFIG.permanentItemTargetCoins,
    activeHours: wallet.elapsedMs / 3_600_000,
    netCoinsPerMinute: wallet.elapsedMs > 0 ? (wallet.grossCoins - wallet.foodSpend) / (wallet.elapsedMs / 60_000) : 0,
    purchaseTimesHours: wallet.purchaseTimesHours,
  };
}

function endpointSummary(profile, overrides = {}) {
  const samples = SEEDS.map(seed => runProfile(seed, profile, overrides));
  return {
    name: profile.name,
    description: profile.description,
    clearProbability: overrides.clearProbability ?? profile.clearProbability,
    collectionRate: overrides.collectionRate ?? profile.collectionRate,
    roundTimeMultiplier: overrides.roundTimeMultiplier ?? 1,
    seeds: [0, SEEDS.length - 1],
    acquiredAllPermanentItems: samples.filter(sample => sample.acquiredAllPermanentItems).length,
    acquiredAllItemsCount: samples.filter(sample => sample.acquiredAllPermanentItems).length,
    activeHours: summarize(samples.map(sample => sample.activeHours)),
    runs: summarize(samples.map(sample => sample.runs)),
    grossCoins: summarize(samples.map(sample => sample.grossCoins)),
    foodSpend: summarize(samples.map(sample => sample.foodSpend)),
    kibbleSpend: summarize(samples.map(sample => sample.foodSpendById.kibble)),
    treatSpend: summarize(samples.map(sample => sample.foodSpendById.treat)),
    kibblePurchases: summarize(samples.map(sample => sample.foodPurchaseCounts.kibble)),
    treatPurchases: summarize(samples.map(sample => sample.foodPurchaseCounts.treat)),
    permanentSpend: summarize(samples.map(sample => sample.permanentSpend)),
    netCoinsPerMinute: summarize(samples.map(sample => sample.netCoinsPerMinute)),
    permanentItemPurchaseTimesHours: Object.fromEntries(SHOP_ITEMS.map(item => [
      item.id,
      summarize(samples.map(sample => sample.purchaseTimesHours[item.id]).filter(Number.isFinite)),
    ])),
    sampleLimit: SIM.maxEndpointRuns,
  };
}

export function createEconomySimulationReport() {
  const scenarios = [];
  for (let difficulty = 1; difficulty <= 5; difficulty++) {
    scenarios.push(scenarioSummary({
      difficulty,
      name: 'stable-clear-all-pickups',
      completed: true,
      reachedRatio: 1,
      collectionRate: 1,
    }));
    for (let reachedRatio = 0.05; reachedRatio <= 0.950001; reachedRatio += 0.05) {
      scenarios.push(scenarioSummary({
        difficulty,
        name: `failure-${String(Math.round(reachedRatio * 100)).padStart(2, '0')}-percent`,
        completed: false,
        reachedRatio: Number(reachedRatio.toFixed(2)),
        collectionRate: SIM.failureCollectionRate,
      }));
    }
  }

  const efficiencyChecks = addEfficiencyChecks(scenarios);
  const profiles = ECONOMY_DESIGN_PROFILE.profiles.map(profile => endpointSummary(profile));
  const profileTargets = [
    { key: 'starOneHours', profile: profiles[0], target: SIM.targets.starOneHours },
    { key: 'progressionHours', profile: profiles[1], target: SIM.targets.progressionHours },
  ];
  const profileTargetResults = Object.fromEntries(profileTargets.map(({ key, profile, target }) => [key, {
    targetMin: target.min,
    targetMax: target.max,
    median: profile.activeHours.median,
    p10: profile.activeHours.p10,
    p90: profile.activeHours.p90,
    withinTarget: profile.activeHours.median >= target.min && profile.activeHours.median <= target.max,
    all100SeedsAcquiredEverything: profile.acquiredAllItemsCount === SEEDS.length,
  }]));
  const sensitivity = [];
  for (const profile of ECONOMY_DESIGN_PROFILE.profiles) {
    for (const collectionRate of SIM.sensitivityRates) {
      for (const clearProbability of SIM.sensitivityRates) {
        sensitivity.push(endpointSummary(profile, { collectionRate, clearProbability }));
      }
    }
    for (const roundTimeMultiplier of SIM.roundTimeSensitivityMultipliers) {
      sensitivity.push(endpointSummary(profile, { roundTimeMultiplier }));
    }
  }

  const specifiedPriceTotals = {
    house: HOUSE_ITEMS.reduce((sum, item) => sum + item.price, 0),
    toys: TOY_ITEMS.filter(item => !item.free).reduce((sum, item) => sum + item.price, 0),
    decorations: DECORATION_ITEMS.reduce((sum, item) => sum + item.price, 0),
    allPermanentItems: SHOP_ITEMS.reduce((sum, item) => sum + item.price, 0),
  };
  const priceTotalsPass = specifiedPriceTotals.house === 23_500
    && specifiedPriceTotals.toys === 3_250
    && specifiedPriceTotals.decorations === 2_430
    && specifiedPriceTotals.allPermanentItems === RAISING_CONFIG.permanentItemTargetCoins;
  const endpointPass = Object.values(profileTargetResults).every(result => result.withinTarget && result.all100SeedsAcquiredEverything);
  const failureScenarioCount = scenarios.filter(scenario => scenario.outcome === 'failure').length;
  const clearScenarioCount = scenarios.filter(scenario => scenario.outcome === 'clear').length;
  const failureCoveragePass = failureScenarioCount === 95
    && clearScenarioCount === 5
    && efficiencyChecks.length === failureScenarioCount
    && scenarios.every(scenario => scenario.seedMetrics.length === SEEDS.length);
  const failureEfficiencyPass = failureCoveragePass && efficiencyChecks.every(check => check.numeric90PercentGate);
  const numericGates = {
    exactPermanentPriceTotals: priceTotalsPass,
    endpointTargetsAndFullAcquisition: endpointPass,
    fiveDifficultyClearAndNinetyFiveFailureScenariosAcrossAllSeeds: failureCoveragePass,
    everyFailureUnderNinetyPercentOfComparators: failureEfficiencyPass,
  };
  const numericPass = Object.values(numericGates).every(Boolean);

  return {
    status: numericPass ? 'PASS' : 'FAIL',
    statusScope: 'NUMERIC_SIMULATION_ONLY',
    designStatus: ECONOMY_STATUS,
    designConfigFinalized: ECONOMY_CONFIG_FINALIZED,
    economyVersion: ECONOMY_VERSION,
    canonicalEconomyProfile: {
      ...ECONOMY_DESIGN_PROFILE,
      startingCoins: RAISING_CONFIG.startingCoins,
      startingFreeItems: TOY_ITEMS.filter(item => item.free).map(item => item.id),
      permanentItemPrices: SHOP_ITEMS.map(({ id, type, price, level }) => ({ id, type, price, ...(level ? { level } : {}) })),
      foodItems: FOOD_ITEMS,
      rewards: {
        normalBoneCoins: RAISING_CONFIG.boneRewardCoins,
        goldBoneCoins: RAISING_CONFIG.goldBoneRewardCoins,
        clearBonusCoins: RAISING_CONFIG.clearBonusCoins,
        difficultyScaleBps: RAISING_CONFIG.runRewardScaleBps,
        failureMultipliers: RAISING_CONFIG.failureMultipliers,
        failureCapRatio: 0.7,
      },
      care: {
        hungerRisePerMinute: RAISING_CONFIG.hungerRisePerMinute,
        hungryAt: RAISING_CONFIG.hungryAt,
        veryHungryAt: RAISING_CONFIG.veryHungryAt,
      },
      priceTotals: specifiedPriceTotals,
    },
    seedCount: SEEDS.length,
    seedRange: [SEEDS[0], SEEDS.at(-1)],
    permanentItemTargetCoins: RAISING_CONFIG.permanentItemTargetCoins,
    specifiedPriceTotals,
    numericGates,
    economicInputs: {
      normalBoneCoins: RAISING_CONFIG.boneRewardCoins,
      goldBoneCoins: RAISING_CONFIG.goldBoneRewardCoins,
      difficultyRewardScaleBps: RAISING_CONFIG.runRewardScaleBps,
      failureMultipliers: RAISING_CONFIG.failureMultipliers,
      clearBonusCoins: RAISING_CONFIG.clearBonusCoins,
      elapsedTime: {
        runDurationMs: SIM.runDurationMs,
        resultAndFastRestartMs: SIM.resultAndFastRestartMs,
        homeCareMsPerRun: SIM.homeCareMsPerRun,
        failureRecoveryMs: SIM.failureRecoveryMs,
      },
      consumablePolicy: {
        kibbleTriggerHunger: SIM.carePolicy.feedWithKibbleAtOrAboveHunger,
        hungerRisePerMinute: RAISING_CONFIG.hungerRisePerMinute,
        treatEveryRuns: SIM.carePolicy.optionalTreatEveryRuns,
        failureScenarioKibbleCostPerMinute: Number((FOOD_ITEMS.find(item => item.id === 'kibble').price
          * RAISING_CONFIG.hungerRisePerMinute / FOOD_ITEMS.find(item => item.id === 'kibble').hungerRecovery).toFixed(3)),
        failureScenarioTreatCostPerRun: Number((FOOD_ITEMS.find(item => item.id === 'treat').price
          / SIM.carePolicy.optionalTreatEveryRuns).toFixed(3)),
      },
      failureCollectionRate: SIM.failureCollectionRate,
    },
    endpointGate: { status: endpointPass ? 'PASS' : 'FAIL', profiles: profileTargetResults },
    scenarios,
    failureEfficiencyChecks: {
      threshold: SIM.targets.failureEfficiencyMaxRatio,
      comparedEverySeed: true,
      allFailureStrategiesUnder90Percent: failureEfficiencyPass,
      status: failureEfficiencyPass ? 'PASS' : 'FAIL',
      checks: efficiencyChecks,
    },
    permanentItemEndpointProfiles: profiles,
    endpointSensitivity: {
      dimensions: ['collectionRate', 'clearProbability', 'roundTimeMultiplier'],
      result: 'nine collection/clear combinations and plus/minus 10% round time for each fixed profile, 100 seeds each',
      cases: sensitivity,
    },
    economyConfigPending: [...ECONOMY_CONFIG_PENDING],
    humanDifficultyReview: ECONOMY_HUMAN_REVIEW,
  };
}

async function main() {
  const report = createEconomySimulationReport();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    await writeFile(process.argv[outputIndex + 1], json, 'utf8');
    process.stdout.write(`Wrote designed economy simulation JSON (${report.status}) to ${process.argv[outputIndex + 1]}\n`);
    return;
  }
  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
