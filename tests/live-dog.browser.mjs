import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'playwright');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4183',checks=[],errors=[];
await mkdir('test-results',{recursive:true});
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  const result=await page.evaluate(async()=>{
   const {Dog3DRenderer}=await import('/src/dog-3d-renderer.js'),{DOG_3D_ACTIONS}=await import('/src/dog-3d-model.js');
   const renderer=new Dog3DRenderer(),canvas=document.createElement('canvas');canvas.width=390;canvas.height=440;const ctx=canvas.getContext('2d'),images=[],samples=[],clipped=[];
   for(const [view,action,age]of [['front','idle',0],['side','walk',1200],['back','run',1200],['front','sleep',4000],['front','happyJump',2000]]){
    ctx.clearRect(0,0,390,440);const ok=renderer.draw(ctx,{controllerId:view+action,view,action,timeMs:age,actionAgeMs:age,durationMs:4000,groundDistance:.25,velocity:action==='idle'?0:1,x:195,foot:390,size:260});if(!ok)throw Error(renderer.lastError);
    images.push({name:view+'-'+action,png:canvas.toDataURL()});
   }
   let minMargin=Infinity,renderTime=0;
   for(const action of DOG_3D_ACTIONS)for(const view of ['front','side','back'])for(const age of [0,1000,2000,3000,4000]){
    const before=performance.now();const ok=renderer.draw(ctx,{controllerId:action+view,view,action,timeMs:age,actionAgeMs:age,durationMs:4000,groundDistance:age/1000,velocity:['walk','run','retrieve','return'].includes(action)?1:0,x:195,foot:390,size:220});renderTime+=performance.now()-before;if(!ok)throw Error(renderer.lastError);
    const gl=renderer.gl,w=renderer.canvas.width,h=renderer.canvas.height,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let left=w,right=-1,top=h,bottom=-1,count=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}
    if(!count)throw Error('empty dog '+action+'/'+view);const margin=Math.min(left,w-1-right,top,h-1-bottom);minMargin=Math.min(minMargin,margin);
    if(margin<1)clipped.push({action,view,age,margin});
    if(!renderer.lastDraw.pose.jointMatrices.every(m=>Array.from(m).every(Number.isFinite)))throw Error('invalid uploaded bone matrix');samples.push({action,view,age,margin});
   }
   ctx.clearRect(0,0,390,440);renderer.draw(ctx,{controllerId:'pause',action:'walk',timeMs:1000,groundDistance:.2,velocity:1,x:195,foot:390,size:220});const frozen=canvas.toDataURL();
   ctx.clearRect(0,0,390,440);renderer.draw(ctx,{controllerId:'pause',action:'run',timeMs:5000,groundDistance:5,velocity:2,x:195,foot:390,size:220,paused:true});if(canvas.toDataURL()!==frozen)throw Error('paused geometry changed');
   return{images,clipped,samples:samples.length,minMargin,meanCpuDrawMs:renderTime/samples.length,triangles:renderer.model.triangleCount,standingHeight:renderer.model.standingHeight,pausedFrozen:true};
  });
  for(const img of result.images)await writeFile(`test-results/live-dog-${engine.name()}-${img.name}.png`,Buffer.from(img.png.split(',')[1],'base64'));
  delete result.images;console.log(JSON.stringify({engine:engine.name(),...result}));checks.push({engine:engine.name(),...result});
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);assert.ok(checks.every(check=>check.clipped.length===0),'dog geometry must fit transparent render buffer for every action');await writeFile('test-results/live-dog-browser-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,executedAt:new Date().toISOString(),status:'PASS',checks,errors,limitations:['desktop GPU/software engines; no actual iPhone or human naturalness approval','CPU draw timing includes commands; not full device GPU throughput']},null,2));console.log(JSON.stringify({checks,errors}));
