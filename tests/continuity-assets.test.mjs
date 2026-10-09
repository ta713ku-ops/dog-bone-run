import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('continuous assets contain repaired 48/32 distinct uniform phases, matching provenance and mobile budgets',async()=>{
 const m=JSON.parse(await readFile('art/dog-home-continuity.json'));
 const evidence=JSON.parse(await readFile('art/continuity/compiler-evidence.json'));assert.ok(evidence.metrics.sitdown.frontPawDriftCss<=2);
 const base=JSON.parse(await readFile('art/dog-image-animation.json'));
 assert.equal(m.mode,'continuous-home-motion');
 assert.equal(evidence.metrics.sitdown.sourceKeyframes.length,16,'sit retains its authored body poses');
 assert.ok(evidence.metrics.liedown.sourceKeyframes.length>=6,'lie has actual joint-bending anchors');
 assert.ok(evidence.metrics.liedown.originalLieEndpointExact);
 for(const k of ['sitdown','liedown'])assert.ok(evidence.metrics[k].maxEyeStepPx<18,'adjacent head poses remain close');
 for(const source of [...Object.values(m.sourceSheets),m.generator,...Object.values(m.atlases)])assert.equal(hash(await readFile(source.path)),source.sha256,source.path);
 let textures=0,downloads=0;
 for(const [key,a] of Object.entries(m.atlases)){
  assert.equal(a.prealigned,true);const count=['sitdown','liedown'].includes(key)?48:32;assert.equal(a.frames.length,count);assert.equal(new Set(a.frames.map(f=>f.pixelSha256)).size,count,key);
  for(const [i,f] of a.frames.entries()){
   assert.equal(f.phase,i/(a.frames.length-1));assert.ok(f.x+f.width<=a.width&&f.y+f.height<=a.height);
   assert.equal((f.anchorX+f.offsetX)/f.canvasWidth,.5);assert.equal((f.anchorY+f.offsetY)/f.canvasHeight,372/384);
  }
  textures+=a.width*a.height*4;downloads+=a.bytes;
 }
 assert.ok(textures+base.textureBytes<80_000_000);assert.ok(downloads+base.compressedBytes<5_000_000);
 const frames=key=>m.atlases[key].frames;
 for(const k of ['tiltleft','tiltright','greet'])assert.equal(frames(k)[0].pixelSha256,frames('sitdown')[0].pixelSha256);
 assert.equal(frames('liedown')[0].pixelSha256,frames('sitdown').at(-1).pixelSha256);
});
