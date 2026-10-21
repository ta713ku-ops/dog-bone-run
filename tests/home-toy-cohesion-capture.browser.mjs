import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions}from'./browser-rendering.mjs';
const{chromium}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output=process.env.TOY_CAPTURE_OUTPUT??'test-results/home-toy-cohesion/after';await mkdir(output,{recursive:true});
const browser=await chromium.launch(renderingLaunchOptions(chromium));
const context=await browser.newContext({viewport:{width:320,height:954},storageState:{cookies:[],origins:[]},reducedMotion:'reduce'});
const page=await context.newPage(),errors=[],rows=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4182/?test=1&seed=90341');
 await page.waitForFunction(()=>window.__dogBoneTest?.homeShop?.owner&&window.__dogBoneTest.homeShop.interiorsReady);
 await page.evaluate(async()=>{const t=window.__dogBoneTest;await Promise.all([t.renderer.ready,t.renderer.room.ready,t.renderer.furnitureArt.ready]);const{HOME_SHOP_ITEMS}=await import('/src/home-shop-catalog.js');const c=t.homeShop;const r=await c.store.transact(s=>{s.roomShop.owned=HOME_SHOP_ITEMS.map(i=>i.id);return{state:s,result:'isolated-capture-owned-fixture'};},{expectedRevision:c.state.revision});if(!r.ok)throw Error(r.error);c.state=r.state;c.render();});
 for(const room of ['room-white','room-natural','room-playroom','room-luxe','room-garden']){
  for(const toy of ['starterBall','plush','rope']){
   const width=room==='room-white'?320:390,height=room==='room-white'?954:844;await page.setViewportSize({width,height});
   await page.evaluate(async({room,toy})=>{const c=window.__dogBoneTest.homeShop;for(const itemId of [room,toy]){const r=await c.command({type:'equip',itemId});if(!r.ok)throw Error(r.error);}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},{room,toy});
   const file=`${room}-${toy}.png`;await page.screenshot({path:`${output}/${file}`});
   rows.push(await page.evaluate(({room,toy,file})=>{const r=window.__dogBoneTest.renderer;return{room,toy,file,width:r.width,height:r.height,bounds:r.homeFurnitureBounds.toy,stats:r.furnitureArt.stats};},{room,toy,file}));
  }
 }
 await page.setViewportSize({width:844,height:390});
 await page.evaluate(async()=>{const c=window.__dogBoneTest.homeShop;for(const itemId of ['room-playroom','rope','bed','decor-plant','rug-oat'])await c.command({type:'equip',itemId});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await page.screenshot({path:`${output}/wide-room-rope.png`});
 await page.setViewportSize({width:390,height:844});await page.click('#home-shop');await page.click('[data-category="toy"]');await page.screenshot({path:`${output}/toy-catalog.png`});
 assert.deepEqual(errors,[]);assert.ok(rows.every(r=>r.bounds?.itemId===r.toy));
 await writeFile(`${output}/results.json`,JSON.stringify({rows,errors},null,2));
}finally{await context.close();await browser.close();}
