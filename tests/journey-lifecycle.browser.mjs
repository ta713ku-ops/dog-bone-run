import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const{chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/journey-v38/lifecycle';await mkdir(output,{recursive:true});const results=[];
for(const engine of[chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const load=async p=>{await p.goto('http://127.0.0.1:4197/?test=1',{waitUntil:'networkidle'});await p.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop.journey&&!document.querySelector('#start').disabled);};
 const start=async()=>{await page.evaluate(async()=>{__dogBoneTest.audio.setEnabled(false);await __dogBoneTest.selectJourneyRoute('street-1','calm');});await page.waitForFunction(()=>__dogBoneTest.game.state==='running');};
 try{
  await load(page);await start();
  const retained=await page.evaluate(()=>{const t=__dogBoneTest;t.game.advance(5000);t.pause('manual');return{runId:t.homeShop.currentRunId,epoch:t.homeShop.store.epoch,time:t.game.timeMs};});
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.waitForFunction(()=>!!__dogBoneTest.homeShop.lifecycleClosedStore);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>__dogBoneTest.homeShop.owner&&!__dogBoneTest.homeShop.lifecycleRecovery);
  const restored=await page.evaluate(()=>({runId:__dogBoneTest.homeShop.currentRunId,epoch:__dogBoneTest.homeShop.store.epoch,time:__dogBoneTest.game.timeMs,state:__dogBoneTest.game.state}));
  assert.equal(restored.runId,retained.runId);assert.equal(restored.time,retained.time);assert.equal(restored.state,'paused');assert.ok(restored.epoch>retained.epoch);
  await page.click('#resume');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  await page.evaluate(()=>{const g=__dogBoneTest.game;g.advance(g.durationMs-g.timeMs);});
  await page.waitForFunction(()=>__dogBoneTest.homeShop.state.roomShop.journey.completedRuns===1&&!__dogBoneTest.homeShop.pendingReward);
  await page.locator('[data-focus-key="result-home"]').click();
  await start();
  const before=await page.evaluate(()=>__dogBoneTest.homeShop.state.coins);
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.store.transact=async()=>({ok:false,state:c.state,error:'transaction_aborted'});const g=__dogBoneTest.game;g.advance(g.durationMs-g.timeMs);});
  await page.waitForFunction(()=>__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.pending);
  assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.state.coins),before);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.waitForFunction(()=>!!__dogBoneTest.homeShop.lifecycleClosedStore);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>__dogBoneTest.homeShop.owner&&!__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.lifecycleRecovery);
  const paid=await page.evaluate(()=>__dogBoneTest.homeShop.state.coins);assert.ok(paid>before);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>!__dogBoneTest.homeShop.lifecycleRecovery);assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.state.coins),paid);
  await page.locator('[data-focus-key="result-home"]').click();await start();await page.click('#pause');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.waitForFunction(()=>!!__dogBoneTest.homeShop.lifecycleClosedStore);
  const two=await context.newPage();await load(two);assert.equal(await two.evaluate(()=>__dogBoneTest.homeShop.owner),true);
  await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>!__dogBoneTest.homeShop.lifecycleRecovery);assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.owner),false);
  await page.click('#resume');await page.waitForFunction(()=>__dogBoneTest.game.state==='ready');
  assert.equal(await two.evaluate(()=>__dogBoneTest.homeShop.state.coins),paid);assert.deepEqual(errors,[]);
  results.push({engine:engine.name(),samePausedRunRestored:true,newLeaseEpoch:true,failedRewardRecoveredOnce:true,foreignOwnerRespected:true,errors});
 }catch(error){await page.screenshot({path:`${output}/${engine.name()}-failure.png`});await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:error.stack,body:await page.locator('body').innerText(),errors},null,2));throw error;}
 finally{await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
