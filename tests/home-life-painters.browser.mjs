import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-life/painters';await mkdir(out,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await page.evaluate(()=>__dogBoneTest.renderer.ready);
 const checks=await page.evaluate(async()=>{
  const {renderer:r}=__dogBoneTest;r.setMenuPaused(true);const d=r.dogs,{sampleHome}=await import('/src/sprite-animation.js');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const c=canvas.getContext('2d',{willReadFrequently:true}),rows=[];
  const poses=[0,25000,40000].map(t=>({...sampleHome(t,{continuousMotion:true,frameCounts:d.stats.homeFrameCounts}),blink:0,breath:0,earLeft:0,earRight:0,attention:0}));
  if(!d.gpuPainter?.available)throw Error('GPU painter unavailable');
  // Compare both paths on the same original atlas to isolate motion parity from HD detail.
  const provider=d.gpuPainter.frameProvider;d.gpuPainter.frameProvider=null;
  const draw=(p,s)=>{c.clearRect(0,0,384,384);if(!p.draw(c,{x:192,foot:372,size:336,sample:s,layers:s.layers}))throw Error('Painter draw failed');return c.getImageData(0,0,384,384).data.slice();};
  for(const [pose,s] of poses.entries())for(const [key,value] of [['headRest',1],['bodyShift',.8],['gazeX',1],['pawAdjust',1]]){
   const changes=[];
   for(const [name,p] of [['canvas',d.naturalPainter],['gpu',d.gpuPainter]]){
    const a=draw(p,s),b=draw(p,{...s,[key]:value});let changed=0,feet=0,otherPaw=0;
    for(let y=0;y<384;y++)for(let x=0;x<384;x++){const i=(y*384+x)*4;if([0,1,2,3].some(k=>Math.abs(a[i+k]-b[i+k])>2)){changed++;if(y>=350)feet++;if(y>=345&&x>=190)otherPaw++;}}
    changes.push({name,changed,feet,otherPaw});
   }
   rows.push({pose,key,changes});
  }
  d.gpuPainter.frameProvider=provider;
  return {backend:d.gpuPainter.stats.backend,rows};
 });
 for(const row of checks.rows)for(const c of row.changes){
  if(row.key==='pawAdjust'){
   if(row.pose===1){assert.ok(c.changed>0);assert.equal(c.otherPaw,0);}else assert.equal(c.changed,0);
  }else{assert.ok(c.changed>0,JSON.stringify(row));assert.equal(c.feet,0,JSON.stringify(row));}
 }
 // OS media preference freezes the live home, including the added local channels.
 await page.evaluate(()=>__dogBoneTest.renderer.setMenuPaused(false));
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);
 const frozen=await page.evaluate(()=>({sample:__dogBoneTest.renderer.homeSample,system:__dogBoneTest.renderer.systemReducedMotion}));assert.equal(frozen.system,true);
 await page.waitForTimeout(750);assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample),frozen.sample);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(80);
  await page.evaluate(async()=>{
    const r=__dogBoneTest.renderer,{createHomeCommand}=await import('/src/home-command-motion.js');
    r.setMenuPaused(true);r.homeInteraction=null;r.homeAttention=null;r.homeClockOffset=0;r.menuElapsedMs=0;
    r.homeHeldFrame=createHomeCommand('lie',0,r.homeSample,r.dogs.stats.homeFrameCounts).targetFrame;
    r.resetHomeAutonomy();r.homeAutonomyReady=true;r.homePosture='lie';r.homeAutonomy.reset(0,'lie');
    r.homeIdleRest={headRest:1,eyeRest:1};r.homeAutoGesture={action:'sleep',startedAt:0,durationMs:20000,rest:{headRest:1,eyeRest:1}};
    r.updateHomeSample(0);
  });
  await page.waitForTimeout(50);await page.locator('#home-touch').click();
  await page.evaluate(()=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=1000;r.updateHomeSample(1000);});
  await page.waitForTimeout(50);
  const answering=await page.evaluate(()=>({sample:__dogBoneTest.renderer.homeSample,attentionStartedAt:__dogBoneTest.renderer.homeAttention.startedAt}));
  assert.ok(answering.sample.blink<.2);assert.ok(answering.sample.headRest<.5);
  await page.screenshot({path:`${out}/${engine.name()}-responding-from-rest.png`});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  const interrupted=await page.evaluate(()=>({sample:__dogBoneTest.renderer.homeSample,age:__dogBoneTest.renderer.homeSuspendedAutoGesture.age}));
  assert.ok(Math.abs(interrupted.age-answering.attentionStartedAt)<.001);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(80);
  const continued=await page.evaluate(()=>__dogBoneTest.renderer.homeSample);
  assert.ok(continued.headRest>=interrupted.sample.headRest && continued.headRest<=1);
  assert.ok(continued.blink>=interrupted.sample.blink && continued.blink<=1);
  assert.ok(continued.headLift<=interrupted.sample.headLift && continued.headLift>=0);
  await page.evaluate(()=>__dogBoneTest.renderer.setMenuPaused(false));await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.headRest),1);
 assert.deepEqual(errors,[]);results.push({engine:engine.name(),checks,osMotionFreeze:true,errors});
 }finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
