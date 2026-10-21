import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { renderingLaunchOptions } from './browser-rendering.mjs';

const { chromium, webkit } = await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output = process.env.HOME_FURNITURE_VISIBILITY_OUTPUT ?? 'test-results/home-furniture-visibility';
await mkdir(output, { recursive: true });
const results = [], failures = [];
const items = ['rug-oat', 'rug-sage', 'bed', 'starterBall', 'plush', 'rope', 'decor-plant', 'decor-lantern'];
const rooms = ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden'];
const sizes = [[320,954], [280,865], [320,568], [390,844], [430,932], [768,1024], [844,390]];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(renderingLaunchOptions(engine));
  const context = await browser.newContext({ viewport: { width:320, height:954 }, storageState: { cookies:[], origins:[] } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:4182/?test=1');
    await page.waitForFunction(() => window.__dogBoneTest?.homeShop?.owner && window.__dogBoneTest.homeShop.interiorsReady);
    await page.evaluate(async () => {
      const t = window.__dogBoneTest;
      await Promise.all([t.renderer.ready,t.renderer.furnitureArt.ready,t.renderer.room.ready]);
      // Only this empty, disposable browser owns the fixture; the wallet stays zero.
      const { HOME_SHOP_ITEMS } = await import('/src/home-shop-catalog.js');
      const c=t.homeShop;
      const result=await c.store.transact(save=>{
        save.roomShop.owned=HOME_SHOP_ITEMS.map(i=>i.id);
        return {state:save,result:'isolated-owned-fixture'};
      },{expectedRevision:c.state.revision});
      if(!result.ok)throw new Error(result.error);
      c.state=result.state;c.render();
      t.renderer.menuPaused=true;
    });
    const rows=[];
    for (const room of rooms) {
      await page.evaluate(async id => {
        const c=window.__dogBoneTest.homeShop;
        const r=await c.command({type:'equip',itemId:id});if(!r.ok)throw new Error(r.error);
      },room);
      for (const item of items) {
        const slot=item.startsWith('rug-')?'rug':item==='bed'?'bed':item.startsWith('decor-')?'decor':'toy';
        await page.evaluate(async name => {
          const c=window.__dogBoneTest.homeShop;
          const r=await c.command({type:'equip',slot:name,itemId:null});if(!r.ok)throw new Error(r.error);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          window.__furnitureBefore=new Uint8ClampedArray(document.querySelector('#scene').getContext('2d').getImageData(0,0,document.querySelector('#scene').width,document.querySelector('#scene').height).data);
        },slot);
        await page.click('#home-decorate');
        await page.click(`[data-category="${slot}"]`);
        await page.click(`[data-item="${item}"]`);
        await page.click('#preview-place');
        await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
        const row=await page.evaluate(async ({slot,item,room})=>{
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const t=window.__dogBoneTest,c=t.homeShop,r=t.renderer;
          const box=r.homeFurnitureBounds?.[slot];
          if(!box)return {room,item,slot,missing:true,equipped:c.state.roomShop.equipped[slot],viewport:[r.width,r.height]};
          const canvas=document.querySelector('#scene'),ctx=canvas.getContext('2d'),after=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          const sx=canvas.width/r.width,sy=canvas.height/r.height;
          let changed=0;
          for(let y=Math.max(0,Math.floor(box.top*sy));y<Math.min(canvas.height,Math.ceil(box.bottom*sy));y++)for(let x=Math.max(0,Math.floor(box.left*sx));x<Math.min(canvas.width,Math.ceil(box.right*sx));x++){
            const i=(y*canvas.width+x)*4;
            if(Math.max(...[0,1,2].map(k=>Math.abs(after[i+k]-window.__furnitureBefore[i+k])))>8)changed++;
          }
          return {room,item,slot,equipped:c.state.roomShop.equipped[slot],painted:box.itemId,changedPixels:changed,coins:c.state.coins};
        },{slot,item,room});
        rows.push(row);
        if(row.missing||row.equipped!==item||row.painted!==item||row.changedPixels<30)failures.push({engine:engine.name(),...row});
        if(room==='room-white'&&item==='starterBall')await page.screenshot({path:`${output}/${engine.name()}-ball-320x954.png`});
      }
    }
    const resized=[];
    for(const [width,height]of sizes){
      await page.setViewportSize({width,height});
      await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      const entry=await page.evaluate(()=>{const r=window.__dogBoneTest.renderer;return {width:r.width,height:r.height,items:Object.fromEntries(Object.entries(r.homeFurnitureBounds).map(([s,b])=>[s,b?.itemId??null]))};});
      resized.push(entry);
      for(const slot of ['rug','bed','toy','decor'])if(!entry.items[slot])failures.push({engine:engine.name(),resize:true,slot,...entry});
    }
    await page.reload();
    await page.waitForFunction(()=>window.__dogBoneTest?.homeShop?.owner&&window.__dogBoneTest.homeShop.interiorsReady);
    await page.waitForFunction(()=>window.__dogBoneTest.renderer.homeFurnitureBounds?.decor?.itemId==='decor-lantern');
    assert.equal(await page.locator('#home-coins').innerText(),'0');
    assert.deepEqual(errors,[]);
    results.push({engine:engine.name(),rows,resized,reload:true,errors});
  } finally {await context.close();await browser.close();}
}
await writeFile(`${output}/results.json`,JSON.stringify({results,failures},null,2));
console.log(JSON.stringify({conditions:results.map(r=>({engine:r.engine,items:r.rows.length,sizes:r.resized.length})),failures}));
assert.equal(failures.length,0,'every equipped item must change visible scene pixels, including at 320x954');
