import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/resolution-v36';
await mkdir(out,{recursive:true});const report={cases:[],errors:[],scope:'Untimed GPU readback of shader world depth and UV. Production source is unchanged by this response-only probe.'};
const source=await readFile('src/cave-gpu.js','utf8');
assert.equal(source.split('gl_FragColor = vec4(color, 1.0);').length,2);
const probed=source.replace('gl_FragColor = vec4(color, 1.0);','gl_FragColor = vec4(clamp(distance / 120.0, 0.0, 1.0), fract(uv.x), fract(uv.y), 1.0);');
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
  await page.route('**/src/cave-gpu.js',r=>r.fulfill({contentType:'text/javascript',body:probed}));
  await page.goto(`${origin}/tests/fixtures/resolution-preview.html?level=4`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__resolution?.ready?.ok);
  const probes=await page.evaluate(async()=>{
   const {renderer:r}=window.__resolution,{traceCaveSurface,caveSurfaceUV,caveTunnelGeometry}=await import('/src/cave-tunnel.js');
   const tunnel=r.caveScene.tunnel,gpu=tunnel.gpu,gl=gpu.gl,g=caveTunnelGeometry(r.width,r.height),results=[];
   for(const travel of [0,7,17,30]){
    if(!gpu.draw(r,travel,r.caveScene.art,g))throw Error('GPU probe did not draw');
    for(const fx of [.08,.2,.37,.5,.66,.83,.94])for(const fy of [.04,.15,.32,.58,.8,.96]){
     const px=Math.floor(fx*gpu.canvas.width),py=Math.floor(fy*gpu.canvas.height),x=(px+.5)*r.width/gpu.canvas.width,y=(py+.5)*r.height/gpu.canvas.height;
     const hit=traceCaveSurface(g,x,y,travel);if(hit.surface==='void'||hit.distance>40||hit.distance<-.7)continue;
     const uv=caveSurfaceUV(g,hit.surface,hit.lane,hit.elevation,hit.at),rgba=new Uint8Array(4);
     gl.readPixels(px,gpu.canvas.height-1-py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
     results.push({travel,x,y,surface:hit.surface,expected:{depth:Math.max(0,hit.distance)/120,u:(uv.u%1+1)%1,v:(uv.v%1+1)%1},actual:{depth:rgba[0]/255,u:rgba[1]/255,v:rgba[2]/255,alpha:rgba[3]}});
    }
   }return {renderer:gpu.stats.renderer,results};
  });
  assert.ok(probes.results.length>100);
  const wrappedError=(a,b)=>Math.min(Math.abs(a-b),1-Math.abs(a-b));
  for(const p of probes.results){assert.equal(p.actual.alpha,255);assert.ok(Math.abs(p.actual.depth-p.expected.depth)<.006,JSON.stringify(p));assert.ok(wrappedError(p.actual.u,p.expected.u)<.012,JSON.stringify(p));assert.ok(wrappedError(p.actual.v,p.expected.v)<.012,JSON.stringify(p));}
  assert.ok(probes.results.some(p=>p.surface==='floor'));assert.ok(probes.results.some(p=>p.surface==='rock'));
  report.cases.push({engine:engine.name(),...probes});await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/gpu-projection-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.map(c=>({engine:c.engine,renderer:c.renderer,probes:c.results.length})),errors:report.errors},null,2));
