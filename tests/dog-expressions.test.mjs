import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=new URL('../art/',import.meta.url);
const bytes=await readFile(new URL('dog-expressions.json',base));
const metadata=JSON.parse(bytes);
const frames=Object.values(metadata.poses).flatMap(p=>p.frames??[p]);
test('additional expressions preserve transparency, measured foot anchors and a bounded runtime payload',async()=>{
 const png=await readFile(new URL('dog-expressions.png',base));
 assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),1024);
 assert.equal(png[25],6,'RGBA PNG');assert.equal(metadata.pngBytes,png.length);
 const original=await Promise.all(['dog-faithful-front.png','dog-faithful-back.png','dog-faithful-atlas.json'].map(f=>readFile(new URL(f,base))));
 assert.ok(original.reduce((s,b)=>s+b.length,0)+png.length+bytes.length<5_000_000);
 for(const action of ['blink','lookLeft','lookRight','paw','bow','finish'])assert.ok(metadata.poses[action]);
 for(const f of frames){
  assert.equal(f.atlas,'expressions');assert.ok(f.width>100&&f.height>200);assert.ok(Number.isFinite(f.anchorX)&&f.anchorX>0&&f.anchorX<f.width);
  const [row,col]=f.cell;assert.ok(f.x>=col*256&&f.x+f.width<=(col+1)*256);assert.ok(f.y>=row*512&&f.y+f.height<=(row+1)*512);
 }
 assert.equal(metadata.poses.finish.frames.length,2);
});
