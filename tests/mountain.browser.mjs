import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectStreet } from '../src/street-camera.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198';
const out=process.env.DOG_MOUNTAIN_OUTPUT??'test-results/mountain-v32';
await mkdir(out,{recursive:true});
const sourceHashes=Object.fromEntries(await Promise.all(['src/mountain-course.js','src/mountain-scene.js','src/mountain-nature-art.js','src/mountain-wildlife.js','art/mountain-v32/nature-atlas.png','art/mountain-v32/wildlife-atlas.png','art/mountain-v32/ground-atlas.png','art/mountain-v32/hazard-atlas.png','src/game.js','src/render.js'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={checkedAt:new Date().toISOString(),sourceHashes,cases:[],errors:[],limitations:['Desktop Chromium/WebKit, not physical iPhone Safari or human perceived difficulty.']};
const captureErrors=(page,engine)=>page.on('pageerror',error=>report.errors.push({engine,message:error.stack}));

for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
    if(!process.argv.includes('--motion-only')) for(const [width,height] of [[320,568],[390,844],[430,932],[1280,900]]){
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:width<500,hasTouch:width<500});
      const page=await context.newPage();captureErrors(page,engine.name());
      await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
      await page.locator('#start').click();await page.locator('#walk-level-3').click();
      assert.equal(await page.locator('#walk-level-3').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#walk-selected-3').isVisible(),true);
      assert.match(await page.locator('#walk-picker-start').textContent(),/難易度３/);
      assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.walkLevel),3);
      await page.locator('#walk-picker').screenshot({path:`${out}/${engine.name()}-${width}-picker.png`});
      const geometry=await page.evaluate(()=>{
        const choice=document.querySelector('.walk-choice'),modal=document.querySelector('.walk-picker-modal');
        const boxes=[...choice.querySelectorAll('button')].map(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height};});
        const m=modal.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth||choice.scrollWidth>choice.clientWidth,visible:m.top>=0&&m.bottom<=innerHeight,boxes};
      });
      assert.equal(geometry.overflow,false);assert.equal(geometry.visible,true);
      assert.ok(geometry.boxes.every(b=>b.width>=44&&b.height>=44));
      await page.locator('#park-help').click();
      assert.match(await page.locator('#park-guide').textContent(),/木の根・岩・倒木/);
      assert.match(await page.locator('#park-guide').textContent(),/転がる石/);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'park-help');
      await page.reload({waitUntil:'networkidle'});
      await page.waitForFunction(()=>window.__dogBoneTest?.game.walkLevel===3);
      report.cases.push({engine:engine.name(),width,height,flow:true,geometry});

      await page.goto(`${origin}/tests/fixtures/mountain-preview.html`,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>window.__mountainPreview?.ready);
      assert.deepEqual(await page.evaluate(()=>window.__mountainPreview.ready),{ok:true});
      for(const timeMs of [4000,12000,20000,27000]){
        const result=await page.evaluate(at=>window.__mountainPreview.setFixture(at),timeMs);
        assert.equal(result.contactCount,0);
        await page.waitForFunction(()=>(window.__mountainPreview.renderer.dogs?.stats.hd?.pending??0)===0);
        await page.evaluate(()=>{const p=window.__mountainPreview;p.renderer.draw(p.game,{force:true});});
        await page.locator('#game').screenshot({path:`${out}/${engine.name()}-${width}-${timeMs}.png`});
        const stats=await page.evaluate(()=>window.__mountainPreview.renderer.mountainScene.stats);
        assert.ok(stats.landmarks.length>0);
        const frozen=await page.evaluate(()=>{
          const {renderer:r,game:g}=window.__mountainPreview;
          const a=r.canvas.toDataURL();for(let i=0;i<3;i++)r.draw(g);return a===r.canvas.toDataURL();
        });assert.equal(frozen,true);
        report.cases.push({engine:engine.name(),width,height,timeMs,stage:stats.stage,landmarkCount:stats.landmarks.length,frozen});
      }
      const reduced=await page.evaluate(()=>window.__mountainPreview.setFixture(20000,42,true));
      assert.equal(reduced.contactCount,0);
      await page.locator('#game').screenshot({path:`${out}/${engine.name()}-${width}-reduced.png`});
      await context.close();
    }
    if(!process.argv.includes('--motion-only')){
      const natureContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
      const naturePage=await natureContext.newPage();captureErrors(naturePage,engine.name());
      await naturePage.goto(`${origin}/tests/fixtures/mountain-preview.html`,{waitUntil:'networkidle'});
      await naturePage.waitForFunction(()=>window.__mountainPreview?.ready?.ok);
      const loaded=await naturePage.evaluate(()=>window.__mountainPreview.renderer.mountainScene.art.stats);
      for(const key of ['props','animals','ground','hazards'])assert.equal(loaded[key],'ready',`${key} decoded`);
      const behavior=await naturePage.evaluate(async()=>{
        const {drawMountainWildlife}=await import('/src/mountain-wildlife.js');
        const {renderer:r}=window.__mountainPreview,object={kind:'deer',lane:0,width:1.62,height:2.08,elevation:0,animationOffset:0};
        const render=(time,reduced)=>{r.ctx.clearRect(0,0,r.width,r.height);r.setReducedMotion(reduced);
          drawMountainWildlife(r,object,2,time,r.mountainScene.art);return r.canvas.toDataURL();};
        return {changes:render(0,false)!==render(4500,false),reducedStable:render(0,true)===render(4500,true),sameTimeStable:render(3200,false)===render(3200,false)};
      });
      assert.deepEqual(behavior,{changes:true,reducedStable:true,sameTimeStable:true});
      await naturePage.route('**/art/mountain-v32/*.png',route=>route.abort());
      await naturePage.reload({waitUntil:'networkidle'});await naturePage.waitForFunction(()=>window.__mountainPreview?.ready?.ok);
      const fallback=await naturePage.evaluate(()=>window.__mountainPreview.renderer.mountainScene.art.stats);
      for(const key of ['props','animals','ground','hazards'])assert.equal(fallback[key],'fallback');
      await naturePage.locator('#game').screenshot({path:`${out}/${engine.name()}-nature-fallback.png`});
      report.cases.push({engine:engine.name(),nature:true,loaded,behavior,fallback});
      await natureContext.close();
    }
    if(process.argv.includes('--screens-only'))continue;

    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:`${out}/videos`,size:{width:390,height:844}}});
    await context.addInitScript(()=>localStorage.setItem('dog-bone-run:settings:v1',JSON.stringify({version:1,settings:{soundEnabled:false,musicEnabled:true,musicVolume:.35,sfxVolume:.8,reducedMotion:false}})));
    const page=await context.newPage();captureErrors(page,engine.name());const video=page.video();
    await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
    await page.locator('#start').click();await page.locator('#walk-level-3').click();
    await page.evaluate(()=>{
      const r=window.__dogBoneTest.renderer,draw=r.draw.bind(r);let next=0,previous=null;
      window.__mountainMotion={trace:[],intervals:[]};
      r.draw=function(g,options){
        const result=draw(g,options),m=window.__mountainMotion;
        if(g.state==='running'){
          const now=performance.now();if(previous!==null&&g.timeMs>1000)m.intervals.push(now-previous);previous=now;
          if(g.timeMs>=next){m.trace.push({timeMs:g.timeMs,travel:r.worldDistance(g),width:r.width,height:r.height,
            stage:r.mountainScene.stats.stage,landmarks:r.mountainScene.stats.landmarks,obstacles:r.mountainObjects});next+=100;}
        }
        return result;
      };
    });
    await page.locator('#walk-picker-start').click();
    await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
    const inputs=await page.evaluate(()=>window.__dogBoneTest.game.courseData.safeInputs);
    // Drive the existing DOM keyboard recognizer within the page. This avoids
    // Node/video protocol delays. A 20ms lead keeps arrival inside the verified
    // ±40ms course window even when a paint occupies one browser frame.
    // Trusted keyboard and pointer input are also
    // exercised independently in the production build test.
    await page.evaluate(()=>{
      const t=window.__dogBoneTest,inputs=t.game.courseData.safeInputs,canvas=document.querySelector('#scene');
      t.syncTime();
      const clockOrigin=performance.now()-t.game.timeMs;
      let next=0;
      const driver=setInterval(()=>{
        if(t.game.state==='result'){clearInterval(driver);return;}
        if(t.game.state!=='running')return;
        while(next<inputs.length&&performance.now()-clockOrigin>=inputs[next].timeMs-20){
          const key=inputs[next].direction<0?'ArrowLeft':'ArrowRight';
          canvas.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
          window.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true}));next++;
        }
        if(next===inputs.length)clearInterval(driver);
      },4);
    });
    await page.waitForFunction(()=>['result','paused'].includes(window.__dogBoneTest.game.state),undefined,{timeout:40000});
    const evidence=await page.evaluate(()=>({motion:window.__mountainMotion,result:window.__dogBoneTest.game.result(),
      pauses:window.__dogBoneTest.log.events.filter(e=>e.type==='pause'),inputs:window.__dogBoneTest.log.events.filter(e=>e.type==='input'),
      contacts:window.__dogBoneTest.log.events.filter(e=>e.type==='obstacle_contact')}));
    await writeFile(`${out}/${engine.name()}-motion.json`,JSON.stringify(evidence,null,2));
    assert.equal(evidence.result.collected,48);assert.equal(evidence.result.goldCollected,3);
    assert.equal(evidence.result.contactCount,0);assert.equal(evidence.result.timeMs,30000);
    assert.deepEqual(evidence.pauses,[]);
    const keys=evidence.inputs.filter(e=>e.source==='keyboard');assert.equal(keys.length,inputs.length);
    const timing=keys.map((key,i)=>key.activeMs-inputs[i].timeMs);
    assert.ok(timing.every(delta=>Math.abs(delta)<=40),`driver timing ${Math.min(...timing)}..${Math.max(...timing)}`);
    const tracks=new Map();let comparisons=0;
    for(const frame of evidence.motion.trace){
      for(const item of frame.landmarks){
        const expected=projectStreet(frame.width,frame.height,item.lane,item.at-frame.travel,item.elevation??0);
        for(const key of ['x','y','scale'])assert.ok(Math.abs(item[key]-expected[key])<1e-7,`${item.id} ${key} uses shared camera`);
        const prior=tracks.get(item.id)?.at(-1);
        if(prior){
          // A long stream's center can be behind the near plane while its
          // rear bank still approaches. Trace that bank instead of the
          // center, which projectStreet deliberately clamps at -0.82.
          const rear=projectStreet(frame.width,frame.height,item.lane,item.at+item.depth/2-frame.travel,item.elevation??0);
          const previousRear=projectStreet(frame.width,frame.height,prior.lane,prior.at+prior.depth/2-prior.travel,prior.elevation??0);
          assert.ok(item.scale>=prior.scale);assert.ok(item.y>=prior.y);
          if(item.at+item.depth/2-frame.travel>-.82){assert.ok(rear.scale>previousRear.scale);assert.ok(rear.y>previousRear.y);}
          comparisons++;
        }
        if(!tracks.has(item.id))tracks.set(item.id,[]);tracks.get(item.id).push({...item,timeMs:frame.timeMs,travel:frame.travel});
      }
    }
    assert.ok(evidence.motion.trace.length>=280);assert.ok(comparisons>200);
    const passed=[...tracks.values()].filter(track=>track.at(-1).timeMs<28000&&track.length>4);
    assert.ok(passed.length>=5,'multiple real world landmarks approach and pass');
    const sorted=evidence.motion.intervals.slice().sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];
    assert.ok(p95<=33.4,`frame p95 ${p95}`);
    await page.locator('#game').screenshot({path:`${out}/${engine.name()}-result.png`});
    assert.match(await page.locator('#result-level').textContent(),/難易度3.*やま/);
    assert.equal(await page.locator('#result-contacts').textContent(),'0');
    await page.locator('#retry').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
    await page.locator('#pause').click();
    const paused=await page.evaluate(()=>window.__dogBoneTest.game.timeMs);
    await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.timeMs),paused);
    await page.locator('#resume').click();await page.waitForFunction(at=>window.__dogBoneTest.game.timeMs>at,paused);
    await page.locator('#pause').click();await page.locator('#quit').click();
    await page.locator('#start').click();await page.locator('#walk-level-2').click();
    assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.walkLevel),2);
    await page.locator('#walk-level-1').click();assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.walkLevel),1);
    report.cases.push({engine:engine.name(),realTime:true,result:evidence.result,traceFrames:evidence.motion.trace.length,
      comparisons,passed:passed.length,p95,driver:'DOM keyboard events, real time',timing:{min:Math.min(...timing),max:Math.max(...timing)},retryPauseResume:true});
    await context.close();await video.saveAs(`${out}/${engine.name()}-exploration.webm`);
  }finally{await browser.close();}
  console.log(`${engine.name()}: mountain screens and real-time play verified`);
}
assert.deepEqual(report.errors,[]);
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
