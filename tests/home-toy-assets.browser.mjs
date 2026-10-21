import assert from 'node:assert/strict';
import{mkdir,writeFile}from'node:fs/promises';
import{renderingLaunchOptions}from'./browser-rendering.mjs';
const{chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/home-toy-cohesion/assets';await mkdir(output,{recursive:true});const results=[];
const base=process.env.TOY_ASSET_BASE??'http://127.0.0.1:4182';
for(const engine of[chromium,webkit])for(const block of[false,true]){
 const b=await engine.launch(renderingLaunchOptions(engine));const c=await b.newContext({viewport:{width:320,height:954},storageState:{cookies:[],origins:[]}}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 if(block)await p.route(/\/art\/(home-toys-v2\/|home-shop\/plush\.webp)/,route=>route.abort());
 try{
  await p.goto(`${base}/index.html`);
  await p.waitForFunction(()=>!document.querySelector('#home-sit').disabled);
  const value=await p.evaluate(async()=>{
   const{HomeFurnitureArt,drawHomeFurniture,drawHomeFurnitureThumbnail}=await import('/src/home-furnishings.js');
   const art=new HomeFurnitureArt();await art.ready;
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=954;const ctx=canvas.getContext('2d');
   const items=[];
   for(const id of['starterBall','plush','rope']){
    ctx.clearRect(0,0,320,954);const box=drawHomeFurniture(ctx,320,954,{toy:id},{images:art.images}).toy;
    const data=ctx.getImageData(0,0,320,954).data;let pixels=0;for(let n=3;n<data.length;n+=4)if(data[n]>32)pixels++;
    const thumb=document.createElement('canvas');thumb.width=320;thumb.height=180;const tc=thumb.getContext('2d');const t=drawHomeFurnitureThumbnail(tc,id,320,180,{images:art.images});
    const td=tc.getImageData(0,0,320,180).data;let thumbPixels=0;for(let n=3;n<td.length;n+=4)if(td[n]>32)thumbPixels++;
    items.push({id,painted:box?.itemId,pixels,thumbnail:t?.itemId,thumbPixels,state:art.stats.states[id]});
   }
   return{stats:art.stats,items};
  });
  for(const item of value.items){assert.equal(item.painted,item.id);assert.equal(item.thumbnail,item.id);assert.ok(item.pixels>30&&item.thumbPixels>30);assert.equal(item.state,block?'load-error':'ready');}
  assert.equal(value.stats.pending,0);assert.equal(value.stats.ready,block?5:8);assert.equal(value.stats.fallback,block?3:0);assert.deepEqual(errors,[]);
  if(!block){await p.click('#home-decorate');await p.click('[data-item="starterBall"]');await p.click('#preview-place');await p.reload();await p.waitForFunction(()=>!document.querySelector('#home-sit').disabled);assert.equal(await p.locator('#home-coins').innerText(),'0');await p.screenshot({path:`${output}/${engine.name()}-ball-reload.png`});}
  results.push({engine:engine.name(),base,blocked:block,...value,errors});
 }finally{await c.close();await b.close();}
}
await writeFile(`${output}/${base.includes(':4198')?'production':'development'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
