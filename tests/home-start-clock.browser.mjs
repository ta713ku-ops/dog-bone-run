import {confirmDeparture} from './browser-departure.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  await page.addInitScript(()=>{
   const request=window.requestAnimationFrame.bind(window);
   window.requestAnimationFrame=callback=>request(now=>{
    if(window.__injectOldFrame&&callback.name==='frame'&&window.__dogBoneTest?.game.state==='running'){
     window.__injectOldFrame=false;window.__oldFrameInjected=true;callback(now-500);
    }else callback(now);
   });
  });
  await page.goto('http://127.0.0.1:4182/?test=1&seed=42');
  await page.waitForFunction(()=>__dogBoneTest?.renderer.dogs.stats.continuityReady);
  await page.locator('#ready-settings').click();await page.locator('#ready-sound').click();await page.locator('#settings-close').click();
  await page.evaluate(()=>{window.__injectOldFrame=true;});await page.locator('#start').click();await confirmDeparture(page);await page.waitForTimeout(100);
  const start=await page.evaluate(()=>({injected:__oldFrameInjected,state:__dogBoneTest.game.state,time:__dogBoneTest.game.timeMs,pauses:__dogBoneTest.log.events.filter(e=>e.type==='pause')}));
  assert.equal(start.injected,true);assert.equal(start.state,'running',JSON.stringify(start));assert.ok(start.time>0&&start.time<300,JSON.stringify(start));assert.deepEqual(start.pauses,[]);
  await page.evaluate(()=>{const until=performance.now()+320;while(performance.now()<until){}});await page.waitForTimeout(80);
  const stall=await page.evaluate(()=>({state:__dogBoneTest.game.state,pauses:__dogBoneTest.log.events.filter(e=>e.type==='pause')}));assert.equal(stall.state,'paused');assert.equal(stall.pauses.at(-1).reason,'stall');results.push({engine:engine.name(),start,stall});
 }finally{await browser.close();}
}
await mkdir('test-results/motion-repair-v15',{recursive:true});await writeFile('test-results/motion-repair-v15/start-clock-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
