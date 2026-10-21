import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sharp=createRequire(import.meta.url)('sharp');
const root='art/home-toys-v2',generator='scripts/pack-home-toys.mjs';
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const assets={};
for(const key of ['ball','rope']){
 const source=`${root}/source/${key}.png`,path=`${root}/${key}.webp`;
 await sharp(source).trim({threshold:8}).resize({width:key==='ball'?512:640,withoutEnlargement:true}).webp({quality:94,alphaQuality:100,effort:6}).toFile(path);
 const m=await sharp(path).metadata();
 if(!m.hasAlpha||m.width>1024||m.height>1024)throw Error(`Invalid toy asset: ${key}`);
 assets[key]={source,path,sourceSha256:await hash(source),sha256:await hash(path),width:m.width,height:m.height,alpha:m.hasAlpha};
}
await writeFile(`${root}/metadata.json`,JSON.stringify({version:1,generator,generatorSha256:await hash(generator),promptsSha256:await hash(`${root}/prompts.json`),assets},null,2)+'\n');
console.log('Packed photographic ball and rope');
