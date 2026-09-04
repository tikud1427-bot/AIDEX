/**
 * AQUA Eval — extraction baseline
 * Blueprint E2/PR-3
 *
 * Two jobs, and the second is the one that protects the number:
 *
 *   1. The baseline is REPRODUCIBLE — re-running the suite gives the committed
 *      figures. If it drifts, extraction behaviour changed, and that is either
 *      a regression or an improvement someone has to name.
 *
 *   2. The scorer is FAIR. A scorer that is accidentally harsh publishes a
 *      baseline that is too low, and then E6 looks like a triumph for reasons
 *      that have nothing to do with E6. The tests below feed the scorer
 *      SYNTHETIC PERFECT output and assert it scores 100% — proving the zeros
 *      in the real baseline come from the extractor, not from the grader.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSuite } from '../core/runner.mjs';
import suite from '../suites/extraction-core.suite.mjs';
import { extractWithCurrentEngine } from '../adapters/currentExtractor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(readFileSync(path.join(HERE, '../baselines/extraction-core.v1.json'), 'utf8'));

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── The adapter really drives the engine ─────────────────────────────────────

describe('extraction baseline — the adapter is not a stub', () => {
  test('it produces real facts for a real sentence', () => {
    // Three probes against this lane returned zero for everything before the
    // adapter was right — a wrong argument shape, a wrong field name, a missing
    // resolver step. Each would have published a 0% baseline and made any
    // replacement look miraculous. This test is what stops that recurring.
    const r = extractWithCurrentEngine('I run product at Nummo.');
    assert.ok(r.facts.length > 0, 'the adapter extracted nothing — it is miswired, not the engine');
    assert.ok(r.entities.some(e => e.canonical === 'Nummo'));
  });

  test('it stays silent on a request with no proper noun', () => {
    assert.equal(extractWithCurrentEngine('Fix this for me please.').facts.length, 0);
  });

  test('FINDING: a request CONTAINING a proper noun still produces a fact', () => {
    // "Explain how OAuth works to me." emits a fact, because OAuth reads as an
    // entity and the lane has no notion of a request. This is one of the 10
    // false positives in the baseline, and it is the same failure class as
    // "I need to check the logs" — fixed once at the self-declaration gate and
    // still live on the general path.
    //
    // Written as an assertion of what the engine DOES. The first version of
    // this test asserted silence, which is what I assumed rather than what I
    // had measured.
    assert.equal(extractWithCurrentEngine('Explain how OAuth works to me.').facts.length, 1);
  });

  test('FINDING: the speaker is recognised only when the sentence declares them', () => {
    // "I run product at Nummo." → self entity present.
    // "I moved to Bangalore last month." → NO self entity, only Bangalore.
    // Self recognition rides the self-declaration grammar, not the pronoun, so
    // first-person subjects are missed on most sentence shapes. That is the
    // direct cause of subject_recall sitting at 41%.
    assert.ok(extractWithCurrentEngine('I run product at Nummo.').entities.some(e => e.isSelf));
    assert.equal(extractWithCurrentEngine('I moved to Bangalore last month.').entities.some(e => e.isSelf), false);
  });
});

// ── The scorer is fair ───────────────────────────────────────────────────────

describe('extraction baseline — the scorer is not accidentally harsh', () => {
  const positive = suite.cases.find(c => c.cat === 'negation');

  test('PERFECT output scores 100% at every level', () => {
    // Synthetic output carrying everything the labels ask for. If this does not
    // score 1.0, the zeros in the published baseline are the grader's fault and
    // the whole PR is measuring itself.
    const perfect = {
      surfaces: [...positive.claims.map(c => (c.s === 'SELF' ? '__self__' : c.s.toLowerCase()))],
      facts: positive.claims.map(c => ({
        statement: positive.text, predicate: c.p, polarity: c.polarity,
        modality: c.modality, time: c.time ?? null,
      })),
    };
    const s = suite.score(positive, perfect);
    assert.equal(s.correct, true, 'perfect output was marked wrong — the scorer is harsh');
    assert.equal(s.subjectHits, positive.claims.length);
    assert.equal(s.predicateHits, positive.claims.length);
    assert.equal(s.fidelityHits, positive.claims.length);
  });

  test('predicate and fidelity are computed from the OUTPUT, not hardcoded to zero', () => {
    // The day E6 starts emitting predicates these begin scoring with no code
    // change here. A hardcoded zero would silently keep reporting failure.
    const m = suite.metrics([
      { kind: 'positive', cat: 'negation', emitted: true, claims: 1, subjectHits: 1, predicateHits: 1, fidelityHits: 1, correct: true },
    ]);
    assert.equal(m.predicate_accuracy, 1);
    assert.equal(m.fidelity_accuracy, 1);
  });

  test('a negative that stays silent is correct; one that fires is not', () => {
    const neg = suite.cases.find(c => c.cat === 'negative');
    assert.equal(suite.score(neg, { facts: [], surfaces: [] }).correct, true);
    assert.equal(suite.score(neg, { facts: [{ statement: neg.text }], surfaces: [] }).correct, false);
  });

  test('precision is reported separately, never averaged into recall', () => {
    // Folding silence-on-negatives into one accuracy figure is how an
    // extractor that fires on everything hides.
    const m = suite.metrics([
      { kind: 'positive', cat: 'identity', emitted: true, claims: 1, subjectHits: 1, predicateHits: 0, fidelityHits: 0, correct: false },
      { kind: 'negative', cat: 'negative', emitted: true, correct: false },
    ]);
    assert.equal(m.silence_on_negatives, 0);
    assert.equal(m.false_positives, 1);
    assert.equal(m.detection_recall, 1);
  });
});

// ── The baseline reproduces ──────────────────────────────────────────────────

describe('extraction baseline — reproduces the committed figures', () => {
  test('every case executes — a partial baseline is not a baseline', async () => {
    const { result } = await runSuite(suite);
    assert.equal(result.coverage.total, 200);
    assert.equal(result.coverage.executed, 200);
    assert.equal(result.coverage.complete, true);
  });

  test('the headline figures match what is committed', async () => {
    const { result } = await runSuite(suite);
    for (const key of [
      'detection_recall', 'subject_recall', 'predicate_accuracy',
      'fidelity_accuracy', 'silence_on_negatives', 'overall_strict_accuracy',
    ]) {
      assert.ok(near(result.metrics[key], BASELINE.metrics[key]),
        `${key} moved: committed ${BASELINE.metrics[key]}, measured ${result.metrics[key]} — ` +
        'extraction behaviour changed. Regenerate the baseline deliberately, in a PR that says why.');
    }
  });

  test('the baseline records the conditions that produced it', () => {
    assert.ok(BASELINE.suiteFingerprint, 'no dataset fingerprint — two runs over different data would look comparable');
    assert.ok(BASELINE.recordedAt);
    assert.equal(BASELINE.caseCount, 200);
    assert.match(BASELINE.note, /E6 must beat/);
  });
});

// ── What the baseline actually says ──────────────────────────────────────────

describe('extraction baseline — the findings, pinned', () => {
  test('predicate and fidelity are ZERO — structurally, not by bad luck', () => {
    // The lane emits a verbatim statement and an entity list. There is no
    // predicate field and no polarity/modality/time field anywhere in its
    // output, so these cannot be non-zero until the schema changes. This is
    // the single clearest statement of what E5 and E6 are for.
    assert.equal(BASELINE.metrics.predicate_accuracy, 0);
    assert.equal(BASELINE.metrics.fidelity_accuracy, 0);
  });

  test('detection is well short of complete', () => {
    assert.ok(BASELINE.metrics.detection_recall < 0.7,
      'detection improved past the recorded baseline — update it deliberately');
  });

  test('temporal and negation are the weakest categories', () => {
    const m = BASELINE.metrics;
    assert.ok(m.detection_temporal < m.detection_identity);
    assert.ok(m.detection_negation < m.detection_identity);
  });

  test('there are real false positives on the negatives', () => {
    // 10 of 40. Requests and questions containing a proper noun still produce
    // a fact — the same failure class as "I need to check the logs", which was
    // fixed once at the self-declaration gate and is still present here.
    assert.ok(BASELINE.metrics.false_positives > 0);
    assert.ok(BASELINE.metrics.silence_on_negatives < 1);
  });
});
