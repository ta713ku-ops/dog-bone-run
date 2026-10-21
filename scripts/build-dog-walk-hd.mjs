import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const SOURCE_PATH = 'art/source/dog-walk-v1.png';
const ATLAS_PATH = 'art/dog-walk-hd.png';
const METADATA_PATH = 'art/dog-walk-hd.json';
const CELL = 512;
const REFERENCE_HEIGHT = 416;
const STRIDE_LENGTH = 0.78;
const FRAME_COUNT = 8;
const PIXEL_LIMIT = 20_000_000;
const COMPRESSED_LIMIT = 2_500_000;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function decodeRgbaPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('Walk source is not PNG.');
  let width, height, bitDepth, colorType, interlace;
  const compressed = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0 || width * height > PIXEL_LIMIT) {
    throw new Error(`Unsupported walk PNG layout: ${width}x${height}, depth ${bitDepth}, type ${colorType}, interlace ${interlace}.`);
  }
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(compressed));
  if (raw.length !== height * (stride + 1)) throw new Error('Walk PNG pixel data has an unexpected length.');
  const pixels = Buffer.allocUnsafe(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[input++], row = y * stride, previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[input++];
      const left = x >= 4 ? pixels[row + x - 4] : 0;
      const above = y > 0 ? pixels[previous + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[previous + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG row filter ${filter}.`);
      pixels[row + x] = (value + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function findSilhouettes({ width, height, pixels }) {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  const found = [];
  for (let start = 0; start < count; start += 1) {
    if (seen[start] || pixels[start * 4 + 3] < 12) continue;
    let head = 0, tail = 0, area = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (seen[next] || pixels[next * 4 + 3] < 12) continue;
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (area > 2_000) found.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, count: area });
  }
  if (found.length < FRAME_COUNT) throw new Error(`Expected ${FRAME_COUNT} walk poses, found ${found.length}.`);
  found.sort((a, b) => b.count - a.count);
  const byRow = found.slice(0, FRAME_COUNT).sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2);
  const ordered = [];
  for (let row = 0; row < 2; row += 1) {
    ordered.push(...byRow.slice(row * 4, row * 4 + 4).sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2));
  }
  return ordered;
}

function weightedFootAnchorX(pixels, width, bounds) {
  let mass = 0, sum = 0;
  const firstY = Math.floor(bounds.y + bounds.height * 0.02);
  const lastY = Math.min(bounds.y + bounds.height, Math.ceil(bounds.y + bounds.height * 0.25));
  for (let y = firstY; y < lastY; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      mass += alpha;
      sum += alpha * x;
    }
  }
  return mass ? sum / mass : bounds.x + bounds.width / 2;
}

const sinc = value => Math.abs(value) < 1e-8 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
function lanczos(value) {
  const distance = Math.abs(value);
  return distance < 3 ? sinc(value) * sinc(value / 3) : 0;
}

function resampleCrop(source, destination, bounds, target, scale) {
  const sx = Math.max(0, bounds.x - 2), sy = Math.max(0, bounds.y - 2);
  const sw = Math.min(source.width - sx, bounds.width + 4), sh = Math.min(source.height - sy, bounds.height + 4);
  const anchor = weightedFootAnchorX(source.pixels, source.width, bounds);
  const dx = target.x + CELL / 2 + (bounds.x - anchor) * scale + (sx - bounds.x) * scale;
  const dy = target.y + CELL - 24 - bounds.height * scale + (sy - bounds.y) * scale;
  const dw = sw * scale, dh = sh * scale;
  const firstX = Math.floor(dx), lastX = Math.ceil(dx + dw);
  const firstY = Math.floor(dy), lastY = Math.ceil(dy + dh);
  const filterScale = Math.min(1, scale), radius = 3 / filterScale;
  for (let outputY = firstY; outputY < lastY; outputY += 1) {
    const sourceY = sy + (outputY + 0.5 - dy) / scale - 0.5;
    const minY = Math.max(sy, Math.floor(sourceY - radius + 1));
    const maxY = Math.min(sy + sh - 1, Math.ceil(sourceY + radius - 1));
    for (let outputX = firstX; outputX < lastX; outputX += 1) {
      const sourceX = sx + (outputX + 0.5 - dx) / scale - 0.5;
      const minX = Math.max(sx, Math.floor(sourceX - radius + 1));
      const maxX = Math.min(sx + sw - 1, Math.ceil(sourceX + radius - 1));
      let weightTotal = 0, alphaTotal = 0, redTotal = 0, greenTotal = 0, blueTotal = 0;
      for (let iy = minY; iy <= maxY; iy += 1) {
        const wy = lanczos((iy - sourceY) * filterScale);
        for (let ix = minX; ix <= maxX; ix += 1) {
          const weight = wy * lanczos((ix - sourceX) * filterScale);
          const index = (iy * source.width + ix) * 4;
          const alpha = source.pixels[index + 3] / 255;
          weightTotal += weight;
          alphaTotal += alpha * weight;
          redTotal += source.pixels[index] * alpha * weight;
          greenTotal += source.pixels[index + 1] * alpha * weight;
          blueTotal += source.pixels[index + 2] * alpha * weight;
        }
      }
      if (Math.abs(weightTotal) < 1e-8) continue;
      const alpha = Math.max(0, Math.min(1, alphaTotal / weightTotal));
      if (alpha < 1 / 255) continue;
      const outputIndex = (outputY * (CELL * 4) + outputX) * 4;
      destination[outputIndex] = Math.round(Math.max(0, Math.min(255, redTotal / alphaTotal)));
      destination[outputIndex + 1] = Math.round(Math.max(0, Math.min(255, greenTotal / alphaTotal)));
      destination[outputIndex + 2] = Math.round(Math.max(0, Math.min(255, blueTotal / alphaTotal)));
      destination[outputIndex + 3] = Math.round(alpha * 255);
    }
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.allocUnsafe(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return output;
}
function encodeRgbaPng(width, height, pixels) {
  const rowBytes = width * 4;
  const scanlines = Buffer.allocUnsafe(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const destination = y * (rowBytes + 1);
    scanlines[destination] = 0;
    pixels.copy(scanlines, destination + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const sourceBytes = await readFile(SOURCE_PATH);
const source = decodeRgbaPng(sourceBytes);
const bounds = findSilhouettes(source);
const sourceRef = [...bounds.map(frame => frame.height)].sort((a, b) => a - b)[Math.floor(FRAME_COUNT / 2)];
const scale = REFERENCE_HEIGHT / sourceRef;
const atlasWidth = CELL * 4, atlasHeight = CELL * 2;
const atlasPixels = Buffer.alloc(atlasWidth * atlasHeight * 4);
const frames = [];
for (let index = 0; index < bounds.length; index += 1) {
  const frame = bounds[index], col = index % 4, row = Math.floor(index / 4);
  const cell = { x: col * CELL, y: row * CELL };
  resampleCrop(source, atlasPixels, frame, cell, scale);
  frames.push({
    ...cell, width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL - 24,
    referenceHeight: REFERENCE_HEIGHT, sourceBounds: frame,
  });
}
let transparentPixels = 0, edgeOpaque = 0;
for (let y = 0; y < atlasHeight; y += 1) {
  for (let x = 0; x < atlasWidth; x += 1) {
    const alpha = atlasPixels[(y * atlasWidth + x) * 4 + 3];
    if (alpha === 0) transparentPixels += 1;
    if ((x % CELL === 0 || y % CELL === 0) && alpha > 32) edgeOpaque += 1;
  }
}
if (edgeOpaque) throw new Error(`High-resolution walk cells overlap at ${edgeOpaque} grid pixels.`);

const atlasBytes = encodeRgbaPng(atlasWidth, atlasHeight, atlasPixels);
if (atlasBytes.length > COMPRESSED_LIMIT) throw new Error(`Walk atlas is ${atlasBytes.length} bytes; limit is ${COMPRESSED_LIMIT}.`);
await writeFile(ATLAS_PATH, atlasBytes);
const scriptBytes = await readFile(new URL(import.meta.url));
const metadata = {
  version: 1,
  mode: 'authored-walk-animation-hd',
  strideLength: STRIDE_LENGTH,
  atlases: {
    walk: {
      key: 'walk', width: atlasWidth, height: atlasHeight, cell: CELL, frames,
      referenceHeight: REFERENCE_HEIGHT, sourceRef,
      transparentFraction: transparentPixels / (atlasWidth * atlasHeight), edgeOpaque,
      path: ATLAS_PATH, bytes: atlasBytes.length, sha256: sha256(atlasBytes),
    },
  },
  sourceSheets: {
    walk: { path: SOURCE_PATH, width: source.width, height: source.height, sha256: sha256(sourceBytes) },
  },
  generator: { path: 'scripts/build-dog-walk-hd.mjs', sha256: sha256(scriptBytes) },
  textureBytes: atlasWidth * atlasHeight * 4,
  compressedBytes: atlasBytes.length,
};
await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({
  source: `${source.width}x${source.height}`,
  atlas: `${atlasWidth}x${atlasHeight}`,
  frameCount: frames.length,
  sourceRef,
  referenceHeight: REFERENCE_HEIGHT,
  compressedBytes: atlasBytes.length,
  decodedBytes: metadata.textureBytes,
}, null, 2));
