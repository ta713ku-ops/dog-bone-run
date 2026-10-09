import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium, webkit, devices } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4182';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [], checks = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const sound of [true, false]) {
      const context = await browser.newContext({ ...devices['iPhone 13'] });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}/?test=1&seed=42`); await page.waitForLoadState('networkidle');
      if (!sound) {
        await page.locator('#ready-settings').tap();
        await page.locator('#ready-sound').tap();
        await page.locator('#settings-close').tap();
      }
      await page.getByRole('button', { name: 'おさんぽへ' }).tap();
      await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
      const rect = await page.locator('#scene').boundingBox();
      const points = [[.5,.8],[.2,.6],[.8,.5],[.5,.4],[.5,.8]];
      for (let i = 0; i < 20; i++) {
        const [x,y] = points[i % points.length];
        await page.touchscreen.tap(rect.x + rect.width*x, rect.y + rect.height*y);
        await page.waitForTimeout(35);
        assert.equal(await page.locator('#game').getAttribute('data-state'), 'running', `${engine.name()} stationary tap${i}`);
      }
      const tapped = await page.evaluate(() => {
        const t = window.__dogBoneTest;
        return { pauses: t.log.events.filter(e => e.type === 'pause'), inputs: t.log.events.filter(e => e.type === 'input'), focus: document.activeElement.id };
      });
      assert.deepEqual(tapped.pauses, []); assert.deepEqual(tapped.inputs, []); assert.equal(tapped.focus, 'scene');
      if (engine === chromium) {
        const cdp = await context.newCDPSession(page);
        const x = rect.x + rect.width * .5, y = rect.y + rect.height * .8;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#game').getAttribute('data-state'), 'running', 'held touch');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x+40, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(220);
        assert.equal(await page.evaluate(() => window.__dogBoneTest.game.lane), 1);
        assert.equal(await page.locator('#game').getAttribute('data-state'), 'running');
        assert.equal(await page.evaluate(() => scrollY), 0);
      }
      await page.screenshot({ path: fileURLToPath(new URL(`runner-touch-${engine.name()}-${sound ? 'sound' : 'silent'}.png`, output)) });
      await page.getByRole('button', { name: '一時停止' }).tap();
      assert.equal(await page.locator('#game').getAttribute('data-state'), 'paused');
      assert.equal(await page.evaluate(() => window.__dogBoneTest.log.events.filter(e => e.type === 'pause').at(-1).reason), 'manual');
      await page.getByRole('button', { name: '再開する', exact: true }).tap();
      await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
      for (const reason of ['blur', 'pagehide']) {
        await page.evaluate(type => window.dispatchEvent(new Event(type)), reason);
        assert.equal(await page.locator('#game').getAttribute('data-state'), 'paused');
        assert.equal(await page.evaluate(() => window.__dogBoneTest.log.events.filter(e => e.type === 'pause').at(-1).reason), reason);
        await page.getByRole('button', { name: '再開する', exact: true }).tap();
        await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
      }
      checks.push(`${engine.name()}/${sound ? 'sound' : 'silent'}:20 stationary taps, focus retained, manual and lifecycle pause reasons`);
      await context.close();
    }
  } finally { await browser.close(); }
}
assert.deepEqual(errors, []);
await writeFile(new URL('runner-touch-results.json', output), JSON.stringify({ checkedAt: new Date().toISOString(), checks, errors }, null, 2));
console.log(JSON.stringify({ checks, errors }, null, 2));
