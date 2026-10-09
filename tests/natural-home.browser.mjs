// Legacy fallback regression; the new default is covered by continuity-home/realtime.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
await mkdir('test-results/natural-home',{recursive:true});
const checks=[],errors=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/dog-home-continuity.json*',route=>route.abort());
 await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.ready);
  const evidence=await page.evaluate(async()=>{
   const dogs=window.__dogBoneTest.renderer.dogs;if(!dogs.naturalPainter)throw new Error(JSON.stringify(dogs.stats));
   for(const features of Object.values(dogs.naturalPainter.features))for(let i=1;i<features.length;i++)for(let eye=0;eye<2;eye++){
    const a=features[i-1].eyes[eye],b=features[i].eyes[eye];if(Math.hypot(a.x-b.x,a.y-b.y)>25)throw new Error('Detected eye jumps between adjacent frames');
   }
   const tiltEyes=dogs.naturalPainter.features.tiltright[15].eyes;
   if(tiltEyes[1].y>=tiltEyes[0].y-25)throw new Error('Right-tilt nose mistaken for eye');
   const {sampleHome}=await import('/src/sprite-animation.js');
   const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const c=canvas.getContext('2d',{willReadFrequently:true});
   function paint(sample){c.clearRect(0,0,384,384);dogs.draw(c,{x:192,foot:372,size:336,sample});return new Uint8ClampedArray(c.getImageData(0,0,384,384).data);}
   const measured=[];
   for(const [atlas,index] of [['sitdown',0],['sitdown',15],['liedown',15]]){
    const base={atlas,index,nextIndex:index,mix:0,natural:true,breath:0,attention:0,blink:0};
    const open=paint(base),closed=paint({...base,blink:1}),breathing=paint({...base,breath:1});const f=dogs.naturalPainter.features[atlas][index];
    let eyeChanges=0,outsideEyeChanges=0,footChanges=0,breathChanges=0;
    for(let p=0;p<open.length/4;p++){
     const x=p%384,y=Math.floor(p/384),isEye=f.eyes.some(e=>Math.abs(x-e.x)<20&&Math.abs(y-e.y)<20);
     const differs=(a,b)=>[0,1,2,3].some(ch=>a[p*4+ch]!==b[p*4+ch]);
     if(differs(open,closed)){if(isEye)eyeChanges++;else outsideEyeChanges++;}
     if(differs(open,breathing)){breathChanges++;if(y>=360)footChanges++;}
    }
    measured.push({atlas,index,eyeChanges,outsideEyeChanges,breathChanges,footChanges});
   }
   const times=[0,10000,11200,11390,11600,20500,20890,23300,23520,24600,25900,30000];
   const sheet=document.createElement('canvas');sheet.width=384*4;sheet.height=408*3;const sc=sheet.getContext('2d');
   for(let i=0;i<times.length;i++){const t=times[i],s=sampleHome(t,{detailedMotion:true});paint(s);const x=i%4*384,y=Math.floor(i/4)*408;sc.fillStyle='#fff6e8';sc.fillRect(x,y,384,408);sc.drawImage(canvas,x,y+24);sc.fillStyle='#382b1e';sc.font='18px sans-serif';sc.fillText(`${t/1000}s ${s.atlas}:${s.index} blink ${(s.blink??0).toFixed(2)}`,x+10,y+21);}
   const transitions=document.createElement('canvas');transitions.width=384*4;transitions.height=408*4;const tc=transitions.getContext('2d');
   const phases=[8000,8180,8380,8550,8720,8890,9060,9300,17200,17380,17580,17750,17920,18090,18260,18600];
   for(let i=0;i<phases.length;i++){const t=phases[i],s=sampleHome(t,{detailedMotion:true});paint(s);const x=i%4*384,y=Math.floor(i/4)*408;tc.fillStyle='#fff6e8';tc.fillRect(x,y,384,408);tc.drawImage(canvas,x,y+24);tc.fillStyle='#382b1e';tc.font='18px sans-serif';tc.fillText(`${t/1000}s`,x+10,y+21);}
   const blinkSheet=document.createElement('canvas');blinkSheet.width=384*4;blinkSheet.height=408*3;const bc=blinkSheet.getContext('2d');
   for(let row=0;row<3;row++)for(let col=0;col<4;col++){const atlas=row<2?'sitdown':'liedown',index=row===0?0:15;paint({atlas,index,nextIndex:index,mix:0,natural:true,breath:0,attention:0,blink:col/3});const x=col*384,y=row*408;bc.fillStyle='#fff6e8';bc.fillRect(x,y,384,408);bc.drawImage(canvas,x,y+24);bc.fillStyle='#382b1e';bc.font='18px sans-serif';bc.fillText(`${atlas}:${index} blink ${(col/3).toFixed(2)}`,x+10,y+21);}
   const landmarks=document.createElement('canvas');landmarks.width=16*144;landmarks.height=5*168;const lc=landmarks.getContext('2d');
   for(const [row,key] of ['sitdown','liedown','tiltleft','tiltright','greet'].entries())for(let index=0;index<16;index++){
    const f=dogs.animation.atlases[key].frames[index],x=index*144,y=row*168;
    lc.fillStyle='#fff6e8';lc.fillRect(x,y,144,168);lc.drawImage(dogs.images[key],f.x,f.y,384,384,x,y+24,144,144);
    lc.strokeStyle='#00c000';lc.lineWidth=1;for(const eye of dogs.naturalPainter.features[key][index].eyes){lc.beginPath();lc.arc(x+eye.x*144/384,y+24+eye.y*144/384,4,0,Math.PI*2);lc.stroke();}
    lc.fillStyle='#382b1e';lc.font='12px sans-serif';lc.fillText(`${key}:${index}`,x+4,y+16);
   }
   const tiltSheet=document.createElement('canvas');tiltSheet.width=384*4;tiltSheet.height=408*4;const tctx=tiltSheet.getContext('2d');
   for(let i=0;i<16;i++){
    const t=(i<8?2800:4400)+(i%8)*170,pose=sampleHome(t,{detailedMotion:true});paint(pose);const x=i%4*384,y=Math.floor(i/4)*408;
    tctx.fillStyle='#fff6e8';tctx.fillRect(x,y,384,408);tctx.drawImage(canvas,x,y+24);tctx.fillStyle='#382b1e';tctx.font='18px sans-serif';tctx.fillText(`${t/1000}s`,x+10,y+21);
   }
   return{measured,stats:dogs.stats,landmarks:landmarks.toDataURL().split(',')[1],tiltSheet:tiltSheet.toDataURL().split(',')[1],sheet:sheet.toDataURL().split(',')[1],transitions:transitions.toDataURL().split(',')[1],blinkSheet:blinkSheet.toDataURL().split(',')[1]};
  });
  for(const m of evidence.measured){assert.ok(m.eyeChanges>0,JSON.stringify(m));assert.equal(m.outsideEyeChanges,0,JSON.stringify(m));assert.ok(m.breathChanges>0);assert.equal(m.footChanges,0,JSON.stringify(m));}
  for(const key of ['sheet','transitions','blinkSheet','tiltSheet','landmarks']){await writeFile(`test-results/natural-home/${engine.name()}-${key}.png`,Buffer.from(evidence[key],'base64'));delete evidence[key];}
  checks.push({engine:engine.name(),...evidence});await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await writeFile('test-results/natural-home/pixel-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,checks,errors},null,2));console.log(JSON.stringify(checks.map(c=>({engine:c.engine,measured:c.measured})),null,2));
