import {NaturalDogPainter} from '../src/dog-natural-motion.js';
const names=['sitdown','liedown','tiltleft','tiltright','greet'];
const load=async url=>{const image=new Image();image.src=url;await image.decode();return image;};
const meta=await fetch('/art/dog-home-motion.json').then(r=>r.json());
const current=await fetch('/art/dog-home-continuity.json').then(r=>r.json());
const packs=[];
for(const variant of ['a','b','c']){
 const images={},atlases={};
 await Promise.all(names.map(async key=>{
  const count=variant==='a'?32:variant==='b'?16:current.atlases[key].frames.length;
  images[key]=await load(variant==='a'?`/art/local-motion/v13/${key}-interpolated32.webp`:`/art/continuity/${key}-${variant==='b'?'corrected16':`interpolated${count}`}.webp`);
  atlases[key]={...meta.atlases[key],prealigned:true,frames:Array.from({length:count},(_,i)=>({x:i%4*384,y:Math.floor(i/4)*384,width:384,height:384,anchorX:192,anchorY:372,referenceHeight:336}))};
 }));
 packs.push(new NaturalDogPainter(images,atlases));
}
const contexts=['a','b','c','d'].map(id=>document.getElementById(id).getContext('2d'));
let running=true,clock=0,last=null,key='sitdown',speed=1,slowDuration=2000;
function draw(time){
 clock=time;
 contexts.forEach((ctx,i)=>{
  const count=i===0?32:i===1?16:current.atlases[key].frames.length,duration=i===3?slowDuration:1600,u=Math.max(0,Math.min(1,time/duration)),phase=u*u*(3-2*u)*(count-1),index=Math.floor(phase),nextIndex=Math.min(count-1,index+1),mix=phase-index;
  ctx.fillStyle='#fffaf3';ctx.fillRect(0,0,384,384);
  const layers=[{atlas:key,index,weight:1-mix},{atlas:key,index:nextIndex,weight:mix}].filter(l=>l.weight>0);
  packs[Math.min(i,2)].draw(ctx,{x:192,foot:372,size:336,sample:{natural:true,prealigned:true,blink:0,breath:0,attention:0},layers});
 });
 document.getElementById('time').textContent=`${(time/1000).toFixed(2)}秒`;
 document.getElementById('scrub').value=time;
}
function frame(now){if(running){if(last!==null)clock=(clock+Math.min(50,now-last)*speed)%3000;draw(clock);}last=now;requestAnimationFrame(frame);}
document.getElementById('play').onclick=()=>{running=!running;document.getElementById('play').textContent=running?'一時停止':'再生';last=null;};
document.getElementById('clip').onchange=e=>{key=e.target.value;clock=0;draw(0);};
document.getElementById('scrub').oninput=e=>{running=false;document.getElementById('play').textContent='再生';draw(Number(e.target.value));};
document.getElementById('slower').onclick=()=>{speed=speed===1?.5:1;document.getElementById('slower').textContent=speed===1?'0.5倍速':'通常速度';};
document.getElementById('back').onclick=()=>{running=false;document.getElementById('play').textContent='再生';draw(Math.max(0,clock-1000/60));};
document.getElementById('step').onclick=()=>{running=false;document.getElementById('play').textContent='再生';draw(Math.min(2000,clock+1000/60));};
document.getElementById('duration').onchange=e=>{slowDuration=Number(e.target.value);document.getElementById('d').closest('article').querySelector('small').textContent=`${slowDuration/1000}秒 · 素材はCと同じ`;draw(clock);};
document.getElementById('blind').onclick=()=>{for(const label of document.querySelectorAll('article h2,article small'))label.hidden=!label.hidden;};
document.getElementById('swap').onclick=()=>{const main=document.querySelector('main');for(const article of [...main.children].reverse())main.append(article);};
window.__comparison={packs,play:()=>{clock=0;running=true;last=null;document.getElementById('play').textContent='一時停止';},setTime:time=>{running=false;document.getElementById('play').textContent='再生';draw(time);},setClip:value=>{key=value;draw(clock);},get ready(){return true;}};
document.getElementById('status').textContent='開発用の比較画面です。ゲーム本体へは含めません。再生成した別素材は採用せず、元の犬の画像から作成しました。';
draw(0);requestAnimationFrame(frame);
