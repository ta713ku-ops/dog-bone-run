import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/resolution-v36';await mkdir(out,{recursive:true});
const browser=await chromium.launch(renderingLaunchOptions(chromium));
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3}),page=await context.newPage();
 await page.goto(`${origin}/tests/fixtures/resolution-preview.html?level=4`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__resolution?.ready?.ok);
 const memory=await page.evaluate(async()=>{
  const r=window.__resolution.renderer,{Game}=await import('/src/game.js');
  for(const level of [1,2,3,4]){await r.prepareWalk(level);const g=new Game({phase:4,walkLevel:level,seed:42});g.start();g.advance(12000);g.pause('fixture');r.draw(g,{force:true});}
  const t=r.caveScene.tunnel,c=t.cache,gpu=t.gpu,park=r.parkLevel2Scene.art.groundGPU,mountain=r.mountainScene.art.groundGPU;
  const sourceTiles=[...new Set([...(r.caveScene.art.patterns.get(r.ctx)?.values()??[])].map(v=>v.tile))];
  const bytes=canvas=>canvas.width*canvas.height*4;
  const cpuArrays=Object.values(c).filter(ArrayBuffer.isView).reduce((n,v)=>n+v.byteLength,0)+c.image.data.byteLength;
  return {dimensions:[r.canvas.width,r.canvas.height],mainCanvasBytes:bytes(r.canvas),
   dog:{coreDecoded:r.dogs.stats.decodedBytes,homeHdDecoded:r.dogs.stats.hd?.decodedBytes,homeHdReserved:r.dogs.stats.hd?.reservedBytes,homeHdCap:6000000,homeGpu:r.dogs.stats.gpu},
   cave:{gpuTextureBaseBytes:gpu.stats.textureBytes,gpuTextureMipEstimate:Math.ceil(gpu.stats.textureBytes*4/3),nativeColorAndDepthEstimate:bytes(gpu.canvas)*2,
    sourceTileBytes:sourceTiles.reduce((n,v)=>n+bytes(v),0),sourceTileCount:sourceTiles.length,cpuFallback:[c.bw,c.bh],cpuArrays,cpuCanvas:bytes(c.canvas),cpuTextureBytes:t.textures.reduce((n,v)=>n+v.byteLength,0),authoredImages:r.caveScene.art.stats},
   park:{mipTextureBytes:park.stats.textureBytes,nativeColorBytes:bytes(park.canvas)},mountain:{authoredImages:r.mountainScene.art?.stats,mipTextureBytes:mountain.stats.textureBytes,nativeColorBytes:bytes(mountain.canvas)},
   caveCachedOnce:Boolean(r.caveScene),parkCachedOnce:Boolean(r.parkLevel2Scene)};
 });
 const report={checkedAt:new Date().toISOString(),scope:'Pixel-array and texture-size accounting after visiting all worlds in one renderer. Not process RSS, browser/device RAM, or a driver allocation upper bound. Cached inactive scene resources are retained for reuse; browser compositor and allocator overhead are additional.',memory};
 await writeFile(`${out}/memory-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
}finally{await browser.close();}
