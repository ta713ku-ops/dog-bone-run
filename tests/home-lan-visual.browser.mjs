import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.DOG_LAN_URL||'http://172.20.10.10:4174';
const out='test-results/motion-repair-v15';await mkdir(out+'/lan-video',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,recordVideo:{dir:out+'/lan-video',size:{width:390,height:844}}});
const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(root+'/?v=0.15.0');await page.waitForLoadState('networkidle');await page.waitForFunction(()=>!document.querySelector('#home-sit').disabled);
 assert.equal(await page.evaluate(()=>typeof window.__dogBoneTest),'undefined');
 const version=await (await page.request.get(root+'/version.json')).json();assert.equal(version.buildVersion,'0.15.0');
 await page.locator('#home-sit').click();await page.waitForTimeout(2200);await page.screenshot({path:out+'/lan-home.png'});
 await page.locator('#home-lie').click();await page.waitForTimeout(3400);await page.screenshot({path:out+'/lan-lying.png'});
 await page.locator('#home-greet').click();await page.waitForTimeout(1600);await page.screenshot({path:out+'/lan-greeting.png'});await page.waitForTimeout(1800);
 assert.equal(await page.locator('#home-greet').isDisabled(),false);assert.deepEqual(errors,[]);
 await writeFile(out+'/lan-visual-results.json',JSON.stringify({url:page.url(),version:version.buildVersion,viewport:{width:390,height:844},errors,physicalIPhone:false},null,2));
}finally{await context.close();await browser.close();await copyFile(await video.path(),out+'/lan-home-motion.webm');}
console.log('LAN production home: sit, lie, greet, no test API, no browser errors');
