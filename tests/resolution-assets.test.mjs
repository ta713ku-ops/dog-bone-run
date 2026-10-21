import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ParkLevel2Art} from '../src/park-level2-art.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('high resolution scenery comes from original sources with a bounded complete manifest',async()=>{
 const metadata=JSON.parse(await readFile('art/resolution-v36/metadata.json'));
 assert.equal(digest(await readFile(metadata.generator)),metadata.generatorSha256);
 assert.equal(digest(await readFile(metadata.layoutInput.path)),metadata.layoutInput.sha256);
 let bytes=0,decoded=0;
 for(const asset of Object.values(metadata.assets)){
  const data=await readFile(asset.path);
  assert.equal(digest(data),asset.sha256);assert.equal(digest(await readFile(asset.source)),asset.sourceSha256);
  assert.equal(data.length,asset.bytes);assert.equal(asset.decodedBytes,asset.width*asset.height*4);
  bytes+=data.length;decoded+=asset.decodedBytes;
 }
 assert.ok(bytes<4_000_000);assert.ok(decoded<40_000_000);
 assert.equal(metadata.assets.foliage.layoutScale,3);
 assert.equal(metadata.assets.toys.layoutScale,3);
});

test('larger park sprites preserve the whole original crop and ground anchor',async()=>{
 class ImageMock{complete=true;naturalWidth=1536;naturalHeight=768;set src(v){queueMicrotask(()=>this.onload?.());}decode(){return Promise.resolve();}}
 const art=new ParkLevel2Art({ImageCtor:ImageMock});await art.ready;
 const calls=[],ctx={save(){},restore(){},drawImage(...args){calls.push(args);}};
 assert.equal(art.drawSprite(ctx,'treeOak',200,500,100,140),true);
 const [,sx,sy,sw,sh,dx,dy,dw,dh]=calls[0];
 assert.deepEqual([sx,sy,sw,sh],[99,24,567,720]);
 assert.deepEqual([dx,dy,dw,dh],[149,362.1,100,140]);
});

test('high resolution sprites retain actual WebP alpha data outside their silhouettes',async()=>{
 for(const name of ['foliage','toys','street-obstacles']){
  const data=await readFile(`art/resolution-v36/${name}.webp`),chunks=new Map();
  for(let offset=12;offset+8<=data.length;){const size=data.readUInt32LE(offset+4);chunks.set(data.toString('ascii',offset,offset+4),data.subarray(offset+8,offset+8+size));offset+=8+size+(size%2);}
  assert.ok(chunks.get('VP8X')?.[0]&0x10,`${name} declares transparency in the encoded output`);
  assert.ok(chunks.get('ALPH')?.length>1,`${name} contains a real encoded alpha plane`);
 }
});
