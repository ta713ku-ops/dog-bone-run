import { CONFIG } from './config.js';
import { createPhase2Course } from './phase2-course.js';

// Holes are fixed in the course and do not consume the seed. They start after
// the opening puddle/trash sequence, then become a little more frequent late
// in the route. Each placement is clear of every gold candidate and leaves a
// continuous all-bone route through the combined hazard set.
const HOLE_PLACEMENTS = Object.freeze([
  { id: 'hole-001', type: 'hole', lane: 1, distance: 20.0 },
  { id: 'hole-002', type: 'hole', lane: -1, distance: 28.8 },
  { id: 'hole-003', type: 'hole', lane: 0, distance: 37.0 },
  { id: 'hole-004', type: 'hole', lane: -1, distance: 44.8 },
  { id: 'hole-005', type: 'hole', lane: -1, distance: 51.8 },
]);

export function createPhase3Course(seed = 1) {
  const phase2 = createPhase2Course(seed);
  const obstacles = [
    ...phase2.obstacles.map(obstacle => ({ ...obstacle })),
    ...HOLE_PLACEMENTS.map(hole => ({ ...hole })),
  ].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

  // Keep the timing budget visible beside the course contract. At the normal
  // one-distance-unit-per-second pace, lookAhead allows at least 0.9 seconds
  // of type preview plus reaction, swipe decision, and a complete lane move.
  const requiredPreviewDistance = 0.9 + 0.3 + 0.15 + CONFIG.moveMs / 1000;
  if (CONFIG.lookAhead < requiredPreviewDistance) {
    throw new Error('Phase 3 hazards need more preview distance for a safe lane change');
  }

  return { ...phase2, obstacles };
}
