import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_ORIGIN??'http://127.0.0.1:4199';
const out=process.env.DOG_CAVE_PRODUCTION_OUTPUT??'test-results/cave-v34/production';await mkdir(out,{recursive:true});
const report={checkedAt:new Date().toISOString(),cases:[],errors:[]};
for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('dog-bone-run:settings:v1',JSON.stringify({version:1,settings:{soundEnabled:false,musicEnabled:true,musicVolume:.35,sfxVolume:.8,reducedMotion:false}})));
  try{
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${engine.name()}: ${e.stack}`));
    const responses=[];page.on('response',r=>{if(r.status()>=400)responses.push([r.status(),r.url()]);});
    await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
    const version=await (await page.request.get(`${origin}/version.json`)).json();
    assert.equal(version.buildVersion,'0.34.0');assert.equal(version.walkLevels.length,4);
    assert.equal(version.diagnosticBuild,false);
    assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
    assert.equal(await page.locator('#test-panel').count(),0);
    await page.locator('#start').click();await page.locator('#walk-level-4').click();
    await page.locator('#walk-picker-start').click();
    await page.locator('#hud').waitFor({state:'visible'});
    await page.locator('#scene').press('ArrowLeft');
    await page.waitForTimeout(220);await page.locator('#scene').press('ArrowRight');
    await page.waitForTimeout(220);
    const box=await page.locator('#scene').boundingBox();
    await page.mouse.move(box.x+box.width*.5,box.y+box.height*.65);
    await page.mouse.down();await page.mouse.move(box.x+box.width*.5+45,box.y+box.height*.65,{steps:4});await page.mouse.up();
    await page.waitForTimeout(1300);await page.locator('#pause').click();
    const remaining=await page.locator('#clock-seconds').textContent();
    await page.waitForTimeout(300);assert.equal(await page.locator('#clock-seconds').textContent(),remaining);
    assert.equal(await page.locator('#game').getAttribute('data-walk-level'),'4');
    await page.locator('#game').screenshot({path:`${out}/${engine.name()}-paused.png`});
    await page.locator('#resume').click();await page.locator('#hud').waitFor({state:'visible'});
    await page.waitForTimeout(120);await page.locator('#pause').click();await page.locator('#quit').click();
    await page.reload({waitUntil:'networkidle'});await page.locator('#start').click();
    assert.equal(await page.locator('#walk-level-4').getAttribute('aria-pressed'),'true');
    assert.deepEqual(responses,[]);
    report.cases.push({engine:engine.name(),noDiagnostics:true,level4:true,keyboardAndPointer:true,pauseResume:true,choicePersists:true,assetFailures:responses});
  }finally{await context.close();await browser.close();}
}
assert.deepEqual(report.errors,[]);
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
