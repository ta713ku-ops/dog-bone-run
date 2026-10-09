import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'playwright');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4183',checks=[],errors=[];
async function save(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('dog-bone-run-save-v2');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('records'),q=tx.objectStore('records').get('save');q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};}));}
await mkdir('test-results',{recursive:true});
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const original=IDBObjectStore.prototype.put;let aborted=false;IDBObjectStore.prototype.put=function(value,...args){const result=original.call(this,value,...args);if(!aborted&&this.name==='records'&&value?.activeRun===null&&value?.records?.lastRun?.outcome==='clear'){aborted=true;this.transaction.abort();}return result;};});
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  const first=await save(page);
  await page.locator('#dog-pet').evaluate(button=>{for(const [type,x]of [['pointerdown',100],['pointermove',125],['pointerup',125]])button.dispatchEvent(new PointerEvent(type,{pointerId:1,isPrimary:true,clientX:x,clientY:200,bubbles:true}));button.dispatchEvent(new MouseEvent('click',{detail:1,bubbles:true}));});
  await page.waitForTimeout(150);const dragged=await save(page);assert.equal(dragged.dog.mood,first.dog.mood);assert.deepEqual(dragged.petting,first.petting);
  await page.locator('#dog-pet').evaluate(button=>{button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,isPrimary:true,clientX:100,clientY:200,bubbles:true}));button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,isPrimary:false,clientX:105,clientY:200,bubbles:true}));button.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,isPrimary:true,bubbles:true}));button.dispatchEvent(new MouseEvent('click',{detail:1,bubbles:true}));});
  await page.waitForTimeout(150);assert.deepEqual((await save(page)).petting,first.petting);
  await page.getByRole('button',{name:'設定を開く',exact:true}).click();await page.locator('#road-decoration').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'save-export');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'road-decoration');
  await page.locator('#ready-sound').click();await page.getByRole('button',{name:'設定を閉じる',exact:true}).click();await page.locator('#start').click();await page.getByRole('button',{name:'出発する'}).click();await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='running');
  const begun=await save(page);await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='result',null,{timeout:45000});
  await page.locator('#retry-settlement').waitFor({state:'visible'});const failed=await save(page);assert.equal(failed.activeRun.runId,begun.activeRun.runId);assert.equal(failed.coins,begun.coins);assert.equal(failed.records.runsCleared,0);assert.equal(await page.locator('#end').isEnabled(),false);
  await page.getByRole('button',{name:'コインの保存を再試行',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#result-coins').textContent.startsWith('おさんぽコイン +'));
  const settled=await save(page);assert.equal(settled.activeRun,null);assert.equal(settled.records.lastRun.runId,begun.activeRun.runId);assert.equal(settled.records.runsCleared,1);assert.ok(settled.coins>0);assert.equal(await page.locator('#end').isEnabled(),true);
  checks.push({engine:engine.name(),dragIgnored:true,multitouchIgnored:true,keyboardSelectOrder:true,settlementAbortPreservesRun:true,sameRunRetry:true,singleReward:true});
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await writeFile('test-results/browser-finish-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,executedAt:new Date().toISOString(),status:'PASS',checks,errors,limitations:['synthetic pointer cancel/drag rejection; actual device multi-touch remains iPhone check']},null,2));console.log(JSON.stringify({checks,errors}));
