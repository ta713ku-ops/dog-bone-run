import {confirmDeparture} from './browser-departure.mjs';
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '../src/config.js';
const {chromium, webkit} = await import(process.env.DOG_PLAYWRIGHT_MODULE || 'playwright');
const dev = process.env.DOG_TEST_URL || 'http://127.0.0.1:4182';
const production = process.env.DOG_PRODUCTION_URL || 'http://127.0.0.1:4183';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, {recursive: true});
const artifact = name => fileURLToPath(new URL(name, output));
const checks = [], cases = [], errors = [], resources = [], pausePixels = [];
async function open(browser, engine, width, height, {prod = false, failure = false, video = false} = {}) {
  const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 500,
    ...(video ? {recordVideo: {dir: artifact('runner-video'), size: {width, height}}} : {})});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${engine} ${width}: ${error.message}`));
  const requests = []; page.on('request', request => requests.push(request.url()));
  if (prod) page.on('response', response => {if (/\.(js|css|png|webp|json)(\?|$)/.test(response.url())) resources.push({url: response.url(), status: response.status(), cache: response.headers()['cache-control']});});
  await page.addInitScript(() => {
    localStorage.setItem('old-raising-sentinel', 'keep');
    const originalOpen = indexedDB.open.bind(indexedDB);
    window.__idbOpens = [];
    indexedDB.open = (...args) => {window.__idbOpens.push(args[0]); return originalOpen(...args);};
  });
  if (failure) await page.route('**/art/**', route => route.abort());
  if (!prod) {await page.clock.install({time: new Date('2026-10-05T00:00:00Z')}); await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));}
  await page.goto(`${prod ? production : dev}/?test=1&seed=42&raising=1&v=${CONFIG.buildVersion}`);
  await page.waitForLoadState('networkidle');
  if (!failure) {
    await page.getByRole('button', {name: 'おさんぽへ', exact: true}).waitFor();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    if (!prod) await page.clock.runFor(50);
  }
  return {context, page, requests};
}
async function mute(page) {
  await page.getByRole('button', {name: '設定を開く', exact: true}).click();
  await page.locator('#ready-sound').click();
  await page.getByRole('button', {name: '設定を閉じる', exact: true}).click();
}
async function start(page) {
  await page.getByRole('button', {name: 'おさんぽへ', exact: true}).click();await confirmDeparture(page);
  await page.waitForFunction(() => window.__dogBoneTest.game.state === 'running');
}
async function verifyBounds(page, root) {
  const report = await page.evaluate(root => {
    const game = document.querySelector('#game').getBoundingClientRect();
    return [...document.querySelectorAll(`${root} button, ${root} h1, ${root} h2, ${root} p`)]
      .filter(el => el.getClientRects().length).map(el => {const r = el.getBoundingClientRect(); return {text: el.textContent, height: r.height, ok: r.top >= game.top - 1 && r.bottom <= game.bottom + 1 && r.left >= game.left - 1 && r.right <= game.right + 1, button: el.tagName === 'BUTTON'};});
  }, root);
  assert.ok(report.every(item => item.ok), JSON.stringify(report));
  assert.ok(report.filter(item => item.button).every(item => item.height >= 44), JSON.stringify(report));
}
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({headless: true});
  try {
    for (const [width, height] of [[320,568], [390,844], [430,932], ...(engine === chromium ? [[1280,900]] : [])]) {
      console.log(`runner regression ${engine.name()} ${width}x${height}`);
      const {context, page, requests} = await open(browser, engine.name(), width, height);
      assert.equal(await page.locator('#dog-pet, .raising-home, .care-dialog, .coin-wallet, #shop').count(), 0);
      assert.equal(await page.evaluate(() => window.__dogBoneTest.renderer.liveDog), null);
      assert.equal(await page.evaluate(() => window.__dogBoneTest.game.walkDifficulty), undefined);
      await verifyBounds(page, '#ready');
      if ([320,390].includes(width)) await page.screenshot({path: artifact(`runner-ready-${engine.name()}-${width}.png`)});
      // Settings pause the menu canvas, restore focus, persist after reload.
      await page.getByRole('button', {name: '設定を開く', exact: true}).click();
      await page.clock.runFor(30);
      const frozenMenu = await page.locator('#scene').screenshot();
      await page.clock.runFor(1200);
      assert.ok(frozenMenu.equals(await page.locator('#scene').screenshot()), 'settings must freeze menu drawing');
      await page.locator('#ready-sound').click();
      await page.locator('#reduce-motion').check();
      await page.locator('#music-volume').focus();
      await page.keyboard.press('Home');
      for (let i=0;i<3;i++) await page.keyboard.press('ArrowRight');
      await page.getByRole('button', {name: '設定を閉じる', exact: true}).click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'ready-settings');
      await page.reload(); await page.waitForLoadState('networkidle'); await page.clock.runFor(30);
      assert.equal(await page.evaluate(() => window.__dogBoneTest.audio.enabled), false);
      assert.equal(await page.evaluate(() => window.__dogBoneTest.renderer.userReducedMotion), true);
      assert.equal(await page.locator('#music-volume').inputValue(), '15');
      await page.getByRole('button', {name: '設定を開く', exact: true}).click();
      await page.locator('#reduce-motion').uncheck();
      await page.getByRole('button', {name: '設定を閉じる', exact: true}).click();
      await start(page);
      assert.equal(await page.locator('#control-hint').isVisible(), true);
      const route = await page.evaluate(() => window.__dogBoneTest.game.bones.map(b => ({at: b.distance*1000-300, lane:b.lane})));
      let paused = false;
      for (const bone of route) {
        const now = await page.evaluate(() => window.__dogBoneTest.game.timeMs);
        await page.clock.runFor(Math.max(0,bone.at-now));
        if (!paused && bone.at > 5000) {
          assert.equal(await page.locator('#control-hint').isVisible(), false);
          await page.getByRole('button', {name:'一時停止', exact:true}).click();
          await page.clock.runFor(30);
          const frozen = await page.evaluate(() => ({state:window.__dogBoneTest.game.state,time:window.__dogBoneTest.game.timeMs,x:window.__dogBoneTest.game.x}));
          assert.equal(frozen.state,'paused');
          const pixels = await page.locator('#scene').screenshot();
          await page.locator('#scene').evaluate(canvas=>{
            window.__pausedPixels={width:canvas.width,height:canvas.height,data:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data};
          });
          await page.clock.runFor(3000);
          assert.deepEqual(await page.evaluate(() => ({state:window.__dogBoneTest.game.state,time:window.__dogBoneTest.game.timeMs,x:window.__dogBoneTest.game.x})), frozen);
          const pixelsAfter=await page.locator('#scene').screenshot();
          const pixelDiff=await page.locator('#scene').evaluate(canvas=>{
            const stored=window.__pausedPixels;
            if(stored.width!==canvas.width||stored.height!==canvas.height)throw Error('Paused canvas dimensions changed');
            const before=stored.data,after=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
            let differentPixels=0,maxChannelDelta=0;
            for(let p=0;p<after.length;p+=4){let changed=false;for(let c=0;c<4;c++){
              const delta=Math.abs(after[p+c]-before[p+c]);maxChannelDelta=Math.max(maxChannelDelta,delta);changed ||= delta>0;
            }if(changed)differentPixels++;}
            delete window.__pausedPixels;return {differentPixels,maxChannelDelta};
          });
          if(!pixels.equals(pixelsAfter) || pixelDiff.differentPixels>0){
            await writeFile(artifact('runner-pause-before.png'),pixels);await writeFile(artifact('runner-pause-after.png'),pixelsAfter);
            await writeFile(artifact('runner-pause-diagnostic.json'),JSON.stringify({engine:engine.name(),width,height,...pixelDiff},null,2));
          }
          // WebKit occasionally rounds a single antialiased background edge differently
          // when redrawing identical inputs (observed 1 pixel, max channel delta 4).
          // Compare RGBA directly; permit only tiny raster noise, never visible motion.
          const roundingOnly=engine===webkit && pixelDiff.differentPixels<=4 && pixelDiff.maxChannelDelta<=8;
          assert.ok(pixelDiff.differentPixels===0 || roundingOnly, `pause must freeze canvas pixels: ${JSON.stringify(pixelDiff)}`);
          pausePixels.push({engine:engine.name(),width,height,...pixelDiff});
          await page.getByRole('button', {name:'再開する', exact:true}).click(); paused=true;
          if (width === 390) await page.screenshot({path:artifact(`runner-playing-${engine.name()}.png`)});
        }
        const lane = await page.evaluate(() => window.__dogBoneTest.game.lane);
        if (lane !== bone.lane) await page.keyboard.press(bone.lane>lane?'ArrowRight':'ArrowLeft');
        await page.clock.runFor(200);
      }
      const now = await page.evaluate(() => window.__dogBoneTest.game.timeMs);
      await page.clock.runFor(30050-now);
      const result = await page.evaluate(() => ({result:window.__dogBoneTest.game.result(), contacts:window.__dogBoneTest.log.events.filter(e=>e.type==='obstacle_contact')}));
      assert.equal(result.result.completed, true); assert.equal(result.result.timeMs,30000);
      assert.equal(result.result.collected,result.result.placed); assert.deepEqual(result.contacts,[]);
      await verifyBounds(page,'#result');
      assert.equal(await page.locator('#result-bones').textContent(),`${result.result.collected} / ${result.result.placed}`);
      assert.equal(await page.locator('#phase2-normal').isVisible(),false);
      assert.equal(await page.locator('#phase2-gold').isVisible(),false);
      if ([320,390].includes(width)) await page.screenshot({path:artifact(`runner-result-${engine.name()}-${width}.png`)});
      const oldSeed = await page.evaluate(() => window.__dogBoneTest.game.seed);
      await page.getByRole('button',{name:'もう一度',exact:true}).click();
      await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
      assert.equal(await page.evaluate(()=>window.__dogBoneTest.game.score),0);
      assert.equal(await page.locator('#control-hint').isVisible(),true);
      await page.evaluate(()=>{const g=window.__dogBoneTest.game;g.bones=[];g.obstacles=[{id:'fatal',type:'hole',lane:0,distance:1,status:'pending'}];});
      await page.clock.runFor(1800);
      assert.equal(await page.locator('#result-title').textContent(),'もう一歩、先へ。');
      assert.equal(await page.locator('#result-time-label').textContent(),'到達率');
      await page.getByRole('button',{name:'タイトルへ',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'start');
      assert.equal(await page.evaluate(()=>localStorage.getItem('old-raising-sentinel')),'keep');
      assert.deepEqual(await page.evaluate(()=>window.__idbOpens),[]);
      assert.ok(requests.every(url=>!/raising-|dog-3d-|home-scene/.test(url)), 'runtime must not load raising/3D assets');
      cases.push({engine:engine.name(),width,height,seed:oldSeed,...result});
      await context.close();
    }
    // Normal production URL ignores test/raising flags and only loads shipped assets.
    const {context,page,requests} = await open(browser,engine.name(),390,844,{prod:true});
    assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
    assert.equal(await page.locator('#test-panel, .raising-home, #dog-pet').count(),0);
    await mute(page); await page.getByRole('button',{name:'おさんぽへ',exact:true}).click();await confirmDeparture(page);
    await page.waitForFunction(()=>document.querySelector('#game').dataset.state==='running');
    await page.getByRole('button',{name:'一時停止',exact:true}).click();
    await page.getByRole('button',{name:'おさんぽをやめる',exact:true}).click();
    assert.equal(await page.locator('#game').getAttribute('data-state'),'ready');
    assert.deepEqual(await page.evaluate(()=>window.__idbOpens),[]);
    assert.ok(requests.every(url=>!/raising-|dog-3d-|home-scene/.test(url)));
    await context.close();
    const failed = await open(browser,engine.name(),390,844,{prod:true,failure:true});
    await failed.page.getByRole('button',{name:'読み込みを再試行',exact:true}).waitFor();
    await failed.page.unroute('**/art/**');
    await failed.page.getByRole('button',{name:'読み込みを再試行',exact:true}).click();
    await failed.page.getByRole('button',{name:'おさんぽへ',exact:true}).waitFor();
    await failed.page.waitForFunction(()=>!document.querySelector('#start').disabled);
    await failed.context.close();
    checks.push(`${engine.name()}: layout, authored image dog, settings persistence/focus/pause, 30s full course, retry/hole/title, no raising DB, production isolation, load failure retry`);
  } finally {await browser.close();}
}
assert.deepEqual(errors,[]);
for (const response of resources) {assert.equal(response.status,200); assert.equal(response.cache,'no-store');assert.equal(new URL(response.url).searchParams.get('v'),CONFIG.buildVersion);}
const version=JSON.parse(await readFile(new URL('../dist/version.json',import.meta.url)));
assert.ok(version.modules.every(path=>!/(raising-|home-scene|dog-3d-|live-dog)/.test(path)));
assert.ok(version.modules.includes('src/home-command-motion.js'));
// Both the continuous home pack and the complete legacy fallback must ship.
const expectedAssets = [
  ...['greet','liedown','sitdown','tiltleft','tiltright'].flatMap(key => [
    `art/dog-continuous-${key}.webp`, `art/dog-home-${key}.webp`
  ]),
  'art/dog-home-continuity.json','art/dog-home-motion.json',
  'art/dog-walk-animated.webp','art/dog-postures-animated.webp',
  'art/dog-expressions-animated.webp','art/dog-image-animation.json',
  'art/dog-faithful-atlas.json','art/dog-faithful-back.png','art/dog-faithful-front.png'
];
assert.deepEqual([...version.assets].sort(), expectedAssets.sort());
await writeFile(artifact('runner-polish-browser-results.json'),JSON.stringify({buildVersion:CONFIG.buildVersion,checks,cases,pausePixels,errors,resources:[...new Map(resources.map(r=>[r.url,r])).values()],production:version},null,2));
console.log(JSON.stringify({checks,cases:cases.length,errors,production:version},null,2));
