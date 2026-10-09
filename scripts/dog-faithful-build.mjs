import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artDir = resolve(projectRoot, 'art');
const sourceFiles = {
  front: resolve(artDir, 'source/dog-faithful-front-source.png'),
  back: resolve(artDir, 'source/dog-faithful-back-source.png'),
};
const outputFiles = {
  front: resolve(artDir, 'dog-faithful-front.png'),
  back: resolve(artDir, 'dog-faithful-back.png'),
  metadata: resolve(artDir, 'dog-faithful-atlas.json'),
};
const maxRuntimeBytes = 3_000_000;

const { chromium } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const sources = Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async ([key, path]) => {
  const bytes = await readFile(path);
  return [key, { path: `art/source/${path.split('/').at(-1)}`, bytes: bytes.toString('base64'), byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }];
})));

const browser = await chromium.launch({ headless: true });
let generated;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><canvas></canvas>');
  generated = await page.evaluate(async source => {
    async function loadPng(base64) {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      if (image.naturalWidth !== image.naturalHeight || image.naturalWidth !== 1254) {
        throw new Error(`Unexpected source sheet size ${image.naturalWidth}x${image.naturalHeight}`);
      }
      return image;
    }

    function boundsForCell(ctx, cellX, cellY, cellSize) {
      const rgba = ctx.getImageData(cellX, cellY, cellSize, cellSize).data;
      const total = cellSize * cellSize, visited = new Uint8Array(total), queue = new Int32Array(total);
      let bound = null;
      for (let start = 0; start < total; start++) {
        if (visited[start] || rgba[start * 4 + 3] <= 8) continue;
        let head = 0, tail = 0, count = 0;
        queue[tail++] = start; visited[start] = 1;
        let minX = start % cellSize, maxX = minX, minY = (start / cellSize) | 0, maxY = minY;
        while (head < tail) {
          const index = queue[head++], x = index % cellSize, y = (index / cellSize) | 0; count++;
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= cellSize || ny < 0 || ny >= cellSize) continue;
            const next = ny * cellSize + nx;
            if (visited[next] || rgba[next * 4 + 3] <= 8) continue;
            visited[next] = 1; queue[tail++] = next;
          }
        }
        // Isolated pixels outside the connected dog silhouette do not define its crop.
        if (count < 16) continue;
        if (!bound) bound = { minX, minY, maxX, maxY, componentPixels: count };
        else {
          bound.minX = Math.min(bound.minX, minX); bound.minY = Math.min(bound.minY, minY);
          bound.maxX = Math.max(bound.maxX, maxX); bound.maxY = Math.max(bound.maxY, maxY);
          bound.componentPixels += count;
        }
      }
      if (!bound) throw new Error(`No opaque silhouette found in cell ${cellX},${cellY}`);
      const width = bound.maxX - bound.minX + 1, height = bound.maxY - bound.minY + 1;
      const footBandStart = Math.floor(bound.minY + height * 0.85);
      let footAlpha = 0, footWeightedX = 0;
      for (let y = footBandStart; y <= bound.maxY; y++) for (let x = bound.minX; x <= bound.maxX; x++) {
        const alpha = rgba[(y * cellSize + x) * 4 + 3];
        if (alpha === 0) continue;
        footAlpha += alpha;
        footWeightedX += (x - bound.minX) * alpha;
      }
      const anchorX = footAlpha > 0 ? footWeightedX / footAlpha : width / 2;
      return { x: bound.minX, y: bound.minY, width, height, anchorX, componentPixels: bound.componentPixels };
    }

    async function normalize(image, cellsPerSide) {
      const output = document.createElement('canvas'); output.width = output.height = 1024;
      const ctx = output.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const sourceCell = image.naturalWidth / cellsPerSide, targetCell = 1024 / cellsPerSide, bounds = [];
      for (let row = 0; row < cellsPerSide; row++) for (let col = 0; col < cellsPerSide; col++) {
        const sourceX = col * sourceCell, sourceY = row * sourceCell, targetX = col * targetCell, targetY = row * targetCell;
        ctx.drawImage(image, sourceX, sourceY, sourceCell, sourceCell, targetX, targetY, targetCell, targetCell);
        bounds.push({ row, col, cellX: targetX, cellY: targetY, ...boundsForCell(ctx, targetX, targetY, targetCell) });
      }
      return { png: output.toDataURL('image/png').split(',')[1], bounds, cellSize: targetCell };
    }

    const [frontImage, backImage] = await Promise.all([loadPng(source.front.bytes), loadPng(source.back.bytes)]);
    const front = await normalize(frontImage, 2), back = await normalize(backImage, 4);
    const preview = document.createElement('canvas'); preview.width = 2048; preview.height = 1024;
    const previewCtx = preview.getContext('2d'); previewCtx.fillStyle = '#fff6e8'; previewCtx.fillRect(0, 0, preview.width, preview.height);
    const decodeBase64 = async base64 => { const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode(); return img; };
    const [frontAtlas, backAtlas] = await Promise.all([decodeBase64(front.png), decodeBase64(back.png)]);
    previewCtx.drawImage(frontAtlas, 0, 0); previewCtx.drawImage(backAtlas, 1024, 0);

    function frame(atlas, cellSize, cell) {
      return {
        atlas, x: cell.col * cellSize + cell.x, y: cell.row * cellSize + cell.y,
        width: cell.width, height: cell.height, anchorX: cell.anchorX, cell: [cell.row, cell.col],
      };
    }
    const frontCell = (row, col) => front.bounds[row * 2 + col];
    const backCell = (row, col) => back.bounds[row * 4 + col];
    const poses = {
      front: {
        idle: { durationMs: 900, loop: true, frames: [frame('front', 512, frontCell(0, 0)), frame('front', 512, frontCell(0, 1))] },
        finish: { durationMs: 800, loop: true, frames: [frame('front', 512, frontCell(1, 0)), frame('front', 512, frontCell(1, 1))] },
      },
      back: {
        idle: frame('back', 256, backCell(0, 0)),
        run: { durationMs: 500, loop: true, frames: [backCell(0, 1), backCell(0, 2), backCell(0, 3), backCell(1, 0)].map(cell => frame('back', 256, cell)) },
        leanLeft: frame('back', 256, backCell(1, 1)),
        leanRight: frame('back', 256, backCell(1, 2)),
        collect: frame('back', 256, backCell(1, 3)),
        gold: frame('back', 256, backCell(2, 0)),
        hit: frame('back', 256, backCell(2, 1)),
        fall: { durationMs: 650, loop: false, frames: [backCell(2, 2), backCell(2, 3), backCell(3, 0)].map(cell => frame('back', 256, cell)) },
        finish: frame('back', 256, backCell(3, 1)),
      },
      side: {
        idle: frame('back', 256, backCell(3, 2)),
        run: frame('back', 256, backCell(3, 3)),
      },
    };
    return {
      front: front.png, back: back.png, poses,
      bounds: { front: front.bounds, back: back.bounds },
      cellSizes: { front: front.cellSize, back: back.cellSize },
      preview: preview.toDataURL('image/png').split(',')[1],
    };
  }, sources);
} finally {
  await browser.close();
}

const frontPng = Buffer.from(generated.front, 'base64'), backPng = Buffer.from(generated.back, 'base64');
await writeFile(outputFiles.front, frontPng);
await writeFile(outputFiles.back, backPng);
await writeFile(resolve(artDir, 'dog-faithful-atlas-preview.png'), Buffer.from(generated.preview, 'base64'));
const metadata = {
  version: 2, mode: 'photo-reference-sprites', triangleCount: 0, materials: 0,
  textureSizes: [[1024, 1024], [1024, 1024]], textureCount: 2,
  poses: generated.poses,
  sourceSheets: Object.fromEntries(Object.entries(sources).map(([name, item]) => [name, { path: item.path, sha256: item.sha256, dimensions: [1254, 1254] }])),
};
let metadataBytes = Buffer.alloc(0);
for (let i = 0; i < 4; i++) {
  metadata.compressedBytes = frontPng.byteLength + backPng.byteLength + metadataBytes.byteLength;
  metadataBytes = Buffer.from(JSON.stringify(metadata, null, 2));
}
const runtimeBytes = frontPng.byteLength + backPng.byteLength + metadataBytes.byteLength;
if (runtimeBytes > maxRuntimeBytes) throw new Error(`Faithful sprite assets exceed 3MB: ${runtimeBytes} bytes.`);
await writeFile(outputFiles.metadata, metadataBytes);
const report = {
  runtime: {
    front: { path: 'art/dog-faithful-front.png', dimensions: [1024, 1024], bytes: frontPng.byteLength },
    back: { path: 'art/dog-faithful-back.png', dimensions: [1024, 1024], bytes: backPng.byteLength },
    metadata: { path: 'art/dog-faithful-atlas.json', bytes: metadataBytes.byteLength },
    compressedBytes: runtimeBytes, limitBytes: maxRuntimeBytes,
  },
  sourceSheets: Object.fromEntries(Object.entries(sources).map(([name, item]) => [name, { path: item.path, bytes: item.byteLength, sha256: item.sha256 }])),
  cells: { sourceDimensions: [1254, 1254], frontNormalizedCell: 512, backNormalizedCell: 256, measuredBounds: generated.bounds },
  poseCells: { front: 'idle row 0; finish row 1; two frames each', back: 'row-major: idle; run x4; lean left/right; collect; gold; hit; fall x3; finish; side idle/run' },
};
await writeFile(resolve(artDir, 'dog-faithful-build-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
