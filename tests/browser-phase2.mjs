import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4173';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const artifact = name => fileURLToPath(new URL(name, output));
const checks = [], errors = [], evidence = {};
const watch = page => page.on('pageerror', e => errors.push(e.message));
const running = page => page.waitForFunction(() => document.querySelector('#game').dataset.state === 'running');
async function start(page, sound = false) {
  if (!sound) await page.getByRole('button', { name: '音：オン', exact: true }).click();
  await page.getByRole('button', { name: 'タップしてスタート' }).click(); await running(page);
}
async function fullRoute(page) {
  return page.evaluate(() => {
    const { game: g, log } = window.__dogBoneTest;
    for (const bone of g.bones) {
      if (g.lane === bone.lane) continue;
      const at = bone.distance * 1000 - 300;
      g.advance(at - g.timeMs); g.command(Math.sign(bone.lane - g.lane)); g.advance(200);
    }
    g.advance(70_000);
    return { result: g.result(), events: log.events, runs: log.sessions.flatMap(s => s.runs) };
  });
}
async function resultLayout(page, height) {
  const bounds = await page.evaluate(() => [...document.querySelectorAll('#result p:not([hidden]), #result h2, #result button')]
    .filter(e => e.getClientRects().length).map(e => ({ text: e.textContent, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })));
  assert.ok(bounds.every(b => b.top >= 0 && b.bottom <= height + 1), JSON.stringify(bounds));
  assert.equal(await page.locator('#result-normal').textContent(), '63');
  assert.equal(await page.locator('#result-gold').textContent(), '2');
  assert.equal(await page.locator('#result-combo').textContent(), '65');
  assert.equal(await page.locator('#result-time').textContent(), '60.00秒');
}

const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [1280, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: 3 });
    const page = await context.newPage(); watch(page);
    await page.goto(`${base}/?test=1&seed=42&phase=2`);
    assert.equal(await page.locator('#game').getAttribute('data-phase'), '2');
    const layout = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, start: document.querySelector('#start').getBoundingClientRect().bottom }));
    assert.ok(layout.body <= width); assert.ok(layout.start <= height);
    if ([320, 390].includes(width)) await page.screenshot({ path: artifact(`phase2-ready-${width}.png`) });
    await start(page);
    const run = await fullRoute(page);
    assert.equal(run.result.collected, 65); assert.equal(run.result.normalCollected, 63); assert.equal(run.result.goldCollected, 2);
    assert.equal(run.result.distance, 60); assert.equal(run.result.timeMs, 60_000); assert.equal(run.result.maxCombo, 65);
    assert.equal(run.events.filter(e => e.type === 'obstacle_contact').length, 0, 'continuous safe route');
    assert.equal(run.runs[0].seed, 42); assert.deepEqual(run.runs[0].goldIds, run.result.goldIds); assert.equal(run.runs[0].ruleVersion, 'phase2-walk2-v1');
    assert.equal(await page.locator('#record-status').textContent(), '自己ベスト更新！');
    await resultLayout(page, height);
    if ([320, 390, 1280].includes(width)) await page.screenshot({ path: artifact(`phase2-result-${width}.png`) });
    if (width === 390) evidence.fullRoute = run.result;
    await page.reload();
    assert.match(await page.locator('#ready-record').textContent(), /ベスト .* 点 · 最大 65 コンボ/);
    assert.equal(await page.evaluate(() => localStorage.getItem('dog-bone-run:record:phase1-v2.1')), null);
    checks.push(`Phase 2 start/full safe route/result/reload ${width}×${height}`);
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); watch(page);
  await page.clock.install({ time: new Date('2026-10-03T12:00:00Z') });
  await page.goto(`${base}/?test=1&seed=42&phase=2`); await start(page);
  // Real RAF-driven distance progress: visit every fixed obstacle lane, including all puddles.
  const schedule = await page.evaluate(() => window.__dogBoneTest.game.obstacles.map(o => ({ ...o })));
  for (const obstacle of schedule) {
    const delta = await page.evaluate(d => { const g = window.__dogBoneTest.game; const gap = Math.max(0, d - 1.4 - g.distance), slowLeft = Math.max(0, g.slowUntilMs - g.timeMs) / 1000; return (gap <= slowLeft * g.speed ? gap / g.speed : slowLeft + gap - slowLeft * g.speed) * 1000; }, obstacle.distance);
    await page.clock.runFor(delta);
    let lane = await page.evaluate(() => window.__dogBoneTest.game.lane);
    while (lane !== obstacle.lane) {
      await page.keyboard.press(obstacle.lane > lane ? 'ArrowRight' : 'ArrowLeft');
      await page.clock.runFor(220); lane = await page.evaluate(() => window.__dogBoneTest.game.lane);
    }
    if (obstacle.id === 'obstacle-001') {
      await page.screenshot({ path: artifact('phase2-puddle-warning.png') });
    }
    await page.clock.runFor(1500);
    assert.ok(await page.evaluate(id => window.__dogBoneTest.log.events.some(e => e.type === 'obstacle_contact' && e.obstacleId === id), obstacle.id), JSON.stringify(await page.evaluate(() => ({ state: window.__dogBoneTest.game.state, t: window.__dogBoneTest.game.timeMs, d: window.__dogBoneTest.game.distance, lane: window.__dogBoneTest.game.lane, events: window.__dogBoneTest.log.events.slice(-12) }))));
    if (obstacle.id === 'obstacle-001') {
      assert.match(await page.locator('#clock').textContent(), /ぬれちゃった/);
      await page.getByRole('button', { name: '一時停止' }).click();
      const frozen = await page.evaluate(() => { const g = window.__dogBoneTest.game; return [g.timeMs, g.distance, g.slowUntilMs, g.suppressUntilMs, g.combo]; });
      await page.clock.runFor(5000);
      assert.deepEqual(await page.evaluate(() => { const g = window.__dogBoneTest.game; return [g.timeMs, g.distance, g.slowUntilMs, g.suppressUntilMs, g.combo]; }), frozen);
      await page.getByRole('button', { name: '再開する' }).click(); await running(page);
    }
    if (obstacle.id === 'obstacle-002') await page.screenshot({ path: artifact('phase2-trash-contact.png') });
  }
  const to60 = await page.evaluate(() => 60_000 - window.__dogBoneTest.game.timeMs);
  await page.clock.runFor(to60);
  assert.equal(await page.locator('#game').getAttribute('data-state'), 'running');
  const progress = await page.locator('#progress-fill').getAttribute('style'); assert.ok(!progress.includes('100%'));
  await page.clock.runFor(2000);
  assert.equal(await page.locator('#game').getAttribute('data-state'), 'result');
  evidence.obstacleRun = await page.evaluate(() => { const t = window.__dogBoneTest; return { result: t.game.result(), contacts: t.log.events.filter(e => e.type === 'obstacle_contact'), metrics: t.metrics.summary() }; });
  assert.equal(evidence.obstacleRun.result.timeMs, 61_600);
  assert.equal(evidence.obstacleRun.contacts.length, 8);
  assert.equal(await page.locator('#result-time').textContent(), '61.60秒');
  checks.push('RAF-driven all eight obstacle contacts, pause freezes effects, distance goal extends finish to61.60s');
  await context.close();

  const quitContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const quitPage = await quitContext.newPage(); watch(quitPage);
  await quitPage.goto(`${base}/?test=1&seed=42&phase=2`); await start(quitPage);
  await quitPage.evaluate(() => window.__dogBoneTest.game.advance(2000));
  await quitPage.getByRole('button', { name: '一時停止' }).click();
  await quitPage.getByRole('button', { name: 'おさんぽをやめる' }).click();
  const quitRecord = await quitPage.evaluate(() => JSON.parse(localStorage.getItem('dog-bone-run:record:phase2-walk2-v1')));
  assert.equal(quitRecord.highScore, 0); assert.equal(quitRecord.maxCombo, 1);
  await quitPage.reload(); assert.match(await quitPage.locator('#ready-record').textContent(), /最大 1 コンボ/);
  checks.push('quit retains achieved max combo but never updates incomplete score');
  await quitContext.close();

  const lifeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const life = await lifeContext.newPage(); watch(life);
  await life.goto(`${base}/?test=1&seed=42&phase=2`); await start(life, true); await fullRoute(life);
  for (let i = 0; i < 20; i++) {
    await life.getByRole('button', { name: 'もう一度', exact: true }).click(); await running(life);
    const fresh = await life.evaluate(() => { const t = window.__dogBoneTest; return [t.game.score, t.game.combo, t.game.distance, t.game.slowUntilMs, t.game.suppressUntilMs, t.game.goldCollected, t.game.normalCollected, t.game.seed, t.audio.contextCount]; });
    assert.deepEqual(fresh, [0, 0, fresh[2], 0, 0, 0, 0, 42, 1]); assert.ok(fresh[2] < .5);
    await fullRoute(life);
    assert.equal(await life.evaluate(() => window.__dogBoneTest.audio.voices.size), 0);
    assert.notEqual(await life.locator('#record-status').textContent(), '自己ベスト更新！');
  }
  const exported = await life.evaluate(() => window.__dogBoneTest.log.snapshot());
  assert.equal(exported.sessions.flatMap(s => s.runs).length, 21); assert.equal(exported.incomplete, false);
  for (const s of exported.sessions) for (const r of s.runs) {
    const times = exported.events.filter(e => e.runId === r.id).map(e => e.activeMs);
    assert.deepEqual(times, [...times].sort((a,b) => a-b), 'monotonic run log');
    assert.equal(r.phase, 2); assert.equal(r.seed, 42); assert.equal(r.goldIds.length, 2);
  }
  await writeFile(artifact('phase2-browser-log.json'), JSON.stringify(exported, null, 2));
  checks.push('20 retry cycles, one AudioContext, no remaining voices, unchanged records, seed and chronological logs');
  await lifeContext.close();

  for (const failure of ['write', 'getter', 'corrupt']) {
    const c = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const p = await c.newPage(); watch(p);
    await p.addInitScript(kind => {
      if (kind === 'write') Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
      if (kind === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
      if (kind === 'corrupt') localStorage.setItem('dog-bone-run:record:phase2-walk2-v1', '{broken');
    }, failure);
    await p.goto(`${base}/?test=1&seed=42&phase=2`);
    if (failure !== 'write') assert.match(await p.locator('#ready-record').textContent(), /読み込めません/);
    await start(p); await fullRoute(p);
    assert.equal(await p.locator('#game').getAttribute('data-state'), 'result');
    if (failure !== 'corrupt') assert.equal(await p.locator('#record-status').textContent(), '記録を保存できませんでした。');
    else {
      assert.equal(await p.locator('#record-status').textContent(), '自己ベスト更新！');
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('dog-bone-run:record:phase2-walk2-v1')).maxCombo), 65);
    }
    checks.push(`storage ${failure}: play continues and save status is truthful`); await c.close();
  }

  const production = await browser.newContext(); const prod = await production.newPage(); watch(prod);
  await prod.goto(`${base}/?seed=42&phase=2`);
  assert.equal(await prod.evaluate(() => '__dogBoneTest' in window), false);
  assert.equal(await prod.locator('#test-panel').isVisible(), false);
  checks.push('normal mode hides test API and ignores fixed test seed'); await production.close();
} finally { await browser.close(); }

const safari = await webkit.launch({ headless: true });
try {
  const c = await safari.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage(); watch(p); await p.goto(`${base}/?test=1&seed=42&phase=2`);
  await start(p, true); const run = await fullRoute(p); assert.equal(run.result.collected, 65);
  await p.screenshot({ path: artifact('phase2-webkit-result.png') });
  await p.reload(); assert.match(await p.locator('#ready-record').textContent(), /最大 65 コンボ/);
  checks.push('desktop WebKit Phase2 full route, audio unlock, records reload');
} finally { await safari.close(); }
assert.deepEqual(errors, []);
await writeFile(artifact('phase2-browser-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), checks, errors, evidence }, null, 2));
console.log(JSON.stringify({ checks, errors, evidence }, null, 2));
