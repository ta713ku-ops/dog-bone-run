import { CONFIG, PHASE4 } from './config.js';

const FIRST_BONE_DISTANCE = 1.6;
const LAST_BONE_DISTANCE = 29.5;
const GOLD_TARGET_DISTANCES = Object.freeze([4, 9.5, 15, 20.5, 27]);
const LANES = Object.freeze([-1, 0, 1]);

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

function roundDistance(distance) {
  return Math.round(distance * 1000) / 1000;
}

function stageAt(distance) {
  const timeMs = distance * 1000;
  let active = PHASE4.stages[0];
  for (const stage of PHASE4.stages) {
    if (timeMs < stage.fromMs) break;
    active = stage;
  }
  return active;
}

function nextLane(previous, random) {
  const candidates = LANES.filter(lane => Math.abs(lane - previous) <= 1);
  const alternatives = candidates.filter(lane => lane !== previous);
  if (!alternatives.length || random() < 0.18) return previous;
  return alternatives[Math.floor(random() * alternatives.length)];
}

function pickGoldCandidates(bones) {
  const used = new Set();
  return GOLD_TARGET_DISTANCES.map(target => {
    let closest = null;
    for (const bone of bones) {
      if (used.has(bone.id)) continue;
      if (!closest || Math.abs(bone.distance - target) < Math.abs(closest.distance - target)) closest = bone;
    }
    used.add(closest.id);
    return closest.id;
  });
}

export function createSprintCourse(seed = 1) {
  const normalizedSeed = normalizeSeed(seed);
  const random = seededRandom(normalizedSeed);
  const bones = [];
  let distance = FIRST_BONE_DISTANCE;
  let lane = 0;

  while (distance <= LAST_BONE_DISTANCE + 1e-9) {
    if (bones.length) lane = nextLane(lane, random);
    const index = bones.length + 1;
    bones.push({
      id: `bone-${String(index).padStart(3, '0')}`,
      lane,
      timeMs: Math.round(distance * 1000),
      distance,
      kind: 'normal',
    });
    distance = roundDistance(distance + stageAt(distance).boneGap);
  }

  const goldCandidates = pickGoldCandidates(bones);
  const goldSelection = [...goldCandidates];
  for (let index = goldSelection.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [goldSelection[index], goldSelection[other]] = [goldSelection[other], goldSelection[index]];
  }
  const selectedGold = new Set(goldSelection.slice(0, 2));
  for (const bone of bones) if (selectedGold.has(bone.id)) bone.kind = 'gold';

  const obstacles = [];
  let lastObstacleBoneIndex = 0;
  for (let index = 0; index < bones.length; index++) {
    const bone = bones[index];
    if (bone.distance < 2 || index - lastObstacleBoneIndex < stageAt(bone.distance).obstacleEvery) continue;
    const stage = stageAt(bone.distance);
    lastObstacleBoneIndex = index;

    const type = random() < stage.holeChance ? 'hole' : random() < 0.5 ? 'puddle' : 'trash';
    const blockedLanes = LANES.filter(candidate => candidate !== bone.lane);
    const isPair = random() < stage.pairChance;
    const lanes = isPair ? blockedLanes : [blockedLanes[Math.floor(random() * blockedLanes.length)]];
    for (const obstacleLane of lanes) {
      const obstacleIndex = obstacles.length + 1;
      obstacles.push({
        id: `obstacle-${String(obstacleIndex).padStart(3, '0')}`,
        type,
        lane: obstacleLane,
        distance: bone.distance,
      });
    }
  }

  const selectedIds = goldCandidates.filter(id => selectedGold.has(id));
  const result = {
    seed: normalizedSeed,
    bones,
    obstacles: obstacles.sort((a, b) => a.distance - b.distance || a.lane - b.lane),
    goldCandidates: [...goldCandidates],
    goldIds: [...selectedIds],
  };

  // This course relies on two hundred millisecond lane changes. Keep its
  // collision windows far enough apart to leave a visible reaction margin.
  if (CONFIG.moveMs !== 200 || PHASE4.durationMs !== 30_000) {
    throw new Error('Sprint course requires the 30-second, 200ms-move contract.');
  }
  return result;
}
