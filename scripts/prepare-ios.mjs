import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distribution = join(root, 'dist');
const destination = join(root, 'ios', 'DogBoneRun', 'Resources', 'Site');
const stage = `${destination}.next`;
const requiredFiles = [
  'index.html', 'styles.css', 'journey.css', 'journey-tools.css', 'manifest.webmanifest', 'sw.js',
  'version.json', 'offline-index.json', 'src/app.js', 'src/journey-catalog.js',
  'src/journey-course.js', 'src/journey-ui.js', 'src/journey-transfer.js',
  'src/journey-photo.js', 'src/journey-offline.js', 'src/journey-photos.js', 'src/journey-life.js',
  'src/journey-moments.js', 'src/journey-extras.js', 'src/journey-commerce.js',
];
const routeIds = [
  'street-1', 'street-2', 'street-3', 'park-1', 'park-2', 'park-3',
  'mountain-1', 'mountain-2', 'mountain-3', 'cave-1', 'cave-2', 'cave-3', 'dusk-1', 'dusk-2', 'dusk-3',
];
const maxBundleBytes = 256 * 1024 * 1024;

async function assertNoSymlinks(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    const metadata = await lstat(fullPath);
    if (metadata.isSymbolicLink()) throw new Error(`Refusing symlink in web distribution: ${fullPath}`);
    if (entry.isDirectory()) await assertNoSymlinks(fullPath);
  }
}

async function inventory(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(fullPath));
    else result.push({ path: fullPath, size: (await stat(fullPath)).size });
  }
  return result;
}

try {
  for (const path of requiredFiles) {
    try { await stat(join(distribution, path)); }
    catch { throw new Error(`Missing ${path}; run npm run build after the web implementation is complete.`); }
  }
  await assertNoSymlinks(distribution);

  const version = JSON.parse(await readFile(join(distribution, 'version.json'), 'utf8'));
  const modules = new Set(version.modules ?? []);
  for (const path of requiredFiles.filter(path => path.startsWith('src/'))) {
    if (!modules.has(path)) throw new Error(`The production module graph does not include ${path}; rebuild the site.`);
  }
  const catalog = await readFile(join(distribution, 'src/journey-catalog.js'), 'utf8');
  const missingRoutes = routeIds.filter(id => !catalog.includes(`'${id}'`));
  if (missingRoutes.length) throw new Error(`The production journey catalog is incomplete: ${missingRoutes.join(', ')}`);

  const files = await inventory(distribution);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > maxBundleBytes) throw new Error(`Web distribution is too large to bundle (${totalBytes} bytes).`);

  await mkdir(dirname(destination), { recursive: true });
  await rm(stage, { recursive: true, force: true });
  await cp(distribution, stage, { recursive: true, errorOnExist: true, force: false });
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log(`Prepared iOS bundle: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, version ${version.buildVersion}.`);
} catch (error) {
  await rm(stage, { recursive: true, force: true });
  console.error(error.message);
  process.exitCode = 1;
}
