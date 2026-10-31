import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {JOURNEY_ROUTES,EXTRA_JOURNEY_ROUTES} from '../src/journey-catalog.js';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/ultimate-v39/core';await mkdir(output,{recursive:true});const results=[];
for(const engine of [chromium,webkit].filter(e=>!process.env.ULTIMATE_ENGINE||e.name()===process.env.ULTIMATE_ENGINE)){
 const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true});
 const page=await context.newPage(),errors=[],badResponses=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
 const shot=name=>page.screenshot({path:`${output}/${engine.name()}-${name}.png`});
 const running=()=>page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
 const settled=()=>page.waitForFunction(()=>window.__dogBoneTest.game.state==='result'&&!window.__dogBoneTest.homeShop.pendingReward&&!window.__dogBoneTest.homeShop.pending);
 async function walk(route,real=false){
   if(real){await page.click('#start');await page.click(`[data-action="route"][data-route="${route.id}"]`);}
   else await page.evaluate(id=>window.__dogBoneTest.selectJourneyRoute(id,'calm'),route.id);
   await running();const started=Date.now();
   if(real){await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);await page.keyboard.press('ArrowLeft');}
   for(const [index,discovery]of route.discoveries.entries()){
     if(real){
       await page.waitForFunction(ms=>window.__dogBoneTest.game.timeMs>=ms,discovery.timeMs-1000,{timeout:25000});
       let lane=await page.evaluate(()=>window.__dogBoneTest.game.lane);
       while(lane!==discovery.lane){await page.keyboard.press(lane<discovery.lane?'ArrowRight':'ArrowLeft');await page.waitForTimeout(250);lane=await page.evaluate(()=>window.__dogBoneTest.game.lane);}
     }else await page.evaluate(d=>{
       const {game}=window.__dogBoneTest;game.advance(Math.max(0,d.timeMs-1000-game.timeMs));
       for(let i=0;i<3&&Math.abs(game.x-d.lane)>.05;i++){game.command(Math.sign(d.lane-game.x),'automated-content');game.advance(250);}
       game.advance(Math.max(0,d.timeMs+200-game.timeMs));
     },discovery);
     await page.locator('.journey-observation[open]').waitFor({timeout:15000});
     if(real&&index===0){
       const paused=await page.evaluate(()=>window.__dogBoneTest.game.timeMs);await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.timeMs),paused);
       await shot('observation');await page.locator('.journey-observation-actions button').first().click();
       await page.getByRole('button',{name:'写真を撮る',exact:true}).click();await page.locator('.journey-photo-preview[open]').waitFor();
       await shot('photo-preview');const event=page.waitForEvent('download');await page.getByRole('button',{name:'端末にも保存',exact:true}).click();assert.ok(await(await event).path());
       await page.getByRole('button',{name:'写真帳に残して戻る',exact:true}).click();
       assert.equal(await page.evaluate(async()=> (await window.__dogBoneTest.photos.list()).length),1);
     }
     await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();await running();
   }
   if(!real)await page.evaluate(()=>{const {game}=window.__dogBoneTest;game.advance(30000-game.timeMs);});
   await settled();
   const state=await page.evaluate(()=>({runIds:window.__dogBoneTest.game.discoveryIds,journey:window.__dogBoneTest.homeShop.state.roomShop.journey}));
   assert.deepEqual(state.runIds,route.discoveries.map(d=>d.id));if(real){assert.ok(Date.now()-started>=30000);await shot('first-result');}
   await page.locator('[data-focus-key="result-home"]').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='ready');
   return state;
 }
 try{
   await page.goto('http://127.0.0.1:4197/?test=1',{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop?.journey?.life&&!document.querySelector('#start').disabled,null,{timeout:60000});
   await page.click('[data-home-action="name"]');await page.locator('[data-dog-name-input]').fill('こむぎ');await page.locator('[data-action="save-name"]').click();
   await page.waitForFunction(()=>window.__dogBoneTest.homeShop.state.dog.name==='こむぎ');
   if(await page.locator('#journey-dialog[open]').count())await page.locator('#journey-dialog [data-action="close"]').click();
   const first=await walk(JOURNEY_ROUTES[0],true);
   assert.equal(first.journey.life.tutorialComplete,true);assert.equal(first.journey.life.routeVisits['street-1'],1);
   assert.match(first.journey.life.memories['street-1-bakery'].firstSeenAt,/^\d{4}-/);
   await walk(JOURNEY_ROUTES[0]);
   const visit=await page.evaluate(()=>window.__dogBoneTest.homeShop.state.roomShop.journey.life.memories['street-1-bakery'].visits);assert.equal(visit,2);
   for(const route of JOURNEY_ROUTES.slice(1))await walk(route);
   await page.click('[data-home-action="album"]');await page.locator('[data-action="collection"]').click();await shot('collection');
   assert.match(await page.locator('#journey-dialog').innerText(),/こむぎ/);
   await page.locator('#journey-dialog [data-action="close"]').click();
   await walk(EXTRA_JOURNEY_ROUTES[0]);
   assert.equal(await page.evaluate(()=>window.__dogBoneTest.selectJourneyRoute('dusk-2','calm')),false);
   await page.click('[data-home-action="album"]');assert.match(await page.locator('#journey-dialog').innerText(),/36/);
   await page.locator('[data-action="memory"][data-memory="street-1-bakery"]').click();await shot('memory');
   assert.match(await page.locator('#journey-dialog').innerText(),/2/);
   await page.locator('#journey-dialog [data-action="close"]').click();
   if(await page.locator('#journey-dialog[open]').count())await page.locator('#journey-dialog [data-action="close"]').click();
   await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop?.journey?.life,null,{timeout:60000});
   if(await page.locator('.shop-takeover').isVisible())await page.locator('.shop-takeover').click();
   const retained=await page.evaluate(()=>({name:window.__dogBoneTest.homeShop.state.dog.name,life:window.__dogBoneTest.homeShop.state.roomShop.journey.life,count:window.__dogBoneTest.homeShop.state.roomShop.journey.discoveryIds.length}));
   assert.equal(retained.name,'こむぎ');assert.equal(retained.count,39);assert.equal(retained.life.routeVisits['street-1'],2);
   assert.equal(await page.evaluate(async()=> (await window.__dogBoneTest.photos.list()).length),1);
   for(const width of[320,390,844,1280]){await page.setViewportSize({width,height:844});await page.click('#start');
     const overflow=await page.locator('#journey-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);await shot(`map-${width}`);await page.locator('#journey-dialog [data-action="close"]').click();}
   assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);results.push({engine:engine.name(),real30SecondsWithObservation:true,baseRoutes:12,baseMemories:36,trialMemories:3,revisitPersisted:true,photoPersisted:true,naming:true,tutorial:true,allCollectedPage:true,errors,badResponses});
 }catch(error){await shot('failure');await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:error.stack,text:await page.locator('body').innerText(),errors,badResponses},null,2));throw error;}
 finally{await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
