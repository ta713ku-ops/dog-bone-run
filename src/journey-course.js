import { createSprintCourse } from './sprint-course.js';
import { createParkCourse } from './park-course.js';
import { createMountainCourse } from './mountain-course.js';
import { createCaveCourse } from './cave-course.js';
import { getWalkLevel } from './walk-levels.js';

const COURSE_CREATORS = Object.freeze({
  1: createSprintCourse,
  2: createParkCourse,
  3: createMountainCourse,
  4: createCaveCourse,
});

function normalizedSeed(value) {
  return Number.isFinite(value) ? Math.trunc(value) >>> 0 : 1;
}

function obstacleTimeMs(obstacle, speed) {
  if (Number.isFinite(obstacle.arrivalMs)) return obstacle.arrivalMs;
  if (Number.isFinite(obstacle.timeMs)) return obstacle.timeMs;
  return Number.isFinite(obstacle.distance) ? obstacle.distance / speed * 1_000 : Infinity;
}

function selectedObstacles(obstacles, route, speed, mode) {
  // Calm runs retain only seven single-lane encounters. A paired authored
  // event contributes one of its original hazards, keeping its place-specific
  // art while removing the forced two-lane weave.
  const groups = new Map();
  for (const obstacle of obstacles) {
    const timeMs = obstacleTimeMs(obstacle, speed);
    const key = obstacle.eventId ?? `arrival:${timeMs}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ obstacle, timeMs });
  }
  const clearOfDiscoveries = [...groups.values()]
    .map((items, index) => ({ items, index, timeMs: items[0]?.timeMs ?? Infinity }))
    .filter(group => route.discoveries.every(discovery => Math.abs(group.timeMs - discovery.timeMs) > 800))
    .sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
  const targetCount = Math.min(mode === 'calm' ? 7 : 12, clearOfDiscoveries.length);
  if (!targetCount) return [];
  const selected = [];
  for (let index = 0; index < targetCount; index++) {
    const position = Math.min(clearOfDiscoveries.length - 1,
      Math.floor((index + .5) * clearOfDiscoveries.length / targetCount));
    const group = clearOfDiscoveries[position];
    const itemIndex = Math.abs((route.seed >>> 0) + group.index) % group.items.length;
    selected.push(group.items[itemIndex].obstacle);
    if (mode === 'challenge' && index % 3 === 2 && group.items.length > 1) selected.push(group.items[(itemIndex + 1) % group.items.length].obstacle);
  }
  return selected;
}

/** Build a deterministic 30-second course for one of the authored walks. */
export function createJourneyCourse(route, mode = 'calm') {
  if (!route || !Object.hasOwn(COURSE_CREATORS, route.level)) {
    throw new RangeError('Journey route must have a level from 1 to 4');
  }
  const normalizedMode = mode === 'challenge' ? 'challenge' : 'calm';
  const seed = normalizedSeed(route.seed);
  const base = COURSE_CREATORS[route.level](seed);
  const speed = getWalkLevel(route.level).speed;
  const obstacles = selectedObstacles(base.obstacles ?? [], route, speed, normalizedMode);
  const discoveries = Array.isArray(route.discoveries) ? route.discoveries.map(item => ({ ...item })) : [];
  return {
    ...base,
    bones: (base.bones ?? []).map(item => ({ ...item })),
    obstacles: obstacles.map(item => ({ ...item })),
    journeyRouteId: route.id,
    journeyMode: normalizedMode,
    discoveries,
    generation: {
      ...(base.generation ?? {}),
      journeyRouteId: route.id,
      journeyMode: normalizedMode,
      ...(normalizedMode === 'calm' ? { calmObstacleCount: obstacles.length } : {}),
    },
  };
}
