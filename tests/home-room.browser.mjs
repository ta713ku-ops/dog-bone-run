import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.DOG_RESULTS_DIR||'test-results/home-room-v17';await mkdir(out,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
   await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>__dogBoneTest.renderer.dogs.stats.continuityReady);await page.clock.runFor(30);
   assert.equal(await page.locator('#title').textContent(),'おうちで、ひとやすみ。');
   const imageBackdrops=await page.evaluate(()=>!!__dogBoneTest.renderer.room.assetStates);
   if(imageBackdrops) await page.waitForFunction(()=>Object.values(__dogBoneTest.renderer.room.assetStates).every(s=>s==='ready'));
   await page.clock.runFor(30);
   const before=await page.evaluate(()=>__dogBoneTest.renderer.room.buildCount);
   await page.clock.runFor(500);assert.equal(await page.evaluate(()=>__dogBoneTest.renderer.room.buildCount),before,'background reused each frame');
   // Observe the actual Renderer routing, independently of room geometry.
   await page.evaluate(()=>{
    window.__roomCalls={room:0,outdoor:0,bone:0};const r=__dogBoneTest.renderer;
    for(const [owner,key,counter] of [[r.room,'draw','room'],[r.adventure,'draw','outdoor'],[r,'bone','bone']]){const original=owner[key];owner[key]=function(...args){__roomCalls[counter]++;return original.apply(this,args);};}
   });
   await page.clock.runFor(100);const homeCalls=await page.evaluate(()=>({...__roomCalls}));assert.ok(homeCalls.room>0);assert.equal(homeCalls.outdoor,0);assert.equal(homeCalls.bone,0,'no collectible bone in the room');
   await page.locator('#ready-settings').click();await page.clock.runFor(30);const frozen=await page.locator('#scene').screenshot();await page.clock.runFor(1000);assert.ok(frozen.equals(await page.locator('#scene').screenshot()),'settings freeze accepted dog motion');
   await page.locator('#ready-sound').click();await page.locator('#settings-close').click();
   for(const action of ['sit','lie','greet']){
    await page.locator('#home-'+action).click();await page.clock.runFor(4500);
    assert.equal(await page.evaluate(()=>__dogBoneTest.renderer.homeBusy),false);
    const pose=await page.evaluate(()=>__dogBoneTest.renderer.homeSample);
    if(action!=='greet'){assert.equal(pose.index,47);assert.equal(pose.atlas,action==='sit'?'sitdown':'liedown');}
   }
   const resized=[];
   for(const [width,height] of [[320,480],[430,932],[568,320],[844,390],[390,844]]){
    await page.setViewportSize({width,height});await page.clock.runFor(100);await page.waitForFunction(({width,height})=>{const r=__dogBoneTest.renderer,b=r.canvas.getBoundingClientRect();return r.width===b.width&&r.height===b.height;},{width,height});await page.clock.runFor(100);
    const count=await page.evaluate(()=>__dogBoneTest.renderer.room.buildCount);resized.push({width,height,count});await page.screenshot({path:`${out}/${engine.name()}-room-${width}x${height}.png`});
   }
   assert.ok(resized.at(-1).count>before,'resize rebuilds cached background');
   await page.locator('#start').click();await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
   await page.evaluate(()=>{__roomCalls.room=0;__roomCalls.outdoor=0;__dogBoneTest.game.bones=[];__dogBoneTest.game.obstacles=[];});await page.clock.runFor(100);
   const runCalls=await page.evaluate(()=>({...__roomCalls}));assert.equal(runCalls.room,0);assert.ok(runCalls.outdoor>0,'walk retains outdoor scene');
   await page.locator('#pause').click();await page.locator('#quit').click();await page.clock.runFor(100);assert.equal(await page.locator('#game').getAttribute('data-state'),'ready');assert.equal(await page.locator('#title').textContent(),'おうちで、ひとやすみ。');
   assert.deepEqual(errors,[]);results.push({engine:engine.name(),imageBackdrops,before,resized,homeCalls,runCalls,errors});
  }catch(e){await page.screenshot({path:`${out}/${engine.name()}-failure.png`});throw e;}
  finally{await context.close();}
  if(results.at(-1)?.imageBackdrops){
   const fallback=await browser.newContext({viewport:{width:390,height:844}}),fallbackPage=await fallback.newPage(),fallbackErrors=[];
   fallbackPage.on('pageerror',e=>fallbackErrors.push(e.message));
   try{
    await fallbackPage.route('**/art/home-room/*.webp*',route=>route.abort());
    await fallbackPage.goto(`http://127.0.0.1:4182/?test=1&v=${CONFIG.buildVersion}`);
    await fallbackPage.waitForFunction(()=>Object.values(__dogBoneTest.renderer.room.assetStates).every(s=>s==='error')&&!document.querySelector('#start').disabled);
    const state=await fallbackPage.evaluate(()=>({states:__dogBoneTest.renderer.room.assetStates,key:__dogBoneTest.renderer.room.cacheKey}));
    assert.ok(!state.key.startsWith('image:'),'failed art uses cached procedural room');
    await fallbackPage.screenshot({path:`${out}/${engine.name()}-room-image-fallback.png`});
    await fallbackPage.locator('#ready-settings').click();await fallbackPage.locator('#ready-sound').click();await fallbackPage.locator('#settings-close').click();
    await fallbackPage.locator('#start').click();await fallbackPage.waitForFunction(()=>__dogBoneTest.game.state==='running');
    await fallbackPage.locator('#pause').click();await fallbackPage.locator('#quit').click();
    assert.equal(await fallbackPage.locator('#game').getAttribute('data-state'),'ready');assert.deepEqual(fallbackErrors,[]);
    results.push({engine:engine.name(),imageFallback:true,...state,errors:fallbackErrors});
   }finally{await fallback.close();}
  }
 }finally{await browser.close();}
}
await writeFile(`${out}/room-results.json`,JSON.stringify({version:CONFIG.buildVersion,physicalIPhone:false,results},null,2));console.log('Room cache, home-only routing, gestures, settings freeze, resize and departure/return passed in both engines');
