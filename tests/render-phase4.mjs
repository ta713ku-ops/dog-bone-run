import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.DOG_TEST_URL||'http://127.0.0.1:4173';
const output=new URL('../test-results/',import.meta.url);await mkdir(output,{recursive:true});
const artifact=name=>fileURLToPath(new URL(name,output));
const browser=await chromium.launch({headless:true}),errors=[], evidence=[];
try {
  for(const [width,height] of [[320,568],[390,844]]) {
    const p=await browser.newPage({viewport:{width,height},deviceScaleFactor:2});p.on('pageerror',e=>errors.push(e.message));
    await p.clock.install({time:new Date('2026-10-04T00:00:00Z')});
    await p.clock.pauseAt(new Date('2026-10-04T00:00:01Z'));
    await p.goto(`${base}/?test=1&seed=42`);await p.waitForLoadState('networkidle');
    await p.evaluate(async()=>{await window.__dogBoneTest.renderer.dogs.ready;});
    const poses=await p.evaluate(()=>{
      const sprites=window.__dogBoneTest.renderer.dogs,canvas=document.createElement('canvas');canvas.width=canvas.height=220;
      const c=canvas.getContext('2d');
      const draw=(view,action,timeMs=0,reducedMotion=false,direction=1,poseWeight=1)=>{
        c.clearRect(0,0,220,220);const painted=sprites.draw(c,{view,action,timeMs,reducedMotion,direction,poseWeight,x:110,foot:205,size:180});
        const bytes=c.getImageData(0,0,220,220).data;let pixels=0,bottom=0,footX=0,footWeight=0;
        for(let i=3;i<bytes.length;i+=4)if(bytes[i]>50){
          pixels++;const y=Math.floor((i-3)/4/220);bottom=Math.max(bottom,y);
          if(y>=178){const alpha=bytes[i]/255;footX+=((i-3)/4%220)*alpha;footWeight+=alpha;}
        }
        let bodyAlpha=0;
        for(let y=110;y<140;y++)for(let x=100;x<120;x++)bodyAlpha+=bytes[(y*220+x)*4+3]/255;
        return {painted,pixels,bottom,bodyOpacity:bodyAlpha/600,footX:footX/Math.max(1,footWeight),image:canvas.toDataURL()};
      };
      const samples={};for(const view of ['front','back','side'])for(const action of ['idle','run','lean','collect','gold','hit','fall','finish']){
        const value=draw(view,action,180);samples[`${view}:${action}`]={painted:value.painted,pixels:value.pixels,bottom:value.bottom,footX:value.footX};
      }
      for(const [view,action,times] of [['front','idle',[0,600]],['front','finish',[0,1500]],['back','run',[0,200,400,600]],['back','fall',[0,250,650]]]){
        for(const timeMs of times){const v=draw(view,action,timeMs);samples[`${view}:${action}:${timeMs}`]={painted:v.painted,pixels:v.pixels,bottom:v.bottom,footX:v.footX};}
      }
      return {samples,runChanges:draw('back','run',0).image!==draw('back','run',300).image,
        blendedBodyOpacity:draw('front','paw',0,false,1,.5).bodyOpacity,
        idleChanges:draw('front','idle',0).image!==draw('front','idle',3600).image,
        runEarlyStable:draw('back','run',0).image===draw('back','run',150).image,
        finishEarlyStable:draw('front','finish',0).image===draw('front','finish',850).image,
        finishChanges:draw('front','finish',0).image!==draw('front','finish',1500).image,
        leanDirections:draw('back','lean',150,false,-1).image!==draw('back','lean',150,false,1).image,
        reducedStable:draw('back','run',0,true).image===draw('back','run',300,true).image};
    });
    assert.ok(Object.values(poses.samples).every(p=>p.painted&&p.pixels>1000&&p.bottom<=207),JSON.stringify(poses.samples));
    assert.ok(Object.values(poses.samples).every(p=>Math.abs(p.footX-110)<5),JSON.stringify(poses.samples));
    assert.equal(poses.runChanges,true);assert.equal(poses.idleChanges,false);assert.equal(poses.finishChanges,true);
    assert.equal(poses.runEarlyStable,true);assert.equal(poses.finishEarlyStable,true);
    assert.ok(poses.blendedBodyOpacity>.95,'the body must stay opaque during pose transitions');
    assert.equal(poses.leanDirections,true);assert.equal(poses.reducedStable,true);
    const unchanged=await p.evaluate(()=>{
      const {game:g,renderer:r}=window.__dogBoneTest,before=JSON.stringify(g.result());
      for(let i=0;i<20;i++)r.draw(g);
      return before===JSON.stringify(g.result());
    });assert.equal(unchanged,true);
    const ids=await p.evaluate(()=>window.__dogBoneTest.game.obstacles.map(o=>o.id));
    for(const id of ids) {
      const info=await p.evaluate(id=>{
        const {game:g,renderer:r}=window.__dogBoneTest,o=g.obstacles.find(o=>o.id===id);
        const fixture={...g,state:'running',distance:o.distance-1.06,timeMs:(o.distance-1.06)*1000,x:o.lane,move:null,
          bones:g.bones.map(b=>({...b,status:'pending'})),obstacles:g.obstacles.map(v=>({...v,status:'pending'}))};
        document.querySelector('#ready').hidden=true;document.querySelector('#hud').hidden=false;
        document.querySelector('#clock').textContent=`経過 ${(fixture.timeMs/1000).toFixed(1)}秒`;
        r.reset();r.draw({...fixture,bones:[],obstacles:[]});
        const f=r.obstacleFootprint(o.lane,1.06),scale=f.p.scale*r.width/390;
        const top=o.type==='trash'?f.p.y-58*scale-2:f.p.y-f.height/2;
        const bottom=f.p.y+f.height/2;
        const dpr=r.canvas.width/r.width;
        const rect=[Math.floor((f.p.x-f.width/2)*dpr),Math.floor(top*dpr),Math.ceil(f.width*dpr),Math.ceil((bottom-top)*dpr)];
        const pixels=()=>r.ctx.getImageData(...rect).data;
        const originalRunner=r.runner;r.runner=()=>{};
        r.draw({...fixture,bones:[],obstacles:[]});const empty=pixels();
        r.draw({...fixture,bones:[],obstacles:[{...o,status:'pending'}]});const target=pixels();
        r.draw(fixture);const objects=pixels();
        r.runner=originalRunner;r.draw(fixture);const full=pixels();
        let ink=0,dogOverlap=0,objectOverlap=0;
        for(let i=0;i<target.length;i+=4){
          const difference=(a,b)=>Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
          if(difference(target,empty)<30)continue;
          ink++;if(difference(full,objects)>30)dogOverlap++;if(difference(objects,target)>30)objectOverlap++;
        }
        return {id:o.id,type:o.type,lane:o.lane,secondsBeforeContact:.9,inkPixels:ink,dogOverlap:dogOverlap/Math.max(1,ink),objectOverlap:objectOverlap/Math.max(1,ink)};
      },id);
      assert.ok(info.inkPixels>50,JSON.stringify(info));
      assert.ok(info.dogOverlap<.01,JSON.stringify(info));
      assert.ok(info.objectOverlap<.05,JSON.stringify(info));
      evidence.push({width,height,...info});
      await p.screenshot({path:artifact(`phase4-warning-${width}-${info.type}-${id}.png`)});
    }
    await p.close();
  }
} finally {await browser.close();}
assert.deepEqual(errors,[]);
await writeFile(artifact('phase4-render-results.json'),JSON.stringify({errors,evidence},null,2));
console.log(JSON.stringify({errors,checks:`${evidence.length} seed-42 hazard fixtures at 900ms preview, two sizes, rendering leaves game result unchanged`,evidence},null,2));
