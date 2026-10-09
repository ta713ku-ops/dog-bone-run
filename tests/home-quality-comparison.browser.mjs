import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out='test-results/home-quality-v20';await mkdir(out,{recursive:true});
const backup='test-results/home-quality-v20/baseline';
const files=Object.fromEntries(await Promise.all(['render.js','image-room-backdrop.js'].map(async f=>['/src/'+f,await readFile(backup+'/'+f,'utf8')])));
const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  for(const [round,variant] of ['before','after','after','before'].entries()){
   const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   try{
    if(variant==='before')await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;return files[path]?route.fulfill({body:files[path],contentType:'text/javascript'}):route.continue();});
    await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>__dogBoneTest.renderer.dogs.stats.continuityReady&&Object.values(__dogBoneTest.renderer.room.assetStates).every(s=>s==='ready'));
    const raster=await page.evaluate(async()=>{
     const r=__dogBoneTest.renderer,d=r.dogs; r.setMenuPaused(true);
     const {sampleHome}=await import('/src/sprite-animation.js'),{createHomeCommand,sampleHomeCommand}=await import('/src/home-command-motion.js');
     const opts={continuousMotion:true,frameCounts:d.stats.homeFrameCounts,seed:42},scale=Math.min(390/310,844/630)*.82;
     const canvas=document.createElement('canvas');canvas.width=600;canvas.height=700;const c=canvas.getContext('2d',{willReadFrequently:true});c.setTransform(2,0,0,2,0,0);
     const hash=data=>{let h=2166136261;for(const b of data)h=Math.imul(h^b,16777619);return (h>>>0).toString(16);};
     const measurements=[];const original=r.ctx;
     try{
      for(const start of [0,25000,40000])for(const action of ['sit','lie','greet']){
       const command=createHomeCommand(action,start,sampleHome(start,opts),opts.frameCounts);
       for(const elapsed of [0,1000,2200,3600]){
        const sample=sampleHomeCommand(start+elapsed,command,opts);r.homeSample=sample;r.lastDrawState='ready';
        c.clearRect(0,0,300,350);r.ctx=c;r.frontDog(150,330-102*scale,scale,0);
        const p=c.getImageData(0,0,600,700).data,internal=d.naturalPainter.ctx.getImageData(0,0,384,384).data;
        let left=600,right=-1,top=700,bottom=-1,mass=0,sx=0,sy=0,area=0;
        for(let i=0;i<p.length;i+=4){const a=p[i+3],x=(i/4)%600,y=Math.floor(i/4/600);mass+=a;sx+=a*x;sy+=a*y;if(a>=128){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);area++;}}
        measurements.push({start,action,elapsed,layers:sample.layers,internalHash:hash(internal),bounds:{left,right,top,bottom},area,alphaMass:mass,center:[sx/mass,sy/mass]});
        assertState();
       }
      }
     }finally{r.ctx=original;r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.homeClockOffset=0;r.menuElapsedMs=0;r.menuLastFrameNow=null;r.setMenuPaused(false);}
     function assertState(){if(c.filter!=='none'&&typeof c.filter==='string')throw Error('Dog filter leaked out of save/restore');if(c.imageSmoothingQuality&&c.imageSmoothingQuality!=='low')throw Error('Dog smoothing leaked');}
     return {filterSupported:typeof c.filter==='string',smoothingSupported:'imageSmoothingQuality' in c,measurements};
    });
    if(round<2){
     for(const [name,time] of [['standing',0],['sit',25000],['lie',40000]]){
      await page.evaluate(time=>{const r=__dogBoneTest.renderer;r.setMenuPaused(true);r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.homeClockOffset=0;r.menuElapsedMs=time;r.menuLastFrameNow=null;r.draw(__dogBoneTest.game,performance.now());},time);
      await page.screenshot({path:`${out}/${engine.name()}-${variant}-${name}.png`});
     }
     await page.evaluate(()=>__dogBoneTest.renderer.setMenuPaused(false));
    }
    const commands=[];
    for(const action of ['sit','lie','greet']){
     await page.evaluate(()=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=0;r.menuLastFrameNow=null;r.homeClockOffset=0;r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.lastDrawState='ready';const probe=window.__qualityFrames={active:true,last:null,intervals:[]};function tick(now){const q=probe;if(!q.active)return;if(q.last!==null)q.intervals.push(now-q.last);q.last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
     await page.locator('#home-'+action).click();await page.waitForTimeout(4000);
     const data=await page.evaluate(()=>{__qualityFrames.active=false;const a=__qualityFrames.intervals.sort((a,b)=>a-b),mean=a.reduce((s,n)=>s+n,0)/a.length,r=__dogBoneTest.renderer;return {frames:a.length,fps:1000/mean,p95:a[Math.floor(a.length*.95)],max:a.at(-1),busy:r.homeBusy,pose:r.homeSample.layers};});
     assert.equal(data.busy,false);if(action!=='greet')assert.equal(data.pose[0].index,47);commands.push({action,...data});
    }
    assert.deepEqual(errors,[]);results.push({engine:engine.name(),variant,round,raster,commands,errors});
    await writeFile(`${out}/quality-progress.json`,JSON.stringify({version:CONFIG.buildVersion,results},null,2));
    console.log(JSON.stringify({engine:engine.name(),variant,round,filterSupported:raster.filterSupported,commands:commands.map(({action,fps,p95})=>({action,fps,p95}))}));
   }finally{await context.close();}
  }
 }finally{await browser.close();}
}
const comparison=[];
for(const name of ['chromium','webkit']){
 const subset=results.filter(r=>r.engine===name),before=subset.filter(r=>r.variant==='before'),after=subset.filter(r=>r.variant==='after');
 for(let i=0;i<before[0].raster.measurements.length;i++){
  const a=before[0].raster.measurements[i],b=after[0].raster.measurements[i];
  assert.equal(a.internalHash,b.internalHash,'motion raster must remain byte-identical');assert.deepEqual(a.layers,b.layers,'pose sequence must be unchanged');
  for(const key of ['left','right','top','bottom'])assert.ok(Math.abs(a.bounds[key]-b.bounds[key])<=1,'silhouette stays within one output pixel');
  assert.ok(Math.abs(b.area/a.area-1)<.005,'silhouette area unchanged within resampling fringe');
  assert.ok(Math.hypot(a.center[0]-b.center[0],a.center[1]-b.center[1])<.5,'no dog position drift');
 }
 for(const action of ['sit','lie','greet']){
  const avg=(rows,key)=>rows.reduce((s,r)=>s+r.commands.find(c=>c.action===action)[key],0)/rows.length;
  const metric={engine:name,action,beforeFps:avg(before,'fps'),afterFps:avg(after,'fps'),beforeP95:avg(before,'p95'),afterP95:avg(after,'p95')};comparison.push(metric);
  assert.ok(metric.afterFps>=metric.beforeFps*.92,'quality candidate throughput regressed more than8%');assert.ok(metric.afterP95<=metric.beforeP95+8,'quality candidate frame tail regressed');
 }
}
await writeFile(`${out}/quality-comparison.json`,JSON.stringify({version:CONFIG.buildVersion,scope:'390x844 DPR2; ABBA real4s sit/lie/greet; same unchanged motion data; raster36 samples perengine; not physical iPhone',results,comparison},null,2));
console.log('Motion rasters, pose sequence, silhouette alignment, scoped canvas state and ABBA performance passed');
