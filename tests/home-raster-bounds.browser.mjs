import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const source=await readFile('src/dog-natural-motion.js','utf8');
const start=source.indexOf('export function rasterWorkBounds('),end=source.indexOf('\nfunction normalizedHeadAngle',start);
assert.ok(start>=0&&end>start);
const reference=source.slice(0,start)+'export function rasterWorkBounds(pixels,width=384,height=384){return {left:0,right:width,top:0,bottom:height};}\n'+source.slice(end);
const results=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  await page.goto('http://127.0.0.1:4182/?test=1');await page.waitForFunction(()=>__dogBoneTest?.renderer.dogs.stats.continuityReady);
  const result=await page.evaluate(async reference=>{
   const r=__dogBoneTest.renderer,d=r.dogs;r.setMenuPaused(true);
   const url=URL.createObjectURL(new Blob([reference],{type:'text/javascript'}));const {NaturalDogPainter}=await import(url);URL.revokeObjectURL(url);
   const full=new NaturalDogPainter(d.naturalPainter.images,d.naturalPainter.atlases);
   const c=document.createElement('canvas');c.width=c.height=384;const ctx=c.getContext('2d',{willReadFrequently:true});
   const layersFor=s=>[{atlas:s.atlas,index:s.index,weight:1-s.mix},{atlas:s.atlas,index:s.nextIndex,weight:s.mix}].filter(l=>l.weight>0);
   const paint=(painter,s)=>{ctx.clearRect(0,0,384,384);painter.draw(ctx,{x:192,foot:372,size:336,sample:s,layers:layersFor(s)});return ctx.getImageData(0,0,384,384).data;};
   let alphaMax=0,premultMax=0,checked=0;
   for(const atlas of ['sitdown','liedown'])for(const index of [0,9,23,39,46,47])for(const mode of [0,1,2]){
    const s={atlas,index,nextIndex:Math.min(47,index+1),mix:.37,natural:true,prealigned:true,breath:mode===0?0:.48,attention:0,blink:mode===1?.8:0,earLeft:mode===2?.9:0,earRight:mode===2?-.4:0,headAngle:mode===2?.055:0,headLift:mode===2?4:0};
    const a=paint(d.naturalPainter,s),b=paint(full,s);
    for(let k=0;k<a.length;k+=4){alphaMax=Math.max(alphaMax,Math.abs(a[k+3]-b[k+3]));for(let j=0;j<3;j++)premultMax=Math.max(premultMax,Math.abs(a[k+j]*a[k+3]/255-b[k+j]*b[k+3]/255));}checked++;
   }
   return {checked,alphaMax,premultMax};
  },reference);
  assert.ok(result.alphaMax<=1&&result.premultMax<=1.01,JSON.stringify({engine:engine.name(),...result}));results.push({engine:engine.name(),...result});
 }finally{await browser.close();}
}
await writeFile('test-results/motion-repair-v15/raster-bounds-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
