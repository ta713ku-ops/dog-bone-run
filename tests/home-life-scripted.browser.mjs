import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=process.env.LIFE_OUT||'test-results/home-life/scripted';await mkdir(out,{recursive:true});
const engine=process.env.LIFE_ENGINE==='webkit'?webkit:chromium;
const browser=await engine.launch(renderingLaunchOptions(engine)),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,recordVideo:{dir:out+'/raw',size:{width:390,height:844}}});
const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto((process.env.LIFE_URL||'http://127.0.0.1:4182/')+'?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await page.evaluate(()=>__dogBoneTest.renderer.ready);
 const duration=await page.evaluate(async()=>{
  const r=__dogBoneTest.renderer,{sampleHome}=await import('/src/sprite-animation.js'),{createHomeCommand,sampleHomeCommand}=await import('/src/home-command-motion.js'),{sampleHomeIdleGesture,homeGestureRestTarget}=await import('/src/home-presence.js');
  r.setMenuPaused(true);const opts={continuousMotion:true,frameCounts:r.dogs.stats.homeFrameCounts};
  const stages=[['idle',2000],['look-left',4000],['check-in',4000],['ear-flick-left',1200],['weight-shift',3000],['sit',1600],['paw-adjust',2500],['idle',2000],['lie',1800],['head-rest',12000],['sleep',20000],['check-in',4000],['stand',2600],['idle',2000]];
  const q=window.__scriptedLife={stages,start:performance.now(),i:0,stageStart:0,trace:[],held:sampleHome(0,opts),rest:{headRest:0,eyeRest:0},command:null,done:false,frames:[]};
  r.updateHomeSample=function(){
   const t=performance.now()-q.start;
   while(q.i<stages.length&&t-q.stageStart>=stages[q.i][1]){
    const [a,d]=stages[q.i];if(q.command)q.held=q.command.targetFrame;else if(homeGestureRestTarget)q.rest=homeGestureRestTarget(a,q.rest);
    q.stageStart+=d;q.i++;q.command=null;
   }
   if(q.i>=stages.length){q.done=true;return this.homeSample;}
   const [action,durationMs]=stages[q.i],age=t-q.stageStart;
   let base=sampleHome(t,{...opts,heldFrame:q.held});base={...base,...q.rest,homeAmbientBlink:base.blink,blink:Math.max(base.blink,q.rest.eyeRest)};
   if(['sit','lie','stand'].includes(action)){
    q.command??=createHomeCommand(action,q.stageStart,base,opts.frameCounts);this.homeSample=sampleHomeCommand(t,q.command,opts);
   }else this.homeSample=action==='idle'?base:sampleHomeIdleGesture(base,action,age,false,{durationMs,rest:q.rest});
   q.trace.push({t,action,age,layers:this.homeSample.layers,headRest:this.homeSample.headRest,blink:this.homeSample.blink,headAngle:this.homeSample.headAngle,bodyShift:this.homeSample.bodyShift,pawAdjust:this.homeSample.pawAdjust});
   return this.homeSample;
  };
  return stages.reduce((sum,s)=>sum+s[1],0);
 });
 await page.waitForTimeout(duration+1000);
 const trace=await page.evaluate(()=>__scriptedLife.trace);await writeFile(out+'/'+engine.name()+'-trace.json',JSON.stringify({trace,errors}));
 await page.screenshot({path:out+'/'+engine.name()+'-home.png'});console.log(JSON.stringify({duration,frames:trace.length,errors}));
}finally{await context.close();await copyFile(await video.path(),out+'/'+engine.name()+'-actual.webm');await browser.close();}
