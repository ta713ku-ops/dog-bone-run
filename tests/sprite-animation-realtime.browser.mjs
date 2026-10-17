import {confirmDeparture} from './browser-departure.mjs';
// Legacy fallback regression; the new default is covered by continuity-home/realtime.
import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '../src/config.js';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out=fileURLToPath(new URL('../test-results/',import.meta.url));
await mkdir(`${out}/animation-video`,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,recordVideo:{dir:`${out}/animation-video`,size:{width:390,height:844}}});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const video=page.video();
await page.route('**/art/dog-home-*.webp*',r=>r.abort());
try{
 await page.route('**/dog-home-continuity.json*',route=>route.abort());
 await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);
 await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready && window.__dogBoneTest.renderer.dogs.stats.animationReady);
 await page.locator('#ready-settings').click();await page.locator('#ready-sound').click();await page.locator('#settings-close').click();
 await page.waitForTimeout(2500);
 const poses=[];
 for(const [id,index,delay,name] of [['home-sit',3,1700,'sit'],['home-lie',8,2750,'lie'],['home-greet',5,500,'greet']]){
  await page.locator(`#${id}`).click();await page.waitForTimeout(delay);
  const pose=await page.evaluate(()=>window.__dogBoneTest.renderer.homeSample);
  assert.equal(pose.index,index);poses.push({name,...pose});
  await page.screenshot({path:`${out}/animated-realtime-${name}.png`});
  await page.waitForFunction(()=>!window.__dogBoneTest.renderer.homeBusy,undefined,{timeout:8500});
 }
 const bones=await page.evaluate(()=>window.__dogBoneTest.game.bones.map(b=>({at:b.timeMs-340,lane:b.lane})));
 await page.locator('#start').click();await confirmDeparture(page);await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
 for(const b of bones){
  await page.waitForFunction(at=>window.__dogBoneTest.game.timeMs>=at,b.at,{timeout:5000,polling:16});
  assert.equal(await page.locator('#game').getAttribute('data-state'),'running');
  const lane=await page.evaluate(()=>window.__dogBoneTest.game.lane);
  if(lane!==b.lane)await page.keyboard.press(b.lane>lane?'ArrowRight':'ArrowLeft');
 }
 await page.waitForFunction(()=>window.__dogBoneTest.game.state==='result',undefined,{timeout:5000});
 const evidence=await page.evaluate(()=>({result:window.__dogBoneTest.game.result(),frames:window.__dogBoneTest.metrics.summary(),pauses:window.__dogBoneTest.log.events.filter(e=>e.type==='pause'),assets:window.__dogBoneTest.renderer.dogs.stats}));
 assert.equal(evidence.result.completed,true);assert.equal(evidence.result.timeMs,30000);
 assert.equal(evidence.result.collected,evidence.result.placed);assert.deepEqual(evidence.pauses,[]);assert.deepEqual(errors,[]);
 assert.ok(evidence.frames.frames>=1000);assert.ok(evidence.frames.p95Ms<=34,JSON.stringify(evidence.frames));
 await page.screenshot({path:`${out}/animated-realtime-result.png`});
 await writeFile(`${out}/sprite-animation-realtime-results.json`,JSON.stringify({buildVersion:CONFIG.buildVersion,engine:'desktop Chromium',scope:'real home gestures and 30s run, 390x844 viewport, DPR2, no synthetic clock; not iPhone hardware',poses,...evidence,errors},null,2));
 console.log(JSON.stringify(evidence,null,2));
}finally{await context.close();await browser.close();await copyFile(await video.path(),`${out}/sprite-animation-preview.webm`);}
