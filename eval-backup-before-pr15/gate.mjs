#!/usr/bin/env node
/**
 * AQUA Eval — gate CLI
 * Blueprint E2/PR-6
 *
 *   npm run eval:gate           run every suite that has a baseline, compare, exit
 *   npm run eval:gate -- --update   regenerate the baselines (deliberate act)
 *
 * EXIT CODES
 *   0  every metric held or improved
 *   1  a metric regressed, a measurement disappeared, the dataset changed,
 *      or a run was incomplete
 *
 * Suites WITHOUT a committed baseline are reported and skipped rather than
 * failing. The self-test suite has no baseline by design — it grades the
 * harness, and a harness self-check is not a quality metric to gate on.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runSuite } from './core/runner.mjs';
import { compareToBaseline, gateReport, NOT_GATED } from './core/gate.mjs';
import { toJSON } from './core/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = path.join(HERE, 'suites');
const BASELINES = path.join(HERE, 'baselines');
const args = process.argv.slice(2);
const update = args.includes('--update');
const named = args.filter(a => !a.startsWith('--'));

// `--update` must name the suite it is rewriting. The first version rewrote
// EVERY baseline from one command, which is how three of them were replaced —
// including the harness self-test's, which then blocked the gate permanently.
if (update && named.length === 0) {
  console.error('eval:gate --update requires a suite id, e.g.  npm run eval:gate -- extraction-core --update');
  console.error('Rewriting every baseline at once is how a baseline gets replaced by accident.');
  process.exit(1);
}

let failed = false;
let compared = 0;

for (const file of readdirSync(SUITES).filter(f => f.endsWith('.suite.mjs')).sort()) {
  const suite = (await import(pathToFileURL(path.join(SUITES, file)).href)).default;
  const baselinePath = path.join(BASELINES, `${suite.id}.v1.json`);

  if (NOT_GATED.has(suite.id)) {
    console.log(`\n── gate: ${suite.id} ──\n   not gated — it grades the harness and is deliberately incomplete`);
    continue;
  }
  if (named.length && !named.includes(suite.id)) continue;

  if (!existsSync(baselinePath) && !update) {
    console.log(`\n── gate: ${suite.id} ──\n   no baseline — skipped (not a failure)`);
    continue;
  }

  const report = await runSuite(suite);

  if (update) {
    // Regenerating a baseline is a DELIBERATE act that belongs in a PR saying
    // why the numbers moved. It is not something the gate does on its own when
    // a comparison fails, which would make the gate a rubber stamp.
    writeFileSync(baselinePath, `${JSON.stringify({
      schemaVersion: report.schemaVersion,
      recordedAt: report.manifest.ranAt,
      node: report.manifest.node,
      suiteFingerprint: report.manifest.suiteFingerprint,
      caseCount: report.manifest.caseCount,
      // The note explains what the baseline IS and what has to beat it. It is
      // hand-written and PRESERVED across regeneration: the first version
      // overwrote it with a generic string, which silently destroyed the one
      // piece of a baseline file that a human wrote on purpose.
      note: existsSync(baselinePath)
        ? JSON.parse(readFileSync(baselinePath, 'utf8')).note
        : `Baseline for ${suite.id}.`,
      coverage: report.result.coverage,
      metrics: report.result.metrics,
    }, null, 2)}\n`);
    console.log(`\n── gate: ${suite.id} ──\n   baseline UPDATED — justify the movement in the PR description`);
    compared++;
    continue;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const result = compareToBaseline(baseline, report);
  console.log(`\n${gateReport(suite.id, result)}`);
  if (!result.ok) failed = true;
  compared++;
}

if (compared === 0) {
  console.error('\neval:gate — no suites had baselines. Nothing was checked.');
  process.exit(1);
}

console.log(failed
  ? '\n✗ eval:gate BLOCKED — a metric moved the wrong way. Fix it, or update the baseline in a PR that explains why.\n'
  : '\n✓ eval:gate passed\n');
process.exit(failed ? 1 : 0);
