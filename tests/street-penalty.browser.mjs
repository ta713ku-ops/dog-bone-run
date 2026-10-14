import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.DOG_TEST_URL??'http://127.0.0.1:4195';
const output=process.env.DOG_RESULT_DIR??'test-results/walk-v25';await mkdir(output,{recursive:true});
const report={cases:[],errors:[]};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`${base}/?test=1&seed=42`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.ready);
  await page.evaluate(()=>{
   const {game}=window.__dogBoneTest;
   game.fixedCourse=[1,3,5,7].map((d,i)=>({id:`test-bone-${i}`,lane:0,distance:d,timeMs:d*1000,kind:'normal'}));
   game.fixedObstacles=['litter','crow','cat'].map((type,i)=>({id:`test-${type}`,type,lane:0,distance:2+i*2}));
   game.reset({seed:42});
  });
  await page.getByRole('button',{name:'おさんぽへ',exact:true}).tap();
  await page.waitForFunction(()=>window.__dogBoneTest.game.state==='running');
  await page.evaluate(()=>{window.__dogBoneTest.game.score=100;window.__dogBoneTest.game.pause('fixture');});
  const samples=[];
  for(const [index,type] of ['litter','crow','cat'].entries()){
   const result=await page.evaluate(({index,type})=>{
    const t=window.__dogBoneTest,g=t.game;
    g.resume();g.advance((2+index*2)*1000-161-g.timeMs);
    const comboBefore=g.combo;
    g.advance(31);g.pause('fixture');t.renderer.draw(g);
    const contacts=t.log.events.filter(e=>e.type==='obstacle_contact');
    const latest=contacts.at(-1);
    const before=g.score;g.obstacleContact(g.obstacles[index]);
    return{type,score:g.score,before,hudScore:Number(document.querySelector('#score').textContent),contact:latest,speed:g.speed,combo:g.combo,comboBefore,suppress:g.suppressUntilMs,slow:g.slowUntilMs,state:g.state,fall:g.fall,contacts:contacts.length};
   },{index,type});
   assert.equal(result.contact.obstacleType,type);
   assert.equal(result.contact.obstacleId,`test-${type}`);
   assert.equal(result.hudScore,result.score);
   assert.equal(result.contact.points,-10);
   assert.equal(result.before,result.score);
   assert.equal(result.speed,1);assert.equal(result.suppress,0);assert.equal(result.slow,0);
   assert.equal(result.state,'paused');assert.equal(result.fall,null);
   assert.equal(result.contacts,index+1);
   assert.ok(result.comboBefore>0);assert.equal(result.combo,result.comboBefore);
   await page.locator('#game').screenshot({path:`${output}/${engine.name()}-contact-${type}.png`});
   samples.push(result);
  }
  const end=await page.evaluate(()=>{
   const t=window.__dogBoneTest,g=t.game;
   g.resume();g.advance(30000-g.timeMs);
   return{result:g.result(),state:g.state,ui:document.querySelector('#game').dataset.state,
    recordKey:t.records.key,record:t.records.read(),fallEvents:t.log.events.filter(e=>e.type==='fall').length,
    contacts:t.log.events.filter(e=>e.type==='obstacle_contact').length};
  });
  assert.equal(end.state,'result');assert.equal(end.ui,'result');assert.equal(end.result.timeMs,30000);
  assert.equal(end.result.completed,true);assert.equal(end.result.collected,4);assert.equal(end.result.score,110);
  assert.equal(end.fallEvents,0);assert.equal(end.contacts,3);
  assert.match(end.recordKey,/sprint30-penalty-v1/);assert.equal(end.record.record.highScore,110);
  await page.locator('#game').screenshot({path:`${output}/${engine.name()}-penalty-finish.png`});
  report.cases.push({engine:engine.name(),samples,end});
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);
await writeFile(`${output}/penalty.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:report.cases.length,errors:report.errors}));
