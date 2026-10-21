import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=process.env.LIFE_OUT||'test-results/home-life/current';await mkdir(out,{recursive:true});
const duration=Number(process.env.LIFE_DURATION||100000),url=process.env.LIFE_URL||'http://127.0.0.1:4182/';
const results=[];
for(const engine of (process.env.LIFE_BOTH==='1'?[chromium,webkit]:[process.env.LIFE_ENGINE==='webkit'?webkit:chromium])){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,recordVideo:{dir:out+'/raw',size:{width:390,height:844}}});
 const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url+'?test=1&seed=42');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await page.evaluate(()=>__dogBoneTest.renderer.ready);await page.waitForFunction(()=>!document.querySelector('#home-sit').disabled);
  await page.evaluate(async(seed)=>{
   const r=__dogBoneTest.renderer,{HomeAutonomy}=await import('/src/home-autonomy.js');r.homeAutonomy=new HomeAutonomy(seed);r.resetHomeAutonomy();r.homeHeldFrame=null;r.menuElapsedMs=0;r.menuLastFrameNow=null;
   const canvas=document.createElement('canvas');canvas.width=1560;canvas.height=2532;const c=canvas.getContext('2d');c.fillStyle='#fff7ec';c.fillRect(0,0,canvas.width,canvas.height);
   const q=window.__lifeCapture={trace:[],canvas,c,active:true,n:0,last:-10000};
   const tick=()=>{if(!q.active)return;const s=r.homeSample,t=r.menuElapsedMs;
    q.trace.push({t,posture:r.homePosture,mode:r.homeAutonomy.snapshot.mode,automatic:r.homeAutoCommand?.action,gesture:r.homeAutoGesture?.action,busy:r.homeBusy,layers:s?.layers,head:s?.headAngle,lift:s?.headLift,blink:s?.blink,rest:s?.headRest,body:s?.bodyShift});
    if(t-q.last>=8000&&q.n<24){const n=q.n++,x=n%6*260,y=Math.floor(n/6)*633;q.c.fillStyle='#44382c';q.c.font='16px sans-serif';q.c.fillText((t/1000).toFixed(2)+' s',x+5,y+20);q.c.drawImage(document.querySelector('#scene'),0,0,390,844,x,y+28,260,563);q.last=t;}
    requestAnimationFrame(tick);};requestAnimationFrame(tick);
  },Number(process.env.LIFE_SEED||42));
  await page.waitForTimeout(duration);
  const evidence=await page.evaluate(()=>{const q=__lifeCapture;q.active=false;return{trace:q.trace,png:q.canvas.toDataURL().split(',')[1],clock:__dogBoneTest.renderer.menuElapsedMs,stats:__dogBoneTest.renderer.homeAutonomy.snapshot};});
  await writeFile(`${out}/${engine.name()}-sequence.png`,Buffer.from(evidence.png,'base64'));delete evidence.png;
  await writeFile(`${out}/${engine.name()}-trace.json`,JSON.stringify(evidence));await page.screenshot({path:`${out}/${engine.name()}-home.png`});
  const gestures=[...new Set(evidence.trace.map(x=>x.gesture).filter(Boolean))],postures=[...new Set(evidence.trace.map(x=>x.posture))];
  results.push({engine:engine.name(),clock:evidence.clock,frames:evidence.trace.length,gestures,postures,errors});
 }finally{await context.close();await copyFile(await video.path(),`${out}/${engine.name()}-actual.webm`);await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
