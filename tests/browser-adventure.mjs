import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '../src/config.js';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.DOG_TEST_URL||'http://127.0.0.1:4174';
const output=new URL('../test-results/',import.meta.url);await mkdir(output,{recursive:true});
const artifact=n=>fileURLToPath(new URL(n,output));const errors=[],checks=[],evidence=[];
async function load(p){
 p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-10-04T00:00:00Z')});await p.clock.pauseAt(new Date('2026-10-04T00:00:01Z'));
 await p.goto(`${base}/?test=1&seed=42&v=${CONFIG.buildVersion}`);await p.waitForLoadState('networkidle');await p.waitForFunction(()=>window.__dogBoneTest.renderer.dogs?.stats.ready);await p.clock.runFor(50);
 assert.ok((await p.locator('#build-label').textContent()).includes(CONFIG.buildVersion));
}
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  for(const [w,h] of engine===chromium?[[320,568],[390,844],[1280,900]]:[[390,844]]){
   const p=await browser.newPage({viewport:{width:w,height:h},hasTouch:w<500});await load(p);
   const petBounds=await p.locator('#dog-pet').boundingBox(),copyBounds=await p.locator('#build-label').boundingBox(),startBounds=await p.locator('#start').boundingBox();
   assert.ok(petBounds.y>copyBounds.y+copyBounds.height+4,'the dog target must not overlap the home copy');
   assert.ok(petBounds.y+petBounds.height<startBounds.y,'the dog target must not overlap start');
   const before=await p.evaluate(()=>JSON.stringify(window.__dogBoneTest.game.result()));
   const poses=new Set();
   for(const time of [50,3000,6000,6500,12700,26600,33800,48700]){
    const current=await p.evaluate(()=>performance.now()-window.__dogBoneTest.renderer.menuEnteredAt);
    await p.clock.fastForward(Math.max(0,time-current));await p.clock.runFor(34);
    const pose=await p.evaluate(()=>window.__dogBoneTest.renderer.menuPose.action);
    if(time<=6000)assert.equal(pose,'idle','a relaxed dog does not switch body images every half-second');
    poses.add(pose);
   }
   assert.ok(poses.size>=5,JSON.stringify([...poses]));
   assert.equal(await p.evaluate(()=>JSON.stringify(window.__dogBoneTest.game.result())),before);
   await p.getByRole('button',{name:'犬をなでる',exact:true}).click();await p.clock.runFor(230);
   const pet=await p.evaluate(()=>({motion:window.__dogBoneTest.renderer.menuPose,state:window.__dogBoneTest.game.state}));
   assert.equal(pet.state,'ready');assert.equal(pet.motion.accent,'tap');assert.ok(pet.motion.lift>0);
   const petStart=await p.evaluate(()=>window.__dogBoneTest.renderer.petStartedAt);
   await p.getByRole('button',{name:'犬をなでる',exact:true}).click();
   assert.equal(await p.evaluate(()=>window.__dogBoneTest.renderer.petStartedAt),petStart,'repeated taps must not restart the dog midway through its gesture');
   await p.screenshot({path:artifact(`adventure-home-${engine.name()}-${w}.png`)});
   await p.clock.runFor(1700);assert.equal(await p.evaluate(()=>window.__dogBoneTest.renderer.menuPose.accent),null);
   // User reduced motion suppresses dog/scene motion. Fixed-time pixel comparison includes the whole canvas.
   await p.getByRole('button',{name:'設定を開く',exact:true}).click();await p.locator('#reduce-motion').check();await p.getByRole('button',{name:'設定を閉じる',exact:true}).click();await p.clock.runFor(50);
   const still=await p.locator('#scene').evaluate(c=>c.toDataURL());await p.clock.runFor(3000);
   assert.equal(await p.locator('#scene').evaluate(c=>c.toDataURL()),still);
   await p.getByRole('button',{name:'犬をなでる',exact:true}).click();await p.clock.runFor(250);assert.equal(await p.locator('#scene').evaluate(c=>c.toDataURL()),still);
   await p.getByRole('button',{name:'設定を開く',exact:true}).click();await p.locator('#reduce-motion').uncheck();await p.getByRole('button',{name:'設定を閉じる',exact:true}).click();
   await p.getByRole('button',{name:'音：オン',exact:true}).click();await p.getByRole('button',{name:'タップしてスタート'}).click();
   await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
   // Safe empty fixture lets each scenic stage be viewed without a forced hazard collision.
   await p.evaluate(()=>{const g=window.__dogBoneTest.game;g.bones=[];g.obstacles=[];});
   let prev=0;
   for(const [at,title] of [[2500,'家並みの道'],[13500,'庭木のある通り'],[23500,'塀沿いの道']]){
    await p.clock.runFor(at-prev);prev=at;assert.equal(await p.locator('#trail-label').textContent(),title);
    const projection=await p.evaluate(()=>{const r=window.__dogBoneTest.renderer;return {width:r.width,foot:[-1,0,1].map(l=>r.project(l,0).x),far:r.project(0,3.2).x};});
    for(const [index,lane] of [-1,0,1].entries())assert.ok(Math.abs(projection.foot[index]-projection.width*(.5+lane*.235))<.001);
    assert.ok(Math.abs(projection.far-projection.width*.5)<=projection.width*.095+.001);
    assert.ok(Math.abs(projection.far-projection.width*.5)>.01,'the distant trail bends while the physical foot lanes stay fixed');
    await p.screenshot({path:artifact(`adventure-path-${engine.name()}-${w}-${at}.png`)});
   }
   await p.getByRole('button',{name:'一時停止',exact:true}).click();await p.clock.runFor(50);const frozen=await p.locator('#scene').evaluate(c=>c.toDataURL());
   await p.clock.runFor(3000);assert.equal(await p.locator('#scene').evaluate(c=>c.toDataURL()),frozen);
   await p.getByRole('button',{name:'再開する',exact:true}).click();await p.clock.runFor(6600);
   assert.equal(await p.locator('#game').getAttribute('data-state'),'result');assert.equal(await p.locator('#result-time').textContent(),'30.00秒');
   checks.push(`${engine.name()} ${w}x${h}: varied home gestures, pet reaction, reduced-motion still, 3 scenes, paused scene frozen, 30s result`);
   evidence.push({engine:engine.name(),w,h,poses:[...poses],pet});await p.close();
  }
  const p=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await load(p);
  const a=await p.locator('#scene').evaluate(c=>c.toDataURL());await p.clock.runFor(5000);assert.equal(await p.locator('#scene').evaluate(c=>c.toDataURL()),a);await p.close();checks.push(`${engine.name()}: OS reduced-motion freezes the whole home canvas`);
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await writeFile(artifact('adventure-browser-results.json'),JSON.stringify({checks,errors,evidence},null,2));console.log(JSON.stringify({checks,errors,evidence},null,2));
