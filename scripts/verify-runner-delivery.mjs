import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const version = JSON.parse(await readFile('dist/version.json', 'utf8'));
const origins = process.argv.slice(2);
assert.ok(origins.length, 'Pass production server URLs to verify');
const files = ['index.html', 'styles.css', 'favicon.svg', 'version.json', ...version.modules, ...version.assets];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [];
for (const origin of origins) {
  for (const file of files) {
    const url = new URL(`${file === 'index.html' ? '' : file}?v=${version.buildVersion}`, `${origin}/`);
    const response = await fetch(url);
    assert.equal(response.status, 200, url.href);
    assert.equal(response.headers.get('cache-control'), 'no-store', url.href);
    const expected = await readFile(`dist/${file}`);
    const received = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(received), digest(expected), `Served bytes differ: ${url.href}`);
    checks.push({ url: url.href, bytes: received.length, sha256: digest(received) });
  }
  for (const obsolete of ['src/raising-controller.js', 'src/raising-model.js', 'src/dog-3d-renderer.js', 'src/dog-3d-model.js', 'src/home-scene.js', 'src/home-animation.js']) {
    assert.equal((await fetch(new URL(obsolete, `${origin}/`))).status, 404);
  }
}
await mkdir('test-results', { recursive: true });
const result = { checkedAt: new Date().toISOString(), version, origins, filesPerOrigin: files.length, checks, errors: [] };
await writeFile('test-results/runner-delivery-results.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ buildVersion: version.buildVersion, origins, filesPerOrigin: files.length, errors: [] }, null, 2));
