import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=path=>readFile(new URL(`../${path}`,import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const motion=JSON.parse(await read('art/dog-home-motion.json'));
const base=JSON.parse(await read('art/dog-image-animation.json'));
test('five generated home motions each contain 16 distinct complete frames',async()=>{
 assert.deepEqual(Object.keys(motion.atlases),['sitdown','liedown','tiltleft','tiltright','greet']);
 for(const atlas of Object.values(motion.atlases)){
  assert.equal(atlas.frames.length,16);assert.equal(new Set(atlas.frames.map(f=>f.sourcePixelHash)).size,16);
  assert.equal(atlas.edgeOpaque,0);assert.ok(atlas.transparentFraction>.25);
  const image=await read(atlas.path);assert.equal(image.subarray(8,12).toString(),'WEBP');assert.equal(digest(image),atlas.sha256);
  for(const f of atlas.frames){
   assert.ok(f.x>=0&&f.y>=0&&f.x+f.width<=atlas.width&&f.y+f.height<=atlas.height);
   assert.equal(f.anchorY,atlas.cell-12);assert.equal(f.referenceHeight,336);
  }
 }
});
test('additional home textures stay within the total mobile asset budget',()=>{
 assert.ok(motion.textureBytes+base.textureBytes<64_000_000);
 assert.ok(motion.compressedBytes+base.compressedBytes<4_000_000);
 const lie=motion.atlases.liedown.frames;
 assert.ok(lie.at(-1).sourceBounds.height<lie[0].sourceBounds.height*.9,'lying is lower, without enlarging every pose to a fixed height');
});
test('home motion sources and compiler match their recorded provenance',async()=>{
 for(const input of [...Object.values(motion.sourceSheets),motion.generator])assert.equal(digest(await read(input.path)),input.sha256);
});
