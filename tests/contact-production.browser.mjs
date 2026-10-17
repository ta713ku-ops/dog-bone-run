import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const{chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_ORIGIN??'http://127.0.0.1:4199',out=process.env.DOG_CONTACT_PRODUCTION_OUTPUT??'test-results/contact-v35/production';await mkdir(out,{recursive:true});
const report={origin,cases:[],errors:[]};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});
  await context.addInitScript(()=>{
   localStorage.setItem('dog-bone-run:settings:v1',JSON.stringify({version:1,settings:{soundEnabled:true,musicEnabled:false,musicVolume:0,sfxVolume:.8,reducedMotion:false}}));
   window.__observedAudio=[];
   const proto=(window.AudioContext??window.webkitAudioContext).prototype,original=proto.createBufferSource;
   proto.createBufferSource=function(...args){const source=original.apply(this,args),start=source.start,stop=source.stop;
    source.start=function(...args){window.__observedAudio.push({event:'start',duration:this.buffer?.duration});return start.apply(this,args);};
    source.stop=function(...args){window.__observedAudio.push({event:'stop',duration:this.buffer?.duration});return stop.apply(this,args);};return source;};
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
  const failures=[];page.on('response',r=>{if(r.status()>=400)failures.push([r.status(),r.url()]);});
  await page.goto(`${origin}/?v=0.35.0`,{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
  const version=await(await page.request.get(`${origin}/version.json`)).json();assert.equal(version.buildVersion,'0.35.0');
  await page.locator('#start').click();await page.locator('#walk-level-4').click();await page.locator('#walk-picker-start').click();
  await page.locator('#hud').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#announcement').textContent.includes('に接触'),undefined,{timeout:15000});
  await page.locator('#game').screenshot({path:`${out}/${engine.name()}-contact.png`});
  await page.locator('#pause').click();
  const audio=await page.evaluate(()=>window.__observedAudio);
  assert.ok(audio.some(e=>e.event==='start'&&e.duration>.5&&e.duration<1.2),'the real collision plays the whine buffer');
  const remaining=await page.locator('#clock-seconds').textContent();await page.waitForTimeout(200);assert.equal(await page.locator('#clock-seconds').textContent(),remaining);
  await page.locator('#resume').click();await page.locator('#hud').waitFor({state:'visible'});await page.locator('#pause').click();
  assert.deepEqual(failures,[]);report.cases.push({engine:engine.name(),audio,normalBuild:true,realContact:true,pauseResume:true,assetFailures:failures});
  await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
