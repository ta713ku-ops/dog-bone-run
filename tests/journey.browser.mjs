import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.JOURNEY_URL??'http://127.0.0.1:4197/?test=1';
const output=process.env.JOURNEY_OUTPUT??'test-results/journey-v38';
await mkdir(output,{recursive:true});const results=[];
for(const engine of[chromium,webkit].filter(e=>!process.env.JOURNEY_ENGINE||e.name()===process.env.JOURNEY_ENGINE)){
  const browser=await engine.launch(renderingLaunchOptions(engine));
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,acceptDownloads:true});
  const page=await context.newPage(),errors=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  const screenshot=name=>page.screenshot({path:`${output}/${engine.name()}-${name}.png`});
  const ready=async()=>{
    await page.waitForFunction(()=>window.__dogBoneTest?.homeShop.state?.roomShop?.journey&&!document.querySelector('#start').disabled,null,{timeout:60000});
    if(await page.locator('.shop-takeover').isVisible())await page.locator('.shop-takeover').click();
  };
  const noOverflow=async(selector='body')=>assert.ok(await page.locator(selector).evaluate(element=>element.scrollWidth<=element.clientWidth+2),`${selector} must not overflow`);
  const returnHome=async()=>{
    await page.locator('[data-focus-key="result-home"]').click();
    await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='ready'&&!document.querySelector('#journey-dialog').open);
  };
  const completeRoute=async()=>{
    await page.evaluate(()=>{
      const game=window.__dogBoneTest.game;
      for(const discovery of game.discoveries){
        if(discovery.status!=='pending')continue;
        game.advance(Math.max(0,discovery.timeMs-900-game.timeMs));
        for(let guard=0;guard<3&&Math.abs(game.x-discovery.lane)>.1;guard++){
          game.command(Math.sign(discovery.lane-game.x),'journey-browser-test');game.advance(250);
        }
        game.advance(Math.max(0,discovery.timeMs+240-game.timeMs));
      }
      game.advance(Math.max(0,game.durationMs-game.timeMs));
    });
    await page.waitForFunction(()=>window.__dogBoneTest.game.state==='result'&&!window.__dogBoneTest.homeShop.pendingReward&&!window.__dogBoneTest.homeShop.pending,null,{timeout:15000});
  };
  try{
    await page.goto(base,{waitUntil:'networkidle'});await ready();await screenshot('home');
    await page.click('#start');await page.locator('#journey-dialog').waitFor({state:'visible'});
    for(const place of['street','park','mountain','cave']){
      await page.click(`[data-action="place"][data-place="${place}"]`);
      assert.equal(await page.locator('[data-action="route"]').count(),3);
    }
    await page.click('[data-action="place"][data-place="street"]');
    await noOverflow('#journey-dialog');await screenshot('map');
    await page.click('[data-route="street-1"][data-action="route"]');
    await page.locator('#hud').waitFor({state:'visible',timeout:30000});
    await page.evaluate(()=>{const game=window.__dogBoneTest.game;game.advance(Math.max(0,8300-game.timeMs));});
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.state),'running','finding a memory must not interrupt a walk');
    assert.equal(await page.locator('#journey-dialog').isVisible(),false);
    assert.ok((await page.evaluate(()=>window.__dogBoneTest.game.discoveryIds)).includes('street-1-bakery'));
    await screenshot('discovery');await completeRoute();
    let state=await page.evaluate(()=>window.__dogBoneTest.homeShop.state);
    assert.equal(state.roomShop.journey.completedRuns,1);assert.equal(state.roomShop.journey.discoveryIds.length,3);
    assert.ok(state.coins>=140);await screenshot('result');
    await returnHome();
    await page.click('#home-shop');await page.click('[data-item="rug-oat"]');await page.locator('#preview-place').waitFor({state:'visible'});
    await page.click('#preview-place');await page.locator('#home-shop-dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.homeShop.state.roomShop.equipped.rug),'rug-oat');
    await page.click('#home-decorate');await page.click('[data-item="starterBall"]');await page.click('#preview-place');
    await page.locator('#home-shop-dialog').waitFor({state:'hidden'});
    await page.waitForFunction(()=>!window.__dogBoneTest.renderer.homeBusy,null,{timeout:15000});
    await page.click('[data-reaction="starterBall"]');
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.renderer.homeReaction?.kind),'ball');
    await page.click('[data-home-action="album"]');await page.locator('#journey-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-action="memory"]').count(),3);await screenshot('album');
    const downloadPromise=page.waitForEvent('download');await page.click('[data-action="export"]');const downloaded=await downloadPromise;
    const backup=await readFile(await downloaded.path(),'utf8');assert.equal(JSON.parse(backup).format,'hone-no-osanpo-save');
    const before=await page.evaluate(()=>JSON.stringify(window.__dogBoneTest.homeShop.state.roomShop.journey));
    const invalid=JSON.parse(backup);invalid.payload.save.coins=999999;
    await page.locator('[data-action="import-file"]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await page.waitForFunction(()=>!document.querySelector('#journey-dialog').open);
    assert.equal(await page.locator('.journey-transfer-confirm').count(),0);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__dogBoneTest.homeShop.state.roomShop.journey)),before);
    await page.click('[data-home-action="album"]');
    await page.locator('[data-action="import-file"]').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(backup)});
    await page.locator('#journey-import-confirm').waitFor({state:'visible'});await page.click('#journey-import-confirm');
    await page.waitForFunction(()=>!document.querySelector('.journey-transfer-confirm')&&!window.__dogBoneTest.homeShop.pending);
    await page.reload();await ready();
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.homeShop.state.roomShop.journey.discoveryIds.length),3);
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.homeShop.state.roomShop.equipped.toy),'starterBall');
    const photoPromise=page.waitForEvent('download');await page.click('[data-home-action="photo"]');const photo=await photoPromise;
    const photoBytes=await readFile(await photo.path());assert.equal(photoBytes.subarray(1,4).toString(),'PNG');
    for(const size of[{width:320,height:740},{width:844,height:390},{width:1024,height:768}]){
      await page.setViewportSize(size);await noOverflow();await page.click('[data-home-action="map"]');await noOverflow('#journey-dialog');await screenshot(`map-${size.width}`);await page.click('#journey-dialog [data-action="close"]');
    }
    await page.setViewportSize({width:390,height:844});await page.click('#start');await page.click('[data-action="classic"]');
    await page.locator('#walk-picker').waitFor({state:'visible'});assert.equal(await page.locator('#walk-level-4').isVisible(),true);
    await page.click('#walk-level-1');await page.click('#walk-picker-start');await page.locator('#hud').waitFor({state:'visible',timeout:30000});
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.journeyRouteId),null);
    await page.click('#pause');await page.click('#quit');
    await page.goto(new URL('about.html',base).href,{waitUntil:'networkidle'});
    await noOverflow();await screenshot('about-mobile');
    await page.setViewportSize({width:1280,height:900});await noOverflow();await screenshot('about-desktop');
    assert.equal(await page.getByRole('link',{name:'無料で、おさんぽに出かける',exact:false}).count(),1);
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    results.push({engine:engine.name(),routes:12,discoveries:36,actualCollected:3,firstTripRug:true,ballReaction:true,backup:true,rejectedTampering:true,reload:true,photo:true,viewports:[320,390,844,1024],classic:true,errors,failed});
  }catch(error){await screenshot('failure');await writeFile(`${output}/${engine.name()}-failure.json`,JSON.stringify({error:error.stack,body:await page.locator('body').innerText(),errors,failed},null,2));throw error;}
  finally{await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
