import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, validateAssetGraph } from '../src/asset-contract.js';
import { isHumanEvidencePath, isReleaseEvidencePath } from '../src/release-gates.js';
import { generateLiveDogAssetReport } from './validate-live-dog.mjs';

export const ASSET_VALIDATOR_VERSION = 'asset-v5.1-2';
export const DEFAULT_ASSET_REPORT = 'test-results/dog-asset-validation.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REPORT_CANDIDATES = 2_000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashObject(value) {
  return sha256(canonicalJSON(value));
}

function safeRelativePath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) return null;
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}

async function optionalHash(root, relative) {
  const target = safeRelativePath(root, relative);
  if (!target) return null;
  try { return sha256(await readFile(target)); } catch { return null; }
}

async function directoryHash(root, relative) {
  const directory = safeRelativePath(root, relative);
  if (!directory) return null;
  const files = [];
  async function visit(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(directory);
  if (files.length === 0) return null;
  const hash = createHash('sha256');
  for (const absolute of files.sort((a, b) => a.localeCompare(b))) {
    hash.update(absolute.slice(root.length + 1).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(await readFile(absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function verifyStanceEvidence(root, manifest) {
  const statuses = {};
  const details = {};
  for (const [assetId, asset] of Object.entries(manifest.assets ?? {})) {
    const records = asset?.stanceFootEvidence?.evidence;
    if (!Array.isArray(records) || records.length === 0) continue;
    let valid = true;
    for (const record of records) {
      if (!isReleaseEvidencePath(record?.path) || !/^[a-f0-9]{64}$/i.test(record?.sha256 ?? '')) {
        valid = false;
        break;
      }
      const target = safeRelativePath(root, record.path);
      if (!target) { valid = false; break; }
      try {
        if (sha256(await readFile(target)) !== record.sha256.toLowerCase()) { valid = false; break; }
      } catch { valid = false; break; }
    }
    statuses[assetId] = valid ? 'PASS' : 'FAIL';
    details[assetId] = { status: statuses[assetId], evidenceCount: records.length };
  }
  return { statuses, details };
}

async function loadSharp() {
  const candidates = [
    process.env.DOG_SHARP_MODULE,
    'sharp',
    '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.mjs',
  ].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try { return (await import(candidate)).default; } catch (error) { lastError = error; }
  }
  throw new Error(`A PNG/WebP decoder is required (set DOG_SHARP_MODULE). ${lastError?.message ?? ''}`.trim());
}

async function manualDogReview(root, approvals) {
  const record = approvals?.gates?.humanDog ?? null;
  if (record?.status !== 'PASS') return record;
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) return { ...record, status: 'PENDING', evidence: [] };
  for (const item of record.evidence) {
    if (!isHumanEvidencePath(item?.path) || !/^[a-f0-9]{64}$/i.test(item?.sha256 ?? '')) return { ...record, status: 'PENDING', evidence: [] };
    const target = safeRelativePath(root, item.path);
    if (!target) return { ...record, status: 'PENDING', evidence: [] };
    try {
      if (sha256(await readFile(target)) !== item.sha256.toLowerCase()) return { ...record, status: 'PENDING', evidence: [] };
    } catch { return { ...record, status: 'PENDING', evidence: [] }; }
  }
  return record;
}

export async function generateDogAssetReport({
  root = ROOT,
  writeReport = true,
  reportPath = DEFAULT_ASSET_REPORT,
  executedAt = new Date().toISOString(),
  humanApprovals,
  sharp: sharpOverride,
} = {}) {
  const projectRoot = path.resolve(root);
  const manifestPath = path.join(projectRoot, 'art/dog-asset-inventory.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest?.schemaVersion === 3) {
    return generateLiveDogAssetReport({
      root: projectRoot,
      manifest,
      manifestBytes,
      writeReport,
      reportPath,
      executedAt,
      humanApprovals,
    });
  }
  const sharp = sharpOverride ?? await loadSharp();
  const imageInfo = {};
  const imageHashes = {};
  const imageMetadata = {};
  const assetHashes = {};
  const alphaFringeCandidates = [];
  const candidatePaths = [];
  const errors = [];

  if (!manifest.images || typeof manifest.images !== 'object' || Array.isArray(manifest.images)) {
    throw new Error('manifest images map is required');
  }
  for (const [imageId, relativePath] of Object.entries(manifest.images)) {
    const imagePath = safeRelativePath(projectRoot, relativePath);
    if (!imagePath) {
      imageInfo[imageId] = { decoded: false };
      errors.push({ imageId, error: 'image_path_outside_project' });
      continue;
    }
    try {
      const bytes = await readFile(imagePath);
      const metadata = await sharp(bytes).metadata();
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const hash = sha256(bytes);
      imageHashes[imageId] = hash;
      imageMetadata[imageId] = { path: relativePath, hash, width: metadata.width, height: metadata.height, format: metadata.format, hasAlpha: metadata.hasAlpha === true };
      imageInfo[imageId] = {
        decoded: true,
        width: info.width,
        height: info.height,
        channels: info.channels,
        format: metadata.format,
        hasAlpha: metadata.hasAlpha === true,
        hash,
        pixelData: data,
      };
    } catch (error) {
      imageInfo[imageId] = { decoded: false };
      errors.push({ imageId, error: error?.message ?? 'decode_failed' });
    }
  }

  const assetsHash = hashObject({
    manifestHash: sha256(manifestBytes),
    imageHashes: Object.fromEntries(Object.entries(imageHashes).sort(([a], [b]) => a.localeCompare(b))),
  });
  for (const [assetId, asset] of Object.entries(manifest.assets ?? {})) {
    const referencedImageIds = [...new Set([asset.imageId, ...(asset.frames ?? []).map(frame => frame?.imageId)].filter(Boolean))].sort();
    const referencedImages = Object.fromEntries(referencedImageIds.map(id => [id, imageHashes[id] ?? null]));
    const fingerprint = hashObject({ assetId, asset, referencedImages });
    assetHashes[assetId] = fingerprint;
    imageMetadata[`asset:${assetId}`] = { assetHash: fingerprint, imageIds: referencedImageIds };
  }

  const [rendererBuildHash, stanceEvidence] = await Promise.all([
    directoryHash(projectRoot, 'dist'),
    verifyStanceEvidence(projectRoot, manifest),
  ]);

  const [contractSourceHash, scriptSourceHash, raisingConfigHash, projectConfigHash, roadConfigHash] = await Promise.all([
    optionalHash(projectRoot, 'src/asset-contract.js'),
    optionalHash(projectRoot, 'scripts/validate-dog-assets.mjs'),
    optionalHash(projectRoot, 'src/raising-config.js'),
    optionalHash(projectRoot, 'src/config.js'),
    optionalHash(projectRoot, 'src/road-comfort.js'),
  ]);
  const configHashes = {
    raisingConfig: raisingConfigHash,
    projectConfig: projectConfigHash,
    roadConfig: roadConfigHash,
  };
  const scopeHash = hashObject({
    validatorVersion: ASSET_VALIDATOR_VERSION,
    manifestHash: sha256(manifestBytes),
    assetsHash,
    validatorSourceHash: contractSourceHash,
    scriptSourceHash,
    configHashes,
    rendererBuildHash,
    limits: { edgeTransparentMarginSourcePx: 2, maxContactErrorCssPx: 3, maxFootDriftCssPx: 3, maxFrameScaleSpread: 0.05, maxClipScaleSpread: 0.08 },
  });

  const review = await manualDogReview(projectRoot, humanApprovals);
  const result = validateAssetGraph(manifest, imageInfo, {
    assetsHash,
    assetHashes,
    rendererBuildHash,
    verifiedStanceEvidence: stanceEvidence.statuses,
    humanDogReview: review,
  });
  for (const [id, clip] of Object.entries(result.clips)) {
    for (const sample of clip.alphaFringeCandidates) {
      if (candidatePaths.length >= MAX_REPORT_CANDIDATES) break;
      candidatePaths.push({ assetId: id, ...sample });
    }
  }
  for (const [imageId, info] of Object.entries(imageInfo)) {
    delete info.pixelData;
  }

  const requiredIds = result.productionAssetIds;
  const finalPending = requiredIds.filter(id => result.clips[id]?.sourceStatus !== 'final');
  const report = {
    schemaVersion: 1,
    validatorVersion: ASSET_VALIDATOR_VERSION,
    executedAt,
    status: result.ok ? 'PASS' : result.failures.length > 0 ? 'FAIL' : 'PENDING',
    ok: result.ok,
    scopeHash,
    assetsHash,
    manifestHash: sha256(manifestBytes),
    validatorSourceHash: contractSourceHash,
    validatorScriptHash: scriptSourceHash,
    configHashes,
    buildHash: rendererBuildHash,
    imageHashes,
    assetHashes,
    imageMetadata,
    productionAssetIds: requiredIds,
    finalAssetsPending: finalPending,
    alphaFringeReview: { status: candidatePaths.length === 0 ? 'NO_CANDIDATES' : 'PENDING', candidates: candidatePaths },
    stanceFootReview: Object.values(stanceEvidence.statuses).includes('FAIL') ? 'FAIL'
      : result.pending.some(item => item.reason.includes('stance_world_drift')) ? 'PENDING' : 'PASS',
    stanceFootEvidence: stanceEvidence.details,
    humanDogReview: review?.status === 'PASS' && review.reviewedAssetsHash === assetsHash ? 'PASS' : 'PENDING',
    humanDogEvidenceVerified: review?.status === 'PASS' && review.reviewedAssetsHash === assetsHash,
    failures: result.failures,
    pending: result.pending,
    clips: result.clips,
    decodeErrors: errors,
    verificationScope: {
      verified: ['manifest reference graph declarations', 'PNG/WebP decode', 'actual source pixel alpha bounds and crop margins', 'per-frame crop resolution and anchors', 'declared foot contact geometry', 'frame and loop scale/ground continuity', 'hash-bound stance-drift evidence when supplied'],
      notVerified: ['human visual quality and alpha fringe judgement', 'unsubmitted renderer stance-foot evidence', 'motion playtest without scoped motion evidence'],
    },
  };

  if (writeReport) {
    const outputPath = path.resolve(projectRoot, reportPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const approvalsPath = path.join(ROOT, 'art/human-approvals.json');
    let humanApprovals;
    try { humanApprovals = JSON.parse(await readFile(approvalsPath, 'utf8')); } catch { humanApprovals = null; }
    const report = await generateDogAssetReport({ humanApprovals });
    console.log(JSON.stringify({
      status: report.status,
      failures: report.failures.length,
      pending: report.pending.length,
      requiredAssets: report.productionAssetIds.length,
      finalAssetsPending: report.finalAssetsPending.length,
      scopeHash: report.scopeHash,
      report: DEFAULT_ASSET_REPORT,
    }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Asset validation failed to execute: ${error?.message ?? error}`);
    process.exitCode = 2;
  }
}
