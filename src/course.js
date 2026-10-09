import { CONFIG } from './config.js';

// Two central bones, then repeated adjacent changes. No random placement.
export function createCourse() {
  const pattern = [0, 0, -1, -1, 0, 0, 1, 1];
  const bones = [];
  let timeMs = 2000;
  let index = 0;
  while (timeMs + 100 < CONFIG.durationMs) {
    const lane = pattern[index % pattern.length];
    bones.push({ id: `bone-${String(index + 1).padStart(3, '0')}`, lane, timeMs, distance: timeMs / 1000 });
    index++;
    const next = pattern[index % pattern.length];
    timeMs += next === lane ? 800 : 1000;
  }
  return bones;
}
