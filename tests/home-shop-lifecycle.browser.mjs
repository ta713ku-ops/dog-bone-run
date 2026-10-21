import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-shop/lifecycle';await mkdir(out,{recursive:true});
const results=[];
async function loaded(page){await page.goto('http://127.0.0.1:4182/?test=1&seed=42');await page.waitForFunction(()=>window.__dogBoneTest?.homeShop?.state&&__dogBoneTest.renderer.dogs.stats.continuityReady);await page.evaluate(async()=>{await __dogBoneTest.homeShop.ready;await __dogBoneTest.renderer.furnitureArt.ready;});}
const state=page=>page.evaluate(()=>structuredClone(__dogBoneTest.homeShop.state));
const emptyStorage={cookies:[],origins:[]};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 // Explicit ephemeral context: fixture balances and failures NEVER touch a user's profile.
 const context=await browser.newContext({storageState:emptyStorage,viewport:{width:390,height:844},deviceScaleFactor:1});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await loaded(page);const original=await state(page);assert.equal(original.coins,0);
  await page.click('#home-shop');await page.click('[data-item="bed"]');assert.equal(await page.locator('#preview-place').isEnabled(),false);
  await page.keyboard.press('Escape');assert.deepEqual((await state(page)).roomShop,original.roomShop);
  assert.equal(await page.locator('#home-shop').evaluate(e=>e===document.activeElement),true);
  // Seed only a disposable test wallet for purchase/error exercises.
  await page.evaluate(async()=>{const c=__dogBoneTest.homeShop;const r=await c.store.transact(s=>{s.coins=2000;return{state:s};},{expectedRevision:c.state.revision});c.state=r.state;c.render();});
  await page.click('#home-shop');await page.click('[data-item="bed"]');
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.__transact=c.store.transact.bind(c.store);c.store.transact=async()=>({ok:false,state:c.state,error:'transaction_aborted'});});
  await page.click('#preview-place');await page.waitForFunction(()=>!__dogBoneTest.homeShop.pending);
  assert.equal((await state(page)).coins,2000);assert.equal((await state(page)).roomShop.owned.includes('bed'),false);
  assert.equal(await page.locator('#home-shop-dialog').evaluate(e=>e.open),true);
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.store.transact=c.__transact;});
  await page.click('#preview-place');await page.waitForFunction(()=>!document.querySelector('#home-shop-dialog').open);
  assert.equal((await state(page)).coins,1650);assert.equal((await state(page)).roomShop.equipped.bed,'bed');
  const duplicate=await page.evaluate(()=>__dogBoneTest.homeShop.command({type:'purchase',itemId:'bed',equip:true}));assert.equal(duplicate.ok,false);assert.equal((await state(page)).coins,1650);
  await page.click('#home-shop');await page.click('[data-item="rug-sage"]');await page.click('#preview-cancel');assert.equal((await state(page)).roomShop.equipped.rug,null);
  await page.click('[data-item="rug-sage"]');await page.click('#preview-place');await page.waitForFunction(()=>!document.querySelector('#home-shop-dialog').open);
  assert.equal((await state(page)).coins,1470);await page.reload();await page.waitForFunction(()=>__dogBoneTest?.homeShop?.owner);
  assert.equal((await state(page)).roomShop.equipped.bed,'bed');assert.equal((await state(page)).roomShop.equipped.rug,'rug-sage');
  await page.click('#home-decorate');await page.click('[data-remove="bed"]');await page.waitForFunction(()=>__dogBoneTest.homeShop.state.roomShop.equipped.bed===null);assert.ok((await state(page)).roomShop.owned.includes('bed'));
  await page.click('#shop-close');
  // Real UI starts a real Game/course; advance its clock deterministically to
  // exercise event → controller → atomic reward persistence (not a reward fixture).
  await page.click('#ready-settings');await page.click('#ready-sound');await page.click('#settings-close');
  const coinsBefore=(await state(page)).coins;
  await page.click('#start');await page.click('#walk-picker-start');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  const walk=await page.evaluate(()=>{const g=__dogBoneTest.game,c=__dogBoneTest.homeShop;const active=structuredClone(c.state.roomShop.activeWalk);for(let i=0;i<700&&g.state==='running';i++){const next=g.course.find(b=>!b.status&&b.timeMs>g.timeMs+180);if(next&&next.timeMs-g.timeMs<650){const target=g.move?.to??g.lane;if(target!==next.lane)g.command(Math.sign(next.lane-target),'browser-test');}g.advance(50);}return{active,normal:g.normalCollected,gold:g.goldCollected,state:g.state};});
  assert.equal(walk.state,'result');await page.waitForFunction(()=>__dogBoneTest.homeShop.state.roomShop.lastReward&&!__dogBoneTest.homeShop.pendingReward);
  const paid=await state(page);const expected=await page.evaluate(async w=>{const{calculateRunRewardInput}=await import('/src/raising-model.js');return calculateRunRewardInput({normalCollected:w.normal,goldCollected:w.gold,completed:true,difficulty:w.active.level,course:{bones:__dogBoneTest.game.course}}).reward;},walk);
  assert.equal(paid.coins-coinsBefore,expected);assert.ok(expected>0);assert.ok((await page.locator('#result-coins').textContent()).includes(String(expected)));
  const again=await page.evaluate(w=>__dogBoneTest.homeShop.command({type:'settleWalk',runId:w.active.runId,ownerEpoch:__dogBoneTest.homeShop.store.epoch,normalCollected:w.normal,goldCollected:w.gold,completed:true}),walk);assert.ok(again.ok);assert.equal((await state(page)).coins,paid.coins);
  await page.screenshot({path:`${out}/${engine.name()}-reward.png`});await page.click('#end');
  // Retained result survives a failed write + reload, and is paid only once.
  await page.click('#start');await page.click('#walk-picker-start');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  const beforeRetry=(await state(page)).coins;
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.__transact=c.store.transact.bind(c.store);c.store.transact=async()=>({ok:false,state:c.state,error:'transaction_aborted'});const g=__dogBoneTest.game;while(g.state==='running')g.advance(50);});
  await page.waitForFunction(()=>__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.pending);assert.equal((await state(page)).coins,beforeRetry);assert.equal(await page.locator('#reward-retry').isVisible(),true);
  // A stale shared journal must not hide this tab's newer session backup.
  await page.evaluate(()=>localStorage.setItem('dog-bone-run:room-pending-reward:v1',JSON.stringify(__dogBoneTest.homeShop.state.roomShop.lastReward)));
  await page.reload();await page.waitForFunction(()=>__dogBoneTest?.homeShop?.owner&&!__dogBoneTest.homeShop.pendingReward&&__dogBoneTest.homeShop.state.roomShop.activeWalk===null);
  const afterRetry=(await state(page)).coins;assert.ok(afterRetry>beforeRetry);await page.reload();await page.waitForFunction(()=>__dogBoneTest?.homeShop?.owner);assert.equal((await state(page)).coins,afterRetry);
  // A second write failure after reload must still have a reachable home retry.
  await page.click('#start');await page.click('#walk-picker-start');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  const beforeHomeRetry=(await state(page)).coins;
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.__transact=c.store.transact.bind(c.store);c.store.transact=async()=>({ok:false,state:c.state,error:'transaction_aborted'});while(__dogBoneTest.game.state==='running')__dogBoneTest.game.advance(50);});
  await page.waitForFunction(()=>__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.pending);
  await page.addInitScript(()=>{window.__failRoomWrite=true;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){const request=put.call(this,value,...args);if(window.__failRoomWrite&&value?.roomShop)this.transaction.abort();return request;};});
  await page.reload();await page.waitForFunction(()=>__dogBoneTest?.homeShop?.owner&&__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.pending);
  assert.equal(await page.locator('#home-reward-retry').isVisible(),true);assert.equal((await state(page)).coins,beforeHomeRetry);
  await page.evaluate(()=>{window.__failRoomWrite=false;});
  const overlappingRetry=await page.evaluate(async()=>{document.querySelector('#home-reward-retry').click();return __dogBoneTest.homeShop.retryReward();});assert.equal(overlappingRetry,false);
  await page.waitForFunction(()=>!__dogBoneTest.homeShop.pendingReward);assert.ok((await state(page)).coins>beforeHomeRetry);
  // Two pages share this disposable context to test the actual lease barrier.
  const two=await context.newPage();await loaded(two);assert.equal(await two.evaluate(()=>__dogBoneTest.homeShop.owner),false);
  const rejected=await two.evaluate(()=>__dogBoneTest.homeShop.command({type:'purchase',itemId:'plush'}));assert.equal(rejected.ok,false);
  // B existed before A's failed settlement. It must read the fresh shared journal.
  await page.click('#start');await page.click('#walk-picker-start');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  const beforeTakeover=(await state(page)).coins;
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.__transact=c.store.transact.bind(c.store);c.store.transact=async()=>({ok:false,state:c.state,error:'transaction_aborted'});while(__dogBoneTest.game.state==='running')__dogBoneTest.game.advance(50);});
  await page.waitForFunction(()=>__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.pending);
  await two.click('.shop-takeover');await two.waitForFunction(()=>__dogBoneTest.homeShop.owner&&!__dogBoneTest.homeShop.pendingReward);await page.waitForFunction(()=>!__dogBoneTest.homeShop.owner);
  const afterTakeover=(await state(two)).coins;assert.ok(afterTakeover>beforeTakeover);
  assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.command({type:'purchase',itemId:'plush'}).then(r=>r.ok)),false);
  await page.evaluate(()=>{const c=__dogBoneTest.homeShop;c.store.transact=c.__transact;});await page.click('.shop-takeover');
  await page.waitForFunction(()=>__dogBoneTest.homeShop.owner&&!__dogBoneTest.homeShop.pendingReward);
  assert.equal((await state(page)).coins,afterTakeover);assert.equal(await page.evaluate(()=>__dogBoneTest.game.state),'ready');
  assert.deepEqual(errors,[]);results.push({engine:engine.name(),previewCancel:true,insufficient:true,purchaseFailureAtomic:true,purchaseReload:true,removeRetainsOwnership:true,actualGameReward:expected,duplicateReward:true,failedRewardReloadRetry:true,homeRetryAfterSecondWriteFailure:true,twoTabs:true,sharedPendingRewardTakeover:true,staleWalkReset:true,errors});
 }finally{await context.close();await browser.close();}
}
// A populated v2 save is migrated through the actual SaveStore.open path.
const browser=await chromium.launch(renderingLaunchOptions(chromium));const ctx=await browser.newContext({storageState:emptyStorage});const p=await ctx.newPage();
try{await loaded(p);const preserved=await p.evaluate(async()=>{const c=__dogBoneTest.homeShop;await c.store.close();const{createInitialSave}=await import('/src/raising-model.js');const old=createInitialSave();old.saveGeneration='legacy-room-fixture';old.coins=1234;old.owned.decorations=['bed'];old.owned.toys.push('plush');old.equipped.bed='bed';old.equipped.toy='plush';await new Promise((resolve,reject)=>{const req=indexedDB.open('dog-bone-run-save-v2',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['records'],'readwrite');tx.objectStore('records').put(old,'save');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});return old;});await p.reload();await p.waitForFunction(()=>__dogBoneTest?.homeShop?.owner);const migrated=await state(p);for(const key of Object.keys(preserved).filter(k=>k!=='revision'))assert.deepEqual(migrated[key],preserved[key],key);assert.equal(migrated.roomShop.equipped.bed,'bed');assert.equal(migrated.roomShop.equipped.toy,'plush');results.push({legacyMigrationPreservesAllBaseValues:true});}finally{await ctx.close();await browser.close();}
const fallbackBrowser=await chromium.launch(renderingLaunchOptions(chromium));
const fallbackContext=await fallbackBrowser.newContext({storageState:emptyStorage});
try{
 await fallbackContext.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true}));
 const page=await fallbackContext.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest&&__dogBoneTest.homeShop.error==='indexeddb_unavailable'&&__dogBoneTest.renderer.dogs.stats.continuityReady);
 await page.click('#home-shop');assert.equal(await page.locator('[data-item="bed"]').isDisabled(),true);await page.click('#shop-close');
 await page.click('#ready-settings');await page.click('#ready-sound');await page.click('#settings-close');
 await page.click('#start');await page.click('#walk-picker-start');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
 await page.evaluate(()=>{while(__dogBoneTest.game.state==='running')__dogBoneTest.game.advance(50);});
 assert.ok((await page.locator('#result-coins').textContent()).includes('記録できません'));assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.state),null);assert.deepEqual(errors,[]);
 results.push({unavailableStorageStillPlayableWithoutPretendingReward:true,shopPurchaseDisabled:true,errors});
}finally{await fallbackContext.close();await fallbackBrowser.close();}
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
