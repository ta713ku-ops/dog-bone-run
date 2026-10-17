import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198';
const out='test-results/contact-v35';await mkdir(out,{recursive:true});
const sourceHashes=Object.fromEntries(await Promise.all(['src/audio.js','src/contact-whine.js','src/pickup-bark.js','src/contact-feedback.js','src/render.js','src/app.js','art/audio/contact-whine.mp3'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={sourceHashes,cases:[],errors:[],limitations:['No physical iPhone speaker or subjective listening validation.']};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  for(const level of [1,2,3,4]){
   const width=level===1?320:level===3?430:390,height=width===320?568:width===430?932:844;
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true});
   await context.addInitScript(()=>localStorage.setItem('dog-bone-run:settings:v1',JSON.stringify({version:1,settings:{soundEnabled:true,musicEnabled:false,musicVolume:0,sfxVolume:.8,reducedMotion:false}})));
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
   await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
   await page.locator('#start').click();await page.locator(`#walk-level-${level}`).click();
   await page.evaluate(level=>{
    const t=window.__dogBoneTest,g=t.game,speed=g.speed;
    const type={1:'litter',2:'puddle',3:'root',4:'caveRock'}[level];
    g.fixedCourse=[{id:'before-contact',distance:11.7*speed,kind:'normal',lane:0}];
    g.fixedObstacles=[{id:'test-contact',type,lane:0,distance:12*speed+.16}];
    window.__contactCalls=[];const voice=t.audio.whine,play=voice.play.bind(voice);
    voice.play=(...args)=>{const ok=play(...args);window.__contactCalls.push({ok,duration:voice._buffer?.duration,bus:args[1]===t.audio.sfxGain});return ok;};
   },level);
   await page.locator('#walk-picker-start').click();
   await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   await page.waitForFunction(()=>window.__dogBoneTest.audio.whine._buffer&&window.__dogBoneTest.audio.bark._buffer);
   const decoded=await page.evaluate(()=>{
    const t=window.__dogBoneTest,b=t.audio.whine._buffer,data=b.getChannelData(0);
    let sum=0,peak=0;for(const v of data){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
    return{duration:b.duration,rms:Math.sqrt(sum/data.length),peak,contexts:t.audio.contextCount,barkDuration:t.audio.bark._buffer.duration,before:window.__contactCalls.length};
   });
   assert.equal(decoded.before,0);assert.equal(decoded.contexts,1);assert.ok(decoded.rms>.01&&decoded.peak<=1);
   assert.ok(decoded.duration>.5&&decoded.duration<1.2);assert.ok(decoded.barkDuration<.5);
   const hit=await page.evaluate(()=>{
    const t=window.__dogBoneTest,g=t.game;g.score=50;
    g.advance(12140-g.timeMs);g.pause('fixture');t.renderer.draw(g,{force:true});
    const e=t.log.events.filter(e=>e.type==='obstacle_contact').at(-1);
    return{event:e,reaction:t.renderer.contactReaction,playing:t.audio.whine.playing,calls:window.__contactCalls,
     score:g.score,speed:g.speed,time:g.timeMs,combo:g.combo,slow:g.slowUntilMs,suppress:g.suppressUntilMs};
   });
   assert.equal(hit.event.points,-10);assert.equal(hit.calls.length,1);assert.equal(hit.calls[0].ok,true);assert.equal(hit.calls[0].bus,true);
   assert.equal(hit.playing,true);assert.equal(hit.reaction.active,true);assert.ok(hit.reaction.flinch>.98);
   assert.equal(hit.score,50);assert.equal(hit.combo,1);assert.equal(hit.slow,0);assert.equal(hit.suppress,0);
   await page.locator('#game').screenshot({path:`${out}/${engine.name()}-level${level}-impact.png`});
   await page.waitForFunction(()=>(window.__dogBoneTest.renderer.dogs.stats.hd?.pending??0)===0);
   const paused=await page.evaluate(()=>{const t=window.__dogBoneTest;t.renderer.draw(t.game);t.renderer.draw(t.game);const a=t.renderer.canvas.toDataURL();for(let i=0;i<3;i++)t.renderer.draw(t.game);return a===t.renderer.canvas.toDataURL();});
   assert.equal(paused,true);
   const reduced=await page.evaluate(()=>{const t=window.__dogBoneTest;t.renderer.setReducedMotion(true);t.renderer.draw(t.game,{force:true});return t.renderer.contactReaction;});
   assert.equal(reduced.active,true);assert.equal(reduced.flinch,0);assert.equal(reduced.alpha,1);
   await page.locator('#game').screenshot({path:`${out}/${engine.name()}-level${level}-reduced.png`});
   const expired=await page.evaluate(()=>{const t=window.__dogBoneTest;t.game.resume();t.game.advance(400);t.game.pause('fixture');t.renderer.draw(t.game,{force:true});t.audio.stop();return{reaction:t.renderer.contactReaction,playing:t.audio.whine.playing};});
   assert.equal(expired.reaction.active,false);assert.equal(expired.playing,false);
   report.cases.push({engine:engine.name(),level,width,decoded,hit,paused,reduced,expired});await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.stack));
  await page.route('**/contact-whine.mp3*',route=>route.abort());
  await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
  await page.locator('#start').click();await page.locator('#walk-picker-start').click();
  await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
  const fallback=await page.evaluate(()=>{const t=window.__dogBoneTest;t.game.pause('fixture');const played=t.audio.playContact();const voice=[...t.audio.voices].find(v=>v.type==='contact');t.audio.setEnabled(false);return{played,fallback:Boolean(voice),playing:t.audio.whine.playing,muted:t.audio.playContact()};});
  assert.deepEqual(fallback,{played:true,fallback:true,playing:false,muted:false});
  report.cases.push({engine:engine.name(),assetFailure:fallback});await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:report.cases.length,errors:report.errors}));
