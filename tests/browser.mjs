import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Use installed Playwright, or point DOG_PLAYWRIGHT_MODULE to a bundled index.mjs.
const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4173';
const output = new URL('../test-results/', import.meta.url);
const artifact = name => fileURLToPath(new URL(name, output));
await mkdir(output, { recursive: true });
const errors = [], checks = [], evidence = {};
function watch(page) { page.on('pageerror', error => errors.push(error.message)); }
async function running(page) { await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'running'); }
async function state(page) { return page.locator('#game').getAttribute('data-state'); }
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [1280, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, hasTouch: width < 500, isMobile: width < 500 });
    const page = await context.newPage(); watch(page);
    await page.goto(`${base}/?phase=1`); await page.waitForLoadState('networkidle');
    const layout = await page.evaluate(() => {
      const button = document.querySelector('#start').getBoundingClientRect();
      const game = document.querySelector('#game').getBoundingClientRect();
      return { bodyWidth: document.body.scrollWidth, width: innerWidth, bottom: button.bottom, height: innerHeight, buttonHeight: button.height, gameWidth: game.width, canvasWidth: document.querySelector('canvas').width, panelHidden: document.querySelector('#test-panel').hidden, hasTestApi: '__dogBoneTest' in window };
    });
    assert.ok(layout.bodyWidth <= layout.width, `${width}: horizontal overflow`);
    assert.ok(layout.bottom <= layout.height + 1, `${height}: button cropped`);
    assert.ok(layout.buttonHeight >= 44);
    assert.ok(layout.canvasWidth <= layout.gameWidth * 2 + 1, 'DPR cap');
    assert.equal(layout.panelHidden, true); assert.equal(layout.hasTestApi, false);
    if (width === 390 || width === 320 || width === 1280) await page.screenshot({ path: artifact(`ready-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'タップしてスタート' }).click(); await running(page);
    await page.getByRole('button', { name: '一時停止' }).click(); assert.equal(await state(page), 'paused');
    await page.getByRole('button', { name: 'おさんぽをやめる' }).click(); assert.equal(await state(page), 'ready');
    checks.push(`layout/start/pause/quit ${width}×${height}`); await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, acceptDownloads: true });
  const page = await context.newPage(); watch(page);
  await page.goto(`${base}/?test=1&phase=1`); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'タップしてスタート' }).click(); await running(page);
  await page.waitForTimeout(2200);
  assert.ok(await page.evaluate(() => window.__dogBoneTest.game.collected >= 1), 'automatic forward collection');
  // Real emulated touch events, including a long drag that must remain one input.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 700 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 700 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 700 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(230);
  assert.equal(await page.evaluate(() => window.__dogBoneTest.game.lane), 1);
  assert.equal(await page.evaluate(() => window.__dogBoneTest.log.events.filter(e => e.type === 'input' && e.source === 'touch' && e.accepted).length), 1);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.screenshot({ path: artifact('running-390.png') });
  await page.getByRole('button', { name: '一時停止' }).click();
  const frozen = await page.evaluate(() => ({ t: window.__dogBoneTest.game.timeMs, x: window.__dogBoneTest.game.x, combo: window.__dogBoneTest.game.combo }));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ t: window.__dogBoneTest.game.timeMs, x: window.__dogBoneTest.game.x, combo: window.__dogBoneTest.game.combo })), frozen);
  await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  // Blur, pagehide, visibility and rotation all require an explicit resume.
  for (const reason of ['blur', 'pagehide']) {
    await page.evaluate(reason => window.dispatchEvent(new Event(reason)), reason);
    assert.equal(await state(page), 'paused');
    await page.waitForTimeout(100); assert.equal(await state(page), 'paused');
    await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  }
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await state(page), 'paused');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await state(page), 'paused');
  await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(100); assert.equal(await state(page), 'paused');
  await page.getByRole('button', { name: '再開する' }).click(); assert.equal(await state(page), 'paused');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100); assert.equal(await state(page), 'paused');
  await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  await page.evaluate(() => { const a = window.__dogBoneTest.audio; a.context.suspend(); });
  await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'paused');
  await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 280) {} });
  await page.waitForFunction(() => document.querySelector('#game').dataset.state === 'paused');
  assert.ok(await page.evaluate(() => window.__dogBoneTest.log.events.some(e => e.type === 'long_stall')));
  await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  checks.push('touch swipe/no scroll, frozen pause, blur/pagehide/visibility/rotation/audio/stall recovery');

  // Direct simulation through the explicit testing surface makes a 20-run lifecycle
  // stress check fast. One full RAF-driven 60s run is separately clock-tested below.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 785 }] });
  await page.evaluate(() => window.__dogBoneTest.game.advance(60_000));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await state(page), 'result');
  checks.push('touch held through finish cannot restart result');
  await page.screenshot({ path: artifact('result-390.png') });
  for (let index = 0; index < 20; index++) {
    await page.getByRole('button', { name: 'もう一度' }).click(); await running(page);
    const fresh = await page.evaluate(() => { const t = window.__dogBoneTest; return { score: t.game.score, combo: t.game.combo, x: t.game.x, queue: t.game.queue, effects: t.renderer.effects.length, contexts: t.audio.contextCount }; });
    assert.deepEqual(fresh, { score: 0, combo: 0, x: 0, queue: null, effects: 0, contexts: 1 });
    await page.evaluate(() => window.__dogBoneTest.game.advance(60_000));
    assert.equal(await state(page), 'result');
    assert.equal(await page.evaluate(() => window.__dogBoneTest.audio.voices.size), 0);
  }
  evidence.lifecycle = await page.evaluate(() => { const t = window.__dogBoneTest; return { contexts: t.audio.contextCount, activeVoices: t.audio.voices.size, recordedRuns: t.log.sessions.flatMap(s => s.runs).length, groups: t.log.sessions.map(s => s.runs.length), logEvents: t.log.events.length, incomplete: t.log.incomplete }; });
  checks.push('20 consecutive retries: reset state, one AudioContext, no live voices, history retained');
  const downloadWait = page.waitForEvent('download');
  await page.locator('#test-panel summary').click();
  await page.getByRole('button', { name: 'ログを書き出す（JSON）' }).click();
  const download = await downloadWait; const logPath = artifact('browser-log.json'); await download.saveAs(logPath);
  const exported = JSON.parse(await readFile(logPath, 'utf8'));
  assert.equal(exported.incomplete, false); assert.equal(exported.sessions.flatMap(s => s.runs).length, 21);
  for (const s of exported.sessions) for (const run of s.runs) {
    const times = exported.events.filter(e => e.runId === run.id).map(e => e.activeMs);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), `active time ordered in ${run.id}`);
  }
  checks.push('downloaded JSON parses, 21 run histories and ordered active-time events');
  await context.close();

  const clockContext = await browser.newContext({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
  const clockPage = await clockContext.newPage(); watch(clockPage);
  await clockPage.clock.install({ time: new Date('2026-10-03T12:00:00Z') });
  await clockPage.goto(`${base}/?test=1&phase=1`); await clockPage.waitForLoadState('networkidle');
  await clockPage.getByRole('button', { name: '音：オン' }).click();
  await clockPage.getByRole('button', { name: 'タップしてスタート' }).click(); await running(clockPage);
  await clockPage.clock.runFor(59_000); assert.equal(await state(clockPage), 'running');
  await clockPage.getByRole('button', { name: '一時停止' }).click();
  const pausedTime = await clockPage.evaluate(() => window.__dogBoneTest.game.timeMs);
  await clockPage.clock.runFor(5000);
  assert.equal(await clockPage.evaluate(() => window.__dogBoneTest.game.timeMs), pausedTime);
  await clockPage.getByRole('button', { name: '再開する' }).click(); await running(clockPage);
  await clockPage.clock.runFor(2000); assert.equal(await state(clockPage), 'result');
  assert.equal(await clockPage.evaluate(() => window.__dogBoneTest.game.timeMs), 60_000);
  evidence.clockRun = await clockPage.evaluate(() => ({ result: window.__dogBoneTest.game.result(), metrics: window.__dogBoneTest.metrics.summary(), reducedMotion: window.__dogBoneTest.renderer.reducedMotion }));
  checks.push('RAF-driven 60.000s result, 5s pause excluded, reduced motion'); await clockContext.close();

  const failureContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const failurePage = await failureContext.newPage(); watch(failurePage);
  await failurePage.addInitScript(() => { window.AudioContext = class { constructor() { this.state = 'suspended'; } resume() { return new Promise(() => {}); } }; });
  await failurePage.goto(`${base}/?test=1&phase=1`); await failurePage.waitForLoadState('networkidle');
  await failurePage.getByRole('button', { name: 'タップしてスタート' }).click();
  await failurePage.getByRole('button', { name: '音なしで開始' }).waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await state(failurePage), 'ready');
  assert.equal(await failurePage.evaluate(() => window.__dogBoneTest.game.timeMs), 0);
  await failurePage.keyboard.press('Tab');
  assert.ok(await failurePage.evaluate(() => document.activeElement.closest('#audio-panel') !== null));
  await failurePage.getByRole('button', { name: '音なしで開始' }).click(); await running(failurePage);
  assert.equal(await failurePage.evaluate(() => window.__dogBoneTest.audio.enabled), false);
  checks.push('audio timeout ≤2s plus rendering margin, modal keyboard focus, explicit silent fallback'); await failureContext.close();
  const keyboardContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const keyboardPage = await keyboardContext.newPage(); watch(keyboardPage);
  await keyboardPage.goto(`${base}/?test=1&phase=1`); await keyboardPage.waitForLoadState('networkidle');
  await keyboardPage.getByRole('button', { name: 'タップしてスタート' }).press('Enter'); await running(keyboardPage);
  await keyboardPage.keyboard.down('ArrowRight'); await keyboardPage.waitForTimeout(230);
  assert.equal(await keyboardPage.evaluate(() => window.__dogBoneTest.game.lane), 1);
  await keyboardPage.keyboard.up('ArrowRight');
  await keyboardPage.keyboard.down('Enter');
  await keyboardPage.evaluate(() => window.__dogBoneTest.game.advance(60_000));
  await keyboardPage.keyboard.up('Enter'); assert.equal(await state(keyboardPage), 'result');
  await keyboardPage.getByRole('button', { name: 'おわる', exact: true }).press('Enter'); assert.equal(await state(keyboardPage), 'ready');
  checks.push('keyboard start/move/end and held Enter cannot restart result'); await keyboardContext.close();
} finally { await browser.close(); }

// Desktop WebKit is an additional engine check, not iPhone Safari acceptance.
let webkitResult;
try {
  const wk = await webkit.launch({ headless: true });
  const context = await wk.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(); watch(page);
  await page.goto(`${base}/?test=1&phase=1`); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'タップしてスタート' }).click(); await running(page);
  await page.getByRole('button', { name: '一時停止' }).click(); assert.equal(await state(page), 'paused');
  await page.getByRole('button', { name: '再開する' }).click(); await running(page);
  await page.evaluate(() => window.__dogBoneTest.game.advance(60_000)); assert.equal(await state(page), 'result');
  await page.getByRole('button', { name: 'もう一度' }).click(); await running(page);
  await page.screenshot({ path: artifact('webkit-running.png') });
  webkitResult = 'pass: start/pause/resume/result/retry'; await wk.close();
} catch (error) { webkitResult = `unavailable or failed: ${error.message}`; errors.push(webkitResult); }
evidence.webkit = webkitResult;
assert.deepEqual(errors, [], 'browser console exceptions or engine failure');
await writeFile(new URL('browser-results.json', output), JSON.stringify({ checkedAt: new Date().toISOString(), checks, evidence, errors }, null, 2));
console.log(JSON.stringify({ checks, evidence, errors }, null, 2));
