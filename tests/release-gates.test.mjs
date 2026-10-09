import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_GATE_IDS, buildReleaseGateReport, isHumanEvidencePath, isReleaseEvidencePath } from '../src/release-gates.js';

const candidate = Object.freeze({
  scopeHash: '1'.repeat(64),
  buildHash: '2'.repeat(64),
  codeHash: '3'.repeat(64),
  assetsHash: '4'.repeat(64),
  configHash: '5'.repeat(64),
});

const evidenceRef = path => ({ path, sha256: 'a'.repeat(64) });

function automationProof(gateId, overrides = {}) {
  return {
    gateId,
    status: 'PASS',
    ...candidate,
    testVersion: `${gateId}-test-v1`,
    executedAt: '2026-10-04T00:00:00.000Z',
    evidence: [evidenceRef(`test-results/release-evidence/${gateId}.json`)],
    ...overrides,
  };
}

function humanApproval(gateId, overrides = {}) {
  return {
    gateId,
    status: 'PASS',
    ...candidate,
    reviewedHash: candidate.scopeHash,
    reviewedBuildHash: candidate.buildHash,
    ...(gateId === 'humanDog' ? { reviewedAssetsHash: candidate.assetsHash } : {}),
    reviewer: 'reviewer-1',
    testVersion: `${gateId}-review-v1`,
    executedAt: '2026-10-04T00:00:00.000Z',
    evidence: [evidenceRef('art/human-review/review.png')],
    ...overrides,
  };
}

function finalAssetsReport(overrides = {}) {
  return {
    status: 'PASS',
    ok: true,
    scopeHash: '6'.repeat(64),
    assetsHash: candidate.assetsHash,
    failures: [],
    pending: [],
    productionAssetIds: ['dog-front'],
    clips: { 'dog-front': { sourceStatus: 'final', technicalStatus: 'PASS', finalEligible: true } },
    ...overrides,
  };
}

function allProofs() {
  return Object.fromEntries(['code', 'logic', 'save', 'economy', 'road', 'motion', 'browser'].map(id => [id, automationProof(id)]));
}

function allApprovals() {
  return { gates: Object.fromEntries(['humanDog', 'humanRoad', 'humanDifficulty', 'iOS'].map(id => [id, humanApproval(id)])) };
}

test('fresh release report creates explicit PENDING states for every unproven gate', () => {
  const report = buildReleaseGateReport({ candidate: {}, economyConfigPending: true });
  assert.equal(report.ready, false);
  assert.equal(report.state, 'FINAL ASSETS PENDING');
  assert.deepEqual(Object.keys(report.gates), [...RELEASE_GATE_IDS]);
  assert.ok(Object.values(report.gates).every(item => item.status === 'PENDING'));
  assert.equal(report.limitations.iosDeviceReviewAutomated, false);
  assert.equal(report.limitations.legacyUnscopedBrowserResultsAccepted, false);
});

test('unscoped or stale browser artifacts do not pass the browser gate', () => {
  const evidence = allProofs();
  evidence.browser = automationProof('browser', { codeHash: 'f'.repeat(64) });
  const report = buildReleaseGateReport({ candidate, evidence, economyConfigPending: false });
  assert.equal(report.gates.browser.status, 'PENDING');
  assert.equal(report.gates.browser.reason, 'evidence_scope_mismatch');
  assert.equal(report.gates.finalassets.status, 'PENDING');
});

test('provisional economy config cannot be converted to PASS by an evidence record', () => {
  const report = buildReleaseGateReport({ candidate, evidence: allProofs(), economyConfigPending: true });
  assert.equal(report.gates.economy.status, 'PENDING');
  assert.equal(report.gates.economy.reason, 'economy_config_pending');
  assert.equal(report.gates.economy.proofStatusObserved, 'PASS');
});

test('final assets require clean technical report and hash-bound final-eligible production clips', () => {
  const evidence = allProofs();
  const pendingClipReport = finalAssetsReport({ clips: { 'dog-front': { sourceStatus: 'candidate', technicalStatus: 'PASS', finalEligible: false } } });
  const pending = buildReleaseGateReport({ candidate, evidence, assetReport: pendingClipReport, economyConfigPending: false });
  assert.equal(pending.gates.finalassets.status, 'PENDING');
  assert.equal(pending.gates.finalassets.reason, 'production_assets_not_final_eligible');

  const failed = buildReleaseGateReport({ candidate, evidence, assetReport: finalAssetsReport({ failures: [{ reason: 'crop' }] }), economyConfigPending: false });
  assert.equal(failed.gates.finalassets.status, 'FAIL');
  assert.equal(failed.state, 'AUTO CHECK FAILED');
});

test('human approval must name the exact current build and assets, and have hashed evidence', () => {
  const approvals = allApprovals();
  approvals.gates.humanDog = humanApproval('humanDog', { reviewedBuildHash: 'f'.repeat(64) });
  approvals.gates.iOS = humanApproval('iOS', { evidence: [] });
  const report = buildReleaseGateReport({ candidate, evidence: allProofs(), assetReport: finalAssetsReport(), humanApprovals: approvals, economyConfigPending: false });
  assert.equal(report.gates.humanDog.status, 'PENDING');
  assert.equal(report.gates.humanDog.reason, 'human_review_hash_mismatch');
  assert.equal(report.gates.iOS.status, 'PENDING');
  assert.equal(report.gates.iOS.reason, 'human_review_evidence_missing');
});

test('all twelve current-scope evidence records are required before ready is true', () => {
  const report = buildReleaseGateReport({
    candidate,
    evidence: allProofs(),
    assetReport: finalAssetsReport(),
    humanApprovals: allApprovals(),
    economyConfigPending: false,
  });
  assert.equal(report.ready, true);
  assert.equal(report.state, 'PRODUCTION RELEASE READY');
  assert.deepEqual(report.verifiedScope.gates, [...RELEASE_GATE_IDS]);
  assert.deepEqual(report.unresolved, []);
});

test('evidence path allowlists exclude old unscoped results and traversal', () => {
  assert.equal(isReleaseEvidencePath('test-results/release-evidence/browser-run.json'), true);
  assert.equal(isReleaseEvidencePath('test-results/browser-results.json'), false);
  assert.equal(isReleaseEvidencePath('test-results/release-evidence/../browser-results.json'), false);
  assert.equal(isHumanEvidencePath('art/human-review/dog-art.png'), true);
  assert.equal(isHumanEvidencePath('art/../dog-asset-inventory.json'), false);
});
