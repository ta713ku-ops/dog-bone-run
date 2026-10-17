import {confirmDeparture} from './browser-departure.mjs';
// Legacy fallback regression; the new default is covered by continuity-home/realtime.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
await mkdir('test-results',{recursive:true});
const errors=[],checks=[],requests=[];
const sample=page=>page.evaluate(()=>({home:window.__dogBoneTest.renderer.homeSample,busy:window.__dogBoneTest.renderer.homeBusy,time:window.__dogBoneTest.renderer.menuElapsedMs,offset:window.__dogBoneTest.renderer.homeClockOffset,walk:window.__dogBoneTest.renderer.dogs.lastSample,stats:window.__dogBoneTest.renderer.dogs.stats}));
const pixels=page=>page.evaluate(()=>document.querySelector('#scene').toDataURL());
async function open(browser,width,height,{failure=false,homeFailure=false,prod=false}={}){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,deviceScaleFactor:2});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 if(homeFailure)await page.route('**/art/dog-home-*.webp*',r=>r.abort());
 if(failure)await page.route('**/art/*-animated.webp*',r=>r.abort());
 if(!prod&&!failure&&!homeFailure){await page.clock.install({time:new Date('2026-10-06T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-06T00:00:01Z'));}
 await page.route('**/dog-home-continuity.json*',route=>route.abort());
 await page.goto(`http://127.0.0.1:${prod?4183:4182}/?test=1&seed=42&v=${CONFIG.buildVersion}`);
 await page.waitForLoadState('domcontentloaded');await page.waitForFunction(()=>!document.querySelector('#start').disabled,undefined,{polling:100});
 if(!prod&&!failure&&!homeFailure)await page.clock.runFor(50);
 return{context,page};
}
for(const engine of [chromium,webkit].filter(e=>!process.env.DOG_ENGINE||e.name()===process.env.DOG_ENGINE)){
 const browser=await engine.launch({headless:true});
 try{
  for(const [width,height] of [[320,568],[390,844],[430,932]]){
   console.log(`checking ${engine.name()} ${width}`);
   const {context,page}=await open(browser,width,height);
   const first=await sample(page);assert.equal(first.stats.mode,'authored-image-animation');assert.equal(first.stats.textureCount,8);assert.equal(first.stats.homeMotionReady,true);assert.equal(first.stats.homeFrames,100);
   assert.ok(first.stats.compressedBytes<4_000_000);assert.ok(first.stats.decodedBytes<64_000_000);
   const bounds=await page.locator('#ready').evaluate(root=>{
    const game=root.parentElement.getBoundingClientRect();
    return [...root.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect();return{id:el.id,width:r.width,height:r.height,inside:r.top>=game.top&&r.bottom<=game.bottom&&r.left>=game.left&&r.right<=game.right};});
   });assert.ok(bounds.every(b=>b.inside&&b.width>=44&&b.height>=44),JSON.stringify(bounds));
   await page.screenshot({path:`test-results/dense-home-home-${engine.name()}-${width}.png`});
   await page.locator('#ready-settings').click();await page.clock.runFor(30);
   const frozen=await pixels(page),frozenPose=(await sample(page)).home;
   await page.clock.runFor(1200);const afterFrozen=await sample(page);console.log('freeze',JSON.stringify({engine:engine.name(),width,before:frozenPose,after:afterFrozen.home,time:afterFrozen.time}));assert.ok(await pixels(page)===frozen,'settings must freeze canvas pixels');assert.deepEqual(afterFrozen.home,frozenPose);
   await page.locator('#ready-sound').click();await page.locator('#settings-close').click();
   const advanceTo=async target=>{const now=(await sample(page)).time;await page.clock.runFor(Math.max(0,target-now));};
   await advanceTo(3500);assert.equal((await sample(page)).home.action,'head-tilt-left');
   await advanceTo(10100);assert.equal((await sample(page)).home.index,15);
   await page.screenshot({path:`test-results/dense-home-sit-${engine.name()}-${width}.png`});
   await advanceTo(19400);assert.equal((await sample(page)).home.index,15);
   await page.screenshot({path:`test-results/dense-home-lie-${engine.name()}-${width}.png`});
   await advanceTo(30000);assert.equal((await sample(page)).home.index,15);
   await advanceTo(36100);assert.equal((await sample(page)).home.atlas,'sitdown');
   const frameSets={};
   for(const [key,start] of [['sitdown',8000],['liedown',17200]]){
    // Reset only the menu clock to inspect the real renderer at many authored phases.
    await page.evaluate(t=>{const r=window.__dogBoneTest.renderer;r.menuElapsedMs=t;r.menuLastFrameNow=performance.now();},start);
    const indices=new Set(),fractional=[];
    for(let i=0;i<36;i++){
     await page.clock.runFor(33);const pose=(await sample(page)).home;
     for(const layer of pose.layers??[{atlas:pose.atlas,index:pose.index,weight:1}])if(layer.atlas===key&&layer.weight>0)indices.add(layer.index);
     if(pose.atlas===key&&pose.mix>0&&pose.mix<1)fractional.push(pose.mix);
    }
    assert.ok(indices.size>=12,`${key} must visibly use intermediate images: ${[...indices]}`);
    assert.ok(fractional.length>=12,`${key} must blend throughout motion, not only at the last instant`);
    frameSets[key]=[...indices];
   }
   await page.evaluate(()=>{const r=window.__dogBoneTest.renderer;r.menuElapsedMs=36100;r.menuLastFrameNow=performance.now();});await page.clock.runFor(32);
   const homeBefore=(await sample(page)).home;
   await page.locator('#home-sit').click();assert.equal(await page.locator('#home-lie').isDisabled(),true);
   await page.clock.runFor(1650);assert.equal((await sample(page)).home.index,15);
   await page.clock.runFor(3000);assert.equal((await sample(page)).busy,false);assert.equal((await sample(page)).home.atlas,homeBefore.atlas);
   await page.locator('#home-lie').click();await page.clock.runFor(2750);assert.equal((await sample(page)).home.index,15);
   await page.clock.runFor(4300);assert.equal((await sample(page)).busy,false);
   await page.locator('#home-greet').click();await page.clock.runFor(500);assert.equal((await sample(page)).home.atlas,'greet');
   await page.clock.runFor(1150);assert.equal((await sample(page)).busy,false);
   // Real game events trigger both a dog reaction and the reward effect while gait continues.
   await page.locator('#start').click();await confirmDeparture(page);await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   await page.evaluate(()=>{const g=window.__dogBoneTest.game;g.obstacles=[];g.bones=[{id:'reward',lane:0,distance:.35,status:'pending',kind:'gold'}];});
   await page.clock.runFor(350);
   const reward=await page.evaluate(()=>({score:window.__dogBoneTest.game.score,reaction:window.__dogBoneTest.renderer.pickupReaction,effects:window.__dogBoneTest.renderer.effects}));
   assert.ok(reward.score>0);assert.ok(reward.reaction.weight>0);assert.ok(reward.effects.some(e=>e.type==='collect'));
   if(width===390)await page.screenshot({path:`test-results/dense-home-pickup-${engine.name()}.png`});
   const indices=new Set();
   for(let i=0;i<16;i++){await page.clock.runFor(50);indices.add((await sample(page)).walk.index);}
   assert.equal(indices.size,8,`all eight authored walk frames must run: ${[...indices]}`);
   await page.locator('#pause').click();await page.clock.runFor(30);const walkFrozen=(await sample(page)).walk,pausedPixels=await pixels(page);
   await page.clock.runFor(1400);assert.deepEqual((await sample(page)).walk,walkFrozen);assert.ok(await pixels(page)===pausedPixels,'pause must freeze pixels');
   await page.locator('#quit').click();await page.locator('#ready-settings').click();await page.locator('#reduce-motion').check();await page.locator('#settings-close').click();
   await page.locator('#home-lie').click();await page.clock.runFor(30);assert.equal((await sample(page)).home.index,8);
   const rgba=()=>page.evaluate(()=>Array.from(document.querySelector('#scene').getContext('2d').getImageData(0,0,document.querySelector('#scene').width,document.querySelector('#scene').height).data));
   const still=await rgba(),stillSample=(await sample(page)).home;await page.clock.runFor(1000);const stillAfter=await rgba();
   assert.deepEqual((await sample(page)).home,stillSample);
   // WebKit can switch accelerated image sampling after readback, rounding
   // individual channels by one byte. Positions and sample must remain exact.
   assert.equal(still.length,stillAfter.length);
   const reducedPixelDelta=still.reduce((max,value,i)=>Math.max(max,Math.abs(value-stillAfter[i])),0);
   assert.ok(reducedPixelDelta<=1,`reduced motion changed pixels by ${reducedPixelDelta}`);
   await page.locator('#start').click();await confirmDeparture(page);await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');await page.clock.runFor(400);
   assert.equal((await sample(page)).walk.index,0);assert.equal((await sample(page)).walk.mix,0);
   checks.push({engine:engine.name(),width,height,autoSitLie:true,frameSets,gestures:true,walkFrames:indices.size,pickupReaction:true,pausePixels:true,reducedMotion:true});
   await context.close();
  }
  const normal=await open(browser,390,844,{prod:true});
  assert.equal(await normal.page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
  await normal.page.locator('#home-lie').click();await normal.page.waitForFunction(()=>document.querySelector('#home-sit').disabled);
  await normal.context.close();
  const partial=await open(browser,390,844,{homeFailure:true});
  assert.equal((await sample(partial.page)).stats.homeMotionReady,false);assert.equal((await sample(partial.page)).stats.animationReady,true);
  assert.equal(await partial.page.locator('#home-sit').isDisabled(),false);await partial.page.locator('#home-sit').click();
  await partial.context.close();
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
await writeFile('test-results/home-motion-browser-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,checks,errors,production:version,requests:[...new Set(requests)]},null,2));
console.log(JSON.stringify({buildVersion:CONFIG.buildVersion,cases:checks.length,errors},null,2));
