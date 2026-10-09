import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const specs=[
 {key:'walk',source:'dog-walk-v1.png',rows:2,cell:256,referenceHeight:208,count:8},
 {key:'expressions',source:'dog-expressions-v2.png',rows:2,cell:384,referenceHeight:336,count:8},
 {key:'postures',source:'dog-postures-v1.png',rows:3,cell:384,referenceHeight:336,count:12},
];
const inputs=await Promise.all(specs.map(async s=>({...s,bytes:(await readFile(`art/source/${s.source}`)).toString('base64')})));
const browser=await chromium.launch({headless:true});
let output;
try{
 const page=await browser.newPage();
 output=await page.evaluate(async specs=>{
  const load=async bytes=>{const i=new Image();i.src=`data:image/png;base64,${bytes}`;await i.decode();return i;};
  function components(image){
   const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
   const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
   const rgba=ctx.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height;
   const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),found=[];
   for(let p=0;p<w*h;p++){
    if(seen[p]||rgba[p*4+3]<12)continue;
    let head=0,tail=0,count=0,minX=w,minY=h,maxX=0,maxY=0;
    seen[p]=1;queue[tail++]=p;
    while(head<tail){
     const index=queue[head++],x=index%w,y=(index/w)|0;count++;
     minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h||(!dx&&!dy))continue;
      const next=ny*w+nx;if(seen[next]||rgba[next*4+3]<12)continue;
      seen[next]=1;queue[tail++]=next;
     }
    }
    if(count>2000)found.push({x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1,count});
   }
   return {rgba,w,h,found:found.sort((a,b)=>b.count-a.count)};
  }
  function weightedX(rgba,w,b,top,bottom){
   let mass=0,sum=0;
   for(let y=Math.floor(b.y+b.height*top);y<Math.min(b.y+b.height,Math.ceil(b.y+b.height*bottom));y++)
    for(let x=b.x;x<b.x+b.width;x++){const a=rgba[(y*w+x)*4+3];mass+=a;sum+=a*x;}
   return mass?sum/mass:b.x+b.width/2;
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const sheets=[];
  for(const spec of specs){
   const image=await load(spec.bytes),detected=components(image);
   if(detected.found.length<spec.count)throw new Error(`${spec.key}: expected ${spec.count} silhouettes, found ${detected.found.length}`);
   const boxes=detected.found.slice(0,spec.count).sort((a,b)=>a.y+a.height/2-b.y-b.height/2);
   const ordered=[];
   for(let row=0;row<spec.rows;row++)ordered.push(...boxes.slice(row*4,row*4+4).sort((a,b)=>a.x+a.width/2-b.x-b.width/2));
   const sourceRef=spec.key==='postures'?ordered[0].height:median(ordered.slice(0,spec.key==='expressions'?3:8).map(b=>b.height));
   const scale=spec.referenceHeight/sourceRef;
   const canvas=document.createElement('canvas');canvas.width=spec.cell*4;canvas.height=spec.cell*spec.rows;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
   const frames=[];
   for(let i=0;i<ordered.length;i++){
    const b=ordered[i],col=i%4,row=Math.floor(i/4),ground=spec.cell-12;
    const anchor=weightedX(detected.rgba,detected.w,b,spec.key==='walk'?.02:.88,spec.key==='walk'?.25:1);
    const px=col*spec.cell+spec.cell/2+(b.x-anchor)*scale,py=row*spec.cell+ground-b.height*scale;
    if(px<col*spec.cell+1||px+b.width*scale>(col+1)*spec.cell-1||py<row*spec.cell+1)throw new Error(`${spec.key}:${i} would be clipped; inspect source framing`);
    const sx=Math.max(0,b.x-2),sy=Math.max(0,b.y-2),sw=Math.min(image.width-sx,b.width+4),sh=Math.min(image.height-sy,b.height+4);
    ctx.drawImage(image,sx,sy,sw,sh,px+(sx-b.x)*scale,py+(sy-b.y)*scale,sw*scale,sh*scale);
    frames.push({x:col*spec.cell,y:row*spec.cell,width:spec.cell,height:spec.cell,anchorX:spec.cell/2,anchorY:ground,referenceHeight:spec.referenceHeight,sourceBounds:b});
   }
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   let transparent=0,edgeOpaque=0;
   for(let p=0;p<pixels.length/4;p++){if(pixels[p*4+3]===0)transparent++;const x=p%canvas.width,y=Math.floor(p/canvas.width);if((x%spec.cell===0||y%spec.cell===0)&&pixels[p*4+3]>32)edgeOpaque++;}
   if(edgeOpaque>0)throw new Error(`${spec.key}: ${edgeOpaque} opaque grid edge pixels`);
   const blob=await new Promise(r=>canvas.toBlob(r,'image/webp',.94));
   if(!blob||blob.type!=='image/webp')throw new Error('WebP alpha encoder unavailable');
   const bytes=new Uint8Array(await blob.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   const preview=document.createElement('canvas');preview.width=canvas.width;preview.height=canvas.height;
   const pc=preview.getContext('2d');pc.fillStyle='#fff6e8';pc.fillRect(0,0,preview.width,preview.height);pc.drawImage(canvas,0,0);
   sheets.push({key:spec.key,width:canvas.width,height:canvas.height,cell:spec.cell,frames,referenceHeight:spec.referenceHeight,sourceRef,transparentFraction:transparent/(canvas.width*canvas.height),edgeOpaque,base64:btoa(binary),preview:preview.toDataURL('image/png').split(',')[1]});
  }
  return sheets;
 },inputs);
}finally{await browser.close();}
const metadata={version:1,mode:'authored-image-animation',strideLength:.78,atlases:{},sourceSheets:{}};
metadata.generator={path:'scripts/build-sprite-animation.mjs',sha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')};
let total=0;
for(const sheet of output){
 const {base64,preview,...details}=sheet,bytes=Buffer.from(base64,'base64');total+=bytes.length;
 await writeFile(`art/dog-${sheet.key}-animated.webp`,bytes);
 await writeFile(`art/dog-${sheet.key}-animated-preview.png`,Buffer.from(preview,'base64'));
 metadata.atlases[sheet.key]={...details,path:`art/dog-${sheet.key}-animated.webp`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const sourceName=specs.find(s=>s.key===sheet.key).source,sourceBytes=await readFile(`art/source/${sourceName}`);
 metadata.sourceSheets[sheet.key]={path:`art/source/${sourceName}`,sha256:createHash('sha256').update(sourceBytes).digest('hex')};
}
metadata.textureBytes=output.reduce((sum,s)=>sum+s.width*s.height*4,0);
metadata.compressedBytes=total;
if(total>2_500_000||metadata.textureBytes>18_000_000)throw new Error(`Sprite budget exceeded: ${total} compressed/${metadata.textureBytes} decoded`);
await writeFile('art/dog-image-animation.json',JSON.stringify(metadata,null,2));
console.log(JSON.stringify({compressedBytes:total,textureBytes:metadata.textureBytes,atlases:output.map(({key,width,height,frames,transparentFraction})=>({key,width,height,frames:frames.length,transparentFraction}))},null,2));
