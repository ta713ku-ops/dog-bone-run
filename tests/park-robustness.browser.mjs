import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const playwrightModule = process.env.DOG_PLAYWRIGHT_MODULE
  || '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium, webkit } = await import(playwrightModule);
const devOrigin = (process.env.DOG_TEST_URL || 'http://127.0.0.1:4198').replace(/\/$/, '');
const productionOrigin = (process.env.DOG_TEST_ORIGIN || 'http://127.0.0.1:4199').replace(/\/$/, '');
const output = resolve(process.env.DOG_PARK_OUTPUT || 'test-results/park-level2');
const bodiesOnly = process.argv.includes('--bodies');
const lifecycleOnly = process.argv.includes('--lifecycle');
await mkdir(output, { recursive: true });

const report = {
  devOrigin,
  productionOrigin,
  checkedAt: new Date().toISOString(),
  cases: [],
  errors: [],
  limitations: ['Automated Chromium and WebKit runs do not establish physical iPhone Safari behavior or five-player difficulty ratings.'],
};

function collectErrors(page, engine, scenario) {
  page.on('pageerror', error => report.errors.push({ engine, scenario, kind: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ engine, scenario, kind: 'console', message: message.text() });
  });
}

function pageUrl(origin, pathname = '/') {
  return new URL(pathname, `${origin}/`).href;
}

async function openDevPage(browser, engine, scenario, {
  width = 390,
  height = 844,
  mobile = true,
  audioMock = null,
  denyStorage = false,
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'no-preference',
  });
  if (audioMock) await context.addInitScript(audioMock);
  if (denyStorage) {
    await context.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'dog-bone-run:walk-preferences:v1' || key.startsWith('dog-bone-run:record:')) {
          throw new DOMException('Storage write blocked by robustness test', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
    });
  }
  const page = await context.newPage();
  collectErrors(page, engine, scenario);
  await page.goto(pageUrl(devOrigin, '/?test=1&seed=42'), { waitUntil: 'networkidle' });
  await page.locator('#start').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.__dogBoneTest?.game?.reset === 'function');
  await page.waitForFunction(() => !document.querySelector('#start')?.disabled, undefined, { timeout: 20_000 });
  assert.equal(await page.locator('#test-panel').isVisible(), true, `${engine}/${scenario} should be the development test surface`);
  return { context, page };
}

async function selectPark(page) {
  if (!(await page.locator('#walk-picker').isVisible())) await page.locator('#start').click();
  await page.locator('#walk-level-2').click();
  assert.equal(await page.locator('#walk-level-2').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#walk-level-1').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => window.__dogBoneTest.game.walkLevel), 2);
}

async function parkGuideFocusReturnsToInvoker(page, engineName) {
  const help = page.locator('#park-help');
  await help.click();
  await page.locator('#park-guide').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#park-guide-title').evaluate(element => document.activeElement === element), true,
    `${engineName} park guide must move focus into the dialog`);
  assert.deepEqual(await page.evaluate(() => ['ready', 'hud', 'scene'].map(id => document.getElementById(id).inert)), [true, true, true],
    `${engineName} park guide must make the background inert`);
  await page.keyboard.press('Escape');
  await page.locator('#park-guide').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'park-help',
    `${engineName} Escape must restore focus to the help trigger`);

  await help.click();
  await page.locator('#park-guide').waitFor({ state: 'visible' });
  await page.locator('#park-guide-close').click();
  await page.locator('#park-guide').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'park-help',
    `${engineName} close button must restore focus to the help trigger`);
  assert.deepEqual(await page.evaluate(() => ['ready', 'hud', 'scene'].map(id => document.getElementById(id).inert)), [true, true, true],
    `${engineName} closing the guide must leave the picker background inert`);
  report.cases.push({ engine: engineName, scenario: 'park-guide-focus', escapeAndCloseReturnFocus: true, backgroundInert: true });
}

async function muteAndReduceMotion(page) {
  const selecting = await page.locator('#walk-picker').isVisible();
  if (selecting) await page.locator('#walk-picker-close').click();
  await page.locator('#ready-settings').click();
  await page.locator('#settings-panel').waitFor({ state: 'visible' });
  const sound = page.locator('#ready-sound');
  if (await sound.getAttribute('aria-pressed') === 'true') await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false', 'sound toggle must expose its muted state');
  assert.equal(await page.evaluate(() => window.__dogBoneTest.audio.enabled), false, 'mute must reach the audio engine');
  await page.locator('#reduce-motion').check();
  assert.equal(await page.locator('#game').getAttribute('data-reduced-motion'), 'true');
  assert.equal(await page.evaluate(() => window.__dogBoneTest.renderer.reducedMotion), true);
  await page.locator('#settings-close').click();
  await page.locator('#settings-panel').waitFor({ state: 'hidden' });
  if (selecting) await page.locator('#start').click();
}

async function startPark(page) {
  if (!(await page.locator('#walk-picker').isVisible())) await page.locator('#start').click();
  await page.locator('#walk-picker-start').click();
  await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running', undefined, { timeout: 8_000 });
  assert.equal(await page.locator('#game').getAttribute('data-walk-level'), '2');
}

async function assertPausedFor(page, reasonPattern) {
  await page.waitForFunction(() => window.__dogBoneTest.game.state === 'paused');
  assert.equal(await page.locator('#game').getAttribute('data-state'), 'paused');
  assert.match(await page.locator('#pause-reason').textContent(), reasonPattern);
  const frozenTime = await page.evaluate(() => window.__dogBoneTest.game.timeMs);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__dogBoneTest.game.timeMs), frozenTime, 'paused park clock must stay frozen');
  return frozenTime;
}

async function resumePark(page) {
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
}

async function interactionAndLifecycle(browser, engineName) {
  const scenario = `${engineName}/touch-keyboard-lifecycle`;
  const { context, page } = await openDevPage(browser, engineName, scenario);
  try {
    await selectPark(page);
    await parkGuideFocusReturnsToInvoker(page, engineName);
    await muteAndReduceMotion(page);
    await startPark(page);

    const initialLane = await page.evaluate(() => window.__dogBoneTest.game.lane);
    assert.equal(initialLane, 0);
    await page.locator('#scene').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__dogBoneTest.game.move === null && window.__dogBoneTest.game.lane === 1);
    await page.keyboard.press('a');
    await page.waitForFunction(() => window.__dogBoneTest.game.move === null && window.__dogBoneTest.game.lane === 0);
    const keyboard = await page.evaluate(() => window.__dogBoneTest.log.events
      .filter(event => event.type === 'input' && event.source === 'keyboard')
      .map(({ direction, accepted, reason }) => ({ direction, accepted, reason })));
    assert.deepEqual(keyboard.slice(-2).map(event => [event.direction, event.accepted]), [[1, true], [-1, true]], `${engineName} keyboard path`);

    const canvas = page.locator('#scene');
    const bounds = await canvas.boundingBox();
    assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
    const tapPoints = [
      [0.50, 0.80], [0.25, 0.62], [0.75, 0.58], [0.50, 0.42], [0.35, 0.72],
    ];
    const beforeTaps = await page.evaluate(() => ({
      lane: window.__dogBoneTest.game.lane,
      acceptedInputs: window.__dogBoneTest.log.events.filter(event => event.type === 'input' && event.accepted).length,
      state: window.__dogBoneTest.game.state,
    }));
    for (let index = 0; index < 20; index++) {
      const [x, y] = tapPoints[index % tapPoints.length];
      await page.touchscreen.tap(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
      await page.waitForTimeout(25);
      assert.equal(await page.locator('#game').getAttribute('data-state'), 'running', `${engineName} stationary touch ${index + 1}`);
    }
    const afterTaps = await page.evaluate(() => ({
      lane: window.__dogBoneTest.game.lane,
      acceptedInputs: window.__dogBoneTest.log.events.filter(event => event.type === 'input' && event.accepted).length,
      state: window.__dogBoneTest.game.state,
      focus: document.activeElement.id,
    }));
    assert.equal(afterTaps.lane, beforeTaps.lane, `${engineName} stationary touches must not move a lane`);
    assert.equal(afterTaps.acceptedInputs, beforeTaps.acceptedInputs, `${engineName} stationary touches must not issue game input`);
    assert.equal(afterTaps.state, 'running');
    assert.equal(afterTaps.focus, 'scene', `${engineName} touch must preserve game-surface focus`);

    let swipe = 'touchscreen.tap-only';
    if (engineName === 'chromium') {
      const cdp = await context.newCDPSession(page);
      const x = bounds.x + bounds.width * 0.5;
      const y = bounds.y + bounds.height * 0.78;
      const before = await page.evaluate(() => window.__dogBoneTest.log.events.filter(event => event.type === 'input').length);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
      await page.waitForTimeout(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 42, y, id: 7 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => window.__dogBoneTest.game.move === null && window.__dogBoneTest.game.lane === 1);
      const swipeEvents = await page.evaluate(count => window.__dogBoneTest.log.events
        .filter(event => event.type === 'input').slice(count), before);
      assert.equal(swipeEvents.length, 1, 'one real Chromium touch swipe must issue one lane command');
      assert.equal(swipeEvents[0].source, 'touch');
      assert.equal(swipeEvents[0].accepted, true);
      assert.equal(await page.evaluate(() => scrollY), 0, 'game swipe must not scroll the document');
      swipe = 'Chromium CDP touch swipe accepted exactly one lane command';
      await cdp.detach();
    }

    for (const [eventName, expectedReason] of [['blur', /画面を離れたので/], ['pagehide', /画面を離れたので/]]) {
      await page.evaluate(type => window.dispatchEvent(new Event(type)), eventName);
      const frozenTime = await assertPausedFor(page, expectedReason);
      await resumePark(page);
      assert.ok((await page.evaluate(() => window.__dogBoneTest.game.timeMs)) >= frozenTime);
    }
    const beforeStall = await page.evaluate(() => {
      // Commit the short interval since the last RAF before measuring the
      // blocked interval; a queued RAF may carry a pre-block timestamp.
      window.__dogBoneTest.syncTime();
      const time = window.__dogBoneTest.game.timeMs;
      const until = performance.now() + 320;
      while (performance.now() < until) {}
      return time;
    });
    const stalledTime = await assertPausedFor(page, /表示が止まった/);
    // A queued RAF can commit one short pre-block timestamp before the next
    // RAF detects the stall. None of the 320ms blocked interval may be added.
    assert.ok(stalledTime >= beforeStall && stalledTime - beforeStall < 50,
      `only a pre-block frame may advance, not the 320ms stall: ${stalledTime - beforeStall}ms`);
    assert.ok(await page.evaluate(() => window.__dogBoneTest.log.events.some(event => event.type === 'long_stall' && event.intervalMs > 250)));
    await resumePark(page);
    await page.setViewportSize({ width: 844, height: 390 });
    const rotatedTime = await assertPausedFor(page, /縦向きに戻して/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => window.__dogBoneTest.game.timeMs), rotatedTime);
    assert.equal(await page.locator('#game').getAttribute('data-state'), 'paused');
    await resumePark(page);
    report.cases.push({ engine: engineName, scenario, stationaryTouches: 20, keyboard, swipe, blurAndPagehide: 'pause with frozen clock; explicit resume required', longStallAndRotation: 'park clock frozen; portrait return requires explicit resume', mute: true, reducedMotion: true });
  } finally {
    await context.close();
  }
}

function audioMockScript({ failures = 0 } = {}) {
  return `(() => {
    const state = window.__dogParkAudioMock = { failures: ${failures}, resumeCalls: 0, contexts: [] };
    class Param {
      cancelScheduledValues() {}
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }
    class Node { connect() {} disconnect() {} }
    class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
    class Oscillator extends Node {
      constructor() { super(); this.frequency = new Param(); this.type = 'sine'; this.onended = null; }
      start() {}
      stop() {}
    }
    class AudioContextMock {
      constructor() {
        this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.onstatechange = null;
        state.contexts.push(this);
      }
      resume() {
        state.resumeCalls++;
        if (state.failures > 0) {
          state.failures--;
          return Promise.reject(new Error('injected_audio_resume_failure'));
        }
        this.state = 'running'; queueMicrotask(() => this.onstatechange?.()); return Promise.resolve();
      }
      createGain() { return new Gain(); }
      createOscillator() { return new Oscillator(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioContextMock });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: AudioContextMock });
  })();`;
}

async function audioFailureFallsBackSilently(browser, engineName) {
  const scenario = `${engineName}/audio-failure-silent-start`;
  const { context, page } = await openDevPage(browser, engineName, scenario, { audioMock: audioMockScript({ failures: 1 }) });
  try {
    await selectPark(page);
    if (!(await page.locator('#walk-picker').isVisible())) await page.locator('#start').click();
    await page.locator('#walk-picker-start').click();
    await page.locator('#audio-options').waitFor({ state: 'visible', timeout: 5_000 });
    assert.match(await page.locator('#audio-message').textContent(), /再試行|音なし/);
    assert.notEqual(await page.locator('#game').getAttribute('data-state'), 'running', 'audio failure must not silently start with a failed audio context');
    await page.locator('#audio-silent').click();
    await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
    assert.equal(await page.locator('#audio-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__dogBoneTest.audio.enabled), false);
    assert.equal(await page.evaluate(() => window.__dogParkAudioMock.resumeCalls), 1, 'silent start must not retry the broken context');
    assert.equal(await page.evaluate(() => window.__dogBoneTest.game.walkLevel), 2, 'audio fallback must retain the selected park level');
    report.cases.push({ engine: engineName, scenario, failedUnlock: true, startedSilently: true, resumeCalls: 1 });
  } finally {
    await context.close();
  }
}

async function interruptedAudioPauses(browser, engineName) {
  const scenario = `${engineName}/audio-interrupted`;
  const { context, page } = await openDevPage(browser, engineName, scenario, { audioMock: audioMockScript() });
  try {
    await selectPark(page);
    await startPark(page);
    assert.equal(await page.evaluate(() => window.__dogBoneTest.audio.enabled), true);
    await page.evaluate(() => {
      const context = window.__dogParkAudioMock.contexts[0];
      context.state = 'interrupted';
      context.onstatechange?.();
    });
    await assertPausedFor(page, /音が中断/);
    await resumePark(page);
    assert.ok((await page.evaluate(() => window.__dogParkAudioMock.resumeCalls)) >= 2, 'resume must prepare audio again after interruption');
    report.cases.push({ engine: engineName, scenario, interruptedAudio: 'paused, clock frozen, explicit resume restored audio' });
  } finally {
    await context.close();
  }
}

async function deniedStorageKeepsCurrentSelection(browser, engineName) {
  const scenario = `${engineName}/storage-denied`;
  const { context, page } = await openDevPage(browser, engineName, scenario, { denyStorage: true });
  try {
    await selectPark(page);
    assert.equal(await page.locator('#walk-status').isVisible(), true, 'selection write failure must be announced');
    assert.match(await page.locator('#walk-status').textContent(), /保存できませんでした/);
    await muteAndReduceMotion(page);
    await startPark(page);
    await page.evaluate(() => window.__dogBoneTest.game.advance(30_000));
    await page.locator('#result').waitFor({ state: 'visible' });
    assert.match(await page.locator('#record-status').textContent(), /保存できませんでした/);
    const result = await page.evaluate(() => ({
      walkLevel: window.__dogBoneTest.game.walkLevel,
      result: window.__dogBoneTest.game.result(),
      state: window.__dogBoneTest.game.state,
    }));
    assert.equal(result.walkLevel, 2, 'storage denial must not change the selected difficulty in this run');
    assert.equal(result.state, 'result');
    assert.equal(result.result.completed, true);
    report.cases.push({ engine: engineName, scenario, selectedLevelDuringRun: result.walkLevel, completedWithoutStorage: true, recordFailureAnnounced: true });
  } finally {
    await context.close();
  }
}

async function textEnlargementAndTouchTargets(browser, engineName) {
  const scenario = `${engineName}/320px-200-percent-text`;
  const { context, page } = await openDevPage(browser, engineName, scenario, { width: 320, height: 568 });
  try {
    await page.locator('#start').click();
    const baseline = await page.locator('#walk-level-2 small:not(.walk-selection)').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    await page.evaluate(() => {
      const selector = 'h1,h2,h3,p,span,button,label,small,strong,output,summary';
      // Snapshot before writing: inherited children must not double the already
      // enlarged parent. Disable extra mobile autosizing for exactly 200% text.
      const sizes = [...document.querySelectorAll(selector)].map(element =>
        [element, Number.parseFloat(getComputedStyle(element).fontSize)]);
      document.documentElement.style.webkitTextSizeAdjust = '100%';
      document.documentElement.style.textSizeAdjust = '100%';
      for (const [element, size] of sizes) {
        if (Number.isFinite(size) && size > 0) element.style.fontSize = `${size * 2}px`;
      }
    });
    const enlarged = await page.locator('#walk-level-2 small:not(.walk-selection)').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    assert.ok(enlarged >= baseline * 1.99, `text should be enlarged to 200% (${baseline}px -> ${enlarged}px)`);
    const layout = await page.evaluate(() => {
      const choice = document.querySelector('.walk-choice');
      const buttons = [...choice.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
      });
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        choiceWidth: choice.clientWidth,
        choiceScrollWidth: choice.scrollWidth,
        buttons,
      };
    });
    assert.equal(layout.documentWidth, layout.viewportWidth, `${engineName} 320px enlarged text must not overflow the page`);
    assert.equal(layout.bodyWidth, layout.viewportWidth, `${engineName} 320px enlarged text must not overflow the body`);
    assert.equal(layout.choiceScrollWidth, layout.choiceWidth, `${engineName} difficulty choices must fit the available width`);
    assert.equal(layout.buttons.length, 2);
    for (const [index, button] of layout.buttons.entries()) {
      assert.ok(button.height >= 44, `${engineName} difficulty button ${index + 1} must remain at least 44 CSS px tall`);
      assert.ok(button.width >= 44, `${engineName} difficulty button ${index + 1} must remain at least 44 CSS px wide`);
    }
    report.cases.push({ engine: engineName, scenario, baselineTextPx: baseline, enlargedTextPx: enlarged, layout });
  } finally {
    await context.close();
  }
}

async function visibleContactAndPickupContinue(browser, engineName) {
  const scenario = `${engineName}/visible-contact-pickup`;
  const { context, page } = await openDevPage(browser, engineName, scenario, { mobile: false });
  try {
    await selectPark(page);
    await muteAndReduceMotion(page);
    await startPark(page);
    await page.evaluate(async () => {
      const { parkObstacleLaneAt } = await import('/src/park-course.js');
      window.__dogBoneTest.parkObstacleLaneAt = parkObstacleLaneAt;
    });
    const evidence = await page.evaluate(() => {
      const { game, log } = window.__dogBoneTest;
      const parkObstacleLaneAt = window.__dogBoneTest.parkObstacleLaneAt;
      const target = game.obstacles.find(obstacle => obstacle.type === 'crow');
      if (!target) throw new Error('park course has no crow obstacle');

      // Isolate one real park-game collision while retaining the app callbacks and renderer.
      game.pause('qa_fixture');
      game.reset({ seed: 42, walkLevel: 2 });
      const obstacle = game.obstacles.find(item => item.id === target.id) ?? game.obstacles.find(item => item.type === 'crow');
      for (const item of game.obstacles) if (item !== obstacle) item.status = 'passed';
      game.lane = obstacle.lane;
      game.x = obstacle.lane;
      game.start();
      const startIndex = log.events.length;
      game.advance(obstacle.arrivalMs - game.timeMs);

      const emitted = log.events.slice(startIndex);
      const matchesObstacle = event => event.obstacleId === obstacle.id || event.eventId === obstacle.eventId;
      const visible = emitted.find(event => event.type === 'obstacle_visible' && matchesObstacle(event));
      const contact = emitted.find(event => event.type === 'obstacle_contact' && matchesObstacle(event));
      if (!visible || !contact) return { error: 'expected visible and contact for the same crow', visible, contact, obstacle };

      const nextBone = game.bones.find(bone => bone.status === 'pending' && bone.timeMs > game.timeMs + 250);
      if (!nextBone) return { error: 'no pending bone after the controlled crow contact', visible, contact, obstacle };
      game.lane = nextBone.lane;
      game.x = nextBone.lane;
      game.move = null;
      game.queue = null;
      game.advance(nextBone.timeMs + 120 - game.timeMs);
      const laterCollect = log.events.find(event => event.type === 'collect' && event.activeMs > contact.activeMs);
      const visibleLane = visible.targetLane ?? visible.lane;
      const contactLane = contact.lane;
      return {
        visible: { id: visible.obstacleId ?? visible.eventId, activeMs: visible.activeMs, lane: visibleLane },
        contact: { id: contact.obstacleId ?? contact.eventId, activeMs: contact.activeMs, lane: contactLane, points: contact.points },
        obstacle: {
          id: obstacle.id,
          type: obstacle.type,
          lane: obstacle.lane,
          visibleStartMs: obstacle.visibleStartMs,
          arrivalMs: obstacle.arrivalMs,
          atVisibleLane: parkObstacleLaneAt ? parkObstacleLaneAt(obstacle, obstacle.visibleStartMs) : obstacle.lane,
          atContactLane: parkObstacleLaneAt ? parkObstacleLaneAt(obstacle, contact.activeMs) : obstacle.lane,
        },
        afterContact: { state: game.state, collected: game.collected, laterCollect: laterCollect ? { boneId: laterCollect.boneId, activeMs: laterCollect.activeMs } : null },
      };
    });
    assert.equal(evidence.error, undefined, evidence.error);
    assert.equal(evidence.visible.id, evidence.contact.id, 'visible and collision must refer to the same obstacle');
    assert.ok(Math.abs(evidence.visible.activeMs - evidence.obstacle.visibleStartMs) <= 25, 'visible must be emitted at its authored lead-in time');
    assert.ok(evidence.visible.activeMs < evidence.contact.activeMs, 'visible must precede contact');
    assert.equal(evidence.visible.lane, evidence.obstacle.atVisibleLane, 'visual visible lane must match the obstacle trajectory');
    assert.equal(evidence.contact.lane, evidence.obstacle.atContactLane, 'judged contact lane must match the obstacle trajectory');
    assert.ok(evidence.afterContact.laterCollect, 'a later bone must still be collected after contact');
    assert.equal(evidence.afterContact.state, 'running', 'contact must not end the park run');
    report.cases.push({ engine: engineName, scenario, visibleAndContactUseSameLane: true, pickupAfterContact: evidence.afterContact.laterCollect });
  } finally {
    await context.close();
  }
}

async function captureActualBodies(browser, engineName) {
  const scenario = `${engineName}/visible-physical-bodies`;
  const { context, page } = await openDevPage(browser, engineName, scenario, { mobile: true, width: 320, height: 568 });
  try {
    await selectPark(page); await muteAndReduceMotion(page); await startPark(page);
    await page.evaluate(() => {
      const { renderer } = window.__dogBoneTest, draw = renderer.draw.bind(renderer);
      window.__parkCaptureType = 'puddle';
      renderer.draw = function(game) {
        const result = draw(game);
        if (window.__parkBodyEvidence || game.state !== 'running') return result;
        const body = renderer.parkObjects?.find(body => body.type === window.__parkCaptureType);
        if (body && body.x >= 0 && body.y >= 0 && body.x + body.width <= renderer.width && body.y + body.height <= renderer.height) {
          window.__parkBodyEvidence = { body, canvasWidth:renderer.width, canvasHeight:renderer.height,
            leadMs:body.firstContactMs - game.timeMs, gameTimeMs:game.timeMs,
            warningMarkers:renderer.parkLevel2Scene?.stats.warningMarkers ?? [] };
          setTimeout(() => window.__dogBoneTest.pause('qa_body_capture'), 0);
        }
        return result;
      };
    });
    for (const kind of ['puddle','crow','ball']) {
      if (kind !== 'puddle') {
        await page.evaluate(type => {window.__parkCaptureType=type;delete window.__parkBodyEvidence;},kind);
        await resumePark(page);
      }
      await page.waitForFunction(() => window.__dogBoneTest.game.state === 'paused' && window.__parkBodyEvidence,
        undefined,{timeout:15000});
      const evidence=await page.evaluate(()=>window.__parkBodyEvidence);
      assert.equal(evidence.body.type,kind);assert.deepEqual(evidence.warningMarkers,[]);
      assert.ok(evidence.leadMs>=1200,`physical ${kind} must be visible with time to react: ${evidence.leadMs}`);
      const minimum={puddle:16,crow:25,ball:20}[kind];
      assert.ok(evidence.body.width>=minimum,`${kind} silhouette must be legible on320px`);
      const png=await page.locator('#scene').evaluate(c=>c.toDataURL('image/png'));
      await writeFile(resolve(output,`${engineName}-park-body-${kind}.png`),Buffer.from(png.split(',')[1],'base64'));
      report.cases.push({engine:engineName,scenario:`${scenario}/${kind}`,physicalBody:evidence});
    }
  } finally { await context.close(); }
}

async function actualUiThirtySecondFinish(browser) {
  const scenario = 'chromium/real-ui-park-30-seconds';
  const { context, page } = await openDevPage(browser, 'chromium', scenario, { mobile: true, width: 390, height: 844 });
  try {
    await selectPark(page);
    await muteAndReduceMotion(page);
    await startPark(page);
    const route = await page.evaluate(() => window.__dogBoneTest.game.courseData.safeInputs.map(({ timeMs, direction }) => ({ timeMs, direction })));
    assert.ok(route.length >= 38 && route.length <= 46, `safe UI route should exercise the authored 38–46 moves (got ${route.length})`);
    await page.locator('#scene').focus();
    for (let index = 0; index < route.length; index++) {
      const input = route[index];
      await page.waitForFunction(target => {
        const game = window.__dogBoneTest.game;
        return game.state === 'running' && game.timeMs >= target;
      }, input.timeMs - 60, { timeout: 6_000, polling: 10 });
      await page.keyboard.press(input.direction < 0 ? 'ArrowLeft' : 'ArrowRight');
      const result = await (await page.waitForFunction(({ index, direction }) => {
        const events = window.__dogBoneTest.log.events.filter(event => event.type === 'input' && event.source === 'keyboard');
        const current = events[index];
        return current && current.direction === direction ? current : null;
      }, { index, direction: input.direction }, { timeout: 1_500 })).jsonValue();
      assert.ok(Math.abs(result.activeMs-input.timeMs)<=60, 'actual UI key arrival must stay within the existing course tolerance');
      assert.equal(result.accepted, true, `safe keyboard move ${index + 1} must be accepted: ${JSON.stringify(result)}`);
    }
    await page.waitForFunction(() => window.__dogBoneTest.game.state === 'result', undefined, { timeout: 38_000 });
    await page.locator('#result').waitFor({ state: 'visible' });
    const finish = await page.evaluate(() => ({
      result: window.__dogBoneTest.game.result(),
      inputs: window.__dogBoneTest.log.events.filter(event => event.type === 'input' && event.source === 'keyboard'),
      warnings: window.__dogBoneTest.log.events.filter(event => event.type === 'obstacle_warning'),
      visibleBodies: window.__dogBoneTest.log.events.filter(event => event.type === 'obstacle_visible'),
      contacts: window.__dogBoneTest.log.events.filter(event => event.type === 'obstacle_contact'),
      levelLabel: document.querySelector('#result-level').textContent,
      bonesLabel: document.querySelector('#result-bones').textContent,
      goldLabel: document.querySelector('#result-gold').textContent,
      contactLabel: document.querySelector('#result-contacts').textContent,
      frames: window.__dogBoneTest.metrics.summary(),
    }));
    await writeFile(resolve(output, 'real-ui-route-evidence.json'), JSON.stringify({ route, finish }, null, 2));
    assert.equal(finish.result.completed, true);
    assert.equal(finish.result.timeMs, 30_000);
    assert.equal(finish.result.collected, 48, 'real UI safe route should collect all 48 bones');
    assert.equal(finish.result.goldCollected, 3, 'real UI safe route should collect all three gold bones');
    assert.equal(finish.result.contactCount, 0, 'real UI safe route should avoid all obstacles');
    assert.equal(finish.inputs.length, route.length, 'each route move must pass through the real keyboard UI exactly once');
    assert.equal(finish.warnings.length,0,'no separate warning events may be emitted');
    assert.ok(finish.visibleBodies.length>=1,'real bodies must be visible before contact');
    assert.equal(finish.contacts.length, 0);
    assert.match(finish.levelLabel, /難易度2.*こうえん/);
    assert.match(finish.bonesLabel, /48\s*\/\s*48/);
    assert.equal(finish.goldLabel, '3 / 3');
    assert.equal(finish.contactLabel, '0');
    report.cases.push({ engine: 'chromium', scenario, realUiInputs: finish.inputs.length, warnings: finish.warnings.length, finish: finish.result });
  } finally {
    await context.close();
  }
}

async function productionBuildAndAssetHashes(browser) {
  const scenario = 'production/no-diagnostics-and-park-assets';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const responses = [];
  collectErrors(page, 'chromium', scenario);
  page.on('response', response => {
    if (new URL(response.url()).pathname.includes('/art/park-level2/')) responses.push({ url: response.url(), status: response.status() });
  });
  try {
    await page.goto(pageUrl(productionOrigin), { waitUntil: 'networkidle' });
    const versionResponse = await page.request.get(pageUrl(productionOrigin, '/version.json'));
    assert.equal(versionResponse.ok(), true, 'production version manifest must load');
    const version = await versionResponse.json();
    assert.equal(version.diagnosticBuild, false, 'normal dist must not be a diagnostic build');
    assert.ok(!version.assets.some(path => /\/source\/|^tests\/|WALK_LEVEL2_/.test(path)), 'original images, tests and plans must not ship');
    const surface = await page.evaluate(() => ({
      testPanel: Boolean(document.querySelector('#test-panel')),
      testApi: typeof window.__dogBoneTest,
      visibleDiagnosticText: /検証パネル|犬の診断|診断JSON|60秒計測/.test(document.body.innerText),
    }));
    assert.deepEqual(surface, { testPanel: false, testApi: 'undefined', visibleDiagnosticText: false });
    const appModule = await page.request.get(new URL(`/src/app.js?v=${encodeURIComponent(version.buildVersion)}`, `${productionOrigin}/`).href);
    assert.equal(appModule.ok(), true, 'normal app module must load');
    const appSource = await appModule.text();
    assert.doesNotMatch(appSource, /window\.__dogBoneTest|diagnosticSnapshot|60秒計測|犬の診断JSON/);

    await page.locator('#start').click();
    await page.locator('#walk-level-2').click();
    if (!(await page.locator('#walk-picker').isVisible())) await page.locator('#start').click();
    await page.locator('#walk-picker-start').click();
    await page.locator('#game[data-state="running"]').waitFor();
    await page.locator('#pause').click();
    const metadata = JSON.parse(await readFile(new URL('../art/park-level2/metadata.json', import.meta.url), 'utf8'));
    const assets = Object.values(metadata.assets ?? {});
    assert.ok(assets.length > 0, 'park-level2 metadata must enumerate generated assets and hashes');
    const checkedAssets = [];
    for (const asset of assets) {
      assert.ok(version.assets.includes(asset.path), `production manifest must include ${asset.path}`);
      const url = new URL(`/${asset.path}`, `${productionOrigin}/`);
      url.searchParams.set('v', version.buildVersion);
      const response = await page.request.get(url.href);
      assert.equal(response.status(), 200, `${asset.path} must return HTTP 200`);
      const bytes = await response.body();
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      assert.equal(actualHash, asset.sha256, `${asset.path} must match its recorded SHA-256`);
      checkedAssets.push({ path: asset.path, status: response.status(), sha256: actualHash });
    }
    await page.waitForTimeout(300);
    const loaded = [...new Set(responses.map(response => response.url.split('?')[0]))];
    for (const asset of assets) {
      assert.ok(loaded.some(url => new URL(url).pathname.endsWith(`/${asset.path}`)), `the actual production UI must request ${asset.path}`);
    }
    report.cases.push({ scenario, buildVersion: version.buildVersion, diagnosticBuild: version.diagnosticBuild, diagnosticSurface: surface, assets: checkedAssets, loadedByUi: loaded });
  } finally {
    await context.close();
  }
}

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true });
  try {
    if (bodiesOnly) {
      await captureActualBodies(browser, engineName);
      continue;
    }
    if (lifecycleOnly) { await interactionAndLifecycle(browser, engineName); continue; }
    await interactionAndLifecycle(browser, engineName);
    await audioFailureFallsBackSilently(browser, engineName);
    await interruptedAudioPauses(browser, engineName);
    await deniedStorageKeepsCurrentSelection(browser, engineName);
    await textEnlargementAndTouchTargets(browser, engineName);
    await visibleContactAndPickupContinue(browser, engineName);
    await captureActualBodies(browser, engineName);
    if (engineName === 'chromium') {
      await actualUiThirtySecondFinish(browser);
      await productionBuildAndAssetHashes(browser);
    }
  } finally {
    await browser.close();
  }
}

assert.deepEqual(report.errors, [], 'park robustness browser runs must not report JavaScript or console errors');
await writeFile(resolve(output, bodiesOnly ? 'park-body-report.json' : lifecycleOnly ? 'park-lifecycle-report.json' : 'park-robustness-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors.length, output }, null, 2));
