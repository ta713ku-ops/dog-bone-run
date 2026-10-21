import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-autonomy';await mkdir(out,{recursive:true});
const results=await Promise.all([chromium,webkit].map(async engine=>{
 const browser=await engine.launch(renderingLaunchOptions(engine));
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,recordVideo:{dir:out+'/video',size:{width:390,height:844}}});
 const page=await context.newPage(),video=page.video(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:4182/?test=1&seed=42');
  await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);
  await page.evaluate(()=>__dogBoneTest.renderer.ready);
  await page.waitForFunction(()=>!document.querySelector('#home-sit').disabled);
  await page.evaluate(async()=>{
   const r=__dogBoneTest.renderer,{HomeAutonomy}=await import('/src/home-autonomy.js');
   r.homeAutonomy=new HomeAutonomy(42);r.resetHomeAutonomy();r.homeHeldFrame=null;r.menuElapsedMs=0;r.menuLastFrameNow=null;
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1440;const c=canvas.getContext('2d');c.fillStyle='#fff7ec';c.fillRect(0,0,1200,1440);
   window.__autonomyCapture={trace:[],canvas,c,frames:0,active:true,lastState:null,lastCapture:-1000};
   const tick=()=>{
    const q=__autonomyCapture;if(!q.active)return;
    const s=r.homeSample,t=r.menuElapsedMs,state=r.homeAutoCommand?.action||r.homeAutoGesture?.action||r.homePosture;
    q.trace.push({t,posture:r.homePosture,automatic:r.homeAutoCommand?.action,gesture:r.homeAutoGesture?.action,busy:r.homeBusy,layers:s?.layers,head:s?.headAngle,blink:s?.blink});
    if(q.frames<24&&state!==q.lastState){const i=q.frames++,col=i%6,row=Math.floor(i/6);q.c.fillStyle='#463626';q.c.font='14px sans-serif';q.c.fillText(`${(t/1000).toFixed(2)}s ${state}`,col*200+5,row*360+20);q.c.drawImage(document.querySelector('#scene'),0,0,390,620,col*200,row*360+28,200,318);q.lastState=state;}
    requestAnimationFrame(tick);
   };requestAnimationFrame(tick);
  });
  await page.waitForTimeout(100000);
  const capture=await page.evaluate(()=>{const q=__autonomyCapture;q.active=false;return {trace:q.trace,png:q.canvas.toDataURL().split(',')[1],clock:__dogBoneTest.renderer.menuElapsedMs};});
  const postures=[...new Set(capture.trace.map(x=>x.posture))].sort();
  assert.deepEqual(postures,['lie','sit','stand']);assert.ok(capture.clock>=90000,`clock ${capture.clock}`);
  assert.ok(capture.trace.every(x=>!x.busy),'automatic behavior must not disable manual controls');
  await writeFile(`${out}/${engine.name()}-living.png`,Buffer.from(capture.png,'base64'));delete capture.png;
  await writeFile(`${out}/${engine.name()}-trace.json`,JSON.stringify(capture));
  await page.screenshot({path:`${out}/${engine.name()}-home.png`});
  // An actual explicit command, held for 16s, then autonomously released.
  await page.locator('#home-lie').click();await page.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy);
  const held=await page.evaluate(()=>__dogBoneTest.renderer.homeSample.layers);
  await page.waitForTimeout(15000);assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.layers),held);
  await page.waitForFunction(()=>__dogBoneTest.renderer.homeAutoCommand!==null,{},{timeout:12000});
  // Pause through the actual settings UI, then exercise reduced-motion freeze.
  await page.locator('#ready-settings').click();await page.waitForTimeout(150);
  const paused=await page.evaluate(()=>__dogBoneTest.renderer.menuElapsedMs);
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>__dogBoneTest.renderer.menuElapsedMs),paused);
  await page.locator('#reduce-motion').check();await page.locator('#settings-close').click();
  await page.waitForTimeout(100);const still=await page.evaluate(()=>__dogBoneTest.renderer.homeSample);
  await page.waitForTimeout(1000);assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample),still);
  await page.locator('#ready-settings').click();await page.locator('#reduce-motion').uncheck();await page.locator('#settings-close').click();
  assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.layers),still.layers);
  assert.deepEqual(errors,[]);
  return {engine:engine.name(),realTimeMs:capture.clock,postures,traceFrames:capture.trace.length,errors};
 }finally{await context.close();await copyFile(await video.path(),`${out}/${engine.name()}-actual.webm`);await browser.close();}
}));
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
