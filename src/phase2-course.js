import { createCourse } from './course.js';

const GOLD_CANDIDATE_IDS = Object.freeze([
  'bone-006', 'bone-019', 'bone-033', 'bone-046', 'bone-059',
]);

// Distances are in the same world units as bones. Every placement is fixed;
// only the two gold bones vary with the run seed.
const OBSTACLE_PLACEMENTS = Object.freeze([
  { id: 'obstacle-001', type: 'puddle', lane: 1, distance: 4.8 },
  { id: 'obstacle-002', type: 'trash', lane: 0, distance: 11.8 },
  { id: 'obstacle-003', type: 'puddle', lane: 1, distance: 17.0 },
  { id: 'obstacle-004', type: 'trash', lane: -1, distance: 24.5 },
  { id: 'obstacle-005', type: 'puddle', lane: 1, distance: 34.5 },
  { id: 'obstacle-006', type: 'trash', lane: 1, distance: 39.5 },
  { id: 'obstacle-007', type: 'puddle', lane: 1, distance: 48.5 },
  { id: 'obstacle-008', type: 'trash', lane: -1, distance: 56.8 },
]);

function normalizeSeed(seed) {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function createPhase2Course(seed = 1) {
  const normalizedSeed = normalizeSeed(seed);
  const goldCandidates = [...GOLD_CANDIDATE_IDS];
  const selection = [...goldCandidates];
  const random = seededRandom(normalizedSeed);

  for (let index = selection.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [selection[index], selection[other]] = [selection[other], selection[index]];
  }

  const selectedGold = new Set(selection.slice(0, 2));
  const bones = createCourse().map(bone => ({
    ...bone,
    kind: selectedGold.has(bone.id) ? 'gold' : 'normal',
  }));

  return {
    seed: normalizedSeed,
    bones,
    obstacles: OBSTACLE_PLACEMENTS.map(obstacle => ({ ...obstacle })),
    goldCandidates,
    // Keep returned ids in the same stable order as their course positions.
    goldIds: goldCandidates.filter(id => selectedGold.has(id)),
  };
}
