import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.DOG_RESULTS_DIR||'test-results/motion-repair-v15';await mkdir(out+'/actions',{recursive:true});
const results=[];
const recording=process.env.DOG_NO_VIDEO!=='1';
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.DOG_CHROMIUM_GPU==='1'?{args:['--enable-gpu']}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,...(recording?{recordVideo:{dir:out+'/actions',size:{width:390,height:844}}}:{})});
 const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:4182/?test=1&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>__dogBoneTest?.renderer.dogs.stats.continuityReady);
  // The optional HD decode and shader warm-up finish after atlas validation.
  // Use the same readiness gate as the actual controls before testing draw().
  await page.evaluate(()=>__dogBoneTest.renderer.dogs.ready);
  const checks=await page.evaluate(async()=>{
   const r=__dogBoneTest.renderer,d=r.dogs;
   const {sampleHome}=await import('/src/sprite-animation.js');
   const {createHomeCommand,sampleHomeCommand}=await import('/src/home-command-motion.js');
   r.setMenuPaused(true);const opts={continuousMotion:true,frameCounts:d.stats.homeFrameCounts,seed:42};
   const c=document.createElement('canvas');c.width=c.height=384;const ctx=c.getContext('2d',{willReadFrequently:true});
   const paint=sample=>{ctx.clearRect(0,0,384,384);if(!d.draw(ctx,{x:192,foot:372,size:336,sample}))throw Error('Draw failed');return ctx.getImageData(0,0,384,384).data;};
   const head=[];
   for(const start of [0,25000,40000]){
    const anchor=sampleHome(start,opts),cmd=createHomeCommand('greet',start,anchor,opts.frameCounts);
    const base=paint({...anchor,breath:0,blink:0,earLeft:0,earRight:0,headAngle:0,headLift:0});
    const alert=paint({...sampleHomeCommand(start+1400,cmd,opts),breath:0,blink:0});
    let changed=0,feet=0;for(let p=0;p<384*384;p++)if([0,1,2,3].some(k=>base[p*4+k]!==alert[p*4+k])){changed++;if(Math.floor(p/384)>=350)feet++;}
    if(changed<1000||feet!==0)throw Error(`Head response ${start}: ${changed} changed, ${feet} feet`);
    head.push({start,changedPixels:changed,footChanges:feet});
   }
   const commands=[];
   for(const start of [0,25000,40000,17500,32000,50400])for(const action of ['sit','lie','greet']){
    r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.homeClockOffset=0;r.menuElapsedMs=start;r.lastDrawState='ready';r.updateHomeSample(start);
    const initial=JSON.stringify(r.homeSample.layers);if(!r.homeGesture(action))throw Error('Gesture rejected');const cmd=r.homeInteraction;
    if(JSON.stringify(r.updateHomeSample(start).layers)!==initial)throw Error('Entry changed current layers');
    for(let t=0;t<cmd.durationMs;t+=100)paint(r.updateHomeSample(start+t));
    r.updateHomeSample(start+cmd.durationMs);if(r.homeBusy)throw Error('Still busy on completion');
    const held=JSON.stringify(r.homeSample.layers);let blink=false,ear=false;
    for(let t=0;t<=12000;t+=25){const s=r.updateHomeSample(start+cmd.durationMs+t);if(JSON.stringify(s.layers)!==held)throw Error('Lost held posture');blink ||= s.blink>0;ear ||= Math.abs(s.earLeft)+Math.abs(s.earRight)>0;}paint(r.homeSample);
    if(!blink||!ear)throw Error('Held pose lacks blink or ear motion');
    commands.push({start,action,durationMs:cmd.durationMs,held:r.homeSample.layers,blink,ear});
   }
   r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.menuElapsedMs=0;r.homeClockOffset=0;
   r.setReducedMotion(true);r.homeGesture('lie');const a=r.updateHomeSample(0),b=r.updateHomeSample(12000);
   if(JSON.stringify(a)!==JSON.stringify(b)||a.index!==47||a.breath!==0)throw Error('Reduced pose not static');
   r.setReducedMotion(false);r.homeHeldFrame=null;r.homeInteraction=null;r.setMenuPaused(false);r.menuLastFrameNow=null;
   r.menuElapsedMs=0;r.homeClockOffset=0;r.lastDrawState='ready';r.homeGesture('lie');r.updateHomeSample(800);
   r.setReducedMotion(true);const settled=r.updateHomeSample(800);if(r.homeBusy||settled.index!==47)throw Error('Reduced-motion toggle did not settle');
   r.setReducedMotion(false);if(JSON.stringify(r.updateHomeSample(810).layers)!==JSON.stringify(settled.layers))throw Error('Motion toggle rewound pose');
   r.homeInteraction=null;r.homeHeldFrame=null;r.menuElapsedMs=0;r.menuLastFrameNow=null;
   return {head,commands};
  });
  const actual=[];
  for(const [name,action,start] of [['standing-sit','sit',0],['standing-lie','lie',0],['lying-sit','sit',40000],['standing-greet','greet',0],['lying-greet','greet',40000]]){
   await page.evaluate(start=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=start;r.menuLastFrameNow=null;r.homeClockOffset=0;r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.lastDrawState='ready';},start);
   await page.evaluate(action=>{
    const canvas=document.createElement('canvas');canvas.width=1120;canvas.height=972;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff6e8';ctx.fillRect(0,0,1120,972);
    const q=window.__motionCapture={canvas,ctx,action,started:null,times:[0,100,200,350,600,900,1200,1500,1800,2400,3000,3600],i:0,trace:[],active:true};
    function capture(){if(!q.active)return;const r=__dogBoneTest.renderer;if(q.started===null&&r.homeInteraction?.action===action){q.started=performance.now();q.duration=r.homeInteraction.durationMs;q.target=r.homeInteraction.targetFrame.layers;}
     if(q.started!==null){const elapsed=performance.now()-q.started,s=r.homeSample;q.trace.push({elapsed,layers:s.layers,headAngle:s.headAngle??0,headLift:s.headLift??0,blink:s.blink,action:s.action});
      if(q.i<q.times.length&&elapsed>=q.times[q.i]){const col=q.i%4,row=Math.floor(q.i/4);ctx.fillStyle='#3d3028';ctx.font='14px sans-serif';ctx.fillText((elapsed/1000).toFixed(3)+' s',col*280+8,row*324+18);ctx.drawImage(document.querySelector('#scene'),110,490,560,600,col*280,row*324+24,280,300);q.i++;}}
     requestAnimationFrame(capture);
    }requestAnimationFrame(capture);
   },action);
   await page.locator('#home-'+action).click();await page.waitForTimeout(3900);
   const capture=await page.evaluate(()=>{const q=__motionCapture;q.active=false;return {png:q.canvas.toDataURL().split(',')[1],trace:q.trace,target:q.target,duration:q.duration,final:__dogBoneTest.renderer.homeSample,busy:__dogBoneTest.renderer.homeBusy};});
   assert.equal(capture.busy,false);
   assert.deepEqual(capture.final.layers,capture.target);
   for(const frame of capture.trace.filter(s=>s.elapsed>=capture.duration+50))assert.deepEqual(frame.layers,capture.target,'actual playback holds its target');
   const intervals=capture.trace.slice(1).map((s,i)=>s.elapsed-capture.trace[i].elapsed).sort((a,b)=>a-b);
   capture.intervals={count:intervals.length,p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1),mean:intervals.reduce((a,b)=>a+b,0)/intervals.length};
   await writeFile(`${out}/${engine.name()}-${name}.png`,Buffer.from(capture.png,'base64'));delete capture.png;actual.push({name,...capture});
   await writeFile(`${out}/${engine.name()}-actions-progress.json`,JSON.stringify({checks,actual,errors},null,2));
   // WebKit's rAF timestamps are integer milliseconds; a 30Hz interval can
   // round to 34ms. Verify unrounded aggregate throughput as well.
   assert.ok(capture.intervals.p95<=34&&1000/capture.intervals.mean>=30,`${engine.name()} ${name}: ${JSON.stringify(capture.intervals)}`);
  }
  assert.deepEqual(errors,[]);results.push({engine:engine.name(),checks,actual,errors});
 }finally{await context.close();await browser.close();if(video)await copyFile(await video.path(),`${out}/${engine.name()}-actual-actions.webm`);}
}
await writeFile(out+'/command-browser-results.json',JSON.stringify({version:CONFIG.buildVersion,physicalIPhone:false,recording,results},null,2));
console.log(JSON.stringify(results.map(r=>({engine:r.engine,matrix:r.checks.commands.length,head:r.checks.head,errors:r.errors})),null,2));
