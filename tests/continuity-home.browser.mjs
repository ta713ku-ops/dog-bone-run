import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
await mkdir('test-results/motion-repair-v15',{recursive:true});
const results=[],errors=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});page.on('pageerror',e=>errors.push(`${engine.name()}: ${e.message}`));
  const started=Date.now();await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.ready);
  const initial=await page.evaluate(()=>__dogBoneTest.renderer.dogs.stats);assert.equal(initial.continuityReady,true,JSON.stringify(initial));assert.equal(initial.homeFrames,212);assert.ok(initial.decodedBytes<80_000_000);assert.ok(initial.compressedBytes<5_000_000);
  const checks=await page.evaluate(async()=>{
   const r=__dogBoneTest.renderer,d=r.dogs,{sampleHome}=await import('/src/sprite-animation.js');
   const {createHomeCommand,sampleHomeCommand}=await import('/src/home-command-motion.js');
   r.setMenuPaused(true);const options={continuousMotion:true,frameCounts:d.stats.homeFrameCounts,seed:42};
   const {createEarWarpRegions}=await import('/src/dog-natural-motion.js');
   const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const c=canvas.getContext('2d',{willReadFrequently:true});
   const paint=s=>{c.clearRect(0,0,384,384);if(!d.draw(c,{x:192,foot:372,size:336,sample:s}))throw Error('draw failed');return c.getImageData(0,0,384,384).data;};
   const frameStats=[];for(const key of Object.keys(d.stats.homeFrameCounts)){
    const f=d.naturalPainter.features[key];let maxEyeStep=0;
    for(let i=1;i<f.length;i++)for(let eye=0;eye<2;eye++)maxEyeStep=Math.max(maxEyeStep,Math.hypot(f[i].eyes[eye].x-f[i-1].eyes[eye].x,f[i].eyes[eye].y-f[i-1].eyes[eye].y));
    frameStats.push({key,maxEyeStep});
   }
   const pixel=[];
   for(const [atlas,index] of [['sitdown',0],['sitdown',d.stats.homeFrameCounts.sitdown-1],['liedown',d.stats.homeFrameCounts.liedown-1]]){
    const s={atlas,index,nextIndex:index,mix:0,natural:true,prealigned:true,breath:0,blink:0,attention:0};
    const open=paint(s),closed=paint({...s,blink:1}),breathed=paint({...s,breath:.48});let blinkOutside=0,eyeChanges=0,footChanges=0;
    const f=d.naturalPainter.features[atlas][index];
    for(let p=0;p<384*384;p++){
     const x=p%384,y=Math.floor(p/384);const different=(a,b)=>[0,1,2,3].some(k=>a[p*4+k]!==b[p*4+k]);
     if(different(open,closed)){if(f.eyes.some(e=>Math.abs(x-e.x)<20&&Math.abs(y-e.y)<20))eyeChanges++;else blinkOutside++;}
     if(y>=350&&different(open,breathed))footChanges++;
    }
    const regions=createEarWarpRegions(f),earred=paint({...s,earLeft:.9,earRight:0});let earChanges=0,earOutside=0;
    for(let p=0;p<384*384;p++)if([0,1,2,3].some(k=>open[p*4+k]!==earred[p*4+k])){
     const x=p%384,y=Math.floor(p/384),box=regions.left;
     if(x>box.xMin&&x<box.xMax&&y>box.yMin&&y<box.yMax)earChanges++;else earOutside++;
    }
    pixel.push({atlas,index,blinkOutside,eyeChanges,footChanges,earChanges,earOutside});
   }
   const contact=[];
   for(let i=0;i<d.stats.homeFrameCounts.sitdown;i++){
    const p=paint({atlas:'sitdown',index:i,nextIndex:i,mix:0,natural:true,prealigned:true,blink:0,breath:0});
    const points=[];for(const [lo,hi] of [[100,185],[185,260]]){
     let mass=0,sum=0;for(let y=355;y<374;y++)for(let x=lo;x<hi;x++){
      const k=(y*384+x)*4,brightness=(p[k]+p[k+1]+p[k+2])/3,weight=brightness>135?p[k+3]:0;mass+=weight;sum+=x*weight;
     }points.push(sum/mass);
    }contact.push(points);
   }
   const contactDriftCss=Math.max(...[0,1].map(eye=>Math.max(...contact.map(p=>p[eye]))-Math.min(...contact.map(p=>p[eye]))))*232*(390/310)*.82/336;
   const frozen=sampleHome(17523,options);paint(frozen);const first=Array.from(c.getImageData(0,0,384,384).data);paint(frozen);const second=c.getImageData(0,0,384,384).data;
   if(first.some((v,i)=>v!==second[i]))throw Error('Frozen clock changed pixels');
   const manual=[];
   for(const start of [0,25000,40000,17500])for(const action of ['sit','lie','greet']){
    const interaction=createHomeCommand(action,start,sampleHome(start,options),d.stats.homeFrameCounts),duration=interaction.durationMs;
    for(const delta of [0,200,duration/2,duration-1,duration]){
     const s=sampleHomeCommand(start+delta,interaction,options);paint(s);
     if(delta===duration&&JSON.stringify(s.layers)!==JSON.stringify(sampleHome(start+delta,{...options,heldFrame:interaction.targetFrame}).layers))throw Error('Command did not hold target');
    }manual.push({start,action});
   }
   r.homeInteraction=null;r.homeHeldFrame=null;r.homeClockOffset=0;r.menuElapsedMs=0;r.menuLastFrameNow=null;
   r.setReducedMotion(true);r.homeGesture('sit');const still=r.updateHomeSample(0);const stillLater=r.updateHomeSample(10000);
   if(still.atlas!=='sitdown'||still.index!==d.stats.homeFrameCounts.sitdown-1||JSON.stringify(still)!==JSON.stringify(stillLater))throw Error('Reduced motion lost canonical static pose');
   r.setReducedMotion(false);r.homeStillPose=null;r.homeHeldFrame=null;r.setMenuPaused(false);
   const drawing=[];for(let i=0;i<180;i++){
    const s=sampleHome(16800+i*1600/180,options),start=performance.now();c.clearRect(0,0,384,384);d.draw(c,{x:192,foot:372,size:336,sample:s});drawing.push(performance.now()-start);
   }
   drawing.sort((a,b)=>a-b);return {frameStats,pixel,manual,contactDriftCss,drawingP95:drawing[Math.floor(drawing.length*.95)],drawingMax:drawing.at(-1)};
  });
  assert.ok(checks.contactDriftCss<=2,`Front paw contact drift ${checks.contactDriftCss} CSS px`);
  for(const f of checks.frameStats)assert.ok(f.maxEyeStep<18,JSON.stringify(f));
  for(const p of checks.pixel){assert.equal(p.blinkOutside,0,JSON.stringify(p));assert.ok(p.eyeChanges>0);assert.equal(p.footChanges,0,JSON.stringify(p));assert.ok(p.earChanges>0,JSON.stringify(p));assert.equal(p.earOutside,0,JSON.stringify(p));}
  await page.screenshot({path:`test-results/motion-repair-v15/${engine.name()}-home.png`});
  // Failure of any new optional clip must restore the entire previous pack.
  const fallback=await browser.newPage({viewport:{width:390,height:844}});await fallback.route('**/dog-continuous-liedown.webp',r=>r.abort());await fallback.goto('http://127.0.0.1:4182/?test=1');await fallback.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.ready);
  const fallbackStats=await fallback.evaluate(()=>__dogBoneTest.renderer.dogs.stats);assert.equal(fallbackStats.homeMotionReady,true);assert.equal(fallbackStats.continuityReady,false);assert.equal(fallbackStats.homeFrames,100);assert.equal(fallbackStats.homeFrameCounts.sitdown,16);
  await fallback.evaluate(()=>{const r=__dogBoneTest.renderer;r.setMenuPaused(true);r.menuElapsedMs=0;r.homeClockOffset=0;r.lastDrawState='ready';r.homeGesture('lie');r.updateHomeSample(800);r.setReducedMotion(true);const s=r.updateHomeSample(800);if(r.homeBusy||s.atlas!=='liedown'||s.index!==15)throw Error('Fallback motion toggle lost target');r.setReducedMotion(false);if(JSON.stringify(r.updateHomeSample(810))!==JSON.stringify(s))throw Error('Fallback motion toggle rewound');});
  await fallback.close();
  const malformed=await browser.newPage({viewport:{width:390,height:844}});
  await malformed.route('**/dog-home-continuity.json',async route=>{const response=await route.fetch(),body=await response.json();delete body.atlases.sitdown.prealigned;await route.fulfill({response,json:body});});
  await malformed.goto('http://127.0.0.1:4182/?test=1');await malformed.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.ready);
  const malformedStats=await malformed.evaluate(()=>__dogBoneTest.renderer.dogs.stats);assert.equal(malformedStats.continuityReady,false);assert.equal(malformedStats.homeFrames,100);await malformed.close();
  results.push({engine:engine.name(),loadAndChecksMs:Date.now()-started,initial,...checks,fallback: fallbackStats});await page.close();
 }finally{await browser.close()}
}
assert.deepEqual(errors,[]);await writeFile('test-results/motion-repair-v15/browser-results.json',JSON.stringify({results,errors,physicalIPhone:false},null,2));console.log(JSON.stringify(results.map(r=>({engine:r.engine,drawingP95:r.drawingP95,drawingMax:r.drawingMax,pixel:r.pixel})),null,2));
