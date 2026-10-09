import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLiveDogAssetReport } from '../src/live-dog-contract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = 'test-results/dog-asset-validation.json';

export { generateLiveDogAssetReport };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifestBytes = await readFile(path.join(ROOT, 'art/dog-asset-inventory.json'));
    const manifest = JSON.parse(manifestBytes);
    let humanApprovals = null;
    try { humanApprovals = JSON.parse(await readFile(path.join(ROOT, 'art/human-approvals.json'), 'utf8')); } catch { /* Human approval remains pending. */ }
    const report = await generateLiveDogAssetReport({ root: ROOT, manifest, manifestBytes, reportPath: REPORT_PATH, humanApprovals });
    console.log(JSON.stringify({
      status: report.status,
      technicalStatus: report.technicalChecks?.status ?? report.status,
      failures: report.failures.length,
      pending: report.pending.length,
      requiredBehaviors: report.productionAssetIds.length,
      finalAssetsPending: report.finalAssetsPending.length,
      buildHash: report.buildHash,
      sourceStatus: report.sourceStatus,
      humanDogReview: report.humanDogReview,
      integrationChecks: report.technicalChecks?.integrationChecks ?? {},
      report: REPORT_PATH,
    }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Live dog validation failed to execute: ${error?.message ?? error}`);
    process.exitCode = 2;
  }
}
