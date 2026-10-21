import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const sharp=require('sharp');
const root='art/home-interior';
const prompts=JSON.parse(await readFile(`${root}/prompts.json`,'utf8'));
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
await mkdir(`${root}/source`,{recursive:true});
const assets={};
for(const r of prompts.outputs){
 const name=`${r.theme}-${r.orientation}`,source=`${root}/source/${name}.png`,path=`${root}/${name}.webp`;
 try{await readFile(source);}catch{await copyFile(r.source,source);}
 await sharp(source).resize({width:r.orientation==='portrait'?1024:1536,withoutEnlargement:true}).webp({quality:87,effort:6}).toFile(path);
 const meta=await sharp(path).metadata();
 assets[name]={path,source,sha256:await hash(path),sourceSha256:await hash(source),width:meta.width,height:meta.height};
}
const generator='scripts/pack-home-interior.mjs';
await writeFile(`${root}/metadata.json`,JSON.stringify({version:1,generator,generatorSha256:await hash(generator),promptsSha256:await hash(`${root}/prompts.json`),assets},null,2)+'\n');
console.log('Packed',Object.keys(assets).length,'interior backgrounds');
