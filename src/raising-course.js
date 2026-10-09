import { createSprintCourse } from './sprint-course.js';

const LANES = Object.freeze([-1, 0, 1]);

function normalizeDifficulty(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError('Raising difficulty must be an integer from 1 to 5.');
  }
  return value;
}

function hash32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function chance(seed, difficulty, key) {
  return hash32(`${seed}:${difficulty}:${key}`) / 0x1_0000_0000;
}

function chooseLane(seed, difficulty, key, options) {
  return options[hash32(`${seed}:${difficulty}:${key}:lane`) % options.length];
}

function chooseHazardType(seed, difficulty, key, holeChance = 0.25) {
  const value = chance(seed, difficulty, `${key}:type`);
  if (value < holeChance) return 'hole';
  return value < (holeChance + 1) / 2 ? 'puddle' : 'trash';
}

function createGroups(base) {
  const groups = new Map();
  for (const obstacle of base.obstacles) {
    const key = obstacle.distance;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...obstacle });
  }
  return groups;
}

function groupToObstacleSet({ bones, groups, seed, difficulty }) {
  const boneAtDistance = new Map(bones.map(bone => [bone.distance, bone]));
  const expanded = [];

  for (const bone of bones) {
    if (bone.distance < 2) continue;
    const existing = groups.get(bone.distance) ?? [];
    const availableLanes = LANES.filter(lane => lane !== bone.lane);
    let selected = existing.map(obstacle => ({ ...obstacle }));

    if (difficulty === 1 || difficulty === 2) {
      const groupChance = difficulty === 1 ? 0.56 : 0.82;
      if (selected.length && chance(seed, difficulty, `${bone.id}:keep`) >= groupChance) selected = [];
      if (selected.length > 1 && chance(seed, difficulty, `${bone.id}:pair`) < (difficulty === 1 ? 1 : 0.34)) {
        selected = [selected[hash32(`${seed}:${difficulty}:${bone.id}:single`) % selected.length]];
      }
      selected = selected.map(obstacle => ({
        ...obstacle,
        type: obstacle.type === 'hole' ? 'puddle' : obstacle.type,
      }));
    } else if (difficulty === 4) {
      if (selected.length === 1 && chance(seed, difficulty, `${bone.id}:pair`) < 0.42) {
        selected.push({ ...selected[0], lane: availableLanes.find(lane => lane !== selected[0].lane) });
      }
    } else if (difficulty === 5) {
      if (!selected.length && chance(seed, difficulty, `${bone.id}:add`) < 0.68) {
        selected = [{
          id: 'temporary',
          type: chooseHazardType(seed, difficulty, bone.id, 0.32),
          lane: chooseLane(seed, difficulty, bone.id, availableLanes),
          distance: bone.distance,
        }];
      }
      if (selected.length === 1) {
        const otherLane = availableLanes.find(lane => lane !== selected[0].lane);
        if (otherLane !== undefined) selected.push({ ...selected[0], lane: otherLane });
      }
    }

    // The collectible bone lane is always open, so even the hardest course never
    // blocks all three lanes at one collision distance.
    const occupied = new Set();
    for (const obstacle of selected) {
      if (!LANES.includes(obstacle.lane) || obstacle.lane === bone.lane || occupied.has(obstacle.lane)) continue;
      occupied.add(obstacle.lane);
      expanded.push({ ...obstacle, distance: bone.distance });
    }

    if (expanded.length && expanded.at(-1).distance === bone.distance && expanded.filter(item => item.distance === bone.distance).length > 2) {
      throw new Error(`A raising course blocked all lanes at ${bone.distance}.`);
    }
  }

  const sorted = expanded.sort((a, b) => a.distance - b.distance || a.lane - b.lane);
  return sorted.map((obstacle, index) => ({
    ...obstacle,
    id: `obstacle-${String(index + 1).padStart(3, '0')}`,
  }));
}

/**
 * Builds a difficulty variant without changing sprint-course generation or its
 * collectible route. The result retains createSprintCourse's public shape.
 */
export function createRaisingCourse(seed = 1, difficulty = 3) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const base = createSprintCourse(seed);
  const groups = createGroups(base);
  const obstacles = groupToObstacleSet({
    bones: base.bones,
    groups,
    seed: base.seed,
    difficulty: normalizedDifficulty,
  });

  return {
    seed: base.seed,
    bones: base.bones.map(bone => ({ ...bone })),
    obstacles,
    goldCandidates: [...base.goldCandidates],
    goldIds: [...base.goldIds],
  };
}
