import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4173';
const output = new URL('../test-results/', import.meta.url); await mkdir(output, {recursive:true});
const artifact = name => fileURLToPath(new URL(name, output));
const checks=[], errors=[], evidence={};
const watch = p => p.on('pageerror', e => errors.push(e.message));
async function start(p, sound = false) { if (!sound) await p.getByRole('button', {name:'音：オン', exact:true}).click(); await p.getByRole('button',{name:'タップしてスタート'}).click(); await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running'); }
async function fullRoute(p) {
  return p.evaluate(()=> {
    const {game:g,log}=window.__dogBoneTest;
    for(const bone of g.bones) { if(g.lane===bone.lane)continue; g.advance(bone.distance*1000-300-g.timeMs); g.command(Math.sign(bone.lane-g.lane)); g.advance(200); }
    g.advance(70_000); return {result:g.result(), contacts:log.events.filter(e=>e.type==='obstacle_contact')};
  });
}
async function die(p, warningWidth) {
  const warning = await p.evaluate(()=> {
    const {game:g,renderer}=window.__dogBoneTest, hole=g.obstacles.find(o=>o.type==='hole');
    g.advance(Math.max(0,(hole.distance-1.26)*1000-g.timeMs));
    while(g.lane!==hole.lane && g.state==='running') {g.command(Math.sign(hole.lane-g.lane));g.advance(200);}
    renderer.draw(g);
    const f=renderer.obstacleFootprint(hole.lane,hole.distance-g.distance);
    return {secondsBeforeContact:hole.distance-g.distance-.16,width:f.width,height:f.height};
  });
  if(warningWidth) {
    assert.ok(warning.secondsBeforeContact>=.9-1e-6);assert.ok(warning.width>30&&warning.height>15);
    await p.screenshot({path:artifact(`phase3-warning-${warningWidth}.png`)});
    evidence[`warning${warningWidth}`]=warning;
  }
  return p.evaluate(()=> {const g=window.__dogBoneTest.game;g.advance(2000);return g.result();});
}
const browser=await chromium.launch({headless:true});
try {
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[768,1024],[1280,900]]) {
    const c=await browser.newContext({viewport:{width,height},hasTouch:width<500,isMobile:width<500});const p=await c.newPage();watch(p);
    await p.clock.install(); await p.goto(`${base}/?phase=3&test=1&seed=42`);
    const oldRecord={version:1,highScore:9876,maxCombo:60};
    await p.evaluate(record=>localStorage.setItem('dog-bone-run:record:phase2-walk2-v1',JSON.stringify(record)),oldRecord);
    await start(p);
    const completed=await fullRoute(p); assert.equal(completed.result.completed,true);assert.equal(completed.result.collected,65);assert.equal(completed.contacts.length,0);
    assert.equal(await p.locator('#result-time-label').textContent(),'クリア時間');
    const durable=await p.evaluate(()=>JSON.parse(localStorage.getItem('dog-bone-run:record:phase3-walk3-v1')));assert.equal(durable.highScore,completed.result.score);
    assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('dog-bone-run:record:phase2-walk2-v1'))),oldRecord);
    await p.getByRole('button',{name:'もう一度',exact:true}).click(); await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
    const death=await die(p,[320,390].includes(width)?width:undefined);assert.equal(death.completed,false);assert.equal(await p.locator('#game').getAttribute('data-state'),'falling');
    await p.clock.runFor(250); assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.timeMs),death.timeMs);
    if(width===390)await p.screenshot({path:artifact('phase3-falling.png')});
    await p.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.pausedFrom),'falling');
    const frozen=await p.evaluate(()=>[window.__dogBoneTest.game.fallElapsedMs,window.__dogBoneTest.game.timeMs,window.__dogBoneTest.game.distance]);
    await p.clock.runFor(2000);assert.deepEqual(await p.evaluate(()=>[window.__dogBoneTest.game.fallElapsedMs,window.__dogBoneTest.game.timeMs,window.__dogBoneTest.game.distance]),frozen);
    await p.getByRole('button',{name:'再開する',exact:true}).click();await p.clock.runFor(750);
    assert.equal(await p.locator('#game').getAttribute('data-state'),'result');assert.equal(await p.locator('#result-time-label').textContent(),'到達率');
    assert.equal(await p.locator('#result-time').textContent(),`${Math.floor(death.progress*100)}%`);
    assert.doesNotMatch(await p.locator('#record-status').textContent(),/ベスト|自己ベスト|差/);
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('dog-bone-run:record:phase3-walk3-v1')).highScore),durable.highScore);
    const bounds=await p.evaluate(()=>[...document.querySelectorAll('#result p,#result h2,#result button')].filter(e=>e.getClientRects().length).map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,text:e.textContent})));
    assert.ok(bounds.every(b=>b.top>=0&&b.bottom<=height+1),JSON.stringify(bounds));
    if([320,390,1280].includes(width))await p.screenshot({path:artifact(`phase3-gameover-${width}.png`)});
    checks.push(`complete/death/frozen interrupted fall/arrival/result ${width}×${height}`);
    if(width===390)evidence.death=death;
    await c.close();
  }
  const c=await browser.newContext({viewport:{width:390,height:844}});const p=await c.newPage();watch(p);await p.clock.install();await p.goto(`${base}/?phase=3&test=1&seed=42`);await start(p,true);
  for(let i=0;i<21;i++){
    if(i){await p.getByRole('button',{name:'もう一度',exact:true}).click();await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running');}
    const fresh=await p.evaluate(()=>{const g=window.__dogBoneTest.game;return {fall:g.fall,reason:g.endReason,score:g.score,fallMs:g.fallElapsedMs};});assert.deepEqual(fresh,{fall:null,reason:null,score:0,fallMs:0});
    await die(p);await p.clock.runFor(800);assert.equal(await p.locator('#game').getAttribute('data-state'),'result');
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.voices.size),0);
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.musicRunning),false);
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.contextCount),1);
  }
  const log=await p.evaluate(()=>window.__dogBoneTest.log.snapshot());assert.equal(log.sessions.flatMap(s=>s.runs).length,21);
  for(const s of log.sessions)for(const r of s.runs){const times=log.events.filter(e=>e.runId===r.id).map(e=>e.activeMs);assert.deepEqual(times,[...times].sort((a,b)=>a-b));assert.equal(r.phase,3);assert.equal(r.ruleVersion,'phase3-walk3-v1');assert.equal(r.result.completed,false);}
  const store=await p.evaluate(()=>JSON.parse(localStorage.getItem('dog-bone-run:record:phase3-walk3-v1')));assert.equal(store.highScore,0);assert.ok(store.maxCombo>=1);
  await writeFile(artifact('phase3-browser-log.json'),JSON.stringify(log,null,2));checks.push('21 fatal runs:one-tap retry/reset, deaths save combo only, ordered logs, music stopped, one audio context');await c.close();
  const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const rp=await reduced.newPage();watch(rp);await rp.clock.install();await rp.goto(`${base}/?phase=3&test=1&seed=42`);await start(rp);await die(rp);await rp.clock.runFor(800);assert.equal(await rp.locator('#game').getAttribute('data-state'),'result');assert.equal(await rp.evaluate(()=>window.__dogBoneTest.renderer.reducedMotion),true);checks.push('reduced motion fatal presentation reaches result');await reduced.close();
}finally{await browser.close();}
const safari=await webkit.launch({headless:true});
try{
  const c=await safari.newContext({viewport:{width:390,height:844},hasTouch:true});const p=await c.newPage();watch(p);await p.clock.install();await p.goto(`${base}/?phase=3&test=1&seed=42`);await start(p);await die(p);await p.clock.runFor(800);assert.equal(await p.locator('#game').getAttribute('data-state'),'result');await p.screenshot({path:artifact('phase3-webkit-gameover.png')});await p.getByRole('button',{name:'もう一度',exact:true}).tap();assert.equal(await p.locator('#game').getAttribute('data-state'),'running');const run=await fullRoute(p);assert.equal(run.result.completed,true);checks.push('desktopWebKit death/result/touch retry/complete');
}finally{await safari.close();}
assert.deepEqual(errors,[]);await writeFile(artifact('phase3-browser-results.json'),JSON.stringify({checks,errors,evidence},null,2));console.log(JSON.stringify({checks,errors,evidence},null,2));
