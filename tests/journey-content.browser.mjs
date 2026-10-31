import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {JOURNEY_ROUTES} from '../src/journey-catalog.js';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/journey-v38/content';await mkdir(output,{recursive:true});const results=[];
for(const engine of[chromium,webkit].filter(e=>!process.env.JOURNEY_ENGINE||e.name()===process.env.JOURNEY_ENGINE)){
  const browser=await engine.launch(renderingLaunchOptions(engine));
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto('http://127.0.0.1:4197/?test=1',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop?.journey&&!document.querySelector('#start').disabled,null,{timeout:60000});
    await page.evaluate(()=>window.__dogBoneTest.audio.setEnabled(false));
    const routes=[];
    for(const route of JOURNEY_ROUTES){
      await page.evaluate(async id=>{await window.__dogBoneTest.selectJourneyRoute(id,'calm');},route.id);
      await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
      await page.evaluate(()=>{const{game}=window.__dogBoneTest;game.advance(5000-game.timeMs);window.__dogBoneTest.pause('manual');});
      await page.screenshot({path:`${output}/${engine.name()}-${route.id}.png`});
      await page.click('#resume');await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
      await page.evaluate(()=>{
        const{game}=window.__dogBoneTest;
        for(const discovery of game.discoveries){
          game.advance(Math.max(0,discovery.timeMs-900-game.timeMs));
          for(let i=0;i<3&&Math.abs(game.x-discovery.lane)>.1;i++){game.command(Math.sign(discovery.lane-game.x),'content-test');game.advance(250);}
          game.advance(Math.max(0,discovery.timeMs+240-game.timeMs));
        }
        game.advance(Math.max(0,game.durationMs-game.timeMs));
      });
      await page.waitForFunction(()=>window.__dogBoneTest.game.state==='result'&&!window.__dogBoneTest.homeShop.pendingReward&&!window.__dogBoneTest.homeShop.pending);
      const result=await page.evaluate(()=>({routeId:window.__dogBoneTest.game.journeyRouteId,discoveries:window.__dogBoneTest.game.discoveryIds,obstacles:window.__dogBoneTest.game.obstacles.length,save:window.__dogBoneTest.homeShop.state.roomShop.lastReward}));
      assert.equal(result.routeId,route.id);assert.equal(result.obstacles,7);assert.deepEqual(result.discoveries,route.discoveries.map(item=>item.id));
      assert.equal(result.save.journey.newDiscoveryIds.length,3);routes.push({id:route.id,discoveries:result.discoveries,obstacles:result.obstacles,reward:result.save.reward});
      await page.locator('[data-focus-key="result-home"]').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='ready');
    }
    const save=await page.evaluate(()=>window.__dogBoneTest.homeShop.state.roomShop.journey);
    assert.equal(save.completedRoutes.length,12);assert.equal(save.discoveryIds.length,36);assert.equal(save.completedRuns,12);
    assert.deepEqual(errors,[]);results.push({engine:engine.name(),routes,completedRoutes:12,collectedDiscoveries:36,errors});
  }catch(error){await page.screenshot({path:`${output}/${engine.name()}-failure.png`});throw error;}
  finally{await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
