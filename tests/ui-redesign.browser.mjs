import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {chromium, webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.DOG_RESULTS_DIR||'test-results/ui-redesign-v16';
await mkdir(out,{recursive:true});
const results=[];
const rects=page=>page.evaluate(()=>{
 const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
 return {canvas:box('#scene'),gesture:box('.home-dog-actions'),start:box('#start'),score:box('#score'),clock:box('#clock'),pause:box('#pause'),combo:box('.combo-box'),overflow:document.documentElement.scrollWidth>innerWidth};
});
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  for(const [width,height] of [[320,480],[320,568],[390,844],[430,932],[844,390],[1280,900]]){
   const context=await browser.newContext({viewport:{width,height},hasTouch:width<500,deviceScaleFactor:2});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.clock.runFor(30);
    const normal=await rects(page);
    assert.equal(normal.overflow,false);
    const topCommands=await page.locator('.home-header .home-dog-actions').count()>0;
    if(topCommands){assert.ok(normal.gesture.y>=normal.canvas.y&&normal.gesture.bottom<=normal.canvas.y+normal.canvas.height*.3+1,'commands are above the dog');assert.equal(await page.locator('#title').getAttribute('class'),'sr-only');assert.equal(await page.locator('#home-duration').getAttribute('class'),'departure-meta sr-only');}
    else assert.ok(normal.gesture.y>=normal.canvas.y+normal.canvas.height*.63+13,'gestures must clear dog feet');
    assert.ok(normal.start.bottom<=normal.canvas.bottom+1);
    assert.equal(await page.locator('#ready-record').isVisible(),false);
    assert.equal(await page.evaluate(()=>__dogBoneTest.game.walkDifficulty),undefined);
    assert.equal(await page.locator('#progress-fill').count(),0);
    const targets=await page.locator('#ready button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.id,w:r.width,h:r.height};}));
    assert.ok(targets.every(n=>n.w>=44&&n.h>=44),JSON.stringify(targets));
    await page.screenshot({path:`${out}/${engine.name()}-home-${width}x${height}.png`});
    await page.locator('#home-sit').click();await page.clock.runFor(50);
    assert.equal(await page.locator('#home-sit').getAttribute('aria-busy'),'true');
    assert.equal(await page.locator('#home-sit').getAttribute('aria-pressed'),null);
    await page.clock.runFor(4500);assert.equal(await page.locator('#home-sit').getAttribute('aria-busy'),'false');
    // Resize each rendered text/control to twice its computed size, taking all
    // sizes before mutation so inherited sizes are not accidentally quadrupled.
    await page.evaluate(()=>{
     const texts=[...document.querySelectorAll('#ready h1,#ready .home-eyebrow,#ready button,#ready .departure-label,#ready .departure-meta,#ready .caption')];
     const sizes=texts.map(el=>parseFloat(getComputedStyle(el).fontSize));texts.forEach((el,i)=>el.style.fontSize=`${sizes[i]*2}px`);
    });
    await page.locator('#start').scrollIntoViewIfNeeded();
    const zoom=await rects(page);assert.equal(zoom.overflow,false);assert.ok(zoom.start.bottom<=zoom.canvas.bottom+1);
    const touch=await page.locator('#start').boundingBox();assert.ok(touch.height>=44);
    await page.screenshot({path:`${out}/${engine.name()}-text200-${width}x${height}.png`});
    await page.evaluate(()=>document.querySelectorAll('#ready [style]').forEach(el=>el.removeAttribute('style')));
    await page.locator('#start').click();await page.waitForFunction(()=>__dogBoneTest.game.state==='running');
    const hud=[];
    for(const [combo,score,time] of [[0,0,0],[2,20,1000],[10,100,21000],[50,99999,25000],[0,99999,29000]]){
     await page.evaluate(({combo,score,time})=>{const g=__dogBoneTest.game;g.bones=[];g.obstacles=[];g.combo=combo;g.score=score;g.timeMs=time;},{combo,score,time});
     await page.clock.runFor(20);const state=await rects(page);hud.push(state);
     assert.equal(await page.locator('.combo-box').getAttribute('data-active'),String(combo>=2));
     assert.equal(await page.locator('.combo-box').getAttribute('aria-hidden'),String(combo<2));
     const text=await page.locator('#combo').textContent();assert.ok(!text.includes('×1.0'));if(combo===10)assert.ok(text.includes('×1.2'));
     assert.ok(state.score.right<=state.clock.x-4,JSON.stringify({width,height,combo,state}));
     assert.ok(state.clock.right<=state.pause.x-4);
     assert.equal(state.pause.x,hud[0].pause.x);assert.ok(Math.abs(state.clock.x-hud[0].clock.x)<=.1,'timer remains fixed within subpixel rounding');assert.equal(state.combo.y,hud[0].combo.y);
    }
    assert.equal(await page.locator('#hud').getAttribute('data-urgent'),'true');
    await page.screenshot({path:`${out}/${engine.name()}-walk-${width}x${height}.png`});
    await page.evaluate(()=>{
     const texts=[...document.querySelectorAll('#hud .hud-label,#hud #score,#hud #combo,#hud #combo span,#hud .clock-value,#hud .clock-unit')];
     const sizes=texts.map(el=>parseFloat(getComputedStyle(el).fontSize));texts.forEach((el,i)=>el.style.fontSize=`${sizes[i]*2}px`);
    });
    const hudZoom=await rects(page);assert.equal(hudZoom.overflow,false);
    for(const r of [hudZoom.score,hudZoom.clock,hudZoom.pause])assert.ok(r.x>=hudZoom.canvas.x&&r.right<=hudZoom.canvas.right+1);
    assert.ok(hudZoom.score.bottom<=hudZoom.clock.y+1||hudZoom.score.right<=hudZoom.clock.x-4,'enlarged HUD never overlaps');
    await page.screenshot({path:`${out}/${engine.name()}-hud200-${width}x${height}.png`});
    assert.deepEqual(errors,[]);results.push({engine:engine.name(),width,height,normal,zoom,targets,hud,hudZoom,errors});
   }catch(e){await page.screenshot({path:`${out}/${engine.name()}-failure-${width}x${height}.png`});throw e;}
   finally{await context.close();}
  }
  for(const [name,record,expected] of [['zero',{highScore:0,maxCombo:20},''],['best',{highScore:9007199254740991,maxCombo:50},'自己ベスト 9,007,199,254,740,991点'],['corrupt','invalid','記録を読み込めませんでした。おさんぽは遊べます。']]){
   const context=await browser.newContext({viewport:{width:320,height:480}}),page=await context.newPage();
   try{
    await page.addInitScript(record=>localStorage.setItem('dog-bone-run:record:sprint30-hard-v1',typeof record==='string'?record:JSON.stringify(record)),record);
    await page.goto(`http://127.0.0.1:4182/?test=1&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    assert.equal(await page.locator('#ready-record').textContent(),expected);assert.equal(await page.locator('#ready-record').isVisible(),name!=='zero');
    if(name==='best'&&await page.locator('.home-header .home-dog-actions').count())assert.notEqual(await page.locator('#ready-record').evaluate(el=>getComputedStyle(el).clip),'auto','record retained for screen reader only');
    const bounds=await rects(page);assert.ok(bounds.start.bottom<=bounds.canvas.bottom+1);assert.equal(bounds.overflow,false);
    await page.screenshot({path:`${out}/${engine.name()}-record-${name}.png`});results.push({engine:engine.name(),record:name,expected});
   }finally{await context.close();}
  }
  // A missing animation pack must leave an explained, usable static-image game.
  const fallback=await browser.newContext({viewport:{width:320,height:480}}),fallbackPage=await fallback.newPage();
  try{
   await fallbackPage.route('**/art/dog-*-animated.webp*',route=>route.abort());
   await fallbackPage.goto(`http://127.0.0.1:4182/?test=1&v=${CONFIG.buildVersion}`);
   // Intentionally aborted image requests can leave network-idle bookkeeping
   // pending. Observe the completed fallback and its usable button directly.
   await fallbackPage.waitForFunction(()=>__dogBoneTest?.renderer.dogs.stats.ready&&!document.querySelector('#start').disabled);
   assert.equal(await fallbackPage.locator('#home-sit').isDisabled(),true);
   assert.equal(await fallbackPage.locator('#home-dog-status').getAttribute('data-kind'),'error');
   assert.equal(await fallbackPage.locator('#home-dog-status').getAttribute('class'),'home-dog-status');
   await fallbackPage.locator('#start').scrollIntoViewIfNeeded();assert.equal(await fallbackPage.locator('#start').isEnabled(),true);
   await fallbackPage.screenshot({path:`${out}/${engine.name()}-animation-fallback.png`});results.push({engine:engine.name(),animationFallback:true});
  }finally{await fallback.close();}
 }finally{await browser.close();}
}
await writeFile(`${out}/ui-results.json`,JSON.stringify({version:CONFIG.buildVersion,results,physicalIPhone:false},null,2));
console.log(`UI states passed: ${results.length}`);
