import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.DOG_TEST_URL??'http://127.0.0.1:4198';
const out=process.env.DOG_PARK_OUTPUT??'test-results/park-level2';await mkdir(out,{recursive:true});
const report={cases:[],errors:[],limitations:['Desktop engines do not establish physical iPhone results or five-player difficulty ratings.']};
async function load(page,url){page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url,{waitUntil:'networkidle'});}
async function start(page){await page.locator('#start').click();await page.locator('#walk-picker-start').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');}
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  if (!process.argv.includes('--scene-only')) for(const [width,height] of [[320,568],[390,844],[430,932],[1280,900]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:width<500,isMobile:width<500});
   const page=await context.newPage();await load(page,`${base}/?test=1&seed=42`);
   await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
   assert.equal(await page.locator('.walk-choice').isVisible(),false);
   assert.equal(await page.locator('#park-help').isVisible(),false);
   assert.equal(await page.locator('#home-duration').count(),0);
   await page.locator('#start').click();assert.equal(await page.locator('#walk-picker').isVisible(),true);
   assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.timeMs),0);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'walk-picker-title');
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'walk-level-1');
   await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'walk-picker-close');
   await page.keyboard.press('Escape');assert.equal(await page.locator('#walk-picker').isVisible(),false);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'start');
   await page.locator('#start').click();
   assert.equal(await page.locator('#walk-level-1').getAttribute('aria-pressed'),'true');
   await page.locator('#walk-level-2').click();
   assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.walkLevel),2);
   assert.match(await page.locator('#walk-selected-label').textContent(),/２ こうえん/);
   assert.equal(await page.locator('#walk-selected-2').isVisible(),true);
   assert.equal(await page.locator('#walk-selected-1').isVisible(),false);
   const selectedColor=await page.locator('#walk-level-2').evaluate(e=>getComputedStyle(e).backgroundColor);
   await page.locator('#walk-level-2').hover();
   assert.equal(await page.locator('#walk-level-2').evaluate(e=>getComputedStyle(e).backgroundColor),selectedColor);
   assert.match(await page.locator('#walk-picker-start').textContent(),/難易度２/);
   await page.locator('#park-help').click();assert.equal(await page.locator('#park-guide').isVisible(),true);
   assert.match(await page.locator('#park-guide').textContent(),/左右にスワイプ/);
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'park-guide-start');
   await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'park-guide-close');
   await page.locator('#park-guide-close').click();
   assert.equal(await page.evaluate(()=>document.activeElement.id),'park-help');
   assert.deepEqual(await page.evaluate(()=>['ready','scene','walk-picker'].map(id=>document.getElementById(id).inert)),[true,true,false]);
   await page.locator('#walk-picker-close').click();
   assert.equal(await page.locator('#park-help').isVisible(),false);
   await start(page);
   assert.equal(await page.evaluate(()=>window.__dogBoneTest.renderer.parkLevel2Scene.stats.props),'ready','park art must be decoded before the gameplay clock starts');
   assert.equal(await page.locator('#park-guide').isVisible(),false);
   await page.locator('#pause').click();
   const frozen=await page.evaluate(()=>{const t=window.__dogBoneTest;return {time:t.game.timeMs,ball:t.game.obstacles.find(o=>o.type==='ball')};});
   await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.timeMs),frozen.time);
   await page.locator('#resume').click();await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#game').getAttribute('data-state'),'paused');
   await page.locator('#quit').click();
   await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#walk-level-2').getAttribute('aria-pressed'),'true');
   await start(page);await page.evaluate(()=>{
    const t=window.__dogBoneTest;t.game.pause('fixture');t.game.reset({seed:42,walkLevel:2});t.game.start();
    for(const i of t.game.courseData.safeInputs){t.game.advance(i.timeMs-t.game.timeMs);t.game.command(i.direction,'fixture');}t.game.advance(30000-t.game.timeMs);
   });
   assert.equal(await page.locator('#result').isVisible(),true);
   const finish=await page.evaluate(()=>({result:window.__dogBoneTest.game.result(),key:window.__dogBoneTest.records.key,stored:window.__dogBoneTest.records.read()}));
   assert.equal(finish.result.collected,48);assert.equal(finish.result.goldCollected,3);assert.equal(finish.result.contactCount,0);assert.equal(finish.result.timeMs,30000);
   assert.match(finish.key,/park30-level2-v2/);assert.match(await page.locator('#result-bones').textContent(),/48 \/ 48/);assert.equal(await page.locator('#result-gold').textContent(),'3 / 3');
   await page.locator('#game').screenshot({path:`${out}/${engine.name()}-${width}-result.png`});
   await page.locator('#end').click();await page.locator('#start').click();await page.locator('#walk-level-1').click();
   assert.match(await page.evaluate(()=>window.__dogBoneTest.records.key),/sprint30-penalty-v1/);assert.equal(await page.locator('#phase2-gold').isVisible(),false);await page.locator('#walk-picker-close').click();
   await page.locator('#game').screenshot({path:`${out}/${engine.name()}-${width}-home.png`});
   const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth,choice:document.querySelector('.walk-choice').scrollWidth>document.querySelector('.walk-choice').clientWidth}));assert.deepEqual(overflow,{body:false,choice:false});
   report.cases.push({engine:engine.name(),width,height,flow:true,finish});await context.close();
  }
  if (process.argv.includes('--flow')) continue;
  for(const [width,height] of [[320,568],[390,844],[430,932],[1280,900]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});const page=await context.newPage();
   await load(page,`${base}/tests/fixtures/park-preview.html`);await page.waitForFunction(()=>window.__parkPreview.ready);
   assert.ok((await page.evaluate(()=>window.__parkPreview.ready)).ok);
   assert.equal(await page.evaluate(()=>window.__parkPreview.renderer.parkLevel2Scene.stats.sceneryMode),'world-park');
   for(const seed of [42,137])for(const timeMs of [0,5000,12000,20000,27000]){
    const result=await page.evaluate(({timeMs,seed})=>window.__parkPreview.setFixture(timeMs,seed),{timeMs,seed});
    assert.equal(result.contactCount,0);
    await page.evaluate(async()=>{for(let i=0;i<4;i++){window.__parkPreview.renderer.draw(window.__parkPreview.game);await new Promise(r=>requestAnimationFrame(r));}});
    await page.locator('#game').screenshot({path:`${out}/${engine.name()}-${width}-seed${seed}-${timeMs}.png`});
    const freeze=await page.evaluate(()=>{const p=window.__parkPreview,c=p.renderer.ctx,a=c.getImageData(0,0,p.renderer.canvas.width,p.renderer.canvas.height).data;for(let i=0;i<5;i++)p.renderer.draw(p.game);const b=c.getImageData(0,0,p.renderer.canvas.width,p.renderer.canvas.height).data;let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;return changed;});
    assert.equal(freeze,0,'Paused park redraw must be stable');report.cases.push({engine:engine.name(),width,height,seed,timeMs,frozen:freeze});
   }await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  await page.route(/\/art\/park-level2\//,r=>r.abort());await load(page,`${base}/tests/fixtures/park-preview.html?timeMs=20000`);await page.waitForFunction(()=>window.__parkPreview.ready);
  assert.ok((await page.evaluate(()=>window.__parkPreview.ready)).ok);await page.locator('#game').screenshot({path:`${out}/${engine.name()}-fallback.png`});
  assert.equal(await page.evaluate(()=>window.__parkPreview.renderer.parkLevel2Scene.stats.sceneryMode),'world-fallback');
  const reduced=await page.evaluate(()=>window.__parkPreview.setFixture(20000,42,true));assert.equal(reduced.contactCount,0);await page.locator('#game').screenshot({path:`${out}/${engine.name()}-reduced.png`});
  report.cases.push({engine:engine.name(),fallback:true,reduced:true});await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/${process.argv.includes('--flow')?'flow-report':process.argv.includes('--scene-only')?'scene-report':'browser-report'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,errors:report.errors}));
