import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { renderingLaunchOptions } from './browser-rendering.mjs';
const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = 'test-results/home-presence';
await mkdir(out, { recursive: true });
const results = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(renderingLaunchOptions(engine));
  const context = await browser.newContext({ viewport: {width:390,height:844}, deviceScaleFactor:2, hasTouch:true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:4182/?test=1&seed=42');
    await page.waitForFunction(() => Boolean(window.__dogBoneTest));
    await page.evaluate(() => __dogBoneTest.renderer.ready);
    await page.waitForFunction(() => !document.querySelector('#home-touch').disabled && !document.querySelector('#start').disabled);
    const layouts = [];
    for (const [width,height] of [[320,480],[320,568],[390,844],[430,932],[844,390],[1280,800]]) {
      await page.setViewportSize({width,height});
      await page.waitForTimeout(120);
      const layout = await page.evaluate(() => {
        const rect = id => { const r=document.getElementById(id).getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        return {scene:rect('scene'), dog:rect('home-touch'), hint:rect('home-touch-note'), controls:['ready-settings','home-sit','home-lie','home-greet','start'].map(id=>({id,...rect(id)})), overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(layout.overflow,false);
      for (const control of layout.controls) {
        assert.ok(control.width>=44 && control.height>=44,JSON.stringify(control));
        assert.ok(control.y>=0 && control.bottom<=height+1,JSON.stringify({width,height,control}));
        assert.ok(control.right<=width+1 && control.x>=0);
        if(control.id!=='ready-settings') assert.ok(control.y>layout.dog.bottom,JSON.stringify({width,height,layout}));
      }
      assert.ok(layout.hint.bottom<layout.controls.find(c=>c.id==='home-sit').y,JSON.stringify({width,height,layout}));
      layouts.push({width,height,...layout});
      await page.screenshot({path:`${out}/${engine.name()}-${width}x${height}.png`});
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{for(const b of document.querySelectorAll('#ready button')) b.style.fontSize=`${parseFloat(getComputedStyle(b).fontSize)*2}px`;document.querySelector('#ready-record').hidden=false;document.querySelector('#ready-record').textContent='自己ベスト 999,999点';});
    await page.waitForTimeout(100);
    const enlarged = await page.evaluate(()=>{const a=document.querySelector('.start-actions'),b=document.querySelector('#start').getBoundingClientRect();return {overflow:a.scrollHeight>a.clientHeight+1,bottom:b.bottom};});
    assert.equal(enlarged.overflow,false);assert.ok(enlarged.bottom<=844);
    await page.evaluate(()=>{for(const b of document.querySelectorAll('#ready button')) b.style.fontSize='';document.querySelector('#ready-record').hidden=true;});
    const reactions=[];
    for (const [name,time] of [['standing',0],['sitting',25000],['lying',40000],['transition',17500]]) {
      await page.evaluate(time=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=time;r.menuLastFrameNow=null;r.homeClockOffset=0;r.homeInteraction=null;r.homeAttention=null;r.homeHeldFrame=null;},time);
      // Capture the actual input-time layers, not a later automatic sample.
      await page.evaluate(()=>{document.querySelector('#home-touch').addEventListener('click',()=>{window.__tapLayers=structuredClone(__dogBoneTest.renderer.updateHomeSample(__dogBoneTest.renderer.menuElapsedMs).layers);},{once:true,capture:true});});
      await page.locator('#home-touch').tap();
      await page.waitForTimeout(650);
      const response=await page.evaluate(()=>({layers:__dogBoneTest.renderer.homeSample.layers,initial:__tapLayers,lift:__dogBoneTest.renderer.homeSample.headLift,ear:__dogBoneTest.renderer.homeSample.earLeft,busy:__dogBoneTest.renderer.homeBusy,disabled:document.querySelector('#home-touch').disabled}));
      assert.deepEqual(response.layers,response.initial);assert.ok(response.lift>0);assert.equal(response.busy,true);assert.equal(response.disabled,true);
      if(name==='standing') {
        await page.screenshot({path:`${out}/${engine.name()}-response.png`});
        await page.locator('#ready-settings').click();
        await page.waitForTimeout(100);
        const paused=await page.evaluate(()=>__dogBoneTest.renderer.menuElapsedMs);
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(()=>__dogBoneTest.renderer.menuElapsedMs),paused);
        await page.locator('#settings-close').click();
      }
      await page.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy);
      reactions.push({name,...response});
    }
    // Existing explicit posture commands keep their final pose after direct touch.
    await page.locator('#home-lie').click();
    await page.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy);
    const held=await page.evaluate(()=>__dogBoneTest.renderer.homeSample.layers);
    await page.locator('#home-touch').focus();await page.keyboard.press('Enter');
    await page.waitForTimeout(650);
    assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.layers),held);
    await page.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy);
    assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample.layers),held);
    // Verify that the painter changes the head, never the grounded paws.
    const pixels=await page.evaluate(async()=>{
      const {sampleHome}=await import('/src/sprite-animation.js');
      const {sampleHomeAttention}=await import('/src/home-presence.js');
      const d=__dogBoneTest.renderer.dogs,canvas=document.createElement('canvas');canvas.width=canvas.height=384;const c=canvas.getContext('2d',{willReadFrequently:true});
      const paint=s=>{c.clearRect(0,0,384,384);d.draw(c,{x:192,foot:372,size:336,sample:s});return c.getImageData(0,0,384,384).data;};
      return [0,25000,40000].map(t=>{const base=sampleHome(t,{continuousMotion:true,frameCounts:d.stats.homeFrameCounts}),a=paint(base),b=paint(sampleHomeAttention(base,1000));let changed=0,feet=0;for(let p=0;p<384*384;p++)if([0,1,2,3].some(k=>a[p*4+k]!==b[p*4+k])){changed++;if(Math.floor(p/384)>=350)feet++;}return {t,changed,feet};});
    });
    for(const p of pixels){assert.ok(p.changed>500,JSON.stringify(p));assert.equal(p.feet,0,JSON.stringify(p));}
    await page.locator('#ready-settings').click();await page.locator('#reduce-motion').check();await page.locator('#settings-close').click();
    const still=await page.evaluate(()=>__dogBoneTest.renderer.homeSample);
    await page.locator('#home-touch').tap();await page.waitForTimeout(100);
    assert.equal(await page.locator('#home-touch-note').innerText(),'声をかけました');
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample),still);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#ready-settings').click();await page.locator('#reduce-motion').uncheck();await page.locator('#settings-close').click();
    const systemStill=await page.evaluate(()=>__dogBoneTest.renderer.homeSample);
    await page.locator('#home-touch').tap();await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(()=>__dogBoneTest.renderer.homeSample),systemStill);
    await page.emulateMedia({reducedMotion:'no-preference'});
    // A failed optional continuous pack still allows a direct response and departure.
    const fallback=await context.newPage();await fallback.route('**/dog-continuous-liedown.webp',r=>r.abort());
    await fallback.goto('http://127.0.0.1:4182/?test=1');await fallback.waitForFunction(()=>Boolean(window.__dogBoneTest));await fallback.evaluate(()=>__dogBoneTest.renderer.ready);await fallback.waitForFunction(()=>!document.querySelector('#home-touch').disabled && !document.querySelector('#start').disabled);
    assert.equal(await fallback.evaluate(()=>Boolean(__dogBoneTest.renderer.dogs.stats.continuityReady)),false);
    await fallback.locator('#home-touch').tap();await fallback.waitForFunction(()=>__dogBoneTest.renderer.homeBusy);await fallback.waitForFunction(()=>!__dogBoneTest.renderer.homeBusy);await fallback.close();
    await page.goto('http://127.0.0.1:4183/');await page.waitForFunction(()=>!document.querySelector('#home-touch').disabled && !document.querySelector('#start').disabled);
    await page.screenshot({path:`${out}/${engine.name()}-home.png`});
    await page.locator('#home-touch').tap();await page.waitForTimeout(2600);
    await page.locator('#start').click();await page.locator('#walk-picker-start').click();
    const silent=page.locator('#audio-silent');if(await silent.isVisible())await silent.click();
    await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='running');
    await page.locator('#pause').click();await page.locator('#quit').click();
    await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='ready' && !document.querySelector('#home-touch').disabled);
    assert.equal(await page.evaluate(()=>Boolean(window.__dogBoneTest)),false);
    assert.deepEqual(errors,[]);
    results.push({engine:engine.name(),layouts,reactions,pixels,enlarged,productionSmoke:true,errors});
    console.log(JSON.stringify({engine:engine.name(),layouts:layouts.length,reactions:reactions.length,pixels,productionSmoke:true}));
  } catch (error) {
    await page.screenshot({path:`${out}/${engine.name()}-failure.png`});
    throw error;
  } finally {await context.close();await browser.close();}
}
await writeFile(`${out}/results.json`,JSON.stringify({physicalIPhone:false,results},null,2));
