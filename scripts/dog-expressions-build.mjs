import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const source=await readFile('art/source/dog-expressions-source.png');
const browser=await chromium.launch({headless:true});let result;
try {
 const page=await browser.newPage();
 result=await page.evaluate(async bytes=>{
  const image=new Image();image.src=`data:image/png;base64,${bytes}`;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const c=canvas.getContext('2d',{willReadFrequently:true});c.imageSmoothingQuality='high';c.drawImage(image,0,0,1024,1024);
  const rgba=c.getImageData(0,0,1024,1024).data;
  const frames=[];
  for(let row=0;row<2;row++)for(let col=0;col<4;col++){
   const W=256,H=512,visited=new Uint8Array(W*H),queue=new Int32Array(W*H);
   const alpha=(x,y)=>rgba[((row*H+y)*1024+col*W+x)*4+3];
   let largest=null;
   for(let start=0;start<W*H;start++){
    if(visited[start]||alpha(start%W,Math.floor(start/W))<=12)continue;
    let head=0,tail=0,count=0,minX=W,minY=H,maxX=0,maxY=0;queue[tail++]=start;visited[start]=1;
    while(head<tail){const v=queue[head++],x=v%W,y=Math.floor(v/W);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
     for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,n=ny*W+nx;if(nx<0||nx>=W||ny<0||ny>=H||visited[n]||alpha(nx,ny)<=12)continue;visited[n]=1;queue[tail++]=n;}
    }
    if(!largest||count>largest.count)largest={count,minX,minY,maxX,maxY};
   }
   if(!largest||largest.count<2000)throw Error(`Missing dog ${row},${col}`);
   const {minX,minY,maxX,maxY}=largest,width=maxX-minX+1,height=maxY-minY+1;
   let weight=0,weightedX=0;
   for(let y=Math.floor(minY+height*.85);y<=maxY;y++)for(let x=minX;x<=maxX;x++){const a=alpha(x,y);weight+=a;weightedX+=(x-minX)*a;}
   frames.push({atlas:'expressions',x:col*W+minX,y:row*H+minY,width,height,anchorX:weightedX/weight,cell:[row,col]});
  }
  return {png:canvas.toDataURL('image/png').split(',')[1],frames,sourceSize:[image.naturalWidth,image.naturalHeight]};
 },source.toString('base64'));
}finally{await browser.close();}
const png=Buffer.from(result.png,'base64');await writeFile('art/dog-expressions.png',png);
const [neutral,blink,lookLeft,lookRight,paw,bow,happyLeft,happyRight]=result.frames;
const metadata={version:1,atlas:'expressions',textureSize:[1024,1024],cellSize:[256,512],
 poses:{blink,lookLeft,lookRight,paw,bow,finish:{durationMs:760,loop:true,frames:[happyLeft,happyRight]}},neutral,
 source:{path:'art/source/dog-expressions-source.png',sha256:createHash('sha256').update(source).digest('hex'),size:result.sourceSize},pngBytes:png.length};
await writeFile('art/dog-expressions.json',JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({pngBytes:png.length,frames:result.frames.length,sourceSize:result.sourceSize}));
