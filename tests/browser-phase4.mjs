import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOG_TEST_URL || 'http://127.0.0.1:4173';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, {recursive:true});
const artifact = name => fileURLToPath(new URL(name,output));
const checks=[], errors=[], evidence={};
const watch=p=>p.on('pageerror',e=>errors.push(e.message));
async function load(p) {
  watch(p); await p.goto(`${base}/?test=1&seed=42`); await p.waitForLoadState('networkidle');
  assert.equal(await p.locator('#game').getAttribute('data-presentation-phase'),'4');
  await p.waitForFunction(()=>window.__dogBoneTest.renderer.dogs?.stats.ready);
  const stats=await p.evaluate(()=>window.__dogBoneTest.renderer.dogs.stats);
  assert.equal(stats.mode,'photo-reference-sprites');
  assert.ok(stats.triangleCount<=15000);assert.ok(stats.materials<=2);
  assert.ok(stats.textureSizes.length<=3&&stats.textureSizes.every(s=>s[0]<=1024&&s[1]<=1024));
  assert.ok(stats.compressedBytes<=5000000);evidence.spriteStats=stats;
}
async function volume(p,id,value) {
  await p.locator(`#${id}`).evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
}
async function start(p) {
  await p.getByRole('button',{name:'タップしてスタート'}).click();
  await p.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
}
async function onScreen(p,selector,width,height) {
  const boxes=await p.locator(selector).evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  assert.ok(boxes.every(r=>r.x>=0&&r.y>=0&&r.right<=width+1&&r.bottom<=height+1),JSON.stringify(boxes));
}
const browser=await chromium.launch({headless:true});
try {
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[768,1024],[1280,900]]) {
    const c=await browser.newContext({viewport:{width,height},hasTouch:width<500,isMobile:width<500});
    const p=await c.newPage();await p.clock.install();await load(p);
    await onScreen(p,'#ready button',width,height);
    if(width===390)await p.screenshot({path:artifact('phase4-ready-390.png')});
    await p.getByRole('button',{name:'設定を開く',exact:true}).click();
    assert.equal(await p.locator('#settings-panel').getAttribute('aria-modal'),'true');
    assert.equal(await p.locator('#ready').evaluate(e=>e.inert),true);
    await onScreen(p,'#settings-panel button,#settings-panel input',width,height);
    await volume(p,'music-volume',20);await volume(p,'sfx-volume',65);
    await p.getByLabel('動きを控えめにする').check();
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.renderer.reducedMotion),true);
    assert.deepEqual(await p.evaluate(()=>window.__dogBoneTest.audio.volumes),{music:.2,sfx:.65});
    if(width===320)await p.screenshot({path:artifact('phase4-settings-320.png')});
    await p.getByRole('button',{name:'設定を閉じる'}).focus();await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(()=>document.activeElement.id),'music-toggle');
    await p.keyboard.press('Shift+Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'settings-close');
    await p.keyboard.press('Escape');assert.equal(await p.locator('#settings-panel').isVisible(),false);
    assert.equal(await p.evaluate(()=>document.activeElement.id),'ready-settings');
    await start(p);assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.musicRunning),true);
    await p.clock.runFor(450);await p.getByRole('button',{name:'一時停止',exact:true}).click();
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.voices.size),0);
    const time=await p.evaluate(()=>window.__dogBoneTest.game.timeMs);
    await onScreen(p,'#paused button',width,height);
    await p.getByRole('button',{name:'設定を開く',exact:true}).click();
    await p.getByRole('button',{name:'BGM：オン',exact:true}).click();
    await p.getByRole('button',{name:'設定を閉じる'}).click();await p.clock.runFor(2000);
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.timeMs),time);
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.state),'paused');
    await p.getByRole('button',{name:'再開する',exact:true}).click();
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.musicRunning),false);
    await p.evaluate(()=>window.__dogBoneTest.audio.play(2));
    assert.ok(await p.evaluate(()=>[...window.__dogBoneTest.audio.voices].some(v=>v.type==='sfx')));
    await p.getByRole('button',{name:'一時停止',exact:true}).click();
    await p.getByRole('button',{name:'おさんぽをやめる'}).click();
    assert.deepEqual(await p.evaluate(()=>window.__dogBoneTest.audio.volumes),{music:.2,sfx:.65});
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.contextCount),1);
    assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.voices.size),0);
    checks.push(`settings/mix/focus/frozen pause/mute/persistent retry ${width}×${height}`);
    await c.close();
  }
  const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();await load(p);await start(p);
  await p.waitForFunction(()=>window.__dogBoneTest.game.timeMs>=1000);
  evidence.realClockMusic=await p.evaluate(()=>({activeMs:window.__dogBoneTest.game.timeMs,voices:window.__dogBoneTest.audio.voices.size,contexts:window.__dogBoneTest.audio.contextCount,musicRunning:window.__dogBoneTest.audio.musicRunning}));
  assert.ok(evidence.realClockMusic.voices<=3);assert.equal(evidence.realClockMusic.contexts,1);assert.equal(evidence.realClockMusic.musicRunning,true);
  await p.getByRole('button',{name:'一時停止',exact:true}).click();assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.voices.size),0);
  await p.getByRole('button',{name:'設定を開く',exact:true}).click();await p.getByLabel('動きを控えめにする').uncheck();await p.emulateMedia({reducedMotion:'reduce'});
  await p.waitForFunction(()=>window.__dogBoneTest.renderer.reducedMotion);
  assert.equal(await p.evaluate(()=>window.__dogBoneTest.renderer.reducedMotion),true);await p.emulateMedia({reducedMotion:'no-preference'});
  await p.waitForFunction(()=>!window.__dogBoneTest.renderer.reducedMotion);
  assert.equal(await p.evaluate(()=>window.__dogBoneTest.renderer.reducedMotion),false);
  checks.push('real clock music bounded voices and OS reduced motion priority');await c.close();
  const failed=await browser.newContext({viewport:{width:390,height:844}}),fp=await failed.newPage();watch(fp);
  await fp.route('**/art/**',route=>route.abort());await fp.goto(`${base}/?test=1&seed=42`);
  await fp.getByText('犬の絵を読み込めませんでした。再読み込みで戻せます。',{exact:true}).waitFor();
  assert.equal(await fp.getByRole('button',{name:'タップしてスタート'}).isEnabled(),true);
  await start(fp);assert.equal(await fp.evaluate(()=>window.__dogBoneTest.game.state),'running');
  assert.ok(await fp.evaluate(()=>window.__dogBoneTest.log.events.some(e=>e.type==='render_asset_error')));
  checks.push('asset load failure reports fallback and still permits play');await failed.close();
} finally {await browser.close();}
const safari=await webkit.launch({headless:true});
try {
  const c=await safari.newContext({viewport:{width:390,height:844},hasTouch:true});const p=await c.newPage();await load(p);
  await p.getByRole('button',{name:'設定を開く',exact:true}).tap();await volume(p,'music-volume',0);
  await p.getByRole('button',{name:'設定を閉じる'}).tap();await start(p);
  assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.volumes.music),0);
  assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.contextCount),1);
  await p.getByRole('button',{name:'一時停止',exact:true}).tap();assert.equal(await p.evaluate(()=>window.__dogBoneTest.audio.voices.size),0);
  await p.getByRole('button',{name:'再開する',exact:true}).tap();assert.equal(await p.evaluate(()=>window.__dogBoneTest.game.state),'running');
  checks.push('desktop WebKit touch settings / music mix / stop / resume');await c.close();
} finally {await safari.close();}
assert.deepEqual(errors,[]);
await writeFile(artifact('phase4-browser-results.json'),JSON.stringify({checks,errors,evidence},null,2));
console.log(JSON.stringify({checks,errors,evidence},null,2));
