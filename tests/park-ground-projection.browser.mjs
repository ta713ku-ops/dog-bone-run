import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {renderingLaunchOptions} from './browser-rendering.mjs';
const {chromium,webkit}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const origin=process.env.DOG_TEST_URL??'http://127.0.0.1:4198',out='test-results/resolution-v36';
await mkdir(out,{recursive:true});const report={cases:[],errors:[],scope:'Untimed readPixels of actual park fragment depth/world UV; response-only shader probe.'};
const source=await readFile('src/park-ground-gpu.js','utf8');
assert.equal(source.split('gl_FragColor = vec4(texel.rgb, alpha);').length,2);
const probed=source.replace('gl_FragColor = vec4(texel.rgb, alpha);','gl_FragColor = vec4(clamp(distance / 120.0, 0.0, 1.0), fract(uv.x), fract(uv.y), 1.0);');
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(renderingLaunchOptions(engine));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
  await page.route('**/src/park-ground-gpu.js',r=>r.fulfill({contentType:'text/javascript',body:probed}));
  await page.goto(`${origin}/tests/fixtures/resolution-preview.html?level=2`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__resolution?.ready?.ok);
  const probes=await page.evaluate(()=>{
   const {renderer:r}=window.__resolution,art=r.parkLevel2Scene.art,gpu=art.groundGPU,gl=gpu.gl,results=[];
   for(const travel of [0,7,17,30]){
    if(!art.drawGroundGPU(r,travel))throw Error('Park GPU probe did not draw');
    for(const fx of [.02,.12,.3,.5,.7,.88,.98])for(const fy of [.29,.33,.4,.5,.65,.8,.96]){
     const px=Math.floor(fx*gpu.canvas.width),py=Math.floor(fy*gpu.canvas.height),x=(px+.5)*r.width/gpu.canvas.width,y=(py+.5)*r.height/gpu.canvas.height;
     const scale=(y-r.height*.28)/(r.height*.52),distance=(1/scale-1)/.65,lane=(x-r.width*.5)/(r.width*.235*scale);
     const material=Math.abs(lane)<=1.56&&distance<14.2?'path':Math.abs(lane)>=1.66&&Math.abs(lane)<=14&&distance<8.2?'grass':null;
     if(!material||distance<-.82)continue;
     const span=material==='path'?2.1:2.6,rgba=new Uint8Array(4);gl.readPixels(px,gpu.canvas.height-1-py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
     results.push({travel,x,y,material,expected:{depth:Math.max(0,distance)/120,u:(lane/span%1+1)%1,v:((travel+distance)/span%1+1)%1},actual:{depth:rgba[0]/255,u:rgba[1]/255,v:rgba[2]/255,alpha:rgba[3]}});
    }
   }
   const info=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(info.UNMASKED_RENDERER_WEBGL),results};
  });
  assert.ok(probes.results.length>60);const wrapped=(a,b)=>Math.min(Math.abs(a-b),1-Math.abs(a-b));
  for(const p of probes.results){assert.equal(p.actual.alpha,255);assert.ok(Math.abs(p.actual.depth-p.expected.depth)<.006,JSON.stringify(p));assert.ok(wrapped(p.actual.u,p.expected.u)<.012,JSON.stringify(p));assert.ok(wrapped(p.actual.v,p.expected.v)<.012,JSON.stringify(p));}
  assert.ok(probes.results.some(p=>p.material==='path'));assert.ok(probes.results.some(p=>p.material==='grass'));
  report.cases.push({engine:engine.name(),...probes});await context.close();
 }finally{await browser.close();}
}
assert.deepEqual(report.errors,[]);await writeFile(`${out}/park-gpu-projection-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.map(c=>({engine:c.engine,renderer:c.renderer,probes:c.results.length})),errors:report.errors},null,2));
