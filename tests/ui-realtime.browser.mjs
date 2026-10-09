import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.DOG_RESULTS_DIR||'test-results/ui-redesign-v16';await mkdir(out,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>__dogBoneTest.renderer.dogs.stats.continuityReady);
  await page.evaluate(()=>{
   window.__uiFrames={active:true,last:null,home:[],run:[]};
   function tick(now){const q=__uiFrames;if(!q.active)return;const state=__dogBoneTest.game.state;if(q.last!==null&&(state==='ready'||state==='running'))q[state==='ready'?'home':'run'].push(now-q.last);q.last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  });
  console.log(`${engine.name()}: 12s real home + 30s walk`);await page.waitForTimeout(12000);
  const bones=await page.evaluate(()=>__dogBoneTest.game.bones.map(b=>({at:b.timeMs-340,lane:b.lane})));
  await page.locator('#start').click();await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  for(const bone of bones){await page.waitForFunction(at=>__dogBoneTest.game.timeMs>=at,bone.at,{timeout:5000,polling:16});const lane=await page.evaluate(()=>__dogBoneTest.game.lane);if(lane!==bone.lane)await page.keyboard.press(bone.lane>lane?'ArrowRight':'ArrowLeft');}
  await page.waitForFunction(()=>__dogBoneTest.game.state==='result',undefined,{timeout:8000});
  const data=await page.evaluate(()=>{
   __uiFrames.active=false;const stats=list=>{const a=[...list].sort((a,b)=>a-b),mean=a.reduce((s,n)=>s+n,0)/a.length;return {frames:a.length,meanMs:mean,fps:1000/mean,p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1),over100:a.filter(n=>n>100).length};};
   return {home:stats(__uiFrames.home),run:stats(__uiFrames.run),result:__dogBoneTest.game.result(),metrics:__dogBoneTest.metrics.summary()};
  });
  assert.equal(data.result.completed,true);assert.equal(data.result.timeMs,30000);assert.equal(data.result.collected,data.result.placed);
  for(const s of [data.home,data.run])assert.ok(s.fps>=30&&s.p95Ms<=34,JSON.stringify(data));assert.deepEqual(errors,[]);
  results.push({engine:engine.name(),...data,errors});console.log(JSON.stringify(results.at(-1)));
 }finally{await context.close();await browser.close();}
}
await writeFile(`${out}/realtime-results.json`,JSON.stringify({version:CONFIG.buildVersion,scope:'Chromium/WebKit 390x844 DPR2; real12s home +30s walk; not physical iPhone',results},null,2));
