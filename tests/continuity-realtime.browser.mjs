import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out='test-results/motion-repair-v15';await mkdir(`${out}/video`,{recursive:true});
const all=[];
for(const engine of process.env.DOG_DIAGNOSTIC ? [chromium] : [chromium,webkit]){
 const browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,recordVideo:{dir:`${out}/video`,size:{width:390,height:844}}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const video=page.video();
 try{
  if(process.env.DOG_DIAGNOSTIC)await page.addInitScript(()=>{
   window.__rafDiagnostic=[];window.__longTasks=[];
   try{new PerformanceObserver(list=>{for(const e of list.getEntries())__longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
   const request=window.requestAnimationFrame.bind(window);
   window.requestAnimationFrame=function(callback){return request(now=>{const before=performance.now(),state=window.__dogBoneTest?.game.state;callback(now);if(state==='running'||state==='paused'){if(__rafDiagnostic.length<240)__rafDiagnostic.push({name:callback.name,state,now,lag:before-now,duration:performance.now()-before,active:window.__dogBoneTest?.game.timeMs});}});};
  });
  await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);
  await page.evaluate(()=>{
   const r=__dogBoneTest.renderer;r.menuElapsedMs=0;r.menuLastFrameNow=null;r.homeClockOffset=0;r.homeHeldFrame=null;r.homeInteraction=null;
   window.__probe={intervals:[],paint:[],active:true,last:null,poses:[]};const painter=r.dogs.naturalPainter,original=painter.draw;
   painter.draw=function(...args){const start=performance.now(),result=original.apply(this,args);if(__probe.active)__probe.paint.push(performance.now()-start);return result;};
   function tick(now){if(!__probe.active)return;if(__probe.last!==null)__probe.intervals.push(now-__probe.last);__probe.last=now;if(__probe.poses.length===0||r.homeSample?.action!==__probe.poses.at(-1).action)__probe.poses.push({clock:r.menuElapsedMs,action:r.homeSample?.action});requestAnimationFrame(tick);}requestAnimationFrame(tick);
  });
  console.log(`${engine.name()}: recording real 72s home cycle`);await page.waitForTimeout(72_300);
  const home=await page.evaluate(()=>{
   __probe.active=false;const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {count:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,p95:a[Math.floor(a.length*.95)],max:a.at(-1),over100:a.filter(n=>n>100).length};};
   return {intervals:stats(__probe.intervals),paint:stats(__probe.paint),poses:__probe.poses,assets:__dogBoneTest.renderer.dogs.stats};
  });
  await writeFile(`${out}/${engine.name()}-home-realtime.json`,JSON.stringify(home,null,2));
  assert.ok(home.intervals.count>2100,JSON.stringify(home));assert.ok(home.intervals.p95<=33.4,JSON.stringify(home));
  const manual=[];
  if(engine===chromium){
   for(const [id,delay,atlas,index] of [['home-sit',2200,'sitdown',47],['home-lie',3800,'liedown',47],['home-greet',1000,'sitdown',0]]){
    await page.evaluate(()=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=0;r.menuLastFrameNow=null;r.homeClockOffset=0;r.homeHeldFrame=null;r.homeInteraction=null;});
    await page.locator(`#${id}`).click();await page.waitForTimeout(delay);const sample=await page.evaluate(()=>__dogBoneTest.renderer.homeSample);assert.equal(sample.atlas,atlas);if(index!==null)assert.equal(sample.index,index);manual.push(sample);await page.screenshot({path:`${out}/${engine.name()}-${id}.png`});await page.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy,undefined,{timeout:8500});
   }
  }
  console.log(`${engine.name()}: recording real 30s walk`);
  const bones=await page.evaluate(()=>__dogBoneTest.game.bones.map(b=>({at:b.timeMs-340,lane:b.lane})));await page.locator('#start').click();await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  for(const bone of bones){await page.waitForFunction(at=>__dogBoneTest.game.timeMs>=at,bone.at,{timeout:5000,polling:16});const lane=await page.evaluate(()=>__dogBoneTest.game.lane);if(lane!==bone.lane)await page.keyboard.press(bone.lane>lane?'ArrowRight':'ArrowLeft');}
  await page.waitForFunction(()=>__dogBoneTest.game.state==='result',undefined,{timeout:8000});const run=await page.evaluate(()=>({result:__dogBoneTest.game.result(),frames:__dogBoneTest.metrics.summary(),pauses:__dogBoneTest.log.events.filter(e=>e.type==='pause')}));assert.equal(run.result.completed,true);assert.equal(run.result.timeMs,30000);assert.equal(run.result.collected,run.result.placed);assert.ok(run.frames.p95Ms<=34,JSON.stringify(run));assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/${engine.name()}-result.png`});all.push({engine:engine.name(),home,manual,run,errors});console.log(JSON.stringify({engine:engine.name(),home,run},null,2));
 }catch(error){
  await page.screenshot({path:`${out}/${engine.name()}-failure.png`});
  await writeFile(`${out}/${engine.name()}-failure.json`,JSON.stringify(await page.evaluate(()=>({state:__dogBoneTest.game.state,pending:__dogBoneTest.pending,hidden:document.hidden,pauses:__dogBoneTest.log.events.filter(e=>e.type==='pause'),stalls:__dogBoneTest.log.events.filter(e=>e.type==='long_stall'),rafs:window.__rafDiagnostic??[],longTasks:window.__longTasks??[],time:__dogBoneTest.game.timeMs})),null,2));
  throw error;
 }finally{await context.close();await browser.close();await copyFile(await video.path(),`${out}/${engine.name()}-home-and-walk.webm`);}
}
await writeFile(`${out}/realtime-results.json`,JSON.stringify({buildVersion:CONFIG.buildVersion,scope:'desktop Chromium/WebKit,390x844,DPR2,real72s home +30s walk, not physical iPhone',all},null,2));
