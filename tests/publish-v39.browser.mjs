import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.PUBLISH_URL??'https://ta713ku-ops.github.io/dog-bone-run/?v=0.39.0';
const output=process.env.PUBLISH_OUTPUT??'test-results/github-publish-v39/browser';
await mkdir(output,{recursive:true});const results=[];
for(const engine of[chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 const page=await context.newPage(),errors=[],bad=[],failed=[];page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push({url:r.url(),status:r.status()});});page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText??''}));
 const shot=name=>page.screenshot({path:`${output}/${engine.name()}-${name}.png`});
 const clearLease=async()=>{if(await page.locator('.shop-takeover').isVisible())await page.locator('.shop-takeover').click();};
 try{
  await page.goto(base,{waitUntil:'networkidle',timeout:90000});await page.locator('#start:not([disabled])').waitFor({timeout:90000});
  assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
  const version=await(await page.request.get(new URL('version.json',base).href)).json();assert.equal(version.buildVersion,'0.39.0');assert.equal(version.diagnosticBuild,false);
  await page.click('[data-home-action="name"]');await page.locator('[data-dog-name-input]').fill('こむぎ');await page.click('[data-action="save-name"]');await page.locator('#journey-dialog').waitFor({state:'hidden'});await shot('home');
  await page.click('#start');await page.click('[data-action="place"][data-place="park"]');await page.click('[data-route="park-3"]');await page.locator('#hud').waitFor({state:'visible',timeout:60000});const began=Date.now();
  await page.locator('.journey-observation[open]').waitFor({timeout:20000});
  const clock=await page.locator('#clock-seconds').innerText();await page.waitForTimeout(700);assert.equal(await page.locator('#clock-seconds').innerText(),clock);
  await page.locator('.journey-observation-actions button').first().click();await shot('observation');
  await page.getByRole('button',{name:'写真を撮る',exact:true}).click();await page.locator('.journey-photo-preview[open]').waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'端末にも保存',exact:true}).click();assert.ok(await(await download).path());
  await page.getByRole('button',{name:'写真帳に残して戻る',exact:true}).click();await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('#clock-seconds').textContent)<=17);
  if(engine===chromium){const b=await page.locator('#scene').boundingBox(),cdp=await context.newCDPSession(page),x=b.x+b.width*.5,y=b.y+b.height*.65;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+65,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else await page.keyboard.press('ArrowRight');
  await page.locator('.journey-observation[open]').waitFor({timeout:7000});await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('#clock-seconds').textContent)<=7);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(250);await page.keyboard.press('ArrowLeft');
  await page.locator('.journey-observation[open]').waitFor({timeout:7000});await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();
  await page.locator('[data-focus-key="result-home"]').waitFor({timeout:15000});await page.waitForFunction(()=>document.querySelector('#journey-dialog')?.textContent.includes('コイン'));
  for(const title of['水面を進むカモ','風に揺れるヨシ','トンボのひと休み'])assert.match(await page.locator('#journey-dialog').innerText(),new RegExp(title));assert.ok(Date.now()-began>=30000);await shot('result');await page.locator('[data-focus-key="result-home"]').click();
  await page.reload({waitUntil:'networkidle',timeout:90000});await page.locator('#start:not([disabled])').waitFor({timeout:90000});await clearLease();assert.match(await page.locator('.journey-home-identity').innerText(),/こむぎ/);
  await page.click('[data-home-action="photo"]');await page.locator('.journey-photo-grid article').waitFor();assert.equal(await page.locator('.journey-photo-grid article').count(),1);await page.waitForFunction(()=>document.querySelector('.journey-photo-grid img')?.naturalWidth>0);await shot('photo-persisted');await page.getByRole('button',{name:'写真帳を閉じる',exact:true}).click();
  await page.click('[data-home-action="album"]');await page.click('[data-action="memory"][data-memory="park-3-duck"]');await page.waitForFunction(()=>document.querySelector('#journey-dialog img[data-specific-art]')?.naturalWidth>0);assert.match(await page.locator('#journey-dialog').innerText(),/こむぎ/);await shot('memory-persisted');await page.click('#journey-dialog [data-action="close"]');await page.click('#journey-dialog [data-action="close"]');
  await page.click('#start');await page.click('[data-action="extras"]');assert.equal(await page.getByRole('button',{name:'追加の散歩集に含まれます',exact:true}).count(),2);for(const b of await page.getByRole('button',{name:'追加の散歩集に含まれます',exact:true}).all())assert.equal(await b.isDisabled(),true);await shot('extras');await page.getByRole('button',{name:'ホームへ戻る',exact:true}).click();
  await page.click('#start');await page.click('[data-action="classic"]');for(const n of[1,2,3,4])assert.equal(await page.locator(`#walk-level-${n}`).isVisible(),true);await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);
  const optionalHdAborts=failed.filter(f=>/\/art\/(?:dog-walk-hd\.|dog-hd\/)/.test(f.url)&&/abort|cancel/i.test(f.error));assert.deepEqual(failed.filter(f=>!optionalHdAborts.includes(f)),[]);
  results.push({engine:engine.name(),base,version:version.buildVersion,noDiagnosticAPI:true,real30ActiveSeconds:true,threeObservations:true,touchSwipe:engine===chromium,photoPngExport:true,photoAndNameAndMemoryPersisted:true,paidRoutesLocked:true,classicFourChoices:true,optionalHdAborts:optionalHdAborts.length,errors,badResponses:bad});
 }catch(e){await shot('failure');await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:e.stack,text:await page.locator('body').innerText(),errors,bad,failed},null,2));throw e;}
 finally{await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
