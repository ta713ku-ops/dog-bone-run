const MATERIALS = Object.freeze({ tan: 0, cream: 1 });
const PIGMENTS = Object.freeze([
  '#bd773f', '#d29056', '#9e6138', '#805039', '#f6ead7', '#fff7e7', '#e4d1b5',
  '#87503f', '#332726', '#fffdf8', '#a36237', '#c9936c', '#4f302d', '#d46e7b',
]);
const TONE = Object.freeze({
  tan: 0, tanLight: 1, tanDark: 2, warmShadow: 3, cream: 4, white: 5,
  creamShadow: 6, ear: 7, eye: 8, glint: 9, nose: 10, noseLight: 11,
  mouth: 12, tongue: 13,
});

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(a[0], a[1], a[2]) || 1;
const normalize = a => mul(a, 1 / length(a));

function rotatePoint(point, pivot, axis, angle) {
  if (!angle) return point;
  const v = sub(point, pivot), c = Math.cos(angle), s = Math.sin(angle);
  if (axis === 'x') return add(pivot, [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]);
  if (axis === 'y') return add(pivot, [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]);
  return add(pivot, [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]);
}

function litColor(tone, factor) {
  const hex = PIGMENTS[tone] ?? PIGMENTS[0];
  const values = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const adjusted = values.map(value => Math.max(0, Math.min(255, Math.round(value * factor))));
  return `rgb(${adjusted[0]}, ${adjusted[1]}, ${adjusted[2]})`;
}

function makeBuilder() {
  const positions = [], vertexGroups = [], indices = [], faceMaterials = [], faceTones = [], faceGroups = [];
  const groupIds = new Map(), groupNames = [], pivots = [];
  function groupId(name, pivot) {
    if (!groupIds.has(name)) { groupIds.set(name, groupNames.length); groupNames.push(name); pivots.push(pivot); }
    return groupIds.get(name);
  }
  function vertex(point, group = 'body', pivot = [0, 0, 0]) {
    const index = positions.length / 3;
    positions.push(...point); vertexGroups.push(groupId(group, pivot)); return index;
  }
  function triangle(a, b, c, material, tone, group, expectedNormal = null) {
    const point = index => positions.slice(index * 3, index * 3 + 3);
    const pa = point(a), pb = point(b), pc = point(c);
    let n = cross(sub(pb, pa), sub(pc, pa));
    if (expectedNormal && dot(n, expectedNormal) < 0) { [b, c] = [c, b]; n = mul(n, -1); }
    indices.push(a, b, c); faceMaterials.push(MATERIALS[material] ?? MATERIALS.tan);
    faceTones.push(TONE[tone] ?? TONE.tan); faceGroups.push(groupId(group, [0, 0, 0]));
  }
  function ellipsoid(center, radii, material, tone, group = 'body', latitudes = 12, longitudes = 20, rotation = [0, 0, 0]) {
    const pivot = center, base = positions.length / 3, stride = longitudes + 1;
    for (let i = 0; i <= latitudes; i++) {
      const phi = Math.PI * i / latitudes, ring = Math.sin(phi), z = Math.cos(phi);
      for (let j = 0; j <= longitudes; j++) {
        const theta = Math.PI * 2 * j / longitudes;
        let p = [center[0] + radii[0] * ring * Math.cos(theta), center[1] + radii[1] * ring * Math.sin(theta), center[2] + radii[2] * z];
        p = rotatePoint(p, center, 'z', rotation[2]); p = rotatePoint(p, center, 'y', rotation[1]); p = rotatePoint(p, center, 'x', rotation[0]);
        vertex(p, group, pivot);
      }
    }
    for (let i = 0; i < latitudes; i++) for (let j = 0; j < longitudes; j++) {
      const a = base + i * stride + j, b = a + 1, c = a + stride, d = c + 1;
      for (const [u, v, w] of [[a, c, b], [b, c, d]]) {
        const centerOfFace = mul(add(add(positions.slice(u * 3, u * 3 + 3), positions.slice(v * 3, v * 3 + 3)), positions.slice(w * 3, w * 3 + 3)), 1 / 3);
        const outward = normalize([(centerOfFace[0] - center[0]) / (radii[0] ** 2), (centerOfFace[1] - center[1]) / (radii[1] ** 2), (centerOfFace[2] - center[2]) / (radii[2] ** 2)]);
        triangle(u, v, w, material, tone, group, outward);
      }
    }
  }
  function tuft(start, tip, radius, material, tone, group) {
    const axis = normalize(sub(tip, start)), reference = Math.abs(axis[2]) < .86 ? [0, 0, 1] : [0, 1, 0];
    const u = normalize(cross(axis, reference)), v = normalize(cross(axis, u));
    const rings = [[0, radius * .48], [.24, radius], [.63, radius * .64], [1, radius * .035]], sides = 7;
    const base = positions.length / 3;
    for (const [along, r] of rings) {
      const center = add(start, mul(sub(tip, start), along));
      for (let j = 0; j < sides; j++) {
        const a = j * Math.PI * 2 / sides;
        vertex(add(center, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r))), group, start);
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) for (let j = 0; j < sides; j++) {
      const a = base + ring * sides + j, b = base + ring * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      const angle = (j + .5) * Math.PI * 2 / sides, outward = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
      triangle(a, b, c, material, tone, group, outward); triangle(b, d, c, material, tone, group, outward);
    }
    const tipIndex = vertex(tip, group, start);
    const last = base + (rings.length - 1) * sides;
    for (let j = 0; j < sides; j++) triangle(last + j, last + (j + 1) % sides, tipIndex, material, tone, group, axis);
  }
  function ear(side) {
    const centerX = side * .3, baseZ = 1.61, y = .18, group = 'head';
    const levels = [[0, .155, .105], [.19, .13, .082], [.38, .078, .05], [.49, .012, .018]];
    const base = positions.length / 3, sides = 12;
    for (const [height, rx, ry] of levels) for (let j = 0; j < sides; j++) {
      const a = j * 2 * Math.PI / sides;
      vertex([centerX + rx * Math.cos(a), y + ry * Math.sin(a), baseZ + height], group, [0, .16, 1.48]);
    }
    for (let ring = 0; ring < levels.length - 1; ring++) for (let j = 0; j < sides; j++) {
      const a = base + ring * sides + j, b = base + ring * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      const normal = [Math.cos((j + .5) * 2 * Math.PI / sides), Math.sin((j + .5) * 2 * Math.PI / sides), .18];
      triangle(a, b, c, 'tan', 'tan', group, normal); triangle(b, d, c, 'tan', 'tanLight', group, normal);
    }
    const tip = vertex([centerX, y - .005, baseZ + .505], group, [0, .16, 1.48]);
    const topRing = base + (levels.length - 1) * sides;
    for (let j = 0; j < sides; j++) triangle(topRing + j, topRing + (j + 1) % sides, tip, 'tan', 'tanLight', group, [0, 0, 1]);
    // An inset warm patch gives each upright ear a readable inner plane in the front and side views.
    ellipsoid([centerX, .281, 1.84], [.066, .018, .145], 'tan', 'ear', group, 8, 12);
  }
  function blaze() {
    const group = 'head', base = positions.length / 3;
    const rows = [[1.80, .004], [1.73, .032], [1.63, .039], [1.53, .046], [1.43, .054], [1.34, .076]];
    const cx = 0, cy = .20, sx = .54, sy = .45, sz = .47;
    for (const [z, halfWidth] of rows) for (const side of [-1, 1]) {
      const x = side * halfWidth, normalized = (x / sx) ** 2 + ((z - 1.42) / sz) ** 2;
      const y = cy + sy * Math.sqrt(Math.max(.06, 1 - normalized)) + .009;
      vertex([x, y, z], group, [0, .16, 1.48]);
    }
    for (let row = 0; row < rows.length - 1; row++) {
      const a = base + row * 2, b = a + 1, c = a + 2, d = c + 1;
      triangle(a, b, c, 'cream', 'white', group, [0, 1, .06]);
      triangle(b, d, c, 'cream', 'cream', group, [0, 1, .06]);
    }
  }
  return { positions, vertexGroups, indices, faceMaterials, faceTones, faceGroups, groupNames, pivots, ellipsoid, tuft, ear, blaze };
}

export function buildDogModel() {
  const mesh = makeBuilder();
  const { ellipsoid: ball, tuft: fur, ear: makeEar, blaze } = mesh;
  // y points toward the muzzle; z=0 is the paw plane and the head is intentionally oversized.
  ball([0, -.12, .70], [.405, .62, .49], 'tan', 'tan', 'body', 18, 26);
  ball([0, .43, .62], [.305, .18, .395], 'cream', 'cream', 'chest', 18, 26);
  for (const side of [-1, 1]) {
    const leg = side < 0 ? 'L' : 'R';
    ball([side * .265, -.38, .48], [.135, .20, .31], 'tan', 'tanLight', `hind-${leg}`, 12, 18, [side * .05, 0, 0]);
    ball([side * .255, .275, .36], [.105, .115, .29], 'tan', 'tanLight', `front-${leg}`, 12, 18);
    ball([side * .265, -.28, .11], [.125, .16, .11], 'cream', 'white', `hind-${leg}`, 10, 16);
    ball([side * .255, .39, .11], [.12, .155, .11], 'cream', 'white', `front-${leg}`, 10, 16);
  }
  // The white curled plume at the back is a design supplement: the references show it only partially.
  // A solid root blends into the rump; overlapping ovals curl asymmetrically along the lower back.
  ball([0, -.61, .64], [.17, .18, .18], 'cream', 'cream', 'tail-root', 10, 14);
  const plume = [
    [[-.10, -.67, .67], [.16, .15, .16], 'white'],
    [[-.22, -.70, .73], [.16, .14, .15], 'cream'],
    [[-.32, -.71, .80], [.14, .13, .14], 'white'],
    [[-.35, -.70, .86], [.11, .13, .10], 'cream'],
    [[-.27, -.69, .91], [.12, .13, .075], 'white'],
    [[-.15, -.67, .90], [.13, .14, .075], 'cream'],
    [[-.06, -.63, .84], [.13, .14, .10], 'white'],
  ];
  for (const [center, radii, tone] of plume) ball(center, radii, 'cream', tone, 'tail', 8, 12);
  const tailFringe = [
    [-.12, .55, -.02, -.035], [-.25, .63, -.04, -.025], [-.37, .73, -.035, -.01],
    [-.42, .83, -.015, .035], [-.34, .93, .02, .025], [-.22, .96, .035, .01],
    [-.09, .91, .035, -.025], [.025, .84, .035, -.035],
  ];
  for (let i = 0; i < tailFringe.length; i++) {
    const [x, z, dx, dz] = tailFringe[i];
    fur([x, -.71, z], [x + dx, -.75, z + dz], .043, 'cream', i % 2 ? 'white' : 'cream', 'tail');
  }
  ball([0, .17, 1.43], [.535, .445, .455], 'tan', 'tan', 'head', 20, 28);
  // Cheek ruff shapes soften the head/body join and retain the long-haired outline.
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const z = 1.13 + i * .105, x = side * (.405 + (i % 2) * .035);
    fur([x, .18, z], [side * (.48 + (i % 2) * .045), .20, z - .045], .075,
      'tan', i % 2 ? 'tanLight' : 'tan', 'head');
  }
  makeEar(-1); makeEar(1); blaze();
  // Two cream muzzle cushions, paired round eyes, a warm brown nose, and the visible tongue.
  ball([-.125, .602, 1.215], [.155, .155, .132], 'cream', 'white', 'head', 12, 18);
  ball([.125, .602, 1.215], [.155, .155, .132], 'cream', 'white', 'head', 12, 18);
  for (const side of [-1, 1]) {
    ball([side * .205, .535, 1.485], [.072, .052, .088], 'tan', 'warmShadow', 'head', 10, 14);
    ball([side * .205, .579, 1.493], [.070, .035, .074], 'tan', 'eye', 'head', 12, 18);
    ball([side * .219, .608, 1.522], [.014, .009, .017], 'cream', 'glint', 'head', 6, 10);
  }
  ball([0, .765, 1.255], [.125, .085, .088], 'tan', 'nose', 'head', 10, 16);
  for (const side of [-1, 1]) ball([side * .047, .835, 1.265], [.018, .012, .014], 'tan', 'mouth', 'head', 6, 10);
  ball([0, .692, 1.102], [.094, .095, .083], 'tan', 'mouth', 'head', 9, 12);
  ball([0, .742, 1.055], [.073, .105, .10], 'cream', 'tongue', 'head', 10, 14);
  // Loose chest tufts and shoulder fringe form the soft white bib from the photos.
  for (let i = 0; i < 13; i++) {
    const x = (i - 6) * .043, z = .30 + .055 * Math.sin(i * .8);
    fur([x, .615, z + .11], [x * 1.16, .69, z - .06], .045,
      'cream', i % 3 ? 'white' : 'creamShadow', 'chest');
  }
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    fur([side * .32, .19 - i * .13, .78 + i * .07], [side * .44, .14 - i * .13, .72 + i * .07], .055,
      'tan', 'tanLight', 'body');
  }

  const vertexCount = mesh.positions.length / 3, triangleCount = mesh.indices.length / 3;
  const positions = new Float32Array(mesh.positions), indices = new Uint16Array(mesh.indices);
  const vertexGroups = new Uint8Array(mesh.vertexGroups), faceMaterials = new Uint8Array(mesh.faceMaterials);
  const faceTones = new Uint8Array(mesh.faceTones), faceGroups = new Uint8Array(mesh.faceGroups);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]); bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
  }
  return Object.freeze({
    positions, indices, vertexGroups, faceMaterials, faceTones, faceGroups,
    groupNames: Object.freeze(mesh.groupNames), pivots: Object.freeze(mesh.pivots.map(point => Object.freeze([...point]))),
    bounds: Object.freeze({ min: Object.freeze(bounds.min), max: Object.freeze(bounds.max) }),
    height: bounds.max[2] - bounds.min[2], vertexCount, triangleCount, materialCount: 2, textureCount: 0,
  });
}

const VIEW = Object.freeze({
  front: { toward: [0, 1, .20], right: [1, 0, 0] },
  side: { toward: [1, 0, .18], right: [0, 1, 0] },
  back: { toward: [0, -1, .20], right: [-1, 0, 0] },
});
const LIGHT = normalize([-.38, .44, .82]);

function posePoint(point, group, mesh, action, phase, timeMs, direction, reducedMotion) {
  if (reducedMotion) return point;
  const name = mesh.groupNames[group], pivot = mesh.pivots[group];
  let result = point;
  if (action === 'run' && /^(front|hind)-/.test(name)) {
    const side = name.endsWith('-1') ? 1 : 0;
    const hind = name.startsWith('hind');
    result = rotatePoint(result, pivot, 'x', Math.sin(phase + (side + (hind ? 1 : 0)) * Math.PI) * .34);
  } else if (action === 'idle' && name === 'head') {
    result = rotatePoint(result, pivot, 'x', Math.sin(phase) * .024);
  } else if (['collect', 'gold', 'finish'].includes(action) && name === 'head') {
    result = rotatePoint(result, pivot, 'x', action === 'finish' ? -.11 + Math.sin(phase) * .022 : -.055);
  } else if (['collect', 'gold'].includes(action) && /^front-/.test(name)) {
    result = rotatePoint(result, pivot, 'x', .32);
  } else if (['idle', 'finish'].includes(action) && name === 'tail') {
    result = rotatePoint(result, pivot, 'z', Math.sin(phase) * (action === 'finish' ? .16 : .12));
  } else if (['hit', 'fall'].includes(action) && name !== 'tail') {
    const amount = action === 'fall' ? .06 + .62 * Math.min(1, Math.max(0, timeMs) / 650) : .32;
    result = rotatePoint(result, [0, 0, .82], 'y', amount * (direction || 1));
  }
  if (action === 'lean' && name !== 'tail') result = rotatePoint(result, [0, 0, .72], 'y', .11 * (direction || 1));
  return result;
}

export function renderDogMesh(ctx, mesh, options = {}) {
  const {
    view = 'front', x = ctx.canvas.width / 2, foot = ctx.canvas.height - 4,
    size = Math.min(ctx.canvas.width, ctx.canvas.height) * .88, action = 'idle',
    timeMs = 0, reducedMotion = false, direction = 1, clear = false,
  } = options;
  const camera = VIEW[view] ?? VIEW.front, toward = normalize(camera.toward), right = normalize(camera.right);
  const vertical = [0, 0, 1], up = normalize(sub(vertical, mul(toward, dot(vertical, toward))));
  const phase = timeMs / 1000 * 8;
  if (clear) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const count = mesh.vertexCount, posedPositions = new Float32Array(count * 3);
  const projectedX = new Float32Array(count), projectedY = new Float32Array(count), depth = new Float32Array(count);
  let minUp = Infinity, maxUp = -Infinity, maxX = -Infinity, minX = Infinity;
  for (let i = 0; i < count; i++) {
    const offset = i * 3, original = [mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]];
    const posed = posePoint(original, mesh.vertexGroups[i], mesh, action, phase, timeMs, direction, reducedMotion);
    posedPositions.set(posed, offset);
    const cameraX = dot(posed, right), cameraUp = dot(posed, up);
    projectedX[i] = cameraX; projectedY[i] = cameraUp; depth[i] = dot(posed, toward);
    minUp = Math.min(minUp, cameraUp); maxUp = Math.max(maxUp, cameraUp);
    minX = Math.min(minX, cameraX); maxX = Math.max(maxX, cameraX);
  }
  const scale = size / Math.max(.001, maxUp - minUp), centerX = (minX + maxX) * .5, light = LIGHT, faces = [];
  for (let i = 0; i < mesh.triangleCount; i++) {
    const k = i * 3, a = mesh.indices[k], b = mesh.indices[k + 1], c = mesh.indices[k + 2];
    const a3 = a * 3, b3 = b * 3, c3 = c * 3;
    const pa = [posedPositions[a3], posedPositions[a3 + 1], posedPositions[a3 + 2]];
    const pb = [posedPositions[b3], posedPositions[b3 + 1], posedPositions[b3 + 2]];
    const pc = [posedPositions[c3], posedPositions[c3 + 1], posedPositions[c3 + 2]];
    const n = normalize(cross(sub(pb, pa), sub(pc, pa)));
    if (dot(n, toward) <= .005) continue;
    faces.push({ a, b, c, depth: (depth[a] + depth[b] + depth[c]) / 3, normal: n, material: mesh.faceMaterials[i], tone: mesh.faceTones[i], group: mesh.faceGroups[i] });
  }
  faces.sort((a, b) => a.depth - b.depth);
  const lightFactor = (normal, group) => mesh.groupNames[group] === 'tail'
    ? .78 + .30 * Math.max(0, dot(normal, light))
    : .52 + .66 * Math.max(0, dot(normal, light));
  ctx.save(); ctx.lineJoin = 'round';
  for (const face of faces) {
    const shade = lightFactor(face.normal, face.group), pigment = face.tone;
    const tint = litColor(pigment, shade + (face.material === MATERIALS.cream ? .035 : 0));
    ctx.beginPath();
    ctx.moveTo(x + (projectedX[face.a] - centerX) * scale, foot - (projectedY[face.a] - minUp) * scale);
    ctx.lineTo(x + (projectedX[face.b] - centerX) * scale, foot - (projectedY[face.b] - minUp) * scale);
    ctx.lineTo(x + (projectedX[face.c] - centerX) * scale, foot - (projectedY[face.c] - minUp) * scale);
    ctx.closePath(); ctx.fillStyle = tint; ctx.strokeStyle = tint;
    ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  return { triangleCount: faces.length, width: (maxX - minX) * scale, height: (maxUp - minUp) * scale };
}

export const DOG_MODEL_LIMITS = Object.freeze({ triangles: 15_000, materials: 2, textureSize: 1024, textures: 2, compressedBytes: 3_000_000 });
