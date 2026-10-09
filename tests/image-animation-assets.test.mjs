import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const metadata=JSON.parse(await readFile(new URL('../art/dog-image-animation.json',import.meta.url),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('animated WebP assets match the reviewed metadata and remain within the mobile budget',async()=>{
 let bytes=0,decoded=0;
 for(const [name,atlas] of Object.entries(metadata.atlases)){
  const file=await readFile(new URL(`../${atlas.path}`,import.meta.url));
  assert.equal(file.subarray(0,4).toString(),'RIFF');assert.equal(file.subarray(8,12).toString(),'WEBP');
  assert.equal(digest(file),atlas.sha256);assert.equal(file.length,atlas.bytes);bytes+=file.length;decoded+=atlas.width*atlas.height*4;
  assert.equal(atlas.frames.length,name==='postures'?12:8);assert.ok(atlas.edgeOpaque===0);assert.ok(atlas.transparentFraction>.4);
  for(const frame of atlas.frames){
   assert.ok(frame.x>=0&&frame.y>=0&&frame.x+frame.width<=atlas.width&&frame.y+frame.height<=atlas.height);
   assert.equal(frame.referenceHeight,atlas.referenceHeight);assert.equal(frame.anchorX,atlas.cell/2);assert.equal(frame.anchorY,atlas.cell-12);
  }
 }
 assert.equal(bytes,metadata.compressedBytes);assert.equal(decoded,metadata.textureBytes);
 assert.ok(bytes<1_000_000);assert.ok(decoded<18_000_000);
});
test('posture images use a common scale and the lying dog stays naturally lower',()=>{
 const {expressions,postures}=metadata.atlases;
 assert.equal(expressions.referenceHeight,postures.referenceHeight);
 assert.equal(postures.frames[0].referenceHeight,postures.frames[8].referenceHeight);
 assert.ok(postures.frames[8].sourceBounds.height<postures.frames[0].sourceBounds.height*.75);
 assert.ok(postures.frames[11].sourceBounds.height<postures.frames[8].sourceBounds.height);
});
test('generated sheets and packing script match the recorded compiler inputs',async()=>{
 for(const sheet of [...Object.values(metadata.sourceSheets),metadata.generator]) assert.equal(digest(await readFile(new URL(`../${sheet.path}`,import.meta.url))),sheet.sha256);
});
