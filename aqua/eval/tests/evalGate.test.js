/**
 * AQUA Eval — the regression gate
 * Blueprint E2/PR-6 · Constitution L14
 *
 * A gate that never blocks is decoration. Most of this file is proving it
 * blocks, on each of the five things that should stop a merge:
 *
 *   a metric got worse · a measurement disappeared · the dataset changed ·
 *   the dataset SHAPE changed · the run was incomplete
 *
 * The one with the most bite is DIRECTION. `noise_lines` going up is a
 * regression; a gate that treated every metric as higher-is-better would wave
 * through a doubling of noise as an improvement — the precise failure the
 * retrieval dataset was built to expose.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareToBaseline, gateReport, VERDICT, LOWER_IS_BETTER, STRUCTURAL, EPSILON,
} from '../core/gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = n => JSON.parse(readFileSync(path.join(HERE, '../baselines', n), 'utf8'));

const baseline = {
  suiteFingerprint: 'abc123',
  metrics: { recall: 0.6, noise_lines: 10, positives: 160 },
};
const run = (metrics, over = {}) => ({
  manifest: { suiteFingerprint: 'abc123' },
  result: {
    coverage: { complete: true, skipped: 0, errored: 0 },
    metrics, ...over,
  },
});

// ── It passes what it should ─────────────────────────────────────────────────

describe('gate — passes a clean run', () => {
  test('identical metrics pass with every row unchanged', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.6, noise_lines: 10, positives: 160 }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.blocking, []);
    assert.ok(r.rows.every(x => x.verdict === VERDICT.PASS));
  });

  test('a real improvement passes and is reported as one', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.72, noise_lines: 10, positives: 160 }));
    assert.equal(r.ok, true);
    assert.equal(r.rows.find(x => x.name === 'recall').verdict, VERDICT.IMPROVED);
  });

  test('a NEW metric is reported, never blocking — adding a measurement is good', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.6, noise_lines: 10, positives: 160, ndcg: 0.5 }));
    assert.equal(r.ok, true);
    assert.equal(r.rows.find(x => x.name === 'ndcg').verdict, VERDICT.NEW);
  });

  test('float drift below epsilon is not a regression', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.6 - EPSILON / 2, noise_lines: 10, positives: 160 }));
    assert.equal(r.ok, true);
  });
});

// ── It blocks what it should ─────────────────────────────────────────────────

describe('gate — blocks a regression', () => {
  test('a higher-is-better metric going DOWN blocks', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.55, noise_lines: 10, positives: 160 }));
    assert.equal(r.ok, false);
    assert.equal(r.rows.find(x => x.name === 'recall').verdict, VERDICT.REGRESSED);
    assert.match(r.blocking.join(' '), /REGRESSED: recall/);
  });

  test('THE DIRECTION TRAP: a lower-is-better metric going UP blocks', () => {
    // Doubling the noise. A gate that assumed higher-is-better everywhere
    // would call this an improvement and let it through.
    const r = compareToBaseline(baseline, run({ recall: 0.6, noise_lines: 20, positives: 160 }));
    assert.equal(r.ok, false);
    assert.equal(r.rows.find(x => x.name === 'noise_lines').verdict, VERDICT.REGRESSED);
  });

  test('and a lower-is-better metric going DOWN is an improvement', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.6, noise_lines: 4, positives: 160 }));
    assert.equal(r.ok, true);
    assert.equal(r.rows.find(x => x.name === 'noise_lines').verdict, VERDICT.IMPROVED);
  });

  test('a REMOVED metric blocks — a measurement disappearing is not an improvement', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.6, positives: 160 }));
    assert.equal(r.ok, false);
    assert.equal(r.rows.find(x => x.name === 'noise_lines').verdict, VERDICT.MISSING);
    assert.match(r.blocking.join(' '), /METRIC REMOVED/);
  });

  test('a CHANGED DATASET refuses to compare at all', () => {
    // Two runs over different data are not comparable, and a delta between
    // them would be an invented result.
    const r = compareToBaseline(baseline, {
      manifest: { suiteFingerprint: 'different' },
      result: { coverage: { complete: true, skipped: 0, errored: 0 }, metrics: baseline.metrics },
    });
    assert.equal(r.ok, false);
    assert.match(r.blocking.join(' '), /DATASET CHANGED/);
  });

  test('a changed dataset SHAPE blocks, even when quality looks fine', () => {
    // Dropping 40 positives makes every other metric mean something else.
    const r = compareToBaseline(baseline, run({ recall: 0.9, noise_lines: 2, positives: 120 }));
    assert.equal(r.ok, false);
    assert.match(r.blocking.join(' '), /DATASET SHAPE CHANGED/);
  });

  test('an INCOMPLETE run blocks regardless of its metrics', () => {
    const r = compareToBaseline(baseline, run(
      { recall: 0.99, noise_lines: 0, positives: 160 },
      { coverage: { complete: false, skipped: 12, errored: 3 } },
    ));
    assert.equal(r.ok, false);
    assert.match(r.blocking.join(' '), /INCOMPLETE RUN/);
  });
});

// ── The direction table is complete ─────────────────────────────────────────

describe('gate — direction and structure are declared, not guessed', () => {
  test('every lower-is-better metric in the real baselines is declared', () => {
    // Catches the case where a future suite adds a "wrongness" metric and
    // nobody adds it to LOWER_IS_BETTER — it would then be gated backwards.
    const suspicious = [];
    for (const f of ['extraction-core.v1.json', 'retrieval-core.v1.json']) {
      for (const name of Object.keys(load(f).metrics)) {
        if (/noise|false_positive|error|miss|fail/i.test(name) && !LOWER_IS_BETTER.has(name)) {
          suspicious.push(name);
        }
      }
    }
    assert.deepEqual(suspicious, [],
      'these read like wrongness metrics but are gated as higher-is-better');
  });

  test('the real baselines contain the metrics the direction table names', () => {
    const all = new Set([
      ...Object.keys(load('extraction-core.v1.json').metrics),
      ...Object.keys(load('retrieval-core.v1.json').metrics),
    ]);
    for (const n of LOWER_IS_BETTER) assert.ok(all.has(n), `LOWER_IS_BETTER names ${n}, which no baseline reports`);
    for (const n of STRUCTURAL) assert.ok(all.has(n), `STRUCTURAL names ${n}, which no baseline reports`);
  });

  test('both committed baselines are complete runs', () => {
    for (const f of ['extraction-core.v1.json', 'retrieval-core.v1.json']) {
      assert.equal(load(f).coverage.complete, true, `${f} was recorded from a partial run`);
    }
  });
});

// ── Reporting ────────────────────────────────────────────────────────────────

describe('gate — the report is readable', () => {
  test('a clean run says so in one line', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.6, noise_lines: 10, positives: 160 }));
    assert.match(gateReport('x', r), /3 metrics, all unchanged/);
    assert.match(gateReport('x', r), /PASS/);
  });

  test('a blocked run names the metric and both numbers', () => {
    const r = compareToBaseline(baseline, run({ recall: 0.4, noise_lines: 10, positives: 160 }));
    const text = gateReport('x', r);
    assert.match(text, /BLOCKED/);
    assert.match(text, /recall/);
    assert.match(text, /0\.6/);
    assert.match(text, /0\.4/);
  });
});

// ── The PR-1 defect this PR found ───────────────────────────────────────────

describe('gate — multi-suite JSON actually contains the suites', () => {
  test('toJSON serialises a multi-report envelope', async () => {
    // E2/PR-1's toJSON only understood a single report, so
    // `npm run eval -- --json out.json` across several suites wrote a 25-byte
    // file containing `{"schemaVersion":1}` — no error, no warning, and the
    // gate could not have read it. Found the moment PR-6 needed it.
    const { toJSON } = await import('../core/report.mjs');
    const text = toJSON({
      schemaVersion: 1,
      reports: [
        { schemaVersion: 1, manifest: { a: 1 }, result: { metrics: { m: 1 } } },
        { schemaVersion: 1, manifest: { a: 2 }, result: { metrics: { m: 2 } } },
      ],
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.reports.length, 2);
    assert.equal(parsed.reports[1].result.metrics.m, 2);
  });
});
