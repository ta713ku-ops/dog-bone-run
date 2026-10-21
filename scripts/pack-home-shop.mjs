import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sharp=createRequire(import.meta.url)('sharp');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const assets={};
for(const [key,width,quality] of [['bed',640,92],['plush',384,92],['rug-oat',768,90],['rug-sage',768,90]]){
 const source=`art/home-shop/source/${key}-v1.png`,path=`art/home-shop/${key}.webp`;
 await sharp(source).trim({threshold:8}).resize({width,withoutEnlargement:true}).webp({quality,alphaQuality:100}).toFile(path);
 const m=await sharp(path).metadata();
 assets[key]={source,path,sourceSha256:digest(await readFile(source)),sha256:digest(await readFile(path)),width:m.width,height:m.height,hasAlpha:m.hasAlpha};
}
await writeFile('art/home-shop/metadata.json',JSON.stringify({generator:'scripts/pack-home-shop.mjs',generatorSha256:digest(await readFile('scripts/pack-home-shop.mjs')),sourceGenerator:'built-in image_gen',assets},null,2));
