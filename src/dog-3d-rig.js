import {
  DOG_3D_ACTIONS,
  DOG_3D_BIND_PIVOTS,
  DOG_3D_JOINTS,
  DOG_3D_LANDMARK_BINDINGS,
  DOG_3D_RIG_VERSION,
  DOG_3D_STAND_ROOT_HEIGHT,
  DOG_3D_SUPPORTED_ACTIONS,
} from './dog-3d-model.js';

const TAU = Math.PI * 2;
const DEFAULT_DURATION_MS = 4_000;
const WALK_STRIDE = .52;
const RUN_STRIDE = .76;
const WALK_STANCE = .64;
const RUN_STANCE = .52;
const WALK_LIFT = .105;
const RUN_LIFT = .19;
const LEG_KEYS = Object.freeze(['frontLeft', 'frontRight', 'rearLeft', 'rearRight']);
const LEG_JOINTS = Object.freeze([
  Object.freeze({ shoulder: [-.205, .075, .27], upper: 11, lower: 12, paw: 13, upperLength: .31, lowerLength: .30, phaseOffset: 0, bend: 1, baseZ: .30 }),
  Object.freeze({ shoulder: [.205, .075, .27], upper: 14, lower: 15, paw: 16, upperLength: .31, lowerLength: .30, phaseOffset: .5, bend: 1, baseZ: .30 }),
  Object.freeze({ shoulder: [-.205, .055, -.40], upper: 17, lower: 18, paw: 19, upperLength: .31, lowerLength: .30, phaseOffset: .5, bend: -1, baseZ: -.37 }),
  Object.freeze({ shoulder: [.205, .055, -.40], upper: 20, lower: 21, paw: 22, upperLength: .31, lowerLength: .30, phaseOffset: 0, bend: -1, baseZ: -.37 }),
]);
const VIEW_YAWS = Object.freeze({ front: 0, side: Math.PI / 2, back: Math.PI });
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeQuint = value => {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const DOG_3D_RIG_DIAGNOSTICS = Object.freeze({
  rigVersion: DOG_3D_RIG_VERSION,
  coordinateSystem: 'model units; x spans the body, y is up, z points forward; yaw 0 faces +Z',
  groundPlaneY: 0,
  standingRootHeight: DOG_3D_STAND_ROOT_HEIGHT,
  walkStrideLength: WALK_STRIDE,
  runStrideLength: RUN_STRIDE,
  stanceRatio: Object.freeze({ walk: WALK_STANCE, run: RUN_STANCE }),
  supportedActions: DOG_3D_SUPPORTED_ACTIONS,
  boneIDs: Object.freeze(Object.fromEntries(DOG_3D_JOINTS.map((name, id) => [name, id]))),
  contactFeet: LEG_KEYS,
  landmarks: Object.freeze(['crown', 'nose', 'mouth', 'leftEye', 'rightEye', 'tailTip', ...LEG_KEYS]),
  landmarkBindings: DOG_3D_LANDMARK_BINDINGS,
  contactMethod: 'spatial phase plus two-bone IK; stance world Z remains fixed over the full stance interval',
  reducedMotion: 'keeps breathing, blinking, regular gait and a slow tail; reduces jump, bounce and head motion',
  paused: 'renderer reuses its last complete rig sample until resumed',
});

export { DOG_3D_ACTIONS, DOG_3D_SUPPORTED_ACTIONS, DOG_3D_JOINTS };

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
    out[column * 4 + row] = a[row] * b[column * 4]
      + a[4 + row] * b[column * 4 + 1]
      + a[8 + row] * b[column * 4 + 2]
      + a[12 + row] * b[column * 4 + 3];
  }
  return out;
}

function translation(x = 0, y = 0, z = 0) {
  const out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

function rotateX(angle = 0) {
  const out = identity(), c = Math.cos(angle), s = Math.sin(angle);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

function rotateY(angle = 0) {
  const out = identity(), c = Math.cos(angle), s = Math.sin(angle);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

function rotateZ(angle = 0) {
  const out = identity(), c = Math.cos(angle), s = Math.sin(angle);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

function scaleMatrix(x = 1, y = 1, z = 1) {
  const out = identity();
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return Object.freeze({
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  });
}

function angleDelta(from, to) {
  return positiveModulo(to - from + Math.PI, TAU) - Math.PI;
}

function resolveYaw(args, action, actionAgeMs, durationMs) {
  const view = ['front', 'side', 'back'].includes(args.view) ? args.view : 'front';
  const target = finite(args.yaw, VIEW_YAWS[view]);
  if (action !== 'turn') return target;
  const inferredStart = view === 'side' ? 0 : view === 'back' ? Math.PI / 2 : Math.PI / 2;
  const start = finite(args.turnFromYaw, inferredStart);
  const progress = easeQuint(actionAgeMs / durationMs);
  return start + angleDelta(start, target) * progress;
}

function blinkAmount(timeMs) {
  const phase = positiveModulo(timeMs + 1_170, 4_100);
  if (phase >= 0 && phase < 125) return Math.sin(Math.PI * phase / 125);
  return 0;
}

function actionPose(action, actionAgeMs, durationMs, reducedMotion, animationTimeMs) {
  const progress = clamp(actionAgeMs / durationMs, 0, 1);
  const wave = TAU * positiveModulo(animationTimeMs, 1_400) / 1_400;
  const settle = easeQuint(progress);
  const pose = {
    rootY: DOG_3D_STAND_ROOT_HEIGHT,
    bodyRoll: 0,
    bodyBreath: 0,
    headPitch: 0,
    headTilt: 0,
    jawOpen: 0,
    tailBase: .035 * Math.sin(wave),
    tailMiddle: .05 * Math.sin(wave + .3),
    tailTip: .035 * Math.sin(wave + .65),
    earLeft: 0,
    earRight: 0,
    blink: blinkAmount(animationTimeMs),
    tongue: 0,
    airborne: false,
    footLift: 0,
    headFactor: reducedMotion ? .42 : 1,
    bodyBob: 0,
  };

  switch (action) {
    case 'walk':
    case 'run':
    case 'retrieve':
    case 'return':
      pose.bodyBob = reducedMotion ? .008 : action === 'run' ? .032 : .018;
      pose.headPitch = .022 * Math.sin(wave * 1.2) * pose.headFactor;
      pose.tailBase = .18 * Math.sin(wave * (reducedMotion ? .55 : 1));
      pose.tailMiddle = .16 * Math.sin(wave * (reducedMotion ? .55 : 1) + .35);
      pose.tailTip = .12 * Math.sin(wave * (reducedMotion ? .55 : 1) + .75);
      break;
    case 'sit':
    case 'sitWait':
    case 'rest':
      pose.rootY -= .22 * settle;
      pose.headPitch = .07;
      pose.tailBase *= .5;
      pose.tailMiddle *= .5;
      break;
    case 'lie':
      pose.rootY -= .37 * settle;
      pose.bodyRoll = .12 * settle;
      pose.headPitch = .12;
      pose.tailBase *= .25;
      break;
    case 'sleep':
      pose.rootY -= .40;
      pose.bodyRoll = .16;
      pose.headPitch = .16 + .012 * Math.sin(wave * .45) * pose.headFactor;
      pose.blink = 1;
      pose.tailBase *= .14;
      pose.tailMiddle *= .14;
      pose.tailTip *= .14;
      break;
    case 'wake':
      pose.rootY -= .40 * (1 - settle);
      pose.headPitch = .18 * (1 - settle);
      pose.blink = 1 - settle;
      break;
    case 'stretch':
    case 'playBow':
      pose.rootY -= .10;
      pose.headPitch = .34 * (action === 'stretch' ? settle : 1);
      pose.bodyRoll = .06;
      pose.tailBase = .16;
      break;
    case 'yawn':
      pose.headPitch = -.04;
      pose.jawOpen = .22 + .28 * Math.sin(Math.PI * progress);
      break;
    case 'headTilt':
      pose.headTilt = .20 * Math.sin(Math.PI * progress);
      pose.earLeft = -.08 * Math.sin(Math.PI * progress);
      pose.earRight = .08 * Math.sin(Math.PI * progress);
      break;
    case 'petHappy':
    case 'finish':
      pose.headTilt = .10 * Math.sin(wave * .45);
      pose.headPitch = -.035 * Math.sin(wave * .8) * pose.headFactor;
      pose.tailBase = .43 * Math.sin(wave * (reducedMotion ? .5 : 1.7));
      pose.tailMiddle = .29 * Math.sin(wave * (reducedMotion ? .5 : 1.7) + .4);
      pose.tailTip = .22 * Math.sin(wave * (reducedMotion ? .5 : 1.7) + .8);
      pose.bodyBob = reducedMotion ? .006 : .018;
      break;
    case 'bellyUp':
      pose.rootY -= .12;
      pose.bodyRoll = 1.12;
      pose.headTilt = .12;
      pose.airborne = true;
      pose.footLift = .25;
      pose.blink = .15;
      break;
    case 'happyJump':
    case 'jumpCatch': {
      const height = reducedMotion ? .12 : .34;
      pose.bodyBob = height * Math.sin(Math.PI * progress);
      pose.airborne = progress < 1;
      pose.footLift = pose.bodyBob;
      pose.headPitch = -.09 * Math.sin(Math.PI * progress) * pose.headFactor;
      pose.tailBase = .28 * Math.sin(wave);
      break;
    }
    case 'sleepyRefuse':
      pose.headTilt = .06 * Math.sin(wave * .7);
      pose.blink = Math.max(pose.blink, .42);
      pose.tailBase *= .2;
      break;
    case 'lookPlayer':
      pose.headPitch = -.045;
      break;
    case 'peek':
      pose.rootY -= .12 * settle;
      pose.headPitch = -.10;
      break;
    case 'lookFood':
    case 'sniff':
    case 'sniffFood':
      pose.headPitch = .27 + .025 * Math.sin(wave * 1.35);
      pose.tailBase = .07 * Math.sin(wave * .35);
      break;
    case 'eat':
      pose.headPitch = .22 + .025 * Math.sin(wave * 2.5);
      pose.jawOpen = .045 + .025 * (1 + Math.sin(wave * 5));
      pose.tailBase = .055 * Math.sin(wave * .45);
      break;
    case 'feed':
      if (progress < .22) {
        const local = progress / .22;
        pose.headPitch = .30 * easeQuint(local);
        pose.jawOpen = .015 * easeQuint(local);
      } else if (progress < .80) {
        const local = (progress - .22) / .58;
        pose.headPitch = .30 + .026 * Math.sin(TAU * 3 * local);
        pose.jawOpen = .015 + .025 * easeQuint(local);
      }
      else {
        const local = (progress - .80) / .20;
        pose.headPitch = .30 - .19 * easeQuint(local);
        pose.tongue = Math.sin(Math.PI * local) ** 2;
        pose.jawOpen = .04 + .10 * pose.tongue;
      }
      pose.tailBase = .07 * Math.sin(wave * .4);
      break;
    case 'lick':
      pose.headPitch = .17;
      pose.tongue = .5 + .5 * Math.sin(wave * 3);
      pose.jawOpen = .04 + .09 * pose.tongue;
      break;
    case 'tug':
    case 'plushShake':
      pose.rootY -= .08;
      pose.headPitch = .25 + (reducedMotion ? .025 : .085) * Math.sin(wave * 2.4);
      pose.headTilt = (reducedMotion ? .025 : .09) * Math.sin(wave * 2.4 + .6);
      pose.tailBase = .16 * Math.sin(wave * .65);
      pose.jawOpen = action === 'plushShake' ? .05 : .10;
      break;
    case 'cuddle':
    case 'plushCuddle':
      pose.rootY -= .29;
      pose.bodyRoll = .12;
      pose.headPitch = .16;
      pose.tailBase = .06 * Math.sin(wave * .5);
      break;
    case 'carry':
      pose.headPitch = -.10;
      pose.jawOpen = .06;
      pose.tailBase = .11 * Math.sin(wave * .7);
      break;
    case 'fall':
      pose.rootY -= .48 * easeQuint(progress);
      pose.bodyRoll = .90 * easeQuint(progress);
      pose.headTilt = .10 * Math.sin(Math.PI * progress);
      pose.airborne = progress < .95;
      pose.footLift = .08 * (1 - progress);
      break;
    case 'enterHouse':
      pose.rootY -= .22 * settle;
      pose.headPitch = .15;
      break;
    case 'insideHouse':
      pose.rootY -= .18;
      pose.headPitch = -.06;
      pose.blink = Math.max(pose.blink, .22);
      break;
    case 'exitHouse':
      pose.rootY -= .20 * (1 - settle);
      pose.headPitch = -.06 * (1 - settle);
      break;
    default:
      break;
  }

  return pose;
}

function solveLeg(leg, ankleY, ankleZ) {
  const [sx, sy, sz] = leg.shoulder;
  const dy = ankleY - sy, dz = ankleZ - sz;
  const distance = Math.max(.001, Math.hypot(dy, dz));
  const maximumReach = leg.upperLength + leg.lowerLength - .002;
  const minimumReach = Math.abs(leg.upperLength - leg.lowerLength) + .002;
  const d = clamp(distance, minimumReach, maximumReach);
  const uy = dy / distance, uz = dz / distance;
  const along = (leg.upperLength ** 2 - leg.lowerLength ** 2 + d ** 2) / (2 * d);
  const bendHeight = Math.sqrt(Math.max(0, leg.upperLength ** 2 - along ** 2));
  const kneeY = sy + uy * along - uz * bendHeight * leg.bend;
  const kneeZ = sz + uz * along + uy * bendHeight * leg.bend;
  const firstDy = kneeY - sy, firstDz = kneeZ - sz;
  const secondDy = ankleY - kneeY, secondDz = ankleZ - kneeZ;
  return {
    upperAngle: Math.atan2(-firstDz, -firstDy),
    lowerAngle: Math.atan2(-secondDz, -secondDy),
    knee: Object.freeze({ x: sx, y: kneeY, z: kneeZ }),
    ankle: Object.freeze({ x: sx, y: ankleY, z: ankleZ }),
  };
}

function actionGait(action, velocity, hasVelocity) {
  if (action === 'run' || action === 'retrieve' || action === 'return') return 'run';
  if (action === 'walk') return 'walk';
  if (action === 'carry' && Math.abs(velocity) > .001) return Math.abs(velocity) >= .65 ? 'run' : 'walk';
  if (hasVelocity && Math.abs(velocity) > .01) return Math.abs(velocity) >= .65 ? 'run' : 'walk';
  return null;
}

function createMatrices({ yaw, rootY, bodyRoll, bodyBreath, headPitch, headTilt, jawOpen, ears, blink, tail, legs, tongue }) {
  const root = multiply(translation(0, rootY, 0), rotateY(yaw));
  const body = multiply(multiply(root, rotateZ(bodyRoll)), scaleMatrix(1, 1 + bodyBreath, 1));
  const headPivot = DOG_3D_BIND_PIVOTS[2];
  const head = multiply(multiply(multiply(body, translation(...headPivot)), rotateX(headPitch)), rotateZ(headTilt));
  const jawPivot = DOG_3D_BIND_PIVOTS[3];
  const jaw = multiply(multiply(head, translation(jawPivot[0] - headPivot[0], jawPivot[1] - headPivot[1], jawPivot[2] - headPivot[2])), rotateX(jawOpen));
  const matrices = Array.from({ length: DOG_3D_JOINTS.length }, () => identity());
  matrices[0] = root;
  matrices[1] = body;
  matrices[2] = head;
  matrices[3] = jaw;

  for (const [joint, angle] of [[4, ears.left], [5, ears.right]]) {
    const pivot = DOG_3D_BIND_PIVOTS[joint];
    matrices[joint] = multiply(multiply(head, translation(pivot[0] - headPivot[0], pivot[1] - headPivot[1], pivot[2] - headPivot[2])), rotateZ(angle));
  }
  for (const [joint, side] of [[6, -1], [7, 1]]) {
    const pivot = DOG_3D_BIND_PIVOTS[joint];
    const centerOffset = [0, .07, .001];
    const lid = multiply(multiply(multiply(multiply(multiply(head,
      translation(pivot[0] - headPivot[0], pivot[1] - headPivot[1], pivot[2] - headPivot[2])),
      translation(0, -.04 * blink, 0)),
      translation(...centerOffset)), scaleMatrix(1, 1 + .8 * blink, 1)),
      translation(-centerOffset[0], -centerOffset[1], -centerOffset[2]));
    matrices[joint] = lid;
    void side;
  }

  const tailPivots = [8, 9, 10].map(index => DOG_3D_BIND_PIVOTS[index]);
  matrices[8] = multiply(multiply(body, translation(...tailPivots[0])), rotateY(tail.base));
  matrices[9] = multiply(multiply(multiply(multiply(body, translation(...tailPivots[0])), rotateY(tail.base)),
    translation(tailPivots[1][0] - tailPivots[0][0], tailPivots[1][1] - tailPivots[0][1], tailPivots[1][2] - tailPivots[0][2])), rotateY(tail.middle));
  matrices[10] = multiply(multiply(multiply(multiply(multiply(body, translation(...tailPivots[0])), rotateY(tail.base)),
    translation(tailPivots[1][0] - tailPivots[0][0], tailPivots[1][1] - tailPivots[0][1], tailPivots[1][2] - tailPivots[0][2])), rotateY(tail.middle)),
    multiply(translation(tailPivots[2][0] - tailPivots[1][0], tailPivots[2][1] - tailPivots[1][1], tailPivots[2][2] - tailPivots[1][2]), rotateY(tail.tip)));

  for (const leg of legs) {
    const [sx, sy, sz] = leg.definition.shoulder;
    const upper = multiply(multiply(root, translation(sx, sy, sz)), rotateX(leg.solution.upperAngle));
    const lower = multiply(multiply(multiply(upper, translation(0, -leg.definition.upperLength, 0)), rotateX(leg.solution.lowerAngle)), identity());
    const paw = multiply(root, translation(sx, leg.ankleY, leg.ankleZ));
    matrices[leg.definition.upper] = upper;
    matrices[leg.definition.lower] = lower;
    matrices[leg.definition.paw] = paw;
  }

  const tonguePivot = DOG_3D_BIND_PIVOTS[23];
  matrices[23] = multiply(multiply(multiply(head,
    translation(tonguePivot[0] - headPivot[0], tonguePivot[1] - headPivot[1], tonguePivot[2] - headPivot[2])),
    translation(0, -.075 * tongue, .015 * tongue)), rotateX(.22 * tongue));
  return matrices;
}

function freezePoint(point) {
  return Object.freeze({ x: point.x, y: point.y, z: point.z });
}

function worldPoint(poseMatrices, joint, point) {
  return transformPoint(poseMatrices[joint], point);
}

/**
 * Pure absolute-time rig sampler. Stance feet derive from ground distance so
 * frame rate does not affect their world contact points. `paused` callers can
 * supply `frozenPose`; the renderer does this to freeze the entire previous pose.
 */
export function sampleDog3DPose(args = {}) {
  if (args.paused && args.frozenPose) return args.frozenPose;

  const action = DOG_3D_ACTIONS.includes(args.action) ? args.action : 'idle';
  const paused = args.paused === true;
  const timeMs = paused ? 0 : Math.max(0, finite(args.timeMs));
  const actionAgeMs = paused ? 0 : Math.max(0, finite(args.actionAgeMs, timeMs));
  const durationMs = Number.isFinite(args.durationMs) && args.durationMs > 0 ? Math.max(1, args.durationMs) : DEFAULT_DURATION_MS;
  const reducedMotion = args.reducedMotion === true;
  const velocity = paused ? 0 : finite(args.velocity);
  const groundDistance = paused ? 0 : finite(args.groundDistance);
  const hasVelocity = Number.isFinite(args.velocity);
  const gait = paused ? null : actionGait(action, velocity, hasVelocity);
  const strideLength = gait === 'run' ? RUN_STRIDE : gait === 'walk' ? WALK_STRIDE : null;
  const stanceRatio = gait === 'run' ? RUN_STANCE : gait === 'walk' ? WALK_STANCE : 1;
  const phase = strideLength ? positiveModulo(groundDistance / strideLength, 1) : 0;
  const gaitWeight = gait
    ? hasVelocity ? smoothstep(Math.abs(velocity) / (gait === 'run' ? 1.2 : .72)) : 1
    : 0;
  const turnDuration = durationMs;
  const yaw = resolveYaw(args, action, actionAgeMs, turnDuration);
  const pose = actionPose(action, actionAgeMs, durationMs, reducedMotion, timeMs);
  const breathe = paused ? 0 : Math.sin(TAU * positiveModulo(timeMs, 4_800) / 4_800);
  pose.rootY += pose.bodyBob + breathe * (reducedMotion ? .004 : .007);
  pose.bodyBreath = paused ? 0 : breathe * (reducedMotion ? .006 : .011);
  pose.headPitch += finite(args.headNod) * (reducedMotion ? .42 : 1);
  pose.bodyRoll += clamp(finite(args.moveLean), -1, 1) * (reducedMotion ? .025 : .075);
  const externalTail = finite(args.tailWag);
  const tailScale = reducedMotion ? .35 : .62;
  pose.tailBase += externalTail * tailScale;
  pose.tailMiddle += externalTail * tailScale * .68;
  pose.tailTip += externalTail * tailScale * .42;
  const headPitch = clamp(pose.headPitch, -.48, .62);
  const bodyRoll = clamp(pose.bodyRoll, -.48, 1.22);
  const headTilt = pose.headTilt * (reducedMotion ? .48 : 1);
  const gaitWave = strideLength ? TAU * phase : 0;
  if (gait) pose.rootY += (reducedMotion ? .006 : gait === 'run' ? .024 : .012) * Math.abs(Math.sin(gaitWave * 2)) * gaitWeight;

  const jumping = pose.airborne;
  const planted = !jumping && action !== 'bellyUp';
  const legs = LEG_JOINTS.map((definition, index) => {
    const legPhase = strideLength ? positiveModulo(groundDistance / strideLength + definition.phaseOffset, 1) : 0;
    const isStance = !strideLength || legPhase < stanceRatio;
    const swingProgress = strideLength && !isStance
      ? (legPhase - stanceRatio) / (1 - stanceRatio)
      : 0;
    let localZ = definition.baseZ;
    let lift = 0;
    if (strideLength) {
      if (isStance) {
        const stanceProgress = legPhase / stanceRatio;
        localZ += strideLength * stanceRatio * (.5 - stanceProgress);
      } else {
        const t = swingProgress;
        const swingCurve = -stanceRatio / 2 - (1 - stanceRatio) * t + 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
        localZ += strideLength * swingCurve;
        lift = Math.sin(Math.PI * t) ** 2 * (gait === 'run' ? RUN_LIFT : WALK_LIFT) * gaitWeight
          * (reducedMotion ? .45 : 1);
      }
    }
    const footLift = lift + (jumping ? pose.footLift : 0);
    const ankleY = .09 + footLift - pose.rootY;
    const solution = solveLeg(definition, ankleY, localZ);
    return Object.freeze({
      definition,
      phase: legPhase,
      stance: isStance,
      swing: swingProgress,
      lift: footLift,
      localZ,
      ankleY,
      ankleZ: localZ,
      contact: planted && (isStance || gaitWeight <= .001) && footLift <= .00001,
      solution,
    });
  });
  const matrices = createMatrices({
    yaw, rootY: pose.rootY, bodyRoll, bodyBreath: pose.bodyBreath,
    headPitch, headTilt, jawOpen: pose.jawOpen,
    ears: { left: pose.earLeft, right: pose.earRight }, blink: pose.blink,
    tail: { base: pose.tailBase, middle: pose.tailMiddle, tip: pose.tailTip },
    legs, tongue: pose.tongue,
  });
  const landmarks = Object.freeze(Object.fromEntries(Object.entries(DOG_3D_LANDMARK_BINDINGS).map(([name, binding]) => [
    name, worldPoint(matrices, binding.joint, binding.point),
  ])));
  const worldRoot = Object.freeze({ x: Math.sin(yaw) * groundDistance, z: Math.cos(yaw) * groundDistance });
  const contactFeet = Object.freeze(Object.fromEntries(legs.map((leg, index) => {
    const name = LEG_KEYS[index];
    const footBottom = worldPoint(matrices, leg.definition.paw, [0, -.09, 0]);
    const world = Object.freeze({
      x: footBottom.x + worldRoot.x,
      y: footBottom.y,
      z: footBottom.z + worldRoot.z,
    });
    const local = freezePoint(footBottom);
    return [name, Object.freeze({
      name,
      contact: leg.contact && Math.abs(footBottom.y) <= .003,
      stance: leg.stance,
      swing: leg.swing,
      lift: leg.lift,
      phase: leg.phase,
      world,
      local,
      boneIDs: Object.freeze({ upper: leg.definition.upper, lower: leg.definition.lower, paw: leg.definition.paw }),
    })];
  })));
  const worldLandmarks = Object.freeze(Object.fromEntries(Object.entries(landmarks).map(([name, point]) => [name,
    Object.freeze({ x: point.x + worldRoot.x, y: point.y, z: point.z + worldRoot.z })])));

  return Object.freeze({
    action,
    timeMs,
    actionAgeMs,
    durationMs,
    progress: clamp(actionAgeMs / durationMs, 0, 1),
    yaw,
    targetYaw: finite(args.yaw, VIEW_YAWS[['front', 'side', 'back'].includes(args.view) ? args.view : 'front']),
    view: ['front', 'side', 'back'].includes(args.view) ? args.view : 'front',
    groundDistance,
    velocity,
    gait,
    gaitWeight,
    strideLength,
    stride: Object.freeze({
      gait,
      phase,
      strideLength,
      stanceRatio,
      cycleDurationMs: strideLength && Math.abs(velocity) > .0001 ? strideLength / Math.abs(velocity) * 1_000 : null,
      plantedFeet: Object.freeze(legs.filter(leg => leg.contact).map((leg, index) => LEG_KEYS[legs.indexOf(leg)])),
    }),
    rootY: pose.rootY,
    bodyRoll,
    bodyBreath: pose.bodyBreath,
    headPitch,
    headTilt,
    jawOpen: pose.jawOpen,
    blink: pose.blink,
    reducedMotion,
    paused,
    contactFeet,
    landmarks,
    worldLandmarks,
    jointMatrices: matrices,
  });
}

/** Rebuild rig diagnostics after renderer-side bone blending. */
export function refreshDog3DPoseDiagnostics(pose, jointMatrices) {
  const root = jointMatrices[0];
  const yaw = Math.atan2(root[8], root[0]);
  const landmarks = Object.freeze(Object.fromEntries(Object.entries(DOG_3D_LANDMARK_BINDINGS).map(([name, binding]) => [
    name, worldPoint(jointMatrices, binding.joint, binding.point),
  ])));
  const rootWorld = Object.freeze({ x: Math.sin(yaw) * pose.groundDistance, z: Math.cos(yaw) * pose.groundDistance });
  const contactFeet = Object.freeze(Object.fromEntries(Object.entries(pose.contactFeet).map(([name, foot]) => {
    const bottom = worldPoint(jointMatrices, foot.boneIDs.paw, [0, -.09, 0]);
    return [name, Object.freeze({
      ...foot,
      contact: foot.contact && Math.abs(bottom.y) <= .003,
      local: bottom,
      world: Object.freeze({ x: bottom.x + rootWorld.x, y: bottom.y, z: bottom.z + rootWorld.z }),
    })];
  })));
  const worldLandmarks = Object.freeze(Object.fromEntries(Object.entries(landmarks).map(([name, point]) => [name,
    Object.freeze({ x: point.x + rootWorld.x, y: point.y, z: point.z + rootWorld.z })])));
  return Object.freeze({
    ...pose,
    yaw,
    rootY: root[13],
    jointMatrices,
    landmarks,
    worldLandmarks,
    contactFeet,
  });
}

export function dog3DPointOnScreen(point, { x = 0, foot = 0, size = 140, standingHeight = 1.8 } = {}) {
  const scale = size / Math.max(.001, standingHeight);
  return Object.freeze({ x: finite(x) + point.x * scale, y: finite(foot) - point.y * scale });
}
