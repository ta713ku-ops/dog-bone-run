import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildDogModel, DOG_MODEL_LIMITS } from '../src/dog-model.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectRoot, 'art');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.png', 'image/png'],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filePath = resolve(projectRoot, `.${pathname}`);
    if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${sep}`)) throw new Error('Path outside project.');
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': mime.get(extname(filePath)) ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/Users/taku/Library/Caches/ms-playwright';
const playwrightModule = process.env.DOG_PLAYWRIGHT_MODULE ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightModule).href);
await mkdir(outputDir, { recursive: true });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1680 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/scripts/dog-design-sheet.html`);
  await page.waitForFunction(() => Boolean(window.__dogBuildResult));
  const generated = await page.evaluate(() => window.__dogBuildResult);
  const frontPng = Buffer.from(generated.frontAtlasPngBase64, 'base64');
  const backPng = Buffer.from(generated.backAtlasPngBase64, 'base64');
  await writeFile(resolve(outputDir, 'dog-front-atlas.png'), frontPng);
  await writeFile(resolve(outputDir, 'dog-back-atlas.png'), backPng);

  const metadata = { ...generated.metadata, generatedAt: new Date().toISOString() };
  let metadataBuffer = Buffer.alloc(0);
  for (let i = 0; i < 4; i++) {
    metadata.compressedBytes = frontPng.byteLength + backPng.byteLength + metadataBuffer.byteLength;
    metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
  }
  await writeFile(resolve(outputDir, 'dog-atlas.json'), metadataBuffer);
  const runtimeAssetsBytes = frontPng.byteLength + backPng.byteLength + metadataBuffer.byteLength;
  const model = buildDogModel();
  const packedGeometry = Buffer.concat([
    Buffer.from(model.positions.buffer), Buffer.from(model.indices.buffer), Buffer.from(model.vertexGroups.buffer),
    Buffer.from(model.faceMaterials.buffer), Buffer.from(model.faceTones.buffer), Buffer.from(model.faceGroups.buffer),
  ]);
  const compressedGeometryBytes = gzipSync(packedGeometry, { level: 9 }).byteLength;
  const textureSizes = metadata.textureSizes;
  const overBudget = model.triangleCount >= DOG_MODEL_LIMITS.triangles || model.materialCount > DOG_MODEL_LIMITS.materials
    || textureSizes.some(([width, height]) => width > DOG_MODEL_LIMITS.textureSize || height > DOG_MODEL_LIMITS.textureSize)
    || textureSizes.length > DOG_MODEL_LIMITS.textures || runtimeAssetsBytes > DOG_MODEL_LIMITS.compressedBytes;
  if (overBudget) throw new Error(`Dog asset budget exceeded: ${JSON.stringify({ triangles: model.triangleCount, materials: model.materialCount, textureSizes, runtimeAssetsBytes })}`);

  const presentation = await page.evaluate(() => window.__dogRenderPresentation());
  await page.screenshot({ path: resolve(outputDir, 'dog-design-sheet.png'), fullPage: true });
  const report = {
    generatedAt: new Date().toISOString(),
    model: {
      vertices: model.vertexCount, triangles: model.triangleCount, materials: model.materialCount, textures: 0,
      height: model.height, bounds: model.bounds, packedGeometryBytes: packedGeometry.byteLength, compressedGeometryBytes,
      limits: DOG_MODEL_LIMITS,
    },
    runtimeAssets: {
      frontAtlas: { path: 'art/dog-front-atlas.png', bytes: frontPng.byteLength, dimensions: [1024, 1024], poses: ['front idle (2 frames)', 'front finish (2 frames)'] },
      backAtlas: { path: 'art/dog-back-atlas.png', bytes: backPng.byteLength, dimensions: [1024, 1024], poses: ['back idle', 'run (4 frames)', 'lean left', 'lean right', 'collect', 'gold', 'hit', 'fall (3 frames)', 'finish', 'side idle', 'side run'] },
      metadata: { path: 'art/dog-atlas.json', bytes: metadataBuffer.byteLength },
      compressedBytes: runtimeAssetsBytes,
    },
    benchmark: presentation,
    pageErrors,
    note: 'Desktop headless Chromium timing is Canvas 2D command submission only; it does not wait for raster/GPU completion, and target iPhone performance is unmeasured.',
  };
  await writeFile(resolve(outputDir, 'dog-benchmark.json'), JSON.stringify(report, null, 2));
  if (pageErrors.length) throw new Error(`Dog design page errors: ${pageErrors.join('; ')}`);
  console.log(JSON.stringify({ sheet: 'art/dog-design-sheet.png', report: 'art/dog-benchmark.json', ...report }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
