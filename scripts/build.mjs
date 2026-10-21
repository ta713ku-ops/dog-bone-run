import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { CONFIG, PHASE4 } from '../src/config.js';
import { WALK_LEVELS } from '../src/walk-levels.js';
import {createHash} from 'node:crypto';
const diagnosticBuild=process.argv.includes('--diagnostics');
const destination=diagnosticBuild?'device-check':'dist';
// Fail clearly if a generated source or packing rules changed without recompiling.
for(const [path,command] of [['art/dog-image-animation.json','assets:animation'],['art/dog-home-motion.json','assets:home-motion'],['art/dog-home-continuity.json','assets:continuity'],['art/dog-walk-hd.json','assets:walk-hd']]){
  const animationMetadata=JSON.parse(await readFile(path,'utf8'));
  for(const source of [...Object.values(animationMetadata.sourceSheets),animationMetadata.generator,...Object.values(animationMetadata.atlases)]){
    if(!source?.path||!source?.sha256) throw new Error(`Missing animation build provenance: run npm run ${command}`);
    const hash=createHash('sha256').update(await readFile(source.path)).digest('hex');
    if(hash!==source.sha256) throw new Error(`Animation source, packing rules or output changed: run npm run ${command} (${source.path})`);
  }
}
const hdMetadata=JSON.parse(await readFile('art/dog-hd/metadata.json','utf8'));
for(const source of [hdMetadata.generator,hdMetadata.sourceMetadata,...hdMetadata.masters,...Object.values(hdMetadata.sources),...hdMetadata.frames]){
  const path=source.path??source.source;
  if(!path||!source.sha256||createHash('sha256').update(await readFile(path)).digest('hex')!==source.sha256)
    throw new Error(`HD dog source or output changed: rebuild scripts/build-dog-hd.py (${path})`);
}
const directionMetadata=JSON.parse(await readFile('art/dog-direction/metadata.json','utf8'));
for(const item of [directionMetadata.generator,...directionMetadata.sources,{path:'art/dog-direction/heads.webp',sha256:directionMetadata.sheet.sha256}]) {
  if(!item.path||!item.sha256||createHash('sha256').update(await readFile(item.path)).digest('hex')!==item.sha256)
    throw new Error(`Direction artwork or packing rules changed: rebuild scripts/pack-dog-direction.mjs (${item.path})`);
}
const resolutionMetadata=JSON.parse(await readFile('art/resolution-v36/metadata.json','utf8'));
const roomShopArt=JSON.parse(await readFile('art/home-shop/metadata.json','utf8'));
const interiorArt=JSON.parse(await readFile('art/home-interior/metadata.json','utf8'));
const customArt=JSON.parse(await readFile('art/home-customization/metadata.json','utf8'));
const toyArt=JSON.parse(await readFile('art/home-toys-v2/metadata.json','utf8'));
for(const [path,expected]of [[toyArt.generator,toyArt.generatorSha256],['art/home-toys-v2/prompts.json',toyArt.promptsSha256],...Object.values(toyArt.assets).flatMap(a=>[[a.path,a.sha256],[a.source,a.sourceSha256]])]){
  if(!path||!expected||createHash('sha256').update(await readFile(path)).digest('hex')!==expected)
    throw new Error(`Toy art or packing rules changed: rebuild scripts/pack-home-toys.mjs (${path})`);
}
for(const [path,expected]of [[customArt.generator,customArt.generatorSha256],['art/home-customization/prompts.json',customArt.promptsSha256],...Object.values(customArt.assets).flatMap(a=>[[a.path,a.sha256],[a.source,a.sourceSha256]])]){
  if(!path||!expected||createHash('sha256').update(await readFile(path)).digest('hex')!==expected)
    throw new Error(`Home customization art or packing rules changed: rebuild scripts/pack-home-customization.mjs (${path})`);
}
for(const [path,expected]of [[interiorArt.generator,interiorArt.generatorSha256],['art/home-interior/prompts.json',interiorArt.promptsSha256],...Object.values(interiorArt.assets).flatMap(a=>[[a.path,a.sha256],[a.source,a.sourceSha256]])]){
  if(!path||!expected||createHash('sha256').update(await readFile(path)).digest('hex')!==expected)
    throw new Error(`Interior background or packing rules changed: rebuild scripts/pack-home-interior.mjs (${path})`);
}
if(createHash('sha256').update(await readFile(roomShopArt.generator)).digest('hex')!==roomShopArt.generatorSha256)
  throw new Error('Room shop packing rules changed: rebuild scripts/pack-home-shop.mjs');
for(const art of Object.values(roomShopArt.assets))for(const[path,expected]of[[art.path,art.sha256],[art.source,art.sourceSha256]]){
  if(createHash('sha256').update(await readFile(path)).digest('hex')!==expected)
    throw new Error(`Room shop art changed: rebuild scripts/pack-home-shop.mjs (${path})`);
}
if(createHash('sha256').update(await readFile(resolutionMetadata.generator)).digest('hex')!==resolutionMetadata.generatorSha256)
  throw new Error('Scenery packing rules changed: rebuild scripts/build-resolution-scenery.py');
if(!resolutionMetadata.layoutInput?.path||createHash('sha256').update(await readFile(resolutionMetadata.layoutInput.path)).digest('hex')!==resolutionMetadata.layoutInput.sha256)
  throw new Error('Scenery source layout changed: rebuild scripts/build-resolution-scenery.py');
for(const asset of Object.values(resolutionMetadata.assets))for(const [path,expected] of [[asset.path,asset.sha256],[asset.source,asset.sourceSha256]]){
  if(createHash('sha256').update(await readFile(path)).digest('hex')!==expected)
    throw new Error(`High resolution scenery changed: rebuild scripts/build-resolution-scenery.py (${path})`);
}
for (const metadataPath of ['art/park-v23/metadata.json', 'art/neighborhood-v24/metadata.json', 'art/street-v25/metadata.json', 'art/street-v26/metadata.json', 'art/park-level2/metadata.json', 'art/mountain-v32/metadata.json', 'art/cave-v33/metadata.json', 'art/cave-v34/metadata.json']) {
  const sceneryMetadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  for (const asset of Object.values(sceneryMetadata.assets)) {
    for (const [path, expected] of [[asset.path, asset.sha256], [asset.source, asset.sourceSha256]]) {
      if (!path || !expected || createHash('sha256').update(await readFile(path)).digest('hex') !== expected) {
        throw new Error(`Scenery art source or output changed: rebuild ${sceneryMetadata.generator} (${path})`);
      }
    }
  }
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
for (const file of ['index.html', 'styles.css', 'favicon.svg']) await cp(file, `${destination}/${file}`);
// Ship the runner's dependency graph, including its room shop and shared save model.
const modules = new Map(), assets = new Set(), root = resolve('.');
async function collect(path) {
  if (modules.has(path)) return;
  let source = await readFile(path, 'utf8');
  if (path === 'src/app.js'&&!diagnosticBuild) source = source.replace(/\/\/ DEV-ONLY-BEGIN[\s\S]*?\/\/ DEV-ONLY-END/g, '');
  if (path === 'src/build-mode.js') source = `export const DEVELOPMENT = ${diagnosticBuild};\n`;
  modules.set(path, source);
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.{1,2}\/[^'"?]+\.js)['"]/g)) {
    const target = relative(root, resolve(dirname(path), match[1]));
    if (!target.startsWith('src/')) throw new Error(`Unexpected module dependency: ${target}`);
    await collect(target);
  }
  for (const match of source.matchAll(/new URL\(['"](\.{1,2}\/[^'"?]+\.(?:png|webp|json|mp3))['"]/g)) {
    const target = relative(root, resolve(dirname(path), match[1]));
    if (!target.startsWith('art/')) throw new Error(`Unexpected asset dependency: ${target}`);
    assets.add(target);
  }
}
await collect('src/app.js');
for(const frame of hdMetadata.frames)assets.add(frame.path);
// Version every dependency, including transitive modules.
// A new HTML URL alone cannot invalidate resources cached under unchanged URLs.
const versioned = path => `${path}?v=${encodeURIComponent(CONFIG.buildVersion)}`;
const originalHtml=await readFile(`${destination}/index.html`,'utf8');
const html = diagnosticBuild?originalHtml:originalHtml.replace(/  <aside class="test-panel"[\s\S]*?<\/aside>/,'');
await writeFile(`${destination}/index.html`, html.replace(/(src|href)="(\.\/[^"?]+\.(?:js|css|svg))"/g,
  (_, attribute, path) => `${attribute}="${versioned(path)}"`));
for (const [modulePath, source] of modules) {
  const path = `${destination}/${modulePath}`;
  await mkdir(dirname(path), {recursive: true});
  const output = source.replace(/(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g,
    (_, prefix, quote, url) => `${prefix}${quote}${versioned(url)}${quote}`)
    .replace(/(new URL\()(['"])(\.{1,2}\/[^'"?]+\.(?:png|webp|json|mp3))\2/g,
      (_, prefix, quote, url) => `${prefix}${quote}${versioned(url)}${quote}`);
  await writeFile(path, output);
}
for (const asset of assets) {
  await mkdir(dirname(`${destination}/${asset}`), {recursive: true});
  await cp(asset, `${destination}/${asset}`);
}
await writeFile(`${destination}/version.json`, JSON.stringify({ buildVersion: CONFIG.buildVersion,
  configVersion: CONFIG.configVersion, courseVersion: CONFIG.courseVersion,
  ruleVersion: PHASE4.ruleVersion, walkLevels: Object.values(WALK_LEVELS), durationMs: PHASE4.durationMs, mode: 'runner', renderer: 'canvas-image-with-2d-gpu-home',
  releaseReady: false, physicalIPhoneVerified: false,
  diagnosticBuild,
  modules: [...modules.keys()].sort(), assets: [...assets].sort() }, null, 2));
console.log(`Built static site → ${destination}/ (no external runtime dependencies)`);
