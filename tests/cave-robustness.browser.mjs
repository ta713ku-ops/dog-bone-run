import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/cave-v34';
await mkdir(out,{recursive:true});const report={cases:[],errors:[]};
for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
    await page.goto(`${origin}/tests/fixtures/cave-preview.html`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__cavePreview?.ready?.ok);
    const loaded=await page.evaluate(()=>window.__cavePreview.renderer.caveScene.art.stats);
    assert.equal(loaded.atlas,'ready');assert.equal(loaded.materials,'ready');assert.equal(loaded.batFrames,3);
    const behavior=await page.evaluate(async()=>{
      const {drawCaveObstacle}=await import('/src/cave-scene.js'),{renderer:r}=window.__cavePreview;
      let calls=0;const original=r.ctx.drawImage;r.ctx.drawImage=function(...args){calls++;return original.apply(this,args);};
      const render=(at,reduced)=>{r.setReducedMotion(reduced);r.ctx.clearRect(0,0,r.width,r.height);drawCaveObstacle(r,{type:'bat'},r.width/2,r.height*.8,1,at);return r.canvas.toDataURL();};
      try{return {changes:render(0,false)!==render(300,false),reducedStable:render(0,true)===render(300,true),spriteCalls:calls};}
      finally{r.ctx.drawImage=original;}
    });assert.equal(behavior.changes,true);assert.equal(behavior.reducedStable,true);assert.ok(behavior.spriteCalls>=4,'decoded bat sprites are actually drawn');
    await page.route('**/art/cave-*/*.png',route=>route.abort());
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__cavePreview?.ready?.ok);
    const fallback=await page.evaluate(()=>{const p=window.__cavePreview;p.setFixture(20000);return {stats:p.renderer.caveScene.art.stats,result:p.game.result()};});
    assert.equal(fallback.stats.atlas,'fallback');assert.equal(fallback.stats.materials,'fallback');assert.equal(fallback.stats.hanging,'fallback');assert.equal(fallback.result.contactCount,0);
    await page.locator('#game').screenshot({path:`${out}/${engine.name()}-fallback.png`});
    await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
    await page.locator('#start').click();await page.locator('#walk-level-4').click();await page.locator('#park-help').click();
    const guide=await page.locator('#cave-guide-examples canvas').evaluateAll(cs=>cs.map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,position:getComputedStyle(c).position,painted:c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((a,i)=>i%4===3&&a>0)};}));
    assert.equal(guide.length,4);assert.ok(guide.every(c=>c.position==='static'&&c.painted));
    assert.ok(guide.slice(1).every((c,i)=>c.left>=guide[i].right),'guide examples do not overlap');
    await page.locator('#park-guide').screenshot({path:`${out}/${engine.name()}-guide-fallback.png`});
    report.cases.push({engine:engine.name(),loaded,behavior,fallback:fallback.stats,guide});await context.close();
  }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/robustness-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
