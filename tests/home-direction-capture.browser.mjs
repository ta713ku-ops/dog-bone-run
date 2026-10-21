import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=process.env.DIRECTION_OUT??'test-results/home-direction/current';await mkdir(out,{recursive:true});
const engine=process.env.DIRECTION_ENGINE==='webkit'?webkit:chromium;
const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,recordVideo:{dir:out+'/raw',size:{width:390,height:844}}});
const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto((process.env.DIRECTION_URL??'http://127.0.0.1:4182/')+'?test=1');
 await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);
 await page.evaluate(async()=>{await __dogBoneTest.renderer.ready;await __dogBoneTest.renderer.dogs.directionReady;});
 const duration=await page.evaluate(async()=>{
  const r=__dogBoneTest.renderer,{sampleHome}=await import('/src/sprite-animation.js'),{createHomeCommand,sampleHomeCommand}=await import('/src/home-command-motion.js'),{sampleHomeIdleGesture}=await import('/src/home-presence.js');
  r.setMenuPaused(true);const opts={continuousMotion:true,frameCounts:r.dogs.stats.homeFrameCounts};
  const stages=[['idle',1200],['look-left',4000],['idle',800],['look-right',4000],['sit',2200],['look-left',4000],['look-right',4000],['lie',2500],['look-left',4000],['look-right',4000],['check-in',4000],['stand',2800],['idle',1200]];
  const q=window.__directionCapture={stages,start:performance.now(),i:0,stageStart:0,trace:[],snapshots:[],held:sampleHome(0,opts),command:null,pose:'stand',captured:new Set(),done:false};
  r.updateHomeSample=function(){
   const t=performance.now()-q.start;
   while(q.i<stages.length&&t-q.stageStart>=stages[q.i][1]){const [a,d]=stages[q.i];if(q.command){q.held=q.command.targetFrame;q.pose=a;}q.stageStart+=d;q.i++;q.command=null;}
   if(q.i>=stages.length){q.done=true;return this.homeSample;}
   const[action,durationMs]=stages[q.i],age=t-q.stageStart;
   const base=sampleHome(t,{...opts,heldFrame:q.held});
   if(['sit','lie','stand'].includes(action)){q.command??=createHomeCommand(action,q.stageStart,base,opts.frameCounts);this.homeSample=sampleHomeCommand(t,q.command,opts);}
   else this.homeSample=action==='idle'?base:sampleHomeIdleGesture(base,action,age,false,{durationMs});
   q.trace.push({t,action,age,pose:q.pose,yaw:this.homeSample.headYaw??0,blink:this.homeSample.blink??0,layers:this.homeSample.layers});
   if(action.startsWith('look-')&&age>1500&&!q.captured.has(q.i)){
    q.captured.add(q.i);const name=`${q.pose}-${action}`;requestAnimationFrame(()=>q.snapshots.push({name,png:document.querySelector('#scene').toDataURL().split(',')[1]}));
   }
   return this.homeSample;
  };
  return stages.reduce((sum,s)=>sum+s[1],0);
 });
 await page.waitForTimeout(duration+400);
 const evidence=await page.evaluate(()=>({trace:__directionCapture.trace,snapshots:__directionCapture.snapshots,stats:__dogBoneTest.renderer.dogs.stats,direction:__dogBoneTest.renderer.dogs.directionPainter?.stats}));
 for(const shot of evidence.snapshots)await writeFile(`${out}/${shot.name}.png`,Buffer.from(shot.png,'base64'));delete evidence.snapshots;
 await page.screenshot({path:`${out}/${engine.name()}-home.png`});
 const gaps=evidence.trace.slice(1).map((s,i)=>s.t-evidence.trace[i].t).sort((a,b)=>a-b);
 const result={engine:engine.name(),duration,frames:evidence.trace.length,p95:gaps[Math.floor(gaps.length*.95)],maxGap:Math.max(...gaps),errors,stats:evidence.stats,direction:evidence.direction};
 await writeFile(`${out}/trace.json`,JSON.stringify(evidence));await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine:result.engine,duration,frames:result.frames,p95:result.p95,errors,direction:result.direction}));
}finally{await context.close();await copyFile(await video.path(),`${out}/${engine.name()}-actual.webm`);await browser.close();}
