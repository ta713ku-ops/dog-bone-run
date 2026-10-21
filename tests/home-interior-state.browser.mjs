import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-interior/state';await mkdir(out,{recursive:true});const results=[];
const url='http://127.0.0.1:4182/?test=1&seed=42';
async function load(p){await p.goto(url);await p.waitForFunction(()=>window.__dogBoneTest?.homeShop?.initialized);await p.evaluate(async()=>{await __dogBoneTest.homeShop.ready;await __dogBoneTest.renderer.room.ready;});}
const state=p=>p.evaluate(()=>structuredClone(__dogBoneTest.homeShop.state));
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 // Disposable contexts only; fixture wallets never enter the user's profile.
 const ctx=await browser.newContext({storageState:{cookies:[],origins:[]},viewport:{width:390,height:844}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await load(p);assert.deepEqual((await state(p)).roomShop.equipped,{room:'room-white',rug:null,bed:null,toy:null,decor:null});
  const old=await p.evaluate(async()=>{const c=__dogBoneTest.homeShop;await c.store.close();const s=structuredClone(c.state);s.coins=9241;s.roomShop.owned=['starterBall','bed','plush','rug-sage'];s.roomShop.equipped={rug:'rug-sage',bed:'bed',toy:'starterBall'};s.records.totalCoinsEarned=9999;s.records.totalCoinsSpent=758;await new Promise((resolve,reject)=>{const req=indexedDB.open('dog-bone-run-save-v2',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put(s,'save');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});return s;});
  await p.addInitScript(()=>{window.__failInteriorSetup=true;const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){const request=original.call(this,value,...args);if(window.__failInteriorSetup&&value?.roomShop?.equipped?.room)this.transaction.abort();return request;};});
  await p.reload();await p.waitForFunction(()=>__dogBoneTest?.homeShop?.initialized&&__dogBoneTest.homeShop.owner);await p.evaluate(()=>__dogBoneTest.homeShop.ready);
  assert.equal(await p.evaluate(()=>__dogBoneTest.homeShop.interiorsReady),false);assert.equal((await state(p)).coins,9241);assert.equal(await p.evaluate(()=>__dogBoneTest.renderer.homeFurniture.toy),null);
  await p.click('#home-shop');assert.equal(await p.locator('[data-item="room-white"]').isEnabled(),false);
  const blocked=await p.evaluate(()=>__dogBoneTest.homeShop.command({type:'purchase',itemId:'room-white',equip:true}));assert.equal(blocked.ok,false);assert.equal((await state(p)).roomShop.equipped.room,undefined);
  await p.click('#shop-close');await p.evaluate(async()=>{window.__failInteriorSetup=false;await __dogBoneTest.homeShop.refresh();});
  await p.waitForFunction(()=>__dogBoneTest.homeShop.state.roomShop.equipped.room==='room-white');
  const migrated=await state(p);for(const k of Object.keys(old).filter(k=>!['revision','roomShop'].includes(k)))assert.deepEqual(migrated[k],old[k],k);
  assert.equal(migrated.roomShop.equipped.toy,null);assert.equal(migrated.roomShop.equipped.bed,'bed');assert.equal(migrated.roomShop.equipped.rug,'rug-sage');assert.ok(migrated.roomShop.owned.includes('plush'));
  // Failed room purchase is atomic even when the preview changes the full scene.
  await p.click('#home-shop');await p.click('[data-category="room"]');await p.click('[data-item="room-luxe"]');
  await p.evaluate(()=>{const c=__dogBoneTest.homeShop;c.originalTransact=c.store.transact.bind(c.store);c.store.transact=async()=>({ok:false,state:c.state,error:'transaction_aborted'});});
  await p.click('#preview-place');await p.waitForFunction(()=>!__dogBoneTest.homeShop.pending);assert.deepEqual(await state(p),migrated);
  assert.equal(await p.evaluate(()=>__dogBoneTest.renderer.homeInterior),'room-luxe');
  await p.click('#preview-cancel');assert.equal(await p.evaluate(()=>__dogBoneTest.renderer.homeInterior),'room-white');
  await p.evaluate(()=>{const c=__dogBoneTest.homeShop;c.store.transact=c.originalTransact;});
  await p.click('[data-item="room-natural"]');await p.click('#preview-place');await p.waitForFunction(()=>!__dogBoneTest.homeShop.pending&&!document.querySelector('#home-shop-dialog').open);
  await p.addInitScript(()=>{window.__failInteriorSetup=false;});
  const bought=await state(p);assert.equal(bought.coins,7741);assert.equal(bought.roomShop.equipped.room,'room-natural');assert.equal(bought.roomShop.equipped.bed,'bed');
  const duplicate=await p.evaluate(()=>__dogBoneTest.homeShop.command({type:'purchase',itemId:'room-natural',equip:true}));assert.equal(duplicate.ok,false);assert.equal((await state(p)).coins,7741);
  // Single owner lease protects the same wallet and room in another isolated tab.
  const two=await ctx.newPage();await load(two);assert.equal(await two.evaluate(()=>__dogBoneTest.homeShop.owner),false);
  const rejected=await two.evaluate(()=>__dogBoneTest.homeShop.command({type:'purchase',itemId:'room-luxe',equip:true}));assert.equal(rejected.ok,false);assert.equal((await state(two)).coins,7741);
  await two.evaluate(()=>__dogBoneTest.homeShop.takeover());await p.evaluate(()=>__dogBoneTest.homeShop.refresh());assert.equal(await p.evaluate(()=>__dogBoneTest.homeShop.owner),false);
  await two.click('#home-decorate');await two.click('[data-remove="room"]');await two.waitForFunction(()=>__dogBoneTest.homeShop.state.roomShop.equipped.room==='room-white');
  const restored=await state(two);assert.equal(restored.coins,7741);assert.ok(restored.roomShop.owned.includes('room-natural'));assert.equal(restored.roomShop.equipped.bed,'bed');
  await two.evaluate(()=>__dogBoneTest.homeShop.store.close());await two.reload();await two.waitForFunction(()=>__dogBoneTest?.homeShop?.owner);assert.equal((await state(two)).roomShop.equipped.room,'room-white');assert.equal((await state(two)).coins,7741);
  // Actual source assets failing must disable an unowned room, never charge for a fallback.
  await two.close();await p.close();
  const fail=await ctx.newPage();await fail.route('**/art/home-interior/luxe-*.webp*',route=>route.abort());await load(fail);await fail.waitForFunction(()=>__dogBoneTest.homeShop.owner);
  await fail.click('#home-shop');await fail.click('[data-category="room"]');await fail.click('[data-item="room-luxe"]');assert.equal(await fail.locator('#preview-place').isEnabled(),false);assert.match(await fail.locator('#shop-preview-error').textContent(),/読み込めない/);assert.equal((await state(fail)).coins,7741);await fail.screenshot({path:`${out}/${engine.name()}-failed-art.png`});
  assert.deepEqual(errors,[]);results.push({engine:engine.name(),legacyV1MigrationPreservesBase:true,failedInitializationBlocksPurchaseAndRecovers:true,defaultBallRemovedOnly:true,roomWriteFailureAtomic:true,cancelRestoresWholeScene:true,duplicateRoomRejected:true,sharedWalletLease:true,freeWhiteRestore:true,reloadPreservesOwnershipAndFurniture:true,failedArtPurchaseDisabled:true,errors});
 }finally{await ctx.close();await browser.close();}
}
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
