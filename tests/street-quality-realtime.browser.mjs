import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output='test-results/walk-v26';await mkdir(output,{recursive:true});
const report={cases:[],errors:[],scope:'Mac browser UI before pixel readback; not physical iPhone performance'};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,...(process.env.DOG_NO_VIDEO ? {} : {recordVideo:{dir:output+'/video',size:{width:390,height:844}}})});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto((process.env.DOG_REALTIME_URL ?? 'http://127.0.0.1:4195')+'/?test=1&seed=42',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.evaluate(()=>{
   const r=window.__dogBoneTest.renderer, method=typeof r.drawFrame==='function'?'drawFrame':'draw', draw=r[method].bind(r);
   window.__streetFrameSamples=[];let last=null;
   r[method]=function(game){
    const start=performance.now();draw(game);
    if(game.state==='running'){
     window.__streetFrameSamples.push({activeMs:game.timeMs,drawMs:performance.now()-start,intervalMs:last===null?null:start-last});last=start;
    }
   };
  });
  await page.getByRole('button',{name:'おさんぽへ',exact:true}).tap();
  await page.waitForFunction(()=>window.__dogBoneTest.game.timeMs>=6500,{timeout:15000});
  await page.getByRole('button',{name:'一時停止',exact:true}).tap();
  const result=await page.evaluate(()=>{
   const a=window.__streetFrameSamples.filter(s=>s.activeMs>=1000);
   const percentile=(list,p)=>list.sort((a,b)=>a-b)[Math.min(list.length-1,Math.ceil(list.length*p)-1)];
   return {frames:a.length,activeMs:window.__dogBoneTest.game.timeMs,drawP95:percentile(a.map(s=>s.drawMs),.95),intervalMedian:percentile(a.map(s=>s.intervalMs),.5),intervalP95:percentile(a.map(s=>s.intervalMs),.95),score:window.__dogBoneTest.game.score};
  });
  await page.locator('#game').screenshot({path:output+'/'+engine.name()+'-realtime-paused.png'});
  report.cases.push({engine:engine.name(),...result,video:page.video() ? await page.video().path() : null});
  await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);
await writeFile(output+(process.env.DOG_REALTIME_LABEL ? '/realtime-'+process.env.DOG_REALTIME_LABEL+'.json' : process.env.DOG_NO_VIDEO ? '/realtime-no-video.json' : '/realtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
