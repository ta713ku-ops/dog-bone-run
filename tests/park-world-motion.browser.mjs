import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {projectStreet} from '../src/street-camera.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runFile=promisify(execFile);
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198';
const out=process.env.DOG_PARK_OUTPUT??'test-results/park-v30';
await mkdir(out,{recursive:true});
const report={cases:[],errors:[],scope:'Desktop Chromium/WebKit; actual 30 active seconds, shared-camera landmark traces and video. Not a physical iPhone or human nausea evaluation.'};

for(const engine of [chromium,webkit]) {
  const browser=await engine.launch({headless:true});
  const folder=`${out}/${engine.name()}-sequence`;await mkdir(folder,{recursive:true});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,
    isMobile:true,hasTouch:true,recordVideo:{dir:`${out}/videos`,size:{width:390,height:844}}});
  const page=await context.newPage(),video=page.video();
  page.on('pageerror',e=>report.errors.push(`${engine.name()}: ${e.message}`));
  try {
    await page.goto(`${origin}/?test=1&seed=42`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
    await page.locator('#ready-settings').click();
    if(await page.locator('#ready-sound').getAttribute('aria-pressed')==='true')await page.locator('#ready-sound').click();
    await page.locator('#settings-close').click();
    await page.locator('#start').click();await page.locator('#walk-level-2').click();
    await page.evaluate(()=>{
      const t=window.__dogBoneTest,renderer=t.renderer,draw=renderer.draw.bind(renderer);
      window.__worldMotion={trace:[],intervals:[]};let nextTrace=0,previous=null;
      renderer.draw=function(g,options){
        const result=draw(g,options),m=window.__worldMotion;
        if(g.state==='running') {
          const now=performance.now();
          if(g.timeMs>1000&&previous!==null)m.intervals.push(now-previous);
          previous=now;
          if(g.timeMs>=nextTrace) {
            m.trace.push({timeMs:g.timeMs,travel:this.worldDistance(g),bend:this.trailBend,width:this.width,height:this.height,
              landmarks:this.parkLevel2Scene.stats.landmarks});nextTrace+=100;
          }
        }
        return result;
      };
    });
    await page.locator('#walk-picker-start').click();
    await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
    const inputs=await page.evaluate(()=>window.__dogBoneTest.game.courseData.safeInputs);
    for(const input of inputs) {
      // Video encoding plus two protocol round trips can deliver a key 60–100ms
      // after the polling target. Lead the driver, then assert actual logged
      // arrival is within the course's existing ±60ms input tolerance.
      await page.waitForFunction(at=>window.__dogBoneTest.game.timeMs>=at,input.timeMs-60,{polling:10,timeout:6000});
      await page.keyboard.press(input.direction<0?'ArrowLeft':'ArrowRight');
    }
    await page.waitForFunction(()=>window.__dogBoneTest.game.state==='result',undefined,{timeout:6000});
    const evidence=await page.evaluate(()=>({motion:window.__worldMotion,result:window.__dogBoneTest.game.result(),
      pauses:window.__dogBoneTest.log.events.filter(e=>e.type==='pause'),
      inputEvents:window.__dogBoneTest.log.events.filter(e=>e.type==='input'),
      contacts:window.__dogBoneTest.log.events.filter(e=>e.type==='obstacle_contact')}));
    const {trace,intervals}=evidence.motion;
    await writeFile(`${out}/${engine.name()}-world-trace.json`,JSON.stringify(evidence,null,2));
    assert.ok(trace.length>=290,`expected 10Hz world trace, got ${trace.length}`);
    const actualInputs=evidence.inputEvents.filter(e=>e.source==='keyboard');
    assert.equal(actualInputs.length,inputs.length);
    const inputTiming=inputs.map((expected,i)=>({expectedMs:expected.timeMs,actualMs:actualInputs[i].activeMs,
      deltaMs:actualInputs[i].activeMs-expected.timeMs,direction:actualInputs[i].direction}));
    for(const [i,item]of inputTiming.entries()) {
      assert.ok(Math.abs(item.deltaMs)<=60,`driver arrival ${item.deltaMs}ms exceeds the unchanged course tolerance`);
      assert.equal(item.direction,inputs[i].direction);assert.equal(actualInputs[i].accepted,true);
    }
    const tracks=new Map();let comparisons=0;
    for(const frame of trace) {
      assert.equal(frame.bend,0,'park camera stays fixed');
      for(const item of frame.landmarks) {
        const expected=projectStreet(frame.width,frame.height,item.lane,item.at-frame.travel,0,0);
        assert.ok(Math.abs(item.distance-(item.at-frame.travel))<1e-9);
        for(const key of ['x','y','scale'])assert.ok(Math.abs(item[key]-expected[key])<1e-8,`${item.id}.${key} shares the gameplay camera`);
        const anchor=projectStreet(frame.width,frame.height,item.lane,item.anchor.at-frame.travel);
        for(const key of ['x','y','scale'])assert.ok(Math.abs(item.anchor[key]-anchor[key])<1e-8);
        const prior=tracks.get(item.id)?.at(-1);
        if(prior) {
          assert.ok(item.anchor.scale>prior.anchor.scale,`${item.id} keeps approaching`);
          assert.ok(item.anchor.y>prior.anchor.y,`${item.id} never moves backwards`);
          assert.ok(Math.abs(item.anchor.x-frame.width/2)>Math.abs(prior.anchor.x-frame.width/2),`${item.id} passes towards its own side`);
          const predicted=(frame.travel-prior.travel)*.65/(1+.65*item.anchor.distance);
          assert.ok(Math.abs(item.anchor.scale/prior.anchor.scale-1-predicted)<1e-9,'relative enlargement follows depth, not one full-frame zoom');
          comparisons++;
        }
        if(!tracks.has(item.id))tracks.set(item.id,[]);
        tracks.get(item.id).push({...item,timeMs:frame.timeMs,travel:frame.travel});
      }
    }
    const passed={};
    for(const kind of ['playground','swings','bench','garden','tree','lamp']) {
      const entries=[...tracks.values()].filter(a=>a[0].kind===kind);
      const gone=entries.filter(a=>a.at(-1).timeMs<29000);
      assert.ok(gone.length>=2,`${kind}: at least two actual landmarks must pass, not stay in the same scene`);
      passed[kind]=gone.map(a=>a[0].id);
      // A landmark disappears only after moving beyond the viewport edge.
      for(const a of gone) {
        const last=a.at(-1),points=[];
        for(const x of [last.lane-last.width/2,last.lane+last.width/2])
          for(const z of [last.distance-.30-last.depth/2,last.distance-.30+last.depth/2])
            for(const up of [0,last.height])points.push(projectStreet(trace[0].width,trace[0].height,x,z,up));
        assert.ok(points.every(p=>p.x<5)||points.every(p=>p.x>385),`${last.id} should leave through the side instead of popping near the dog`);
      }
    }
    assert.equal(evidence.result.collected,48);assert.equal(evidence.result.goldCollected,3);
    assert.equal(evidence.result.contactCount,0);assert.equal(evidence.result.timeMs,30000);
    assert.deepEqual(evidence.pauses,[]);
    const sorted=intervals.slice().sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];
    assert.ok(sorted.length>1000);assert.ok(p95<=33.3,`frame interval p95 ${p95}`);
    await writeFile(`${out}/${engine.name()}-world-trace.json`,JSON.stringify({trace,passed,comparisons,inputTiming,result:evidence.result,intervals:{count:sorted.length,p95,max:sorted.at(-1)}},null,2));
    report.cases.push({engine:engine.name(),traceFrames:trace.length,landmarks:tracks.size,comparisons,passed,inputTiming,result:evidence.result,p95FrameMs:p95,pauses:evidence.pauses});
  } finally {
    await context.close();
    if(video) {
      const file=`${out}/${engine.name()}-walk.webm`;await video.saveAs(file);
      await runFile('/Users/taku/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac',
        ['-y','-i',file,'-r','2','-c:v','png',`${folder}/%03d.png`]);
    }
    await browser.close();
  }
}
assert.deepEqual(report.errors,[]);
await writeFile(`${out}/world-motion-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.cases.map(({engine,traceFrames,landmarks,comparisons,p95FrameMs,result})=>({engine,traceFrames,landmarks,comparisons,p95FrameMs,result})),null,2));
