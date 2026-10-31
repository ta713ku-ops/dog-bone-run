import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const{chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch(renderingLaunchOptions(chromium));
const context=await browser.newContext({viewport:{width:390,height:844}});
try{
 const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:500000,connectionType:'cellular4g'});
 const started=Date.now();await page.goto('http://127.0.0.1:4198/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.querySelector('#start').disabled,null,{timeout:60000});
 const readyMs=Date.now()-started;
 const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(item=>({path:new URL(item.name).pathname,bytes:item.encodedBodySize,ms:item.duration})).sort((a,b)=>b.bytes-a.bytes));
 const result={scope:'Desktop Chromium network emulation, cold cache, 10 Mbps down / 100 ms latency; not mobile hardware',readyMs,transferredBytes:resources.reduce((sum,item)=>sum+item.bytes,0),largest:resources.slice(0,12),errors};
 await mkdir('test-results/ultimate-v39',{recursive:true});await writeFile('test-results/ultimate-v39/loading.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert.deepEqual(errors,[]);assert.ok(readyMs<=3000,`cold first interaction ${readyMs}ms exceeds 3000ms budget`);
}finally{await context.close();await browser.close();}
