import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/resolution-v36';
await mkdir(out,{recursive:true});const report={cases:[],errors:[]};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
  await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
  await page.locator('#start').click();await page.locator('#walk-level-4').click();await page.locator('#walk-picker-start').click();
  await page.waitForFunction(()=>window.__dogBoneTest.renderer.caveScene?.tunnel.stats.mode==='gpu-world-vault');
  const before=await page.evaluate(()=>{
   const t=window.__dogBoneTest,gpu=t.renderer.caveScene.tunnel.gpu;
   window.__caveLossExtension=gpu.gl.getExtension('WEBGL_lose_context');
   if(!window.__caveLossExtension)return {supported:false};
   window.__caveLossExtension.loseContext();return {supported:true,time:t.game.timeMs};
  });assert.equal(before.supported,true,'test browser must support forced context loss');
  await page.waitForFunction(()=>window.__dogBoneTest.renderer.caveScene.tunnel.gpu.contextLost);
  await page.waitForTimeout(800);
  const fallback=await page.evaluate(()=>({state:window.__dogBoneTest.game.state,time:window.__dogBoneTest.game.timeMs,stats:window.__dogBoneTest.renderer.caveScene.tunnel.stats}));
  assert.equal(fallback.state,'running');assert.ok(fallback.time>before.time+500);assert.notEqual(fallback.stats.mode,'gpu-world-vault');
  assert.ok(fallback.stats.width<=260&&fallback.stats.height<=420);
  await page.locator('#pause').click();const paused=await page.evaluate(()=>window.__dogBoneTest.game.timeMs);
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.timeMs),paused);
  await page.evaluate(()=>window.__caveLossExtension.restoreContext());
  await page.waitForFunction(()=>window.__dogBoneTest.renderer.caveScene.tunnel.gpu.available);
  await page.locator('#resume').click();await page.waitForTimeout(300);await page.locator('#pause').click();
  const recovered=await page.evaluate(()=>({mode:window.__dogBoneTest.renderer.caveScene.tunnel.stats.mode,pauses:window.__dogBoneTest.log.events.filter(e=>e.type==='pause')}));
  assert.equal(recovered.mode,'gpu-world-vault');assert.equal(recovered.pauses.filter(p=>p.reason==='stall').length,0);
  await page.locator('#game').screenshot({path:`${out}/${engine.name()}-gpu-restored.png`});
  report.cases.push({engine:engine.name(),forcedLoss:before,fallback,recovered});
  await context.close();

  for(const groundLevel of [2,3]){
  const park=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});const parkPage=await park.newPage();parkPage.on('pageerror',e=>report.errors.push(e.stack));
  await parkPage.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});await parkPage.locator('#start').click();await parkPage.locator(`#walk-level-${groundLevel}`).click();await parkPage.locator('#walk-picker-start').click();
  await parkPage.waitForFunction(level=>{const r=window.__dogBoneTest.renderer;return (level===2?r.parkLevel2Scene:r.mountainScene)?.art.groundGPU.stats.mode==='gpu-world-ground';},groundLevel);
  await parkPage.evaluate(level=>{const r=window.__dogBoneTest.renderer,a=(level===2?r.parkLevel2Scene:r.mountainScene).art;window.__testedGroundArt=a;const f=a.groundGPU.draw.bind(a.groundGPU);window.__parkFallbackDraws=0;a.groundGPU.draw=(...args)=>{const ok=f(...args);if(!ok)window.__parkFallbackDraws++;return ok;};window.__parkLoss=a.groundGPU.gl.getExtension('WEBGL_lose_context');window.__parkLoss.loseContext();},groundLevel);
  await parkPage.waitForFunction(()=>window.__parkFallbackDraws>0);
  assert.equal(await parkPage.evaluate(()=>window.__dogBoneTest.game.state),'running');await parkPage.locator('#pause').click();
  await parkPage.evaluate(()=>window.__parkLoss.restoreContext());await parkPage.waitForFunction(()=>window.__testedGroundArt.groundGPU.available);
  await parkPage.locator('#resume').click();await parkPage.waitForTimeout(250);await parkPage.locator('#pause').click();
  const parkRecovered=await parkPage.evaluate(()=>({stats:window.__testedGroundArt.groundGPU.stats,fallbackDraws:window.__parkFallbackDraws,stalls:window.__dogBoneTest.log.events.filter(e=>e.type==='pause'&&e.reason==='stall')}));
  assert.equal(parkRecovered.stats.mode,'gpu-world-ground');assert.deepEqual(parkRecovered.stalls,[]);report.cases.push({engine:engine.name(),groundLevel,groundLossRecovery:parkRecovered});await park.close();
  }

  const unavailable=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  await unavailable.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:original.call(this,kind,...args);};});
  const fallbackPage=await unavailable.newPage();fallbackPage.on('pageerror',e=>report.errors.push(e.stack));
  await fallbackPage.goto(`${origin}/tests/fixtures/resolution-preview.html?level=4`,{waitUntil:'networkidle'});
  await fallbackPage.waitForFunction(()=>window.__resolution?.ready?.ok);
  const noGpu=await fallbackPage.evaluate(()=>({stats:window.__resolution.renderer.caveScene.tunnel.stats,result:window.__resolution.game.result()}));
  assert.notEqual(noGpu.stats.mode,'gpu-world-vault');assert.equal(noGpu.result.contactCount,0);
  await fallbackPage.locator('#scene').screenshot({path:`${out}/${engine.name()}-gpu-unavailable.png`});
  report.cases.push({engine:engine.name(),noGpu});await unavailable.close();

  const failure=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  const failurePage=await failure.newPage();failurePage.on('pageerror',e=>report.errors.push(e.stack));
  await failurePage.route('**/art/resolution-v36/**',r=>r.abort());await failurePage.route('**/art/dog-walk-hd.*',r=>r.abort());await failurePage.route('**/art/cave-*/*.png',r=>r.abort());
  for(const level of [1,2,3,4]){
   await failurePage.goto(`${origin}/tests/fixtures/resolution-preview.html?level=${level}`,{waitUntil:'networkidle'});
   await failurePage.waitForFunction(()=>window.__resolution?.ready?.ok);
   const failed=await failurePage.evaluate(()=>{const p=window.__resolution;p.setFixture(20000,true);return {dog:p.renderer.dogs.stats,art:p.renderer.caveScene?.art.stats,result:p.game.result()};});
   assert.equal(failed.dog.walkHdReady,false);assert.equal(failed.dog.animationReady,true);
   if(level===4)assert.equal(failed.art.materials,'fallback');
   if(level>=2)assert.equal(failed.result.contactCount,0);
   await failurePage.locator('#scene').screenshot({path:`${out}/${engine.name()}-level${level}-images-failed.png`});
   report.cases.push({engine:engine.name(),level,imagesFailed:true,...failed});
  }
  await failure.close();

  const restricted=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  await restricted.addInitScript(()=>{
   localStorage.setItem('dog-bone-run:settings:v1',JSON.stringify({version:1,settings:{soundEnabled:false,musicEnabled:false,reducedMotion:false}}));
   const original=CanvasRenderingContext2D.prototype.getImageData;
   CanvasRenderingContext2D.prototype.getImageData=function(...args){if(this.canvas.id==='scene')throw new Error('Readback restricted for startup verification');return original.apply(this,args);};
  });
  const restrictedPage=await restricted.newPage();restrictedPage.on('pageerror',e=>report.errors.push(e.stack));
  await restrictedPage.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
  await restrictedPage.locator('#start').click();await restrictedPage.locator('#walk-level-1').click();await restrictedPage.locator('#walk-picker-start').click();
  await restrictedPage.waitForFunction(()=>['running','paused'].includes(window.__dogBoneTest.game.state));
  if(await restrictedPage.locator('#resume').isVisible())await restrictedPage.locator('#resume').click();
  await restrictedPage.locator('#pause').click();await restrictedPage.locator('#resume').click();
  await restrictedPage.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
  report.cases.push({engine:engine.name(),restrictedWarmup:true,controlsRecoverable:true});await restricted.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/recovery-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,errors:report.errors}));
