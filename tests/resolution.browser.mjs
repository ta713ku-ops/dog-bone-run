import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/resolution-v36';
await mkdir(out,{recursive:true});
const report={at:new Date().toISOString(),cases:[],errors:[],scope:'Desktop browser DPR emulation. Physical iPhone/iPad performance and perceived sharpness remain unverified.'};
const sources=['src/app.js','src/config.js','src/render.js','src/cave-art.js','src/cave-tunnel.js','src/cave-gpu.js','src/dog-sprites.js','src/sprite-mips.js','src/mountain-nature-art.js','src/mountain-ground-gpu.js','src/park-level2-art.js','src/park-landscape.js','src/park-ground-gpu.js','src/street-toy-art.js','src/street-materials.js','src/street-obstacle-art.js','src/street-facade-art.js','src/street-facade-variants.js','src/street-foliage-art.js','art/resolution-v36/metadata.json','art/dog-walk-hd.json'];
report.sourceHashes=Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const levels=process.env.DOG_RESOLUTION_LEVELS?.split(',').map(Number)??[1,2,3,4];
const dprs=process.env.DOG_RESOLUTION_DPRS?.split(',').map(Number)??[2,3];
const engines=[chromium,webkit].filter(e=>!process.env.DOG_RESOLUTION_ENGINES||process.env.DOG_RESOLUTION_ENGINES.split(',').includes(e.name()));
for(const engine of engines){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 try{
  if(!process.argv.includes('--motion-only'))for(const [width,height,dpr] of [[320,954,2],[390,844,2],[390,844,3],[430,932,3],[1280,900,2]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,isMobile:width<500,hasTouch:width<500});
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push({engine:engine.name(),error:e.stack}));
   for(const level of levels){
    await page.goto(`${origin}/tests/fixtures/resolution-preview.html?level=${level}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__resolution?.ready);
    assert.deepEqual(await page.evaluate(()=>window.__resolution.ready),{ok:true});
    const actual=await page.evaluate(async()=>{
     const {renderer:r,game:g}=window.__resolution;
     const scene=g.walkLevel===4?r.caveScene:g.walkLevel===3?r.mountainScene:g.walkLevel===2?r.parkLevel2Scene:r.adventure;
     const draw=scene.draw;let nativeTarget=false;
     scene.draw=function(renderer,...args){nativeTarget=renderer.ctx===r.canvas.getContext('2d');return draw.call(this,renderer,...args);};
     try{r.draw(g,{force:true});}finally{scene.draw=draw;}
     const png=r.canvas.toDataURL();for(let i=0;i<3;i++)r.draw(g);
     const matrix=r.ctx.getTransform();
     let obstacleAlpha=null;
     if(g.walkLevel===1){
      const {STREET_OBSTACLE_ART:art}=await import('/src/street-obstacle-art.js');await art.ready;
      const probe=document.createElement('canvas');probe.width=probe.height=1;
      const c=probe.getContext('2d');c.drawImage(art.images.obstacles,0,0);
      obstacleAlpha=c.getImageData(0,0,1,1).data[3];
     }
     return {canvas:[r.canvas.width,r.canvas.height],css:[r.width,r.height],nativeTarget,intermediate:Boolean(r.streetBackdrop),transform:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],alpha:r.ctx.globalAlpha,composite:r.ctx.globalCompositeOperation,
      cave:r.caveScene?.stats.tunnel,parkGPU:r.parkLevel2Scene?.art.groundGPUStats,mountainGPU:r.mountainScene?.art.groundGPU.stats,dog:r.dogs.stats,stable:png===r.canvas.toDataURL(),contactCount:g.result().contactCount,
      overflow:document.documentElement.scrollWidth>innerWidth,obstacleAlpha};
    });
    assert.deepEqual(actual.canvas,actual.css.map(n=>Math.round(n*dpr)));
    assert.equal(actual.nativeTarget,true);assert.equal(actual.intermediate,false);assert.equal(actual.overflow,false);assert.equal(actual.stable,true);
    assert.deepEqual(actual.transform,[dpr,0,0,dpr,0,0]);assert.equal(actual.alpha,1);assert.equal(actual.composite,'source-over');
    if(level>=2)assert.equal(actual.contactCount,0);
    if(level===1)assert.equal(actual.obstacleAlpha,0,'decoded street sprites retain transparent padding');
    if(level===2){assert.equal(actual.parkGPU.mode,'gpu-world-ground');assert.deepEqual([actual.parkGPU.width,actual.parkGPU.height],actual.canvas);}
    if(level===3){assert.equal(actual.mountainGPU.mode,'gpu-world-ground');assert.deepEqual([actual.mountainGPU.width,actual.mountainGPU.height],actual.canvas);}
    if(level===4){assert.equal(actual.cave.mode,'gpu-world-vault');assert.deepEqual([actual.cave.width,actual.cave.height],actual.canvas);}
    const name=`${engine.name()}-level${level}-${width}-dpr${dpr}`;
    await page.locator('#scene').screenshot({path:`${out}/${name}.png`});
    // Resize must rebuild every surface and preserve the frozen game/seed.
    await page.setViewportSize({width:width+1,height});
    await page.evaluate(()=>{const p=window.__resolution;p.renderer.resize();p.renderer.draw(p.game,{force:true});});
    const resized=await page.evaluate(()=>({width:window.__resolution.renderer.canvas.width,css:window.__resolution.renderer.width,time:window.__resolution.game.timeMs}));
    assert.equal(resized.width,Math.round(resized.css*dpr));assert.equal(resized.time,12000);
    await page.setViewportSize({width,height});
    report.cases.push({engine:engine.name(),level,width,height,dpr,name,...actual,resize:true});
   }
   await context.close();
  }
  if(!process.argv.includes('--screens-only'))for(const dpr of dprs)for(const level of levels){
   const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:dpr,isMobile:true,hasTouch:true});
   await context.addInitScript(()=>localStorage.setItem('dog-bone-run:settings:v1',JSON.stringify({version:1,settings:{soundEnabled:false,musicEnabled:false,reducedMotion:false}})));
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push({engine:engine.name(),error:e.stack}));
   await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
   await page.locator('#start').click();await page.locator(`#walk-level-${level}`).click();
   await page.evaluate(()=>{
    const r=window.__dogBoneTest.renderer,draw=r.draw.bind(r);let previous=null;
    const ticks=[];let last=performance.now(),start=last;
    while(ticks.length<8&&performance.now()-start<100){const now=performance.now();if(now>last){ticks.push(now-last);last=now;}}
    window.__qualityClockResolution=ticks.length?Math.min(...ticks):0;
    window.__qualityFrames=[];
    r.draw=function(g,options){const result=draw(g,options);if(g.state==='running'){
     const now=performance.now();if(previous!==null&&g.timeMs>1000)window.__qualityFrames.push(now-previous);previous=now;
    }return result;};
   });
   await page.locator('#walk-picker-start').click();
   await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   await page.evaluate(()=>{
    const t=window.__dogBoneTest,inputs=t.game.courseData?.safeInputs??[],canvas=document.querySelector('#scene');t.syncTime();
    const origin=performance.now()-t.game.timeMs;let next=0;
    const driver=setInterval(()=>{
     if(['result','paused'].includes(t.game.state)){clearInterval(driver);return;}
     while(next<inputs.length&&performance.now()-origin>=inputs[next].timeMs-32){
      const key=inputs[next].direction<0?'ArrowLeft':'ArrowRight';canvas.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true}));next++;
     }
    },4);
   });
   await page.waitForFunction(()=>['result','paused'].includes(window.__dogBoneTest.game.state),undefined,{timeout:40000});
   const actual=await page.evaluate(()=>({result:window.__dogBoneTest.game.result(),clockResolutionMs:window.__qualityClockResolution,pauses:window.__dogBoneTest.log.events.filter(e=>e.type==='pause'),stalls:window.__dogBoneTest.log.events.filter(e=>e.type==='long_stall'),frames:window.__qualityFrames,
    cave:window.__dogBoneTest.renderer.caveScene?.stats.tunnel,parkGPU:window.__dogBoneTest.renderer.parkLevel2Scene?.art.groundGPUStats,mountainGPU:window.__dogBoneTest.renderer.mountainScene?.art.groundGPU.stats,dog:window.__dogBoneTest.renderer.dogs.stats}));
   const sorted=actual.frames.slice().sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];
   report.cases.push({engine:engine.name(),level,dpr,realtime:true,p95,...actual});
   await writeFile(`${out}/motion-progress.json`,JSON.stringify(report,null,2));
   assert.equal(actual.result.timeMs,30000);assert.deepEqual(actual.pauses,[]);
   if(level>=2){assert.equal(actual.result.contactCount,0);assert.equal(actual.result.collected,48);assert.equal(actual.result.goldCollected,3);}
   // A perfect 30 Hz interval quantizes to both 33 and 34 ms on WebKit's
   // measured 1 ms clock. Keep the raw percentile and allow at most one tick.
   const allowedP95Ms=33.4+Math.min(1,actual.clockResolutionMs);
   assert.ok(p95<=allowedP95Ms,`${engine.name()} level${level} DPR${dpr} p95 ${p95}, clock ${actual.clockResolutionMs}`);
   await context.close();
  }
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);
await writeFile(`${out}/${process.argv.includes('--motion-only')?'motion-report':'screens-report'}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:report.cases.length,errors:report.errors,frames:report.cases.filter(c=>c.realtime).map(({engine,level,dpr,p95})=>({engine,level,dpr,p95}))},null,2));
