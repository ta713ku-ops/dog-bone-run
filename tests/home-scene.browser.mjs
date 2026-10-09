import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {DOG_BEHAVIORS} from '../src/asset-contract.js';

const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'playwright');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4183';
const report={buildVersion:CONFIG.buildVersion,executedAt:new Date().toISOString(),status:'RUNNING',checks:[],engines:[],errors:[],limitations:[
  'Action reachability is measured with explicit HomeScene state/time fixtures plus production Renderer.run/result entry points; it does not claim that ordinary UI interaction completed every action.',
  'The house comparison is a deterministic Canvas pixel test in desktop browser engines; it does not substitute for iPhone Safari or human identity/naturalness review.',
]};
await mkdir('test-results',{recursive:true});

for(const engine of [chromium,webkit]){
  let browser;
  try{
    browser=await engine.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror',error=>report.errors.push(`${engine.name()}: ${error.message}`));
    await page.goto(origin);
    await page.waitForFunction(()=>document.querySelector('#start')&&!document.querySelector('#start').disabled);
    const result=await page.evaluate(async(expectedBehaviors)=>{
      const [{Renderer},{HomeScene,HOUSE_POSES},{createInitialSave},{HOME_IDLE_PERIOD_MS,resolveHomeIdle}]=await Promise.all([
        import('/src/render.js'),import('/src/home-scene.js'),import('/src/raising-model.js'),import('/src/home-idle.js'),
      ]).then(items=>items.slice(0,4));
      const detached=[];
      const originals=[...new Set([document.querySelector('.garden-targets'),document.getElementById('dog-pet'),document.getElementById('house-peek')].filter(Boolean))];
      const depth=node=>{let n=0;for(let p=node.parentElement;p;p=p.parentElement)n++;return n;};
      originals.sort((a,b)=>depth(a)-depth(b));
      for(const node of originals){detached.push({node,parent:node.parentNode,next:node.nextSibling,depth:depth(node)});node.remove();}
      const fixture=document.createElement('div');
      fixture.className='game';
      fixture.style.cssText='position:fixed;left:-10000px;top:0;width:390px;height:500px;padding:0;margin:0;border:0;overflow:hidden;pointer-events:none;';
      const canvas=document.createElement('canvas');
      canvas.style.cssText='display:block;width:390px;height:500px;padding:0;margin:0;border:0;';
      fixture.append(canvas);document.body.append(fixture);
      let renderer;
      try{
        renderer=new Renderer(canvas,{useLiveDog:true});
        const liveDog=renderer.liveDog;
        if(!liveDog)throw Error('Renderer did not create its liveDog instance');
        const context=renderer.ctx;
        const dprX=canvas.width/renderer.width,dprY=canvas.height/renderer.height;
        const capture=()=>context.getImageData(0,0,canvas.width,canvas.height);
        const imageDiff=(actual,absent,mask,landmarks)=>{
          const a=actual.data,b=absent.data,m=mask.data,w=actual.width,h=actual.height;
          let changedPixels=0,outsidePixels=0,insidePixels=0;
          for(let i=0;i<a.length;i+=4){
            const changed=Math.abs(a[i]-b[i])>1||Math.abs(a[i+1]-b[i+1])>1||Math.abs(a[i+2]-b[i+2])>1||Math.abs(a[i+3]-b[i+3])>1;
            if(!changed)continue;
            changedPixels++;
            if(m[i+3]===0)outsidePixels++;else insidePixels++;
          }
          const face=[];
          for(const name of ['nose','leftEye','rightEye','mouth']){
            const p=landmarks?.[name];if(!p)continue;
            const cx=Math.round(p.x*dprX),cy=Math.round(p.y*dprY),r=Math.max(2,Math.round(8*Math.min(dprX,dprY)));
            let changed=0,masked=0;
            for(let y=Math.max(0,cy-r);y<=Math.min(h-1,cy+r);y++)for(let x=Math.max(0,cx-r);x<=Math.min(w-1,cx+r);x++){
              if((x-cx)**2+(y-cy)**2>r*r)continue;
              const i=(y*w+x)*4;
              if(m[i+3]===0)continue;
              masked++;
              if(Math.abs(a[i]-b[i])>1||Math.abs(a[i+1]-b[i+1])>1||Math.abs(a[i+2]-b[i+2])>1||Math.abs(a[i+3]-b[i+3])>1)changed++;
            }
            face.push({name,insideMaskPixels:masked,changedPixels:changed});
          }
          const visibleFace=face.filter(p=>['nose','leftEye','rightEye'].includes(p.name)&&p.insideMaskPixels>0&&p.changedPixels>0).map(p=>p.name);
          return{changedPixels,outsidePixels,insidePixels,face,visibleFace,faceVisible:visibleFace.length>0};
        };
        const createOpeningMask=level=>{
          const w=renderer.width,h=renderer.height,gardenHeight=h*.55,ground=h*.72,unit=Math.min(w/390,gardenHeight/360);
          const houseW=(84+(level-1)*7)*unit,houseH=(94+(level-1)*6)*unit,hx=w*.83-houseW/2,hy=ground-houseH-8*unit;
          const maskCanvas=document.createElement('canvas');maskCanvas.width=canvas.width;maskCanvas.height=canvas.height;
          const c=maskCanvas.getContext('2d');c.setTransform(dprX,0,0,dprY,0,0);c.fillStyle='#fff';c.beginPath();
          for(const [index,p]of HOUSE_POSES[level-1].entranceClipMask.entries()){
            const x=hx+p.x*houseW,y=hy+p.y*houseH;
            if(index===0)c.moveTo(x,y);else c.lineTo(x,y);
          }
          c.closePath();c.fill();
          return{image:c.getImageData(0,0,canvas.width,canvas.height),geometry:{x:hx,y:hy,width:houseW,height:houseH}};
        };
        const renderInside=(level,suppressDog)=>{
          liveDog.resetPose('home');
          const save=createInitialSave();save.owned.houseLevel=level;save.saveGeneration=`occlusion-${level}-${suppressDog?'absent':'actual'}`;
          const scene=new HomeScene(renderer);
          const originalDraw=liveDog.draw;
          if(suppressDog)liveDog.draw=function(){this.lastDraw=null;this.lastLandmarks=null;return true;};
          scene.draw(save,0);
          scene.inside=true;
          for(let now=50;now<=500;now+=50)scene.draw(save,now);
          const pixels=capture(),landmarks=liveDog.lastDraw?.landmarks??null;
          liveDog.draw=originalDraw;
          return{pixels,landmarks};
        };
        const houseChecks=[];
        for(let level=1;level<=5;level++){
          const actual=renderInside(level,false),absent=renderInside(level,true),mask=createOpeningMask(level);
          const diff=imageDiff(actual.pixels,absent.pixels,mask.image,actual.landmarks);
          houseChecks.push({level,...diff,opening:mask.geometry});
        }

        let fixtureIndex=0,currentFixture='';
        const actionCalls=[];
        const originalDraw=liveDog.draw;
        liveDog.draw=function(ctx,args){
          const ok=originalDraw.call(this,ctx,args);
          actionCalls.push({fixture:currentFixture,controllerId:args?.controllerId??null,action:args?.action??null,ok:Boolean(ok),sameLiveDogInstance:this===liveDog});
          return ok;
        };
        const drawFixture=(label,{timeMs=0,energy=100,activeAction=null,activeAgeMs=0,house=null,pet=false}={})=>{
          currentFixture=label;
          liveDog.resetPose('home');
          const save=createInitialSave();save.saveGeneration=`coverage-${++fixtureIndex}`;save.raisingClockMs=timeMs;save.dog.energy=energy;save.activeAction=activeAction;
          const scene=new HomeScene(renderer);scene.draw(save,timeMs);
          if(house==='inside')scene.inside=true;
          else if(house==='enter'){scene.inside=true;scene.houseTransition={from:0,to:1,at:timeMs};}
          else if(house==='exit'){scene.inside=false;scene.houseTransition={from:1,to:0,at:timeMs};}
          if(pet)scene.pet();
          if(house||pet)scene.draw(save,timeMs);
          if(activeAgeMs>0){save.raisingClockMs=timeMs+activeAgeMs;scene.draw(save,timeMs);}
          return liveDog.lastDraw;
        };
        const findIdleTime=(behavior,energy=100,predicate=null)=>{
          for(let time=0;time<HOME_IDLE_PERIOD_MS;time+=20){
            const idle=resolveHomeIdle(time,{energy});
            if(idle.action===behavior&&(!predicate||predicate(idle)))return time;
          }
          return null;
        };
        const idleBehaviors=['idle','lookPlayer','headTilt','sit','sitWait','stretch','yawn','bellyUp','lookFood','wake','playBow','happyJump','walk'];
        const idleFixtureTimes={};
        for(const action of idleBehaviors){
          const energy=100;
          const time=findIdleTime(action,energy,action==='walk'?idle=>idle.actionAgeMs>=1500&&idle.actionAgeMs<3800:null);
          if(time===null)continue;
          idleFixtureTimes[action]=time;
          drawFixture(`home-idle-${action}`,{timeMs:time,energy});
        }
        const refusalTime=findIdleTime('sleepyRefuse',0);
        if(refusalTime!==null){idleFixtureTimes.sleepyRefuse=refusalTime;drawFixture('home-idle-sleepyRefuse',{timeMs:refusalTime,energy:0});}
        const lookTime=idleFixtureTimes.lookPlayer;
        if(lookTime!==undefined)drawFixture('home-inside-peek',{timeMs:lookTime,house:'inside'});
        drawFixture('home-insideHouse',{timeMs:idleFixtureTimes.idle??0,house:'inside'});
        drawFixture('home-enterHouse',{timeMs:0,house:'enter'});
        drawFixture('home-exitHouse',{timeMs:0,house:'exit'});
        drawFixture('home-petHappy',{timeMs:0,pet:true});
        drawFixture('home-rest-lie',{timeMs:0,activeAction:{kind:'rest',actionId:'fixture-rest',toyId:null}});
        drawFixture('home-sleep',{timeMs:0,activeAction:{kind:'sleep',actionId:'fixture-sleep',toyId:null}});
        drawFixture('home-feed-sniffFood',{timeMs:0,activeAction:{kind:'feed',actionId:'fixture-feed-sniff',toyId:null},activeAgeMs:200});
        drawFixture('home-feed-eat',{timeMs:0,activeAction:{kind:'feed',actionId:'fixture-feed-eat',toyId:null},activeAgeMs:1500});
        drawFixture('home-feed-lick',{timeMs:0,activeAction:{kind:'feed',actionId:'fixture-feed-lick',toyId:null},activeAgeMs:3700});
        drawFixture('home-play-carry',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-carry',toyId:'starterBall'}});
        drawFixture('home-play-retrieve',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-retrieve',toyId:'starterBall'},activeAgeMs:1600});
        drawFixture('home-play-turn',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-turn',toyId:'starterBall'},activeAgeMs:2800});
        drawFixture('home-play-return',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-return',toyId:'starterBall'},activeAgeMs:3500});
        drawFixture('home-play-jumpCatch',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-jump',toyId:'frisbee'},activeAgeMs:2800});
        drawFixture('home-play-tug',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-tug',toyId:'rope'},activeAgeMs:1200});
        drawFixture('home-play-plushShake',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-shake',toyId:'plush'},activeAgeMs:1000});
        drawFixture('home-play-plushCuddle',{timeMs:0,activeAction:{kind:'play',actionId:'fixture-play-cuddle',toyId:'plush'},activeAgeMs:3000});

        const findToyPixels=(ageMs,label)=>{
          currentFixture=label;liveDog.resetPose('home');
          const save=createInitialSave();save.saveGeneration=`toy-${++fixtureIndex}`;save.activeAction={kind:'play',actionId:`toy-${ageMs}`,toyId:'starterBall'};
          const scene=new HomeScene(renderer);scene.draw(save,0);
          if(ageMs>0){save.raisingClockMs=ageMs;scene.draw(save,0);}
          const point=liveDog.lastDraw?.landmarks?.mouth,pixels=capture();
          if(!point)return{ageMs,ok:false,reason:'missing rendered mouth landmark'};
          const centerX=Math.round(point.x*dprX),centerY=Math.round(point.y*dprY),radius=Math.round(18*Math.min(dprX,dprY));
          let count=0,sumX=0,sumY=0;
          for(let y=Math.max(0,centerY-radius);y<=Math.min(pixels.height-1,centerY+radius);y++)for(let x=Math.max(0,centerX-radius);x<=Math.min(pixels.width-1,centerX+radius);x++){
            if((x-centerX)**2+(y-centerY)**2>radius*radius)continue;
            const i=(y*pixels.width+x)*4,d=pixels.data;
            if(Math.abs(d[i]-207)<=3&&Math.abs(d[i+1]-120)<=3&&Math.abs(d[i+2]-91)<=3){count++;sumX+=x;sumY+=y;}
          }
          const centroid=count?{x:sumX/count/dprX,y:sumY/count/dprY}:null;
          return{ageMs,ok:count>=6&&centroid&&Math.hypot(centroid.x-point.x,centroid.y-point.y)<=3,landmark:{x:point.x,y:point.y},toyPixelCount:count,toyCentroid:centroid,distanceCss:centroid?Math.hypot(centroid.x-point.x,centroid.y-point.y):null};
        };
        const toyChecks=[findToyPixels(0,'home-toy-mouth-start'),findToyPixels(3800,'home-toy-mouth-return')];

        const dogIdentity=liveDog;
        renderer.frontDog(renderer.width*.5,renderer.height*.48,1,.4,'idle');
        renderer.runner(renderer.width*.5,renderer.height*.78,1,{phase:1,timeMs:1000,distance:0,speed:1,move:null,state:'running',fallElapsedMs:0});
        const homeControllerCalls=actionCalls.filter(call=>call.controllerId==='home');
        const rendererCalls=actionCalls.slice(-2);
        const controllerSummary={
          home:{drawCount:homeControllerCalls.length,allCallsUseRendererLiveDog:homeControllerCalls.length>0&&homeControllerCalls.every(call=>call.sameLiveDogInstance)},
          result:rendererCalls.find(call=>call.controllerId==='result')??null,
          run:rendererCalls.find(call=>call.controllerId==='run')??null,
          allUseSameInstance:dogIdentity===liveDog&&homeControllerCalls.length>0&&homeControllerCalls.every(call=>call.sameLiveDogInstance)&&rendererCalls.length===2&&rendererCalls.every(call=>call.ok&&call.sameLiveDogInstance),
        };
        const reached=[...new Set(actionCalls.filter(call=>call.ok).map(call=>call.action).filter(Boolean))];
        const reachedBehaviors=expectedBehaviors.filter(action=>reached.includes(action));
        const missingBehaviors=expectedBehaviors.filter(action=>!reached.includes(action));
        return{
          fixture:{width:renderer.width,height:renderer.height,dprX,dprY,modelVersion:liveDog.model?.modelVersion??null,triangleCount:liveDog.model?.triangleCount??null},
          houseChecks,
          toyChecks,
          controllerSummary,
          actionCoverage:{source:'production HomeScene state/time fixtures plus production Renderer.frontDog/runner calls',expectedCount:expectedBehaviors.length,reachedCount:reachedBehaviors.length,reachedBehaviors,missingBehaviors,fixtures:actionCalls.filter(call=>call.ok).map(({fixture,controllerId,action})=>({fixture,controllerId,action})),complete:missingBehaviors.length===0},
          errors:actionCalls.filter(call=>!call.ok),
        };
      }finally{
        renderer?.observer?.disconnect();
        fixture.remove();
        detached.sort((a,b)=>a.depth-b.depth);
        for(const item of detached){if(item.parent)item.parent.insertBefore(item.node,item.next?.parentNode===item.parent?item.next:null);}
      }
    },DOG_BEHAVIORS);
    const checks={
      houseInsideOcclusion:{status:result.houseChecks.length===5&&result.houseChecks.every(check=>check.outsidePixels===0&&check.changedPixels>0&&check.faceVisible),levels:result.houseChecks},
      heldToyTracksRenderedMouth:{status:result.toyChecks.length===2&&result.toyChecks.every(check=>check.ok),samples:result.toyChecks},
      sharedLiveDogAcrossHomeRunResult:{status:result.controllerSummary.allUseSameInstance&&result.controllerSummary.result?.action==='idle'&&result.controllerSummary.run?.action==='run',details:result.controllerSummary},
      actionReachabilityFixture:{status:result.actionCoverage.complete?'PASS':'PARTIAL',...result.actionCoverage},
      productionDrawErrors:{status:result.errors.length===0,errors:result.errors},
    };
    const engineResult={engine:engine.name(),checks,fixture:result.fixture};
    report.engines.push(engineResult);
    for(const [name,check]of Object.entries(checks))report.checks.push({engine:engine.name(),name,...check});
  }catch(error){
    report.errors.push(`${engine.name()}: ${error instanceof Error?error.stack:error}`);
  }finally{await browser?.close();}
}
const requiredFailures=report.checks.filter(check=>check.name!=='actionReachabilityFixture'&&check.status!==true);
report.status=report.errors.length===0&&requiredFailures.length===0?'PASS':'FAIL';
report.actionCoverageStatus=report.engines.every(engine=>engine.checks.actionReachabilityFixture.status==='PASS')?'PASS':'PARTIAL';
await writeFile('test-results/home-scene-browser-results.json',JSON.stringify(report,null,2));
assert.equal(report.status,'PASS',`Home scene browser checks failed: ${JSON.stringify({errors:report.errors,failed:requiredFailures})}`);
console.log(JSON.stringify({status:report.status,actionCoverageStatus:report.actionCoverageStatus,engines:report.engines.map(engine=>({engine:engine.engine,house:engine.checks.houseInsideOcclusion.status,toy:engine.checks.heldToyTracksRenderedMouth.status,sharedRenderer:engine.checks.sharedLiveDogAcrossHomeRunResult.status,actions:`${engine.checks.actionReachabilityFixture.reachedCount}/${engine.checks.actionReachabilityFixture.expectedCount}`}))}));
