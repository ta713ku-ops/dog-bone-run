// Legacy fallback regression; the new default is covered by continuity-home/realtime.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
await mkdir('test-results',{recursive:true});
const errors=[],checks=[],requests=[];
const sample=page=>page.evaluate(()=>({home:window.__dogBoneTest.renderer.homeSample,busy:window.__dogBoneTest.renderer.homeBusy,time:window.__dogBoneTest.renderer.menuElapsedMs,offset:window.__dogBoneTest.renderer.homeClockOffset,walk:window.__dogBoneTest.renderer.dogs.lastSample,stats:window.__dogBoneTest.renderer.dogs.stats}));
const pixels=page=>page.evaluate(()=>document.querySelector('#scene').toDataURL());
async function open(browser,width,height,{failure=false,prod=false}={}){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,deviceScaleFactor:2});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 // Exercise the older 20-frame home fallback intentionally.
 await page.route('**/art/dog-home-*.webp*',r=>r.abort());
 if(failure)await page.route('**/art/*-animated.webp*',r=>r.abort());
 if(!prod&&!failure){await page.clock.install({time:new Date('2026-10-05T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));}
 await page.route('**/dog-home-continuity.json*',route=>route.abort());
 await page.goto(`http://127.0.0.1:${prod?4183:4182}/?test=1&seed=42&v=${CONFIG.buildVersion}`);
 await page.waitForLoadState('domcontentloaded');await page.waitForFunction(()=>!document.querySelector('#start').disabled,undefined,{polling:100});
 if(!prod&&!failure)await page.clock.runFor(50);
 return{context,page};
}
for(const engine of [chromium,webkit].filter(e=>!process.env.DOG_ENGINE||e.name()===process.env.DOG_ENGINE)){
 const browser=await engine.launch({headless:true});
 try{
  for(const [width,height] of [[320,568],[390,844],[430,932]]){
   console.log(`checking ${engine.name()} ${width}`);
   const {context,page}=await open(browser,width,height);
   const first=await sample(page);assert.equal(first.stats.mode,'authored-image-animation');assert.equal(first.stats.textureCount,3);
   assert.ok(first.stats.compressedBytes<1_000_000);assert.ok(first.stats.decodedBytes<18_000_000);
   const bounds=await page.locator('#ready').evaluate(root=>{
    const game=root.parentElement.getBoundingClientRect();
    return [...root.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect();return{id:el.id,width:r.width,height:r.height,inside:r.top>=game.top&&r.bottom<=game.bottom&&r.left>=game.left&&r.right<=game.right};});
   });assert.ok(bounds.every(b=>b.inside&&b.width>=44&&b.height>=44),JSON.stringify(bounds));
   await page.screenshot({path:`test-results/animated-home-${engine.name()}-${width}.png`});
   await page.locator('#ready-settings').click();await page.clock.runFor(30);
   const frozen=await pixels(page),frozenPose=(await sample(page)).home;
   await page.clock.runFor(1200);const afterFrozen=await sample(page);console.log('freeze',JSON.stringify({engine:engine.name(),width,before:frozenPose,after:afterFrozen.home,time:afterFrozen.time}));assert.ok(await pixels(page)===frozen,'settings must freeze canvas pixels');assert.deepEqual(afterFrozen.home,frozenPose);
   await page.locator('#ready-sound').click();await page.locator('#settings-close').click();
   const advanceTo=async target=>{const now=(await sample(page)).time;await page.clock.runFor(Math.max(0,target-now));};
   await advanceTo(3500);assert.equal((await sample(page)).home.action,'head-tilt-left');
   await advanceTo(10100);assert.equal((await sample(page)).home.index,3);
   await page.screenshot({path:`test-results/animated-sit-${engine.name()}-${width}.png`});
   await advanceTo(19400);assert.equal((await sample(page)).home.index,8);
   await page.screenshot({path:`test-results/animated-lie-${engine.name()}-${width}.png`});
   await advanceTo(30000);assert.equal((await sample(page)).home.index,10);
   await advanceTo(36100);assert.equal((await sample(page)).home.atlas,'expressions');
   const homeBefore=(await sample(page)).home;
   await page.locator('#home-sit').click();assert.equal(await page.locator('#home-lie').isDisabled(),true);
   await page.clock.runFor(1650);assert.equal((await sample(page)).home.index,3);
   await page.clock.runFor(3000);assert.equal((await sample(page)).busy,false);assert.equal((await sample(page)).home.atlas,homeBefore.atlas);
   await page.locator('#home-lie').click();await page.clock.runFor(2750);assert.equal((await sample(page)).home.index,8);
   await page.clock.runFor(4300);assert.equal((await sample(page)).busy,false);
   await page.locator('#home-greet').click();await page.clock.runFor(500);assert.equal((await sample(page)).home.index,5);
   await page.clock.runFor(1150);assert.equal((await sample(page)).busy,false);
   // Real game events trigger both a dog reaction and the reward effect while gait continues.
   await page.locator('#start').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   await page.evaluate(()=>{const g=window.__dogBoneTest.game;g.obstacles=[];g.bones=[{id:'reward',lane:0,distance:.35,status:'pending',kind:'gold'}];});
   await page.clock.runFor(350);
   const reward=await page.evaluate(()=>({score:window.__dogBoneTest.game.score,reaction:window.__dogBoneTest.renderer.pickupReaction,effects:window.__dogBoneTest.renderer.effects}));
   assert.ok(reward.score>0);assert.ok(reward.reaction.weight>0);assert.ok(reward.effects.some(e=>e.type==='collect'));
   if(width===390)await page.screenshot({path:`test-results/animated-pickup-${engine.name()}.png`});
   const indices=new Set();
   for(let i=0;i<16;i++){await page.clock.runFor(50);indices.add((await sample(page)).walk.index);}
   assert.equal(indices.size,8,`all eight authored walk frames must run: ${[...indices]}`);
   await page.locator('#pause').click();await page.clock.runFor(30);const walkFrozen=(await sample(page)).walk,pausedPixels=await pixels(page);
   await page.clock.runFor(1400);assert.deepEqual((await sample(page)).walk,walkFrozen);assert.ok(await pixels(page)===pausedPixels,'pause must freeze pixels');
   await page.locator('#quit').click();await page.locator('#ready-settings').click();await page.locator('#reduce-motion').check();await page.locator('#settings-close').click();
   await page.locator('#home-lie').click();await page.clock.runFor(30);assert.equal((await sample(page)).home.index,8);
   const still=await pixels(page);await page.clock.runFor(1000);assert.ok(await pixels(page)===still,'reduced motion must freeze pixels');
   await page.locator('#start').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');await page.clock.runFor(400);
   assert.equal((await sample(page)).walk.index,0);assert.equal((await sample(page)).walk.mix,0);
   checks.push({engine:engine.name(),width,height,autoSitLie:true,gestures:true,walkFrames:indices.size,pickupReaction:true,pausePixels:true,reducedMotion:true});
   await context.close();
  }
  const normal=await open(browser,390,844,{prod:true});
  assert.equal(await normal.page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
  await normal.page.locator('#home-lie').click();await normal.page.waitForFunction(()=>document.querySelector('#home-sit').disabled);
  await normal.context.close();
  const fallback=await open(browser,390,844,{failure:true});
  assert.equal((await sample(fallback.page)).stats.mode,'photo-reference-sprites');assert.equal((await sample(fallback.page)).stats.animationReady,false);
  assert.equal(await fallback.page.locator('#home-sit').isDisabled(),true);assert.match(await fallback.page.locator('#home-dog-status').textContent(),/おさんぽは遊べます/);
  await fallback.context.close();
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);
const version=JSON.parse(await readFile('dist/version.json','utf8'));
assert.ok(version.modules.every(p=>!/(raising-|home-scene|home-idle|dog-3d-)/.test(p)));
assert.ok(version.modules.includes('src/sprite-animation.js'));
await writeFile('test-results/sprite-animation-browser-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,checks,errors,production:version,requests:[...new Set(requests)]},null,2));
console.log(JSON.stringify({buildVersion:CONFIG.buildVersion,cases:checks.length,errors},null,2));
