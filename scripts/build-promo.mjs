import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {renderingLaunchOptions} from '../tests/browser-rendering.mjs';
const {chromium}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const directory='test-results/ultimate-v39/promo';await mkdir(directory,{recursive:true});await mkdir('release',{recursive:true});
const browser=await chromium.launch(renderingLaunchOptions(chromium));
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,recordVideo:{dir:directory,size:{width:390,height:844}}});
const page=await context.newPage(),video=page.video();let startSeconds=0;
try{
 const began=Date.now();await page.goto('http://127.0.0.1:4198/',{waitUntil:'networkidle'});await page.locator('#start:not([disabled])').waitFor({timeout:60000});
 startSeconds=(Date.now()-began)/1000;await page.waitForTimeout(2800);
 await page.click('#start');await page.waitForTimeout(900);await page.locator('[data-route="street-1"]').click();
 await page.locator('.journey-observation[open]').waitFor({timeout:20000});await page.waitForTimeout(1000);
 await page.locator('.journey-observation-actions button').first().click();await page.waitForTimeout(5500);
 await page.screenshot({path:`${directory}/production-observation.png`});
}finally{await context.close();await browser.close();}
const source=await video.path(),output=`release/hone-no-osanpo-v${CONFIG.buildVersion}-15s.webm`;
const ffmpeg=process.env.DOG_FFMPEG??'/Users/taku/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac';
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(startSeconds),'-i',source,'-t','15','-an','-c:v','libvpx','-b:v','800k','-deadline','realtime','-cpu-used','5',output],{stdio:'inherit'});
await writeFile(`release/v${CONFIG.buildVersion}-promo.json`,JSON.stringify({version:CONFIG.buildVersion,output,source,bytes:(await stat(output)).size,durationSeconds:15,audio:false,description:'Actual production browser, normal wall-clock operation; no diagnostic API, frame simulation or generated footage.'},null,2));console.log(output);
