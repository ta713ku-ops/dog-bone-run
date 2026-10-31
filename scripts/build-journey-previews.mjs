import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {renderingLaunchOptions} from '../tests/browser-rendering.mjs';
import {JOURNEY_ROUTES,JOURNEY_PLACES} from '../src/journey-catalog.js';
const require=createRequire(import.meta.url);
let sharp;try{sharp=require('sharp');}catch{sharp=require('/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');}
const {chromium}=await import(process.env.DOG_PLAYWRIGHT_MODULE??'/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.JOURNEY_URL??'http://127.0.0.1:4197/?test=1';
const browser=await chromium.launch(renderingLaunchOptions(chromium));
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
await mkdir('art/journey-previews',{recursive:true});
const all=process.argv.includes('--all');
if(all)await mkdir('test-results/journey-v38/scenes',{recursive:true});
const metadata=[];
try{
  const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__dogBoneTest?.renderer.dogs?.stats.animationReady,null,{timeout:60000});
  const choices=all?JOURNEY_ROUTES.map(route=>[route.level,JOURNEY_PLACES.find(place=>place.level===route.level).id,route.id]):[[1,'street','street-1'],[2,'park','park-1'],[3,'mountain','mountain-1'],[4,'cave','cave-1']];
  for(const [level,place,routeId]of choices){
    await page.evaluate(async({level,place,routeId})=>{
      const{renderer,game,audio}=window.__dogBoneTest;
      audio.setEnabled(false);await renderer.prepareWalk(level);renderer.reset();
      game.reset({walkLevel:level,journeyRouteId:routeId,journeyMode:'calm'});
      game.start();game.advance(5200);game.pause('preview');renderer.draw(game,{force:true});
    },{level,place,routeId});
    const canvasData=await page.locator('#scene').evaluate(canvas=>canvas.toDataURL('image/png'));
    const png=Buffer.from(canvasData.split(',')[1],'base64');
    const output=await sharp(png).resize({width:780}).webp({quality:88}).toBuffer();
    const path=all?`test-results/journey-v38/scenes/${routeId}.webp`:`art/journey-previews/${place}.webp`;await writeFile(path,output);
    metadata.push({place,path,routeId,activeMs:5200,bytes:output.length,sha256:createHash('sha256').update(output).digest('hex')});
  }
  await writeFile(all?'test-results/journey-v38/scenes/metadata.json':'art/journey-previews/metadata.json',JSON.stringify({version:1,source:'Actual Canvas renderer, no external photograph',previews:metadata},null,2));
  console.log(JSON.stringify(metadata));
}finally{await context.close();await browser.close();}
