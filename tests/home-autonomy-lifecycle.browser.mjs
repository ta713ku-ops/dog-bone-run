import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-autonomy';await mkdir(out,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),page=await browser.newPage({viewport:{width:390,height:844}});
 try{
  await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await page.evaluate(()=>__dogBoneTest.renderer.ready);
  await page.waitForFunction(()=>!document.querySelector('#home-lie').disabled);
  await page.locator('#home-lie').click();await page.waitForTimeout(500);
  const manual=await page.evaluate(()=>{
   const r=__dogBoneTest.renderer;r.setMenuPaused(true);
   const current=r.updateHomeSample(r.menuElapsedMs).layers;r.setReducedMotion(true);
   assertFrozen();function assertFrozen(){if(JSON.stringify(r.updateHomeSample(r.menuElapsedMs).layers)!==JSON.stringify(current))throw Error('reduced manual jumped');}
   const later=r.menuElapsedMs+5000;r.menuElapsedMs=later;assertFrozen();
   r.setReducedMotion(false);assertFrozen();if(r.homeInteraction?.action!=='lie')throw Error('manual did not resume');
   r.updateHomeSample(later+r.homeInteraction.durationMs);if(!r.homeAutonomy.snapshot.manualHold)throw Error('manual hold lost');
   return {layers:current,resumed:true,manualHold:r.homeAutonomy.snapshot.manualHold};
  });
  // Use the actual renderer to test a fresh menu visit and the optional-asset fallback.
  const lifecycle=await page.evaluate(()=>{
   const {renderer:r,game}=__dogBoneTest;r.setMenuPaused(true);
   game.start();r.draw(game);game.abandon();r.draw(game);
   if(r.homeInteraction||r.homeAutoCommand||r.homeSuspendedManualAction)throw Error('old action leaked to home');
   if(r.homePosture!=='stand'||r.homeAutonomy.snapshot.manualHold)throw Error('home did not reset');
   const original=r.dogs.stats.continuityReady;r.dogs.stats.continuityReady=false;
   r.homeInteraction=null;r.homeHeldFrame=null;r.updateHomeSample(25000);if(!r.homeGesture('sit'))throw Error('fallback command unavailable');
   const sample=r.updateHomeSample(26000);if(!sample.atlas)throw Error('fallback lost dog');
   r.dogs.stats.continuityReady=original;r.reset();r.setMenuPaused(false);return {returnReset:true,assetFallback:true};
  });
  await page.screenshot({path:`${out}/${engine.name()}-final-home.png`});results.push({engine:engine.name(),manual,lifecycle});
 }finally{await browser.close();}
}
await writeFile(out+'/lifecycle-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
