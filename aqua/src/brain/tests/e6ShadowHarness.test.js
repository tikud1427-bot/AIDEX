/**
 * The E6 shadow harness — the five defects the first real run exposed.
 *
 * That run reported `subject_recall 0%`, `silence_on_negatives 0%`,
 * `negation 0% FAIL` and a verdict of DO NOT PROMOTE. Four of those five
 * numbers were harness defects, not extraction defects, and every one of them
 * was invisible to the existing tests — reverting each fix left the whole
 * `e6Shadow.test.js` suite green. That is what this file is for.
 *
 * BITE, MEASURED (revert the named change → count failures):
 *   `__self__` sentinel in the E6 adapter    → 3 fail
 *   stratified `--limit`                     → 4 fail
 *   0/0 reports null, not 0.0                → 3 fail
 *   partial runs refuse baseline comparison  → 2 fail
 *   discards keyed by gate AND reason        → 2 fail
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stratify, evaluatePromotion } from '../../../scripts/e6-shadow.mjs';
import suite from '../../../eval/suites/extraction-core.suite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../../../eval/datasets/extraction-core.v1.json'), 'utf8'));

// ── 1. The sentinel ──────────────────────────────────────────────────────────

describe('E6 adapter — the self sentinel the suite actually checks', () => {
  test('a self-claim contributes __self__, not just first-person surfaces', async () => {
    // `extraction-core.suite.mjs` scores a self-subject with exactly
    // `surfaces.has('__self__')`. The adapter emitted 'I', 'me', 'my', 'we',
    // 'our' and never the sentinel, so all 20 SELF claims in the first shadow
    // slice missed — subject_recall 0.00 against the regex lane's 0.55 on the
    // same cases, while detection ran at 0.90.
    const { extractE6 } = await import('../../../eval/adapters/e6Extractor.mjs');
    const { __clearExtractionCache } = await import('../understanding/extractionClient.js');
    __clearExtractionCache();
    // The exact fixture shape e6Shadow.test.js already proves the validator
    // admits. Inventing a second one here risks failing on contract grounds and
    // reading as a sentinel bug — which is how the first attempt failed.
    const worksAt = {
      subject: 'self', predicate: 'works_at', object: { entity: 'Nummo' },
      polarity: 'asserted', modality: 'fact', timePrecision: 'none',
      statementText: 'I work at Nummo', confidenceExtraction: 0.9,
    };
    const r = await extractE6('I work at Nummo.', {
      callModel: async () => ({ text: JSON.stringify({ claims: [worksAt] }), model: 'test/model' }),
    });
    assert.ok(r.surfaces.includes('__self__'),
      `surfaces were [${r.surfaces.join(', ')}] — the suite checks for __self__ and nothing else`);
  });

  test('the suite scores that surface set as a subject hit', () => {
    // End-to-end through the real scorer, so the two halves cannot drift apart
    // again with each looking correct alone.
    const selfCase = DS.cases.find(c => c.claims?.some(cl => cl.s === 'SELF'));
    assert.ok(selfCase, 'dataset has no SELF-subject case');
    const scored = suite.score(selfCase, {
      facts: selfCase.claims.map(() => ({ subject: 'self', predicate: 'x' })),
      surfaces: ['__self__'],
    });
    assert.equal(scored.subjectHits, selfCase.claims.length);
  });

  test('the first-person forms are NOT sufficient on their own', () => {
    // Pins the exact failure, so restoring the old expansion fails here.
    const selfCase = DS.cases.find(c => c.claims?.some(cl => cl.s === 'SELF'));
    const scored = suite.score(selfCase, {
      facts: selfCase.claims.map(() => ({ subject: 'self', predicate: 'x' })),
      surfaces: ['self', 'I', 'me', 'my', 'we', 'our'],
    });
    assert.equal(scored.subjectHits, 0, 'surface forms alone should not score — the suite wants the sentinel');
  });
});

// ── 2. Stratified sampling ───────────────────────────────────────────────────

describe('--limit samples the dataset rather than slicing its front', () => {
  test('a small limit still reaches negatives', () => {
    // `extraction-core.v1` is grouped by category: cases 0-19 are all
    // `identity` and the first negative is at index 160. A prefix of 20
    // contained no negatives at all, which is where three of the five reported
    // "failures" came from.
    const picked = stratify(DS.cases, 20);
    assert.equal(picked.length, 20);
    assert.ok(picked.some(c => !(c.claims?.length)), 'a 20-case sample reached no negative case');
  });

  test('every category is represented before any is doubled', () => {
    const cats = new Set(DS.cases.map(c => c.cat));
    const picked = stratify(DS.cases, cats.size);
    assert.equal(new Set(picked.map(c => c.cat)).size, cats.size);
  });

  test('it is deterministic — the same limit picks the same cases', () => {
    // Two runs at the same budget must be comparable to each other. An RNG
    // here would make every partial run its own incomparable population.
    const a = stratify(DS.cases, 37).map(c => c.id);
    const b = stratify(DS.cases, 37).map(c => c.id);
    assert.deepEqual(a, b);
  });

  test('a limit at or above the dataset returns everything, in order', () => {
    assert.deepEqual(stratify(DS.cases, DS.cases.length), DS.cases);
    assert.deepEqual(stratify(DS.cases, 10_000), DS.cases);
  });
});

// ── 3 & 4. Zero denominators and comparability ───────────────────────────────

const partial = {
  detection_recall: 0.9, false_positives: 0, negatives: 0,
  positives: 20, labelled_claims: 20, n_cases_negation: 0, detection_negation: 0,
};
const full = {
  detection_recall: 0.9, false_positives: 1, negatives: 40,
  positives: 160, labelled_claims: 160, n_cases_negation: 20, detection_negation: 0.96,
};

describe('a metric with no cases is unmeasured, not zero', () => {
  test('negation reports null when no negation case was sent', () => {
    const v = evaluatePromotion(partial, {}, { comparable: false });
    const neg = v.checks.find(c => c.name === 'negation');
    assert.equal(neg.got, null);
    assert.equal(neg.measured, false);
  });

  test('precision reports null when there were no negatives to be wrong about', () => {
    // The old formula divided by `Math.max(1, negatives)`, so zero negatives
    // silently produced a perfect 100% — a PASS nobody had earned.
    const v = evaluatePromotion(partial, {}, { comparable: false });
    assert.equal(v.checks.find(c => c.name === 'precision').got, null);
  });

  test('an unmeasured check still blocks promotion', () => {
    // Not measured is not passed. The point is to stop it looking like a
    // catastrophic score, not to wave it through.
    assert.equal(evaluatePromotion(partial, {}, { comparable: false }).promote, false);
  });

  test('a measured negation score is graded normally', () => {
    const v = evaluatePromotion(full, {}, { comparable: true });
    const neg = v.checks.find(c => c.name === 'negation');
    assert.equal(neg.measured, true);
    assert.ok(neg.pass);
  });
});

describe('a partial run is never compared to a full-set baseline', () => {
  test('regressions are not computed for a partial run', () => {
    // The first run listed `silence_on_negatives 0.9 → 0` as a regression,
    // comparing 200 cases with 40 negatives against 20 cases with none. Two
    // populations, not a change.
    const v = evaluatePromotion(partial, { silence_on_negatives: 0.9, subject_recall: 0.55 }, { comparable: false });
    assert.deepEqual(v.regressions, []);
    assert.equal(v.comparable, false);
  });

  test('a full run still catches a real regression', () => {
    const v = evaluatePromotion(full, { subject_recall: 0.9 }, { comparable: true });
    assert.ok(v.regressions.some(r => r.metric === 'subject_recall'));
    assert.equal(v.promote, false);
  });
});

// ── 5. Discard attribution ───────────────────────────────────────────────────

describe('discards name their reason, not just a stage number', () => {
  test('the pipeline keys byGate with the reason attached', () => {
    // The first run reported `discardedByGate: {"2": 2}`. Gate 2 covers both
    // `object-missing` (the model omitted a field) and `object-not-in-quote`
    // (it invented content) — opposite defects in one bucket, and the bucket
    // was the only record kept.
    const src = readFileSync(path.join(HERE, '../understanding/pipeline.js'), 'utf8');
    assert.match(src, /byGate\[key\]/, 'pipeline no longer uses a composite discard key');
    assert.match(src, /\$\{v\.gate \?\? '\?'\}:\$\{v\.reason \?\? 'unknown'\}/,
      'the discard key must carry both the gate and the reason');
  });

  test('the suite publishes per-category case counts', () => {
    // The denominators the 0/0 check above depends on. Without these the
    // promotion gate cannot tell a scored zero from an unasked question.
    const m = suite.metrics(DS.cases.map(c => suite.score(c, { facts: [], surfaces: [] })));
    assert.ok(Number.isInteger(m.n_cases_negation), 'n_cases_negation is missing');
    assert.ok(m.n_cases_negation > 0);
  });
});
