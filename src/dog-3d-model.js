const toRgb = hex => Object.freeze([
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]);

export const DOG_3D_MODEL_VERSION = 'pom-coat-webgl-1.2.0';
export const DOG_3D_RIG_VERSION = 'four-foot-contact-ik-1.2.0';
export const DOG_3D_STAND_ROOT_HEIGHT = .555;
export const DOG_3D_LIMITS = Object.freeze({ triangles: 15_000, bones: 24, textures: 0 });
export const DOG_3D_PALETTE = Object.freeze({
  coat: toRgb('#bd773f'),
  coatLight: toRgb('#d29056'),
  coatShadow: toRgb('#9e6138'),
  coatDeep: toRgb('#805039'),
  bib: toRgb('#fff7e7'),
  bibCream: toRgb('#f6ead7'),
  bibShade: toRgb('#e4d1b5'),
  ear: toRgb('#996347'),
  eye: toRgb('#332726'),
  eyeGlint: toRgb('#fffdf8'),
  nose: toRgb('#4f302d'),
  noseWarm: toRgb('#a36237'),
  noseLight: toRgb('#c9936c'),
  mouth: toRgb('#4f302d'),
  tongue: toRgb('#d46e7b'),
});

export const DOG_3D_ACTIONS = Object.freeze([
  'idle', 'walk', 'run', 'turn', 'sit', 'lie', 'sleep', 'wake', 'stretch', 'yawn',
  'headTilt', 'petHappy', 'bellyUp', 'happyJump', 'sleepyRefuse', 'lookPlayer', 'peek',
  'lookFood', 'sitWait', 'sniffFood', 'eat', 'lick', 'playBow', 'retrieve', 'carry',
  'return', 'tug', 'plushShake', 'plushCuddle', 'jumpCatch', 'enterHouse', 'insideHouse',
  'exitHouse', 'rest', 'feed', 'sniff', 'cuddle', 'fall', 'finish',
]);
export const DOG_3D_SUPPORTED_ACTIONS = DOG_3D_ACTIONS;

export const DOG_3D_JOINTS = Object.freeze([
  'root', 'body', 'head', 'jaw', 'earLeft', 'earRight', 'lidLeft', 'lidRight',
  'tailBase', 'tailMiddle', 'tailTip',
  'frontLeftUpper', 'frontLeftLower', 'frontLeftPaw',
  'frontRightUpper', 'frontRightLower', 'frontRightPaw',
  'rearLeftUpper', 'rearLeftLower', 'rearLeftPaw',
  'rearRightUpper', 'rearRightLower', 'rearRightPaw', 'tongue',
]);

export const DOG_3D_BIND_PIVOTS = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([0, 0, 0]),
  Object.freeze([0, .27, .42]),
  Object.freeze([0, .105, .725]),
  Object.freeze([-.235, .66, .405]),
  Object.freeze([.235, .66, .405]),
  Object.freeze([-.15, .355, .773]),
  Object.freeze([.15, .355, .773]),
  Object.freeze([0, .14, -.49]),
  Object.freeze([0, .375, -.685]),
  Object.freeze([0, .56, -.59]),
  Object.freeze([-.205, .075, .235]),
  Object.freeze([-.205, -.235, .27]),
  Object.freeze([-.205, -.46, .30]),
  Object.freeze([.205, .075, .27]),
  Object.freeze([.205, -.235, .27]),
  Object.freeze([.205, -.46, .30]),
  Object.freeze([-.205, .055, -.40]),
  Object.freeze([-.205, -.255, -.40]),
  Object.freeze([-.205, -.46, -.37]),
  Object.freeze([.205, .055, -.40]),
  Object.freeze([.205, -.255, -.40]),
  Object.freeze([.205, -.46, -.37]),
  Object.freeze([0, .105, .725]),
]);
export const DOG_3D_LANDMARK_BINDINGS = Object.freeze({
  crown: Object.freeze({ joint: 2, point: Object.freeze([0, .41, .03]) }),
  nose: Object.freeze({ joint: 2, point: Object.freeze([0, -.124, .398]) }),
  mouth: Object.freeze({ joint: 3, point: Object.freeze([0, -.021, .01]) }),
  leftEye: Object.freeze({ joint: 2, point: Object.freeze([-.16, .095, .365]) }),
  rightEye: Object.freeze({ joint: 2, point: Object.freeze([.16, .095, .365]) }),
  tailTip: Object.freeze({ joint: 10, point: Object.freeze([0, -.03, .06]) }),
});

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => {
  const length = Math.hypot(...a) || 1;
  return a.map(value => value / length);
};

function makeBuilder() {
  const positions = [], normals = [], colors = [], joints = [], indices = [];

  function pushVertex(position, normal, color, joint) {
    positions.push(...position);
    normals.push(...normalize(normal));
    colors.push(...color);
    joints.push(joint);
    return joints.length - 1;
  }

  function addEllipsoid(center, radii, color, joint, { pivot = DOG_3D_BIND_PIVOTS[joint], segments = 16, rings = 10, rotationX = 0 } = {}) {
    const base = joints.length;
    const c = sub(center, pivot);
    const cx = Math.cos(rotationX), sx = Math.sin(rotationX);
    for (let row = 0; row <= rings; row += 1) {
      const phi = Math.PI * row / rings;
      const sy = Math.cos(phi), ringRadius = Math.sin(phi);
      for (let col = 0; col <= segments; col += 1) {
        const theta = TAU * col / segments;
        const unit = [ringRadius * Math.cos(theta), sy, ringRadius * Math.sin(theta)];
        const point = [unit[0] * radii[0], unit[1] * radii[1], unit[2] * radii[2]];
        const rotated = [point[0], point[1] * cx - point[2] * sx, point[1] * sx + point[2] * cx];
        const normal = normalize([unit[0] / radii[0], unit[1] / radii[1], unit[2] / radii[2]]);
        const rotatedNormal = [normal[0], normal[1] * cx - normal[2] * sx, normal[1] * sx + normal[2] * cx];
        pushVertex(add(c, rotated), rotatedNormal, color, joint);
      }
    }
    const stride = segments + 1;
    for (let row = 0; row < rings; row += 1) for (let col = 0; col < segments; col += 1) {
      const a = base + row * stride + col, b = a + 1, cIndex = a + stride, d = cIndex + 1;
      indices.push(a, cIndex, b, b, cIndex, d);
    }
  }

  function addTube(start, end, radius, color, joint = 1, { pivot = DOG_3D_BIND_PIVOTS[joint], sides = 8, lengthRings = 5, tipScale = .12, baseScale = .7 } = {}) {
    const axis = normalize(sub(end, start));
    const reference = Math.abs(axis[1]) < .88 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(axis, reference));
    const v = normalize(cross(axis, u));
    const delta = sub(end, start), base = joints.length;
    for (let row = 0; row <= lengthRings; row += 1) {
      const t = row / lengthRings;
      const swell = Math.sin(Math.PI * Math.min(1, .08 + t * .92)) ** .45;
      const taper = (baseScale + (tipScale - baseScale) * t) * swell;
      const center = add(start, mul(delta, t));
      for (let side = 0; side < sides; side += 1) {
        const angle = TAU * side / sides;
        const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
        pushVertex(sub(add(center, mul(radial, radius * taper)), pivot), radial, color, joint);
      }
    }
    for (let row = 0; row < lengthRings; row += 1) for (let side = 0; side < sides; side += 1) {
      const a = base + row * sides + side, b = base + row * sides + (side + 1) % sides;
      const c = a + sides, d = b + sides;
      indices.push(a, b, c, b, d, c);
    }
  }

  function addTuft(start, tip, radius, color, joint = 1, pivot = DOG_3D_BIND_PIVOTS[joint]) {
    const axis = normalize(sub(tip, start));
    const reference = Math.abs(axis[1]) < .86 ? [0, 1, 0] : [0, 0, 1];
    const u = normalize(cross(axis, reference)), v = normalize(cross(axis, u));
    const rings = [[0, .68], [.40, 1], [.82, .35]];
    const sides = 5, base = joints.length;
    for (const [t, width] of rings) {
      const center = add(start, mul(sub(tip, start), t));
      for (let side = 0; side < sides; side += 1) {
        const angle = TAU * side / sides;
        const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
        pushVertex(sub(add(center, mul(radial, radius * width)), pivot), radial, color, joint);
      }
    }
    const tipIndex = pushVertex(sub(tip, pivot), axis, color, joint);
    for (let row = 0; row < rings.length - 1; row += 1) for (let side = 0; side < sides; side += 1) {
      const a = base + row * sides + side, b = base + row * sides + (side + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
    const last = base + (rings.length - 1) * sides;
    for (let side = 0; side < sides; side += 1) indices.push(last + side, last + (side + 1) % sides, tipIndex);
  }

  function addBoneCapsule(joint, length, radius, color) {
    const rings = 8, sides = 8, base = joints.length;
    for (let row = 0; row <= rings; row += 1) {
      const t = row / rings;
      const y = -length * t;
      const cap = Math.sin(Math.PI * t) * .11;
      const r = radius * (.78 + cap);
      for (let side = 0; side <= sides; side += 1) {
        const angle = TAU * side / sides;
        const n = [Math.cos(angle), .08 * Math.cos(Math.PI * t), Math.sin(angle)];
        pushVertex([r * n[0], y, r * n[2]], n, color, joint);
      }
    }
    const stride = sides + 1;
    for (let row = 0; row < rings; row += 1) for (let side = 0; side < sides; side += 1) {
      const a = base + row * stride + side, b = a + 1, c = a + stride, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  return { positions, normals, colors, joints, indices, addEllipsoid, addTube, addTuft, addBoneCapsule };
}

function addLegSet(mesh, side, isFront, upperJoint, lowerJoint, pawJoint, colors) {
  const y = isFront ? .075 : .055;
  const z = isFront ? .27 : -.40;
  const pawZ = isFront ? .30 : -.37;
  const upperLength = .31, lowerLength = .30;
  mesh.addBoneCapsule(upperJoint, upperLength, isFront ? .105 : .115, colors.coatLight);
  mesh.addBoneCapsule(lowerJoint, lowerLength, .09, colors.coat);
  const pawPivot = DOG_3D_BIND_PIVOTS[pawJoint];
  mesh.addEllipsoid([side * .205, pawPivot[1] - .015, pawZ], [.108, .075, .14], colors.bibCream, pawJoint,
    { pivot: pawPivot, segments: 14, rings: 9 });
  // A soft coat cuff hides the short leg joints beneath the broad chest ruff.
  mesh.addEllipsoid([side * .205, y - upperLength - .045, z], [.098, .09, .085], colors.coatLight, lowerJoint,
    { pivot: DOG_3D_BIND_PIVOTS[lowerJoint], segments: 10, rings: 7 });
  return { side, shoulder: [side * .205, y, z], upperLength, lowerLength };
}

function addBodyFur(mesh, colors) {
  const bodyCenter = [0, -.015, -.075], rx = .39, ry = .37;
  for (let index = 0; index < 8; index += 1) {
    const x = (index - 3.5) * .066;
    const z = .30 + .035 * Math.cos(index * .8);
    mesh.addTuft([x, -.19, z + .11], [x * 1.08, -.26, z - .015], .031,
      index % 3 === 0 ? colors.bibShade : colors.bib, 1);
  }
  // Fine clumps follow the ellipsoid surface so the coat reads as a layered
  // silhouette instead of a few isolated spikes.
  const coatPalette = [colors.coat, colors.coatLight, colors.coatShadow];
  const latitudes = [.48, .82, 1.16, 1.55, 1.96, 2.34];
  for (let row = 0; row < latitudes.length; row += 1) {
    const phi = latitudes[row];
    for (let column = 0; column < 12; column += 1) {
      const theta = TAU * (column + (row % 2) * .5) / 12;
      const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
      const surface = [rx * sinPhi * Math.cos(theta), bodyCenter[1] + ry * cosPhi,
        bodyCenter[2] + .575 * sinPhi * Math.sin(theta)];
      const normal = normalize([sinPhi * Math.cos(theta) / rx, cosPhi / ry,
        sinPhi * Math.sin(theta) / .575]);
      const start = add(surface, mul(normal, -.012));
      const length = .026 + ((row + column) % 3) * .004;
      const tip = add(start, add(mul(normal, length), [normal[0] * .005, -.002, normal[2] * .005]));
      mesh.addTuft(start, tip, .019 + ((row + column) % 2) * .003, coatPalette[(row + column) % coatPalette.length], 1);
    }
  }

  // White feathering widens the chest bib into a visible Pom ruff.
  for (let index = 0; index < 10; index += 1) {
    const x = (index - 4.5) * .048;
    const y = .075 - (index % 2) * .055;
    const z = .57 - Math.abs(x) * .43;
    mesh.addTuft([x, y, z - .008], [x * 1.04, y - .046, z + .028], .024,
      index % 4 === 0 ? colors.bibShade : colors.bib, 1);
  }
}

function addHeadFur(mesh, colors) {
  const center = [0, .34, .45], rx = .38, ry = .33;
  for (const sideZ of [-1, 1]) for (let index = 0; index < 12; index += 1) {
    const angle = TAU * index / 12;
    const x = rx * Math.cos(angle), y = center[1] + ry * Math.sin(angle);
    const start = [x, y, center[2] + sideZ * .08];
    const tip = add(start, [Math.cos(angle) * .042, Math.sin(angle) * .032, sideZ * .028]);
    mesh.addTuft(start, tip, .03, index % 4 === 0 ? colors.coatShadow : colors.coatLight, 2);
  }
  for (const side of [-1, 1]) for (let index = 0; index < 4; index += 1) {
    const y = .27 - index * .085, z = .58 - index * .055;
    mesh.addTuft([side * .31, y, z], [side * (.36 + (index % 2) * .015), y - .02, z - .025], .042,
      index % 2 ? colors.coatLight : colors.coat, 2);
  }

  // A close, even fringe softens the skull and cheeks while clearing the eyes
  // and muzzle so their expression stays readable.
  for (let index = 0; index < 24; index += 1) {
    const angle = TAU * index / 24;
    const ring = .91;
    const x = rx * ring * Math.cos(angle);
    const y = center[1] + ry * ring * Math.sin(angle);
    const frontZ = center[2] + .345 * Math.sqrt(1 - ring * ring);
    const surface = [x, y, frontZ];
    const normal = normalize([x / (rx * rx), (y - center[1]) / (ry * ry),
      (frontZ - center[2]) / (.345 * .345)]);
    const start = add(surface, mul(normal, -.012));
    const tip = add(start, mul(normal, .034 + (index % 3) * .005));
    mesh.addTuft(start, tip, .018 + (index % 2) * .003,
      index % 4 === 0 ? colors.coat : colors.coatLight, 2);
  }
}

export function buildDog3DModel() {
  const mesh = makeBuilder(), c = DOG_3D_PALETTE;
  const ellipsoid = (...args) => mesh.addEllipsoid(...args);

  // Compact orange sable body with a broad double-coat silhouette and a visible chest bib.
  ellipsoid([0, -.025, -.075], [.385, .365, .575], c.coat, 0, { segments: 18, rings: 12 });
  ellipsoid([0, -.10, .325], [.252, .305, .382], c.bib, 1, { segments: 16, rings: 10 });
  ellipsoid([0, .015, .19], [.305, .275, .37], c.coatLight, 1, { segments: 16, rings: 10 });
  ellipsoid([0, .255, -.435], [.31, .325, .265], c.coatShadow, 1, { segments: 14, rings: 9 });
  addBodyFur(mesh, c);

  // A proportionate foxlike head, small pointed ears, cream cheeks, blaze, and warm dark nose.
  ellipsoid([0, .34, .45], [.39, .33, .345], c.coatLight, 2, { segments: 20, rings: 14 });
  ellipsoid([-.215, .25, .475], [.17, .235, .205], c.coat, 2, { segments: 16, rings: 10, rotationX: .08 });
  ellipsoid([.215, .25, .475], [.17, .235, .205], c.coat, 2, { segments: 16, rings: 10, rotationX: .08 });
  ellipsoid([0, .39, .793], [.056, .235, .026], c.bib, 2, { segments: 12, rings: 10 });
  ellipsoid([-.083, .16, .737], [.135, .115, .15], c.bibCream, 2, { segments: 16, rings: 10 });
  ellipsoid([.083, .16, .737], [.135, .115, .15], c.bibCream, 2, { segments: 16, rings: 10 });
  ellipsoid([0, .073, .708], [.155, .09, .165], c.coatDeep, 3, { segments: 14, rings: 9 });
  ellipsoid([0, .084, .735], [.105, .079, .132], c.mouth, 3, { segments: 14, rings: 9 });
  ellipsoid([0, .146, .818], [.086, .063, .071], c.nose, 2, { segments: 14, rings: 10 });
  ellipsoid([-.025, .17, .88], [.023, .012, .011], c.noseLight, 2, { segments: 8, rings: 6 });
  for (const side of [-1, 1]) {
    ellipsoid([side * .16, .365, .785], [.077, .066, .052], c.eye, 2, { segments: 12, rings: 8 });
    ellipsoid([side * .142, .389, .831], [.019, .016, .012], c.eyeGlint, 2, { segments: 8, rings: 6 });
    ellipsoid([side * .15, .442, .789], [.09, .024, .032], c.coat, side < 0 ? 6 : 7, { segments: 12, rings: 7 });
  }
  addHeadFur(mesh, c);

  for (const side of [-1, 1]) {
    const joint = side < 0 ? 4 : 5;
    const x = side * .235;
    ellipsoid([x, .615, .405], [.12, .145, .108], c.coat, joint, { segments: 14, rings: 9, rotationX: .08 });
    ellipsoid([x, .635, .482], [.062, .084, .024], c.ear, joint, { segments: 10, rings: 7, rotationX: .08 });
    mesh.addTuft([x, .715, .415], [x + side * .014, .80, .435], .055, c.coatLight, joint);
    // The eyelid is a fur-colored soft arc; the rig lowers it across the eye on a blink.
  }

  // A curled plume sits over the rump and keeps the rear view readable as a Pomeranian.
  ellipsoid([0, .205, -.555], [.17, .18, .205], c.coatLight, 8, { segments: 14, rings: 9 });
  ellipsoid([0, .345, -.71], [.16, .19, .19], c.coat, 9, { segments: 14, rings: 9 });
  ellipsoid([0, .49, -.68], [.155, .17, .19], c.bibCream, 10, { segments: 14, rings: 9 });
  ellipsoid([0, .53, -.53], [.145, .14, .16], c.bib, 10, { segments: 14, rings: 9 });
  for (let index = 0; index < 8; index += 1) {
    const angle = TAU * index / 8;
    const start = [.12 * Math.cos(angle), .52 + .10 * Math.sin(angle), -.55];
    mesh.addTuft(start, [start[0] + .045 * Math.cos(angle), start[1] + .065 * Math.sin(angle), start[2] - .035], .047,
      index % 3 === 0 ? c.bibShade : c.bib, 10);
  }

  const legDefinitions = [
    addLegSet(mesh, -1, true, 11, 12, 13, c),
    addLegSet(mesh, 1, true, 14, 15, 16, c),
    addLegSet(mesh, -1, false, 17, 18, 19, c),
    addLegSet(mesh, 1, false, 20, 21, 22, c),
  ];

  // Model-space bounds are computed from this exact skinned mesh at its neutral bind pose.
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const joint = mesh.joints[index / 3], pivot = DOG_3D_BIND_PIVOTS[joint];
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[index + axis] + pivot[axis];
      bounds.min[axis] = Math.min(bounds.min[axis], value);
      bounds.max[axis] = Math.max(bounds.max[axis], value);
    }
  }
  const vertexCount = mesh.positions.length / 3;
  const triangleCount = mesh.indices.length / 3;
  if (triangleCount > DOG_3D_LIMITS.triangles) throw new Error(`Dog 3D mesh exceeds ${DOG_3D_LIMITS.triangles} triangles.`);
  if (vertexCount > 65_535) throw new Error('Dog 3D mesh exceeds the WebGL1 16-bit index range.');

  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const colors = new Uint8Array(mesh.colors);
  const joints = new Uint8Array(mesh.joints);
  const indices = new Uint16Array(mesh.indices);
  const frozenBounds = Object.freeze({ min: Object.freeze(bounds.min), max: Object.freeze(bounds.max) });
  return Object.freeze({
    modelVersion: DOG_3D_MODEL_VERSION,
    rigVersion: DOG_3D_RIG_VERSION,
    positions, normals, colors, joints, indices,
    jointNames: DOG_3D_JOINTS,
    bindPivots: DOG_3D_BIND_PIVOTS,
    landmarks: DOG_3D_LANDMARK_BINDINGS,
    legDefinitions: Object.freeze(legDefinitions.map(leg => Object.freeze({
      ...leg, shoulder: Object.freeze(leg.shoulder),
    }))),
    bounds: frozenBounds,
    standingHeight: DOG_3D_STAND_ROOT_HEIGHT + bounds.max[1],
    groundPlaneY: DOG_3D_STAND_ROOT_HEIGHT + bounds.min[1],
    triangleCount,
    vertexCount,
    materialCount: 1,
    paletteColorCount: Object.keys(DOG_3D_PALETTE).length,
    textureCount: 0,
    supportedActions: DOG_3D_ACTIONS,
  });
}
