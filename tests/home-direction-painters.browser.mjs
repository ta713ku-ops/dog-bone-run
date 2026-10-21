import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='test-results/home-direction/painters';await mkdir(out,{recursive:true});const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine)),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.continuityReady);await page.evaluate(async()=>{await __dogBoneTest.renderer.ready;await __dogBoneTest.renderer.dogs.directionReady;});
  const data=await page.evaluate(async()=>{
   const r=__dogBoneTest.renderer,d=r.dogs;r.setMenuPaused(true);
   if(!d.directionPainter?.available)throw Error('Direction art unavailable: '+JSON.stringify(d.stats));
   const {sampleHome}=await import('/src/sprite-animation.js'),{createHomeCommand}=await import('/src/home-command-motion.js');
   const opts={continuousMotion:true,frameCounts:d.stats.homeFrameCounts},standing=sampleHome(0,opts),sitting=createHomeCommand('sit',0,standing,opts.frameCounts).targetFrame,lying=createHomeCommand('lie',0,sitting,opts.frameCounts).targetFrame;
   const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const c=canvas.getContext('2d',{willReadFrequently:true}),shots=[],checks=[];
   const draw=s=>{c.clearRect(0,0,384,384);if(!d.draw(c,{view:'front',x:192,foot:372,size:336,sample:s}))throw Error('Draw failed');return c.getImageData(0,0,384,384).data;};
   const gpu=d.gpuPainter;
   for(const backend of ['gpu','canvas']){
    d.gpuPainter=backend==='gpu'?gpu:null;
    for(const [pose,held]of[['stand',standing],['sit',sitting],['lie',lying]]){
     const base={...sampleHome(0,{...opts,heldFrame:held}),breath:0,blink:0,earLeft:0,earRight:0,headAngle:0,headLift:0,headRest:0,gazeX:0};
     const original=draw(base).slice();
     for(const yaw of [-.86,.86]){
      const turned=draw({...base,headYaw:yaw});let changed=0,feet=0;
      for(let y=0;y<384;y++)for(let x=0;x<384;x++){const i=(y*384+x)*4;if([0,1,2,3].some(k=>Math.abs(original[i+k]-turned[i+k])>2)){changed++;if(y>=350)feet++;}}
      checks.push({backend,pose,yaw,changed,feet});shots.push({name:`${backend}-${pose}-${yaw<0?'left':'right'}`,png:canvas.toDataURL().split(',')[1]});
     }
     // Closed eyes must not reset the orientation to the original face.
     draw({...base,headYaw:-.86,blink:1});shots.push({name:`${backend}-${pose}-left-blink`,png:canvas.toDataURL().split(',')[1]});
     if(pose==='lie'){
      const resting={...base,headRest:1,blink:1},neutral=draw(resting).slice();
      for(const yaw of[-.86,.86]){const turned=draw({...resting,headYaw:yaw});let feet=0;for(let y=350;y<384;y++)for(let x=0;x<384;x++){const i=(y*384+x)*4;if([0,1,2,3].some(k=>Math.abs(neutral[i+k]-turned[i+k])>2))feet++;}checks.push({backend,pose:'resting-lie',yaw,changed:1,feet});}
     }
    }
   }
   c.fillStyle='#aec7d0';c.fillRect(0,0,384,384);d.draw(c,{view:'front',x:192,foot:372,size:336,sample:{...sampleHome(0,opts),headYaw:.86}});
   const opaque=c.getImageData(0,0,384,384).data;for(let i=3;i<opaque.length;i+=4)if(opaque[i]!==255)throw Error('Head replacement erased the scene background');
   d.gpuPainter=gpu;return{shots,checks,stats:d.stats,direction:d.directionPainter.stats};
  });
  for(const shot of data.shots)await writeFile(`${out}/${engine.name()}-${shot.name}.png`,Buffer.from(shot.png,'base64'));delete data.shots;
  for(const check of data.checks){assert.ok(check.changed>0,JSON.stringify(check));assert.equal(check.feet,0,JSON.stringify(check));}
  assert.ok(data.stats.decodedBytes<=80_000_000);assert.deepEqual(errors,[]);results.push({engine:engine.name(),...data,errors});
 }finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
