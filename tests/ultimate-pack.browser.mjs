import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {EXTRA_JOURNEY_ROUTES,JOURNEY_ROUTES} from '../src/journey-catalog.js';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/ultimate-v39/pack';await mkdir(output,{recursive:true});const results=[];
for(const engine of[chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:4197/?test=1',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop?.journey?.life&&!document.querySelector('#start').disabled);
  assert.equal(await page.evaluate(()=>window.__dogBoneTest.selectJourneyRoute('dusk-2','calm')),false);
  // Explicit test fixture only: no store request or financial transaction.
  await page.evaluate(()=>{const t=window.__dogBoneTest;t.audio.setEnabled(false);t.commerce.products=[{productId:'fixture.dusk',displayName:'QA fixture',displayPrice:'fixture',contentId:'dusk-walks'}];t.commerce.applyEntitlements(['fixture.dusk']);});
  for(const route of EXTRA_JOURNEY_ROUTES.slice(1)){
   await page.evaluate(id=>window.__dogBoneTest.selectJourneyRoute(id,'calm'),route.id);await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   for(const d of route.discoveries){await page.evaluate(d=>{const{game}=window.__dogBoneTest;game.advance(Math.max(0,d.timeMs-1000-game.timeMs));for(let i=0;i<3&&Math.abs(game.x-d.lane)>.05;i++){game.command(Math.sign(d.lane-game.x),'fixture');game.advance(250);}game.advance(Math.max(0,d.timeMs+200-game.timeMs));},d);await page.locator('.journey-observation[open]').waitFor();await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');}
   await page.evaluate(()=>{const{game}=window.__dogBoneTest;game.advance(30000-game.timeMs);});await page.waitForFunction(()=>window.__dogBoneTest.game.state==='result'&&!window.__dogBoneTest.homeShop.pendingReward&&!window.__dogBoneTest.homeShop.pending);
   await page.locator('[data-focus-key="result-home"]').click();
  }
  const backup=await page.evaluate(async()=>{const t=window.__dogBoneTest;const{encodeJourneyBackup,decodeJourneyBackup}=await import('./src/journey-transfer.js');const text=await encodeJourneyBackup(t.homeShop.state);const restored=await decodeJourneyBackup(text);return {memories:restored.save.roomShop.journey.discoveryIds.length,containsRights:text.includes('fixture.dusk'),life:restored.save.roomShop.journey.life};});
  assert.equal(backup.memories,6);assert.equal(backup.containsRights,false);assert.equal(backup.life.routeVisits['dusk-2'],1);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop?.journey?.life);if(await page.locator('.shop-takeover').isVisible())await page.locator('.shop-takeover').click();
  assert.equal(await page.evaluate(()=>window.__dogBoneTest.commerce.ownsContent('dusk-walks')),false);assert.equal(await page.evaluate(()=>window.__dogBoneTest.selectJourneyRoute('dusk-3','calm')),false);
  await page.click('[data-home-action="album"]');assert.match(await page.locator('#journey-dialog').innerText(),/0\s*\/\s*36/);await page.locator('#journey-dialog [data-action="close"]').click();
  await page.evaluate(()=>{window.__dogBoneTest.audio.setEnabled(false);return window.__dogBoneTest.selectJourneyRoute('street-1','calm');});await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
  await page.evaluate(ms=>window.__dogBoneTest.game.advance(ms),JOURNEY_ROUTES[0].discoveries[0].timeMs+200);await page.locator('.journey-observation[open]').waitFor();await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
  await page.click('#pause');await page.click('#quit');await page.waitForFunction(()=>!window.__dogBoneTest.homeShop.pendingReward&&!window.__dogBoneTest.homeShop.pending&&window.__dogBoneTest.homeShop.state.roomShop.journey.discoveryIds.includes('street-1-bakery'));
  const partial=await page.evaluate(()=>window.__dogBoneTest.homeShop.state.roomShop.lastReward);assert.equal(partial.completed,false);assert.equal(partial.journey.starterCoins,0);
  const quota=await page.evaluate(async()=>{
    const photos=window.__dogBoneTest.photos;for(let i=0;i<24;i++)await photos.capture({title:`QA ${i}`});const before=await photos.list();let rejected=false;try{await photos.capture({title:'over limit'});}catch{rejected=true;}return{before:before.length,after:(await photos.list()).length,rejected};
  });assert.deepEqual(quota,{before:24,after:24,rejected:true});
  await page.screenshot({path:`${output}/${engine.name()}-home.png`});assert.deepEqual(errors,[]);
  results.push({engine:engine.name(),fixturePaidRoutesPlayable:2,realPurchaseTested:false,rightsNotInBackup:true,reloadRequiresVerifiedRights:true,partialWalkRetainsDiscovery:true,photoCapacity:quota,errors});
 }catch(error){await page.screenshot({path:`${output}/${engine.name()}-failure.png`});await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:error.stack,text:await page.locator('body').innerText(),errors},null,2));throw error;}
 finally{await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
