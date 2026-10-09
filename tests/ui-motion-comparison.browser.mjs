import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
const {webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const out='test-results/ui-redesign-v16';await mkdir(out,{recursive:true});
const files=Object.fromEntries(await Promise.all([['/','index.html'],['/styles.css','styles.css'],['/src/app.js','app.js']].map(async([url,file])=>[url,await readFile(`/private/tmp/dog-ui-v16-before/${file}`,'utf8')])));
const browser=await webkit.launch({headless:true}),results=[];
try{
 for(const variant of ['before','after','after','before']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true}),page=await context.newPage();
  try{
   if(variant==='before')await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;return files[path]?route.fulfill({body:files[path],contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'}):route.continue();});
   await page.goto(`http://127.0.0.1:4182/?test=1&seed=42&v=${CONFIG.buildVersion}`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>__dogBoneTest.renderer.dogs.stats.continuityReady);
   const commands=[];
   for(const action of ['sit','lie','greet']){
    await page.evaluate(()=>{const r=__dogBoneTest.renderer;r.menuElapsedMs=0;r.menuLastFrameNow=null;r.homeClockOffset=0;r.homeInteraction=null;r.homeHeldFrame=null;r.homeStillPose=null;r.lastDrawState='ready';window.__compare={active:true,last:null,intervals:[]};function tick(now){const q=__compare;if(!q.active)return;if(q.last!==null)q.intervals.push(now-q.last);q.last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
    await page.locator('#home-'+action).click();await page.waitForTimeout(4000);
    const data=await page.evaluate(()=>{__compare.active=false;const a=__compare.intervals.sort((a,b)=>a-b),mean=a.reduce((s,n)=>s+n,0)/a.length;return {frames:a.length,meanMs:mean,fps:1000/mean,p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1),busy:__dogBoneTest.renderer.homeBusy,pose:__dogBoneTest.renderer.homeSample};});
    assert.equal(data.busy,false);if(action==='sit'||action==='lie'){assert.equal(data.pose.index,47);assert.equal(data.pose.atlas,action==='sit'?'sitdown':'liedown');}
    commands.push({action,...data});
   }
   results.push({variant,commands});console.log(JSON.stringify({variant,commands:commands.map(({action,fps,p95Ms,maxMs})=>({action,fps,p95Ms,maxMs}))}));
  }finally{await context.close();}
 }
}finally{await browser.close();}
await writeFile(`${out}/motion-comparison.json`,JSON.stringify({version:CONFIG.buildVersion,scope:'WebKit 390x844 DPR2 no video; ABBA same frozen dog, real4s each sit/lie/greet; before UI uses saved HTML/CSS/app',results},null,2));
// Report both averages and tail intervals; this does not erase the stricter
// home-command test's 34ms p95 failures or claim physical-iPhone results.
for(const result of results.filter(r=>r.variant==='after'))for(const command of result.commands)assert.ok(command.fps>=30,JSON.stringify(command));
