import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRaisingCourse} from '../src/raising-course.js';
import {calculateFullClearReference} from '../src/raising-model.js';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'playwright');
const base=process.env.DOG_TEST_URL??'http://127.0.0.1:4183',checks=[],errors=[];
async function state(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('dog-bone-run-save-v2');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('records'),get=tx.objectStore('records').get('save');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};}));}
async function activeTime(page){const text=await page.locator('#clock').textContent();return (30-Number(text.match(/のこり ([\d.]+)秒/)?.[1]))*1000;}
await mkdir('test-results',{recursive:true});
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForFunction(()=>document.querySelector('#start').disabled===false);
  assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
  await page.getByRole('button',{name:'設定を開く',exact:true}).click();await page.locator('#ready-sound').click();await page.getByRole('button',{name:'設定を閉じる',exact:true}).click();await page.locator('#start').click();await page.getByRole('button',{name:'出発する'}).click();await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='running');
  const start=await state(page);assert.ok(start.activeRun);const {seed,difficulty,runId}=start.activeRun,course=createRaisingCourse(seed,difficulty);let lane=0,paused=false;
  for(const bone of course.bones){
   const target=bone.distance*1000-350;
   while(await activeTime(page)<target){const delta=target-await activeTime(page);await page.waitForTimeout(Math.max(10,Math.min(delta,80)));}
   if(!paused&&target>6000){await page.locator('#pause').click();const frozen=await page.locator('#clock').textContent();await page.waitForTimeout(3000);assert.equal(await page.locator('#clock').textContent(),frozen);const still=await state(page);assert.equal(still.coins,0);assert.equal(still.activeRun.runId,runId);await page.getByRole('button',{name:'再開する',exact:true}).click();paused=true;}
   if(lane!==bone.lane){await page.keyboard.press(bone.lane>lane?'ArrowRight':'ArrowLeft');lane=bone.lane;}
   if(bone.distance>13&&bone.distance<14)await page.screenshot({path:`test-results/raising-run-${engine.name()}.png`});
  }
  await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='result');await page.waitForFunction(()=>document.querySelector('#result-coins').textContent.startsWith('おさんぽコイン +'));
  const settled=await state(page),reference=calculateFullClearReference(course,difficulty);
  assert.equal(settled.activeRun,null);assert.equal(settled.records.runsCleared,1);assert.equal(settled.records.lastRun.runId,runId);assert.equal(settled.records.lastRun.reward,reference);assert.equal(settled.coins,reference);assert.equal(settled.records.unlockedDifficulty,2);assert.equal(await page.locator('#result-time').textContent(),'30.00秒');
  await page.screenshot({path:`test-results/raising-clear-${engine.name()}.png`});
  await page.getByRole('button',{name:'おわる',exact:true}).click();await page.waitForTimeout(1500);const home=await state(page);assert.equal(home.coins,reference);assert.equal(home.records.runsCleared,1);
  checks.push({engine:engine.name(),seed,difficulty,runId,reference,realTime30s:true,pauseExcluded:true,allBones:true,settlement:true,singleReward:true,unlock2:true});
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await writeFile('test-results/raising-run-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,executedAt:new Date().toISOString(),status:'PASS',checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
