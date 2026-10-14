import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const playwrightModule = process.env.DOG_PLAYWRIGHT_MODULE
  ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium, webkit } = await import(playwrightModule);
const currentUrl = process.env.DOG_WALK_URL;
const baselineUrl = process.env.DOG_BASELINE_URL;
const output = fileURLToPath(new URL('../test-results/walk-v25/', import.meta.url));
const timesMs = [0, 5000, 10_000, 15_000, 20_000, 25_000];
const viewports = {
  chromium: [[320, 568], [390, 844], [430, 932], [1280, 900]],
  webkit: [[320, 568], [390, 844], [430, 932], [1280, 900]],
};
const report = {
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  currentUrl,
  baselineUrl,
  seed: 42,
  timesMs,
  cases: [],
  engineReports: [],
  assets: [],
  pausePixels: [],
  drawBenchmarks: [],
  comparisons: [],
  errors: [],
  limitations: [
    'Playwright Chromium and WebKit on this Mac are browser evidence, not physical iPhone Safari evidence.',
    'The 80-sample draw timing uses frozen Game fixtures at synthetic one-second intervals; it is not an FPS or device-performance claim.',
  ],
};
await mkdir(output, { recursive: true });
const artifact = name => fileURLToPath(new URL(name, new URL('../test-results/walk-v25/', import.meta.url)));
const worlds = [
  { name: 'baseline', url: baselineUrl },
  { name: 'current', url: currentUrl },
];
const normalized = value => String(value).replace(/\/$/, '');
const fixtureStates = new Map();
const projections = new Map();

function roundProjection(value) {
  if (Array.isArray(value)) return value.map(roundProjection);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    typeof item === 'number' ? Math.round(item * 10_000) / 10_000 : roundProjection(item),
  ]));
}

async function createPage(browser, engineName, world, width, height, { failSceneryAssets = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: width < 500,
    hasTouch: width < 500,
  });
  const page = await context.newPage();
  if (engineName === 'webkit') {
    await page.goto('data:text/html,<title>WebKit ready</title>', { timeout: 15_000 });
  }
  page.setDefaultTimeout(25_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const assetResponses = [];
  const assetBodyReads = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    let pathname = '';
    try { pathname = new URL(request.url()).pathname; } catch {}
    if (/\/art\/(?:neighborhood-v24|street-v25)\//.test(pathname)) failedRequests.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown' });
  });
  page.on('response', response => {
    let pathname = '';
    try { pathname = new URL(response.url()).pathname; } catch {}
    if (!/\/art\/(?:neighborhood-v24|street-v25)\//.test(pathname)) return;
    const record = { url: response.url(), status: response.status(), bytes: null, contentLength: response.headers()['content-length'] ?? null };
    assetResponses.push(record);
    assetBodyReads.push((async () => {
      try { record.bytes = (await response.body()).byteLength; }
      catch (error) { record.readError = String(error); }
    })());
  });
  if (failSceneryAssets) {
    await page.route(/\/art\/(?:neighborhood-v24|street-v25)\//, route => route.abort());
  }

  const url = `${normalized(world.url)}/tests/fixtures/walk-preview.html?seed=42&timeMs=5000`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__walkPreview?.ready), null, { timeout: 22_000 });
  const readiness = await page.evaluate(() => window.__walkPreview.ready);
  assert.ok(readiness?.ok, `${world.name} ${engineName} ${width}: preview initialization failed: ${readiness?.error ?? 'no ready result'}`);
  return { context, page, pageErrors, consoleErrors, failedRequests, assetResponses, assetBodyReads, engineName, world, width, height, failSceneryAssets };
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const root = document.querySelector('#game');
    const item = selector => {
      const element = document.querySelector(selector);
      return element ? { visible: element.getClientRects().length > 0, rect: rect(element) } : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: rect(root),
      canvas: rect(document.querySelector('#scene')),
      hud: item('#hud'),
      score: item('.score-box'),
      clock: item('#clock'),
      pause: item('#pause'),
      pauseModalVisible: Boolean(document.querySelector('#paused')),
      gameState: root.dataset.state,
      fixtureState: root.dataset.fixtureState,
    };
  });
}

async function getBrowserAssetStats(testPage) {
  await Promise.allSettled(testPage.assetBodyReads);
  const browserStats = await testPage.page.evaluate(() => window.__walkPreview.assetStats());
  return {
    world: testPage.world.name,
    engine: testPage.engineName,
    viewport: `${testPage.width}x${testPage.height}`,
    browserCapture: browserStats,
    responses: testPage.assetResponses,
    totalResponseBytes: testPage.assetResponses.reduce((sum, item) => sum + (item.bytes ?? (Number(item.contentLength) || 0)), 0),
    failedRequests: testPage.failedRequests,
  };
}

async function validatePageErrors(testPage) {
  assert.deepEqual(testPage.pageErrors, [], `${testPage.world.name} ${testPage.engineName} ${testPage.width}: uncaught page errors`);
  if (!testPage.failSceneryAssets) assert.deepEqual(testPage.consoleErrors, [], `${testPage.world.name} ${testPage.engineName} ${testPage.width}: console errors`);
}

let failure = null;
try {
  assert.ok(currentUrl, 'DOG_WALK_URL must point at the current development server.');
  assert.ok(baselineUrl, 'DOG_BASELINE_URL must point at the copied baseline compositor.');

  for (const engine of [chromium, webkit]) {
    const engineName = engine.name();
    const browser = await engine.launch({ headless: true });
    try {
      for (const world of worlds) {
        for (const [width, height] of viewports[engineName]) {
          console.log(`walk visual: ${world.name} ${engineName} ${width}x${height}`);
          const testPage = await createPage(browser, engineName, world, width, height);
          try {
            const layout = await inspectLayout(testPage.page);
            assert.equal(layout.gameState, 'running');
            assert.equal(layout.fixtureState, 'paused');
            assert.equal(layout.pauseModalVisible, false, 'The developer compositor must not show the production pause modal.');
            assert.ok(layout.pause.visible && layout.pause.rect.width >= 44 && layout.pause.rect.height >= 44, JSON.stringify(layout.pause));
            assert.ok(layout.canvas.width > 0 && layout.canvas.height > 0);
            assert.ok(layout.root.left >= -1 && layout.root.right <= width + 1, JSON.stringify(layout));
            assert.ok(layout.root.top >= -1 && layout.root.bottom <= height + 1, JSON.stringify(layout));

            for (const timeMs of timesMs) {
              const diagnostic = await testPage.page.evaluate(({ timeMs, seed }) => window.__walkPreview.setFixture(timeMs, seed), { timeMs, seed: 42 });
              assert.equal(diagnostic.fixture.timeMs, timeMs);
              assert.equal(diagnostic.fixture.seed, 42);
              assert.equal(diagnostic.fixture.phase, 4);
              assert.equal(diagnostic.fixture.state, 'paused');
              assert.equal(diagnostic.fixture.pausedFrom, 'running');
              assert.equal(diagnostic.game.timeMs, timeMs, 'Game.advance must stop at the requested timestamp.');
              assert.equal(diagnostic.game.distance, timeMs / 1000);
              assert.equal(diagnostic.game.endReason, null);
              assert.equal(diagnostic.hud.score, String(diagnostic.game.score));
              assert.equal(Number(diagnostic.hud.remainingSeconds), Math.ceil((30_000 - timeMs) / 1000));
              assert.equal(diagnostic.hud.controlHintVisible, timeMs < 2200);
              assert.equal(diagnostic.hud.pauseLabel, '一時停止');
              assert.equal(diagnostic.counts.obstacleContacts, 0, 'The fixture route must avoid hazards.');
              assert.equal(diagnostic.counts.missedBones, 0, 'The fixture route must collect the placed bone route.');
              assert.ok(diagnostic.renderer.dog?.ready, 'The actual production dog renderer must be decoded before capture.');
              assert.ok(diagnostic.renderer.width > 0 && diagnostic.renderer.height > 0);
              assert.ok(diagnostic.renderer.canvasWidth > 0 && diagnostic.renderer.canvasHeight > 0);
              assert.ok(diagnostic.projection.visibleBones.length > 0, 'At least one actual bone should be visible in the scene.');
              assert.ok(diagnostic.projection.dog && Number.isFinite(diagnostic.projection.dog.x));
              assert.ok(diagnostic.counts.bones > 0 && diagnostic.counts.obstacles > 0);

              const pixels = await testPage.page.evaluate(() => window.__walkPreview.canvasPixels());
              assert.ok(pixels.opaquePixels > pixels.width * pixels.height * .8, 'The compositor should render a populated scene.');
              const framePath = `./${world.name}/${engineName}-${width}x${height}-${String(timeMs / 1000).padStart(2, '0')}s.png`;
              await mkdir(artifact(world.name), { recursive: true });
              await testPage.page.locator('#game').screenshot({ path: artifact(framePath) });

              const key = `${engineName}:${width}x${height}:${timeMs}`;
              const state = diagnostic.game;
              const projection = roundProjection(diagnostic.projection);
              if (world.name === 'baseline') {
                fixtureStates.set(key, state);
                projections.set(key, projection);
              } else {
                const withoutTypes = value => ({ ...value, obstacles: [], contract: { ...value.contract, stages: value.contract.stages.map(({holeChance,...stage}) => stage) } });
                assert.deepEqual(withoutTypes(state), withoutTypes(fixtureStates.get(key)), `Gameplay state changed at ${key}.`);
                const withoutVisualTypes = value => ({ ...value, visibleObstacles: [] });
                assert.deepEqual(withoutVisualTypes(projection), withoutVisualTypes(projections.get(key)), `Projection changed at ${key}.`);
                report.comparisons.push({ key, boneRouteStateEqual: true, boneProjectedGeometryEqual: true });
              }

              const record = {
                world: world.name,
                engine: engineName,
                viewport: `${width}x${height}`,
                timeMs,
                screenshot: framePath,
                game: {
                  state: diagnostic.game.state,
                  timeMs: diagnostic.game.timeMs,
                  lane: diagnostic.game.lane,
                  score: diagnostic.game.score,
                  collected: diagnostic.game.collected,
                  placed: diagnostic.counts.bones,
                  obstacles: diagnostic.counts.obstacles,
                  level: diagnostic.game.difficultyLevel,
                },
                projection: diagnostic.projection,
                canvas: pixels,
                layout,
                routeCommands: diagnostic.fixture.routeCommands.length,
              };
              report.cases.push(record);

              if (timeMs === 5000) {
                const before = pixels;
                const after = await testPage.page.evaluate(async () => {
                  const preview = window.__walkPreview;
                  for (let count = 0; count < 8; count++) {
                    preview.renderer.draw(preview.game);
                    await new Promise(resolve => requestAnimationFrame(resolve));
                  }
                  return preview.canvasPixels();
                });
                assert.deepEqual(after, before, 'A paused static fixture must keep its canvas pixels unchanged while redrawing.');
                report.pausePixels.push({ world: world.name, engine: engineName, viewport: `${width}x${height}`, before, after, identical: true });
              }
            }

            if (world.name === 'current') {
              const assets = await getBrowserAssetStats(testPage);
              report.assets.push(assets);
              if (width === 390) {
                const benchmark = await testPage.page.evaluate(() => window.__walkPreview.runDrawBenchmark(80, 1000));
                report.drawBenchmarks.push({ world: world.name, engine: engineName, viewport: `${width}x${height}`, ...benchmark });
              }
            }
            await validatePageErrors(testPage);
          } finally {
            await testPage.context.close();
          }
        }
      }

      // Abort only the newly generated residential art and verify its runtime fallback
      // still renders a usable scene with the real dog and gameplay entities.
      const fallbackPage = await createPage(browser, engineName, worlds[1], 390, 844, { failSceneryAssets: true });
      try {
        const diagnostic = await fallbackPage.page.evaluate(() => window.__walkPreview.diagnostics());
        assert.equal(diagnostic.fixture.timeMs, 5000);
        assert.equal(diagnostic.fixture.state, 'paused');
        assert.equal(diagnostic.counts.obstacleContacts, 0);
        assert.ok(diagnostic.renderer.dog?.ready);
        assert.ok(diagnostic.projection.visibleBones.length > 0);
        assert.ok(fallbackPage.failedRequests.length > 0, 'The residential asset route should exercise the fallback path.');
        const pixels = await fallbackPage.page.evaluate(() => window.__walkPreview.canvasPixels());
        assert.ok(pixels.opaquePixels > pixels.width * pixels.height * .8);
        await fallbackPage.page.locator('#game').screenshot({ path: artifact(`current/${engineName}-390x844-05s-assets-failed.png`) });
        report.assets.push(await getBrowserAssetStats(fallbackPage));
        report.engineReports.push({ engine: engineName, sceneryArtFailureFallback: true, failedRequests: fallbackPage.failedRequests.length, renderedPixels: pixels });
        await validatePageErrors(fallbackPage);
      } finally {
        await fallbackPage.context.close();
      }
    } finally {
      await browser.close();
    }
  }

  const expectedComparisons = Object.values(viewports).reduce((sum, widths) => sum + widths.length * timesMs.length, 0);
  assert.equal(report.comparisons.length, expectedComparisons, 'Every baseline/current fixture should match in gameplay state and projection.');
  const currentSceneryStats = report.assets.filter(item => item.world === 'current' && !item.failedRequests.length);
  assert.ok(currentSceneryStats.some(item => item.browserCapture.totalFetchedBytes > 0 || item.totalResponseBytes > 0), 'The current runtime should load measurable v0.25 residential art.');
  assert.ok(currentSceneryStats.some(item => item.browserCapture.totalImageRgbaEstimate > 0), 'The current runtime should report decoded image dimensions and estimated RGBA bytes.');
  assert.equal(report.drawBenchmarks.every(item => item.frames === 80 && item.simulatedStepMs === 1000), true);
  report.status = 'PASS';
} catch (error) {
  failure = error;
  report.status = 'FAIL';
  report.errors.push({ message: error.message, stack: error.stack });
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(artifact('report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, comparisons: report.comparisons.length, assets: report.assets.length, drawBenchmarks: report.drawBenchmarks, report: artifact('report.json') }, null, 2));
}
if (failure) throw failure;
