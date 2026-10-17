import { projectStreet } from './street-camera.js';

const TAU = Math.PI * 2;
const ROAD_CLEARANCE = 1.86;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

const makeAnimal = (id, kind, lane, at, width, depth, height, extra = {}) =>
  Object.freeze({ id, kind, lane, at, width, depth, height, elevation: 0,
    behavior: kind, animationOffset: 0, facing: 1, ...extra });

/**
 * Wildlife belongs to the world camera, outside the playable trail. Coordinates
 * and dimensions are in the same world units as mountain-scene landmarks.
 * Wildlife is decorative and is intentionally absent from the game course.
 */
export const MOUNTAIN_WILDLIFE = Object.freeze([
  // Trailhead: a pair of rabbits sits between flower patches, with birds above.
  makeAnimal('trail-rabbit-west', 'rabbit', -2.82, 8.35, .96, .58, .82,
    { animationOffset: .3, facing: 1, section: 'trailhead' }),
  makeAnimal('trail-butterfly-west', 'butterfly', -3.28, 7.65, .46, .32, .42,
    { elevation: .66, animationOffset: 1.2, section: 'trailhead' }),
  makeAnimal('trail-rabbit-east', 'rabbit', 2.91, 11.15, .94, .58, .8,
    { animationOffset: 2.3, facing: -1, section: 'trailhead' }),
  makeAnimal('trail-bird-west', 'bird', -5.38, 10.2, .72, .34, .62,
    { elevation: 3.75, animationOffset: .7, facing: 1, section: 'trailhead' }),
  makeAnimal('trail-bird-east', 'bird', 5.72, 6.6, .72, .34, .62,
    { elevation: 4.25, animationOffset: 2.4, facing: -1, section: 'trailhead' }),

  // Deep forest: recognizable deer and fox silhouettes, with a squirrel on a
  // low bank and a small bird perched well above the undergrowth.
  makeAnimal('forest-squirrel', 'squirrel', -2.82, 17.05, 1.02, .54, 1.08,
    { animationOffset: .8, section: 'deep-forest' }),
  makeAnimal('forest-deer', 'deer', 3.16, 18.55, 1.62, .78, 2.08,
    { animationOffset: 1.15, variant: 'stag', section: 'deep-forest' }),
  makeAnimal('forest-bird', 'bird', 5.82, 18.2, .76, .34, .64,
    { elevation: 4.05, animationOffset: 1.9, facing: -1, section: 'deep-forest' }),
  makeAnimal('forest-fox', 'fox', -3.36, 21.5, 1.64, .72, 1.12,
    { animationOffset: 2.05, facing: 1, section: 'deep-forest' }),
  makeAnimal('forest-butterfly', 'butterfly', 3.36, 20.2, .48, .3, .44,
    { elevation: .72, animationOffset: .4, section: 'deep-forest' }),

  // Stream: amphibians stay at the rocky margin; dragonflies hover over water.
  makeAnimal('stream-frog', 'frog', 3.14, 27.15, .94, .55, .56,
    { animationOffset: .6, facing: -1, section: 'stream' }),
  makeAnimal('stream-dragonfly', 'dragonfly', 4.12, 27.85, .78, .3, .4,
    { elevation: .78, animationOffset: 1.4, facing: 1, section: 'stream' }),
  makeAnimal('stream-bird', 'bird', 5.92, 25.15, .72, .34, .6,
    { elevation: 3.95, animationOffset: .5, facing: -1, section: 'stream' }),
  makeAnimal('stream-butterfly', 'butterfly', 2.76, 30.0, .46, .3, .42,
    { elevation: .84, animationOffset: 1.8, section: 'stream' }),
  makeAnimal('stream-frog-east', 'frog', 4.36, 31.05, .88, .52, .53,
    { animationOffset: 2.2, facing: 1, section: 'stream' }),

  // Ridge: a doe and fawn gather by the broken tree line; later encounters
  // keep the final stretch alive after the first pair has passed.
  makeAnimal('ridge-doe', 'deer', 3.04, 36.8, 1.5, .76, 1.92,
    { animationOffset: 2.1, variant: 'doe', facing: -1, section: 'ridge' }),
  makeAnimal('ridge-fawn', 'deer', 4.72, 38.1, 1.12, .62, 1.34,
    { animationOffset: .45, variant: 'fawn', facing: -1, section: 'ridge' }),
  makeAnimal('ridge-bird', 'bird', 5.72, 36.4, .76, .34, .65,
    { elevation: 4.2, animationOffset: 1.25, facing: 1, section: 'ridge' }),
  makeAnimal('ridge-deer-west', 'deer', -3.28, 43.15, 1.5, .76, 1.94,
    { animationOffset: .9, variant: 'doe', section: 'ridge' }),
  makeAnimal('ridge-fox-east', 'fox', 3.36, 40.1, 1.56, .7, 1.08,
    { animationOffset: 1.5, facing: -1, section: 'ridge' }),
  makeAnimal('ridge-rabbit-west', 'rabbit', -2.88, 41.6, .92, .56, .78,
    { animationOffset: 1.7, facing: 1, section: 'ridge' }),
].sort((a, b) => b.at - a.at));

const MOTION = Object.freeze({
  deer: Object.freeze({ period: 7.2, firstStart: 3.02, firstEnd: 3.52, returnStart: 6.78, lane: .016, lift: 0 }),
  fox: Object.freeze({ period: 5.2, firstStart: 1.55, firstEnd: 2.05, returnStart: 4.7, lane: .052, lift: 0 }),
  rabbit: Object.freeze({ period: 4.8, firstStart: 1.55, firstEnd: 2.02, returnStart: 4.42, lane: .015, lift: .13 }),
  squirrel: Object.freeze({ period: 5.6, firstStart: 2.05, firstEnd: 2.6, returnStart: 5.0, lane: .012, lift: 0 }),
  bird: Object.freeze({ period: 3.8, firstStart: 1.1, firstEnd: 1.45, returnStart: 3.46, lane: .09, lift: .12 }),
  butterfly: Object.freeze({ period: 1.8, firstStart: .46, firstEnd: .72, returnStart: 1.54, lane: .09, lift: .08 }),
  frog: Object.freeze({ period: 4.4, firstStart: 1.55, firstEnd: 1.95, returnStart: 4.0, lane: .012, lift: .025 }),
  dragonfly: Object.freeze({ period: 2.5, firstStart: .75, firstEnd: 1.0, returnStart: 2.22, lane: .07, lift: .07 }),
});

/**
 * Pure, game-clock-driven motion sample. Offset amplitudes are world units, so
 * small animals remain near their anchor and no pose can enter the trail.
 */
export function sampleWildlifeMotion(object, timeMs = 0, reducedMotion = false) {
  const behavior = MOTION[object?.behavior] ? object.behavior : object?.kind;
  const spec = MOTION[behavior] ?? MOTION.bird;
  if (reducedMotion) return Object.freeze({
    laneOffset: 0, elevationOffset: 0, pose: 0, poseFrom: 0, poseTo: 1,
    poseMix: 0, phase: 0,
  });

  const seconds = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0) / 1000;
  const phase = mod(seconds + (Number.isFinite(object?.animationOffset) ? object.animationOffset : 0), spec.period);
  let poseMix = 0;
  if (phase >= spec.firstStart && phase < spec.firstEnd) {
    poseMix = smooth(spec.firstStart, spec.firstEnd, phase);
  } else if (phase >= spec.firstEnd && phase < spec.returnStart) {
    poseMix = 1;
  } else if (phase >= spec.returnStart) {
    poseMix = 1 - smooth(spec.returnStart, spec.period, phase);
  }

  const wave = Math.sin(TAU * phase / spec.period);
  const hop = behavior === 'rabbit' ? Math.max(0, wave) ** 4 : 0;
  const hover = behavior === 'butterfly' || behavior === 'dragonfly' || behavior === 'bird'
    ? Math.sin(TAU * phase / spec.period) : 0;
  return Object.freeze({
    laneOffset: spec.lane * wave,
    elevationOffset: behavior === 'rabbit' ? spec.lift * hop : spec.lift * hover,
    pose: poseMix < .5 ? 0 : 1,
    poseFrom: 0,
    poseTo: 1,
    poseMix,
    phase,
  });
}

const ellipse = (renderer, x, y, rx, ry, fill, stroke = null, angle = 0) =>
  renderer.ellipse(x, y, rx, ry, fill, stroke, angle);
const path = (renderer, points, fill, stroke = null, width = .7) => renderer.path(points, fill, stroke, width);

function drawDeer(r, pose, o) {
  // Body, near and far legs, shoulder, face and a small forked antler give the
  // fallback a deer silhouette even at the compact preview scale.
  path(r, [[-38,-18],[-31,-31],[-13,-38],[10,-35],[25,-26],[31,-13],[24,-7],[-28,-8]], '#92714f', '#4e4535', 1.1);
  ellipse(r, -7, -23, 22, 12, '#a9825b', '#5b4938', -.12);
  path(r, [[5,-30],[11,-48],[18,-58],[28,-57],[32,-50],[24,-47],[21,-32],[15,-22]], '#a77c52', '#5b4938', .8);
  if (pose === 0) {
    path(r, [[17,-54],[22,-60],[32,-61],[35,-56],[28,-52],[21,-49]], '#b78c5d', '#5e4832', .7);
    ellipse(r, 31, -57, 1.25, 1.1, '#171c19');
    path(r, [[23,-59],[22,-66],[20,-68],[19,-64],[15,-66],[18,-62]], '#704d32', '#4d3c2d', .6);
    path(r, [[24,-59],[28,-66],[30,-67],[29,-63],[33,-65],[30,-61]], '#704d32', '#4d3c2d', .6);
  } else {
    path(r, [[19,-56],[25,-63],[35,-65],[37,-60],[30,-56],[22,-52]], '#b78c5d', '#5e4832', .7);
    ellipse(r, 33, -61, 1.25, 1.1, '#171c19');
    path(r, [[23,-62],[22,-69],[20,-71],[19,-67],[15,-69],[18,-65]], '#704d32', '#4d3c2d', .6);
    path(r, [[24,-62],[28,-69],[30,-70],[29,-66],[33,-68],[30,-64]], '#704d32', '#4d3c2d', .6);
  }
  path(r, [[-34,-20],[-39,-14],[-33,-11],[-27,-17]], '#f0dfc3', '#79614a', .6);
  // Four fine lower legs are visible against the shadow.
  path(r, [[-25,-14],[-22,-12],[-25,-2],[-28,0],[-29,-2]], '#6a5239', '#433b30', .55);
  path(r, [[-10,-14],[-7,-13],[-7,-2],[-10,0],[-12,-2]], '#71563a', '#433b30', .55);
  path(r, [[14,-17],[17,-15],[17,-3],[14,0],[12,-2]], '#71563a', '#433b30', .55);
  path(r, [[24,-18],[27,-17],[29,-4],[26,-1],[24,-3]], '#604b35', '#433b30', .55);
  path(r, [[-31,-2],[-26,-2],[-26,1],[-32,1]], '#3a352b');
  path(r, [[-13,-2],[-8,-2],[-8,1],[-14,1]], '#3a352b');
  path(r, [[10,-2],[16,-2],[16,1],[9,1]], '#3a352b');
  path(r, [[23,-3],[29,-3],[30,0],[22,0]], '#3a352b');
  ellipse(r, -1, -20, 7, 8, '#cfac7e38');
}

function drawFox(r, pose) {
  path(r, [[-39,-17],[-33,-29],[-15,-37],[4,-34],[19,-23],[27,-15],[20,-7],[-30,-8]], '#b86435', '#583a2e', 1);
  ellipse(r, -7, -23, 21, 12, '#c87841', '#623c2c', -.1);
  // Brush tail curls behind the body and ends in a clear cream tip.
  path(r, [[-23,-25],[-36,-36],[-46,-35],[-48,-28],[-43,-22],[-34,-20],[-28,-14],[-21,-15],[-29,-23],[-35,-28],[-29,-30]], '#b65e34', '#5c3d30', .9);
  path(r, [[-44,-34],[-48,-31],[-47,-27],[-42,-25],[-39,-29]], '#eee2c9', '#806550', .6);
  path(r, [[8,-31],[14,-46],[23,-55],[28,-50],[28,-41],[21,-32]], '#c97841', '#5a3c2e', .7);
  ellipse(r, 23, -50, 6, 5.5, '#c87841', '#5a3c2e', .1);
  path(r, [[18,-53],[17,-64],[22,-57]], '#ab5435', '#653d30', .6);
  path(r, [[25,-54],[31,-62],[29,-53]], '#ab5435', '#653d30', .6);
  ellipse(r, 27, -49, 1.25, 1.1, '#181d19');
  path(r, [[29,-46],[40,-42],[34,-39],[27,-42]], '#e8ddc6', '#624638', .55);
  ellipse(r, 40, -42, 1.35, 1, '#25231e');
  path(r, [[-25,-15],[-21,-14],[-23,-2],[-27,0],[-29,-2]], '#6c4230', '#49352c', .55);
  path(r, [[-5,-14],[-1,-13],[-1,-2],[-4,0],[-7,-2]], '#60402f', '#49352c', .55);
  path(r, [[11,-17],[15,-15],[16,-3],[12,0],[10,-2]], '#6a4130', '#49352c', .55);
  path(r, [[20,-18],[24,-17],[27,-4],[23,-1],[21,-3]], '#563b2e', '#49352c', .55);
  if (pose) path(r, [[8,-33],[15,-38],[19,-28],[17,-20],[10,-23]], '#f1e5cd', null, 0);
}

function drawRabbit(r, pose) {
  ellipse(r, -5, -18, 22, 14, '#9a9587', '#4c4b43', -.16);
  ellipse(r, 10, -17, 11, 10, '#b7b0a0', '#4c4b43', .12);
  // Ear silhouette changes by only a few degrees between the two resting poses.
  const earTilt = pose ? 4 : -1;
  path(r, [[10,-25],[8+earTilt,-50],[12+earTilt,-66],[17+earTilt,-63],[18,-47],[17,-27]], '#9b978b', '#4a4b43', .7);
  path(r, [[19,-24],[22-earTilt,-43],[29-earTilt,-55],[33-earTilt,-51],[29,-39],[25,-24]], '#aaa496', '#4a4b43', .7);
  path(r, [[12,-31],[12+earTilt,-56],[15+earTilt,-61],[16,-33]], '#d28d91');
  path(r, [[21,-29],[25-earTilt,-45],[29-earTilt,-51],[27,-32]], '#d28d91');
  ellipse(r, 23, -18, 8, 7, '#b9b3a5', '#4a4b43', -.15);
  ellipse(r, 27, -19, 1.1, 1, '#252723');
  ellipse(r, 30, -16, 1.4, 1, '#d08e91');
  ellipse(r, -19, -9, 10, 7, '#aaa496', '#4a4b43', .15);
  path(r, [[-23,-11],[-31,-8],[-27,-5],[-18,-7]], '#e3ddd1', '#686357', .45);
  path(r, [[-17,-9],[-16,-1],[-22,0],[-26,-2]], '#ded8cc', '#57564e', .5);
}

function drawSquirrel(r, pose) {
  // A high curled plume with a cream inner crescent is the key silhouette cue.
  path(r, [[-11,-19],[-26,-30],[-29,-43],[-23,-56],[-12,-61],[0,-56],[7,-46],[4,-35],[-4,-31],[-12,-36],[-11,-43],[-4,-45],[-2,-40],[1,-44],[-3,-51],[-12,-52],[-20,-45],[-20,-37],[-12,-29],[-3,-24]], '#a85d37', '#533a2d', 1);
  path(r, [[-13,-37],[-17,-44],[-12,-51],[-7,-49],[-6,-44],[-11,-42],[-8,-38]], '#dfad76', '#775039', .55);
  ellipse(r, 1, -16, 12, 17, '#a85d37', '#533a2d', -.08);
  ellipse(r, 10, -34, 9, 9, '#b66a3c', '#533a2d', .1);
  path(r, [[5,-39],[4,-48],[10,-42]], '#a75b37', '#533a2d', .6);
  ellipse(r, 9, -35, 1.2, 1.1, '#211f1c');
  ellipse(r, 17, -31, 1.4, 1, '#35251f');
  path(r, [[-6,-13],[-1,-11],[-2,-1],[-7,0],[-9,-2]], '#704631', '#4d362c', .55);
  path(r, [[5,-13],[10,-12],[13,-2],[8,0],[5,-2]], '#704631', '#4d362c', .55);
  ellipse(r, 6, -22, 4.5, 7, pose ? '#d6b08b' : '#d1a47a', null, -.25);
  path(r, [[5,-27],[1,-22],[6,-19],[10,-23]], '#72503b', '#523a2d', .55);
}

function drawBird(r, pose) {
  ellipse(r, 0, -25, 17, 11, '#6e7761', '#384139', -.12);
  path(r, [[-10,-26],[-1,-34],[11,-27],[5,-19],[-7,-18]], pose ? '#9b8059' : '#77826b', '#475044', .65);
  ellipse(r, 12, -33, 8, 7, '#8a795d', '#3f453d');
  path(r, [[18,-34],[27,-31],[18,-29]], '#d2a04e', '#67523b', .55);
  ellipse(r, 14, -34, 1, 1, '#171b18');
  path(r, [[-5,-15],[-3,-11],[-7,-9]], '#a99057', '#62533b', .55);
  path(r, [[5,-15],[7,-11],[4,-9]], '#a99057', '#62533b', .55);
  path(r, [[-13,-22],[-22,-16],[-12,-18]], '#d1be91', '#4c5145', .5);
}

function drawButterfly(r, pose) {
  const spread = pose ? 1 : .44;
  path(r, [[-2,-18],[-18,-31],[-31,-29],[-28,-19],[-16,-13],[-5,-14]], '#e7b85d', '#625442', .6);
  path(r, [[2,-18],[18,-31],[31,-29],[28,-19],[16,-13],[5,-14]], '#d47e59', '#625442', .6);
  path(r, [[-2,-18],[-13,-17],[-19,-7],[-11,-6],[-3,-12]], '#bd7a6e', '#625442', .6);
  path(r, [[2,-18],[13,-17],[19,-7],[11,-6],[3,-12]], '#e8c978', '#625442', .6);
  r.ctx.save();
  r.ctx.translate(0, -19);
  r.ctx.scale(1, spread);
  ellipse(r, 0, 0, 2.1, 13, '#574a38');
  path(r, [[-1,-10],[-6,-19],[-7,-20]], 'transparent', '#574a38', .8);
  path(r, [[1,-10],[6,-19],[7,-20]], 'transparent', '#574a38', .8);
  r.ctx.restore();
}

function drawFrog(r, pose) {
  ellipse(r, 0, -12, 23, 10, '#668f53', '#394b37', .03);
  ellipse(r, -11, -20, 7, 8, '#78a45c', '#394b37');
  ellipse(r, 12, -20, 7, 8, '#78a45c', '#394b37');
  ellipse(r, -11, -22, 2.5, 3, '#e7dca1');
  ellipse(r, 12, -22, 2.5, 3, '#e7dca1');
  ellipse(r, -11, -22, .85, 1.5, '#1e2a24');
  ellipse(r, 12, -22, .85, 1.5, '#1e2a24');
  path(r, [[-20,-13],[-30,-7],[-23,-5],[-14,-10]], '#6d9a56', '#3f5038', .7);
  path(r, [[19,-13],[29,-7],[22,-5],[13,-10]], '#6d9a56', '#3f5038', .7);
  if (pose) path(r, [[-6,-12],[0,-10],[7,-12]], 'transparent', '#334532', .9);
  else path(r, [[-7,-11],[0,-8],[8,-11]], 'transparent', '#334532', .9);
}

function drawDragonfly(r, pose) {
  ellipse(r, 0, -18, 2.2, 17, '#465e52', '#2f4039', .2);
  ellipse(r, 0, -35, 4.2, 4, '#667d67', '#34443a');
  ellipse(r, 1, -35, 1, 1, '#1f2924');
  const spread = pose ? 1 : .55;
  r.ctx.save(); r.ctx.scale(1, spread);
  ellipse(r, -12, -25, 13, 4, '#b7d3c891', '#70897b80', -.28);
  ellipse(r, 12, -25, 13, 4, '#b7d3c891', '#70897b80', .28);
  ellipse(r, -10, -18, 12, 3.2, '#c4ddd191', '#70897b80', .2);
  ellipse(r, 10, -18, 12, 3.2, '#c4ddd191', '#70897b80', -.2);
  r.ctx.restore();
  for (let i = 0; i < 4; i++) ellipse(r, -1 + i * .65, -7 - i * 5, 1, 1.5, i % 2 ? '#657e63' : '#465e52');
}

function drawFallbackPose(r, o, pose, x, y, width, height, alpha, shadow = false) {
  const c = r.ctx;
  c.save();
  c.globalAlpha *= clamp(alpha, 0, 1);
  c.translate(x, y);
  const facing = o.facing === -1 ? -1 : 1;
  c.scale((width / 100) * facing, height / 80);
  if (shadow) ellipse(r, 0, -1.5, 30, 3.5, '#20382b50');
  switch (o.kind) {
    case 'deer': drawDeer(r, pose, o); break;
    case 'fox': drawFox(r, pose); break;
    case 'rabbit': drawRabbit(r, pose); break;
    case 'squirrel': drawSquirrel(r, pose); break;
    case 'bird': drawBird(r, pose); break;
    case 'butterfly': drawButterfly(r, pose); break;
    case 'frog': drawFrog(r, pose); break;
    case 'dragonfly': drawDragonfly(r, pose); break;
    default: break;
  }
  c.restore();
}

function drawPose(r, art, o, pose, alpha, x, y, width, height) {
  if (alpha <= .001) return false;
  if (art && ['deer', 'fox', 'rabbit', 'squirrel'].includes(o.kind) && typeof art.drawAnimal === 'function') {
    try {
      if (art.drawAnimal(r, o.kind, pose, { x, y, width, height, alpha })) return true;
    } catch {
      // An unavailable or partially initialized atlas falls through to the
      // same native Canvas silhouette used when images cannot be decoded.
    }
  }
  drawFallbackPose(r, o, pose, x, y, width, height, alpha);
  return true;
}

/** Draw one wildlife sprite at a ground-relative world distance. */
export function drawMountainWildlife(renderer, object, distance, timeMs = 0, art = null) {
  if (!renderer?.ctx || !Number.isFinite(renderer.width) || !Number.isFinite(renderer.height) ||
      renderer.width <= 0 || renderer.height <= 0 || !object ||
      !['deer', 'fox', 'rabbit', 'squirrel', 'bird', 'butterfly', 'frog', 'dragonfly'].includes(object.kind) ||
      !Number.isFinite(object.lane) || !Number.isFinite(distance)) return false;

  const motion = sampleWildlifeMotion(object, timeMs, Boolean(renderer.reducedMotion));
  const bend = Number.isFinite(renderer.trailBend) ? renderer.trailBend : 0;
  const anchor = projectStreet(renderer.width, renderer.height,
    object.lane + motion.laneOffset, distance, (object.elevation ?? 0) + motion.elevationOffset, bend);
  const pixelsPerUnit = renderer.width * .235 * anchor.scale;
  const width = Math.max(1, object.width * pixelsPerUnit);
  const height = Math.max(1, object.height * pixelsPerUnit);
  const mix = clamp(motion.poseMix, 0, 1);

  // One low contact shadow anchors both the atlas and native fallback poses.
  const c = renderer.ctx;
  c.save(); c.globalAlpha *= .9;
  c.translate(anchor.x, anchor.y); c.scale(width / 100 * (object.facing === -1 ? -1 : 1), height / 80);
  ellipse(renderer, 0, -1.5, 30, 3.5, '#20382b50');
  c.restore();

  const primaryReady = drawPose(renderer, art, object, motion.poseFrom, 1 - mix,
    anchor.x, anchor.y, width, height);
  if (mix > .001) drawPose(renderer, art, object, motion.poseTo, mix,
    anchor.x, anchor.y, width, height);
  else if (!primaryReady && !mix) return false;
  return true;
}
