import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('perspective street assets retain source provenance and bounded texture memory', async()=>{
  const metadata=JSON.parse(await readFile(new URL('../art/street-v26/metadata.json',import.meta.url),'utf8'));
  let bytes=0,rgba=0;
  for(const asset of Object.values(metadata.assets)) {
    for(const [path,hash] of [[asset.path,asset.sha256],[asset.source,asset.sourceSha256]]) {
      const data=await readFile(new URL(`../${path}`,import.meta.url));
      assert.equal(createHash('sha256').update(data).digest('hex'),hash,path);
    }
    const data=await readFile(new URL(`../${asset.path}`,import.meta.url));
    assert.equal(data.length,asset.bytes);
    bytes+=data.length;rgba+=asset.width*asset.height*4;
  }
  for(const [path,hash] of [[metadata.generator,metadata.generatorSha256],
    [metadata.toyGenerator,metadata.toyGeneratorSha256],[metadata.facadeGenerator,metadata.facadeGeneratorSha256],
    [metadata.foliageGenerator,metadata.foliageGeneratorSha256],
    [metadata.variantGenerator,metadata.variantGeneratorSha256]]) {
    assert.equal(createHash('sha256').update(await readFile(new URL(`../${path}`,import.meta.url))).digest('hex'),hash);
  }
  assert.ok(bytes<600*1024);
  assert.ok(rgba<=10*1024*1024);
  for(const cell of Object.values(metadata.toyCells)) {
    const [x,y,w,h]=cell.crop;
    assert.ok(x>=0&&y>=0&&x+w<=512&&y+h<=256);
  }
});
