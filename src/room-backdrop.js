const MAX_BACKDROP_DPR = 2;

const COLORS = {
  wallTop: '#f7efe3',
  wallBottom: '#eee2d1',
  floorTop: '#d7b98e',
  floorBottom: '#c9a779',
  woodLine: 'rgba(106, 74, 47, 0.11)',
  sage: '#87917a',
  sageLight: '#a9ad96',
  sageDeep: '#707c69',
  oatmeal: '#e8d6bb',
  ink: '#654a35',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, fill) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawWindow(ctx, width, height, floorY) {
  const x = width * 0.105;
  const preferredY = Math.max(94, height * 0.14);
  const roomAtPreferredY = floorY - preferredY - 20;
  const adaptiveY = floorY - 20 - 72 - height * 0.018 - 4;
  const y = roomAtPreferredY < 72
    ? Math.max(82, Math.min(preferredY, adaptiveY))
    : preferredY;
  const windowWidth = Math.min(width * 0.34, 190);
  const windowHeight = Math.min(height * 0.225, 190, Math.max(0, floorY - y - 20));
  const frame = Math.max(5, width * 0.014);
  if (windowHeight <= frame * 2 + 4) return;
  const innerX = x + frame;
  const innerY = y + frame;
  const innerWidth = windowWidth - frame * 2;
  const innerHeight = windowHeight - frame * 2;

  const morningLight = ctx.createRadialGradient(
    x + windowWidth * 0.52, y + windowHeight * 0.52, 0,
    x + windowWidth * 0.52, y + windowHeight * 0.52, Math.max(width, height) * 0.54,
  );
  morningLight.addColorStop(0, 'rgba(255, 238, 197, 0.28)');
  morningLight.addColorStop(1, 'rgba(255, 238, 197, 0)');
  ctx.fillStyle = morningLight;
  ctx.fillRect(0, 0, width, floorY);

  const rodY = y - Math.max(8, height * 0.018);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(105, 78, 54, 0.46)';
  ctx.lineWidth = Math.max(1.4, width * 0.004);
  ctx.beginPath();
  ctx.moveTo(x - frame * 1.5, rodY);
  ctx.lineTo(x + windowWidth + frame * 1.5, rodY);
  ctx.stroke();

  const windowGradient = ctx.createLinearGradient(0, innerY, 0, innerY + innerHeight);
  windowGradient.addColorStop(0, '#dbe6dd');
  windowGradient.addColorStop(0.58, '#e9e8d7');
  windowGradient.addColorStop(1, '#f2dfbe');
  fillRoundedRect(ctx, x, y, windowWidth, windowHeight, frame * 0.9, '#dfc8a7');
  fillRoundedRect(ctx, innerX, innerY, innerWidth, innerHeight, frame * 0.25, windowGradient);

  ctx.save();
  roundedRect(ctx, innerX, innerY, innerWidth, innerHeight, frame * 0.25);
  ctx.clip();
  ctx.fillStyle = 'rgba(183, 194, 170, 0.46)';
  ctx.beginPath();
  ctx.moveTo(innerX, innerY + innerHeight * 0.71);
  ctx.quadraticCurveTo(innerX + innerWidth * 0.24, innerY + innerHeight * 0.61,
    innerX + innerWidth * 0.47, innerY + innerHeight * 0.71);
  ctx.quadraticCurveTo(innerX + innerWidth * 0.72, innerY + innerHeight * 0.80,
    innerX + innerWidth, innerY + innerHeight * 0.65);
  ctx.lineTo(innerX + innerWidth, innerY + innerHeight);
  ctx.lineTo(innerX, innerY + innerHeight);
  ctx.closePath();
  ctx.fill();

  const sunX = innerX + innerWidth * 0.77;
  const sunY = innerY + innerHeight * 0.25;
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, innerHeight * 0.24);
  sun.addColorStop(0, 'rgba(255, 247, 216, 0.66)');
  sun.addColorStop(1, 'rgba(255, 247, 216, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(innerX, innerY, innerWidth, innerHeight);
  ctx.restore();

  ctx.strokeStyle = 'rgba(147, 118, 85, 0.55)';
  ctx.lineWidth = Math.max(1.5, width * 0.0045);
  ctx.beginPath();
  ctx.moveTo(innerX + innerWidth * 0.52, innerY + 1);
  ctx.lineTo(innerX + innerWidth * 0.52, innerY + innerHeight - 1);
  ctx.moveTo(innerX + 1, innerY + innerHeight * 0.62);
  ctx.lineTo(innerX + innerWidth - 1, innerY + innerHeight * 0.62);
  ctx.stroke();

  // Linen curtains soften the window's vertical edges without enclosing it in a heavy frame.
  const curtainWidth = Math.max(10, width * 0.046);
  ctx.fillStyle = '#e5d8c5';
  ctx.beginPath();
  ctx.moveTo(x - curtainWidth * 0.1, rodY + 2);
  ctx.bezierCurveTo(x - curtainWidth * 0.35, y + windowHeight * 0.28,
    x + curtainWidth * 0.1, y + windowHeight * 0.63,
    x - curtainWidth * 0.06, y + windowHeight + height * 0.018);
  ctx.quadraticCurveTo(x + curtainWidth * 0.52, y + windowHeight + height * 0.025,
    x + curtainWidth * 0.88, y + windowHeight + height * 0.014);
  ctx.bezierCurveTo(x + curtainWidth * 0.58, y + windowHeight * 0.7,
    x + curtainWidth * 0.67, y + windowHeight * 0.29,
    x + curtainWidth * 0.58, rodY + 2);
  ctx.closePath();
  ctx.fill();

  const otherCurtainX = x + windowWidth - curtainWidth * 0.76;
  ctx.beginPath();
  ctx.moveTo(otherCurtainX, rodY + 2);
  ctx.bezierCurveTo(otherCurtainX + curtainWidth * 0.1, y + windowHeight * 0.32,
    otherCurtainX - curtainWidth * 0.16, y + windowHeight * 0.72,
    otherCurtainX - curtainWidth * 0.34, y + windowHeight + height * 0.018);
  ctx.quadraticCurveTo(otherCurtainX + curtainWidth * 0.2, y + windowHeight + height * 0.028,
    otherCurtainX + curtainWidth * 0.92, y + windowHeight + height * 0.014);
  ctx.bezierCurveTo(otherCurtainX + curtainWidth * 0.7, y + windowHeight * 0.67,
    otherCurtainX + curtainWidth * 0.94, y + windowHeight * 0.26,
    otherCurtainX + curtainWidth * 0.82, rodY + 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 249, 238, 0.7)';
  ctx.fillRect(x - frame * 0.55, y + windowHeight, windowWidth + frame * 1.1, Math.max(3, height * 0.008));
}

function drawSofa(ctx, width, height, floorY) {
  const sofaWidth = Math.min(width * 0.43, 248);
  const sofaHeight = Math.min(height * 0.19, 174);
  const x = width - sofaWidth + width * 0.012;
  const y = floorY - sofaHeight * 0.84;
  const arm = sofaWidth * 0.14;

  ctx.fillStyle = 'rgba(81, 60, 43, 0.10)';
  ctx.beginPath();
  ctx.ellipse(x + sofaWidth * 0.48, floorY + height * 0.008,
    sofaWidth * 0.48, Math.max(4, height * 0.014), 0, 0, Math.PI * 2);
  ctx.fill();

  const legColor = '#806448';
  ctx.fillStyle = legColor;
  roundedRect(ctx, x + arm * 0.72, y + sofaHeight * 0.78, arm * 0.22, sofaHeight * 0.27, 3);
  ctx.fill();
  roundedRect(ctx, x + sofaWidth - arm * 0.94, y + sofaHeight * 0.78, arm * 0.22, sofaHeight * 0.27, 3);
  ctx.fill();

  const backGradient = ctx.createLinearGradient(x, y, x, y + sofaHeight * 0.65);
  backGradient.addColorStop(0, '#a7ac94');
  backGradient.addColorStop(1, COLORS.sage);
  fillRoundedRect(ctx, x + arm * 0.55, y, sofaWidth - arm * 1.1, sofaHeight * 0.77,
    sofaHeight * 0.12, backGradient);

  const seatGradient = ctx.createLinearGradient(0, y + sofaHeight * 0.58, 0, y + sofaHeight * 0.91);
  seatGradient.addColorStop(0, '#939a81');
  seatGradient.addColorStop(1, '#7e8972');
  fillRoundedRect(ctx, x + arm * 0.56, y + sofaHeight * 0.59,
    sofaWidth - arm * 1.12, sofaHeight * 0.27, sofaHeight * 0.1, seatGradient);

  const armGradient = ctx.createLinearGradient(x, y + sofaHeight * 0.34, x, floorY);
  armGradient.addColorStop(0, '#aeb19a');
  armGradient.addColorStop(1, '#87917a');
  fillRoundedRect(ctx, x, y + sofaHeight * 0.28, arm, sofaHeight * 0.57,
    arm * 0.42, armGradient);
  fillRoundedRect(ctx, x + sofaWidth - arm, y + sofaHeight * 0.28,
    arm, sofaHeight * 0.57, arm * 0.42, armGradient);

  const cushionY = y + sofaHeight * 0.18;
  const cushionGap = sofaWidth * 0.018;
  const cushionWidth = (sofaWidth - arm * 2.15 - cushionGap) / 2;
  const cushionHeight = sofaHeight * 0.43;
  fillRoundedRect(ctx, x + arm * 1.1, cushionY, cushionWidth, cushionHeight,
    sofaHeight * 0.09, '#b6b99f');
  fillRoundedRect(ctx, x + arm * 1.1 + cushionWidth + cushionGap, cushionY,
    cushionWidth, cushionHeight, sofaHeight * 0.09, '#aeb39b');

  ctx.strokeStyle = 'rgba(83, 97, 76, 0.22)';
  ctx.lineWidth = Math.max(0.7, width * 0.002);
  ctx.beginPath();
  ctx.moveTo(x + sofaWidth * 0.5, y + sofaHeight * 0.2);
  ctx.lineTo(x + sofaWidth * 0.5, y + sofaHeight * 0.55);
  ctx.moveTo(x + arm * 1.2, y + sofaHeight * 0.79);
  ctx.lineTo(x + sofaWidth - arm * 1.2, y + sofaHeight * 0.79);
  ctx.stroke();

  // One quiet oatmeal cushion adds a soft contrast on the visible right end.
  const pillowWidth = sofaWidth * 0.16;
  const pillowHeight = sofaHeight * 0.27;
  const pillowX = x + sofaWidth - arm * 1.68 - pillowWidth;
  fillRoundedRect(ctx, pillowX, y + sofaHeight * 0.27, pillowWidth, pillowHeight,
    pillowHeight * 0.28, '#dfd0b6');
  ctx.strokeStyle = 'rgba(117, 95, 70, 0.22)';
  ctx.lineWidth = Math.max(0.6, width * 0.0017);
  ctx.beginPath();
  ctx.moveTo(pillowX + pillowWidth * 0.5, y + sofaHeight * 0.32);
  ctx.lineTo(pillowX + pillowWidth * 0.5, y + sofaHeight * 0.49);
  ctx.stroke();
}

function drawPlant(ctx, width, height, floorY) {
  const scale = clamp(width / 390, 0.74, 1.18);
  const centerX = width * 0.115;
  const potWidth = 29 * scale;
  const potHeight = 31 * scale;
  const potY = floorY - potHeight;
  const stemBaseY = potY + potHeight * 0.12;
  const leafTop = Math.max(96, floorY - height * 0.265);

  ctx.strokeStyle = '#71806a';
  ctx.lineWidth = 2 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX, stemBaseY);
  ctx.bezierCurveTo(centerX - 3 * scale, floorY - height * 0.14,
    centerX + 5 * scale, leafTop + height * 0.11, centerX, leafTop);
  ctx.stroke();

  const leaf = (x, y, dx, dy, fill) => {
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return;
    const halfWidth = 3 * scale;
    const normalX = -dy / length * halfWidth;
    const normalY = dx / length * halfWidth;
    const tipX = x + dx;
    const tipY = y + dy;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + dx * 0.25 + normalX, y + dy * 0.25 + normalY,
      x + dx * 0.7 + normalX, y + dy * 0.7 + normalY,
      tipX, tipY);
    ctx.bezierCurveTo(x + dx * 0.7 - normalX, y + dy * 0.7 - normalY,
      x + dx * 0.25 - normalX, y + dy * 0.25 - normalY,
      x, y);
    ctx.closePath();
    ctx.fill();
  };
  leaf(centerX, leafTop + height * 0.025, -24 * scale, -13 * scale, '#9da889');
  leaf(centerX + 1 * scale, leafTop + height * 0.065, 26 * scale, -10 * scale, '#88967b');
  leaf(centerX, leafTop + height * 0.095, -27 * scale, 0, '#aab095');
  leaf(centerX, leafTop + height * 0.125, 22 * scale, 8 * scale, '#7f8d74');
  leaf(centerX, leafTop + height * 0.045, 6 * scale, -22 * scale, '#b3b99c');
  leaf(centerX, leafTop + height * 0.085, -7 * scale, 14 * scale, '#909d82');

  const potGradient = ctx.createLinearGradient(centerX - potWidth / 2, 0, centerX + potWidth / 2, 0);
  potGradient.addColorStop(0, '#c69770');
  potGradient.addColorStop(0.5, '#d5aa82');
  potGradient.addColorStop(1, '#bf8d68');
  ctx.fillStyle = potGradient;
  ctx.beginPath();
  ctx.moveTo(centerX - potWidth * 0.43, potY + potHeight * 0.12);
  ctx.lineTo(centerX + potWidth * 0.43, potY + potHeight * 0.12);
  ctx.lineTo(centerX + potWidth * 0.31, floorY - 2 * scale);
  ctx.quadraticCurveTo(centerX, floorY + 1 * scale, centerX - potWidth * 0.31, floorY - 2 * scale);
  ctx.closePath();
  ctx.fill();
  fillRoundedRect(ctx, centerX - potWidth * 0.49, potY, potWidth * 0.98,
    potHeight * 0.19, potHeight * 0.08, '#d6aa83');
  ctx.fillStyle = 'rgba(115, 78, 54, 0.22)';
  ctx.fillRect(centerX - potWidth * 0.32, potY + potHeight * 0.24,
    potWidth * 0.64, Math.max(0.6, scale));
}

function drawFloor(ctx, width, height, floorY) {
  const floor = ctx.createLinearGradient(0, floorY, 0, height);
  floor.addColorStop(0, COLORS.floorTop);
  floor.addColorStop(1, COLORS.floorBottom);
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, width, height - floorY);

  const baseboardHeight = clamp(height * 0.018, 6, 13);
  const baseboard = ctx.createLinearGradient(0, floorY, 0, floorY + baseboardHeight);
  baseboard.addColorStop(0, '#e2cfb1');
  baseboard.addColorStop(0.5, '#d8c2a1');
  baseboard.addColorStop(1, '#caa982');
  ctx.fillStyle = baseboard;
  ctx.fillRect(0, floorY, width, baseboardHeight);

  ctx.strokeStyle = COLORS.woodLine;
  ctx.lineWidth = Math.max(0.7, width * 0.0017);
  const boardRows = [0.12, 0.29, 0.49, 0.72, 0.93];
  for (let index = 0; index < boardRows.length; index++) {
    const y = floorY + baseboardHeight + (height - floorY - baseboardHeight) * boardRows[index];
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    const offset = index % 2 ? width * 0.29 : width * 0.63;
    ctx.beginPath();
    ctx.moveTo(offset, y - (height - floorY) * 0.17);
    ctx.lineTo(offset, y);
    ctx.stroke();
  }

  // A few faint, slightly curved grain marks keep the floor warm without turning it into a pattern.
  ctx.strokeStyle = 'rgba(121, 83, 49, 0.075)';
  ctx.lineWidth = Math.max(0.65, width * 0.0014);
  for (let index = 0; index < 5; index++) {
    const y = floorY + baseboardHeight + (height - floorY) * (0.18 + index * 0.145);
    const start = width * ((index * 0.237) % 0.78);
    const length = width * (0.12 + (index % 3) * 0.035);
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.quadraticCurveTo(start + length * 0.5, y - height * 0.003,
      Math.min(width, start + length), y + height * 0.0016);
    ctx.stroke();
  }
}

function drawRug(ctx, width, height) {
  const centerX = width * 0.5;
  const centerY = height * 0.63;
  const radiusX = width * 0.4;
  const radiusY = height * 0.065;

  ctx.fillStyle = 'rgba(83, 61, 43, 0.13)';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + radiusY * 0.12, radiusX * 1.015, radiusY * 1.07,
    0, 0, Math.PI * 2);
  ctx.fill();

  const rug = ctx.createRadialGradient(centerX - radiusX * 0.14, centerY - radiusY * 0.42,
    radiusY * 0.1, centerX, centerY, radiusX);
  rug.addColorStop(0, '#eee1c9');
  rug.addColorStop(0.72, '#e4d2b5');
  rug.addColorStop(1, '#cfb996');
  ctx.fillStyle = rug;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX * 0.97, radiusY * 0.94, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(137, 105, 70, 0.14)';
  ctx.lineWidth = Math.max(0.6, width * 0.0014);
  for (let x = centerX - radiusX; x <= centerX + radiusX; x += Math.max(7, width * 0.023)) {
    ctx.beginPath();
    ctx.moveTo(x, centerY - radiusY);
    ctx.lineTo(x + radiusY * 0.28, centerY + radiusY);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 249, 236, 0.25)';
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += Math.max(6, height * 0.012)) {
    ctx.beginPath();
    ctx.moveTo(centerX - radiusX, y);
    ctx.lineTo(centerX + radiusX, y - radiusY * 0.05);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(151, 120, 84, 0.3)';
  ctx.lineWidth = Math.max(1, width * 0.003);
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX * 0.93, radiusY * 0.84, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawLivingRoom(ctx, width, height) {
  const floorY = height * 0.43;
  const wall = ctx.createLinearGradient(0, 0, 0, floorY);
  wall.addColorStop(0, COLORS.wallTop);
  wall.addColorStop(1, COLORS.wallBottom);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);

  const wallGlow = ctx.createLinearGradient(0, 0, width, height * 0.34);
  wallGlow.addColorStop(0, 'rgba(255, 252, 241, 0.26)');
  wallGlow.addColorStop(0.6, 'rgba(255, 252, 241, 0.02)');
  wallGlow.addColorStop(1, 'rgba(255, 252, 241, 0)');
  ctx.fillStyle = wallGlow;
  ctx.fillRect(0, 0, width, floorY);

  drawWindow(ctx, width, height, floorY);
  drawFloor(ctx, width, height, floorY);
  drawSofa(ctx, width, height, floorY);
  drawPlant(ctx, width, height, floorY);
  drawRug(ctx, width, height);
}

function drawNonDomFallback(ctx, width, height) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = COLORS.wallTop;
  ctx.fillRect(0, 0, width, height);
  const floorY = height * 0.43;
  ctx.fillStyle = COLORS.floorTop;
  ctx.fillRect(0, floorY, width, height - floorY);
  ctx.restore();
}

function createCanvas() {
  if (typeof globalThis.OffscreenCanvas === 'function') return new globalThis.OffscreenCanvas(1, 1);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return document.createElement('canvas');
  }
  return null;
}

export class RoomBackdrop {
  constructor() {
    this.canvas = null;
    this.context = null;
    this.cacheKey = null;
    this.buildCount = 0;
  }

  draw(ctx, width, height, dpr = 1) {
    if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    const scale = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, MAX_BACKDROP_DPR) : 1;
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(height * scale));

    if (!this.canvas) {
      this.canvas = createCanvas();
      if (!this.canvas) {
        drawNonDomFallback(ctx, width, height);
        return true;
      }
    }

    const key = `${width}:${height}:${scale}:${pixelWidth}:${pixelHeight}`;
    if (key !== this.cacheKey) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.context = this.canvas.getContext('2d', { alpha: false });
      if (!this.context) {
        this.canvas = null;
        this.cacheKey = null;
        drawNonDomFallback(ctx, width, height);
        return true;
      }
      this.context.setTransform(scale, 0, 0, scale, 0, 0);
      drawLivingRoom(this.context, width, height);
      this.cacheKey = key;
      this.buildCount++;
    }

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.canvas, 0, 0, width, height);
    ctx.restore();
    return true;
  }
}
