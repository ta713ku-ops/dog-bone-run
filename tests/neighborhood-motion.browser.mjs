import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE
  ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base = process.env.DOG_TEST_URL ?? 'http://127.0.0.1:4195';
const output = fileURLToPath(new URL('../test-results/walk-v24/', import.meta.url));
await mkdir(output, { recursive: true });
const report = { checks: [], errors: [] };
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${base}/tests/fixtures/walk-preview.html?seed=42&timeMs=5000`, { waitUntil: 'networkidle' });
    const ready = await page.evaluate(() => window.__walkPreview.ready);
    assert.ok(ready.ok, ready.error);
    const motion = await page.evaluate(() => {
      const preview = window.__walkPreview, renderer = preview.renderer;
      const original = renderer.shouldDrawRoadDecoration.bind(renderer);
      const choices = new Map();
      const changed = [], forbidden = [], caps = [];
      let repeated = 0;
      renderer.shouldDrawRoadDecoration = function(id, options) {
        const visible = original(id, options);
        if (/butterfly|creek|dapple|gravel/.test(id)) forbidden.push(id);
        if (choices.has(id)) {
          repeated++;
          if (choices.get(id) !== visible) changed.push(id);
        } else choices.set(id, visible);
        return visible;
      };
      for (let frame = 0; frame < 90; frame++) {
        const timeMs = 5000 + frame * 1000 / 60;
        renderer.draw({ ...preview.game, timeMs, distance: timeMs / 1000 });
        caps.push({ lines: renderer.comfortMetrics.crossLinesBottom40, objects: renderer.comfortMetrics.decorativeObjectsBottom40 });
      }
      renderer.shouldDrawRoadDecoration = original;
      return { repeated, changed, forbidden, maxLines: Math.max(...caps.map(c => c.lines)), maxObjects: Math.max(...caps.map(c => c.objects)), frames: caps.length };
    });
    assert.ok(motion.repeated > 100, 'Track objects over their lifetime across consecutive frames.');
    assert.deepEqual(motion.changed, [], 'The same roadside object must not blink through changing visibility decisions.');
    assert.deepEqual(motion.forbidden, []);
    assert.ok(motion.maxLines <= 2);
    assert.ok(motion.maxObjects <= 8);
    await page.evaluate(async () => {
      const preview = window.__walkPreview;
      preview.renderer.setReducedMotion(true);
      await preview.setFixture(15000, 42);
    });
    // The existing optional HD dog bitmap may decode when a new posture appears.
    // Establish that decoded frame before testing pause stability.
    await page.evaluate(async () => {
      const p = window.__walkPreview;
      for (let count = 0; count < 20; count++) {
        p.renderer.draw(p.game);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if ((p.renderer.dogs.stats.hd?.pending ?? 0) === 0 && count >= 2) break;
      }
      p.renderer.draw(p.game);
    });
    const before = await page.evaluate(() => {
      const p = window.__walkPreview;
      window.__frozenPixels = p.renderer.ctx.getImageData(0, 0, p.renderer.canvas.width, p.renderer.canvas.height).data;
      return p.canvasPixels();
    });
    const after = await page.evaluate(() => {
      const p = window.__walkPreview;
      for (let frame = 0; frame < 12; frame++) p.renderer.draw(p.game);
      const data = p.renderer.ctx.getImageData(0, 0, p.renderer.canvas.width, p.renderer.canvas.height).data;
      let changedPixels = 0, maxChannelDelta = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(data[offset + channel] - window.__frozenPixels[offset + channel]);
          if (delta > 0) changed = true;
          maxChannelDelta = Math.max(maxChannelDelta, delta);
        }
        if (changed) changedPixels++;
      }
      delete window.__frozenPixels;
      return { pixels: p.canvasPixels(), changedPixels, maxChannelDelta };
    });
    // At DPR2 WebKit can rerasterize a handful of outline edge pixels between
    // JS tasks. A disappearing object would exceed both these strict bounds.
    assert.ok(after.changedPixels <= Math.ceil(before.width * before.height * .00001), 'Frozen geometry may vary only at negligible raster edges.');
    assert.ok(after.maxChannelDelta <= 8, 'Frozen frames must not contain visible object/opacity changes.');
    await page.locator('#game').screenshot({ path: `${output}/${engine.name()}-reduced-motion.png` });
    report.checks.push({ engine: engine.name(), ...motion, reducedMotionFrozen: true,
      frozenChangedPixels: after.changedPixels, frozenMaxChannelDelta: after.maxChannelDelta });
  } finally { await browser.close(); }
}
assert.deepEqual(report.errors, []);
await writeFile(`${output}/motion.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
