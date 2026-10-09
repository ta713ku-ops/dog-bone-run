import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECORATION_ITEMS,
  ECONOMY_CONFIG_FINALIZED,
  ECONOMY_CONFIG_PENDING,
  ECONOMY_DESIGN_PROFILE,
  ECONOMY_HUMAN_REVIEW,
  ECONOMY_VERSION,
  FOOD_ITEMS,
  HOUSE_ITEMS,
  RAISING_CONFIG,
  SHOP_ITEMS,
  TOY_ITEMS,
} from '../src/raising-config.js';
import { calculateFullClearReference, calculateRunRewardInput } from '../src/raising-model.js';
import { createRaisingCourse } from '../src/raising-course.js';
import { createEconomySimulationReport } from '../scripts/economy-sim.mjs';

test('designed economy has fixed versioned profiles and exact permanent price totals', () => {
  assert.equal(ECONOMY_VERSION, 'raising-economy-designed-1');
  assert.equal(ECONOMY_CONFIG_FINALIZED, true);
  assert.equal(ECONOMY_HUMAN_REVIEW, 'PENDING');
  assert.deepEqual(ECONOMY_CONFIG_PENDING, []);
  assert.equal(ECONOMY_DESIGN_PROFILE.version, ECONOMY_VERSION);
  assert.match(ECONOMY_DESIGN_PROFILE.provenance, /Earlier v1-v4 economy inputs were unavailable/);
  assert.deepEqual(ECONOMY_DESIGN_PROFILE.profiles.map(profile => profile.name), [
    'star1-fixed-design',
    'progression-design',
  ]);
  assert.deepEqual(ECONOMY_DESIGN_PROFILE.profiles.map(profile => profile.clearProbability), [0.78, 0.8]);
  assert.deepEqual(ECONOMY_DESIGN_PROFILE.profiles.map(profile => profile.collectionRate), [0.72, 0.82]);
  assert.equal(HOUSE_ITEMS.reduce((sum, item) => sum + item.price, 0), 23_500);
  assert.equal(TOY_ITEMS.filter(item => !item.free).reduce((sum, item) => sum + item.price, 0), 3_250);
  assert.equal(DECORATION_ITEMS.reduce((sum, item) => sum + item.price, 0), 2_430);
  assert.equal(SHOP_ITEMS.reduce((sum, item) => sum + item.price, 0), 29_180);
  assert.equal(RAISING_CONFIG.permanentItemTargetCoins, 29_180);
  assert.ok(FOOD_ITEMS.every(item => Number.isInteger(item.price) && item.price >= 0));
});

test('failure payout shares the run model, has no minimum guarantee, and respects the exact 70 percent cap', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
      const course = createRaisingCourse(seed, difficulty);
      const fullClearReference = calculateFullClearReference(course, difficulty);
      const emptyFailure = calculateRunRewardInput({ difficulty, course });
      assert.equal(emptyFailure.reward, 0, `seed ${seed} ★${difficulty} has no minimum failure payout`);

      const normalCollected = course.bones.filter(bone => bone.kind !== 'gold').length;
      const goldCollected = course.bones.filter(bone => bone.kind === 'gold').length;
      const fullPickupFailure = calculateRunRewardInput({
        normalCollected,
        goldCollected,
        completed: false,
        difficulty,
        course,
      });
      assert.equal(fullPickupFailure.fullClearReference, fullClearReference);
      assert.ok(fullPickupFailure.reward <= Math.floor(0.70 * fullClearReference));
      assert.equal(fullPickupFailure.reward, Math.floor(Math.min(
        fullPickupFailure.earnedBase * RAISING_CONFIG.failureMultipliers[difficulty],
        0.70 * fullClearReference,
      )));
    }
  }
});

test('100-seed report passes every numeric gate and leaves human difficulty review pending', () => {
  const report = createEconomySimulationReport();
  assert.equal(report.status, 'PASS');
  assert.equal(report.statusScope, 'NUMERIC_SIMULATION_ONLY');
  assert.equal(report.designConfigFinalized, true);
  assert.equal(report.humanDifficultyReview, ECONOMY_HUMAN_REVIEW);
  assert.equal(report.economyVersion, ECONOMY_VERSION);
  assert.equal(report.canonicalEconomyProfile.version, ECONOMY_VERSION);
  assert.deepEqual(Object.values(report.numericGates), [true, true, true, true]);
  assert.deepEqual(report.specifiedPriceTotals, {
    house: 23_500,
    toys: 3_250,
    decorations: 2_430,
    allPermanentItems: 29_180,
  });
  assert.equal(report.scenarios.filter(scenario => scenario.outcome === 'clear').length, 5);
  const failures = report.scenarios.filter(scenario => scenario.outcome === 'failure');
  assert.equal(failures.length, 95);
  assert.ok(report.scenarios.every(scenario => scenario.seedMetrics.length === 100));
  assert.ok(report.failureEfficiencyChecks.checks.every(check => check.numeric90PercentGate));
  assert.ok(report.failureEfficiencyChecks.checks.every(check => check.perSeedRatiosToSameClear.passing === 100));
  assert.ok(report.failureEfficiencyChecks.checks
    .filter(check => check.difficulty > 1)
    .every(check => check.perSeedRatiosToBestLowerClear.passing === 100));

  const [starOne, progression] = report.permanentItemEndpointProfiles;
  assert.equal(starOne.acquiredAllItemsCount, 100);
  assert.equal(progression.acquiredAllItemsCount, 100);
  assert.ok(starOne.activeHours.median >= 7 && starOne.activeHours.median <= 9);
  assert.ok(progression.activeHours.median >= 3.5 && progression.activeHours.median <= 5.5);
  assert.equal(starOne.permanentSpend.median, 29_180);
  assert.equal(progression.permanentSpend.median, 29_180);
  assert.ok(starOne.kibbleSpend.median > 0 && starOne.treatSpend.median > 0);
  assert.ok(progression.kibbleSpend.median > 0 && progression.treatSpend.median > 0);
  assert.equal(Object.keys(starOne.permanentItemPurchaseTimesHours).length, SHOP_ITEMS.length);
  assert.equal(Object.keys(progression.permanentItemPurchaseTimesHours).length, SHOP_ITEMS.length);
  assert.ok(SHOP_ITEMS.every(item => starOne.permanentItemPurchaseTimesHours[item.id].count === 100));
  assert.ok(SHOP_ITEMS.every(item => progression.permanentItemPurchaseTimesHours[item.id].count === 100));
  assert.equal(report.endpointSensitivity.cases.length, 22);
  assert.ok(report.endpointSensitivity.cases.every(profile => profile.activeHours.count === 100));
  assert.ok(report.endpointSensitivity.cases.filter(profile => profile.roundTimeMultiplier !== 1)
    .every(profile => [0.9, 1.1].includes(profile.roundTimeMultiplier)));
});
