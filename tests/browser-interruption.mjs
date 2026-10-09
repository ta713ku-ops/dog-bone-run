import assert from 'node:assert/strict';

const playwrightModule = process.env.DOG_PLAYWRIGHT_MODULE
  || '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium, webkit } = await import(playwrightModule);
const origin = process.env.DOG_TEST_ORIGIN || 'http://127.0.0.1:4183';
const results = { origin, browsers: {} };

function audioMockScript(initialFailures) {
  return `(() => {
    const state = window.__dogAudioMock = { failures: ${initialFailures}, resumeCalls: 0, contexts: [] };
    class Param {
      cancelScheduledValues() {}
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }
    class Node {
      connect() {}
      disconnect() {}
    }
    class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
    class Oscillator extends Node {
      constructor() { super(); this.frequency = new Param(); this.type = 'sine'; this.onended = null; }
      start() {}
      stop() {}
    }
    class AudioContextMock {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = {};
        this.onstatechange = null;
        state.contexts.push(this);
      }
      resume() {
        state.resumeCalls++;
        if (state.failures > 0) {
          state.failures--;
          return Promise.reject(new Error('injected_audio_resume_failure'));
        }
        this.state = 'running';
        queueMicrotask(() => this.onstatechange?.());
        return Promise.resolve();
      }
      createGain() { return new Gain(); }
      createOscillator() { return new Oscillator(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioContextMock });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: AudioContextMock });
  })();`;
}

async function makePage(browser, { mobile = false, audioFailures = 0 } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  if (audioFailures !== null) await context.addInitScript(audioMockScript(audioFailures));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#start').waitFor({ state: 'visible' });
  const build = await page.evaluate(async () => ({
    version: await fetch('/version.json').then(response => response.ok ? response.json() : null),
    mode: await fetch('/src/build-mode.js').then(response => response.text()),
    testPanel: Boolean(document.getElementById('test-panel')),
    testApi: typeof window.__dogBoneTest,
  }));
  assert.equal(build.mode.trim(), 'export const DEVELOPMENT = false;', 'the test must use the production build');
  assert.equal(build.testPanel, false, 'production must not expose the development panel');
  assert.equal(build.testApi, 'undefined', 'production must not expose the development API');
  return { context, page, errors, build };
}

async function startWalk(page) {
  await page.locator('#start').click();
  await page.locator('#walk-dialog').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '出発する', exact: true }).click();
}

async function waitForGameState(page, state) {
  await page.waitForFunction(expected => document.querySelector('#game')?.dataset.state === expected, state);
}

async function audioRetryAndInterruption(browser, engineName) {
  const { context, page, errors, build } = await makePage(browser, { audioFailures: 1 });
  try {
    await startWalk(page);
    await page.locator('#audio-options').waitFor({ state: 'visible' });
    assert.match(await page.locator('#audio-message').textContent(), /再試行|音なし/);
    assert.notEqual(await page.locator('#game').getAttribute('data-state'), 'running', 'audio failure must not start the walk');
    assert.equal(await page.evaluate(() => window.__dogAudioMock.resumeCalls), 1);

    await page.getByRole('button', { name: '音を再試行', exact: true }).click();
    await waitForGameState(page, 'running');
    assert.equal(await page.locator('#audio-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__dogAudioMock.resumeCalls), 2);

    await page.evaluate(() => {
      const context = window.__dogAudioMock.contexts[0];
      context.state = 'interrupted';
      context.onstatechange?.();
    });
    await waitForGameState(page, 'paused');
    assert.match(await page.locator('#pause-reason').textContent(), /音が中断/);
    await page.getByRole('button', { name: '再開する', exact: true }).click();
    await waitForGameState(page, 'running');
    assert.equal(await page.evaluate(() => window.__dogAudioMock.resumeCalls), 3);
    assert.deepEqual(errors, [], `${engineName} production page errors after audio retry/interruption`);
    return { buildVersion: build.version?.buildVersion ?? null, audioFailureRetry: 'passed', audioInterruptionExplicitResume: 'passed' };
  } finally {
    await context.close();
  }
}

async function silentFallback(browser, engineName) {
  const { context, page, errors, build } = await makePage(browser, { audioFailures: 2 });
  try {
    await startWalk(page);
    await page.locator('#audio-options').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '音なしで開始', exact: true }).click();
    await waitForGameState(page, 'running');
    assert.equal(await page.locator('#audio-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__dogAudioMock.resumeCalls), 1, 'silent fallback must not retry the failing audio context');
    await page.locator('#pause').click();
    await waitForGameState(page, 'paused');
    assert.match(await page.locator('#pause-sound').textContent(), /オフ/);
    assert.deepEqual(errors, [], `${engineName} production page errors after silent fallback`);
    return { buildVersion: build.version?.buildVersion ?? null, silentFallback: 'passed' };
  } finally {
    await context.close();
  }
}

async function addLifecycleReporter(page, lifecycleEvents) {
  await page.exposeFunction('__reportDogLifecycle', event => lifecycleEvents.push(event));
  await page.evaluate(() => {
    const report = type => event => {
      const data = {
        type,
        persisted: event.persisted,
        state: document.querySelector('#game')?.dataset.state ?? null,
        clock: document.querySelector('#clock')?.textContent ?? null,
        hidden: document.hidden,
      };
      window.__dogLifecycleEvents ??= [];
      window.__dogLifecycleEvents.push(data);
      if (type === 'pagehide') sessionStorage.setItem('__dogFinishPagehide', JSON.stringify(data));
      void window.__reportDogLifecycle(data);
    };
    window.addEventListener('pagehide', report('pagehide'));
    window.addEventListener('pageshow', report('pageshow'));
  });
}

async function setHidden(page, context, engineName) {
  if (engineName === 'chromium') {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setPageVisibilityState', { visibilityState: 'hidden' });
      await page.waitForFunction(() => document.hidden, undefined, { timeout: 2_500 });
      return {
        hidden: true,
        method: 'CDP page visibility emulation',
        restore: async () => cdp.send('Emulation.setPageVisibilityState', { visibilityState: 'visible' }),
      };
    } catch {
      // Fall back to tab switching where the browser supports visibility events.
    }
  }
  await page.evaluate(() => {
    window.__dogSetTestVisibility = hidden => {
      window.__dogTestHidden = Boolean(hidden);
      document.dispatchEvent(new Event('visibilitychange'));
    };
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => window.__dogTestHidden === true,
    });
    window.__dogSetTestVisibility(true);
  });
  await page.waitForFunction(() => document.hidden);
  return {
    hidden: true,
    method: 'deterministic visibilitychange injection (headless document.hidden unavailable)',
    restore: () => page.evaluate(() => window.__dogSetTestVisibility(false)),
  };
}

async function interruptions(browser, engineName) {
  const { context, page, errors, build } = await makePage(browser, { mobile: true, audioFailures: 0 });
  const lifecycleEvents = [];
  try {
    await addLifecycleReporter(page, lifecycleEvents);
    await startWalk(page);
    await waitForGameState(page, 'running');
    const hidden = await setHidden(page, context, engineName);
    let hiddenResult = hidden.method;
    if (hidden.hidden) {
      await waitForGameState(page, 'paused');
      assert.match(await page.locator('#pause-reason').textContent(), /画面を離れたので/);
      const frozenClock = await page.locator('#clock').textContent();
      await page.waitForTimeout(1_200);
      assert.equal(await page.locator('#clock').textContent(), frozenClock, `${engineName} hidden clock must stay frozen`);
      await hidden.restore();
      await page.waitForFunction(() => !document.hidden);
      assert.equal(await page.locator('#game').getAttribute('data-state'), 'paused', 'visibility return must not auto-resume');
      await page.getByRole('button', { name: '再開する', exact: true }).click();
      await waitForGameState(page, 'running');
      await page.waitForTimeout(1_100);
      assert.notEqual(await page.locator('#clock').textContent(), frozenClock, 'the active clock resumes only after an explicit action');
      hiddenResult = `${hidden.method}; pause, frozen clock, and explicit resume passed`;
    }

    const coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    assert.equal(coarsePointer, true, `${engineName} context must emulate a touch device for rotation behavior`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => innerWidth > innerHeight);
    await waitForGameState(page, 'paused');
    assert.match(await page.locator('#pause-reason').textContent(), /縦向きに戻して/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => innerHeight > innerWidth);
    assert.equal(await page.locator('#game').getAttribute('data-state'), 'paused', 'returning to portrait must require explicit resume');
    await page.getByRole('button', { name: '再開する', exact: true }).click();
    await waitForGameState(page, 'running');

    const beforeLeaveClock = await page.locator('#clock').textContent();
    await page.goto(new URL('/favicon.svg?away=1', origin).href, { waitUntil: 'commit' });
    await page.goBack({ waitUntil: 'commit' });
    let bfcache = 'not restored by this browser run';
    const lifecycleState = await page.evaluate(() => ({
      events: window.__dogLifecycleEvents ?? [],
      lastPagehide: sessionStorage.getItem('__dogFinishPagehide'),
    }));
    const lifecycleBack = lifecycleEvents.findLast(event => event.type === 'pageshow' && event.persisted === true)
      ?? lifecycleState.events.findLast(event => event.type === 'pageshow' && event.persisted === true);
    if (lifecycleBack) {
      await waitForGameState(page, 'paused');
      assert.equal(await page.locator('#clock').textContent(), beforeLeaveClock, 'BFCache restore preserves the frozen active clock');
      await page.getByRole('button', { name: '再開する', exact: true }).click();
      await waitForGameState(page, 'running');
      bfcache = 'restored; explicit resume passed';
    } else {
      assert.notEqual(await page.locator('#game').getAttribute('data-state'), 'running', 'a page lifecycle return must not auto-start a run');
      const pagehide = lifecycleEvents.findLast(event => event.type === 'pagehide')
        ?? lifecycleState.events.findLast(event => event.type === 'pagehide')
        ?? JSON.parse(lifecycleState.lastPagehide || 'null');
      if (pagehide) assert.equal(pagehide.state, 'paused', 'pagehide pauses before the document leaves');
      bfcache = `restore unavailable (pagehide=${pagehide?.persisted ?? 'unobserved'}); non-resume verified`;
    }
    assert.deepEqual(errors, [], `${engineName} production page errors during interruption checks`);
    return {
      buildVersion: build.version?.buildVersion ?? null,
      hidden: hiddenResult,
      rotation: 'pause, portrait return, and explicit resume passed',
      bfcache,
      lifecycleEvents,
    };
  } finally {
    await context.close();
  }
}

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const launchOptions = engineName === 'chromium'
    ? { headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'] }
    : { headless: true };
  const browser = await engine.launch(launchOptions);
  try {
    const audio = await audioRetryAndInterruption(browser, engineName);
    const silent = await silentFallback(browser, engineName);
    const lifecycle = await interruptions(browser, engineName);
    results.browsers[engineName] = { ...audio, ...silent, ...lifecycle };
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(results, null, 2));
