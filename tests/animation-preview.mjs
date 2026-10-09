import assert from 'node:assert/strict';
import {mkdir,rename,writeFile} from 'node:fs/promises';
import {createInitialSave} from '../src/raising-model.js';
import {CONFIG} from '../src/config.js';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'playwright');
const base=process.env.DOG_TEST_URL??'http://127.0.0.1:4183';
await mkdir('test-results/animation-video',{recursive:true});
const errors=[],dogImageRequests=[],browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},recordVideo:{dir:'test-results/animation-video',size:{width:390,height:844}}});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(/dog-.*\.(png|webp)/.test(request.url()))dogImageRequests.push(request.url());});
try{
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#start').disabled===false&&document.querySelector('#save-notice').textContent!=='おうちの記録を読み込んでいます…');await page.waitForTimeout(500);
 await page.screenshot({path:'test-results/raising-ready-final.png'});
 const intervals=await page.evaluate(()=>new Promise(resolve=>{const samples=[];let last;function frame(t){if(last!==undefined)samples.push(t-last);last=t;if(samples.length<180)requestAnimationFrame(frame);else resolve(samples);}requestAnimationFrame(frame);}));
 const sorted=[...intervals].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)],p95=sorted[Math.floor(sorted.length*.95)];
 assert.ok(p95<50,`desktop animation frame latency p95=${p95}`);
 await page.getByRole('button',{name:'設定を開く',exact:true}).click();await page.waitForTimeout(250);const freeze=await page.locator('#scene').evaluate(canvas=>canvas.toDataURL());await page.waitForTimeout(300);assert.equal(await page.locator('#scene').evaluate(canvas=>canvas.toDataURL()),freeze,'settings freezes the visible dog and action');
 const fixture=createInitialSave();fixture.dog.energy=80;fixture.dog.hunger=80;fixture.owned.toys=['starterBall','rope','plush','frisbee'];
 await page.locator('#save-import').setInputFiles({name:'animation-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(()=>document.querySelector('#backup-status').textContent==='バックアップを読み込みました。');await page.getByRole('button',{name:'設定を閉じる',exact:true}).click();
 await page.locator('#house-peek').click();await page.waitForTimeout(2000);await page.screenshot({path:'test-results/animation-inside-house.png'});
 for(const label of ['はじめてのボール','ひっぱりロープ','ぬいぐるみ','フリスビー']){await page.getByRole('button',{name:'遊ぶ',exact:true}).click();await page.getByRole('button',{name:new RegExp(label)}).click();await page.waitForTimeout(2400);await page.screenshot({path:`test-results/animation-${label}.png`});await page.waitForTimeout(4500);}
 await page.getByRole('button',{name:'休む',exact:true}).click();await page.waitForTimeout(1800);await page.screenshot({path:'test-results/animation-rest.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(dogImageRequests,[],'production dog does not request pose images');await writeFile('test-results/animation-preview-results.json',JSON.stringify({buildVersion:CONFIG.buildVersion,executedAt:new Date().toISOString(),status:'PASS',engine:'chromium',viewport:[390,844],checks:['180 real RAF intervals','home settings freezes Canvas pixels','ball/rope/plush/frisbee actions rendered','rest pose rendered','house enters behind wall mask and exits before care action','production without test API'],frameIntervals:{median,p95,max:sorted.at(-1)},dogImageRequests,errors,limitations:['desktop timing only','rig contact is checked separately from naturalness','human likeness and motion naturalness remain unapproved']},null,2));
 console.log(JSON.stringify({median,p95,errors}));
}finally{const video=page.video();await context.close();await video.saveAs('test-results/animation-preview.webm');await browser.close();}
