const SPRITES = Object.freeze({
  gardenBorder: Object.freeze({ crop: [264, 87, 240, 82], anchor: [.5, .98] }),
  treeOak: Object.freeze({ crop: [33, 8, 189, 240], anchor: [.51, .985] }),
  treeMaple: Object.freeze({ crop: [33, 8, 189, 240], anchor: [.50, .985] }),
  treeRound: Object.freeze({ crop: [33, 8, 189, 240], anchor: [.50, .985] }),
  treeWillow: Object.freeze({ crop: [33, 8, 189, 240], anchor: [.50, .985] }),
});

const SOURCES = Object.freeze({
  props: new URL('../art/park-level2/trees.webp', import.meta.url).href,
  path: new URL('../art/park-level2/path-material.webp', import.meta.url).href,
  grass: new URL('../art/park-level2/grass.webp', import.meta.url).href,
});
const PATH_PATTERNS = new WeakMap();
const GRASS_PATTERNS = new WeakMap();

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
}

function loadImage(url, ImageCtor, timeoutMs) {
  if (typeof ImageCtor !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false, decoding = false, timer = null, image;
    try { image = new ImageCtor(); } catch { resolve(null); return; }
    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      image.onload = null; image.onerror = null;
      resolve(value);
    };
    const decode = async () => {
      if (settled || decoding) return;
      decoding = true;
      try {
        if (typeof image.decode === 'function') await image.decode();
        finish(validImage(image) ? image : null);
      } catch { finish(null); }
    };
    image.decoding = 'async'; image.onload = decode; image.onerror = () => finish(null);
    timer = globalThis.setTimeout(() => finish(null), Math.max(100, Math.min(10_000, timeoutMs)));
    try { image.src = url; } catch { finish(null); }
    if (validImage(image)) void decode();
  });
}

function smoothColor(ctx, x, y, width, height, stops, fallback) {
  const gradient = ctx.createLinearGradient?.(x, y, x + width * .5, y + height);
  if (!gradient || typeof gradient.addColorStop !== 'function') return fallback;
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

function drawVectorTree(renderer, x, baseline, width, height, variant = 0) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 180, height / 220);
  renderer.ellipse(0, 2, 25, 4, '#473d2c28');
  const bark = smoothColor(c, -8, -118, 20, 118,
    [[0, '#bd8b5a'], [.38, '#8f6644'], [1, '#5d4432']], '#8b6544');
  renderer.path([[-11, 0], [-8, -77], [-4, -120], [4, -120], [9, -76], [12, 0]], bark, '#654b35', 1.5);
  renderer.path([[-5, -56], [-34, -111], [-29, -114], [-8, -86], [-4, -64]], bark, '#654b35', .8);
  renderer.path([[5, -59], [29, -111], [34, -112], [11, -77], [8, -59]], bark, '#654b35', .8);
  renderer.path([[-9, -22], [-24, -2], [-30, 0], [-11, -5]], '#9b724b');
  renderer.path([[8, -24], [24, -1], [30, 0], [11, -6]], '#9b724b');
  c.beginPath(); c.moveTo(-1, -109); c.lineTo(1, -40);
  c.strokeStyle = '#d2a36c99'; c.lineWidth = 1.3; c.stroke();
  const greens = variant % 2
    ? ['#58734c', '#6f8752', '#91a565', '#718b55']
    : ['#60794d', '#7b9258', '#a1b06a', '#778e52'];
  const clusters = [[-34,-135,44,36],[2,-154,49,42],[37,-131,43,37],[-5,-116,53,39],[-42,-111,34,30],[40,-104,32,29]];
  clusters.forEach(([cx, cy, rx, ry], index) => {
    const base = greens[(index + variant) % greens.length];
    const canopy = smoothColor(c, cx - rx, cy - ry, rx * 2, ry * 2,
      [[0, '#b2b777'], [.33, base], [1, '#3f6041']], base);
    renderer.ellipse(cx, cy, rx, ry, canopy, '#58704766');
    renderer.ellipse(cx - rx * .2, cy - ry * .23, rx * .54, ry * .38, '#d4d08a24');
    for (let leaf = 0; leaf < 7; leaf++) {
      const lx = cx - rx * .68 + ((leaf * 29 + index * 17) % 100) / 100 * rx * 1.3;
      const ly = cy - ry * .52 + ((leaf * 37 + index * 11) % 100) / 100 * ry * .92;
      renderer.ellipse(lx, ly, rx * .12, ry * .075,
        leaf % 3 ? '#c0c67a39' : '#42664336', null, -.3 + leaf * .09);
    }
  });
  c.restore();
}

function drawVectorHedge(renderer, x, baseline, width, height, variant = 0) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 150, height / 96);
  renderer.ellipse(0, 1.5, 62, 8, '#473d2c1c');
  const hedge = smoothColor(c, 0, -66, 0, 68,
    [[0, '#9daa6b'], [.52, variant % 2 ? '#657d4e' : '#6c8450'], [1, '#3f6240']], '#657d4e');
  renderer.ellipse(0, -32, 67, 34, hedge, '#5d443288');
  for (let index = 0; index < 9; index++) {
    const x0 = -52 + (index % 5) * 25 + (index > 4 ? 8 : 0);
    const y0 = -42 - Math.floor(index / 5) * 25 - ((index * 7) % 9);
    renderer.ellipse(x0, y0, 18, 15, ['#8a9f5d','#738b50','#9ca96b','#5b774b'][index % 4], '#48634433');
    renderer.ellipse(x0 - 4, y0 - 4, 7, 3, '#d2d18b3d', null, -.55);
    renderer.ellipse(x0 + 5, y0 + 4, 6, 2.7, '#42664435', null, .55);
    if (variant === 1 || variant === 2) {
      renderer.ellipse(x0 - 4, y0 - 5, 2.2, 2.2, variant === 1 ? '#df9270' : '#f5dfad');
      renderer.ellipse(x0 + 5, y0 + 2, 1.8, 1.8, variant === 1 ? '#f0b27d' : '#fff2d3');
    }
  }
  c.restore();
}

function drawVectorBench(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 180, height / 112);
  renderer.ellipse(0, 2, 78, 5, '#473d2c28');
  const wood = smoothColor(c, 0, -70, 0, 72, [[0, '#e0b276'], [.45, '#b9814e'], [1, '#7d573a']], '#b9814e');
  renderer.path([[-63,-70],[63,-70],[63,-45],[-63,-45]], wood, '#5d4432', 2);
  renderer.path([[-63,-41],[63,-41],[63,-17],[-63,-17]], wood, '#5d4432', 2);
  renderer.path([[-58,-13],[58,-13],[55,-2],[-55,-2]], '#9a7047', '#5d4432', 2);
  renderer.path([[-50,-44],[-41,-44],[-46,0],[-56,0]], '#66594a', '#4d4336', 1.5);
  renderer.path([[41,-44],[50,-44],[56,0],[46,0]], '#66594a', '#4d4336', 1.5);
  renderer.path([[-56,-44],[-48,-46],[-52,-11],[-61,-11]], '#8a6241', '#5d4432', 1.4);
  renderer.path([[48,-46],[56,-44],[61,-11],[52,-11]], '#8a6241', '#5d4432', 1.4);
  for (const y of [-64, -56, -35, -26]) {
    c.beginPath(); c.moveTo(-58, y); c.lineTo(58, y - .3);
    c.strokeStyle = '#f1cc8a73'; c.lineWidth = 1.1; c.stroke();
  }
  for (const bx of [-53, 53]) for (const by of [-62, -33]) renderer.ellipse(bx, by, 1.35, 1.35, '#554331');
  c.restore();
}

function drawVectorSign(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 100, height / 140);
  renderer.ellipse(0, 1.5, 38, 4, '#473d2c26');
  const frame = smoothColor(c, -31, -132, 62, 95, [[0, '#e1c18d'], [.5, '#f8efdc'], [1, '#c8a475']], '#f5e7c6');
  renderer.path([[-31,-132],[31,-132],[31,-37],[-31,-37]], frame, '#5d4432', 3);
  renderer.path([[-26,-127],[26,-127],[26,-42],[-26,-42]], '#fff8e9', '#b89870', 1.4);
  const post = smoothColor(c, 0, -37, 0, 37, [[0, '#a98258'], [.5, '#77563a'], [1, '#523b2e']], '#77563a');
  renderer.path([[-20,-37],[-12,-37],[-14,0],[-22,0]], post, '#5d4432', 1.2);
  renderer.path([[12,-37],[20,-37],[22,0],[14,0]], post, '#5d4432', 1.2);
  c.fillStyle = '#5d4432'; c.font = '600 18px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText?.('公園', 0, -91);
  renderer.ellipse(0, -72, 6, 2.8, '#71855b');
  renderer.ellipse(3, -73, 4.5, 2.2, '#9ca96b');
  c.restore();
}

function drawVectorEntrancePost(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 96, height / 164);
  renderer.ellipse(0, 2, 37, 5, '#473d2c24');
  const stone = smoothColor(c, -24, -140, 48, 140,
    [[0, '#f3e5c9'], [.52, '#cfb58a'], [1, '#9d805e']], '#d2b992');
  renderer.path([[-21,-123],[21,-123],[18,-7],[-18,-7]], stone, '#806346', 2);
  renderer.path([[-27,-130],[27,-130],[30,-116],[-30,-116]], '#8a6240', '#654a34', 2);
  renderer.path([[-31,-144],[31,-144],[29,-131],[-29,-131]], '#b88150', '#654a34', 2);
  renderer.path([[-26,-7],[26,-7],[31,0],[-31,0]], '#9c7a55', '#654a34', 1.4);
  renderer.ellipse(-2, -92, 6, 4, '#71855b');
  renderer.ellipse(4, -94, 5, 3.1, '#9ca96b');
  c.restore();
}

function drawVectorPlayground(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 150, height / 118);
  renderer.ellipse(0, 2, 67, 5, '#473d2c22');
  const rail = smoothColor(c, -54, -72, 108, 84, [[0, '#75a2a0'], [.48, '#43777d'], [1, '#285a64']], '#426d72');
  c.beginPath(); c.moveTo(-54,0); c.lineTo(-42,-52); c.quadraticCurveTo(0,-117,42,-52); c.lineTo(54,0);
  c.strokeStyle = '#304f4e'; c.lineWidth = 13; c.lineCap = 'round'; c.stroke();
  c.strokeStyle = rail; c.lineWidth = 9; c.stroke();
  for (const [y, half] of [[-14,49],[-28,46],[-42,39],[-56,32],[-68,22]]) {
    c.beginPath(); c.moveTo(-half,y); c.lineTo(half,y);
    c.strokeStyle = '#805633'; c.lineWidth = 6; c.lineCap = 'round'; c.stroke();
    c.beginPath(); c.moveTo(-half,y - .7); c.lineTo(half,y - .7);
    c.strokeStyle = y % 2 ? '#efc266' : '#e5aa54'; c.lineWidth = 3.3; c.stroke();
    for (const side of [-1,1]) renderer.ellipse(side * half, y, 1.4, 1.4, '#f3d895');
  }
  c.restore();
}

function drawVectorSlide(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 220, height / 148);
  renderer.ellipse(-3, 2, 96, 6, '#473d2c23');
  const timber = smoothColor(c, -80, -136, 130, 136,
    [[0, '#d8ac70'], [.5, '#ad7848'], [1, '#765338']], '#9a7047');
  const darkTimber = '#735135';
  // Four square posts and a raised deck make the small tower read clearly at a distance.
  for (const x0 of [-62, 32]) {
    renderer.path([[x0,-111],[x0+9,-111],[x0+8,0],[x0-2,0]], timber, darkTimber, 1.5);
    renderer.ellipse(x0 + 3, -109, 5.2, 4.1, '#c18e58', darkTimber);
  }
  renderer.path([[-78,-115],[-57,-146],[-12,-146],[12,-115]], '#9a6841', darkTimber, 2.2);
  renderer.path([[-70,-116],[-54,-137],[-15,-137],[4,-116]], '#e4c28a', '#846140', 1.2);
  renderer.path([[-64,-111],[35,-111],[35,-95],[-64,-95]], timber, darkTimber, 1.7);
  for (const x0 of [-52,-30,-8,14]) {
    c.beginPath(); c.moveTo(x0,-109); c.lineTo(x0,-97); c.strokeStyle = '#e5bd7c'; c.lineWidth = 1.2; c.stroke();
  }
  // A ladder on the left balances the warm slide on the right.
  c.beginPath(); c.moveTo(-78,-101); c.lineTo(-83,-4); c.moveTo(-60,-101); c.lineTo(-55,-4);
  c.strokeStyle = '#78563b'; c.lineWidth = 4; c.lineCap = 'round'; c.stroke();
  for (const y of [-82,-63,-44,-25,-7]) {
    c.beginPath(); c.moveTo(-79,y); c.lineTo(-57,y); c.strokeStyle = '#d6a96c'; c.lineWidth = 3.2; c.stroke();
  }
  const slide = smoothColor(c, 5, -91, 54, 92,
    [[0, '#f4b16c'], [.55, '#dc783d'], [1, '#ad4e2d']], '#d9793c');
  c.beginPath(); c.moveTo(3,-95); c.lineTo(34,-95); c.bezierCurveTo(39,-67,54,-28,72,-4);
  c.lineTo(51,0); c.bezierCurveTo(29,-23,12,-60,3,-95); c.closePath();
  c.fillStyle = slide; c.strokeStyle = '#854a32'; c.lineWidth = 2.1; c.fill(); c.stroke();
  c.beginPath(); c.moveTo(10,-86); c.bezierCurveTo(20,-58,38,-25,59,-6);
  c.strokeStyle = '#ffd092'; c.lineWidth = 2.4; c.stroke();
  renderer.path([[39,-7],[75,-7],[80,0],[38,0]], '#806047', darkTimber, 1.2);
  c.restore();
}

function drawVectorSwings(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 260, height / 150);
  renderer.ellipse(0, 2, 114, 6, '#473d2c23');
  const timber = smoothColor(c, -110, -145, 220, 145,
    [[0, '#e0bc82'], [.5, '#b27d4c'], [1, '#79563b']], '#a7784c');
  c.lineCap = 'round'; c.lineJoin = 'round';
  // The triangular side frames stay open so the swing seats remain readable.
  c.beginPath(); c.moveTo(-94,0); c.lineTo(-56,-136); c.lineTo(56,-136); c.lineTo(94,0);
  c.strokeStyle = '#755239'; c.lineWidth = 11; c.stroke();
  c.beginPath(); c.moveTo(-91,-2); c.lineTo(-55,-134); c.lineTo(55,-134); c.lineTo(91,-2);
  c.strokeStyle = timber; c.lineWidth = 7; c.stroke();
  c.beginPath(); c.moveTo(-57,-135); c.lineTo(57,-135); c.strokeStyle = '#745239'; c.lineWidth = 12; c.stroke();
  c.beginPath(); c.moveTo(-57,-138); c.lineTo(57,-138); c.strokeStyle = '#dfb97d'; c.lineWidth = 7; c.stroke();
  for (const seatX of [-28, 30]) {
    c.beginPath(); c.moveTo(seatX-11,-132); c.lineTo(seatX-7,-48);
    c.moveTo(seatX+11,-132); c.lineTo(seatX+7,-48);
    c.strokeStyle = '#6b5841'; c.lineWidth = 2.2; c.stroke();
    renderer.path([[seatX-15,-48],[seatX+15,-48],[seatX+12,-40],[seatX-12,-40]], '#a96f3e', '#624935', 1.7);
    c.beginPath(); c.moveTo(seatX-10,-46); c.lineTo(seatX+10,-46); c.strokeStyle = '#e1ad6d'; c.lineWidth = 1.3; c.stroke();
  }
  for (const x0 of [-56,56]) renderer.ellipse(x0,-134,6,4,'#71815c','#4c6348');
  c.restore();
}

function drawVectorSandbox(renderer, x, baseline, width, height) {
  const c = renderer.ctx;
  c.save(); c.translate(x, baseline); c.scale(width / 200, height / 80);
  renderer.ellipse(-3, 1.5, 89, 5, '#473d2c20');
  // A low open sand tray: inset sand sits in a narrow rim with only a shallow front board.
  renderer.path([[-88,-14],[43,-14],[77,-34],[-54,-34]], '#a7774a', '#715237', 1.6);
  renderer.path([[-79,-17],[40,-17],[67,-32],[-52,-32]], '#dfc28e', '#ad8756', 1.2);
  renderer.path([[-88,-14],[43,-14],[43,0],[-86,0]], '#b9824d', '#765236', 1.5);
  renderer.path([[43,-14],[77,-34],[77,-21],[44,0]], '#986b43', '#765236', 1.5);
  renderer.path([[-88,-14],[-54,-34],[-52,-21],[-86,0]], '#ca9961', '#765236', 1.3);
  c.beginPath(); c.moveTo(-77,-12); c.lineTo(36,-12);
  c.strokeStyle = '#e6bc7c'; c.lineWidth = 1.2; c.stroke();
  // Shallow sand ridges and scattered grains keep the surface readable at distance.
  c.beginPath(); c.moveTo(-49,-25); c.quadraticCurveTo(-24,-32,2,-24);
  c.quadraticCurveTo(20,-20,44,-30); c.strokeStyle = '#f0d9aa'; c.lineWidth = 2.2; c.stroke();
  c.beginPath(); c.moveTo(-30,-20); c.quadraticCurveTo(-10,-26,9,-20);
  c.strokeStyle = '#caa66f'; c.lineWidth = 1.25; c.stroke();
  for (const [px, py, rx] of [[-58,-25,1.5],[-35,-30,1.2],[-10,-20,1.3],[18,-26,1.2],[48,-30,1.5]]) {
    renderer.ellipse(px, py, rx, .8, '#c49e66');
  }
  // A bright pail and handle provide one familiar playground cue without extra signage.
  renderer.path([[12,-27],[25,-27],[23,-16],[14,-16]], '#d97843', '#794b34', 1.2);
  c.beginPath(); c.moveTo(14,-26); c.quadraticCurveTo(18,-34,24,-26);
  c.strokeStyle = '#79583e'; c.lineWidth = 1.2; c.stroke();
  c.beginPath(); c.moveTo(14,-25); c.lineTo(23,-25); c.strokeStyle = '#f0b66e'; c.lineWidth = 1; c.stroke();
  c.restore();
}

function drawVectorFlowerbed(renderer, x, baseline, width, height, variant = 0) {
  drawVectorHedge(renderer, x, baseline, width, height, variant === 0 ? 1 : 2);
}

function spriteFallback(renderer, kind, x, baseline, width, height, variant) {
  if (kind.startsWith('tree')) drawVectorTree(renderer, x, baseline, width, height, variant);
  else if (kind === 'bench') drawVectorBench(renderer, x, baseline, width, height);
  else if (kind === 'sign') drawVectorSign(renderer, x, baseline, width, height);
  else if (kind === 'entrancePost') drawVectorEntrancePost(renderer, x, baseline, width, height);
  else if (kind === 'playground') drawVectorPlayground(renderer, x, baseline, width, height);
  else if (kind === 'playgroundSlide') drawVectorSlide(renderer, x, baseline, width, height);
  else if (kind === 'playgroundSwings') drawVectorSwings(renderer, x, baseline, width, height);
  else if (kind === 'sandbox') drawVectorSandbox(renderer, x, baseline, width, height);
  else if (kind === 'flowerbed') drawVectorFlowerbed(renderer, x, baseline, width, height, variant);
  else drawVectorHedge(renderer, x, baseline, width, height, variant);
}

export class ParkLevel2Art {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = 2_400 } = {}) {
    this.images = Object.fromEntries(Object.keys(SOURCES).map(name => [name, null]));
    this.status = Object.fromEntries(Object.keys(SOURCES).map(name => [name, 'pending']));
    this.ready = Promise.all(Object.entries(SOURCES).map(async ([name, url]) => {
      const image = await loadImage(url, ImageCtor, timeoutMs);
      this.images[name] = image;
      this.status[name] = image ? 'ready' : 'fallback';
    })).then(() => this);
  }

  get stats() { return Object.freeze({ ...this.status }); }

  drawProjectedGround(renderer, left, right, near, far, travel, material = 'path', opacity = .25) {
    const image = this.images[material], ctx = renderer.ctx;
    if (!validImage(image) || typeof ctx?.createPattern !== 'function') return false;
    const patterns = material === 'grass' ? GRASS_PATTERNS : PATH_PATTERNS;
    let cached = patterns.get(ctx);
    if (!cached || cached.image !== image) {
      const pattern = ctx.createPattern(image, 'repeat');
      if (!pattern?.setTransform) return false;
      cached = { image, pattern }; patterns.set(ctx, cached);
    }
    const mid = (near + far) / 2, center = renderer.project(0, mid);
    const across = renderer.project(1, mid), before = renderer.project(0, near), after = renderer.project(0, far);
    const pxX = Math.abs(across.x - center.x), pxZ = Math.abs(after.y - before.y) / (far - near);
    const span = material === 'grass' ? 2.6 : 2.1;
    const worldZ = travel + mid, phase = ((worldZ % span) + span) % span;
    cached.pattern.setTransform({ a: pxX * span / image.naturalWidth, b: 0, c: 0,
      d: -pxZ * span / image.naturalHeight, e: center.x, f: center.y + phase * pxZ });
    const points = [[left,near],[right,near],[right,far],[left,far]].map(([x,d]) => renderer.project(x,d));
    ctx.save(); ctx.beginPath(); ctx.moveTo(points[0].x,points[0].y);
    for (const p of points.slice(1)) ctx.lineTo(p.x,p.y);
    ctx.closePath(); ctx.clip(); ctx.globalAlpha *= opacity; ctx.fillStyle = cached.pattern;
    const x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y));
    ctx.fillRect(x,y,Math.max(...points.map(p=>p.x))-x,Math.max(...points.map(p=>p.y))-y);
    ctx.restore(); return true;
  }

  drawSprite(ctx, kind, x, baseline, width, height, variant = 0) {
    const image = this.images.props, sprite = SPRITES[kind];
    if (!validImage(image) || !sprite || typeof ctx?.drawImage !== 'function') return false;
    const [sx, sy, sw, sh] = sprite.crop;
    ctx.save();
    if (Math.trunc(variant) % 2) {
      ctx.translate(x, 0); ctx.scale(-1, 1);
      ctx.drawImage(image, sx, sy, sw, sh,
        -sprite.anchor[0] * width, baseline - sprite.anchor[1] * height, width, height);
    } else {
      ctx.drawImage(image, sx, sy, sw, sh,
        x - sprite.anchor[0] * width, baseline - sprite.anchor[1] * height, width, height);
    }
    ctx.restore();
    return true;
  }


}

export function drawParkProp(renderer, art, kind, x, baseline, width, height, variant = 0) {
  variant = Math.abs(Math.trunc(variant) || 0);
  if (art?.drawSprite(renderer.ctx, kind, x, baseline, width, height, variant)) return 'image';
  spriteFallback(renderer, kind, x, baseline, width, height, variant);
  return 'vector';
}

export function drawParkPuddle(renderer, lane, distance) {
  const p = renderer.project(lane, distance);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  const ctx = renderer.ctx;
  const contour = [[-.28,-.04],[-.20,-.10],[.04,-.10],[.28,-.035],[.24,.065],[.06,.10],[-.16,.085],[-.28,.015]]
    .map(([x,z]) => renderer.project(lane + x, distance + z));
  const top = Math.min(...contour.map(point => point.y)), bottom = Math.max(...contour.map(point => point.y));
  const fill = smoothColor(ctx, p.x, top, 0, bottom - top,
    [[0, '#bcc9bd'], [.55, '#91a7a0'], [1, '#6b8680']], '#91a7a0');
  ctx.beginPath();
  ctx.moveTo((contour.at(-1).x + contour[0].x)/2, (contour.at(-1).y + contour[0].y)/2);
  contour.forEach((point,index) => {
    const next = contour[(index + 1) % contour.length];
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x)/2, (point.y + next.y)/2);
  });
  ctx.closePath();ctx.fillStyle = fill;ctx.strokeStyle = '#61746cb5';ctx.lineWidth = 1.25;ctx.fill();ctx.stroke();
  const left = renderer.project(lane - .18, distance - .005), right = renderer.project(lane + .18, distance - .005);
  const span = Math.abs(right.x - left.x);
  ctx.save(); ctx.beginPath(); ctx.moveTo(p.x - span * .29, p.y - 2.2 * p.scale);
  ctx.bezierCurveTo(p.x - span * .15, p.y - 3 * p.scale, p.x + span * .08, p.y - p.scale, p.x + span * .25, p.y - 2 * p.scale);
  ctx.strokeStyle = '#e6ecdd9a'; ctx.lineWidth = Math.max(.65, p.scale * .9); ctx.stroke(); ctx.restore();
  return true;
}

function finiteWidth(value) { return Number.isFinite(value) && value > 0 ? value : 0; }
// Kept as compatibility exports while every Level 2 warning marker is retired.
export function parkWarningMarkerSize() { return 0; }
export function drawCrowWarning() { return false; }
export function drawBallWarning() { return false; }
export function drawParkWarning() { return false; }

export function drawParkCrowAt(renderer, { x, y, size, alpha = 1 }) {
  const ctx = renderer.ctx;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y - size * .20);
  ctx.scale(size / 46, size / 46);
  ctx.beginPath(); ctx.moveTo(-16, 3); ctx.quadraticCurveTo(-12, -10, -3, -8);
  ctx.quadraticCurveTo(5, -13, 12, -8); ctx.lineTo(10, -4); ctx.lineTo(20, -1);
  ctx.lineTo(10, 3); ctx.quadraticCurveTo(3, 10, -8, 7); ctx.closePath();
  ctx.fillStyle = smoothColor(ctx, -12, -12, 25, 24,
    [[0, '#626c6b'], [.30, '#343d3d'], [1, '#161d1d']], '#303939');
  ctx.strokeStyle = '#191f1e'; ctx.lineWidth = 1.6; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -4); ctx.quadraticCurveTo(1, -10, 8, -5);
  ctx.lineTo(3, 0); ctx.closePath(); ctx.fillStyle = '#48534f'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.quadraticCurveTo(-3, -5, 3, -3);
  ctx.moveTo(-7, 3); ctx.quadraticCurveTo(-1, -1, 3, -1);
  ctx.strokeStyle = '#8a99916e'; ctx.lineWidth = .6; ctx.stroke();
  ctx.beginPath(); ctx.arc(8, -7, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#fff2d7'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-3,6);ctx.lineTo(-4,10);ctx.moveTo(3,6);ctx.lineTo(2,10);ctx.strokeStyle='#282921';ctx.lineWidth=1.1;ctx.stroke();
  ctx.restore();
  return true;
}

function crowSize(renderer, point) {
  return Math.max(46, 88 * point.scale * finiteWidth(renderer?.width) / 390);
}

function ballDiameter(renderer, point) {
  const projectedLaneWidth = finiteWidth(renderer?.width) * .235 * point.scale;
  return Math.max(30, projectedLaneWidth * .72);
}

export function parkObstacleBodyBounds(renderer, typeOrObstacle, lane, distance) {
  const type = typeof typeOrObstacle === 'string' ? typeOrObstacle : typeOrObstacle?.type;
  const point = renderer?.project?.(lane, distance);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.scale)) return null;
  if (type === 'crow') {
    const size = crowSize(renderer, point);
    // Matches drawParkCrowAt's body path, its y offset, and the 1.6px outline.
    const left = point.x - size * 16 / 46 - 1;
    const right = point.x + size * 20 / 46 + 1;
    const top = point.y - size * 22.2 / 46 - 1;
    const bottom = point.y + size * .8 / 46 + 1;
    return Object.freeze({ type, x: left, y: top, width: right - left, height: bottom - top,
      centerX: (left + right) / 2, centerY: (top + bottom) / 2 });
  }
  if (type === 'ball') {
    const diameter = ballDiameter(renderer, point);
    const radius = diameter * .47 + 1.4;
    const centerY = point.y - diameter * .50;
    return Object.freeze({ type, x: point.x - radius, y: centerY - radius,
      width: radius * 2, height: radius * 2, centerX: point.x, centerY });
  }
  if (type === 'puddle') {
    const contour = [[-.28,-.04],[-.20,-.10],[.04,-.10],[.28,-.035],[.24,.065],[.06,.10],[-.16,.085],[-.28,.015]]
      .map(([laneOffset, distanceOffset]) => renderer.project(lane + laneOffset, distance + distanceOffset))
      .filter(projected => Number.isFinite(projected?.x) && Number.isFinite(projected?.y));
    if (!contour.length) return null;
    const minX = Math.min(...contour.map(projected => projected.x)) - .7;
    const minY = Math.min(...contour.map(projected => projected.y)) - .7;
    const maxX = Math.max(...contour.map(projected => projected.x)) + .7;
    const maxY = Math.max(...contour.map(projected => projected.y)) + .7;
    return Object.freeze({ type, x: minX, y: minY, width: maxX - minX, height: maxY - minY,
      centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 });
  }
  return null;
}

export function drawParkCrow(renderer, lane, distance, timeMs, obstacle) {
  const visibleStartMs = Number.isFinite(obstacle?.visibleStartMs)
    ? obstacle.visibleStartMs
    : Number.isFinite(obstacle?.arrivalMs) ? obstacle.arrivalMs - 1_800 : -Infinity;
  const departureMs = Number.isFinite(obstacle?.departureMs)
    ? obstacle.departureMs : (obstacle?.arrivalMs ?? timeMs) + 1_200;
  if (timeMs < visibleStartMs || timeMs > departureMs) return false;
  const point = renderer.project(lane, distance);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const size = crowSize(renderer, point);
  renderer.ellipse(point.x, point.y + 2 * point.scale, Math.max(4, size * .43), Math.max(1.5, size * .12), '#3d352d55');
  drawParkCrowAt(renderer, { x: point.x, y: point.y, size, timeMs });
  return true;
}

export function drawParkBall(renderer, lane, distance, timeMs, obstacle = null) {
  const visibleStartMs = Number.isFinite(obstacle?.visibleStartMs)
    ? obstacle.visibleStartMs : Number.isFinite(obstacle?.arrivalMs) ? obstacle.arrivalMs - 1_800 : -Infinity;
  const moveStartMs = Number.isFinite(obstacle?.moveStartMs) ? obstacle.moveStartMs : visibleStartMs;
  const moveEndMs = Number.isFinite(obstacle?.moveEndMs)
    ? obstacle.moveEndMs : Number.isFinite(obstacle?.arrivalMs) ? obstacle.arrivalMs + 300 : moveStartMs + 2_100;
  const visibleEndMs = moveEndMs + 150;
  if (timeMs < visibleStartMs || timeMs > visibleEndMs) return false;
  const point = renderer.project(lane, distance);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const diameter = ballDiameter(renderer, point), ctx = renderer.ctx;
  renderer.ellipse(point.x, point.y + 1.5 * point.scale, diameter * .55, diameter * .16, '#49372f50');
  ctx.save(); ctx.translate(point.x, point.y - diameter * .50);
  ctx.scale(diameter / 2, diameter / 2);
  const gradient = smoothColor(ctx, -1, -1, 2, 2,
    [[0, '#ffc05a'], [.52, '#e78032'], [1, '#b75125']], '#e78032');
  ctx.beginPath(); ctx.arc(0, 0, .94, 0, Math.PI * 2); ctx.fillStyle = gradient;
  ctx.strokeStyle = '#5d4432'; ctx.lineWidth = 1.4 / Math.max(5.5, diameter / 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-.31, -.39, .18, .10, -.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe6bb59'; ctx.fill();
  const duration = Math.max(1, moveEndMs - moveStartMs);
  const progress = Math.max(0, Math.min(1, (timeMs - moveStartMs) / duration));
  const direction = Math.sign((obstacle?.toLane ?? 1) - (obstacle?.fromLane ?? 0));
  ctx.save(); if (!renderer.reducedMotion) ctx.rotate(direction * progress * Math.PI * 1.2);
  ctx.beginPath(); ctx.ellipse(-.05, 0, .25, .90, -.14, -.88, .88); ctx.strokeStyle = '#fff1d3';
  ctx.lineWidth = 2 / Math.max(5.5, diameter / 2); ctx.stroke(); ctx.restore();
  ctx.restore();
  return true;
}

export function getParkSpriteCrops() { return SPRITES; }
