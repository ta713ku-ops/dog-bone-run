import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4183';
const modes = ['standard', 'modest', 'minimal'];
const viewports = [[320, 568], [390, 844], [430, 932], [1280, 900]];
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const artifact = fileURLToPath(new URL('road-comfort-browser-results.json', output));
const pageErrors = [];
const moduleResponses = [];
const cases = [];

async function openFixture(browser, engine, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(`${engine} ${width}x${height}: ${error.message}`));
  page.on('response', response => {
    if (/\/src\/(?:render|game|adventure-scene|road-comfort)\.js(?:\?|$)/.test(response.url())) {
      moduleResponses.push({ engine, width, height, url: response.url(), status: response.status() });
    }
  });
  await page.goto(`${base}/?test=1&phase=4&seed=731&v=${encodeURIComponent(CONFIG.buildVersion)}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async version => {
    const moduleUrl = name => `${location.origin}/src/${name}.js?v=${encodeURIComponent(version)}`;
    const [{ Renderer }, { Game }, { AdventureScene }] = await Promise.all([
      import(moduleUrl('render')),
      import(moduleUrl('game')),
      import(moduleUrl('adventure-scene')),
      import(moduleUrl('road-comfort')),
    ]);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', display: 'block', width: '100vw', height: '100vh',
      zIndex: '9999', pointerEvents: 'none',
    });
    document.body.append(canvas);
    const renderer = new Renderer(canvas, { useSprites: false, useLiveDog: false });
    renderer.adventure = new AdventureScene();
    renderer.resize();
    const game = new Game({ phase: 4, seed: 731 });
    game.bones = [];
    game.obstacles = [];
    window.__roadComfortBrowserFixture = { canvas, renderer, game };
  }, CONFIG.buildVersion);
  const dimensions = await page.evaluate(() => {
    const { canvas, renderer } = window.__roadComfortBrowserFixture;
    return { css: [renderer.width, renderer.height], bounds: canvas.getBoundingClientRect().toJSON(), backing: [canvas.width, canvas.height] };
  });
  assert.ok(Math.abs(dimensions.css[0]-width)<.02&&Math.abs(dimensions.css[1]-height)<.02,`${engine} fixture must use the requested CSS viewport (within WebKit layout rounding)`);
  assert.deepEqual([dimensions.bounds.width, dimensions.bounds.height], dimensions.css);
  return { context, page };
}

async function exercise(page, engine, width, height, mode) {
  const result = await page.evaluate(mode => {
    const { canvas, renderer, game } = window.__roadComfortBrowserFixture;
    renderer.setRoadDecoration(mode);
    game.reset({ seed: 731 });
    game.bones = [];
    game.obstacles = [];
    renderer.draw(game); // Close the previous attempt before reusing the same seed.
    game.start();

    const frames = [];
    const capture = label => {
      renderer.draw(game);
      const metrics = renderer.comfortMetrics;
      const units = metrics.observedUnits.map(unit => ({
        objectId: unit.objectId,
        generation: unit.generation,
        category: unit.category,
        bounds: { ...unit.bounds },
        alpha: unit.alpha,
        lineId: unit.lineId ?? null,
      }));
      const dprX = canvas.width / renderer.width, dprY = canvas.height / renderer.height;
      const pixel = (x, y) => {
        const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * dprX)));
        const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * dprY)));
        return [...renderer.ctx.getImageData(px, py, 1, 1).data].slice(0, 3);
      };
      const luminance = rgb => {
        const linear = value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        };
        return .2126 * linear(rgb[0]) + .7152 * linear(rgb[1]) + .0722 * linear(rgb[2]);
      };
      const lineSamples = units.filter(unit => unit.category === 'road_cross_line').map(unit => {
        const { left, top, right, bottom } = unit.bounds;
        const y = (top + bottom) / 2;
        const candidates = [.12, .88].map(fraction => {
          const x = left + (right - left) * fraction;
          const line = pixel(x, y);
          const backgroundY = y + 5 < renderer.height ? y + 5 : y - 5;
          const background = pixel(x, backgroundY);
          return { delta: Math.abs(luminance(line) - luminance(background)), line, background };
        });
        return { objectId: unit.objectId, generation: unit.generation, maxLocalDelta: Math.max(...candidates.map(sample => sample.delta)) };
      });
      frames.push({
        label,
        timeMs: game.timeMs,
        distance: game.distance,
        generation: renderer.roadGeneration,
        referenceY: metrics.referenceY,
        crossLinesBottom40: metrics.crossLinesBottom40,
        decorativeObjectsBottom40: metrics.decorativeObjectsBottom40,
        crossingsPerSecond: metrics.crossingsPerSecond,
        windowReady: metrics.windowReady,
        crossedLines: metrics.crossedLines.map(event => ({ ...event })),
        units,
        lineSamples,
      });
      return frames.at(-1);
    };

    capture('start');
    for (let frame = 1; frame <= 3; frame++) {
      game.advance(500);
      capture(`active-${frame}`);
    }
    game.advance(8500);capture('woodland');
    for(let frame=1;frame<=3;frame++){game.advance(500);capture(`woodland-${frame}`);}
    game.advance(9500);capture('creek');
    for(let frame=1;frame<=3;frame++){game.advance(500);capture(`creek-${frame}`);}
    const runningGeneration = renderer.roadGeneration;
    const beforePause = { timeMs: game.timeMs, distance: game.distance };
    game.pause('manual');
    game.advance(2_000);
    const paused = capture('paused');
    const unchangedWhilePaused = game.timeMs === beforePause.timeMs && game.distance === beforePause.distance;
    game.resume();
    game.advance(500);
    const resumed = capture('resumed');
    const pausedObservation = { unchangedWhilePaused, runningGeneration, pausedGeneration: paused.generation,
      resumedGeneration: resumed.generation, pauseCrossings: paused.crossedLines, resumeCrossings: resumed.crossedLines };
    return {
      mode,
      cssSize: [renderer.width, renderer.height],
      visualSeed: renderer.visualSeed,
      roadRunKey: renderer.roadRunKey,
      frames,
      pausedObservation,
      finalPixelsOpaque: renderer.ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] === 255,
    };
  }, mode);

  for (const frame of result.frames) {
    assert.ok(frame.crossLinesBottom40 <= 2, `${engine} ${width}x${height} ${mode} ${frame.label}: ${frame.crossLinesBottom40} lines`);
    assert.ok(frame.decorativeObjectsBottom40 <= 8, `${engine} ${width}x${height} ${mode} ${frame.label}: ${frame.decorativeObjectsBottom40} other units`);
    assert.ok(Math.abs(frame.referenceY - height * .6) < .02, `${engine} ${width}x${height}: reference y should be 60% CSS height`);
    for (const unit of frame.units) {
      assert.equal(typeof unit.objectId, 'string');
      assert.ok(unit.objectId.length > 0);
      assert.equal(unit.generation, frame.generation);
      assert.ok(['road_cross_line', 'road_texture', 'road_stone', 'road_grass', 'road_flower', 'road_fence', 'road_landmark'].includes(unit.category));
      assert.ok(unit.bounds.left >= 0 && unit.bounds.top >= 0);
      assert.ok(unit.bounds.right <= width && unit.bounds.bottom <= height);
      assert.ok(unit.bounds.right > unit.bounds.left && unit.bounds.bottom > unit.bounds.top);
    }
    for (const sample of frame.lineSamples) {
      assert.ok(sample.maxLocalDelta <= .15 + 1 / 255, `${engine} ${width}x${height} ${mode} ${sample.objectId} rendered luminance delta=${sample.maxLocalDelta}`);
    }
  }
  assert.ok(result.finalPixelsOpaque, `${engine} ${width}x${height} ${mode}: actual Canvas should contain rendered pixels`);
  assert.ok(result.frames.at(-3).windowReady, `${engine} ${width}x${height} ${mode}: active one-second crossing window should be ready`);
  assert.ok(Number.isFinite(result.frames.at(-3).crossingsPerSecond), `${engine} ${width}x${height} ${mode}: crossing rate should be measured`);
  assert.ok(result.frames.at(-3).crossingsPerSecond <= 2, `${engine} ${width}x${height} ${mode}: measured crossings/s cap`);
  assert.equal(result.pausedObservation.unchangedWhilePaused, true, `${engine} ${width}x${height} ${mode}: Game clock and distance freeze on pause`);
  assert.equal(result.pausedObservation.pausedGeneration, result.pausedObservation.runningGeneration);
  assert.equal(result.pausedObservation.resumedGeneration, result.pausedObservation.runningGeneration);
  assert.deepEqual(result.pausedObservation.pauseCrossings, [], 'paused frames cannot create road crossings');
  assert.deepEqual(result.pausedObservation.resumeCrossings, [], 'resume starts a fresh trajectory segment');
  const activeLines = result.frames.flatMap(frame => frame.lineSamples);
  if (mode === 'standard') assert.ok(activeLines.length > 0, `${engine} ${width}x${height} ${mode}: actual road-line pixels were observed`);
  cases.push({ engine, width, height, ...result,
    observedLineSampleCount: result.frames.reduce((total, frame) => total + frame.lineSamples.length, 0),
    maxRenderedLuminanceDelta: Math.max(0, ...result.frames.flatMap(frame => frame.lineSamples.map(sample => sample.maxLocalDelta))),
  });
}

for (const engineType of [chromium, webkit]) {
  const browser = await engineType.launch({ headless: true });
  try {
    for (const [width, height] of viewports) {
      const { context, page } = await openFixture(browser, engineType.name(), width, height);
      for (const mode of modes) await exercise(page, engineType.name(), width, height, mode);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

assert.deepEqual(pageErrors, []);
assert.ok(moduleResponses.length >= 8, `expected production module responses, got ${moduleResponses.length}`);
for (const response of moduleResponses) {
  assert.equal(response.status, 200, response.url);
  assert.equal(new URL(response.url).searchParams.get('v'), CONFIG.buildVersion, response.url);
}
assert.ok(cases.length === 24, `expected all engine × viewport × mode cases, got ${cases.length}`);
for (const engine of ['chromium', 'webkit']) {
  for (const [width, height] of viewports) {
    const runs = cases.filter(item => item.engine === engine && item.width === width && item.height === height);
    const generations = runs.map(item => item.frames[0].generation);
    assert.ok(generations[0] < generations[1] && generations[1] < generations[2],
      `${engine} ${width}x${height}: same-seed attempts need fresh generations (${generations.join(', ')})`);
    assert.ok(runs.every(item => item.visualSeed === runs[0].visualSeed),
      `${engine} ${width}x${height}: visual choices remain seed-stable across attempts`);
  }
}

await writeFile(artifact, JSON.stringify({
  status: 'PASS',
  buildVersion: CONFIG.buildVersion,
  base,
  verification: 'technical-assertions-passed',
  humanComfortStatus: 'not-assessed',
  note: 'Automated Canvas geometry and pixel observations do not establish human comfort or motion-sickness outcomes.',
  engines: ['chromium', 'webkit'],
  viewports,
  modes,
  moduleResponses,
  pageErrors,
  cases,
}, null, 2));
console.log(JSON.stringify({ artifact, verification: 'technical-assertions-passed', cases: cases.length, pageErrors }, null, 2));
