import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:4182/test-results/home-motion-preview.html');
 const result=await page.evaluate(async()=>{
  const v=document.querySelector('video');v.muted=true;v.playbackRate=4;
  const targets=[3.6,5.0,6.7,8.5,8.8,9.1,10.0,17.7,18.0,18.3,19.0,35.6];
  const c=document.createElement('canvas');c.width=390*4;c.height=844*3;
  const ctx=c.getContext('2d');const captured=[];
  await new Promise((resolve,reject)=>{
   v.addEventListener('error',()=>reject(new Error('video decode failed')),{once:true});
   v.addEventListener('ended',resolve,{once:true});
   function frame(_,meta){
    while(captured.length<targets.length&&meta.mediaTime>=targets[captured.length]){
     const i=captured.length,x=(i%4)*390,y=Math.floor(i/4)*844;
     ctx.drawImage(v,x,y,390,844);ctx.fillStyle='#fff6e8';ctx.fillRect(x,y,390,27);ctx.fillStyle='#473724';ctx.font='16px system-ui';ctx.fillText(`real video ${meta.mediaTime.toFixed(2)}s`,x+12,y+20);captured.push(meta.mediaTime);
    }
    if(captured.length===targets.length){v.pause();resolve();}else v.requestVideoFrameCallback(frame);
   }
   v.requestVideoFrameCallback(frame);v.play().catch(reject);
  });
  return{captured,image:c.toDataURL('image/png').split(',')[1]};
 });
 await writeFile('test-results/home-motion-video-contact.png',Buffer.from(result.image,'base64'));
 await writeFile('test-results/home-motion-video-contact.json',JSON.stringify({captured:result.captured},null,2));
 console.log(JSON.stringify({captured:result.captured}));
}finally{await browser.close();}
