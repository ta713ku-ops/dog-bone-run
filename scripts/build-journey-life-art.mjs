import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {ALL_JOURNEY_ROUTES} from '../src/journey-catalog.js';
import {renderingLaunchOptions} from '../tests/browser-rendering.mjs';
const require=createRequire(import.meta.url);
const sharp=require('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {chromium}=await import('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch(renderingLaunchOptions(chromium));
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
const page=await context.newPage();const records=[];
await mkdir('art/journey-memories',{recursive:true});await mkdir('art/journey-previews',{recursive:true});
try {
  await page.goto('http://127.0.0.1:4197/?test=1',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs.stats.animationReady,{timeout:60000});
  await page.evaluate(()=>window.__dogBoneTest.renderer.dogs.ready);
  for(const route of ALL_JOURNEY_ROUTES){
    const images=await page.evaluate(async route=>{
      const {renderer:r,audio}=window.__dogBoneTest;audio.setEnabled(false);
      const {Game}=await import('./src/game.js');
      const {drawDiscoverySilhouette}=await import('./src/journey-scene.js');
      await r.prepareWalk(route.level);r.reset();r.observingDiscovery=false;
      const game=new Game({phase:4,journeyRouteId:route.id});game.start();game.advance(5000);game.pause('preview');r.draw(game,{force:true});
      const preview=r.canvas.toDataURL('image/png'),memories=[];
      for(const discovery of route.discoveries){
        const g=new Game({phase:4,journeyRouteId:route.id});g.start();g.advance(discovery.timeMs-400);g.pause('memory-art');g.discoveries=[];g.bones=[];g.obstacles=[];
        r.reset();r.observingDiscovery=true;r.reactToDiscovery(discovery);r.discoveryFocusProgress=1;r.draw(g,{force:true});
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=640;const c=canvas.getContext('2d');
        c.fillStyle='#f7efdf';c.fillRect(0,0,960,640);
        // Keep the actual dog and world at their original aspect ratio.
        c.drawImage(r.canvas,0,r.canvas.height*.17,r.canvas.width,r.canvas.width*640/600,0,0,600,640);
        const panel=c.createLinearGradient(535,0,645,0);panel.addColorStop(0,'rgba(247,239,223,0)');panel.addColorStop(1,'#f7efdf');c.fillStyle=panel;c.fillRect(535,0,110,640);
        const study={ctx:c,ellipse(x,y,rx,ry,fill,stroke,angle=0){c.beginPath();c.ellipse(x,y,rx,ry,angle,0,Math.PI*2);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.6;c.stroke();}},path(points,fill,stroke,lineWidth=1.6){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lineWidth;c.stroke();}}};
        drawDiscoverySilhouette(study,discovery,780,348,3.5);
        memories.push({id:discovery.id,image:canvas.toDataURL('image/png')});
      }
      r.observingDiscovery=false;r.reset();return {preview,memories};
    },route);
    for(const [path,data]of [[`art/journey-previews/${route.id}.webp`,images.preview],...images.memories.map(m=>[`art/journey-memories/${m.id}.webp`,m.image])]){
      const png=Buffer.from(data.split(',')[1],'base64');const bytes=await sharp(png).resize({width:path.includes('previews')?480:960}).webp({quality:85}).toBuffer();await writeFile(path,bytes);
      records.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    console.log(`Authored art: ${route.id}`);
  }
  await writeFile('art/journey-memories/metadata.json',JSON.stringify({source:'Original Canvas scene and in-world subject painter; no external media',version:1,records},null,2));
}finally{await context.close();await browser.close();}
