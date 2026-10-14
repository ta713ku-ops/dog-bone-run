import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE
  ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base = process.env.DOG_PRODUCTION_URL ?? 'http://127.0.0.1:4197';
const output = 'test-results/walk-v24';
await mkdir(output, { recursive: true });
const report = { version: '0.24.0', cases: [], errors: [] };
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    page.on('pageerror', error => report.errors.push(error.message));
    const assets = [], bodies = [];
    page.on('response', response => {
      if (!response.url().includes('/art/neighborhood-v24/')) return;
      bodies.push((async () => {
        const body = await response.body();
        assets.push({ url: response.url(), status: response.status(), bytes: body.length,
          sha256: createHash('sha256').update(body).digest('hex') });
      })());
    });
    await page.goto(`${base}/?seed=42&v=0.24.0`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'おさんぽへ', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.equal(await page.evaluate(() => '__dogBoneTest' in window), false, 'Normal distribution must omit its diagnostic API.');
    await page.getByRole('button', { name: 'おさんぽへ', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'running');
    await page.waitForFunction(() => Number(document.querySelector('#score').textContent) > 0);
    await page.getByRole('button', { name: '一時停止', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'paused');
    const score = Number(await page.locator('#score').textContent());
    await page.screenshot({ path: `${output}/${engine.name()}-production-paused.png` });
    await page.getByRole('button', { name: '再開する', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'running');
    await page.getByRole('button', { name: '一時停止', exact: true }).tap();
    await page.locator('#quit').tap();
    await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'ready');
    await Promise.all(bodies);
    assert.equal(assets.length, 2);
    for (const asset of assets) {
      assert.equal(asset.status, 200);
      assert.equal(new URL(asset.url).searchParams.get('v'), '0.24.0');
    }
    report.cases.push({ engine: engine.name(), homeLoaded: true, collectedScore: score, manualPauseResume: true, returnedHome: true, assets });
  } finally { await browser.close(); }
}
assert.deepEqual(report.errors, []);
await writeFile(`${output}/production.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
