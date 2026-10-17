import {confirmDeparture} from './browser-departure.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '../src/config.js';
const {chromium} = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const out=fileURLToPath(new URL('../test-results/',import.meta.url));
await mkdir(`${out}/runner-video`,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,recordVideo:{dir:`${out}/runner-video`,size:{width:390,height:844}}});
const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
const video=p.video();
try {
 await p.goto('http://127.0.0.1:4182/?test=1&seed=42');await p.waitForLoadState('networkidle');
 await p.waitForFunction(()=>window.__dogBoneTest.renderer.dogs?.stats.ready);
 await p.locator('#ready-settings').click();await p.locator('#ready-sound').click();await p.locator('#settings-close').click();
 const bones=await p.evaluate(()=>window.__dogBoneTest.game.bones.map(b=>({at:b.timeMs-340,lane:b.lane})));
 await p.locator('#start').click();await confirmDeparture(p);await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
 for (const b of bones) {
   await p.waitForFunction(at=>window.__dogBoneTest.game.timeMs>=at,b.at,{timeout:5000,polling:16});
   assert.equal(await p.locator('#game').getAttribute('data-state'),'running');
   const lane=await p.evaluate(()=>window.__dogBoneTest.game.lane);
   if (lane!==b.lane) await p.keyboard.press(b.lane>lane?'ArrowRight':'ArrowLeft');
 }
 await p.waitForFunction(()=>window.__dogBoneTest.game.state==='result',undefined,{timeout:5000});
 const evidence=await p.evaluate(()=>({result:window.__dogBoneTest.game.result(),frames:window.__dogBoneTest.metrics.summary(),pauses:window.__dogBoneTest.log.events.filter(e=>e.type==='pause'),mode:window.__dogBoneTest.renderer.dogs.stats.mode}));
 assert.equal(evidence.result.completed,true);assert.equal(evidence.result.timeMs,30000);
 assert.equal(evidence.result.collected,evidence.result.placed);assert.deepEqual(evidence.pauses,[]);assert.deepEqual(errors,[]);
 assert.ok(evidence.frames.frames>=1000);assert.ok(evidence.frames.p95Ms<=34,JSON.stringify(evidence.frames));
 await p.screenshot({path:`${out}/runner-realtime-result.png`});
 await writeFile(`${out}/runner-realtime-results.json`,JSON.stringify({buildVersion:CONFIG.buildVersion,engine:'desktop Chromium',scope:'real time 30s, 390x844 viewport, no synthetic clock; not iPhone hardware',...evidence,errors},null,2));
 console.log(JSON.stringify(evidence,null,2));
} finally {await context.close();await browser.close();await copyFile(await video.path(),`${out}/runner-preview.webm`);}
