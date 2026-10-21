import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/resolution-v36';
await mkdir(out,{recursive:true});const report={cases:[],errors:[],scope:'Native DPR3 decoded bitmap crops and real near/mid/far draws; source sampling ratios are recorded, not claimed to be unlimited.'};
const browser=await chromium.launch(renderingLaunchOptions(chromium));
try{
 for(const level of process.env.DOG_RESOLUTION_LEVELS?.split(',').map(Number)??[1,2,3,4]){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
  await page.goto(`${origin}/tests/fixtures/resolution-preview.html?level=${level}`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__resolution?.ready?.ok);
  const types=await page.evaluate(()=>[...new Set(window.__resolution.game.obstacles.map(o=>o.type))]);
  for(const type of types)for(const [range,distance]of [['near',.25],['mid',1.3],['far',2.9]]){
   const info=await page.evaluate(async({type,distance})=>{
    const p=window.__resolution,r=p.renderer,{Game}=await import('/src/game.js');const g=new Game({phase:4,walkLevel:p.game.walkLevel,seed:42});g.start();
    const obstacle=g.obstacles.find(o=>o.type===type&&o.distance>=3)??g.obstacles.find(o=>o.type===type),time=Math.max(0,(obstacle.distance-distance)/g.speed*1000);
    // Use real game simulation for the selected obstacle's approach. Fixture
    // captures occur paused so screenshot readback cannot trigger a stall.
    for(const input of g.courseData?.safeInputs??[]){if(input.timeMs>time)break;g.advance(input.timeMs-g.timeMs);g.command(input.direction,'fixture');}
    g.advance(time-g.timeMs);g.pause('fixture');
    const crops=[],ctx=r.ctx,drawImage=ctx.drawImage,mipSources=new WeakMap();
    for(const sheet of Object.values(r.mountainScene?.art.sheets??{}))for(const [i,tiles]of (sheet.mips??[]).entries())for(const tile of tiles)mipSources.set(tile,{image:sheet.image,frame:sheet.frames[i]});
    const caveArt=r.caveScene?.art;
    for(const [i,tiles]of (caveArt?.sheet.mips??[]).entries())for(const tile of tiles)mipSources.set(tile,{image:caveArt.sheet.image,frame:caveArt.sheet.frames[i]});
    for(const tile of caveArt?.hangingSheet.mips??[])mipSources.set(tile,{image:caveArt.hangingSheet.image,frame:caveArt.hangingSheet.frame});
    ctx.drawImage=function(image,...args){
     const matrix=this.getTransform(),sx=Math.hypot(matrix.a,matrix.b),sy=Math.hypot(matrix.c,matrix.d);
     if(image instanceof HTMLImageElement){const a=args.length===8?args:[0,0,image.naturalWidth,image.naturalHeight,...args];if(a.length===8)crops.push({source:image.currentSrc||image.src,sourceCrop:a.slice(0,4),physicalWidth:Math.abs(a[6]*sx),physicalHeight:Math.abs(a[7]*sy),ratioX:a[2]/Math.max(1,Math.abs(a[6]*sx)),ratioY:a[3]/Math.max(1,Math.abs(a[7]*sy))});}
     else if(mipSources.has(image)){const {image:original,frame}=mipSources.get(image),a=args;crops.push({source:original.currentSrc||original.src,authoredSourceCrop:[frame.x,frame.y,frame.width,frame.height],cachedMip:[image.width,image.height],sourceCrop:a.slice(0,4),physicalWidth:Math.abs(a[6]*sx),physicalHeight:Math.abs(a[7]*sy),ratioX:a[2]/Math.max(1,Math.abs(a[6]*sx)),ratioY:a[3]/Math.max(1,Math.abs(a[7]*sy))});}
     return drawImage.call(this,image,...args);
    };
    try{r.draw(g,{force:true});}finally{ctx.drawImage=drawImage;}
    p.game=g;return {type,rangeDistance:distance,actualDistance:obstacle.distance-r.worldDistance(g),timeMs:g.timeMs,crops,projection:r.project(obstacle.lane,obstacle.distance-r.worldDistance(g)),dog:r.dogs.stats.walkReferenceHeight};
   },{type,distance});
   assert.ok(Math.abs(info.actualDistance-distance)<.01);
   const name=`detail-level${level}-${type}-${range}`;await page.locator('#scene').screenshot({path:`${out}/${name}.png`});report.cases.push({level,range,name,...info});
  }
  await context.close();
 }
}finally{await browser.close();}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/detail-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,types:[...new Set(report.cases.map(c=>c.type))],errors:report.errors}));
