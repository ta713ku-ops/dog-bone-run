import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const metadata = JSON.parse(await readFile(new URL('../art/park-v23/metadata.json', import.meta.url), 'utf8'));
test('park runtime textures retain source provenance and the bounded mobile payload', async () => {
  let bytes = 0, decoded = 0;
  for (const asset of Object.values(metadata.assets)) {
    const output = await readFile(new URL(`../${asset.path}`, import.meta.url));
    const source = await readFile(new URL(`../${asset.source}`, import.meta.url));
    assert.equal(createHash('sha256').update(output).digest('hex'), asset.sha256);
    assert.equal(createHash('sha256').update(source).digest('hex'), asset.sourceSha256);
    assert.equal(output.length, asset.bytes);
    assert.equal(output.toString('ascii', 0, 4), 'RIFF');
    assert.equal(output.toString('ascii', 8, 12), 'WEBP');
    bytes += output.length;
    decoded += asset.width * asset.height * 4;
  }
  assert.equal(bytes, metadata.totalBytes);
  assert.equal(decoded, metadata.totalDecodedBytes);
  assert.ok(bytes <= 700 * 1024);
  assert.ok(decoded <= 8 * 1024 * 1024);
  for (const { cell, crop, rootAnchor } of Object.values(metadata.treeCells)) {
    const [x, y, width, height] = crop;
    assert.ok(x >= cell[0] * 512 && x + width <= (cell[0] + 1) * 512);
    assert.ok(y >= cell[1] * 512 && y + height <= (cell[1] + 1) * 512);
    assert.ok(rootAnchor[0] >= x && rootAnchor[0] <= x + width);
    assert.ok(rootAnchor[1] >= y && rootAnchor[1] <= y + height);
  }
});
