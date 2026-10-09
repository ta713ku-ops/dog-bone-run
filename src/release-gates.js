export const RELEASE_GATE_IDS = Object.freeze([
  'code', 'logic', 'save', 'economy', 'road', 'finalassets', 'motion', 'browser',
  'humanDog', 'humanRoad', 'humanDifficulty', 'iOS',
]);

const AUTOMATED_GATES = ['code', 'logic', 'save', 'economy', 'road', 'motion', 'browser'];
const HUMAN_GATES = ['humanDog', 'humanRoad', 'humanDifficulty', 'iOS'];
const HASH_FIELDS = ['scopeHash', 'buildHash', 'codeHash', 'assetsHash', 'configHash'];
const HASH = /^[a-f0-9]{64}$/i;

function isHash(value) { return typeof value === 'string' && HASH.test(value); }

function evidenceIsComplete(evidence) {
  return Array.isArray(evidence) && evidence.length > 0 && evidence.every(item => item
    && typeof item === 'object' && typeof item.path === 'string' && item.path.length > 0
    && isHash(item.sha256));
}

function candidateMatches(candidate, proof) {
  return HASH_FIELDS.every(field => isHash(candidate[field]) && proof?.[field] === candidate[field]);
}

function automatedResult(gateId, candidate, proof) {
  if (!candidateMatches(candidate, candidate)) return gate(gateId, 'PENDING', candidate, 'candidate_hash_incomplete');
  if (!proof) return gate(gateId, 'PENDING', candidate, 'scoped_evidence_missing');
  if (proof.gateId !== gateId || !['PENDING', 'PASS', 'FAIL'].includes(proof.status)) {
    return gate(gateId, 'PENDING', candidate, 'invalid_gate_record');
  }
  if (!candidateMatches(candidate, proof)) return gate(gateId, 'PENDING', candidate, 'evidence_scope_mismatch');
  if (typeof proof.testVersion !== 'string' || !proof.testVersion.trim()
    || typeof proof.executedAt !== 'string' || !Number.isFinite(Date.parse(proof.executedAt))) {
    return gate(gateId, 'PENDING', candidate, 'evidence_metadata_missing');
  }
  if (!evidenceIsComplete(proof.evidence)) return gate(gateId, 'PENDING', candidate, 'hashed_evidence_missing');
  return gate(gateId, proof.status, candidate, proof.reason ?? null, {
    testVersion: proof.testVersion,
    executedAt: proof.executedAt,
    evidence: proof.evidence,
  });
}

function humanResult(gateId, candidate, approval) {
  if (!candidateMatches(candidate, candidate)) return gate(gateId, 'PENDING', candidate, 'candidate_hash_incomplete');
  if (!approval || approval.status !== 'PASS') {
    return gate(gateId, approval?.status === 'FAIL' ? 'FAIL' : 'PENDING', candidate, approval?.reason ?? 'human_review_pending');
  }
  if (approval.gateId !== gateId) return gate(gateId, 'PENDING', candidate, 'human_gate_id_mismatch');
  if (!candidateMatches(candidate, approval)
    || approval.reviewedHash !== candidate.scopeHash
    || approval.reviewedBuildHash !== candidate.buildHash
    || (gateId === 'humanDog' && approval.reviewedAssetsHash !== candidate.assetsHash)) {
    return gate(gateId, 'PENDING', candidate, 'human_review_hash_mismatch');
  }
  if (typeof approval.reviewer !== 'string' || !approval.reviewer.trim()
    || typeof approval.testVersion !== 'string' || !approval.testVersion.trim()
    || typeof approval.executedAt !== 'string' || !Number.isFinite(Date.parse(approval.executedAt))) {
    return gate(gateId, 'PENDING', candidate, 'human_review_record_incomplete');
  }
  if (!evidenceIsComplete(approval.evidence)) return gate(gateId, 'PENDING', candidate, 'human_review_evidence_missing');
  return gate(gateId, 'PASS', candidate, null, {
    reviewer: approval.reviewer,
    testVersion: approval.testVersion,
    executedAt: approval.executedAt,
    evidence: approval.evidence,
    reviewedHash: approval.reviewedHash,
    reviewedBuildHash: approval.reviewedBuildHash,
    ...(gateId === 'humanDog' ? { reviewedAssetsHash: approval.reviewedAssetsHash } : {}),
  });
}

function gate(gateId, status, candidate, reason, extra = {}) {
  return {
    gateId,
    status,
    scopeHash: candidate.scopeHash ?? null,
    buildHash: candidate.buildHash ?? null,
    codeHash: candidate.codeHash ?? null,
    assetsHash: candidate.assetsHash ?? null,
    configHash: candidate.configHash ?? null,
    ...(reason ? { reason } : {}),
    ...extra,
  };
}

function assetsResult(candidate, report) {
  if (!candidateMatches(candidate, candidate)) return gate('finalassets', 'PENDING', candidate, 'candidate_hash_incomplete');
  if (!report || report.assetsHash !== candidate.assetsHash || !isHash(report.scopeHash)) {
    return gate('finalassets', 'PENDING', candidate, 'fresh_asset_validation_missing_or_mismatched');
  }
  if (!Array.isArray(report.failures) || !Array.isArray(report.pending) || !Array.isArray(report.productionAssetIds)) {
    return gate('finalassets', 'PENDING', candidate, 'invalid_asset_validation_report');
  }
  if (report.failures.length > 0) return gate('finalassets', 'FAIL', candidate, 'asset_technical_failures', { failureCount: report.failures.length });
  if (report.pending.length > 0 || report.status === 'PENDING') return gate('finalassets', 'PENDING', candidate, 'asset_validation_pending', { pendingCount: report.pending.length });
  if (report.status !== 'PASS' || report.ok !== true) return gate('finalassets', 'PENDING', candidate, 'asset_report_not_pass');
  const clips = report.clips ?? {};
  const incomplete = report.productionAssetIds.filter(id => clips[id]?.finalEligible !== true
    || clips[id]?.sourceStatus !== 'final' || clips[id]?.technicalStatus !== 'PASS');
  if (incomplete.length > 0) return gate('finalassets', 'PENDING', candidate, 'production_assets_not_final_eligible', { incompleteAssets: incomplete });
  return gate('finalassets', 'PASS', candidate, null, { assetValidationScopeHash: report.scopeHash });
}

/** Combine only evidence records already restricted to the current candidate by the caller. */
export function buildReleaseGateReport({
  candidate = {},
  evidence = {},
  assetReport = null,
  humanApprovals = {},
  economyConfigPending = true,
  executedAt = new Date().toISOString(),
} = {}) {
  const gates = {};
  for (const gateId of AUTOMATED_GATES) {
    const result = automatedResult(gateId, candidate, evidence[gateId]);
    if (gateId === 'economy' && economyConfigPending) {
      gates[gateId] = gate(gateId, 'PENDING', candidate, 'economy_config_pending', {
        proofStatusObserved: result.status,
      });
    } else {
      gates[gateId] = result;
    }
  }
  gates.finalassets = assetsResult(candidate, assetReport);
  const approvalRecords = humanApprovals?.gates ?? {};
  for (const gateId of HUMAN_GATES) gates[gateId] = humanResult(gateId, candidate, approvalRecords[gateId]);

  const ready = RELEASE_GATE_IDS.every(gateId => gates[gateId].status === 'PASS');
  const orderedGates = Object.fromEntries(RELEASE_GATE_IDS.map(gateId => [gateId, gates[gateId]]));
  const statuses = RELEASE_GATE_IDS.map(gateId => gates[gateId].status);
  const failed = statuses.includes('FAIL');
  const finalAssetPending = gates.finalassets.status !== 'PASS';
  const humanPending = HUMAN_GATES.some(id => gates[id].status !== 'PASS');
  const state = ready ? 'PRODUCTION RELEASE READY'
    : failed ? 'AUTO CHECK FAILED'
      : finalAssetPending ? 'FINAL ASSETS PENDING'
        : humanPending ? 'HUMAN REVIEW PENDING' : 'IMPLEMENTATION IN PROGRESS';
  return {
    schemaVersion: 1,
    executedAt,
    ready,
    state,
    candidate: {
      scopeHash: candidate.scopeHash ?? null,
      buildHash: candidate.buildHash ?? null,
      codeHash: candidate.codeHash ?? null,
      assetsHash: candidate.assetsHash ?? null,
      configHash: candidate.configHash ?? null,
    },
    gates: orderedGates,
    verifiedScope: {
      evidenceSource: 'test-results/release-evidence/<gateId>.json with matching candidate hashes',
      gates: RELEASE_GATE_IDS.filter(gateId => gates[gateId].status === 'PASS'),
    },
    unresolved: RELEASE_GATE_IDS.filter(gateId => gates[gateId].status !== 'PASS').map(gateId => ({
      gateId,
      status: gates[gateId].status,
      reason: gates[gateId].reason ?? null,
    })),
    limitations: {
      noProductionReleaseClaim: !ready,
      humanReviewAutomated: false,
      iosDeviceReviewAutomated: false,
      legacyUnscopedBrowserResultsAccepted: false,
    },
  };
}

export function isReleaseEvidencePath(path) {
  return typeof path === 'string'
    && /^test-results\/release-evidence\/[A-Za-z0-9._/-]+$/.test(path)
    && !path.split('/').includes('..');
}

export function isHumanEvidencePath(path) {
  return typeof path === 'string'
    && /^(?:art|test-results\/human-review)\/[a-zA-Z0-9._/-]+$/.test(path)
    && !path.split('/').includes('..');
}
