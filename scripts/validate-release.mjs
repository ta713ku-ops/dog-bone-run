import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON } from '../src/asset-contract.js';
import { ECONOMY_CONFIG_FINALIZED } from '../src/raising-config.js';
import { buildReleaseGateReport, isHumanEvidencePath, isReleaseEvidencePath } from '../src/release-gates.js';
import { generateDogAssetReport } from './validate-dog-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = 'test-results/release-gates.json';
const APPROVALS_PATH = 'art/human-approvals.json';
const AUTOMATED_GATE_IDS = ['code', 'logic', 'save', 'economy', 'road', 'motion', 'browser'];
const HUMAN_GATE_IDS = ['humanDog', 'humanRoad', 'humanDifficulty', 'iOS'];

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function safePath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) return null;
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}

async function readJson(relative) {
  const file = safePath(ROOT, relative);
  if (!file) return null;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function filesUnder(relative) {
  const root = safePath(ROOT, relative);
  if (!root) return [];
  const found = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) found.push(absolute);
    }
  }
  await visit(root);
  return found;
}

async function hashFileSet(files) {
  if (!files.length) return null;
  const rootPrefix = `${ROOT}${path.sep}`;
  const hash = createHash('sha256');
  for (const absolute of [...files].sort((a, b) => a.localeCompare(b))) {
    const relative = absolute.slice(rootPrefix.length).split(path.sep).join('/');
    hash.update(relative);
    hash.update('\0');
    hash.update(await readFile(absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function sourceHash() {
  const files = [];
  for (const directory of ['src', 'scripts', 'tests']) {
    for (const file of await filesUnder(directory)) {
      if (/\.(?:js|mjs)$/.test(file)) files.push(file);
    }
  }
  for (const relative of ['index.html', 'styles.css', 'package.json']) {
    const absolute = safePath(ROOT, relative);
    if (absolute) {
      try { if ((await stat(absolute)).isFile()) files.push(absolute); } catch {}
    }
  }
  return hashFileSet(files);
}

async function configHash() {
  const files = [];
  for (const relative of ['src/raising-config.js', 'src/config.js', 'src/raising-course.js', 'src/road-comfort.js']) {
    const absolute = safePath(ROOT, relative);
    if (!absolute) continue;
    try { if ((await stat(absolute)).isFile()) files.push(absolute); } catch {}
  }
  return hashFileSet(files);
}

async function buildHash() {
  const files = await filesUnder('dist');
  return files.length ? hashFileSet(files) : null;
}

function initialHumanApprovals() {
  const pendingRecord = gateId => ({
    gateId,
    status: 'PENDING',
    scopeHash: null,
    buildHash: null,
    codeHash: null,
    assetsHash: null,
    configHash: null,
    reviewedHash: null,
    reviewedBuildHash: null,
    ...(gateId === 'humanDog' ? { reviewedAssetsHash: null } : {}),
    reviewer: null,
    testVersion: null,
    executedAt: null,
    evidence: [],
    reason: 'human_review_not_recorded',
  });
  return {
    schemaVersion: 1,
    gates: Object.fromEntries(HUMAN_GATE_IDS.map(gateId => [gateId, pendingRecord(gateId)])),
  };
}

async function ensureHumanApprovals() {
  const target = safePath(ROOT, APPROVALS_PATH);
  try {
    const value = JSON.parse(await readFile(target, 'utf8'));
    if (value?.schemaVersion !== 1 || !value.gates || typeof value.gates !== 'object' || Array.isArray(value.gates)
      || HUMAN_GATE_IDS.some(gateId => value.gates[gateId]?.gateId !== gateId)) {
      return { value: null, created: false, error: 'human_approvals_invalid_schema' };
    }
    return { value, created: false, error: null };
  }
  catch (error) {
    if (error?.code !== 'ENOENT') return { value: null, created: false, error: 'human_approvals_unreadable' };
    const value = initialHumanApprovals();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }).catch(async writeError => {
      if (writeError?.code !== 'EEXIST') throw writeError;
    });
    try { return { value: JSON.parse(await readFile(target, 'utf8')), created: true, error: null }; }
    catch { return { value: null, created: false, error: 'human_approvals_unreadable' }; }
  }
}

async function verifyEvidenceEntries(proof, { human = false } = {}) {
  if (!Array.isArray(proof?.evidence) || proof.evidence.length === 0) return false;
  for (const item of proof.evidence) {
    const pathIsAllowed = human ? isHumanEvidencePath(item?.path) : isReleaseEvidencePath(item?.path);
    if (!pathIsAllowed || !/^[a-f0-9]{64}$/i.test(item?.sha256 ?? '')) return false;
    const target = safePath(ROOT, item.path);
    if (!target) return false;
    try {
      if (sha256(await readFile(target)) !== item.sha256.toLowerCase()) return false;
    } catch { return false; }
  }
  return true;
}

async function loadScopedEvidence() {
  const evidence = {};
  const warnings = [];
  for (const gateId of AUTOMATED_GATE_IDS) {
    const relative = `test-results/release-evidence/${gateId}.json`;
    const proof = await readJson(relative);
    if (!proof) continue;
    if (proof.status === 'PASS' && !(await verifyEvidenceEntries(proof))) {
      evidence[gateId] = { ...proof, evidence: [] };
      warnings.push({ path: relative, reason: 'evidence_file_missing_or_hash_mismatch' });
    } else {
      evidence[gateId] = proof;
    }
  }
  return { evidence, warnings };
}

async function validateHumanEvidence(approvals) {
  const cloned = approvals && typeof approvals === 'object' ? structuredClone(approvals) : {};
  for (const gateId of HUMAN_GATE_IDS) {
    const record = cloned?.gates?.[gateId];
    if (record?.status === 'PASS' && !(await verifyEvidenceEntries(record, { human: true }))) {
      cloned.gates[gateId] = { ...record, evidence: [] };
    }
  }
  return cloned;
}

export async function generateReleaseReport({ executedAt = new Date().toISOString() } = {}) {
  await mkdir(path.join(ROOT, 'test-results'), { recursive: true });
  const approvalState = await ensureHumanApprovals();
  const approvalsForAssets = approvalState.value;
  const assetReport = await generateDogAssetReport({ root: ROOT, humanApprovals: approvalsForAssets });
  const [codeHash, assetsHash, configDigest, buildDigest] = await Promise.all([
    sourceHash(), Promise.resolve(assetReport.assetsHash), configHash(), buildHash(),
  ]);
  const configHashValue = configDigest;
  const buildHashValue = buildDigest;
  const hashInputsComplete = [codeHash, assetsHash, configHashValue, buildHashValue].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value));
  const candidateFields = { codeHash, assetsHash, configHash: configHashValue, buildHash: buildHashValue };
  const scopeHash = sha256(canonicalJSON(candidateFields));
  const candidate = { ...candidateFields, scopeHash: hashInputsComplete ? scopeHash : null };
  const { evidence, warnings } = await loadScopedEvidence();
  const humanApprovals = await validateHumanEvidence(approvalState.value);
  const report = buildReleaseGateReport({
    candidate,
    evidence,
    assetReport,
    humanApprovals,
    economyConfigPending: ECONOMY_CONFIG_FINALIZED !== true,
    executedAt,
  });
  report.inputs = {
    assetReportPath: 'test-results/dog-asset-validation.json',
    humanApprovalsPath: APPROVALS_PATH,
    humanApprovalsCreated: approvalState.created,
    humanApprovalsError: approvalState.error,
    scopedEvidenceDirectory: 'test-results/release-evidence/',
    ignoredUnscopedResults: ['test-results/browser-results.json', 'test-results/phase4-browser-results.json', 'test-results/adventure-browser-results.json'],
    warnings,
    hashInputsComplete,
  };
  report.verificationScope = {
    ...report.verificationScope,
    codeHashMethod: 'SHA-256 over sorted src/scripts/tests JavaScript plus index.html, styles.css, and package.json',
    assetsHashMethod: 'SHA-256 over the live inventory and model, rig and renderer module bytes',
    configHashMethod: 'SHA-256 over available raising, project, course, and road config files',
    buildHashMethod: buildHashValue ? 'SHA-256 over every current dist file' : 'no dist build exists; buildHash is unavailable',
    candidateHashInputsComplete: hashInputsComplete,
  };
  report.limitations = {
    ...report.limitations,
    economyConfigPending: ECONOMY_CONFIG_FINALIZED !== true,
    iosRequiresPhysicalDevice: true,
    noUnscopedBrowserArtifactsUsed: true,
    noHumanApprovalGeneratedByValidator: true,
  };
  const reportFile = path.join(ROOT, REPORT_PATH);
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await generateReleaseReport();
    console.log(JSON.stringify({
      ready: report.ready,
      state: report.state,
      pending: Object.values(report.gates).filter(item => item.status === 'PENDING').length,
      failed: Object.values(report.gates).filter(item => item.status === 'FAIL').length,
      scopeHash: report.candidate.scopeHash,
      report: REPORT_PATH,
      humanApprovalsCreated: report.inputs.humanApprovalsCreated,
    }, null, 2));
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    console.error(`Release validation failed to execute: ${error?.message ?? error}`);
    process.exitCode = 2;
  }
}
