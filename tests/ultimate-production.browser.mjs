import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/ultimate-v39/production';await mkdir(output,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 let server=null,url='http://127.0.0.1:4198/';
 if(engine===webkit){server=spawn(process.execPath,['scripts/server.mjs','--dist','--port','4201'],{stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});url='http://127.0.0.1:4201/';}
 const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await context.newPage(),errors=[],bad=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push({url:r.url(),status:r.status()});});
 const shot=name=>page.screenshot({path:`${output}/${engine.name()}-${name}.png`});
 try{
   const began=Date.now();await page.goto(url,{waitUntil:'networkidle'});await page.locator('#start:not([disabled])').waitFor({timeout:60000});
   assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');const readyMs=Date.now()-began;
   await page.click('#start');await page.click('[data-action="place"][data-place="park"]');await page.click('[data-route="park-3"]');await page.locator('#hud').waitFor({state:'visible',timeout:30000});const started=Date.now();
   await page.locator('.journey-observation[open]').waitFor({timeout:18000});const clock=await page.locator('#clock-seconds').innerText();await page.waitForTimeout(500);assert.equal(await page.locator('#clock-seconds').innerText(),clock);await shot('observation');
   await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();
   await page.waitForFunction(()=>Number(document.querySelector('#clock-seconds').textContent)<=17);
   if(engine===chromium){const bounds=await page.locator('#scene').boundingBox(),cdp=await context.newCDPSession(page),x=bounds.x+bounds.width*.5,y=bounds.y+bounds.height*.65;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+65,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else await page.keyboard.press('ArrowRight');
   await page.locator('.journey-observation[open]').waitFor({timeout:5000});await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();
   await page.waitForFunction(()=>Number(document.querySelector('#clock-seconds').textContent)<=7);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(250);await page.keyboard.press('ArrowLeft');
   await page.locator('.journey-observation[open]').waitFor({timeout:5000});await page.getByRole('button',{name:'おさんぽを続ける',exact:true}).click();
   await page.locator('[data-focus-key="result-home"]').waitFor({timeout:15000});await page.waitForFunction(()=>document.querySelector('#journey-dialog')?.textContent.includes('コイン'));
   const result=await page.locator('#journey-dialog').innerText();for(const title of ['水面を進むカモ','風に揺れるヨシ','トンボのひと休み'])assert.match(result,new RegExp(title));assert.ok(Date.now()-started>=30000);await shot('result');
   await page.locator('[data-focus-key="result-home"]').click();await page.click('[data-home-action="album"]');await page.click('[data-action="offline"]');
   await page.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.includes('準備ができました'),null,{timeout:120000});await page.locator('#journey-dialog [data-action="close"]').click();
   if(engine===webkit)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});else await context.setOffline(true);
   await page.reload({waitUntil:'networkidle'});await page.locator('#start:not([disabled])').waitFor({timeout:60000});
   if(await page.locator('.shop-takeover').isVisible())await page.locator('.shop-takeover').click();
   for(const place of['street','park','mountain','cave']){
     await page.click('#start');await page.click(`[data-action="place"][data-place="${place}"]`);await page.click(`[data-route="${place}-1"]`);await page.locator('#hud').waitFor({state:'visible',timeout:30000});await page.click('#pause');await page.click('#quit');await page.locator('#start').waitFor({state:'visible'});
   }
   await page.click('[data-home-action="album"]');await page.locator('[data-action="memory"][data-memory="park-3-duck"]').click();
   const loaded=await page.locator('#journey-dialog img[data-specific-art]').evaluate(img=>img.complete&&img.naturalWidth>0);assert.equal(loaded,true);await shot('offline-memory');
   assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);results.push({engine:engine.name(),noDiagnosticAPI:true,real30ActiveSeconds:true,threeObservations:true,touch:engine===chromium,allFourWorldsOffline:true,memoryArtOffline:true,readyMs,errors,badResponses:bad,offlineMethod:engine===webkit?'isolated origin server stopped':'browser offline emulation'});
 }catch(e){await shot('failure');await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:e.stack,text:await page.locator('body').innerText(),errors,bad},null,2));throw e;}
 finally{await context.close();await browser.close();server?.kill('SIGTERM');}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
