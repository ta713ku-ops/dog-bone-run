import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4174';
const output = new URL('../test-results/', import.meta.url); await mkdir(output,{recursive:true});
const errors=[], checks=[], evidence=[], resources=[];
const artifact=name=>fileURLToPath(new URL(name,output));
async function ready(p) {
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=> {if(/\.(js|css|png|json)(\?|$)/.test(r.url()))resources.push({url:r.url(),status:r.status(),cache:r.headers()['cache-control']});});
  await p.clock.install({time:new Date('2026-10-04T00:00:00Z')});
  await p.clock.pauseAt(new Date('2026-10-04T00:00:01Z'));
  await p.goto(`${base}/?test=1&seed=42&v=${CONFIG.buildVersion}`);await p.waitForLoadState('networkidle');
  await p.waitForFunction(()=>window.__dogBoneTest.renderer.dogs?.stats.ready);
  // Let one RAF paint the decoded images before taking the ready screenshot.
  await p.clock.runFor(50);
  assert.ok((await p.locator('#build-label').textContent()).includes(`v${CONFIG.buildVersion}`));
  assert.match(await p.locator('#intro-note').textContent(),/30秒/);
  assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.phase),4);
}
async function start(p) {
  await p.getByRole('button',{name:'音：オン',exact:true}).click();
  await p.getByRole('button',{name:'タップしてスタート'}).click();
  await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
}
async function route(p, pauseOnce=false) {
  const bones=await p.evaluate(()=>window.__dogBoneTest.game.bones.map(b=>({at:b.distance*1000-300,lane:b.lane})));
  let paused=false;
  for(const b of bones) {
    const time=await p.evaluate(()=>window.__dogBoneTest.game.timeMs);
    await p.clock.runFor(Math.max(0,b.at-time));
    if(pauseOnce&&!paused&&b.at>5000) {
      const remaining=await p.locator('#clock').textContent();
      await p.getByRole('button',{name:'一時停止',exact:true}).click();
      const frozen=await p.evaluate(()=>window.__dogBoneTest.game.timeMs);
      await p.clock.runFor(5000);
      assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.timeMs),frozen);
      assert.equal(await p.locator('#clock').textContent(),remaining);
      await p.getByRole('button',{name:'再開する',exact:true}).click();paused=true;
    }
    const lane=await p.evaluate(()=>window.__dogBoneTest.game.lane);
    if(lane!==b.lane) await p.keyboard.press(b.lane>lane?'ArrowRight':'ArrowLeft');
    await p.clock.runFor(200);
  }
  const time=await p.evaluate(()=>window.__dogBoneTest.game.timeMs);
  await p.clock.runFor(30000-time+50);
  const value=await p.evaluate(()=>({result:window.__dogBoneTest.game.result(),contacts:window.__dogBoneTest.log.events.filter(e=>e.type==='obstacle_contact'),level:window.__dogBoneTest.game.difficultyLevel}));
  assert.equal(value.result.completed,true,JSON.stringify(value));assert.equal(value.result.timeMs,30000);
  assert.equal(value.result.collected,value.result.placed);assert.deepEqual(value.contacts,[]);assert.equal(value.level,6);
  assert.equal(await p.locator('#result-time').textContent(),'30.00秒');
  return value;
}
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch({headless:true});
 try {
  for(const [width,height] of engine===chromium?[[320,568],[375,667],[390,844],[430,932],[768,1024],[1280,900]]:[[390,844]]) {
   const context=await browser.newContext({viewport:{width,height},hasTouch:width<500});const p=await context.newPage();await ready(p);
   await p.evaluate(()=>localStorage.setItem('dog-bone-run:record:phase3-walk3-v1',JSON.stringify({version:1,highScore:9999,maxCombo:65})));
   if([320,390].includes(width))await p.screenshot({path:artifact(`sprint-ready-${engine.name()}-${width}.png`)});
   const buttons=await p.locator('#start').boundingBox();assert.ok(buttons.y+buttons.height<=height);
   await start(p);assert.match(await p.locator('#clock').textContent(),/30\.0秒.*難易度1/);
   const result=await route(p,width===390);evidence.push({engine:engine.name(),width,height,...result});
   const storage=await p.evaluate(()=>({old:JSON.parse(localStorage.getItem('dog-bone-run:record:phase3-walk3-v1')),fresh:JSON.parse(localStorage.getItem('dog-bone-run:record:sprint30-hard-v1'))}));
   assert.equal(storage.old.highScore,9999);assert.equal(storage.fresh.highScore,result.result.score);
   const bounds=await p.evaluate(()=>[...document.querySelectorAll('#result p,#result h2,#result button')].filter(e=>e.getClientRects().length).map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,text:e.textContent})));
   if(!bounds.every(b=>b.top>=0&&b.bottom<=height+1)) {
    await p.screenshot({path:artifact('sprint-result-layout-failure.png')});
    await writeFile(artifact('sprint-result-layout-failure.json'),JSON.stringify(await p.evaluate(()=>({width:innerWidth,height:innerHeight,scrollY,gameScroll:document.querySelector('#game').scrollTop,gameRect:document.querySelector('#game').getBoundingClientRect().toJSON(),resultRect:document.querySelector('#result').getBoundingClientRect().toJSON()})),null,2));
   }
   assert.ok(bounds.every(b=>b.top>=0&&b.bottom<=height+1),JSON.stringify(bounds));
   await p.screenshot({path:artifact(`sprint-result-${engine.name()}-${width}.png`)});
   await context.close();checks.push(`${engine.name()} ${width}×${height}: 30s complete, all bones, no hazard contact, separate records, visible result${width===390?', 5s pause excluded':''}`);
  }
  const p=await browser.newPage({viewport:{width:390,height:844}});await ready(p);await start(p);
  await p.evaluate(()=> {const g=window.__dogBoneTest.game;g.obstacles=[{id:'water-fixture',type:'puddle',lane:0,distance:2,status:'pending'}];g.bones=[];});
  await p.clock.runFor(30500);const water=await p.evaluate(()=>window.__dogBoneTest.game.result());
  assert.equal(water.timeMs,30000);assert.equal(water.completed,true);assert.ok(Math.abs(water.distance-29.6)<1e-6);checks.push(`${engine.name()}: water fixture slows distance, ends at 30s`);
  await p.getByRole('button',{name:'もう一度',exact:true}).click();
  await p.evaluate(()=>{const g=window.__dogBoneTest.game;g.obstacles=[{id:'hole-fixture',type:'hole',lane:0,distance:2,status:'pending'}];g.bones=[];});
  await p.clock.runFor(2600);const death=await p.evaluate(()=>window.__dogBoneTest.game.result());
  assert.equal(death.endReason,'hole');assert.equal(death.completed,false);assert.ok(death.timeMs<2000);
  assert.equal(await p.locator('#game').getAttribute('data-state'),'result');assert.equal(await p.locator('#result-time-label').textContent(),'到達率');
  checks.push(`${engine.name()}: early hole failure remains game over`);await p.close();
 } finally {await browser.close();}
}
if(base.includes(':4174')) {
 assert.ok(resources.length>0);for(const r of resources){assert.equal(new URL(r.url).searchParams.get('v'),CONFIG.buildVersion,r.url);assert.equal(r.status,200);assert.equal(r.cache,'no-store');}
 checks.push('built page: all runtime JS/CSS/dog images and metadata use current version and no-store');
}
assert.deepEqual(errors,[]);
await writeFile(artifact('sprint-browser-results.json'),JSON.stringify({checks,errors,evidence,resources:[...new Map(resources.map(r=>[r.url,r])).values()]},null,2));
console.log(JSON.stringify({checks,errors,evidence},null,2));
