import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4173';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
const errors = [];
const requests = [];
try {
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => requests.push({url:request.url(),failure:request.failure()?.errorText}));
  await page.goto(`${base}/?test=1&seed=42`);
  await page.waitForLoadState('networkidle');
  try {
    await page.waitForFunction(() => window.__dogBoneTest?.renderer.dogs?.stats.ready);
  } catch(error) {
    const state = await page.evaluate(() => ({dog:window.__dogBoneTest?.renderer.dogs?.stats,
      hookPresent:!!window.__dogBoneTest,caption:document.querySelector('#ready-record')?.textContent}));
    await writeFile(new URL('phase4-real-time-load-error.json',output),JSON.stringify({errors,requests,state},null,2));
    throw error;
  }
  await page.getByRole('button',{name:'タップしてスタート'}).click();
  await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
  await page.evaluate(() => {
    const g = window.__dogBoneTest.game;
    const moves = [];
    let lane = 0;
    for (const bone of g.bones) {
      if (lane !== bone.lane) moves.push({at:bone.distance*1000-300,lane:bone.lane});
      lane = bone.lane;
    }
    let index = 0;
    const scenicSamples = [];
    window.__dogBoneTest.scenicSamples = scenicSamples;
    const steer = () => {
      if (g.state !== 'running') return;
      if (scenicSamples.length < 3 && g.timeMs >= [2500,13500,23500][scenicSamples.length]) {
        const r = window.__dogBoneTest.renderer;
        scenicSamples.push({timeMs:g.timeMs,width:r.width,foot:[-1,0,1].map(l=>r.project(l,0).x),far:r.project(0,3.2).x,title:document.querySelector('#trail-label').textContent});
      }
      if (index < moves.length && g.timeMs >= moves[index].at) {
        g.command(Math.sign(moves[index].lane-g.lane));
        index++;
      }
      requestAnimationFrame(steer);
    };
    requestAnimationFrame(steer);
  });
  await page.waitForFunction(() => window.__dogBoneTest.game.timeMs >= 13500, null, {timeout:20000});
  await page.screenshot({path:fileURLToPath(new URL('adventure-live-forest-390.png',output))});
  // Actual RAF and AudioContext clocks; no advance API or simulated clock.
  await page.waitForFunction(() => window.__dogBoneTest.game.state !== 'running', null, {timeout:45000});
  const evidence = await page.evaluate(() => {
    const {game,audio,renderer,log,metrics,scenicSamples} = window.__dogBoneTest;
    return {scope:'desktop Chromium actual RAF; automated steering; not physical iPhone',
      result:game.result(),frames:metrics.summary(),spriteStats:renderer.dogs.stats,scenicSamples,
      audio:{voices:audio.voices.size,contexts:audio.contextCount,musicRunning:audio.musicRunning},
      contacts:log.events.filter(e=>e.type==='obstacle_contact'),
      pauses:log.events.filter(e=>e.type==='pause')};
  });
  await writeFile(new URL('phase4-real-time-results.json',output),JSON.stringify({errors,...evidence},null,2));
  assert.equal(evidence.result.completed,true,JSON.stringify(evidence));
  assert.equal(evidence.result.collected,evidence.result.placed);assert.ok(evidence.result.score>0);
  assert.equal(evidence.result.timeMs,30000);assert.deepEqual(evidence.contacts,[]);
  assert.deepEqual(evidence.audio,{voices:0,contexts:1,musicRunning:false});
  assert.deepEqual(evidence.scenicSamples.map(s=>s.title),['家並みの道','庭木のある通り','塀沿いの道']);
  for(const sample of evidence.scenicSamples) {
    for(const [index,lane] of [-1,0,1].entries())assert.ok(Math.abs(sample.foot[index]-sample.width*(.5+lane*.235))<.001);
    assert.ok(Math.abs(sample.far-sample.width*.5)>.01);
    assert.ok(Math.abs(sample.far-sample.width*.5)<=sample.width*.095+.001);
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:fileURLToPath(new URL('phase4-result-390.png',output))});
  console.log(JSON.stringify({errors,...evidence},null,2));
} finally {await browser.close();}
