import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(process.argv.includes('--diagnostics')?'device-check':process.argv.includes('--dist') ? 'dist' : '.');
const distribution=process.argv.includes('--dist')||process.argv.includes('--diagnostics');
const index = process.argv.indexOf('--port');
const port = index >= 0 ? Number(process.argv[index + 1]) : Number(process.env.PORT || 4173);
const hostIndex = process.argv.indexOf('--host');
const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
const server = http.createServer(async (req, res) => {
  try {
    const requestUrl=new URL(req.url,'http://localhost');
    let path = decodeURIComponent(requestUrl.pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + sep) || path.split('/').some(s => s.startsWith('.'))) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('not_file');
    // Distribution artwork is content-versioned. Let the browser reuse its
    // compressed HTTP cache while decoded bitmaps remain strictly bounded.
    const cache=distribution&&path.startsWith('/art/')&&requestUrl.searchParams.has('v')
      ?'public, max-age=3600':'no-store';
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => { console.error(error.message); process.exit(1); });
server.listen(port, host, () => console.log(`Dog Bone Run: http://${host}:${port}`));
