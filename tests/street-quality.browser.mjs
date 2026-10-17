import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const current=process.env.DOG_WALK_URL ?? 'http://127.0.0.1:4195';
const baseline=process.env.DOG_BASELINE_URL ?? 'http://127.0.0.1:4196';
const output=process.env.DOG_QUALITY_OUTPUT ?? 'test-results/walk-v26/round1';
await mkdir(output,{recursive:true});
const report={version:process.env.DOG_COMPARISON_VERSION??'0.26.0',status:'RUNNING',cases:[],errors:[],limitations:['Screenshots are synthetic frozen course fixtures; draw timing is not physical device FPS.']};
const viewports=process.env.DOG_QUICK ? [[390,844]] : [[320,568],[390,844],[430,932],[1280,900]];
const times=process.env.DOG_QUICK ? [0,12000,25000] : [0,5000,12000,20000,25000];
const engines=process.env.DOG_QUICK ? [chromium] : [chromium,webkit];
async function settle(page) {
  await page.evaluate(async()=>{
    const p=window.__walkPreview;
    for(let i=0;i<15;i++) {
      p.renderer.draw(p.game);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if((p.renderer.dogs.stats.hd?.pending??0)===0 && i>=2) break;
    }
    p.renderer.draw(p.game);
  });
}
for(const engine of engines) {
  const browser=await engine.launch({headless:true});
  try {
    for(const [width,height] of viewports) {
      const pages=[];
      for(const [name,url] of [['before',baseline],['after',current]]) {
        const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:width<500,isMobile:width<500});
        const page=await context.newPage();
        page.on('pageerror',e=>report.errors.push(`${name} ${engine.name()}: ${e.message}`));
        await page.goto(`${url}/tests/fixtures/walk-preview.html?seed=42&timeMs=0`,{waitUntil:'networkidle'});
        const ready=await page.evaluate(()=>window.__walkPreview.ready);
        assert.ok(ready.ok,ready.error);
        pages.push({name,context,page});
      }
      for(const timeMs of times) {
        const states=[];
        for(const {name,page} of pages) {
          await page.evaluate(t=>window.__walkPreview.setFixture(t,42),timeMs);
          await settle(page);
          const info=await page.evaluate(()=>window.__walkPreview.diagnostics());
          states.push(info.game);
          assert.equal(info.counts.obstacleContacts,0);
          assert.equal(info.counts.missedBones,0);
          const stem=`${engine.name()}-${width}x${height}-${String(timeMs/1000).padStart(2,'0')}s-${name}`;
          await page.locator('#game').screenshot({path:`${output}/${stem}.png`});
          if(name==='after') {
            assert.ok(info.projection.dog.y>height*.7);
            const frozen=await page.evaluate(()=>{
              const p=window.__walkPreview,c=p.renderer.ctx;
              const a=c.getImageData(0,0,p.renderer.canvas.width,p.renderer.canvas.height).data;
              for(let i=0;i<8;i++)p.renderer.draw(p.game);
              const b=c.getImageData(0,0,p.renderer.canvas.width,p.renderer.canvas.height).data;
              let changes=0, pixels=0, maxDelta=0;
              for(let i=0;i<a.length;i+=4) {
                let changed=false;
                for(let k=0;k<4;k++) {const delta=Math.abs(a[i+k]-b[i+k]);if(delta){changes++;changed=true;}maxDelta=Math.max(maxDelta,delta);}
                if(changed)pixels++;
              }
              return {changes,pixels,maxDelta,totalPixels:p.renderer.canvas.width*p.renderer.canvas.height};
            });
            console.log(JSON.stringify({engine:engine.name(),width,height,timeMs,frozen}));
            assert.ok(frozen.pixels<=Math.ceil(frozen.totalPixels*.00001) && frozen.maxDelta<=8,'Paused street must remain visually still: '+JSON.stringify(frozen));
            report.cases.push({engine:engine.name(),width,height,timeMs,score:info.game.score,contacts:0,frozen,scene:info.renderer.sceneryStats});
          }
        }
        assert.deepEqual(states[1],states[0],'Visual overhaul must preserve the entire game state and course.');
      }
      const after=pages[1].page;
      const timing=await after.evaluate(()=>window.__walkPreview.runDrawBenchmark());
      report.cases.push({engine:engine.name(),width,height,syntheticDrawTiming:timing});
      for(const {context} of pages)await context.close();
    }
    // Optional surface atlas and all historical scenery images may fail safely.
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.route(/\/art\/(?:neighborhood-v24|street-v25|street-v26)\//,r=>r.abort());
    await page.goto(`${current}/tests/fixtures/walk-preview.html?timeMs=12000&seed=42`,{waitUntil:'networkidle'});
    assert.ok((await page.evaluate(()=>window.__walkPreview.ready)).ok);
    await settle(page);
    await page.locator('#game').screenshot({path:`${output}/${engine.name()}-fallback.png`});
    report.cases.push({engine:engine.name(),allStreetImagesFailed:true,scene:(await page.evaluate(()=>window.__walkPreview.diagnostics())).renderer.sceneryStats});
    await context.close();
  } finally {await browser.close();}
}
assert.deepEqual(report.errors,[]);
report.status='PASS';
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,cases:report.cases.length,errors:report.errors}));
