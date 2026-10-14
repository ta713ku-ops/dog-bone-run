import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('residential atlas preserves transparent source provenance and mobile payload budget', async () => {
  const metadata = JSON.parse(await readFile(new URL('../art/neighborhood-v24/metadata.json', import.meta.url), 'utf8'));
  let bytes = 0, decodedBytes = 0;
  for (const asset of Object.values(metadata.assets)) {
    const output = await readFile(new URL(`../${asset.path}`, import.meta.url));
    const source = await readFile(new URL(`../${asset.source}`, import.meta.url));
    assert.equal(createHash('sha256').update(output).digest('hex'), asset.sha256);
    assert.equal(createHash('sha256').update(source).digest('hex'), asset.sourceSha256);
    assert.equal(output.length, asset.bytes);
    assert.equal(output.toString('ascii', 0, 4), 'RIFF');
    assert.equal(output.toString('ascii', 8, 12), 'WEBP');
    bytes += output.length;
    decodedBytes += asset.width * asset.height * 4;
  }
  assert.equal(bytes, metadata.totalBytes);
  assert.equal(decodedBytes, metadata.totalDecodedBytes);
  assert.ok(bytes <= 700 * 1024);
  assert.ok(metadata.totalDecodedBytes <= 8 * 1024 * 1024);
  for (const { crop: [x, y, width, height], cell: [cx, cy], rootAnchor: [rx, ry] } of Object.values(metadata.houseCells)) {
    assert.ok(x >= cx * 512 && x + width <= (cx + 1) * 512);
    assert.ok(y >= cy * 512 && y + height <= (cy + 1) * 512);
    assert.ok(rx >= x && rx <= x + width && ry >= y && ry <= y + height);
  }
});
