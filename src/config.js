// Recoverable switch: use the previous complete image set when disabled.
export const USE_CONTINUOUS_HOME_DOG = true;
export const USE_GPU_HOME_DOG = true;
export const USE_HD_HOME_DOG = true;
export const CONFIG = Object.freeze({
  buildVersion: '0.39.0', configVersion: 'journey-life-1', courseVersion: 'sprint-30s-penalty-1', logVersion: 6,
  durationMs: 60_000, stepMs: 1000 / 60, moveMs: 200, cooldownMs: 100,
  swipePx: 24, swipeRatio: 1.25, comboMs: 1200,
  dogHalfWidth: .22, boneHalfWidth: .12, dogHalfLength: .06, boneHalfLength: .04,
  obstacleHalfWidth: .28, obstacleHalfLength: .10,
  lookAhead: 3.2, dprCap: 3, stallMs: 250,
});
export const PHASE2 = Object.freeze({ goalDistance: 60, slowMs: 1000, suppressMs: 1300, slowSpeed: .60,
  ruleVersion: 'phase2-walk2-v1' });
export const PHASE3 = Object.freeze({ fallMs: 650, ruleVersion: 'phase3-walk3-v1' });
export const PHASE4 = Object.freeze({
  durationMs: 30_000, ruleVersion: 'sprint30-penalty-v1',
  stages: Object.freeze([
    { fromMs: 0, level: 1, boneGap: .85, obstacleEvery: 4, pairChance: .15 },
    { fromMs: 5_000, level: 2, boneGap: .78, obstacleEvery: 4, pairChance: .25 },
    { fromMs: 10_000, level: 3, boneGap: .70, obstacleEvery: 3, pairChance: .35 },
    { fromMs: 15_000, level: 4, boneGap: .64, obstacleEvery: 3, pairChance: .45 },
    { fromMs: 20_000, level: 5, boneGap: .58, obstacleEvery: 3, pairChance: .55 },
    { fromMs: 25_000, level: 6, boneGap: .52, obstacleEvery: 3, pairChance: .65 },
  ].map(stage => Object.freeze(stage))),
});
export const EPS = 1e-7;
export function tier(combo) {
  if (combo >= 50) return { multiplier: 2, level: 5, milestone: 'PERFECT' };
  if (combo >= 30) return { multiplier: 2, level: 4, milestone: 'GREAT' };
  if (combo >= 20) return { multiplier: 1.5, level: 3, milestone: 'NICE' };
  if (combo >= 10) return { multiplier: 1.2, level: 2, milestone: 'GOOD' };
  return { multiplier: 1, level: 1, milestone: null };
}
