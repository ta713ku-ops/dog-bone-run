import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-shop/realtime';await mkdir(out,{recursive:true});
const browser=await chromium.launch(renderingLaunchOptions(chromium));
// Empty ephemeral browser storage. No fixture coins: start with zero, earn via
// actual real-time Game clocks, then buy the120coin rug through the visible UI.
const context=await browser.newContext({storageState:{cookies:[],origins:[]},viewport:{width:390,height:844},deviceScaleFactor:1,recordVideo:{dir:out+'/raw',size:{width:390,height:844}}});
const page=await context.newPage(),video=page.video(),errors=[],runs=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4182/?test=1&seed=42');await page.waitForFunction(()=>window.__dogBoneTest?.homeShop?.owner&&__dogBoneTest.renderer.dogs.stats.continuityReady);
 assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.state.coins),0);
 await page.click('#ready-settings');await page.click('#ready-sound');await page.click('#settings-close');
 for(let run=0;run<4;run++){
  await page.click('#start');await page.click('#walk-picker-start');await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
  const start=Date.now();
  await page.evaluate(()=>{window.__shopAutopilot=setInterval(()=>{const g=__dogBoneTest.game;if(g.state!=='running')return;const next=g.course.find(b=>b.timeMs>g.timeMs+180);if(next&&next.timeMs-g.timeMs<650){const target=g.move?.to??g.lane;if(target!==next.lane)g.command(Math.sign(next.lane-target),'realtime-browser-auto');}},80);});
  await page.waitForFunction(()=>__dogBoneTest.game.state==='result',{},{timeout:45000});
  await page.evaluate(()=>clearInterval(window.__shopAutopilot));await page.waitForFunction(()=>!__dogBoneTest.homeShop.pendingReward&&!__dogBoneTest.homeShop.pending);
  runs.push(await page.evaluate(wall=>({wallMs:wall,activeMs:__dogBoneTest.game.timeMs,reward:__dogBoneTest.homeShop.state.roomShop.lastReward.reward,coins:__dogBoneTest.homeShop.state.coins,normal:__dogBoneTest.game.normalCollected,gold:__dogBoneTest.game.goldCollected}),Date.now()-start));
  await page.screenshot({path:`${out}/reward-${run+1}.png`});await page.waitForTimeout(700);await page.click('#end');
  if(runs.at(-1).coins>=120)break;
 }
 assert.ok(runs.at(-1).coins>=120);assert.ok(runs.every(r=>r.wallMs>=29000&&r.activeMs===30000));
 await page.click('#home-shop');await page.screenshot({path:`${out}/earned-shop.png`});await page.click('[data-item="rug-oat"]');await page.waitForTimeout(1500);await page.screenshot({path:`${out}/preview.png`});await page.click('#preview-place');await page.waitForFunction(()=>!document.querySelector('#home-shop-dialog').open);
 const before=await page.evaluate(()=>__dogBoneTest.homeShop.state.coins);assert.equal(before,runs.at(-1).coins-120);
 await page.waitForTimeout(4000);await page.screenshot({path:`${out}/purchased-home.png`});await page.reload();await page.waitForFunction(()=>__dogBoneTest?.homeShop?.owner);assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.state.coins),before);assert.equal(await page.evaluate(()=>__dogBoneTest.homeShop.state.roomShop.equipped.rug),'rug-oat');
 await page.waitForTimeout(3500);await page.screenshot({path:`${out}/reloaded-home.png`});assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({runs,noFixtureCoins:true,realTimeAutomatedInput:true,purchased:'rug-oat',remainingCoins:before,reloadPersists:true,errors},null,2));console.log(JSON.stringify({runs,remainingCoins:before,errors}));
}finally{await context.close();await copyFile(await video.path(),`${out}/walk-shop-home.webm`);await browser.close();}
