import { CONFIG, PHASE4 } from './config.js';
import { PARK_LEVEL2 } from './park-course.js';
import { MOUNTAIN_LEVEL3 } from './mountain-course.js';

import { CAVE_LEVEL4 } from './cave-course.js';

const LEVELS = Object.freeze({
  1: Object.freeze({
    id: 1,
    name: 'まちのおさんぽ',
    theme: 'street',
    durationMs: PHASE4.durationMs,
    speed: 1,
    ruleVersion: PHASE4.ruleVersion,
    courseVersion: CONFIG.courseVersion,
  }),
  2: Object.freeze({
    id: 2,
    name: 'こうえんのおさんぽ',
    theme: 'park',
    durationMs: PARK_LEVEL2.durationMs,
    speed: PARK_LEVEL2.speed,
    layoutClasses: PARK_LEVEL2.layoutClasses,
    ruleVersion: PARK_LEVEL2.ruleVersion,
    courseVersion: PARK_LEVEL2.courseVersion,
  }),
  3: Object.freeze({
    id: 3, name: 'やまのおさんぽ', theme: 'mountain',
    durationMs: MOUNTAIN_LEVEL3.durationMs, speed: MOUNTAIN_LEVEL3.speed,
    ruleVersion: MOUNTAIN_LEVEL3.ruleVersion, courseVersion: MOUNTAIN_LEVEL3.courseVersion,
  }),
  4: Object.freeze({
    id: 4, name: 'どうくつのおさんぽ', theme: 'cave',
    durationMs: CAVE_LEVEL4.durationMs, speed: CAVE_LEVEL4.speed,
    ruleVersion: CAVE_LEVEL4.ruleVersion, courseVersion: CAVE_LEVEL4.courseVersion,
  }),
});

export function getWalkLevel(id = 1) {
  return Object.hasOwn(LEVELS, id) ? LEVELS[id] : LEVELS[1];
}

export const WALK_LEVELS = LEVELS;
