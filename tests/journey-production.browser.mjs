import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const{chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.JOURNEY_PRODUCTION_URL??'http://127.0.0.1:4198/';
const output='test-results/journey-v38/production';await mkdir(output,{recursive:true});const results=[];
for(const engine of[chromium,webkit].filter(e=>!process.env.JOURNEY_ENGINE||e.name()===process.env.JOURNEY_ENGINE)){
  let ownedServer=null,engineBase=base;
  if(engine===webkit){
    ownedServer=spawn(process.execPath,['scripts/server.mjs','--dist','--port','4201'],{stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('isolated server startup timed out')),10000);
      ownedServer.once('error',error=>{clearTimeout(timeout);reject(error);});
      ownedServer.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
      ownedServer.once('exit',code=>{clearTimeout(timeout);if(code)reject(new Error(`isolated server exited ${code}`));});
    });
    engineBase='http://127.0.0.1:4201/';
  }
  const browser=await engine.launch(renderingLaunchOptions(engine));
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:1,
    ...(engine===chromium?{recordVideo:{dir:`${output}/video`,size:{width:390,height:844}}}:{})});
  const page=await context.newPage(),errors=[],badResponses=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
  try{
    const start=Date.now();await page.goto(engineBase,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>!document.querySelector('#start').disabled,null,{timeout:60000});
    assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
    const loadedMs=Date.now()-start;
    await page.click('#start');await page.click('[data-action="place"][data-place="park"]');
    await page.click('[data-action="route"][data-route="park-3"]');
    await page.locator('#hud').waitFor({state:'visible',timeout:30000});
    const realStart=Date.now();
    await page.waitForFunction(()=>Number(document.querySelector('#clock-seconds').textContent)<=16,null,{timeout:25000});
    if(engine===chromium){
      const rect=await page.locator('#scene').boundingBox(),cdp=await context.newCDPSession(page);
      const x=rect.x+rect.width*.5,y=rect.y+rect.height*.7;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+64,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>Number(document.querySelector('#clock-seconds').textContent)<=8,null,{timeout:15000});
    await page.keyboard.press('ArrowLeft');await page.waitForTimeout(250);await page.keyboard.press('ArrowLeft');
    await page.locator('#result').waitFor({state:'visible',timeout:18000});
    await page.waitForFunction(()=>document.querySelector('#journey-dialog')?.textContent.includes('コイン')&&!document.querySelector('#journey-dialog')?.textContent.includes('思い出を保存しています'));
    const realDurationMs=Date.now()-realStart;assert.ok(realDurationMs>=28000&&realDurationMs<=45000,`real duration ${realDurationMs}`);
    const body=await page.locator('#journey-dialog').innerText();assert.match(body,/水面を進むカモ/);assert.match(body,/風に揺れるヨシ/);
    await page.screenshot({path:`${output}/${engine.name()}-real-result.png`});
    await page.click('[data-focus-key="result-home"]');await page.locator('#start').waitFor({state:'visible'});
    let offline=false;
    if(await page.evaluate(()=>'serviceWorker' in navigator)){
      await page.evaluate(()=>navigator.serviceWorker.ready);
      await page.click('[data-home-action="album"]');await page.click('[data-action="offline"]');
      await page.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.includes('準備ができました'),null,{timeout:120000});
      await page.click('#journey-dialog [data-action="close"]');
      if(engine===webkit){
        // Playwright WebKit's synthetic offline mode can reject SW navigation
        // before FetchEvent handles it (upstream #42775). Stop our isolated
        // HTTP server instead, so the worker faces actual network failure.
        await new Promise(resolve=>{ownedServer.once('exit',resolve);ownedServer.kill('SIGTERM');});
      }else await context.setOffline(true);
      await page.reload({waitUntil:'networkidle'});
      await page.waitForFunction(()=>!document.querySelector('#start').disabled,null,{timeout:60000});
      if(await page.locator('.shop-takeover').isVisible())await page.locator('.shop-takeover').click();
      for(const place of['street','park','mountain','cave']){
        await page.click('#start');await page.click(`[data-action="place"][data-place="${place}"]`);await page.click(`[data-action="route"][data-route="${place}-1"]`);
        await page.locator('#hud').waitFor({state:'visible',timeout:30000});await page.waitForTimeout(350);
        await page.click('#pause');await page.click('#quit');await page.locator('#start').waitFor({state:'visible'});
      }
      offline=true;await page.screenshot({path:`${output}/${engine.name()}-offline-home.png`});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
    const result={engine:engine.name(),noDiagnosticHooks:true,realDurationMs,realTouch:engine===chromium,realKeyboard:true,loadedMs,memoriesPersisted:true,allFourWorldsOffline:offline,offlineMethod:engine===webkit?'isolated origin server stopped':'browser offline emulation',errors,badResponses};
    results.push(result);
    await writeFile(`${output}/${engine.name()}-results.json`,JSON.stringify(result,null,2));
  }catch(error){await page.screenshot({path:`${output}/${engine.name()}-failure.png`});await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:error.stack,body:await page.locator('body').innerText(),errors,badResponses},null,2));throw error;}
  finally{await context.close();await browser.close();ownedServer?.kill('SIGTERM');}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
