import { resolveHomeIdle, resolveHomeStroll } from './home-idle.js';
import { resolveHomeAction } from './home-animation.js';

const INK = '#65503a';
export const HOUSE_POSES = Object.freeze(Array.from({length:5},(_,i)=>({
  level:i+1, entranceAnchor:{x:.5,y:.84},
  entranceClipMask:[{x:.34,y:.85},{x:.34,y:.48},{x:.5,y:.36},{x:.66,y:.48},{x:.66,y:.85}],
  insideDogAnchor:{x:.5,y:.84},peekAnchor:{x:.5,y:.69},
})));

/** A small, orthographic garden. All house masks use the same normalized space. */
export class HomeScene {
  constructor(renderer) {this.renderer=renderer;this.petAt=null;this.lastTime=0;this.frameNow=null;this.inside=false;this.houseTransition=null;this.lastActionKind=null;this.actionEnteredAt=0;this.lastDrawPose=null;this.feedUntil=0;this.ready=Promise.resolve();}
  pet() {if(this.petAt===null||this.lastTime-this.petAt>=1800)this.petAt=this.lastTime;}
  homeStroll(idle,kind,time,size){
    if(idle.action!=='walk'){if(this.strollKey!==null&&this.strollKey!==undefined)this.strollBlockedKey=this.strollKey;this.strollKey=null;return null;}
    const key=Math.round(time-idle.actionAgeMs);
    if(kind!=='idle'||this.houseTransition||this.houseProgress!==0){if(this.strollKey===key)this.strollBlockedKey=key;return null;}
    if(this.strollBlockedKey===key)return null;
    if(this.strollKey!==key){this.strollKey=key;this.strollOrigin=this.homeOffsetX??0;this.strollDirection=this.strollOrigin>0?-1:1;}
    const step=resolveHomeStroll(idle.actionAgeMs,idle.durationMs),limit=this.renderer.width*.08;
    const amplitude=Math.min(size*.15,limit+Math.abs(this.strollOrigin));
    const next=Math.max(-limit,Math.min(limit,this.strollOrigin+step.offset*amplitude*this.strollDirection));
    const offsetDelta=next-(this.homeOffsetX??0);this.homeOffsetX=next;
    if(this.strollDirection<0){step.yaw=-step.yaw;if(step.turnFromYaw!==undefined)step.turnFromYaw=-step.turnFromYaw;}
    return{...step,offsetDelta};
  }
  leaveHouse(){if(!this.inside&&!this.houseTransition)return Promise.resolve();if(!this.houseTransition)this.toggleHouse(this.lastTime);else if(this.inside)this.leaveRequested=true;return new Promise(resolve=>{(this.outsideResolvers??=[]).push(resolve);});}
  toggleHouse(clockMs) { if(this.houseTransition)return; this.houseTransition={from:this.inside?1:0,to:this.inside?0:1,at:this.lastTime||clockMs}; this.inside=!this.inside; }
  draw(save,now,{paused=false}={}) {
    const r=this.renderer,c=r.ctx,w=r.width,h=r.height;
    if(!w||!h)return;
    if(this.saveGeneration!==save.saveGeneration){this.saveGeneration=save.saveGeneration;this.renderer.liveDog?.resetPose('home');this.lastDogRoot=null;this.houseGaitDistance=0;this.leaveRequested=false;for(const resolve of this.outsideResolvers??[])resolve();this.outsideResolvers=[];this.lastTime=save.raisingClockMs;this.frameNow=null;this.lastMotion=null;this.lastActionKind=null;this.feedUntil=0;this.houseTransition=null;this.inside=false;this.homeOffsetX=0;this.strollOrigin=null;this.strollKey=null;this.strollBlockedKey=null;}
    const frameDelta=this.frameNow===null?0:Math.max(0,Math.min(50,now-this.frameNow));this.frameNow=now;const time=paused?this.lastTime:Math.max(this.lastTime,save.raisingClockMs??0)+frameDelta;this.lastTime=time;
    c.clearRect(0,0,w,h);
    const sky=c.createLinearGradient(0,0,0,h*.67);sky.addColorStop(0,'#f9ead4');sky.addColorStop(1,'#e9edcb');
    c.fillStyle=sky;c.fillRect(0,0,w,h);
    c.fillStyle='#d9e4bf';c.beginPath();c.moveTo(0,h*.43);c.bezierCurveTo(w*.25,h*.38,w*.7,h*.50,w,h*.41);c.lineTo(w,h);c.lineTo(0,h);c.fill();
    c.fillStyle='#c8d9aa';c.beginPath();c.moveTo(0,h*.52);c.bezierCurveTo(w*.25,h*.43,w*.6,h*.58,w,h*.49);c.lineTo(w,h);c.lineTo(0,h);c.fill();
    const canvasRect=r.canvas.getBoundingClientRect(),gardenRect=document.querySelector('.garden-targets')?.getBoundingClientRect();const gardenHeight=gardenRect?.height??h*.55;const ground=gardenRect?gardenRect.top-canvasRect.top+gardenHeight*.72:h*.72,unit=Math.min(w/390,gardenHeight/360),houseW=(84+((save.owned?.houseLevel??1)-1)*7)*unit,houseH=(94+((save.owned?.houseLevel??1)-1)*6)*unit,hx=w*.83-houseW/2,hy=ground-houseH-8*unit;
    // Deliberate small garden, with no scrolling texture behind the controls.
    c.fillStyle='#f4e5c6';c.beginPath();c.ellipse(w*.5,ground+8*unit,w*.40,29*unit,0,0,Math.PI*2);c.fill();
    const deco=save.equipped?.decorations??[];
    if(deco.includes('plant'))this.plant(c,w*.13,ground,unit);
    if(deco.includes('fountain')) {c.fillStyle='#a3c6bd';c.strokeStyle=INK;c.lineWidth=1.5;c.beginPath();c.ellipse(w*.14,ground,25*unit,10*unit,0,0,Math.PI*2);c.fill();c.stroke();c.fillRect(w*.14-2*unit,ground-24*unit,4*unit,24*unit);}
    if(deco.includes('lamp')) {c.strokeStyle=INK;c.lineWidth=2;c.beginPath();c.moveTo(w*.89,ground);c.lineTo(w*.89,ground-60*unit);c.stroke();c.fillStyle='#f4c565';c.fillRect(w*.89-8*unit,ground-67*unit,16*unit,17*unit);}
    const level=save.owned?.houseLevel??1,pose=HOUSE_POSES[level-1];
    const targetKey=[w,h,gardenRect?.top,gardenRect?.left,gardenHeight,level].join(':');
    if(gardenRect&&this.targetKey!==targetKey){
      this.targetKey=targetKey;const leftOffset=canvasRect.left-gardenRect.left,topOffset=canvasRect.top-gardenRect.top;
      const pet=document.getElementById('dog-pet'),house=document.getElementById('house-peek');
      if(pet)Object.assign(pet.style,{left:`${w*.52-105*unit+leftOffset}px`,top:`${ground-290*unit+topOffset}px`,bottom:'auto',width:`${210*unit}px`,height:`${300*unit}px`,minHeight:'44px'});
      if(house)Object.assign(house.style,{left:`${hx-8*unit+leftOffset}px`,right:'auto',top:`${hy-8*unit+topOffset}px`,width:`${Math.max(44,houseW+16*unit)}px`,height:`${Math.max(44,houseH+16*unit)}px`});
    }
    this.houseBack(c,hx,hy,houseW,houseH,level);
    let t=this.inside?1:0;
    if(this.houseTransition){const p=Math.min(1,(time-this.houseTransition.at)/1800);const eased=p*p*p*(p*(p*6-15)+10);t=this.houseTransition.from+(this.houseTransition.to-this.houseTransition.from)*eased;if(p===1){this.houseTransition=null;if(this.inside&&this.leaveRequested){this.leaveRequested=false;this.toggleHouse(time);}else if(!this.inside){for(const resolve of this.outsideResolvers??[])resolve();this.outsideResolvers=[];}}}
    const homeX=w*.52+(this.homeOffsetX??0),dx=homeX+(hx+houseW*pose.insideDogAnchor.x-homeX)*t;
    const foot=ground+(hy+houseH*pose.insideDogAnchor.y-ground)*t;
    const size=290*unit*(1-t)+houseH*.52*t;
    this.houseProgress=t;
    if(deco.includes('bed')||save.equipped?.bed==='bed') {c.fillStyle='#d89677';c.strokeStyle=INK;c.lineWidth=1.5;c.beginPath();c.ellipse(w*.39,ground,65*unit,16*unit,0,0,Math.PI*2);c.fill();c.stroke();}
    else if(deco.includes('cushion')) {c.fillStyle='#e9bf75';c.beginPath();c.ellipse(w*.39,ground,50*unit,12*unit,0,0,Math.PI*2);c.fill();}
    const paintDog=()=>this.dog(save,c,dx,foot,size,time,now,paused);
    if(t===1){c.save();this.entrance(c,hx,hy,houseW,houseH,pose);c.clip();paintDog();c.restore();}
    else paintDog();
    this.houseFront(c,hx,hy,houseW,houseH,pose,level);
    c.fillStyle='#527042';for(const [x,y]of [[.07,.62],[.93,.60],[.81,.65]]){c.beginPath();c.moveTo(w*x,h*y);c.lineTo(w*x-3*unit,h*y-7*unit);c.lineTo(w*x,h*y-4*unit);c.lineTo(w*x+4*unit,h*y-9*unit);c.strokeStyle='#799255';c.lineWidth=1.5;c.stroke();}
  }
  dog(save,c,x,foot,size,time,now,paused){
    const reduced=this.renderer.reducedMotion,active=save.activeAction;
    const kind=active?.kind??(time<this.feedUntil?'feed':'idle');
    const key=active?.actionId??kind;
    if(this.lastActionKind!==key){this.lastActionKind=key;this.actionEnteredAt=time;}
    const elapsed=Math.max(0,time-this.actionEnteredAt);
    const duration=kind==='feed'?3000:kind==='play'?4000:8000;
    const behavior=resolveHomeAction({kind,toyId:active?.toyId,elapsedMs:elapsed,durationMs:duration,reducedMotion:reduced});
    const fetchAction=kind==='play'&&!['rope','plush'].includes(active?.toyId);
    const routeScale=size*.13;let atX=x-behavior.rootOffsetX*routeScale;const atFoot=foot;
    const idle=resolveHomeIdle(time,{...save.dog,reducedMotion:reduced,petAgeMs:this.petAt===null?null:time-this.petAt});
    let action=idle.action,age=idle.actionAgeMs,yaw=0,poseDuration=kind==='idle'?idle.durationMs:duration,turnFromYaw;
    const step=this.homeStroll(idle,kind,time,size),strolling=Boolean(step);
    if(step){
      atX+=step.offsetDelta;
      action=step.action;age=step.ageMs;poseDuration=step.durationMs;yaw=step.yaw;turnFromYaw=step.turnFromYaw;
    }else if(idle.action==='walk')action='idle';
    if(kind==='sleep')action='sleep';
    else if(kind==='rest')action='lie';
    else if(kind==='feed')action=behavior.poseKey==='feed-sniff'?'sniffFood':behavior.poseKey==='feed-lick'?'lick':'eat';
    else if(kind==='play')action=active.toyId==='rope'?'tug':active.toyId==='plush'?(elapsed<2400?'plushShake':'plushCuddle'):behavior.poseKey.endsWith('chase')?'retrieve':behavior.poseKey.endsWith('return')?'return':behavior.poseKey.endsWith('pickup')?'sniffFood':'carry';
    if(kind!=='idle')age=elapsed;
    if(fetchAction){
      const p=Math.min(1,elapsed/duration),ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
      if(p>=.66&&p<.80)action=active.toyId==='frisbee'&&p<.74?'jumpCatch':'turn';
      yaw=p<.12?-Math.PI/2*ease(p/.12):p<.66?-Math.PI/2:p<.80?-Math.PI/2+Math.PI*ease((p-.66)/.14):Math.PI/2*(1-ease((p-.93)/.07));
      if(action==='turn'){const start=active.toyId==='frisbee'?.74:.66;age=Math.max(0,elapsed-duration*start);poseDuration=duration*(.80-start);turnFromYaw=-Math.PI/2;yaw=Math.PI/2;}
      if(action==='jumpCatch'){age=elapsed-duration*.66;poseDuration=duration*.08;}
    }
    if(this.houseTransition){action=this.houseTransition.to?'enterHouse':'exitHouse';yaw=this.houseTransition.to?Math.PI*.65:-Math.PI*.35;age=time-this.houseTransition.at;}
    else if(this.houseProgress===1){action=idle.action==='petHappy'?'petHappy':idle.action==='lookPlayer'?'peek':'insideHouse';yaw=0;}
    c.fillStyle='#4b63422b';c.beginPath();c.ellipse(atX,foot,45*size/260,8*size/260,0,0,Math.PI*2);c.fill();
    const dog=this.renderer.liveDog;
    const rootDelta=this.lastDogRoot&&!paused?Math.hypot(atX-this.lastDogRoot.x,atFoot-this.lastDogRoot.y):0;
    const rootMs=this.lastDogRoot?Math.max(1,time-this.lastDogRoot.time):16;
    this.houseGaitDistance=(this.houseGaitDistance??0)+rootDelta/(size/(dog?.model?.standingHeight??1.355));
    if(!paused)this.lastDogRoot={x:atX,y:atFoot,time};
    const houseMoving=Boolean(this.houseTransition)||strolling;
    const groundDistance=houseMoving?this.houseGaitDistance:behavior.gaitDistance*routeScale/(size/(dog?.model?.standingHeight??1.355));
    const velocity=houseMoving?rootDelta/rootMs*1000/(size/(dog?.model?.standingHeight??1.355)):behavior.gaitSpeed*routeScale/(size/(dog?.model?.standingHeight??1.355));
    if(!dog?.draw(c,{controllerId:'home',view:'front',yaw,turnFromYaw,action,x:atX,foot:atFoot,size,timeMs:time,actionAgeMs:age,durationMs:poseDuration,groundDistance,velocity,headNod:behavior.headNod,tailWag:behavior.tailWag,reducedMotion:reduced,paused})){this.renderer.frontDog(atX,atFoot-102*size/232,size/232,time/1000);this.renderer.simpleDogDisplay=true;return;}
    this.lastDrawPose=behavior.poseKey;
    const mouth=dog.lastDraw?.landmarks?.mouth;
    if(kind==='feed'){
      c.fillStyle='#c17855';c.beginPath();c.ellipse(x,foot+3,size*.09,size*.025,0,0,Math.PI*2);c.fill();c.fillStyle='#875333';c.beginPath();c.ellipse(x,foot,size*.065,size*.015,0,0,Math.PI*2);c.fill();
    }
    if(kind==='play'&&mouth){
      const toy=behavior.toy,held=toy.held||active.toyId==='rope'||active.toyId==='plush';
      if(toy.visible||held){
        const tx=held?mouth.x:x-toy.x*routeScale-size*.18;
        const ty=held?mouth.y:foot-Math.max(0,toy.y-.1)*size*.8;
        c.save();c.fillStyle=active.toyId==='frisbee'?'#edb45a':'#cf785b';c.strokeStyle='#835536';c.lineWidth=1.5;
        c.beginPath();
        if(active.toyId==='rope'){c.moveTo(tx,ty);c.bezierCurveTo(tx+15,ty+9,tx+22,ty-9,tx+34,ty+7);c.lineWidth=5;c.strokeStyle='#e4c386';c.stroke();}
        else if(active.toyId==='plush'){c.ellipse(tx,ty+6,size*.036,size*.046,0,0,Math.PI*2);c.fill();c.stroke();}
        else{if(active.toyId==='frisbee')c.ellipse(tx,ty,size*.045,size*.012,0,0,Math.PI*2);else c.arc(tx,ty,size*.03,0,Math.PI*2);c.fill();c.stroke();}c.restore();
      }
    }
    if(kind==='sleep'){c.fillStyle='#516a44';c.font=`700 ${Math.max(13,size*.055)}px sans-serif`;c.fillText('z z',atX+size*.27,atFoot-size*.55);}
  }
  entrance(c,x,y,w,h,pose){c.beginPath();for(const [i,p] of pose.entranceClipMask.entries()){if(!i)c.moveTo(x+p.x*w,y+p.y*h);else c.lineTo(x+p.x*w,y+p.y*h);}c.closePath();}
  houseBack(c,x,y,w,h,level){c.save();c.lineWidth=2;c.strokeStyle=INK;c.fillStyle=['#d4a470','#cdad7d','#bdd0a3','#bbccb9','#ddbc83'][level-1];c.beginPath();c.roundRect(x,y+h*.30,w,h*.57,6);c.fill();c.stroke();c.fillStyle='#6a5540';this.entrance(c,x,y,w,h,HOUSE_POSES[level-1]);c.fill();c.restore();}
  houseFront(c,x,y,w,h,pose,level){c.save();c.lineWidth=2;c.strokeStyle=INK;c.fillStyle=['#d4a470','#cdad7d','#bdd0a3','#bbccb9','#ddbc83'][level-1];c.beginPath();c.rect(x,y+h*.30,w,h*.57);for(const [i,p] of pose.entranceClipMask.entries()){if(!i)c.moveTo(x+p.x*w,y+p.y*h);else c.lineTo(x+p.x*w,y+p.y*h);}c.closePath();c.fill('evenodd');c.fillStyle=level>=4?'#7c9c75':'#bc7851';c.beginPath();c.moveTo(x-w*.08,y+h*.34);c.lineTo(x+w*.5,y);c.lineTo(x+w*1.08,y+h*.34);c.lineTo(x+w*1.02,y+h*.42);c.lineTo(x+w*.5,y+h*.11);c.lineTo(x-w*.02,y+h*.42);c.closePath();c.fill();c.stroke();this.entrance(c,x,y,w,h,pose);c.stroke();c.fillStyle='#ffecc5';c.beginPath();c.roundRect(x+w*.3,y+h*.25,w*.4,h*.16,3);c.fill();c.stroke();c.fillStyle=INK;c.font=`700 ${Math.max(9,w*.08)}px sans-serif`;c.textAlign='center';c.fillText(`おうち Lv.${level}`,x+w*.5,y+h*.36);c.restore();}
  plant(c,x,y,s){c.fillStyle='#b87952';c.beginPath();c.moveTo(x-10*s,y-14*s);c.lineTo(x+10*s,y-14*s);c.lineTo(x+7*s,y);c.lineTo(x-7*s,y);c.closePath();c.fill();c.fillStyle='#5e8757';for(const [dx,dy]of [[-8,-21],[8,-29],[0,-37]]){c.beginPath();c.ellipse(x+dx*s,y+dy*s,9*s,14*s,.4,0,Math.PI*2);c.fill();}}
}
