import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-direction/lifecycle';await mkdir(out,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await page.evaluate(async()=>{await __dogBoneTest.renderer.ready;await __dogBoneTest.renderer.dogs.directionReady;});
  await page.waitForFunction(()=>!document.querySelector('#home-touch').disabled);
  await page.evaluate(()=>{
   const r=__dogBoneTest.renderer;r.setMenuPaused(true);r.homeHeldFrame=null;r.homeInteraction=null;r.homeAttention=null;r.homeClockOffset=0;r.menuElapsedMs=1500;r.resetHomeAutonomy();r.homeAutonomyReady=true;r.homeAutonomy.reset(0,'stand');r.homeAutoGesture={action:'look-left',startedAt:0,durationMs:4000,rest:{headRest:0,eyeRest:0}};r.updateHomeSample(1500);
  });
  assert.equal(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.headYaw),-.86);
  await page.locator('#home-touch').tap();
  const calling=await page.evaluate(()=>{const r=__dogBoneTest.renderer;r.menuElapsedMs+=700;return r.updateHomeSample(r.menuElapsedMs).headYaw;});assert.ok(Math.abs(calling)<.02);
  const returned=await page.evaluate(()=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=r.homeAttention.startedAt+2400;return r.updateHomeSample(r.menuElapsedMs).headYaw;});assert.ok(Math.abs(returned+.86)<1e-5);
  await page.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy,{},{timeout:2000}).catch(async error=>{console.log(JSON.stringify(await page.evaluate(()=>({clock:__dogBoneTest.renderer.menuElapsedMs,busy:__dogBoneTest.renderer.homeBusy,attention:__dogBoneTest.renderer.homeAttention,interaction:__dogBoneTest.renderer.homeInteraction}))));throw error;});
  await page.locator('#home-sit').tap();
  const handoff=await page.evaluate(()=>{const r=__dogBoneTest.renderer;const start=r.updateHomeSample(r.menuElapsedMs).headYaw;r.menuElapsedMs+=350;const half=r.updateHomeSample(r.menuElapsedMs).headYaw;r.menuElapsedMs+=2000;const end=r.updateHomeSample(r.menuElapsedMs).headYaw;return{start,half,end};});
  assert.ok(Math.abs(handoff.start+.86)<.02);assert.ok(handoff.half<0&&handoff.half>handoff.start);assert.equal(handoff.end??0,0);
  await page.evaluate(()=>{const r=__dogBoneTest.renderer;const clock=r.homeClockAt(r.menuElapsedMs);r.homeAutoGesture={action:'look-right',startedAt:clock-1500,durationMs:4000,rest:{headRest:0,eyeRest:0}};r.updateHomeSample(r.menuElapsedMs);});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  const frozen=await page.evaluate(()=>({sample:__dogBoneTest.renderer.homeSample,png:document.querySelector('#scene').toDataURL()}));
  await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample),frozen.sample);
  assert.equal(await page.evaluate(()=>document.querySelector('#scene').toDataURL()),frozen.png);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(60);
  assert.ok(Math.abs(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.headYaw)-frozen.sample.headYaw)<1e-5);
  await page.screenshot({path:`${out}/${engine.name()}-resumed.png`});
  assert.deepEqual(errors,[]);results.push({engine:engine.name(),calling,returned,handoff,reducedPixelFreeze:true,errors});
  const fallback=await browser.newPage({viewport:{width:390,height:844}});
  await fallback.route('**/art/dog-direction/metadata.json',route=>route.fulfill({status:404,body:'not found'}));
  await fallback.goto('http://127.0.0.1:4182/?test=1');await fallback.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await fallback.evaluate(async()=>{await __dogBoneTest.renderer.ready;await __dogBoneTest.renderer.dogs.directionReady;});
  assert.equal(await fallback.evaluate(()=>__dogBoneTest.renderer.dogs.stats.directionReady),false);assert.equal(await fallback.locator('#home-sit').isEnabled(),true);await fallback.close();
 }finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
