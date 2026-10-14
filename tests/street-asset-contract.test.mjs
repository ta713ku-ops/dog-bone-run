import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('street assets preserve provenance, measured sprite bounds and combined mobile budget', async () => {
  let bytes=0, decoded=0;
  for(const path of ['neighborhood-v24','street-v25']) {
    const metadata=JSON.parse(await readFile(new URL(`../art/${path}/metadata.json`,import.meta.url),'utf8'));
    for(const asset of Object.values(metadata.assets)) {
      const output=await readFile(new URL(`../${asset.path}`,import.meta.url));
      const source=await readFile(new URL(`../${asset.source}`,import.meta.url));
      assert.equal(createHash('sha256').update(output).digest('hex'),asset.sha256);
      assert.equal(createHash('sha256').update(source).digest('hex'),asset.sourceSha256);
      assert.equal(output.length,asset.bytes);
      bytes+=output.length; decoded+=asset.width*asset.height*4;
    }
    for(const [key,cells] of Object.entries(metadata).filter(([key])=>key.endsWith('Cells'))) {
      const asset=metadata.assets[key.replace('Cells','')];
      if(!asset) continue;
      for(const {crop:[x,y,w,h],rootAnchor:[rx,ry]} of Object.values(cells)) {
        assert.ok(x>=0&&y>=0&&x+w<=asset.width&&y+h<=asset.height);
        assert.ok(rx>=x&&rx<=x+w&&ry>=y&&ry<=y+h);
      }
    }
  }
  assert.ok(bytes<700*1024);
  assert.ok(decoded<8*1024*1024);
});
